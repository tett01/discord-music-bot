// 유튜브 소스 엔진 선택기.
//
// 엔진이 두 개다. 하나로 합치지 않은 이유는 **둘의 고장 나는 방식이 다르기 때문이다.**
//
// - play-dl : 순수 JS. 바이너리·python이 필요 없어 무료 호스팅에서 잘 붙고 가볍다.
//             대신 유튜브가 서명(nsig) 로직을 바꾸면 라이브러리 업데이트 전까지 통째로 막힌다.
// - yt-dlp  : 외부 바이너리. 유튜브 변경에 훨씬 빠르게 대응하지만, 자식 프로세스 두 개
//             (yt-dlp + ffmpeg)를 띄우고 python이 없는 컨테이너에서는 설치가 실패한다.
//
// 기본값 `auto`는 play-dl을 먼저 쓰고, 실패하면 같은 요청을 yt-dlp로 한 번 더 시도한다.
// 한쪽이 유튜브 변경으로 죽어도 재생이 멈추지 않게 하기 위한 것이다.
// `AUDIO_ENGINE=playdl` 또는 `ytdlp`로 한쪽만 강제할 수 있다.
const ytdlp = require('./youtube');
const playdl = require('./playdl');

const AUDIO_ENGINES = ['auto', 'playdl', 'ytdlp'];

/** @returns {'auto' | 'playdl' | 'ytdlp'} */
function selectedEngine() {
  const value = (process.env.AUDIO_ENGINE || '').trim().toLowerCase();
  return AUDIO_ENGINES.includes(value) && value !== '' ? value : 'auto';
}

/**
 * 시도할 엔진 순서를 정한다.
 * @param {string} [engine] 테스트용 주입. 없으면 환경변수를 본다.
 * @returns {Array<'playdl' | 'ytdlp'>}
 */
function engineOrder(engine = selectedEngine()) {
  if (engine === 'playdl') return ['playdl'];
  if (engine === 'ytdlp') return ['ytdlp'];
  return ['playdl', 'ytdlp'];
}

/**
 * 링크·검색어를 트랙으로 바꾼다. 실패하면 다음 엔진으로 넘어간다.
 *
 * 돌려주는 객체에 `engine`을 박아 둔다. 조회에 성공한 엔진으로 스트림도 열어야
 * 하기 때문이다. (play-dl이 찾은 URL을 yt-dlp가 다시 조회하는 낭비를 막는다)
 *
 * @param {string} query
 * @returns {Promise<{ title: string, url: string, duration: number, thumbnail: string | null, engine: string }>}
 */
async function resolveTrack(query) {
  const order = engineOrder();
  let lastError;

  for (const engine of order) {
    try {
      const track =
        engine === 'playdl' ? await playdl.resolveTrack(query) : await ytdlp.resolveTrack(query);
      return { ...track, engine };
    } catch (error) {
      lastError = error;
      // 영상 자체의 제약(연령·지역·삭제)은 엔진을 바꿔도 결과가 같다. 굳이 두 번 묻지 않는다.
      if (isVideoLevelFailure(error)) break;
      if (order.length > 1) {
        console.warn(`[source] ${engine} 조회 실패, 다음 엔진으로 시도합니다: ${error?.message ?? error}`);
      }
    }
  }

  throw lastError ?? new Error('영상을 찾을 수 없습니다.');
}

// 엔진을 바꿔도 결과가 같은, 영상 자체의 제약. 폴백을 건너뛰어 응답 시간을 아낀다.
const VIDEO_LEVEL_FAILURE =
  /confirm your age|age.restricted|members.only|join this channel|private video|available in your country|geo.restricted|has been removed|no longer available/i;

function isVideoLevelFailure(error) {
  return VIDEO_LEVEL_FAILURE.test(String(error?.message ?? ''));
}

/**
 * 재생용 오디오 소스를 연다.
 *
 * 두 가지 모양 중 하나를 돌려준다. 호출하는 쪽(musicManager)이 `kind`로 갈라 쓴다.
 *
 * - `{ kind: 'stream' }` — play-dl. 자식 프로세스가 없다. `type`이 'webm/opus'면
 *   원음 모드에서 **ffmpeg조차 띄우지 않고** 그대로 디스코드로 넘길 수 있다.
 * - `{ kind: 'process' }` — yt-dlp. 자식 프로세스의 stdout이 오디오다.
 *
 * @param {{ url: string, engine?: string }} track
 * @param {{ opusOnly?: boolean }} [options] opusOnly는 yt-dlp 경로에서만 의미가 있다.
 */
async function openSource(track, { opusOnly = false } = {}) {
  const order = engineOrder();
  const engine = track.engine === 'ytdlp' ? 'ytdlp' : order[0];

  if (engine === 'playdl') {
    try {
      const { stream, type } = await playdl.openStream(track.url);
      return { engine: 'playdl', kind: 'stream', stream, type: String(type) };
    } catch (error) {
      // **조회와 스트림은 따로 실패한다.** play-dl은 제목·길이는 잘 가져오면서
      // 재생 URL만 못 푸는 상태가 될 수 있다(유튜브가 서명 로직을 바꿨을 때).
      // 이걸 여기서 잡지 않으면 조회는 멀쩡한데 모든 곡이 건너뛰어진다.
      if (!order.includes('ytdlp')) throw error;
      console.warn(`[source] play-dl 스트림 실패, yt-dlp로 전환합니다: ${error?.message ?? error}`);
    }
  }

  const child = ytdlp.spawnAudioStream(track.url, { opusOnly });
  return { engine: 'ytdlp', kind: 'process', child, stream: child.stdout };
}

module.exports = {
  AUDIO_ENGINES,
  selectedEngine,
  engineOrder,
  resolveTrack,
  openSource,
  isVideoLevelFailure,
  // 오류 문구 매핑은 youtube.js가 계속 소유한다. play-dl의 오류 문구도 같은 표에 넣어
  // 두 엔진이 한 곳에서 관리되게 했다.
  describeTrackError: ytdlp.describeTrackError,
  isYoutubeUrl: ytdlp.isYoutubeUrl,
};
