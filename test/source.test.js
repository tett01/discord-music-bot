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

// --- 조회 줄 세우기 -------------------------------------------------------
//
// 512MB 인스턴스에서 곡을 여러 개 한꺼번에 넣어도 죽지 않게 하는 장치다.
// 이 보장이 깨지면 대기열에 넣는 곡 수만큼 조회가 동시에 떠서 컨테이너가 죽는다.

const playdl = require('../src/playdl');
const { resolveTrack, parseLookupLimit, lookupState } = require('../src/source');

test('여러 곡을 한꺼번에 넣어도 조회는 동시에 하나만 돈다', async (t) => {
  withEngine(t, 'playdl');

  const originalResolve = playdl.resolveTrack;
  t.after(() => {
    playdl.resolveTrack = originalResolve;
  });

  let running = 0;
  let peak = 0;
  const finished = [];

  playdl.resolveTrack = async (query) => {
    running += 1;
    peak = Math.max(peak, running);
    // 실제 조회처럼 한 틱 이상 걸리게 해서 겹칠 기회를 준다.
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    finished.push(query);
    return { title: query, url: `https://youtu.be/${query}`, duration: 1, thumbnail: null };
  };

  const queries = ['a', 'b', 'c', 'd', 'e'];
  const tracks = await Promise.all(queries.map((query) => resolveTrack(query)));

  assert.equal(peak, 1, '조회가 병렬로 떴다 — 곡을 여러 개 넣으면 메모리가 터진다');
  assert.deepEqual(finished, queries, '요청 순서대로 처리되어야 한다');
  assert.deepEqual(tracks.map((track) => track.title), queries);
  // 다 끝난 뒤에는 슬롯이 남지 않아야 한다. 새면 다음 조회가 영영 막힌다.
  assert.deepEqual(lookupState(), { limit: 1, active: 0, waiting: 0 });
});

test('조회가 실패해도 슬롯을 놓는다', async (t) => {
  withEngine(t, 'playdl');

  const originalResolve = playdl.resolveTrack;
  t.after(() => {
    playdl.resolveTrack = originalResolve;
  });

  playdl.resolveTrack = async () => {
    throw new Error('찾을 수 없습니다');
  };

  await assert.rejects(() => resolveTrack('없는 곡'));
  // 여기서 새면 대기열이 통째로 멈춘다. 크래시보다 알아채기 어려운 고장이다.
  assert.deepEqual(lookupState(), { limit: 1, active: 0, waiting: 0 });
});

test('SOURCE_LOOKUP_LIMIT의 잘못된 값은 예외 없이 기본값으로 떨어진다', () => {
  assert.equal(parseLookupLimit(undefined), 1);
  assert.equal(parseLookupLimit(''), 1);
  assert.equal(parseLookupLimit('0'), 1);
  assert.equal(parseLookupLimit('-3'), 1);
  assert.equal(parseLookupLimit('많이'), 1);
  assert.equal(parseLookupLimit('99'), 1, '상한을 넘는 값도 기본값으로 떨어져야 한다');
  // 정상 범위는 그대로 쓴다.
  assert.equal(parseLookupLimit('2'), 2);
  assert.equal(parseLookupLimit(' 3 '), 3);
});
