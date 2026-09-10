// 저장 백엔드를 고르고 그대로 다시 내보낸다. **명령어와 musicManager는 이 파일만 본다** —
// dbSqlite.js나 dbJson.js를 직접 require하지 마세요. (테스트는 계약 검증을 위해 예외)
//
// - sqlite : Node 23.4 이상. 기본이자 권장. data/bot.sqlite
// - json   : node:sqlite가 없을 때. 무료 호스팅 패널의 Node 22 이미지를 위한 길. data/bot.json
//
// BOT_DB_BACKEND로 강제할 수 있다(sqlite | json | auto). 기본 auto는 node:sqlite가
// 있으면 sqlite를, 없으면 json을 고른다.
//
// ⚠️ **두 백엔드는 데이터를 공유하지 않습니다.** 백엔드를 바꾸면 플레이리스트와 서버
// 설정이 빈 상태로 시작합니다. 옮기려면 scripts/migrate-storage.js를 쓰세요.
const requested = (process.env.BOT_DB_BACKEND || 'auto').toLowerCase();

function sqliteAvailable() {
  try {
    require('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

function pick() {
  if (requested === 'json') return 'json';

  if (requested === 'sqlite') {
    if (sqliteAvailable()) return 'sqlite';
    // 조용히 JSON으로 떨어지면 "설정이 왜 초기화됐지"로 헤매게 된다. 명시적으로 고른
    // 백엔드가 없으면 이유를 말하고 죽는 편이 낫다.
    throw new Error(
      `BOT_DB_BACKEND=sqlite로 지정했지만 이 Node(${process.version})에는 node:sqlite가 없습니다. ` +
        'Node를 23.4 이상으로 올리거나 BOT_DB_BACKEND=json으로 바꿔주세요.'
    );
  }

  return sqliteAvailable() ? 'sqlite' : 'json';
}

const selected = pick();

if (selected === 'json') {
  // 직접 고른 것인지 Node가 낮아서 떨어진 것인지 구분해서 찍는다. 둘을 뭉뚱그리면
  // 로그만 보고는 Node를 올려야 하는 상황인지 알 수 없다.
  const reason = requested === 'json' ? 'BOT_DB_BACKEND=json' : `Node ${process.version} — node:sqlite 없음`;
  console.log(`[db] JSON 파일 저장소를 사용합니다. (${reason})`);
  if (requested !== 'json') {
    console.log('     동작에는 문제가 없지만, 가능하면 Node 23.4 이상에서 SQLite를 쓰는 편이 낫습니다.');
  }
}

module.exports = selected === 'sqlite' ? require('./dbSqlite') : require('./dbJson');
