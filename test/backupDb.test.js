// 백업 스크립트의 순수 로직을 본다. 이름 짓기와 "무엇을 지울지" 고르는 규칙이다.
//
// 지우는 쪽이 특히 위험하다. 대상을 잘못 고르면 **유일한 사본을 지워버린다.** 그래서
// 접두사·확장자가 다른 파일은 손대지 않는다는 것까지 검증한다.
//
// require만 해서는 백업이 돌지 않아야 하므로(require.main 가드) 여기서 원본 경로를
// 건드릴 필요가 없다. 그래도 다른 테스트와 같은 안전장치를 걸어둔다.
process.env.BOT_DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert');

const { backupFileName, selectStale } = require('../scripts/backup-db');

test('파일 이름은 고정폭이라 사전순 정렬이 곧 시간순이다', () => {
  const early = backupFileName(new Date(2026, 8, 9, 3, 4, 5), '.sqlite');
  const late = backupFileName(new Date(2026, 8, 20, 13, 45, 0), '.sqlite');

  assert.strictEqual(early, 'bot-20260909-030405.sqlite');
  assert.strictEqual(late, 'bot-20260920-134500.sqlite');
  assert.ok(early < late, '사전순 비교가 시간순과 같아야 한다');
});

test('확장자는 넘긴 그대로 붙는다', () => {
  assert.ok(backupFileName(new Date(2026, 0, 1), '.json').endsWith('.json'));
});

test('보관 개수를 넘긴 만큼 오래된 것부터 고른다', () => {
  const names = [
    'bot-20260901-000000.sqlite',
    'bot-20260902-000000.sqlite',
    'bot-20260903-000000.sqlite',
    'bot-20260904-000000.sqlite',
  ];

  assert.deepStrictEqual(selectStale(names, 2, '.sqlite'), [
    'bot-20260901-000000.sqlite',
    'bot-20260902-000000.sqlite',
  ]);
});

test('보관 개수에 못 미치면 아무것도 지우지 않는다', () => {
  const names = ['bot-20260901-000000.sqlite'];
  assert.deepStrictEqual(selectStale(names, 14, '.sqlite'), []);
});

test('입력 순서가 뒤죽박죽이어도 오래된 것을 고른다', () => {
  const names = [
    'bot-20260903-000000.sqlite',
    'bot-20260901-000000.sqlite',
    'bot-20260902-000000.sqlite',
  ];

  assert.deepStrictEqual(selectStale(names, 1, '.sqlite'), [
    'bot-20260901-000000.sqlite',
    'bot-20260902-000000.sqlite',
  ]);
});

test('우리가 만들지 않은 파일은 건드리지 않는다', () => {
  const names = [
    'bot-20260901-000000.sqlite',
    'bot-20260902-000000.sqlite',
    // 사람이 손으로 둔 것들. 접두사가 없거나 확장자가 다르다.
    'bot.sqlite',
    '중요한-백업.sqlite',
    'bot-20260901-000000.json',
    'README.txt',
  ];

  assert.deepStrictEqual(selectStale(names, 0, '.sqlite'), [
    'bot-20260901-000000.sqlite',
    'bot-20260902-000000.sqlite',
  ]);
});

test('keep이 음수면 아무것도 지우지 않는다', () => {
  // 환경변수를 잘못 넣었을 때 전부 지워버리는 것이 최악이다.
  const names = ['bot-20260901-000000.sqlite', 'bot-20260902-000000.sqlite'];
  assert.deepStrictEqual(selectStale(names, -1, '.sqlite'), []);
});

// 여기서부터는 실제로 파일을 떠본다. VACUUM INTO가 WAL에 남은 최근 변경까지 담는지가
// 이 스크립트의 존재 이유이므로, 순수 로직만 봐서는 검증이 끝나지 않는다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

test('실행하면 WAL에 남은 변경까지 담긴 사본이 생긴다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-backup-'));
  const source = path.join(dir, 'bot.sqlite');
  const backupDir = path.join(dir, 'backups');

  // WAL 모드로 쓰고 **닫지 않는다.** 봇이 돌고 있는 상황을 흉내 내는 것이다.
  const db = new DatabaseSync(source);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE playlists (id INTEGER PRIMARY KEY, name TEXT)');
  db.exec("INSERT INTO playlists (name) VALUES ('출근길')");

  try {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'backup-db.js')], {
      env: { ...process.env, BOT_DB_PATH: source, BOT_BACKUP_DIR: backupDir },
      stdio: 'pipe',
    });

    const made = fs.readdirSync(backupDir);
    assert.strictEqual(made.length, 1, '스냅샷이 하나 생겨야 한다');

    const copy = new DatabaseSync(path.join(backupDir, made[0]), { readOnly: true });
    // node:sqlite의 행은 null 프로토타입 객체라 deepStrictEqual로 리터럴과 비교하면
    // 값이 같아도 걸린다. 여기서 보려는 것은 값뿐이므로 필요한 칼럼만 꺼낸다.
    const names = copy.prepare('SELECT name FROM playlists').all().map((row) => row.name);
    copy.close();

    assert.deepStrictEqual(names, ['출근길'], 'WAL에만 있던 행이 사본에 있어야 한다');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('보관 개수를 넘기면 오래된 스냅샷이 지워진다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-backup-keep-'));
  const source = path.join(dir, 'bot.sqlite');
  const backupDir = path.join(dir, 'backups');

  const db = new DatabaseSync(source);
  db.exec('CREATE TABLE t (id INTEGER)');
  db.close();

  fs.mkdirSync(backupDir, { recursive: true });
  for (const name of ['bot-20260101-000000.sqlite', 'bot-20260102-000000.sqlite']) {
    fs.writeFileSync(path.join(backupDir, name), '');
  }

  try {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'backup-db.js')], {
      env: { ...process.env, BOT_DB_PATH: source, BOT_BACKUP_DIR: backupDir, BOT_BACKUP_KEEP: '1' },
      stdio: 'pipe',
    });

    // 방금 뜬 것 하나만 남는다.
    const left = fs.readdirSync(backupDir);
    assert.strictEqual(left.length, 1);
    assert.ok(!left.includes('bot-20260101-000000.sqlite'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
