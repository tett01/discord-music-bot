// JSON 파일 백엔드. node:sqlite를 쓸 수 없는 Node(23.4 미만)에서 dbSqlite.js 대신 쓴다.
//
// 무료 호스팅 패널의 Node 이미지가 대개 22에서 멈춰 있어, SQLite만 지원하면 봇이 아예
// 뜨지 않는다. 저장하는 것이 서버 설정 몇 개와 플레이리스트뿐이라 파일 하나로 충분하다.
//
// **dbSqlite.js와 내보내는 함수의 이름·인자·반환 모양이 정확히 같아야 한다.** 명령어들은
// db.js만 보고 어느 백엔드가 붙었는지 모른 채 호출한다. test/db.test.js가 두 백엔드에
// 같은 검증을 돌려 이 계약을 지킨다.
const path = require('node:path');
const fs = require('node:fs');
const {
  DEFAULT_VOLUME,
  AUDIO_QUALITY_MODES,
  DEFAULT_AUDIO_QUALITY,
  jsonPath,
} = require('./dbConstants');

const filePath = jsonPath();
const inMemory = filePath === ':memory:';

function emptyStore() {
  return {
    version: 1,
    guild_settings: {},
    playlists: [],
    playlist_tracks: [],
    next_playlist_id: 1,
    next_track_id: 1,
  };
}

function load() {
  if (inMemory) return emptyStore();
  if (!fs.existsSync(filePath)) return emptyStore();

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    // 필드가 빠진 파일을 만나도 뜨는 것이 우선이다. 없는 것만 기본값으로 채운다.
    return { ...emptyStore(), ...parsed };
  } catch (error) {
    // 여기서 던지면 봇이 부팅조차 못 한다. 깨진 파일은 옆으로 치우고 빈 상태로 시작한다.
    const broken = `${filePath}.broken-${Date.now()}`;
    console.error(`[db] ${filePath}를 읽지 못했습니다. ${broken}로 옮기고 새로 시작합니다.`, error);
    try {
      fs.renameSync(filePath, broken);
    } catch {
      // 옮기지 못해도 계속 간다. 어차피 다음 쓰기가 덮어쓴다.
    }
    return emptyStore();
  }
}

const store = load();

/**
 * 파일에 쓴다. 임시 파일에 쓴 뒤 rename으로 갈아끼운다 —
 * 쓰는 도중 프로세스가 죽어도 반쯤 잘린 JSON이 남지 않는다.
 */
function persist() {
  if (inMemory) return;

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, filePath);
}

/** 호출자가 반환값을 고쳐도 저장소가 바뀌지 않도록 복사해서 준다. (SQLite는 매번 새 행을 준다) */
const copy = (row) => (row ? { ...row } : row);

function getGuildSettings(guildId) {
  let row = store.guild_settings[guildId];
  if (!row) {
    row = {
      guild_id: guildId,
      text_channel_id: null,
      volume: DEFAULT_VOLUME,
      loop_mode: 'off',
      audio_quality: DEFAULT_AUDIO_QUALITY,
    };
    store.guild_settings[guildId] = row;
    persist();
  }
  return copy(row);
}

function updateGuild(guildId, patch) {
  getGuildSettings(guildId);
  Object.assign(store.guild_settings[guildId], patch);
  persist();
}

function setTextChannel(guildId, channelId) {
  updateGuild(guildId, { text_channel_id: channelId });
}

/** 음악 채널 지정을 해제한다. (모든 채널에서 음악 명령어 사용 가능한 초기 상태로 되돌린다) */
function clearTextChannel(guildId) {
  // 제한의 켜짐/꺼짐은 null 여부로만 판별한다. 빈 문자열을 넣으면 제한이 계속 걸린다.
  updateGuild(guildId, { text_channel_id: null });
}

function setVolume(guildId, volume) {
  updateGuild(guildId, { volume });
}

function setLoopMode(guildId, mode) {
  updateGuild(guildId, { loop_mode: mode });
}

