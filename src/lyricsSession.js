// 가사판 하나의 수명을 관리한다. 메시지 하나를 계속 **편집**해서 스크롤을 흉내낸다.
//
// ── 메모리 관점에서 이 파일의 설계 의도 ───────────────────────────────────────
//
// 1. **GuildMusicPlayer를 참조하지 않는다.** 생성자가 받는 것은 값과 클로저뿐이고,
//    player로 이어지는 유일한 끈은 `getPositionMs` 하나다. stop()이 그것을 null로 만든다.
//    세션 객체가 어딘가에 남아도 플레이어(대기열·음성 연결·ffmpeg)는 GC된다.
//    **이 파일에서 `player`를 받도록 고치지 마라.** 타이머 콜백이 플레이어를 통째로
//    붙잡아 서버 하나 쓸 때마다 수 MB가 샌다.
//
// 2. **Message 객체를 보관하지 않는다.** index.js가 MessageManager를 0으로 막아 두었으므로
//    메시지 캐시는 비어 있다. ID 문자열만 들고 REST로 편집한다.
//
// 3. **setInterval이 아니라 자기 재예약 setTimeout이다.** 줄이 바뀌는 시점에만 깨어난다.
//    3분짜리 곡에서 편집이 20~30회로 끝난다(1초 간격이면 180회고 대부분 레이트리밋 큐에 쌓인다).
//
// 4. 동시 세션 수에 상한이 있다(MAX_ACTIVE_SESSIONS).
//
// discord.js를 require하지 않는다. embed를 평범한 객체로 만들기 때문에 가짜 채널만 있으면
// 단독으로 테스트할 수 있다.

const { lineIndexAt, renderWindow } = require('./lyrics');

// 디스코드는 채널당 메시지 편집을 대략 5초에 5회 수준으로 제한한다. 빠른 곡은 가사 줄이
// 1~2초 간격으로 바뀌는데 줄마다 편집하면 discord.js가 요청을 큐에 쌓아 **가사가 음악보다
// 점점 뒤처진다.** 그래서 최소 간격을 두고, 그 사이에 지나간 줄은 따라가지 않고
// 다음 편집 때 현재 위치로 **한 번에 건너뛴다.** 밀림이 누적되지 않는 것이 요점이다.
const DEFAULT_EDIT_INTERVAL_MS = 3_000;
const DEFAULT_MAX_SESSIONS = 3;

const EMBED_COLOR = 0x5865f2;

