const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTitle,
  parseLrc,
  lineIndexAt,
  renderWindow,
  pickLyricsCandidate,
  parseCacheLimit,
  sanitizeLyricLine,
  ANSI,
  MARKERS,
  MAX_LINE_CHARS,
} = require('../src/lyrics');

test('유튜브 제목에서 아티스트와 곡명을 가려낸다', () => {
  assert.deepEqual(normalizeTitle('아이유(IU) - 밤편지 [Official MV]'), {
    artist: '아이유(IU)',
    title: '밤편지',
  });

  // K-pop 공식 채널이 쓰는 밑줄 구분자
  assert.deepEqual(normalizeTitle('[MV] BTS(방탄소년단) _ Dynamite (Official Video)'), {
    artist: 'BTS(방탄소년단)',
    title: 'Dynamite',
  });
});

test('구분자가 없으면 아티스트를 비우고 제목만 남긴다', () => {
  // 이때 fetchLyrics는 필드를 나누지 않고 q로 통째 검색한다.
  assert.deepEqual(normalizeTitle('그냥 제목'), { artist: '', title: '그냥 제목' });
});

test('구분자가 여러 개면 첫 번째만 아티스트로 본다', () => {
  // "Artist - Title - Reprise"에서 Reprise까지 아티스트로 먹으면 검색이 실패한다.
  assert.deepEqual(normalizeTitle('Artist - Title - Reprise'), {
    artist: 'Artist',
    title: 'Title - Reprise',
  });
});

test('괄호 없이 꼬리에 붙은 잡음도 깎는다', () => {
  // 여러 개가 겹쳐 붙으므로 한 번만 깎으면 남는다.
  assert.equal(normalizeTitle('NewJeans Ditto Official MV').title, 'NewJeans Ditto');
  assert.equal(normalizeTitle('Song Title Official Audio 4K').title, 'Song Title');
});

test('의미 있는 괄호는 남기고 잡음 괄호만 지운다', () => {
  // (Prod. ...)를 지우면 같은 제목의 다른 곡과 구별할 수 없다.
  assert.equal(normalizeTitle('제목 (Prod. by Someone) (Official Video)').title, '제목 (Prod. by Someone)');
});

test('feat. 이후는 버린다', () => {
  assert.equal(normalizeTitle('Artist - Title feat. Someone Else').title, 'Title');
});

test('LRC를 밀리초 타임스탬프로 바꾼다', () => {
  const lines = parseLrc(['[ar:아이유]', '[00:12.34]첫 줄', '[01:05.5]둘째 줄'].join('\n'));

  // 메타데이터 태그는 숫자로 시작하지 않아 자연히 걸러진다.
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { at: 12_340, text: '첫 줄' });
  // .5는 500ms다. 50ms로 읽으면 가사가 점점 어긋난다.
  assert.deepEqual(lines[1], { at: 65_500, text: '둘째 줄' });
});

test('한 줄에 타임스탬프가 여럿이면(후렴) 각각을 만들고 시간순으로 정렬한다', () => {
  // 정렬이 깨지면 lineIndexAt의 이분 탐색이 엉뚱한 줄을 집는다.
  const lines = parseLrc('[00:30.00][02:00.00]후렴\n[01:00.00]2절');

  assert.deepEqual(
    lines.map((line) => line.at),
    [30_000, 60_000, 120_000]
  );
  assert.deepEqual(
    lines.map((line) => line.text),
    ['후렴', '2절', '후렴']
  );
});

test('가사가 빈 줄(간주)도 남긴다', () => {
  const lines = parseLrc('[00:10.00]\n[00:20.00]노래');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, '');
});

test('타임스탬프가 없는 텍스트는 빈 배열이 된다', () => {
  // 동기 가사가 아닌 전문이 들어왔을 때다. fetchLyrics가 이 결과로 plain 경로를 고른다.
  assert.deepEqual(parseLrc('그냥 가사\n두 번째 줄'), []);
  assert.deepEqual(parseLrc(''), []);
  assert.deepEqual(parseLrc(null), []);
});

