const test = require('node:test');
const assert = require('node:assert/strict');

const { TrackQueue, LOOP_MODES } = require('../src/trackQueue');

const track = (title) => ({ title, url: `https://youtu.be/${title}` });

/** 곡을 채운 큐를 만들고 첫 곡을 재생 중인 상태로 만든다. */
function playing(loopMode, titles) {
  const queue = new TrackQueue(loopMode);
  for (const title of titles) queue.enqueue(track(title));
  queue.advance(); // 첫 곡 재생 시작
  return queue;
}

const titleOf = (t) => t?.title ?? null;
const upcoming = (queue) => queue.tracks.map((t) => t.title);

test('반복 모드는 off/song/queue 세 가지다', () => {
  assert.deepEqual(LOOP_MODES, ['off', 'song', 'queue']);
  assert.equal(new TrackQueue().loopMode, 'off');
  assert.equal(new TrackQueue('이상한값').loopMode, 'off', 'DB에 이상한 값이 있어도 off로 떨어져야 한다');
});

test('알 수 없는 반복 모드는 거부한다', () => {
  const queue = new TrackQueue();
  assert.throws(() => queue.setLoopMode('shuffle'), /알 수 없는 반복 모드/);
  assert.equal(queue.loopMode, 'off');
});

test('빈 큐에서는 재생할 곡이 없다', () => {
  const queue = new TrackQueue();
  assert.equal(queue.advance(), null);
  assert.equal(queue.current, null);
  assert.ok(queue.isEmpty);
});

test('off: 추가한 순서대로 재생하고 끝나면 멈춘다', () => {
  const queue = playing('off', ['1번', '2번', '3번']);

  assert.equal(titleOf(queue.current), '1번');
  assert.equal(titleOf(queue.advance()), '2번');
  assert.equal(titleOf(queue.advance()), '3번');
  assert.equal(queue.advance(), null, '대기열이 비면 null이어야 한다');
  assert.equal(queue.current, null);
  assert.ok(queue.isEmpty);
});

test('song: 자연 종료하면 같은 곡을 다시 재생한다', () => {
  const queue = playing('song', ['1번', '2번']);

  for (let i = 0; i < 3; i++) {
    assert.equal(titleOf(queue.advance()), '1번', `${i + 1}번째 반복`);
  }
  assert.deepEqual(upcoming(queue), ['2번'], '대기열은 그대로 남아 있어야 한다');
});

test('song: 건너뛰기는 반복을 무시하고 다음 곡으로 간다', () => {
  // 회귀 테스트. _forceSkip이 없으면 /다음곡이 같은 곡을 다시 재생한다.
  const queue = playing('song', ['1번', '2번']);

  queue.requestSkip();
  assert.equal(titleOf(queue.advance()), '2번');
});

test('song: 건너뛰기 표시는 한 번만 쓰인다', () => {
  // 표시가 남아 있으면 이후 자연 종료에도 반복이 안 걸린다.
  const queue = playing('song', ['1번', '2번', '3번']);

  queue.requestSkip();
  assert.equal(titleOf(queue.advance()), '2번');
  assert.equal(titleOf(queue.advance()), '2번', '건너뛴 다음 곡은 다시 반복되어야 한다');
  assert.deepEqual(upcoming(queue), ['3번']);
});

test('song: 마지막 곡을 건너뛰면 멈춘다', () => {
  const queue = playing('song', ['1번']);

  queue.requestSkip();
  assert.equal(queue.advance(), null);
  assert.equal(queue.current, null);
});

test('queue: 마지막 곡 뒤에 처음으로 돌아온다', () => {
  const queue = playing('queue', ['1번', '2번', '3번']);

  assert.equal(titleOf(queue.advance()), '2번');
  assert.equal(titleOf(queue.advance()), '3번');
  assert.equal(titleOf(queue.advance()), '1번', '한 바퀴 돌아 처음으로 와야 한다');
  assert.equal(titleOf(queue.advance()), '2번');
});

test('queue: 곡이 하나면 그 곡을 계속 재생한다', () => {
  const queue = playing('queue', ['혼자']);

  for (let i = 0; i < 3; i++) {
    assert.equal(titleOf(queue.advance()), '혼자', `${i + 1}번째 순환`);
  }
});

test('queue: 건너뛴 곡도 대기열 뒤로 돌아간다', () => {
  const queue = playing('queue', ['1번', '2번']);

  queue.requestSkip();
  assert.equal(titleOf(queue.advance()), '2번');
  assert.deepEqual(upcoming(queue), ['1번'], '건너뛴 곡이 사라지면 안 된다');
});

test('재생 중 반복 모드를 바꾸면 다음 곡부터 적용된다', () => {
  const queue = playing('off', ['1번', '2번']);

  queue.setLoopMode('song');
  assert.equal(titleOf(queue.advance()), '1번');

  queue.setLoopMode('off');
  assert.equal(titleOf(queue.advance()), '2번');
});

test('재생 중에 추가한 곡은 대기열 뒤에 붙는다', () => {
  const queue = playing('off', ['1번']);

  queue.enqueue(track('2번'));
  queue.enqueue(track('3번'));
  assert.equal(queue.size, 2);
  assert.equal(titleOf(queue.advance()), '2번');
});

test('clear는 대기열만 비우고 재생 중인 곡은 남긴다', () => {
  const queue = playing('off', ['1번', '2번', '3번']);

  queue.clear();
  assert.equal(titleOf(queue.current), '1번');
  assert.equal(queue.size, 0);
  assert.ok(!queue.isEmpty, '재생 중인 곡이 있으면 비어 있지 않다');
});

test('reset은 재생 상태까지 모두 지운다', () => {
  const queue = playing('song', ['1번', '2번']);
  queue.requestSkip();

  queue.reset();
  assert.ok(queue.isEmpty);
  assert.equal(queue.current, null);
  assert.equal(queue.size, 0);

  // 건너뛰기 표시도 지워져야 다음 재생이 정상 동작한다.
  queue.enqueue(track('새곡'));
  assert.equal(titleOf(queue.advance()), '새곡');
  assert.equal(titleOf(queue.advance()), '새곡', 'song 모드가 그대로 살아 있어야 한다');
});