function parseEnvInt(raw, fallback, min, max) {
  const value = Number.parseInt(String(raw ?? '').trim(), 10);
  // 잘못된 값에 예외를 던지지 않는다. 설정 실수로 재생까지 막히는 편이 더 나쁘다.
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

function editIntervalMs() {
  return parseEnvInt(process.env.LYRICS_EDIT_INTERVAL_MS, DEFAULT_EDIT_INTERVAL_MS, 1_000, 30_000);
}

function maxSessions() {
  return parseEnvInt(process.env.LYRICS_MAX_SESSIONS, DEFAULT_MAX_SESSIONS, 1, 20);
}

// 살아 있는 세션의 **수**만 센다. Set에 담으면 그 Set이 세션을 붙잡아 1번 설계가 무너진다.
let activeSessions = 0;

class LyricsSession {
  /**
   * @param {object} options
   * @param {{ at: number, text: string }[]} options.lines 파싱된 가사. 캐시와 공유한다(읽기 전용).
   * @param {string} options.title 화면에 띄울 곡 제목
   * @param {() => number | null} options.getPositionMs 재생 위치(ms). player로 가는 유일한 끈
   * @param {object} options.channel 보낼 채널 (send / messages.edit / messages.delete)
   * @param {boolean} [options.pin] 가사판을 고정할지
   */
  constructor({ lines, title, getPositionMs, channel, pin = true }) {
    this.lines = lines;
    this.title = title;
    this.getPositionMs = getPositionMs;
    this.channel = channel;
    this.pin = pin;

    this.timer = null;
    this.messageId = null;
    this.pinned = false;
    this.stopped = false;
    // 슬롯을 실제로 잡았는지. 잡지 않은 세션이 stop()에서 슬롯을 반납하면 카운터가 새어
    // 시간이 지날수록 상한이 느슨해진다.
    this.holdsSlot = false;
    // 같은 줄을 두 번 그리지 않기 위한 표식. 같은 내용으로 REST를 치는 것이 제일 아깝다.
    this.lastIndex = null;
    this.interval = editIntervalMs();
  }

  static get activeCount() {
    return activeSessions;
  }

  /** 동시 세션 상한에 걸리면 false. 걸리지 않으면 슬롯을 잡는다. */
  static tryAcquireSlot() {
    if (activeSessions >= maxSessions()) return false;
    activeSessions += 1;
    return true;
  }

  static releaseSlot() {
    if (activeSessions > 0) activeSessions -= 1;
  }

  /**
   * 가사판을 띄우고 타이머를 시작한다.
   * @returns {Promise<'started' | 'limit' | 'error'>}
   */
  async start() {
    if (this.stopped) return 'error';

    if (!LyricsSession.tryAcquireSlot()) {
      this.stop();
      return 'limit';
    }
    this.holdsSlot = true;

    const ok = await this._draw(lineIndexAt(this.lines, this.getPositionMs?.() ?? 0));
    if (!ok) {
      this.stop();
      return 'error';
    }
    this._schedule();
    return 'started';
  }

  /**
   * 모든 참조와 타이머를 끊는다. **여러 번 불려도 안전해야 한다** —
   * 곡 전환·정지·퇴장·채널 이동 네 경로에서 들어온다.
   */
  stop() {
    if (this.stopped) return;
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // 지우기는 비동기라, 참조를 끊기 전에 필요한 것만 지역 변수로 빼 둔다.
    const { channel, messageId, pinned } = this;

    // ⚠️ 이 세 줄이 이 파일의 핵심이다. player로 가는 끈과 가사 배열을 여기서 끊는다.
    this.getPositionMs = null;
    this.lines = null;
    this.channel = null;
    this.messageId = null;

    if (this.holdsSlot) {
      this.holdsSlot = false;
      LyricsSession.releaseSlot();
    }

    if (channel && messageId) {
      // 고정을 먼저 풀어야 채널의 고정 목록에 유령이 남지 않는다. 실패는 무시한다
      // (권한이 없거나 이미 지워진 경우인데, 어느 쪽도 사용자에게 알릴 일이 아니다).
      const cleanup = pinned
        ? channel.messages.unpin(messageId).catch(() => {})
        : Promise.resolve();
      cleanup.then(() => channel.messages.delete(messageId).catch(() => {}));
    }
  }

  /** 다음으로 줄이 바뀌는 시점에 깨어나도록 예약한다. */
  _schedule() {
    if (this.stopped) return;

    const position = this.getPositionMs?.();
    if (position == null) return this.stop();

    const index = lineIndexAt(this.lines, position);
    const next = this.lines[index + 1];
    // 마지막 줄까지 왔다. 더 그릴 것이 없으므로 타이머를 걸지 않는다.
    // (가사판은 그대로 남고, 곡이 끝나면 player가 stop()을 부른다)
    if (!next) return;

    const delay = Math.max(this.interval, next.at - position);
    this.timer = setTimeout(() => this._tick(), delay);
    // 타이머 때문에 프로세스가 종료되지 못하는 일이 없도록 한다. (melon.js와 같은 이유)
    this.timer.unref?.();
  }

  async _tick() {
    this.timer = null;
    if (this.stopped) return;

    const position = this.getPositionMs?.();
    if (position == null) return this.stop();

    const index = lineIndexAt(this.lines, position);
    if (index !== this.lastIndex) {
      const ok = await this._draw(index);
      // 편집이 실패하면 재시도하지 않고 끝낸다. 메시지가 지워졌거나 권한이 없는 것인데,
      // 재시도 루프를 돌면 레이트리밋에 갇힌다.
      if (!ok) return this.stop();
    }

    this._schedule();
  }

  /** @returns {Promise<boolean>} 성공 여부 */
  async _draw(index) {
    if (this.stopped) return false;
    this.lastIndex = index;

    const payload = { embeds: [this._embed(index)] };

    try {
      if (this.messageId) {
        await this.channel.messages.edit(this.messageId, payload);
      } else {
        const message = await this.channel.send(payload);
        this.messageId = message.id;
        if (this.pin) {
          // 다른 사람이 채팅을 치면 가사판이 밀려 올라간다. 인텐트가 Guilds/GuildVoiceStates
          // 둘뿐이라 messageCreate를 받을 수 없어 "밀리면 다시 보내기"를 할 수 없다.
          // 고정해 두면 밀려도 찾을 수 있다. 권한이 없으면 조용히 넘어간다.
          await message.pin().then(() => {
            this.pinned = true;
          }).catch(() => {});
        }
      }
      return true;
    } catch (error) {
      console.error('[가사] 가사판 갱신 실패:', error.message);
      return false;
    }
  }

  _embed(index) {
    const total = this.lines.length;
    const shown = Math.min(Math.max(index + 1, 0), total);
    return {
      title: `🎤 ${this.title}`,
      description: renderWindow(this.lines, index),
      color: EMBED_COLOR,
      footer: { text: `${shown}/${total}줄 · 가사 제공: LRCLIB` },
    };
  }
}

module.exports = {
  LyricsSession,
  DEFAULT_EDIT_INTERVAL_MS,
  DEFAULT_MAX_SESSIONS,
  editIntervalMs,
  maxSessions,
};
