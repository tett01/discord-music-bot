// 가사판의 **수명**을 검증한다. 여기서 통과해야 하는 가장 중요한 성질은
// "stop() 뒤에는 타이머도, 플레이어로 가는 참조도 남지 않는다"다.
// 이게 깨지면 곡을 재생할 때마다 GuildMusicPlayer가 통째로 새어 512MB 인스턴스가 죽는다.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseLrc, ANSI } = require('../src/lyrics');
const { LyricsSession } = require('../src/lyricsSession');

const LINES = parseLrc(
  ['[00:10.00]한 줄', '[00:20.00]두 줄', '[00:30.00]세 줄', '[00:40.00]네 줄'].join('\n')
);

/** send / messages.edit / messages.delete / messages.unpin만 있는 가짜 채널. */
function fakeChannel({ failEdit = false } = {}) {
  const calls = { sent: [], edits: [], deleted: [], unpinned: [], pins: 0 };
  return {
    calls,
    async send(payload) {
      calls.sent.push(payload);
      return {
        id: 'msg-1',
        async pin() {
          calls.pins += 1;
        },
      };
    },
    messages: {
      async edit(id, payload) {
        if (failEdit) throw new Error('Unknown Message');
        calls.edits.push({ id, payload });
      },
      async delete(id) {
        calls.deleted.push(id);
      },
      async unpin(id) {
        calls.unpinned.push(id);
      },
    },
  };
}

