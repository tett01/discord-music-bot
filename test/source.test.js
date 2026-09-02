const test = require('node:test');
const assert = require('node:assert/strict');

const { engineOrder, selectedEngine, isVideoLevelFailure, AUDIO_ENGINES } = require('../src/source');

function withEngine(t, value) {
  const previous = process.env.AUDIO_ENGINE;
  t.after(() => {
    if (previous === undefined) delete process.env.AUDIO_ENGINE;
    else process.env.AUDIO_ENGINE = previous;
  });
  if (value === undefined) delete process.env.AUDIO_ENGINE;
  else process.env.AUDIO_ENGINE = value;
}

test('기본값은 auto이고 play-dl을 먼저 시도한다', (t) => {
  withEngine(t, undefined);
  assert.equal(selectedEngine(), 'auto');
  // 순서가 뒤집히면 무료 호스팅에서 굳이 무거운 yt-dlp가 먼저 돈다.
  assert.deepEqual(engineOrder(), ['playdl', 'ytdlp']);
});

test('AUDIO_ENGINE으로 한쪽만 강제할 수 있다', (t) => {
  withEngine(t, 'playdl');
  assert.deepEqual(engineOrder(), ['playdl']);

  process.env.AUDIO_ENGINE = 'ytdlp';
  assert.deepEqual(engineOrder(), ['ytdlp']);

  // 대소문자와 공백은 흘려 준다.
  process.env.AUDIO_ENGINE = '  YTDLP ';
  assert.deepEqual(engineOrder(), ['ytdlp']);
});

test('알 수 없는 값은 auto로 떨어진다', (t) => {
  withEngine(t, 'ytdl-core');
  // 오타 하나로 재생이 통째로 막히면 안 된다.
  assert.equal(selectedEngine(), 'auto');
  assert.deepEqual(engineOrder(), ['playdl', 'ytdlp']);
});

test('AUDIO_ENGINES 목록과 engineOrder가 어긋나지 않는다', () => {
  for (const engine of AUDIO_ENGINES) {
    const order = engineOrder(engine);
    assert.ok(order.length > 0, `${engine}: 시도할 엔진이 없음`);
    for (const item of order) {
      assert.ok(['playdl', 'ytdlp'].includes(item), `${engine}: 알 수 없는 엔진 ${item}`);
    }
  }
});

test('영상 자체의 제약은 폴백하지 않는다', () => {
  // 엔진을 바꿔도 결과가 같은 사유들이다. 여기서 false가 나오면 실패할 것이 뻔한
  // 두 번째 조회를 기다리느라 응답이 두 배로 느려진다.
  const samples = [
    'ERROR: Sign in to confirm your age',
    'ERROR: Join this channel to get access to members-only content',
    'ERROR: Private video',
    'ERROR: The uploader has not made this video available in your country',
    'ERROR: This video has been removed by the uploader',
  ];
  for (const message of samples) {
    assert.ok(isVideoLevelFailure(new Error(message)), `폴백을 건너뛰지 못함: ${message}`);
  }
});

test('엔진 문제로 보이는 실패는 폴백한다', () => {
  // 반대로 여기서 true가 나오면 폴백 엔진이 있어도 쓰이지 않는다.
  const samples = [
    "ERROR: Sign in to confirm you're not a bot",
    'While getting info from url',
    'Got error while parsing',
    'yt-dlp 응답 시간 초과',
    'ERROR: unable to extract player response',
  ];
  for (const message of samples) {
    assert.ok(!isVideoLevelFailure(new Error(message)), `폴백을 건너뛰어 버림: ${message}`);
  }
});

test('message가 없는 값에도 터지지 않는다', () => {
  for (const input of [null, undefined, {}, '문자열', 0]) {
    assert.equal(isVideoLevelFailure(input), false);
  }
});
