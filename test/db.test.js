// db.js는 require 시점에 DB를 여는 부작용이 있다. 운영 DB(data/bot.sqlite)를
// 건드리지 않도록 require 전에 메모리 DB로 지정한다.
process.env.BOT_DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_VOLUME,
  getGuildSettings,
  setTextChannel,
  clearTextChannel,
  AUDIO_QUALITY_MODES,
  DEFAULT_AUDIO_QUALITY,
  setVolume,
  setLoopMode,
  setAudioQuality,
  createPlaylist,
  getPlaylist,
  listPlaylists,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  getPlaylistTracks,
} = require('../src/db');

// 같은 메모리 DB를 공유하므로 테스트마다 다른 길드 ID를 쓴다.
let counter = 0;
const nextGuild = () => `guild-${++counter}`;

function seed(guildId, name, titles) {
  createPlaylist(guildId, name);
  const playlist = getPlaylist(guildId, name);
  for (const title of titles) addTrackToPlaylist(playlist.id, title, `https://youtu.be/${title}`);
  return playlist;
}

const titlesOf = (playlistId) => getPlaylistTracks(playlistId).map((t) => t.title);
const positionsOf = (playlistId) => getPlaylistTracks(playlistId).map((t) => t.position);

test('길드 설정은 기본값으로 생성된다', () => {
  const settings = getGuildSettings(nextGuild());
  assert.equal(settings.volume, DEFAULT_VOLUME);
  assert.equal(settings.loop_mode, 'off');
  assert.equal(settings.text_channel_id, null);
  assert.equal(settings.audio_quality, DEFAULT_AUDIO_QUALITY);
});

test('기본 음질 모드는 일반이다', () => {
  // 원음은 음량 조절을 포기하는 선택이라 기본값이 될 수 없다. 새 서버가 조용히
  // /음량이 안 듣는 상태로 시작하면 고장으로 오해한다.
  assert.equal(DEFAULT_AUDIO_QUALITY, 'normal');
  assert.equal(getGuildSettings(nextGuild()).audio_quality, 'normal');
});

test('setAudioQuality는 아는 모드만 받는다', () => {
  const guildId = nextGuild();

  for (const mode of AUDIO_QUALITY_MODES) {
    setAudioQuality(guildId, mode);
    assert.equal(getGuildSettings(guildId).audio_quality, mode);
  }

  // 검증이 없으면 DB에 들어간 쓰레기 값이 다음 재생 때 터진다.
  assert.throws(() => setAudioQuality(guildId, 'flac'), /알 수 없는 음질 모드/);
  assert.equal(getGuildSettings(guildId).audio_quality, 'original', '실패한 쓰기가 남으면 안 된다');
});

test('기본 음량은 15다', () => {
  // DDL의 DEFAULT는 이미 만들어진 테이블에 적용되지 않으므로, INSERT가 값을 직접
  // 넣지 않으면 기존 DB에서만 조용히 옛 기본값이 나온다. 상수를 고정해둔다.
  assert.equal(DEFAULT_VOLUME, 15);
  assert.equal(getGuildSettings(nextGuild()).volume, 15);
});

test('음악 채널 지정과 해제', () => {
  const guildId = nextGuild();

  setTextChannel(guildId, 'channel-1');
  assert.equal(getGuildSettings(guildId).text_channel_id, 'channel-1');

  // 제한의 켜짐/꺼짐은 NULL 여부로만 판별한다. 빈 문자열이 남으면 제한이 계속 걸린다.
  clearTextChannel(guildId);
  assert.equal(getGuildSettings(guildId).text_channel_id, null);
});

test('음량과 반복 모드가 저장된다', () => {
  const guildId = nextGuild();
  setVolume(guildId, 42);
  setLoopMode(guildId, 'queue');

  const settings = getGuildSettings(guildId);
  assert.equal(settings.volume, 42);
  assert.equal(settings.loop_mode, 'queue');
});

