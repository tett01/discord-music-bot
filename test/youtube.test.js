const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  describeTrackError,
  isYoutubeUrl,
  cookieArgs,
  extraArgs,
  splitArgs,
  resolveYtdlpPath,
} = require('../src/youtube');

const DEFAULT_MESSAGE = '영상을 찾지 못했습니다. 링크나 검색어를 확인해주세요.';

// 실제 yt-dlp stderr에서 따온 샘플. 사유별로 다른 문장이 나와야 한다.
const SAMPLES = [
  ['연령 제한', 'ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.', '🔞'],
  ['멤버십 전용', 'ERROR: [youtube] abc: Join this channel to get access to members-only content', '💳'],
  ['비공개', 'ERROR: [youtube] abc: Private video. Sign in if you have been granted access to this video', '🔒'],
  ['지역 제한', 'ERROR: [youtube] abc: The uploader has not made this video available in your country', '🌍'],
  ['시작 전 라이브', 'ERROR: [youtube] abc: This live event will begin in 3 hours.', '📡'],
  ['삭제된 영상', 'ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader', '🗑️'],
  ['타임아웃', 'yt-dlp 응답 시간 초과', '⌛'],
  ['추출 실패', 'ERROR: unable to extract player response; please report this issue', '⚠️'],
  [
    '봇 의심 차단',
    "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.",
    '🤖',
  ],
];

test('실패 사유별로 다른 안내 문장을 돌려준다', () => {
  for (const [label, stderr, marker] of SAMPLES) {
    const message = describeTrackError(new Error(stderr));
    assert.ok(message.startsWith(marker), `${label}: 예상 '${marker}', 실제 '${message}'`);
    assert.notEqual(message, DEFAULT_MESSAGE, `${label}: 기본 문구로 떨어짐`);
  }
});

test('사유별 문장이 서로 겹치지 않는다', () => {
  const messages = SAMPLES.map(([, stderr]) => describeTrackError(new Error(stderr)));
  assert.equal(new Set(messages).size, messages.length, '두 사유가 같은 문장으로 매핑됨');
});

test('구체적인 패턴이 넓은 패턴보다 먼저 매칭된다', () => {
  // ERROR_HINTS는 위에서부터 첫 일치를 쓴다. 구체적인 패턴이 뒤로 밀리면
  // 조용히 뭉뚱그린 문구가 나가므로, 두 패턴이 동시에 걸리는 입력으로 순서를 고정한다.
  const bothPrivateAndUnavailable = new Error('ERROR: [youtube] abc: Private video. Video unavailable');
  assert.ok(describeTrackError(bothPrivateAndUnavailable).startsWith('🔒'));

  const bothAgeAndUnavailable = new Error('ERROR: Sign in to confirm your age. Video unavailable');
  assert.ok(describeTrackError(bothAgeAndUnavailable).startsWith('🔞'));

  const bothMembersAndPrivate = new Error('ERROR: Join this channel. Private video');
  assert.ok(describeTrackError(bothMembersAndPrivate).startsWith('💳'));

  // 봇 차단은 영상이 아니라 서버 IP 문제라, 같이 걸려도 이쪽 안내가 나가야 한다.
  const botAndUnavailable = new Error("ERROR: Sign in to confirm you're not a bot. Video unavailable");
  assert.ok(describeTrackError(botAndUnavailable).startsWith('🤖'));
});

test('알 수 없는 오류는 기본 문구로 떨어진다', () => {
  assert.equal(describeTrackError(new Error('무언가 알 수 없는 실패')), DEFAULT_MESSAGE);
});

test('message가 없는 값에도 터지지 않는다', () => {
  for (const input of [null, undefined, {}, '문자열 에러', 0]) {
    assert.equal(describeTrackError(input), DEFAULT_MESSAGE);
  }
});

test('유튜브 URL을 알아본다', () => {
  const urls = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'http://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    'youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/playlist?list=PL123',
    '  https://youtu.be/dQw4w9WgXcQ  ',
  ];

  for (const url of urls) {
    assert.ok(isYoutubeUrl(url), `유튜브 URL로 인식하지 못함: ${url}`);
  }
});

