const path = require('node:path');
const fs = require('node:fs');
// Node 내장 SQLite를 쓴다. better-sqlite3(네이티브 애드온)는 @discordjs/voice 0.19와
// 함께 로드될 때 프로세스가 SIGABRT로 죽는 충돌이 있어 사용하지 않는다.
const { DatabaseSync } = require('node:sqlite');

// 기본값은 data/bot.sqlite다. 테스트에서 운영 DB를 건드리지 않도록 BOT_DB_PATH로
// 경로를 바꿀 수 있게 열어뒀다. (테스트는 ':memory:'를 쓴다)
const dbPath = process.env.BOT_DB_PATH || path.join(__dirname, '..', 'data', 'bot.sqlite');

if (dbPath !== ':memory:') {
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

// 새 서버가 처음 재생할 때의 음량(%). 100은 대부분의 음성 채널에서 너무 컸다.
// DDL의 DEFAULT는 이미 만들어진 테이블에는 적용되지 않으므로, INSERT에서도 이 값을
// 명시적으로 넣는다. 그래야 기존 DB에 새로 들어온 서버도 같은 기본값을 받는다.
const DEFAULT_VOLUME = 15;

// 오디오 전달 방식.
//
// - normal   : 디코딩 → PCM → 재인코딩. 음량 조절과 비트레이트 제한이 가능하다.
// - original : 유튜브 Opus를 재인코딩 없이 그대로 흘려보낸다. 음질 손실과 CPU 사용이
//              줄어드는 대신 PCM을 거치지 않으므로 음량 조절이 불가능하다.
//
// /음질 명령어의 선택지가 이 목록에 묶여 있다. 값을 늘리면 quality.js도 같이 고쳐야 한다.
const AUDIO_QUALITY_MODES = ['normal', 'original'];
const DEFAULT_AUDIO_QUALITY = 'normal';

const db = new DatabaseSync(dbPath);
// 메모리 DB에는 저널 파일이 없으므로 WAL을 적용하지 않는다.
if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  text_channel_id TEXT,
  volume INTEGER NOT NULL DEFAULT ${DEFAULT_VOLUME},
  loop_mode TEXT NOT NULL DEFAULT 'off',
  audio_quality TEXT NOT NULL DEFAULT '${DEFAULT_AUDIO_QUALITY}'
);

CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE(guild_id, name)
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  position INTEGER NOT NULL,
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
);
`);

/**
 * 테이블에 칼럼이 없으면 추가한다.
 *
 * `CREATE TABLE IF NOT EXISTS`는 이미 있는 테이블을 건드리지 않으므로, DDL에 칼럼을
 * 늘려도 **기존 DB에는 반영되지 않는다.** data/bot.sqlite는 저장소에 없는 유일한 사본이라
 * 지우고 다시 만들 수도 없다. 그래서 새 칼럼은 여기서 따로 붙인다.
 *
 * NOT NULL 칼럼은 DEFAULT가 있어야 ALTER TABLE로 추가할 수 있다.
 */
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('guild_settings', 'audio_quality', `TEXT NOT NULL DEFAULT '${DEFAULT_AUDIO_QUALITY}'`);

function getGuildSettings(guildId) {
  let row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  if (!row) {
    db.prepare(
      'INSERT INTO guild_settings (guild_id, volume, audio_quality) VALUES (?, ?, ?)'
    ).run(guildId, DEFAULT_VOLUME, DEFAULT_AUDIO_QUALITY);
    row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  }
  return row;
}

function setTextChannel(guildId, channelId) {
  getGuildSettings(guildId);
  db.prepare('UPDATE guild_settings SET text_channel_id = ? WHERE guild_id = ?').run(channelId, guildId);
}

/** 음악 채널 지정을 해제한다. (모든 채널에서 음악 명령어 사용 가능한 초기 상태로 되돌린다) */
function clearTextChannel(guildId) {
  getGuildSettings(guildId);
  db.prepare('UPDATE guild_settings SET text_channel_id = NULL WHERE guild_id = ?').run(guildId);
}

function setVolume(guildId, volume) {
  getGuildSettings(guildId);
  db.prepare('UPDATE guild_settings SET volume = ? WHERE guild_id = ?').run(volume, guildId);
}

function setLoopMode(guildId, mode) {
  getGuildSettings(guildId);
  db.prepare('UPDATE guild_settings SET loop_mode = ? WHERE guild_id = ?').run(mode, guildId);
}

function setAudioQuality(guildId, quality) {
  if (!AUDIO_QUALITY_MODES.includes(quality)) {
    throw new Error(`알 수 없는 음질 모드: ${quality}`);
  }
  getGuildSettings(guildId);
  db.prepare('UPDATE guild_settings SET audio_quality = ? WHERE guild_id = ?').run(quality, guildId);
}

function createPlaylist(guildId, name) {
  return db.prepare('INSERT INTO playlists (guild_id, name) VALUES (?, ?)').run(guildId, name);
}

function getPlaylist(guildId, name) {
  return db.prepare('SELECT * FROM playlists WHERE guild_id = ? AND name = ?').get(guildId, name);
}

function listPlaylists(guildId) {
  return db.prepare('SELECT * FROM playlists WHERE guild_id = ? ORDER BY name').all(guildId);
}

function deletePlaylist(guildId, name) {
  const playlist = getPlaylist(guildId, name);
  if (!playlist) return false;
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlist.id);
  db.prepare('DELETE FROM playlists WHERE id = ?').run(playlist.id);
  return true;
}

function addTrackToPlaylist(playlistId, title, url) {
  // COUNT(*)가 아니라 MAX(position)+1을 쓴다. 곡 수와 position 최대값이 어긋난
  // 상태에서 COUNT를 쓰면 기존 곡과 position이 충돌한다.
  const { next } = db
    .prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM playlist_tracks WHERE playlist_id = ?')
    .get(playlistId);
  db.prepare(
    'INSERT INTO playlist_tracks (playlist_id, title, url, position) VALUES (?, ?, ?, ?)'
  ).run(playlistId, title, url, next);
}

/**
 * 곡을 지우고 남은 곡의 position을 0부터 다시 매긴다.
 *
 * 재정렬은 선택이 아니다. `/플레이리스트 목록`은 표시 순서(배열 인덱스)로 번호를
 * 매기는데 `/플레이리스트 곡삭제`는 position 값으로 지운다. 구멍이 남으면 둘이
 * 어긋나 사용자가 본 번호와 다른 곡이 지워진다.
 */
function removeTrackFromPlaylist(playlistId, position) {
  const result = db
    .prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND position = ?')
    .run(playlistId, position);

  if (result.changes > 0) {
    db.prepare(
      'UPDATE playlist_tracks SET position = position - 1 WHERE playlist_id = ? AND position > ?'
    ).run(playlistId, position);
  }

  return result;
}

function getPlaylistTracks(playlistId) {
  return db
    .prepare('SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position')
    .all(playlistId);
}

module.exports = {
  db,
  getGuildSettings,
  setTextChannel,
  clearTextChannel,
  DEFAULT_VOLUME,
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
};
