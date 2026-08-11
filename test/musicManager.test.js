// musicManager는 db.js를 require한다. 운영 DB를 건드리지 않도록 메모리 DB를 쓴다.
process.env.BOT_DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isBenignStreamError, LOOP_MODES } = require('../src/musicManager');

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

test('반복 모드는 off/song/queue 세 가지다', () => {
  // /반복 명령어의 선택지와 DB의 loop_mode 값이 여기에 묶여 있다.
  assert.deepEqual(LOOP_MODES, ['off', 'song', 'queue']);
});
