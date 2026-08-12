// Node 내장 SQLite(node:sqlite)를 플래그 없이 쓰려면 23.4 이상이어야 한다.
// 이 밑에서는 db.js가 require 시점에 ERR_UNKNOWN_BUILTIN_MODULE로 죽는데,
// 그 메시지만 보고는 원인을 알기 어려워 부팅 때 먼저 확인한다.
const MIN_NODE_VERSION = '23.4.0';

/**
 * 'v23.4.0' / '23.4.0' 형태를 [major, minor, patch]로 자른다.
 * @param {string} version
 * @returns {number[]}
 */
function parseVersion(version) {
  return String(version)
    .replace(/^v/, '')
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

/**
 * 주어진 Node 버전이 요구 사항을 만족하는지 본다.
 * @param {string} version 예: process.version
 * @param {string} [minimum]
 * @returns {boolean}
 */
function isSupportedNodeVersion(version, minimum = MIN_NODE_VERSION) {
  const actual = parseVersion(version);
  const required = parseVersion(minimum);

  for (let i = 0; i < 3; i += 1) {
    if ((actual[i] ?? 0) > (required[i] ?? 0)) return true;
    if ((actual[i] ?? 0) < (required[i] ?? 0)) return false;
  }
  return true;
}

/**
 * 버전이 낮으면 사유를 설명하고 종료한다. 만족하면 버전을 로그에 남긴다.
 *
 * 호스팅 패널에서 Node 버전을 확인할 방법이 없는 경우가 많아, 통과할 때도
 * 버전을 찍어 콘솔만 보고 알 수 있게 한다.
 */
function assertNodeVersion() {
  if (!isSupportedNodeVersion(process.version)) {
    console.error(
      `Node ${MIN_NODE_VERSION} 이상이 필요합니다. 현재 버전: ${process.version}\n` +
        '내장 SQLite(node:sqlite)를 사용하므로 이 버전 미만에서는 실행할 수 없습니다.\n' +
        '호스팅 패널의 Startup 설정에서 Node 이미지를 24로 올려주세요.'
    );
    process.exit(1);
  }

  console.log(`Node ${process.version}`);
}

module.exports = { isSupportedNodeVersion, assertNodeVersion, MIN_NODE_VERSION };