test('유튜브가 아닌 입력은 검색어로 취급한다', () => {
  // 여기서 true가 나오면 검색어를 URL처럼 yt-dlp에 넘겨 재생이 실패한다.
  const notUrls = [
    '아이유 밤편지',
    'never gonna give you up',
    'https://vimeo.com/12345',
    'https://soundcloud.com/artist/track',
    'https://notyoutube.com/watch?v=abc',
    'youtube.com',
    '',
  ];

  for (const text of notUrls) {
    assert.ok(!isYoutubeUrl(text), `유튜브 URL로 잘못 인식함: ${text}`);
  }
});

test('YTDLP_COOKIES가 없으면 인자를 붙이지 않는다', (t) => {
  // 로컬 실행에서 동작이 달라지면 안 된다. 빈 문자열도 미설정과 같게 취급한다.
  const previous = process.env.YTDLP_COOKIES;
  t.after(() => {
    if (previous === undefined) delete process.env.YTDLP_COOKIES;
    else process.env.YTDLP_COOKIES = previous;
  });

  delete process.env.YTDLP_COOKIES;
  assert.deepEqual(cookieArgs(), []);

  process.env.YTDLP_COOKIES = '   ';
  assert.deepEqual(cookieArgs(), []);
});

test('YTDLP_PATH를 지정하면 그 경로를 쓴다', (t) => {
  // 이 우선순위가 뒤집히면 python이 없는 호스팅에서 직접 넣어준 바이너리를 무시하고
  // 설치되지 않은 yt-dlp-exec 경로로 떨어진다.
  const previous = process.env.YTDLP_PATH;
  t.after(() => {
    if (previous === undefined) delete process.env.YTDLP_PATH;
    else process.env.YTDLP_PATH = previous;
  });

  process.env.YTDLP_PATH = '/home/container/bin/yt-dlp';
  assert.equal(resolveYtdlpPath(), '/home/container/bin/yt-dlp');

  // 공백만 있는 값은 미설정과 같게 본다.
  process.env.YTDLP_PATH = '   ';
  assert.notEqual(resolveYtdlpPath(), '   ');
});

test('YTDLP_PATH가 없어도 실행 가능한 경로를 돌려준다', (t) => {
  const previous = process.env.YTDLP_PATH;
  t.after(() => {
    if (previous === undefined) delete process.env.YTDLP_PATH;
    else process.env.YTDLP_PATH = previous;
  });

  delete process.env.YTDLP_PATH;
  const resolved = resolveYtdlpPath();
  assert.equal(typeof resolved, 'string');
  assert.ok(resolved.length > 0, '빈 경로로 spawn하면 원인을 알기 어려운 오류가 난다');
});

