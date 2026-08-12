const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { describeTrackError, isYoutubeUrl, cookieArgs } = require('../src/youtube');

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
