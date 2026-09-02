// audio_quality 칼럼이 없던 시절의 DB를 먼저 만들어 두고, db.js가 그 위에서 열리는지 본다.
//
// `CREATE TABLE IF NOT EXISTS`는 이미 있는 테이블을 건드리지 않으므로, DDL에 칼럼을 늘려도
// 기존 DB에는 반영되지 않는다. data/bot.sqlite는 저장소에 없는 유일한 사본이라 지우고 다시
// 만들 수도 없다. 마이그레이션이 빠지면 운영 중인 봇이 실행 즉시 죽는다.
//
// node --test는 파일마다 프로세스를 새로 띄우므로, db.js를 require하기 전인 여기서
// BOT_DB_PATH를 임시 파일로 돌려놓을 수 있다. (다른 테스트는 ':memory:'를 쓴다)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-db-migration-'));
const dbPath = path.join(tmpDir, 'bot.sqlite');

// 옛 스키마. audio_quality가 없고, 값이 들어 있는 서버가 하나 있다.
{
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    CREATE TABLE guild_settings (
      guild_id TEXT PRIMARY KEY,
      text_channel_id TEXT,
      volume INTEGER NOT NULL DEFAULT 15,
      loop_mode TEXT NOT NULL DEFAULT 'off'
    );
  `);
  legacy
    .prepare('INSERT INTO guild_settings (guild_id, volume, loop_mode) VALUES (?, ?, ?)')
    .run('legacy-guild', 42, 'queue');
  legacy.close();
}

process.env.BOT_DB_PATH = dbPath;

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, getGuildSettings, setAudioQuality, DEFAULT_AUDIO_QUALITY } = require('../src/db');

test.after(() => {
  // Windows는 열려 있는 파일을 지우지 못한다. WAL 파일까지 정리되도록 먼저 닫는다.
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('기존 DB에 audio_quality 칼럼이 추가된다', () => {
  // require 시점에 ensureColumn이 이미 돌았다. 여기서 터지면 운영 DB도 같이 터진다.
  const settings = getGuildSettings('legacy-guild');
  assert.equal(settings.audio_quality, DEFAULT_AUDIO_QUALITY);
});

test('마이그레이션이 기존 설정값을 건드리지 않는다', () => {
  const settings = getGuildSettings('legacy-guild');
  assert.equal(settings.volume, 42, '저장돼 있던 음량이 기본값으로 덮이면 안 된다');
  assert.equal(settings.loop_mode, 'queue');
});

test('마이그레이션 후에도 음질 설정을 읽고 쓸 수 있다', () => {
  setAudioQuality('legacy-guild', 'original');
  assert.equal(getGuildSettings('legacy-guild').audio_quality, 'original');
});

test('마이그레이션은 여러 번 열어도 안전하다', () => {
  // 봇은 재시작할 때마다 db.js를 다시 연다. ALTER TABLE을 두 번 치면 예외가 난다.
  const reopened = new DatabaseSync(dbPath);
  const columns = reopened.prepare('PRAGMA table_info(guild_settings)').all();
  reopened.close();

  const names = columns.map((c) => c.name);
  assert.equal(
    names.filter((n) => n === 'audio_quality').length,
    1,
    `audio_quality가 중복 추가됨: ${names.join(', ')}`
  );
});
