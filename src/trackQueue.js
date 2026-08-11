// 대기열과 반복 모드의 전이 규칙만 담는다. 음성 연결·ffmpeg·디스코드에 의존하지
// 않으므로 단독으로 테스트할 수 있다. GuildMusicPlayer는 이 클래스가 정한 "다음 곡"을
// 받아 재생하는 역할만 한다.

// 'last'는 대기열이 남아 있는 동안은 off처럼 순서대로 넘어가고, 다 떨어지면 마지막
// 곡만 반복한다. 'queue'는 대기열 전체를 순환하므로 마지막 곡 뒤에 첫 곡으로 돌아간다.
const LOOP_MODES = ['off', 'song', 'queue', 'last'];

class TrackQueue {
  constructor(loopMode = 'off') {
    /** @type {object[]} 아직 재생하지 않은 곡 */
    this.tracks = [];
    /** @type {object | null} 지금 재생 중인 곡 */
    this.current = null;
    this.loopMode = LOOP_MODES.includes(loopMode) ? loopMode : 'off';
    // 사용자의 /다음곡과 곡의 자연 종료를 구분한다. 이게 없으면 loop: song에서
    // 건너뛰기가 같은 곡을 다시 재생한다.
    this._forceSkip = false;
  }

  get size() {
    return this.tracks.length;
  }

  get isEmpty() {
    return this.current === null && this.tracks.length === 0;
  }

  enqueue(track) {
    this.tracks.push(track);
  }

  /** 다음 advance()가 반복을 무시하고 넘어가도록 표시한다. */
  requestSkip() {
    this._forceSkip = true;
  }

  setLoopMode(mode) {
    if (!LOOP_MODES.includes(mode)) throw new Error('알 수 없는 반복 모드입니다.');
    this.loopMode = mode;
  }

  /**
   * 다음에 재생할 곡을 정하고 current를 갱신한다.
   *
   * - `song`: 사용자가 건너뛴 게 아니면 같은 곡을 다시 준다.
   * - `queue`: 방금 튼 곡을 대기열 뒤로 돌린 뒤 다음 곡을 꺼낸다.
   * - `last`: 대기열이 남아 있으면 다음 곡, 다 떨어졌으면 방금 튼 곡을 다시 준다.
   *
   * @returns {object | null} 재생할 곡. 없으면 null이고 current도 null이 된다.
   */
  advance() {
    const forceSkip = this._forceSkip;
    this._forceSkip = false;

    if (this.loopMode === 'song' && this.current && !forceSkip) {
      return this.current;
    }

    if (this.loopMode === 'queue' && this.current) {
      this.tracks.push(this.current);
    }

    // 대기열이 남아 있으면 아래로 흘러가 평소처럼 다음 곡을 꺼낸다. 마지막 곡에서만
    // 반복이 걸린다. 사용자가 /다음곡으로 끝낸 경우는 멈추는 쪽이 자연스럽다.
    if (this.loopMode === 'last' && this.current && this.tracks.length === 0 && !forceSkip) {
      return this.current;
    }

    this.current = this.tracks.shift() ?? null;
    return this.current;
  }

  /** 대기열만 비운다. 재생 중인 곡은 그대로 둔다. */
  clear() {
    this.tracks = [];
  }

  /** 대기열과 재생 상태를 모두 초기화한다. (정지·종료) */
  reset() {
    this.tracks = [];
    this.current = null;
    this._forceSkip = false;
  }
}

module.exports = { TrackQueue, LOOP_MODES };
