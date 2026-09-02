const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { normalizeCookie, readConfiguredCookie, qualityLevel } = require('../src/playdl');

// 환경변수를 건드리는 테스트가 서로 새지 않게 한다.
const COOKIE_KEYS = ['YOUTUBE_COOKIE', 'YOUTUBE_COOKIE_FILE', 'YTDLP_COOKIES'];
function isolateEnv(t, keys) {
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  t.after(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

test('헤더 형식 쿠키는 그대로 쓴다', () => {
  assert.equal(normalizeCookie('SID=abc; HSID=def'), 'SID=abc; HSID=def');
  // 브라우저에서 복사하면 "Cookie: " 접두사가 딸려 오는 일이 잦다.
  assert.equal(normalizeCookie('Cookie: SID=abc; HSID=def'), 'SID=abc; HSID=def');
  // 여러 줄로 붙여 넣어도 한 줄로 만든다. 줄바꿈이 남으면 헤더가 깨진다.
  assert.equal(normalizeCookie('SID=abc;\n  HSID=def'), 'SID=abc; HSID=def');
});

test('Netscape cookies.txt를 헤더 문자열로 바꾼다', () => {
  // yt-dlp용 쿠키 파일 하나로 play-dl까지 먹이기 위한 변환이다.
  // 여기가 깨지면 폴백 엔진으로 넘어갔을 때 쿠키가 없어 똑같이 차단당한다.
  const netscape = [
    '# Netscape HTTP Cookie File',
    '# This is a generated file!  Do not edit.',
    '.youtube.com\tTRUE\t/\tTRUE\t1799999999\tSID\tabc123',
    '.youtube.com\tTRUE\t/\tTRUE\t1799999999\tHSID\tdef456',
  ].join('\n');

  assert.equal(normalizeCookie(netscape), 'SID=abc123; HSID=def456');
});

test('빈 값과 주석뿐인 파일은 빈 문자열이 된다', () => {
  for (const input of ['', '   ', null, undefined, '# Netscape HTTP Cookie File\n']) {
    assert.equal(normalizeCookie(input), '');
  }
});

test('쿠키 우선순위는 인라인 → 전용 파일 → yt-dlp 파일 순이다', (t) => {
  isolateEnv(t, COOKIE_KEYS);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playdl-cookie-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const dedicated = path.join(dir, 'youtube.txt');
  const shared = path.join(dir, 'cookies.txt');
  fs.writeFileSync(dedicated, 'SID=dedicated');
  fs.writeFileSync(shared, '.youtube.com\tTRUE\t/\tTRUE\t1799999999\tSID\tshared\n');

  process.env.YTDLP_COOKIES = shared;
  assert.equal(readConfiguredCookie(), 'SID=shared');

  process.env.YOUTUBE_COOKIE_FILE = dedicated;
  assert.equal(readConfiguredCookie(), 'SID=dedicated');

  process.env.YOUTUBE_COOKIE = 'SID=inline';
  assert.equal(readConfiguredCookie(), 'SID=inline');
});

test('쿠키가 없거나 파일 경로가 틀리면 빈 문자열로 떨어진다', (t) => {
  isolateEnv(t, COOKIE_KEYS);

  // 여기서 예외를 던지면 쿠키 설정 실수 하나로 봇이 뜨지 않는다.
  assert.equal(readConfiguredCookie(), '');

  process.env.YOUTUBE_COOKIE_FILE = path.join(os.tmpdir(), '없는-쿠키-파일.txt');
  assert.equal(readConfiguredCookie(), '');
});

test('PLAYDL_QUALITY는 0~2만 받고 나머지는 기본값 2로 떨어진다', (t) => {
  isolateEnv(t, ['PLAYDL_QUALITY']);

  assert.equal(qualityLevel(), 2);

  for (const [value, expected] of [['0', 0], ['1', 1], ['2', 2]]) {
    process.env.PLAYDL_QUALITY = value;
    assert.equal(qualityLevel(), expected);
  }

  // 잘못된 값 때문에 play-dl이 예외를 던지면 재생 자체가 막힌다.
  for (const value of ['3', '-1', 'high', '', '  ']) {
    process.env.PLAYDL_QUALITY = value;
    assert.equal(qualityLevel(), 2, `잘못된 값 '${value}'가 기본값으로 떨어지지 않음`);
  }
});