function setAudioQuality(guildId, quality) {
  if (!AUDIO_QUALITY_MODES.includes(quality)) {
    throw new Error(`알 수 없는 음질 모드: ${quality}`);
  }
  updateGuild(guildId, { audio_quality: quality });
}

function createPlaylist(guildId, name) {
  // SQLite의 UNIQUE(guild_id, name)를 대신한다. playlist.js가 이 예외를 잡아
  // "이미 존재하는 플레이리스트입니다"로 안내하므로 조용히 넘기면 안 된다.
  if (store.playlists.some((p) => p.guild_id === guildId && p.name === name)) {
    throw new Error(`이미 존재하는 플레이리스트입니다: ${name}`);
  }

  const id = store.next_playlist_id++;
  store.playlists.push({ id, guild_id: guildId, name });
  persist();
  return { changes: 1, lastInsertRowid: id };
}

function getPlaylist(guildId, name) {
  return copy(store.playlists.find((p) => p.guild_id === guildId && p.name === name));
}

function listPlaylists(guildId) {
  return store.playlists
    .filter((p) => p.guild_id === guildId)
    // SQLite의 ORDER BY name과 맞추려면 코드 포인트 순으로 비교해야 한다.
    // localeCompare는 로캘에 따라 순서가 달라져 백엔드마다 목록이 뒤바뀐다.
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(copy);
}

function deletePlaylist(guildId, name) {
  const index = store.playlists.findIndex((p) => p.guild_id === guildId && p.name === name);
  if (index === -1) return false;

  const [playlist] = store.playlists.splice(index, 1);
  // SQLite 쪽 ON DELETE CASCADE를 손으로 한다. 남겨두면 지운 플레이리스트의 곡이
  // 파일에 계속 쌓인다.
  store.playlist_tracks = store.playlist_tracks.filter((t) => t.playlist_id !== playlist.id);
  persist();
  return true;
}

function tracksOf(playlistId) {
  return store.playlist_tracks
    .filter((t) => t.playlist_id === playlistId)
    .sort((a, b) => a.position - b.position);
}

function addTrackToPlaylist(playlistId, title, url) {
  // 곡 수가 아니라 position 최대값 + 1을 쓴다. 둘이 어긋난 상태에서 곡 수를 쓰면
  // 기존 곡과 position이 충돌한다.
  const positions = tracksOf(playlistId).map((t) => t.position);
  const next = positions.length ? Math.max(...positions) + 1 : 0;

  store.playlist_tracks.push({
    id: store.next_track_id++,
    playlist_id: playlistId,
    title,
    url,
    position: next,
  });
  persist();
}

/**
 * 곡을 지우고 남은 곡의 position을 0부터 다시 매긴다.
 *
 * 재정렬은 선택이 아니다. `/플레이리스트 목록`은 표시 순서(배열 인덱스)로 번호를
 * 매기는데 `/플레이리스트 곡삭제`는 position 값으로 지운다. 구멍이 남으면 둘이
 * 어긋나 사용자가 본 번호와 다른 곡이 지워진다.
 */
function removeTrackFromPlaylist(playlistId, position) {
  const index = store.playlist_tracks.findIndex(
    (t) => t.playlist_id === playlistId && t.position === position
  );
  if (index === -1) return { changes: 0 };

  store.playlist_tracks.splice(index, 1);
  for (const track of store.playlist_tracks) {
    if (track.playlist_id === playlistId && track.position > position) track.position -= 1;
  }
  persist();
  return { changes: 1 };
}

function getPlaylistTracks(playlistId) {
  return tracksOf(playlistId).map(copy);
}

module.exports = {
  backend: 'json',
  // dbSqlite.js가 내보내는 DatabaseSync 핸들 자리. 파일 백엔드에는 닫을 것이 없지만,
  // 종료 경로가 백엔드를 가리지 않도록 같은 모양을 맞춰 둔다.
  db: { close() {} },
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
