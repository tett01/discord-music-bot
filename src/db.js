const path = require('node:path');
const fs = require('node:fs');
// Node 내장 SQLite를 쓴다. better-sqlite3(네이티브 애드온)는 @discordjs/voice 0.19와
// 함께 로드될 때 프로세스가 SIGABRT로 죽는 충돌이 있어 사용하지 않는다.
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'bot.sqlite'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  text_channel_id TEXT,
  volume INTEGER NOT NULL DEFAULT 100,
  loop_mode TEXT NOT NULL DEFAULT 'off'
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

function getGuildSettings(guildId) {
  let row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  if (!row) {
    db.prepare('INSERT INTO guild_settings (guild_id) VALUES (?)').run(guildId);
    row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  }
  return row;
}

function setTextChannel(guildId, channelId) {
  getGuildSettings(guildId);
  db.prepare('UPDATE guild_settings SET text_channel_id = ? WHERE guild_id = ?').run(channelId, guildId);
}

function setVolume(guildId, volume) {
  getGuildSettings(guildId);
  db.prepare('UPDATE guild_settings SET volume = ? WHERE guild_id = ?').run(volume, guildId);
}

function setLoopMode(guildId, mode) {
  getGuildSettings(guildId);
  db.prepare('UPDATE guild_settings SET loop_mode = ? WHERE guild_id = ?').run(mode, guildId);
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
  const { count } = db
    .prepare('SELECT COUNT(*) AS count FROM playlist_tracks WHERE playlist_id = ?')
    .get(playlistId);
  db.prepare(
    'INSERT INTO playlist_tracks (playlist_id, title, url, position) VALUES (?, ?, ?, ?)'
  ).run(playlistId, title, url, count);
}

function removeTrackFromPlaylist(playlistId, position) {
  return db
    .prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND position = ?')
    .run(playlistId, position);
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
  setVolume,
  setLoopMode,
  createPlaylist,
  getPlaylist,
  listPlaylists,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  getPlaylistTracks,
};