const SAMPLE = parseLrc(
  ['[00:10.00]한 줄', '[00:20.00]두 줄', '[00:30.00]세 줄', '[00:40.00]네 줄'].join('\n')
);

test('재생 위치로 현재 줄을 찾는다', () => {
  assert.equal(lineIndexAt(SAMPLE, 0), -1, '전주 구간은 -1이어야 한다');
  assert.equal(lineIndexAt(SAMPLE, 9_999), -1);
  assert.equal(lineIndexAt(SAMPLE, 10_000), 0, '타임스탬프와 정확히 같으면 그 줄이다');
  assert.equal(lineIndexAt(SAMPLE, 25_000), 1);
  assert.equal(lineIndexAt(SAMPLE, 999_999), 3, '마지막 줄을 넘어서면 마지막 줄에 머문다');
  assert.equal(lineIndexAt([], 1_000), -1);
});

test('현재 줄을 화살표와 굵은 노랑으로, 지난 줄을 회색으로 칠한다', () => {
  const rendered = renderWindow(SAMPLE, 2).split('\n');

  // 첫 줄과 끝 줄은 코드블록 울타리다.
  assert.equal(rendered[0], '```ansi');
  assert.equal(rendered.at(-1), '```');

  const body = rendered.slice(1, -1);
  assert.equal(body.length, 5, '창의 높이는 항상 5줄이어야 한다');
  assert.equal(body[0], `${ANSI.past}${MARKERS.other}한 줄${ANSI.reset}`);
  assert.equal(body[2], `${ANSI.current}${MARKERS.current}세 줄${ANSI.reset}`, '현재 줄만 굵은 노랑이다');
  assert.equal(body[3], `${ANSI.next}${MARKERS.other}네 줄${ANSI.reset}`);

  // 색이 유일한 신호이면 색 구분이 약한 클라이언트에서 다섯 줄이 한 덩어리로 보인다.
  assert.ok(body[2].includes('▸'), '색을 못 보는 환경에서도 현재 줄을 알 수 있어야 한다');
  assert.equal(body.filter((line) => line.includes('▸')).length, 1, '화살표는 현재 줄에만 붙는다');
});

test('모든 줄이 같은 크기라 창의 높이가 변하지 않는다', () => {
  // 헤딩과 서브텍스트를 섞으면 글씨 크기가 세 종류가 되어 줄 높이가 들쭉날쭉해진다.
  // 코드블록은 그 문제가 없다. 대신 곡의 처음/끝에서 빈 줄로 높이를 채워야 한다.
  for (const index of [-1, 0, 1, SAMPLE.length - 1]) {
    const body = renderWindow(SAMPLE, index).split('\n').slice(1, -1);
    assert.equal(body.length, 5, `index=${index}`);
  }

  const body = renderWindow(SAMPLE, 0).split('\n').slice(1, -1);
  assert.equal(body[0], '');
  assert.equal(body[1], '');
  assert.equal(body[2], `${ANSI.current}${MARKERS.current}한 줄${ANSI.reset}`);
});

test('전주 구간에는 강조된 줄이 없다', () => {
  assert.ok(!renderWindow(SAMPLE, -1).includes(ANSI.current), '아직 시작 전이므로 강조할 줄이 없다');
});

test('간주는 음표로 표시한다', () => {
  const lines = parseLrc('[00:10.00]\n[00:20.00]노래');
  const body = renderWindow(lines, 0).split('\n').slice(1, -1);
  assert.equal(body[2], `${ANSI.current}${MARKERS.current}♪${ANSI.reset}`, '빈 줄을 그대로 두면 멈춘 것처럼 보인다');
});

