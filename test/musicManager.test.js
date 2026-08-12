// musicManager는 db.js를 require한다. 운영 DB를 건드리지 않도록 메모리 DB를 쓴다.
process.env.BOT_DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isBenignStreamError,
  LOOP_MODES,
  effectiveBitrate,
  getPlayer,
  getExistingPlayer,
  destroyAllPlayers,
} = require('../src/musicManager');
const { getGuildSettings, setLoopMode } = require('../src/db');

let counter = 0;
const nextGuild = () => `guild-${++counter}`;

test('의도적인 스트림 종료는 오류로 보지 않는다', () => {
  // 정지·건너뛰기의 정상 부산물이다. 여기서 false가 나오면 사용자에게
  // 고장이 난 것처럼 오류 메시지가 나간다.
  for (const code of ['ERR_STREAM_PREMATURE_CLOSE', 'EPIPE', 'ECONNRESET', 'ABORT_ERR']) {
    assert.ok(isBenignStreamError({ code }), `${code}를 걸러내지 못함`);
  }
});

test('진짜 오류는 걸러내지 않는다', () => {
  // 반대로 여기서 true가 나오면 실제 고장이 조용히 묻힌다.
  for (const code of ['ENOENT', 'EACCES', 'ERR_INVALID_URL', undefined]) {
    assert.ok(!isBenignStreamError({ code }), `${code}를 잘못 걸러냄`);
  }
});

test('에러가 아닌 값에도 터지지 않는다', () => {
  for (const input of [null, undefined, {}, '문자열']) {
    assert.equal(isBenignStreamError(input), false);
  }
});

test('반복 모드는 off/song/queue/last 네 가지다', () => {
  // /반복 명령어의 선택지와 DB의 loop_mode 값이 여기에 묶여 있다.
  assert.deepEqual(LOOP_MODES, ['off', 'song', 'queue', 'last']);
});

test('/반복 선택지가 LOOP_MODES와 정확히 일치한다', () => {
  // 모드를 추가하고 명령어 선택지를 빠뜨리면 사용자는 그 모드를 고를 수 없고,
  // 반대로 선택지만 있으면 setLoopMode가 예외를 던진다. 양쪽을 묶어둔다.
  const loopCommand = require('../src/commands/loop');
  const choices = loopCommand.data.toJSON().options[0].choices.map((c) => c.value);
  assert.deepEqual(choices, LOOP_MODES);
});

// 아래는 음성 연결 없이 확인할 수 있는 부분만 본다. 재생을 시작하면 yt-dlp를
// 띄우므로 enqueue는 건드리지 않는다.

test('getPlayer는 서버당 하나를 재사용하고 getExistingPlayer는 없으면 null이다', () => {
  const guildId = nextGuild();

  assert.equal(getExistingPlayer(guildId), null);

  const player = getPlayer(guildId);
  assert.equal(getPlayer(guildId), player, '같은 서버에는 같은 인스턴스를 줘야 한다');
  assert.equal(getExistingPlayer(guildId), player);

  player.destroy();
  assert.equal(getExistingPlayer(guildId), null, 'destroy 후에는 맵에서 빠져야 한다');
});

test('플레이어는 DB에 저장된 음량·반복 모드로 복원된다', () => {
  // 메모리와 DB 중 한쪽만 갱신하면 재시작 시 값이 되돌아간다.
  const guildId = nextGuild();
  setLoopMode(guildId, 'queue');

  const player = getPlayer(guildId);
  assert.equal(player.loopMode, 'queue');
  assert.equal(player.volume, getGuildSettings(guildId).volume);

  player.destroy();
});

test('setLoopMode는 메모리와 DB 양쪽에 쓴다', () => {
  const guildId = nextGuild();
  const player = getPlayer(guildId);

  player.setLoopMode('song');
  assert.equal(player.loopMode, 'song');
  assert.equal(getGuildSettings(guildId).loop_mode, 'song');

  assert.throws(() => player.setLoopMode('shuffle'), /알 수 없는 반복 모드/);
  assert.equal(player.loopMode, 'song', '거부된 값이 반영되면 안 된다');

  player.destroy();
});

test('queue/current는 TrackQueue를 그대로 비춘다', () => {
  // 명령어들이 player.queue와 player.current를 직접 읽는다.
  const guildId = nextGuild();
  const player = getPlayer(guildId);

  assert.deepEqual(player.queue, []);
  assert.equal(player.current, null);

  player.tracks.enqueue({ title: '1번', url: 'https://youtu.be/1' });
  assert.deepEqual(player.queue.map((t) => t.title), ['1번']);

  player.clearQueue();
  assert.deepEqual(player.queue, []);

  player.destroy();
});

test('destroyAllPlayers가 남은 플레이어를 모두 정리한다', () => {
  // 이걸 건너뛰면 봇이 음성 채널에 유령으로 남는다.
  const guilds = [nextGuild(), nextGuild()];
  for (const guildId of guilds) getPlayer(guildId);

  destroyAllPlayers();

  for (const guildId of guilds) {
    assert.equal(getExistingPlayer(guildId), null);
  }
});

test('MAX_OPUS_BITRATE가 없으면 채널 값을 그대로 쓴다', () => {
  // 상한을 두지 않는 것이 기본이어야 한다. 기본값을 깎으면 아무 설정도 안 한
  // 서버의 음질이 조용히 나빠진다.
  for (const bitrate of [8_000, 64_000, 96_000, 384_000]) {
    assert.equal(effectiveBitrate(bitrate, undefined), bitrate);
  }
});

test('MAX_OPUS_BITRATE는 kbps 단위로 상한을 건다', () => {
  assert.equal(effectiveBitrate(96_000, '64'), 64_000);
  assert.equal(effectiveBitrate(384_000, '48'), 48_000);

  // 채널이 이미 상한보다 낮으면 올리지 않는다. 상한이지 목표치가 아니다.
  assert.equal(effectiveBitrate(32_000, '64'), 32_000);

  // 경계값에서 깎이지 않아야 한다.
  assert.equal(effectiveBitrate(64_000, '64'), 64_000);
});

test('잘못된 MAX_OPUS_BITRATE는 무시하고 채널 값을 쓴다', () => {
  // 설정 실수로 재생이 막히는 것이 음질보다 나쁘다.
  for (const bad of ['', '   ', 'abc', '0', '-10', null]) {
    assert.equal(effectiveBitrate(96_000, bad), 96_000, `무시되지 않음: ${JSON.stringify(bad)}`);
  }
});
