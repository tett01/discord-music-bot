#!/usr/bin/env node
// 저장소 파일(플레이리스트·서버 설정)의 스냅샷을 떠서 보관한다. cron으로 돌리는 것을
// 전제로 만들었다. `npm run backup`으로 손으로 부를 수도 있다.
//
// **봇을 멈추지 않고 뜨는 것이 요점이다.** SQLite 백엔드는 WAL 모드로 돌기 때문에
// `bot.sqlite`만 복사하면 `-wal`에 남은 최근 변경이 빠진다. 그래서 파일을 복사하지 않고
// SQLite에게 `VACUUM INTO`로 정합성 있는 사본을 만들게 한다. (README "데이터 백업" 참고)
//
// JSON 백엔드는 쓸 때마다 파일을 통째로 다시 쓰므로 그냥 복사하면 된다.
//
// 환경변수
//   BOT_BACKUP_DIR   보관 위치. 기본값은 data/backups
//   BOT_BACKUP_KEEP  보관 개수. 기본값은 14. 초과분은 오래된 것부터 지운다
//   BOT_DB_PATH / BOT_DB_JSON_PATH  원본 경로 (dbConstants와 같은 규칙)

const fs = require('node:fs');
const path = require('node:path');

const { sqlitePath, jsonPath } = require('../src/dbConstants');

const DEFAULT_KEEP = 14;
const PREFIX = 'bot-';

/**
 * 스냅샷 파일 이름을 만든다. 이름만으로 시간순 정렬이 되도록 고정폭으로 찍는다 —
 * 오래된 것을 지울 때 파일 시스템의 mtime이 아니라 이름을 믿을 수 있어야 한다.
 *
 * @param {Date} date
 * @param {string} extension `.sqlite` 또는 `.json`
 * @returns {string}
 */
function backupFileName(date, extension) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${PREFIX}${stamp}${extension}`;
}

/**
 * 보관 개수를 넘긴 오래된 스냅샷을 고른다.
 *
 * 이름이 시간순으로 정렬되므로 사전순 정렬이 곧 시간순이다. 우리가 만든 이름
 * (`bot-` 접두사 + 같은 확장자)만 대상으로 삼는다 — 같은 폴더에 사람이 손으로 둔
 * 파일까지 지워버리면 안 된다.
 *
 * @param {string[]} names 폴더 안의 파일 이름들
 * @param {number} keep 남길 개수
 * @param {string} extension
 * @returns {string[]} 지워야 할 이름들 (오래된 순)
 */
function selectStale(names, keep, extension) {
  if (keep < 0) return [];

  const ours = names.filter((name) => name.startsWith(PREFIX) && name.endsWith(extension)).sort();

  return ours.slice(0, Math.max(0, ours.length - keep));
}

/**
 * 어느 백엔드의 파일이 실제로 있는지 보고 백업 대상을 정한다.
 *
 * db.js처럼 node:sqlite 존재 여부로 고르지 않는다. 백업은 **지금 디스크에 있는 것**을
 * 떠야 하므로, 런타임이 무엇을 고를지가 아니라 파일이 있는지가 기준이다.
 *
 * @returns {{ source: string, extension: string, kind: 'sqlite' | 'json' } | null}
 */
function resolveSource() {
  const sqlite = sqlitePath();
  if (sqlite !== ':memory:' && fs.existsSync(sqlite)) {
    return { source: sqlite, extension: '.sqlite', kind: 'sqlite' };
  }

  const json = jsonPath();
  if (json !== ':memory:' && fs.existsSync(json)) {
    return { source: json, extension: '.json', kind: 'json' };
  }

  return null;
}

/**
 * SQLite 원본에서 정합성 있는 사본을 만든다.
 *
 * 읽기 전용으로 열어 원본에 쓰기 잠금을 걸지 않는다. `VACUUM INTO`는 대상 파일이
 * 이미 있으면 거부하므로 이름이 겹치지 않는 것이 전제다.
 *
 * @param {string} source
 * @param {string} destination
 */
function snapshotSqlite(source, destination) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    // 경로를 문자열 리터럴로 넣어야 하므로 작은따옴표를 이스케이프한다.
    db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}

function main() {
  const target = resolveSource();
  if (!target) {
    console.log('[backup] 백업할 저장소 파일이 없습니다. (아직 아무것도 저장되지 않았습니다)');
    return;
  }

  const directory = process.env.BOT_BACKUP_DIR || path.join(__dirname, '..', 'data', 'backups');
  fs.mkdirSync(directory, { recursive: true });

  const destination = path.join(directory, backupFileName(new Date(), target.extension));

  if (target.kind === 'sqlite') snapshotSqlite(target.source, destination);
  else fs.copyFileSync(target.source, destination);

  const size = fs.statSync(destination).size;
  console.log(`[backup] ${path.basename(destination)} (${(size / 1024).toFixed(1)} KB)`);

  const keepRaw = Number.parseInt(process.env.BOT_BACKUP_KEEP ?? '', 10);
  const keep = Number.isInteger(keepRaw) && keepRaw >= 0 ? keepRaw : DEFAULT_KEEP;

  const stale = selectStale(fs.readdirSync(directory), keep, target.extension);
  for (const name of stale) fs.rmSync(path.join(directory, name), { force: true });
  if (stale.length) console.log(`[backup] 오래된 스냅샷 ${stale.length}개를 지웠습니다. (보관 ${keep}개)`);
}

// cron이 잡아갈 수 있도록 실패는 종료 코드로 알린다. require로 불러올 때는 돌지 않는다.
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[backup] 실패: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { backupFileName, selectStale, resolveSource };
