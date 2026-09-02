const test = require('node:test');
const assert = require('node:assert/strict');

const { startKeepAlive, stopKeepAlive } = require('../src/keepalive');

// UptimeRobot이 5분마다 때릴 엔드포인트다. 여기가 200을 주지 않으면 무료 인스턴스가
// 잠들어 봇이 오프라인이 되고, Render에서는 배포 자체가 실패한다.
test('GET /이 200을 돌려주고 /health가 상태를 싣는다', async (t) => {
  const previous = process.env.DISABLE_KEEPALIVE;
  delete process.env.DISABLE_KEEPALIVE;
  t.after(() => {
    stopKeepAlive();
    if (previous === undefined) delete process.env.DISABLE_KEEPALIVE;
    else process.env.DISABLE_KEEPALIVE = previous;
  });

  // 포트 0이면 OS가 비어 있는 포트를 골라 준다. (CI에서 포트 충돌 방지)
  const server = startKeepAlive({ port: 0, status: () => ({ ready: true, guilds: 3 }) });
  assert.ok(server, '서버가 뜨지 않음');

  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  const ping = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(ping.status, 200);
  assert.equal(await ping.text(), 'OK');

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.equal(body.ok, true);
  assert.equal(body.guilds, 3);
  assert.equal(typeof body.rssMb, 'number');

  // 크롤러가 아무 경로나 긁어도 조용히 404여야 한다.
  const missing = await fetch(`http://127.0.0.1:${port}/wp-login.php`);
  assert.equal(missing.status, 404);
});

test('DISABLE_KEEPALIVE=1이면 포트를 열지 않는다', (t) => {
  const previous = process.env.DISABLE_KEEPALIVE;
  t.after(() => {
    stopKeepAlive();
    if (previous === undefined) delete process.env.DISABLE_KEEPALIVE;
    else process.env.DISABLE_KEEPALIVE = previous;
  });

  // 로컬·pm2 실행에서 쓰지도 않는 포트를 잡으면 다른 프로세스와 충돌한다.
  process.env.DISABLE_KEEPALIVE = '1';
  assert.equal(startKeepAlive({ port: 0 }), null);
});
