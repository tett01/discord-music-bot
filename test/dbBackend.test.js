// db.js의 백엔드 선택과, JSON 백엔드가 재시작을 견디는지 본다.
//
// node --test는 파일마다 프로세스를 새로 띄우므로, db.js를 require하기 전인 여기서
// 환경변수를 정할 수 있다.
process.env.BOT_DB_PATH = ':memory:';
process.env.BOT_DB_BACKEND = 'json';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const db = require('../src/db');

test('BOT_DB_BACKEND=json이면 JSON 백엔드가 붙는다', () => {
  assert.equal(db.backend, 'json');
});

test('db.js는 백엔드 함수를 그대로 내보낸다', () => {
  // 선택기가 일부만 재수출하면 명령어 쪽에서 "함수가 아님"으로 터진다.
  for (const name of ['getGuildSettings', 'setVolume', 'createPlaylist', 'getPlaylistTracks']) {
    assert.equal(typeof db[name], 'function', `${name}이 없다`);
  }
});

test('JSON 저장소는 재시작해도 남는다', () => {
  // 봇을 재시작하면 프로세스가 새로 뜬다. 파일에 쓰이지 않으면 무료 패널에서
  // 플레이리스트와 음량이 매번 초기화된다. 실제로 프로세스를 나눠 확인한다.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-json-store-'));
  const file = path.join(tmpDir, 'bot.json');
  const env = { ...process.env, BOT_DB_BACKEND: 'json', BOT_DB_JSON_PATH: file };
  delete env.BOT_DB_PATH; // ':memory:'가 남아 있으면 파일을 쓰지 않는다

  const run = (code) => execFileSync(process.execPath, ['-e', code], { env, encoding: 'utf8' });

  run(`
    const db = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'db'))});
    db.setVolume('g1', 77);
    db.setLoopMode('g1', 'queue');
    db.createPlaylist('g1', '출근길');
    db.addTrackToPlaylist(db.getPlaylist('g1', '출근길').id, '노래', 'https://youtu.be/x');
  `);

  const out = run(`
    const db = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'db'))});
    const p = db.getPlaylist('g1', '출근길');
    console.log(JSON.stringify({
      volume: db.getGuildSettings('g1').volume,
      loop: db.getGuildSettings('g1').loop_mode,
      titles: db.getPlaylistTracks(p.id).map((t) => t.title),
    }));
  `);

  const restored = JSON.parse(out.trim().split('\n').pop());
  assert.equal(restored.volume, 77);
  assert.equal(restored.loop, 'queue');
  assert.deepEqual(restored.titles, ['노래']);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('깨진 JSON 파일을 만나도 부팅한다', () => {
  // 쓰는 도중 인스턴스가 죽으면 파일이 잘릴 수 있다. 여기서 예외를 던지면 봇이
  // 영영 뜨지 못하므로, 옆으로 치우고 빈 상태로 시작해야 한다.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-json-broken-'));
  const file = path.join(tmpDir, 'bot.json');
  fs.writeFileSync(file, '{"guild_settings": {"g1": ');

  const env = { ...process.env, BOT_DB_BACKEND: 'json', BOT_DB_JSON_PATH: file };
  delete env.BOT_DB_PATH;

  const out = execFileSync(
    process.execPath,
    [
      '-e',
      `const db = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'db'))});
       console.log(db.getGuildSettings('g1').volume);`,
    ],
    { env, encoding: 'utf8' }
  );

  assert.equal(out.trim().split('\n').pop(), String(db.DEFAULT_VOLUME));
  assert.ok(
    fs.readdirSync(tmpDir).some((f) => f.includes('.broken-')),
    '깨진 파일을 보존하지 않았다'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
