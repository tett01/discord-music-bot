const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isSupportedNodeVersion,
  MIN_NODE_VERSION,
  MIN_VOICE_NODE_VERSION,
} = require('../src/nodeVersion');

test('23.4 미만은 SQLite를 쓸 수 없다고 본다', () => {
  // 호스팅 이미지에서 흔히 보는 버전들. 여기서 통과시키면 db.js가 SQLite를 고르고
  // 알아보기 힘든 ERR_UNKNOWN_BUILTIN_MODULE로 죽는다. (부팅을 막지는 않는다 —
  // 이 구간은 JSON 백엔드로 돈다)
  for (const version of ['v18.20.4', 'v20.11.0', 'v22.14.0', 'v23.0.0', 'v23.3.9']) {
    assert.equal(isSupportedNodeVersion(version), false, `통과하면 안 되는 버전: ${version}`);
  }
});

test('23.4 이상은 통과한다', () => {
  for (const version of ['v23.4.0', 'v23.5.0', 'v24.0.0', 'v25.1.2', '24.3.0']) {
    assert.equal(isSupportedNodeVersion(version), true, `막히면 안 되는 버전: ${version}`);
  }
});

test('경계값과 같으면 통과한다', () => {
  assert.equal(isSupportedNodeVersion(MIN_NODE_VERSION), true);
});

test('지금 이 테스트를 돌리는 Node는 요구 사항을 만족한다', () => {
  // node:sqlite를 쓰는 db.test.js가 도는 이상 당연히 참이어야 한다.
  // 이 단언이 깨지면 비교 로직이 뒤집힌 것이다.
  assert.equal(isSupportedNodeVersion(process.version), true);
});

test('음성 하한은 SQLite 요구선보다 낮다', () => {
  // 두 선이 같아지면 JSON 폴백을 넣은 의미가 없다. Node 22 이미지가 그 사이에 있다.
  assert.equal(isSupportedNodeVersion(MIN_VOICE_NODE_VERSION), false);
  assert.equal(isSupportedNodeVersion(MIN_NODE_VERSION, MIN_VOICE_NODE_VERSION), true);
});

test('무료 패널의 Node 22는 음성 하한을 넘는다', () => {
  // 이 구간을 살리려고 JSON 폴백을 넣었다. 여기서 막히면 폴백이 무의미해진다.
  for (const version of ['v22.12.0', 'v22.14.0', 'v23.0.0']) {
    assert.equal(isSupportedNodeVersion(version, MIN_VOICE_NODE_VERSION), true, version);
  }

  // @discordjs/voice가 뜨지 않는 구간은 여전히 막는다.
  for (const version of ['v18.20.4', 'v20.11.0', 'v22.11.0']) {
    assert.equal(isSupportedNodeVersion(version, MIN_VOICE_NODE_VERSION), false, version);
  }
});