/** stop()의 지우기는 비동기라 마이크로태스크를 한 번 비워야 확인할 수 있다. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeSession(channel, position = { ms: 0 }, options = {}) {
  return new LyricsSession({
    lines: LINES,
    title: '테스트 곡',
    getPositionMs: () => position.ms,
    channel,
    ...options,
  });
}

test('시작하면 가사판을 보내고 고정한다', async () => {
  const channel = fakeChannel();
  const session = makeSession(channel, { ms: 25_000 });

  assert.equal(await session.start(), 'started');
  assert.equal(channel.calls.sent.length, 1);
  assert.equal(channel.calls.pins, 1, '밀려 올라가도 찾을 수 있게 고정한다');

  const [embed] = channel.calls.sent[0].embeds;
  assert.ok(
    embed.description.includes(`${ANSI.current}두 줄${ANSI.reset}`),
    '25초 지점의 현재 줄이 강조되어야 한다'
  );
  assert.equal(session.timer !== null, true, '다음 줄을 그릴 타이머가 예약되어야 한다');

  session.stop();
});

test('stop()은 타이머와 플레이어로 가는 참조를 모두 끊는다', async () => {
  const channel = fakeChannel();
  const position = { ms: 25_000 };
  const session = makeSession(channel, position);
  await session.start();

  session.stop();

  // ⚠️ 이 세 줄이 누수 방지의 핵심이다. getPositionMs가 살아 있으면 그 클로저가
  // resource와 player를 붙잡아 GuildMusicPlayer 전체가 GC되지 않는다.
  assert.equal(session.timer, null);
  assert.equal(session.getPositionMs, null);
  assert.equal(session.lines, null);
  assert.equal(session.channel, null);

  await flush();
  assert.deepEqual(channel.calls.unpinned, ['msg-1'], '고정을 먼저 풀어야 유령이 남지 않는다');
  await flush();
  assert.deepEqual(channel.calls.deleted, ['msg-1'], '잔해를 남기지 않고 지운다');
});

test('stop()을 여러 번 불러도 안전하다', async () => {
  // 곡 전환·정지·퇴장·채널 이동 네 경로에서 들어오므로 중복 호출이 정상이다.
  const channel = fakeChannel();
  const session = makeSession(channel);
  await session.start();

  session.stop();
  session.stop();
  session.stop();
  await flush();
  await flush();

  assert.equal(channel.calls.deleted.length, 1, '메시지를 두 번 지우려 하면 안 된다');
});

test('stop() 뒤에 남아 있던 타이머가 깨어나도 아무것도 하지 않는다', async () => {
  const channel = fakeChannel();
  const position = { ms: 25_000 };
  const session = makeSession(channel, position);
  await session.start();

  session.stop();
  position.ms = 35_000;
  await session._tick(); // 이미 예약돼 있던 콜백이 늦게 깨어난 상황

  assert.equal(channel.calls.edits.length, 0);
  assert.equal(session.timer, null, '멈춘 세션이 타이머를 다시 예약하면 영원히 돈다');
});

test('줄이 바뀌지 않았으면 편집하지 않는다', async () => {
  // 같은 내용으로 REST를 치는 것이 제일 아깝다. 레이트리밋도 여기서 아낀다.
  const channel = fakeChannel();
  const position = { ms: 25_000 };
  const session = makeSession(channel, position);
  await session.start();

  position.ms = 28_000; // 여전히 '두 줄' 구간
  await session._tick();
  assert.equal(channel.calls.edits.length, 0);

  position.ms = 31_000; // '세 줄'로 넘어갔다
  await session._tick();
  assert.equal(channel.calls.edits.length, 1);
  assert.ok(
    channel.calls.edits[0].payload.embeds[0].description.includes(`${ANSI.current}세 줄${ANSI.reset}`)
  );

  session.stop();
});

test('여러 줄이 한꺼번에 지나가면 중간을 따라가지 않고 현재 위치로 건너뛴다', async () => {
  // 편집 최소 간격 때문에 생기는 상황이다. 중간 줄을 하나씩 따라가면 밀림이 누적된다.
  const channel = fakeChannel();
  const position = { ms: 10_000 };
  const session = makeSession(channel, position);
  await session.start();

  position.ms = 40_000; // 두 줄·세 줄을 건너뛰었다
  await session._tick();

  assert.equal(channel.calls.edits.length, 1, '건너뛴 줄마다 편집하지 않는다');
  assert.ok(
    channel.calls.edits[0].payload.embeds[0].description.includes(`${ANSI.current}네 줄${ANSI.reset}`)
  );

  session.stop();
});

test('마지막 줄에 닿으면 타이머를 더 예약하지 않는다', async () => {
  const channel = fakeChannel();
  const session = makeSession(channel, { ms: 999_999 });
  await session.start();

  assert.equal(session.timer, null, '그릴 것이 없는데 깨어나면 그냥 낭비다');
  assert.equal(session.stopped, false, '가사판 자체는 남아 있어야 한다');

  session.stop();
});

test('재생 위치를 읽을 수 없게 되면 스스로 끝난다', async () => {
  const channel = fakeChannel();
  const session = new LyricsSession({
    lines: LINES,
    title: '테스트 곡',
    getPositionMs: () => null,
    channel,
  });

  await session.start();
  await session._tick();

  assert.equal(session.stopped, true);
});

test('편집이 실패하면 재시도하지 않고 끝낸다', async () => {
  // 메시지가 지워졌거나 권한이 없는 것이다. 재시도 루프를 돌면 레이트리밋에 갇힌다.
  const channel = fakeChannel({ failEdit: true });
  const position = { ms: 10_000 };
  const session = makeSession(channel, position);
  await session.start();

  position.ms = 40_000;
  await session._tick();

  assert.equal(session.stopped, true);
  assert.equal(session.timer, null);
});

test('동시 세션 수에 상한이 있고, 끝내면 슬롯이 돌아온다', async () => {
  process.env.LYRICS_MAX_SESSIONS = '2';
  try {
    assert.equal(LyricsSession.activeCount, 0, '앞선 테스트가 슬롯을 흘렸는지도 같이 본다');

    const a = makeSession(fakeChannel());
    const b = makeSession(fakeChannel());
    const c = makeSession(fakeChannel());

    assert.equal(await a.start(), 'started');
    assert.equal(await b.start(), 'started');
    assert.equal(await c.start(), 'limit');
    assert.equal(LyricsSession.activeCount, 2, '거절된 세션이 슬롯을 먹으면 상한이 조여든다');

    a.stop();
    assert.equal(LyricsSession.activeCount, 1);

    const d = makeSession(fakeChannel());
    assert.equal(await d.start(), 'started', '슬롯이 반납되면 다시 띄울 수 있다');

    b.stop();
    d.stop();
    // 거절된 세션을 한 번 더 정리해도 카운터가 음수로 새지 않아야 한다.
    c.stop();
    assert.equal(LyricsSession.activeCount, 0);
  } finally {
    delete process.env.LYRICS_MAX_SESSIONS;
  }
});
