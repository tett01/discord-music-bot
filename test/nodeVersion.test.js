const test = require('node:test');
const assert = require('node:assert/strict');

const { isSupportedNodeVersion, MIN_NODE_VERSION } = require('../src/nodeVersion');

test('23.4 미만은 거부한다', () => {
  // 호스팅 이미지에서 흔히 보는 버전들. 여기서 통과시키면 db.js가 알아보기 힘든
  // ERR_UNKNOWN_BUILTIN_MODULE로 죽는다.
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
