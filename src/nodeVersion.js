// 버전 요구가 두 단계다.
//
// - MIN_NODE_VERSION(23.4)  : 내장 SQLite(node:sqlite)를 플래그 없이 쓰기 위한 선. 이 밑에서는
//                             db.js가 JSON 파일 백엔드로 떨어진다. 실행은 된다.
// - MIN_VOICE_NODE_VERSION  : @discordjs/voice 0.19가 요구하는 진짜 하한. 이 밑에서는 무엇으로
//                             갈아끼워도 음성 연결이 되지 않으므로 부팅을 멈춘다.
//
// 무료 호스팅 패널의 Node 이미지가 대개 22에서 멈춰 있어, 23.4를 하한으로 두면 봇이 뜨지도
// 못했다. 두 선을 나눠 22 이미지에서도 돌아가게 한다.
const MIN_NODE_VERSION = '23.4.0';
const MIN_VOICE_NODE_VERSION = '22.12.0';

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
 * 음성 연결이 불가능한 버전이면 종료하고, SQLite를 못 쓰는 버전이면 알린 뒤 계속한다.
 *
 * 호스팅 패널에서 Node 버전을 확인할 방법이 없는 경우가 많아, 통과할 때도
 * 버전을 찍어 콘솔만 보고 알 수 있게 한다.
 */
function checkNodeVersion() {
  if (!isSupportedNodeVersion(process.version, MIN_VOICE_NODE_VERSION)) {
    console.error(
      `Node ${MIN_VOICE_NODE_VERSION} 이상이 필요합니다. 현재 버전: ${process.version}\n` +
        '@discordjs/voice가 요구하는 하한이라 이 밑에서는 음성 연결 자체가 되지 않습니다.\n' +
        '호스팅 패널의 Startup 설정에서 Node 이미지를 24로 올려주세요.'
    );
    process.exit(1);
  }

  console.log(`Node ${process.version}`);

  if (!isSupportedNodeVersion(process.version)) {
    // 죽이지는 않는다. db.js가 JSON 백엔드로 붙어 그대로 돈다.
    console.warn(
      `[node] ${MIN_NODE_VERSION} 미만이라 내장 SQLite를 쓸 수 없습니다. JSON 파일 저장소로 동작합니다.`
    );
  }
}

module.exports = {
  isSupportedNodeVersion,
  checkNodeVersion,
  MIN_NODE_VERSION,
  MIN_VOICE_NODE_VERSION,
};
