// musicManager는 db.js를 require한다. 운영 DB를 건드리지 않도록 메모리 DB를 쓴다.
process.env.BOT_DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

// ⚠️ musicManager보다 **먼저** source의 openSource를 갈아끼운다. musicManager가
// require 시점에 구조분해로 집어가므로, 나중에 바꾸면 반영되지 않는다.
const source = require('../src/source');
const realOpenSource = source.openSource;

/** @type {Array<{track: object, resolve: Function, reject: Function}>} */
let pending = [];
source.openSource = (track) =>
  new Promise((resolve, reject) => {
    pending.push({ track, resolve, reject });
  });

const { getPlayer, destroyAllPlayers } = require('../src/musicManager');

test.after(() => {
  source.openSource = realOpenSource;
  destroyAllPlayers();
});

/** 실제 재생 없이 handle만 흉내 낸다. 닫혔는지 확인할 수 있게 표를 남긴다. */
function fakeHandle() {
  const stream = Readable.from([]);
  const handle = { kind: 'stream', type: 'webm/opus', stream, closed: false };
  stream.destroy = () => {
    handle.closed = true;
  };
  return handle;
}

function newPlayer(guildId) {
  const player = getPlayer(guildId, null);
  player.played = [];
  player.audioPlayer.play = (resource) => player.played.push(resource);
  return player;
}

test('스트림을 여는 동안 다음 곡이 시작되면 늦게 열린 소스는 재생하지 않는다', async () => {
  pending = [];
  const player = newPlayer('race-1');

  const first = player._play({ title: 'A', url: 'a' }, true);
  const second = player._play({ title: 'B', url: 'b' }, true);
  assert.equal(pending.length, 2);

  // B가 먼저 열리고, 뒤늦게 A가 열린다. (yt-dlp 응답 시간은 곡마다 다르다)
  const handleB = fakeHandle();
  const handleA = fakeHandle();
  pending[1].resolve(handleB);
  pending[0].resolve(handleA);
  await Promise.all([first, second]);

  // A가 audioPlayer.play를 다시 부르면 이미 지나간 곡이 잠깐 재생된다.
  assert.equal(player.played.length, 1);
  assert.equal(player.source, handleB);
  // 버려진 소스를 닫지 않으면 yt-dlp가 살아남는다.
  assert.equal(handleA.closed, true);

  player.destroy();
});

test('정지한 뒤에 열린 소스는 재생을 되살리지 않는다', async () => {
  pending = [];
  const player = newPlayer('race-2');

  const playing = player._play({ title: 'A', url: 'a' }, true);
  player.destroy();

  const handle = fakeHandle();
  pending[0].resolve(handle);
  await playing;

  assert.equal(player.played.length, 0);
  assert.equal(player.source, null);
  assert.equal(handle.closed, true);
});

test('스트림 열기에 실패해도 자기 차례가 아니면 대기열을 넘기지 않는다', async () => {
  pending = [];
  const player = newPlayer('race-3');
  let advanced = 0;
  player._playNext = async () => {
    advanced += 1;
  };

  const first = player._play({ title: 'A', url: 'a' }, true);
  const second = player._play({ title: 'B', url: 'b' }, true);

  pending[1].resolve(fakeHandle());
  pending[0].reject(new Error('boom'));
  await Promise.all([first, second]);

  // A의 실패로 B를 건너뛰면 사용자가 방금 튼 곡이 사라진다.
  assert.equal(advanced, 0);
  assert.equal(player.played.length, 1);

  player.destroy();
});
