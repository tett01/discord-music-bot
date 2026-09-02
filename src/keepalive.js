// UptimeRobot용 keep-alive 웹 서버.
//
// Render 무료 플랜과 Replit은 **들어오는 HTTP 요청이 없으면 인스턴스를 재운다.**
// 잠들면 음성 연결이 끊기고 다음 요청까지 봇이 오프라인으로 보인다. UptimeRobot이
// 5분마다 `GET /`를 때리게 해서 깨어 있게 만드는 것이 이 파일의 전부다.
//
// Render는 컨테이너가 실제로 리스닝하는 포트를 `PORT`로 알려준다. 이 포트에 바인딩하지
// 않으면 배포 자체가 "no open ports detected"로 실패하므로, 이 서버는 무료 호스팅에서
// 선택이 아니라 필수다.
const express = require('express');

let server = null;

/** 봇이 살아 있는지 판단할 정보를 넘겨받기 위한 후크. index.js가 채워 넣는다. */
let statusProvider = () => ({});

/**
 * keep-alive 서버를 띄운다.
 *
 * @param {{ port?: number, status?: () => object }} [options]
 * @returns {import('node:http').Server | null} 비활성화된 경우 null
 */
function startKeepAlive({ port, status } = {}) {
  if (server) return server;
  // 로컬이나 pm2로 돌릴 때는 필요 없다. DISABLE_KEEPALIVE=1로 끈다.
  if (String(process.env.DISABLE_KEEPALIVE || '').trim() === '1') {
    console.log('[keepalive] DISABLE_KEEPALIVE=1 — 웹 서버를 띄우지 않습니다.');
    return null;
  }

  if (status) statusProvider = status;

  const listenPort = Number(port ?? process.env.PORT ?? 3000);
  const app = express();

  // 미들웨어를 하나도 붙이지 않는다. body parser·정적 파일·로거는 전부 메모리와
  // 요청당 할당을 늘리는데, 여기서 처리할 것은 핑 한 종류뿐이다.
  app.disable('x-powered-by');
  app.disable('etag');

  // UptimeRobot이 때릴 엔드포인트. 200과 짧은 문자열이면 충분하다.
  app.get('/', (_req, res) => res.type('text/plain').send('OK'));

  // HEAD 요청만 보내는 모니터도 있다. express가 GET 핸들러로 자동 처리한다.
  app.get('/health', (_req, res) => {
    const info = statusProvider() ?? {};
    // 상태 확인용이라 JSON이지만, 값이 늘어나지 않게 최소한만 담는다.
    res.json({
      ok: info.ready !== false,
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
      ...info,
    });
  });

  // 그 밖의 경로는 본문 없이 404. 크롤러가 긁어도 비용이 거의 들지 않는다.
  app.use((_req, res) => res.sendStatus(404));

  server = app.listen(listenPort, '0.0.0.0', () => {
    console.log(`🌐 keep-alive 서버 대기 중: 0.0.0.0:${listenPort}`);
  });

  // 포트를 못 잡아도 봇 자체는 계속 돌아야 한다. (로컬에서 포트가 겹치는 경우 등)
  server.on('error', (error) => {
    console.error('[keepalive] 웹 서버 오류:', error.message);
    server = null;
  });

  // 유휴 연결을 오래 붙들지 않는다. 소켓 하나하나가 메모리다.
  server.keepAliveTimeout = 10_000;
  server.headersTimeout = 12_000;

  return server;
}

function stopKeepAlive() {
  if (!server) return;
  try {
    server.close();
  } catch {
    /* noop */
  }
  server = null;
}

module.exports = { startKeepAlive, stopKeepAlive };