test('가사에 백틱이 있어도 코드블록이 깨지지 않는다', () => {
  // 가사 한 줄이 코드블록을 통째로 닫아버리면 뒤의 모든 줄이 평문으로 쏟아진다.
  assert.ok(!sanitizeLyricLine('```내 마음`').includes('`'));
  const rendered = renderWindow(parseLrc('[00:10.00]```깨뜨리기'), 0);
  assert.equal(rendered.match(/```/g).length, 2, '울타리 두 개 외에 백틱이 남으면 안 된다');
});

test('가사에 섞인 제어문자가 우리 색을 덮어쓰지 못한다', () => {
  // ESC가 그대로 들어가면 가사가 자기 색을 지정해 화면이 엉킨다.
  const dirty = sanitizeLyricLine(`\u001b[1;31m빨강\u0000`);
  assert.ok(!dirty.includes('\u001b'));
  assert.equal(dirty, '[1;31m빨강');
});

test('너무 긴 줄은 잘라낸다', () => {
  // 코드블록에서 줄이 접히면 색이 이어진 줄까지 번져 정렬이 흐트러진다.
  const long = '가'.repeat(MAX_LINE_CHARS + 20);
  const cut = sanitizeLyricLine(long);
  assert.equal(cut.length, MAX_LINE_CHARS);
  assert.ok(cut.endsWith('…'));
});

test('LYRICS_PLAIN_STYLE=1이면 색 없이 화살표로 그린다', () => {
  // ANSI가 깨져 보이는 환경을 위한 탈출구다.
  const body = renderWindow(SAMPLE, 2, { color: false }).split('\n');

  assert.ok(!body[0].includes('```'), '코드블록을 쓰지 않는다');
  assert.equal(body.length, 5);
  assert.equal(body[2], '▸ 세 줄');
  assert.equal(body[1], '  두 줄', '들여쓰기를 맞춰야 줄이 밀리지 않는다');
});

test('가사 후보는 길이가 맞는 것을, 그 다음 동기 가사를 우선한다', () => {
  const candidates = [
    { trackName: '라이브 버전', duration: 300, syncedLyrics: '[00:01.00]a' },
    { trackName: '전문만', duration: 201, plainLyrics: '가사' },
    { trackName: '정답', duration: 200, syncedLyrics: '[00:01.00]a' },
  ];

  // 길이가 맞는 후보가 여럿이면 동기 가사가 있는 쪽을 고른다.
  assert.equal(pickLyricsCandidate(candidates, 200).trackName, '정답');
});

test('길이가 맞는 후보가 없으면 가장 가까운 것을 고른다', () => {
  // 유튜브 영상은 인트로가 붙어 원곡보다 길기 마련이라, 못 고르는 쪽이 더 나쁘다.
  const candidates = [
    { trackName: '먼 것', duration: 400, syncedLyrics: '[00:01.00]a' },
    { trackName: '가까운 것', duration: 215, syncedLyrics: '[00:01.00]a' },
  ];
  assert.equal(pickLyricsCandidate(candidates, 200).trackName, '가까운 것');
});

test('반주(instrumental)와 가사 없는 후보는 버린다', () => {
  assert.equal(pickLyricsCandidate([{ duration: 200, instrumental: true, plainLyrics: '' }], 200), null);
  assert.equal(pickLyricsCandidate([{ duration: 200 }], 200), null);
  assert.equal(pickLyricsCandidate([], 200), null);
  assert.equal(pickLyricsCandidate(null, 200), null);
});

test('캐시 상한은 잘못된 값에 예외를 던지지 않고 기본값으로 떨어진다', () => {
  // 설정 실수로 기능이 통째로 막히는 편이 더 나쁘다.
  assert.equal(parseCacheLimit('20'), 20);
  assert.equal(parseCacheLimit('0'), 50);
  assert.equal(parseCacheLimit('많이'), 50);
  assert.equal(parseCacheLimit(undefined), 50);
  assert.equal(parseCacheLimit('99999'), 50);
});
