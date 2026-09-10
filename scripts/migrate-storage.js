#!/usr/bin/env node
// 두 저장 백엔드 사이에서 데이터를 옮긴다. 백엔드는 파일을 공유하지 않으므로,
// 그냥 갈아끼우면 플레이리스트와 서버 설정이 빈 상태로 시작한다.
//
//   node scripts/migrate-storage.js sqlite-to-json
//   node scripts/migrate-storage.js json-to-sqlite
//
// SQLite를 읽거나 쓰려면 Node 23.4 이상이 필요하다. 낮은 버전으로 옮겨 가기 전에
// **높은 버전이 있는 곳에서** sqlite-to-json을 먼저 돌려 data/bot.json을 만들고,
// 그 파일을 호스트에 올리는 순서가 된다.
//
// 대상 쪽에 이미 있는 서버·플레이리스트는 건너뛴다. 여러 번 돌려도 안전하다.

const directions = { 'sqlite-to-json': ['./dbSqlite', './dbJson'], 'json-to-sqlite': ['./dbJson', './dbSqlite'] };
const direction = process.argv[2];

if (!directions[direction]) {
  console.error(`사용법: node scripts/migrate-storage.js <${Object.keys(directions).join(' | ')}>`);
  process.exit(1);
}

const path = require('node:path');
const [fromPath, toPath] = directions[direction];

function open(modulePath) {
  try {
    return require(path.join(__dirname, '..', 'src', modulePath));
  } catch (error) {
    if (modulePath === './dbSqlite') {
      console.error(
        `SQLite를 열 수 없습니다. Node 23.4 이상이 필요합니다. 현재 버전: ${process.version}`
      );
      process.exit(1);
    }
    throw error;
  }
}

const from = open(fromPath);
const to = open(toPath);

// 원본을 훑는 방법이 백엔드마다 달라서 여기서만 내부를 들여다본다. 다른 곳에서는
// db.js만 보면 된다.
function readAll(store) {
  if (store.backend === 'sqlite') {
    return {
      guilds: store.db.prepare('SELECT * FROM guild_settings').all(),
      playlists: store.db.prepare('SELECT * FROM playlists ORDER BY id').all(),
    };
  }

  const fs = require('node:fs');
  const { jsonPath } = require(path.join(__dirname, '..', 'src', 'dbConstants'));
  const file = jsonPath();
  if (file === ':memory:' || !fs.existsSync(file)) return { guilds: [], playlists: [] };

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    guilds: Object.values(raw.guild_settings || {}),
    playlists: (raw.playlists || []).slice().sort((a, b) => a.id - b.id),
  };
}

const { guilds, playlists } = readAll(from);
let movedGuilds = 0;
let movedPlaylists = 0;
let movedTracks = 0;

for (const guild of guilds) {
  to.getGuildSettings(guild.guild_id);
  if (guild.text_channel_id) to.setTextChannel(guild.guild_id, guild.text_channel_id);
  to.setVolume(guild.guild_id, guild.volume);
  to.setLoopMode(guild.guild_id, guild.loop_mode);
  // 옛 DB에는 audio_quality가 없을 수 있다. 없으면 대상의 기본값을 그대로 둔다.
  if (guild.audio_quality) to.setAudioQuality(guild.guild_id, guild.audio_quality);
  movedGuilds += 1;
}

for (const playlist of playlists) {
  if (to.getPlaylist(playlist.guild_id, playlist.name)) {
    console.log(`건너뜀(이미 있음): ${playlist.guild_id} / ${playlist.name}`);
    continue;
  }

  to.createPlaylist(playlist.guild_id, playlist.name);
  const created = to.getPlaylist(playlist.guild_id, playlist.name);
  for (const track of from.getPlaylistTracks(playlist.id)) {
    to.addTrackToPlaylist(created.id, track.title, track.url);
    movedTracks += 1;
  }
  movedPlaylists += 1;
}

console.log(
  `옮겼습니다: 서버 설정 ${movedGuilds}개, 플레이리스트 ${movedPlaylists}개, 곡 ${movedTracks}개 ` +
    `(${from.backend} → ${to.backend})`
);