test('쿠키 파일이 있으면 --cookies를 붙이고, 없으면 조용히 뺀다', (t) => {
  const previous = process.env.YTDLP_COOKIES;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-cookies-'));
  const cookiePath = path.join(dir, 'cookies.txt');
  fs.writeFileSync(cookiePath, '# Netscape HTTP Cookie File\n');

  t.after(() => {
    if (previous === undefined) delete process.env.YTDLP_COOKIES;
    else process.env.YTDLP_COOKIES = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  process.env.YTDLP_COOKIES = cookiePath;
  assert.deepEqual(cookieArgs(), ['--cookies', cookiePath]);

  // 경로가 틀렸을 때 --cookies를 그대로 넘기면 yt-dlp가 알아보기 힘든 오류로 죽는다.
  process.env.YTDLP_COOKIES = path.join(dir, '없는파일.txt');
  assert.deepEqual(cookieArgs(), []);
});

// --- 추가 인자 (쿠키 없이 봇 판정을 비껴가려는 시도) ---

function withEnv(vars, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const NO_EXTRA = { YTDLP_PLAYER_CLIENT: undefined, YTDLP_EXTRA_ARGS: undefined };

test('아무것도 지정하지 않으면 인자를 붙이지 않는다', () => {
  // 기존 동작 그대로여야 한다. 빈 문자열이 인자로 새어 나가면 yt-dlp가 거부한다.
  withEnv(NO_EXTRA, () => assert.deepEqual(extraArgs(), []));
  withEnv({ ...NO_EXTRA, YTDLP_PLAYER_CLIENT: '   ', YTDLP_EXTRA_ARGS: '' }, () =>
    assert.deepEqual(extraArgs(), [])
  );
});

test('YTDLP_PLAYER_CLIENT는 extractor-args로 펼쳐진다', () => {
  withEnv({ ...NO_EXTRA, YTDLP_PLAYER_CLIENT: 'tv,web_safari' }, () => {
    assert.deepEqual(extraArgs(), ['--extractor-args', 'youtube:player_client=tv,web_safari']);
  });
});

test('YTDLP_EXTRA_ARGS는 따옴표를 존중하며 쪼개진다', () => {
  // 사람들이 문서에서 복사해 오는 모양 그대로 붙여넣을 수 있어야 한다.
  withEnv({ ...NO_EXTRA, YTDLP_EXTRA_ARGS: '--extractor-args "youtube:player_client=tv"' }, () => {
    assert.deepEqual(extraArgs(), ['--extractor-args', 'youtube:player_client=tv']);
  });
});

test('두 변수를 함께 쓰면 순서대로 붙는다', () => {
  withEnv({ YTDLP_PLAYER_CLIENT: 'ios', YTDLP_EXTRA_ARGS: '--sleep-requests 1' }, () => {
    assert.deepEqual(extraArgs(), [
      '--extractor-args',
      'youtube:player_client=ios',
      '--sleep-requests',
      '1',
    ]);
  });
});

test('splitArgs는 공백과 따옴표를 다룬다', () => {
  assert.deepEqual(splitArgs('a  b\tc'), ['a', 'b', 'c']);
  assert.deepEqual(splitArgs('--opt "값 안에 공백"'), ['--opt', '값 안에 공백']);
  assert.deepEqual(splitArgs("--opt '작은 따옴표'"), ['--opt', '작은 따옴표']);
  assert.deepEqual(splitArgs('--opt="따옴표=값"'), ['--opt=따옴표=값']);
  assert.deepEqual(splitArgs('   '), []);
  // 닫히지 않은 따옴표를 던지지는 않는다. 여기서 죽는 것보다 yt-dlp가 거부하는 편이 낫다.
  assert.deepEqual(splitArgs('--opt "안 닫힘'), ['--opt', '안 닫힘']);
});

// --- JavaScript 런타임 ---
//
// jsRuntimeArgs는 결과를 모듈 수준에 캐시하므로(바이너리 --help를 매번 부르지 않으려고)
// 설정별 동작은 프로세스를 나눠서 본다.

const { execFileSync } = require('node:child_process');

const runWith = (env) =>
  execFileSync(
    process.execPath,
    ['-e', `console.log(JSON.stringify(require(${JSON.stringify(path.join(__dirname, '..', 'src', 'youtube'))}).jsRuntimeArgs()))`],
    { env: { ...process.env, ...env }, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .pop();

test('YTDLP_JS_RUNTIME=off면 인자를 붙이지 않는다', () => {
  assert.deepEqual(JSON.parse(runWith({ YTDLP_JS_RUNTIME: 'off' })), []);
});

test('기본값은 지금 돌고 있는 Node를 물려준다', () => {
  // 런타임이 없으면 yt-dlp가 n 파라미터를 풀지 못해 IP에 묶인 URL을 받고, 그것이
  // 데이터센터에서 403으로 거부된다. 우리는 Node 위에서 도니 쓸 것이 이미 있다.
  const args = JSON.parse(runWith({ YTDLP_JS_RUNTIME: '' }));

  // 낡은 바이너리(--js-runtimes 모름)에서는 빈 배열이 정상이다. 그때는 검증할 것이 없다.
  if (args.length === 0) return;

  assert.equal(args[0], '--js-runtimes');
  assert.match(args[1], /^node:/);
  assert.ok(args[1].endsWith(process.execPath), `실행 중인 Node를 가리켜야 한다: ${args[1]}`);
});

test('YTDLP_JS_RUNTIME에 값을 주면 그대로 쓴다', () => {
  const args = JSON.parse(runWith({ YTDLP_JS_RUNTIME: 'deno' }));
  if (args.length === 0) return; // 지원하지 않는 바이너리
  assert.deepEqual(args, ['--js-runtimes', 'deno']);
});
