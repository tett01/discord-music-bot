// 두 저장 백엔드(dbSqlite.js, dbJson.js)가 함께 쓰는 값들. 어느 쪽으로 붙든 기본값과
// 음질 모드 목록이 갈라지면 안 되므로 여기 한 곳에만 둔다.
const path = require('node:path');

// 새 서버가 처음 재생할 때의 음량(%). 100은 대부분의 음성 채널에서 너무 컸다.
const DEFAULT_VOLUME = 15;

// 오디오 전달 방식.
//
// - normal   : 디코딩 → PCM → 재인코딩. 음량 조절과 비트레이트 제한이 가능하다.
// - original : 유튜브 Opus를 재인코딩 없이 그대로 흘려보낸다. 음질 손실과 CPU 사용이
//              줄어드는 대신 PCM을 거치지 않으므로 음량 조절이 불가능하다.
//
// /음질 명령어의 선택지가 이 목록에 묶여 있다. 값을 늘리면 quality.js도 같이 고쳐야 한다.
const AUDIO_QUALITY_MODES = ['normal', 'original'];
const DEFAULT_AUDIO_QUALITY = 'normal';

/** SQLite 파일 경로. ':memory:'면 디스크를 쓰지 않는다. */
function sqlitePath() {
  return process.env.BOT_DB_PATH || path.join(__dirname, '..', 'data', 'bot.sqlite');
}

/**
 * JSON 파일 경로. `BOT_DB_PATH=':memory:'`면 JSON 백엔드도 메모리로만 돈다 —
 * 테스트가 백엔드를 바꿔 끼워도 같은 스위치 하나로 운영 데이터를 피할 수 있게 한다.
 */
function jsonPath() {
  if (process.env.BOT_DB_PATH === ':memory:') return ':memory:';
  return process.env.BOT_DB_JSON_PATH || path.join(__dirname, '..', 'data', 'bot.json');
}

module.exports = {
  DEFAULT_VOLUME,
  AUDIO_QUALITY_MODES,
  DEFAULT_AUDIO_QUALITY,
  sqlitePath,
  jsonPath,
};