test('플레이리스트 생성·조회·삭제', () => {
  const guildId = nextGuild();
  seed(guildId, '출근길', ['a', 'b']);
  createPlaylist(guildId, '잠들기전');

  assert.deepEqual(listPlaylists(guildId).map((p) => p.name), ['잠들기전', '출근길']);
  assert.equal(deletePlaylist(guildId, '출근길'), true);
  assert.equal(deletePlaylist(guildId, '없는거'), false);
  assert.deepEqual(listPlaylists(guildId).map((p) => p.name), ['잠들기전']);
});

test('플레이리스트는 서버별로 분리된다', () => {
  const a = nextGuild();
  const b = nextGuild();
  seed(a, '같은이름', ['a곡']);
  seed(b, '같은이름', ['b곡']);

  assert.deepEqual(titlesOf(getPlaylist(a, '같은이름').id), ['a곡']);
  assert.deepEqual(titlesOf(getPlaylist(b, '같은이름').id), ['b곡']);
});

test('곡은 추가한 순서대로 0부터 번호가 붙는다', () => {
  const playlist = seed(nextGuild(), '순서', ['1번', '2번', '3번']);
  assert.deepEqual(positionsOf(playlist.id), [0, 1, 2]);
  assert.deepEqual(titlesOf(playlist.id), ['1번', '2번', '3번']);
});

test('가운데 곡을 지우면 남은 곡의 번호가 다시 매겨진다', () => {
  // 회귀 테스트. 재정렬이 없으면 position에 구멍이 남는데,
  // /플레이리스트 목록은 표시 순서로 번호를 매기고 /곡삭제는 position으로 지우므로
  // 사용자가 본 번호와 다른 곡이 지워진다.
  const playlist = seed(nextGuild(), '재정렬', ['1번', '2번', '3번', '4번']);

  removeTrackFromPlaylist(playlist.id, 1); // 사용자에게는 2번 곡
  assert.deepEqual(titlesOf(playlist.id), ['1번', '3번', '4번']);
  assert.deepEqual(positionsOf(playlist.id), [0, 1, 2], 'position에 구멍이 남았다');

  // 이제 "3번 곡"은 목록에서 3번째인 4번이어야 한다.
  removeTrackFromPlaylist(playlist.id, 2);
  assert.deepEqual(titlesOf(playlist.id), ['1번', '3번']);
});

test('삭제 후 추가해도 번호가 충돌하지 않는다', () => {
  // addTrackToPlaylist가 COUNT(*)로 다음 번호를 정하면 여기서 중복이 생긴다.
  const playlist = seed(nextGuild(), '충돌', ['1번', '2번', '3번']);

  removeTrackFromPlaylist(playlist.id, 0);
  addTrackToPlaylist(playlist.id, '4번', 'https://youtu.be/4');

  const positions = positionsOf(playlist.id);
  assert.equal(new Set(positions).size, positions.length, `position 중복: ${positions.join(', ')}`);
  assert.deepEqual(positions, [0, 1, 2]);
  assert.deepEqual(titlesOf(playlist.id), ['2번', '3번', '4번']);
});

test('없는 번호를 지우면 아무것도 바뀌지 않는다', () => {
  const playlist = seed(nextGuild(), '범위밖', ['1번', '2번']);

  // playlist.js는 changes === 0을 "해당 번호의 곡을 찾을 수 없습니다"로 안내한다.
  for (const position of [2, 99, -1]) {
    assert.equal(removeTrackFromPlaylist(playlist.id, position).changes, 0);
  }
  assert.deepEqual(titlesOf(playlist.id), ['1번', '2번']);
});

test('빈 플레이리스트에서 지워도 터지지 않는다', () => {
  const playlist = seed(nextGuild(), '빈것', []);
  assert.equal(removeTrackFromPlaylist(playlist.id, 0).changes, 0);
  assert.deepEqual(getPlaylistTracks(playlist.id), []);
});

test('플레이리스트를 지우면 곡도 함께 지워진다', () => {
  const guildId = nextGuild();
  const playlist = seed(guildId, '통삭제', ['1번', '2번']);

  deletePlaylist(guildId, '통삭제');
  assert.deepEqual(getPlaylistTracks(playlist.id), []);
});
