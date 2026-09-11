// play-dl 기반 유튜브 엔진.
//
// yt-dlp(youtube.js)와 달리 **외부 바이너리도 python도 필요 없다.** 순수 JS라
// Render/Replit처럼 바이너리를 내려받기 어렵거나 디스크가 좁은 무료 호스팅에서 유리하다.
//
// 메모리 관점의 핵심은 "원음 모드에서는 ffmpeg를 아예 띄우지 않는다"는 점이다.
// play-dl이 WebM/Opus를 그대로 주고 @discordjs/voice가 JS로 디먹싱하므로,
// yt-dlp + ffmpeg 두 개의 자식 프로세스(각각 수십 MB)가 통째로 사라진다.
const fs = require('node:fs');
const path = require('node:path');

const play = require('play-dl');

// 유튜브가 무료 호스팅 IP를 막을 때 붙는 브라우저 UA. play-dl 기본값도 있지만
// 명시해 두는 편이 차단 회피에 유리하다.
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * 쿠키 텍스트를 `name=value; name=value` 형태의 Cookie 헤더 문자열로 정규화한다.
 *
 * 두 가지 입력을 모두 받는다.
 *
 * 1. 브라우저 개발자도구 Network 탭에서 복사한 Cookie 헤더 (이미 원하는 형태)
 * 2. yt-dlp가 쓰는 Netscape cookies.txt (탭으로 구분된 7개 필드)
 *
 * 2번까지 받는 이유는 **쿠키 파일 하나로 play-dl과 yt-dlp 양쪽을 먹이기 위해서다.**
 * 형식이 갈리면 폴백 엔진으로 넘어갔을 때 쿠키가 없어 똑같이 차단당한다.
 *
 * 네트워크에 의존하지 않는 순수 함수라 단독으로 테스트한다.
 *
 * @param {string} text
 * @returns {string} 정규화된 Cookie 헤더. 쓸 만한 쿠키가 없으면 빈 문자열.
 */
function normalizeCookie(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';

  // 주석과 빈 줄부터 걷어낸다. 이걸 남기면 '# Netscape HTTP Cookie File'만 든 파일이
  // 그대로 쿠키 헤더로 나가서, 쿠키가 설정된 것처럼 보이지만 인증은 안 되는 상태가 된다.
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (lines.length === 0) return '';

  const isNetscape = lines.some((line) => line.split('\t').length >= 7);

  if (!isNetscape) {
    // 헤더 문자열. 줄바꿈으로 잘라 붙여 넣은 경우까지 한 줄로 만든다.
    return lines.join(' ').replace(/^Cookie:\s*/i, '').trim();
  }

  const pairs = [];
  for (const line of lines) {
    const fields = line.split('\t');
    if (fields.length < 7) continue;
    const name = fields[5].trim();
    const value = fields[6].trim();
    if (!name) continue;
    pairs.push(`${name}=${value}`);
  }
  return pairs.join('; ');
}

/**
 * 설정된 유튜브 쿠키를 읽어 온다.
 *
 * 우선순위: `YOUTUBE_COOKIE`(직접 붙여넣은 값) → `YOUTUBE_COOKIE_FILE` →
 * `YTDLP_COOKIES`(yt-dlp와 공유). 마지막 항목 덕분에 이미 쿠키 파일을 쓰고 있었다면
 * 환경변수를 새로 추가하지 않아도 play-dl이 같은 파일을 쓴다.
 *
 * @returns {string}
 */
function readConfiguredCookie() {
  const inline = normalizeCookie(process.env.YOUTUBE_COOKIE);
  if (inline) return inline;

  for (const key of ['YOUTUBE_COOKIE_FILE', 'YTDLP_COOKIES']) {
    const filePath = (process.env[key] || '').trim();
    if (!filePath) continue;
    if (!fs.existsSync(filePath)) {
      console.warn(`[play-dl] ${key}에 지정된 쿠키 파일을 찾을 수 없습니다: ${filePath}`);
      continue;
    }
    try {
      const cookie = normalizeCookie(fs.readFileSync(filePath, 'utf8'));
      if (cookie) return cookie;
      console.warn(`[play-dl] 쿠키 파일에서 읽을 값이 없습니다: ${filePath}`);
    } catch (error) {
      console.warn(`[play-dl] 쿠키 파일을 읽지 못했습니다 (${filePath}):`, error.message);
    }
  }

  return '';
}

let initialized = false;

/**
 * play-dl에 쿠키/UA를 물린다. 봇 기동 시 한 번만 부르면 된다.
 *
 * 쿠키가 없어도 동작은 한다. 다만 무료 호스팅의 공용 IP는 유튜브가
 * "Sign in to confirm you're not a bot"으로 막는 일이 잦고, 그때 이 쿠키가
 * 로그인한 사용자처럼 보이게 해 통과시킨다.
 *
 * @returns {{ cookie: boolean }} 쿠키가 적용됐는지
 */
function initPlayDl() {
  if (initialized) return { cookie: Boolean(readConfiguredCookie()) };
  initialized = true;

  const userAgent = (process.env.YOUTUBE_USER_AGENT || DEFAULT_USER_AGENT).trim();
  try {
    play.setToken({ useragent: [userAgent] });
  } catch (error) {
    console.warn('[play-dl] User-Agent 설정 실패:', error.message);
  }

  const cookie = readConfiguredCookie();
  if (!cookie) {
    console.warn(
      '[play-dl] 유튜브 쿠키가 설정되지 않았습니다. 무료 호스팅에서는 ' +
        '"Sign in to confirm you\'re not a bot" 차단이 날 수 있습니다. (README의 쿠키 설정 참고)'
    );
    return { cookie: false };
  }

  try {
    // play-dl은 이 값을 cwd의 `.data/youtube.data`에 저장하고 이후 토큰을 스스로 갱신한다.
    // 디스크가 읽기 전용인 환경에서는 쓰기가 실패할 수 있으나, 그때도 메모리상의
    // 설정은 살아 있으므로 경고만 남기고 계속 간다.
    play.setToken({ youtube: { cookie } });
    console.log('[play-dl] 유튜브 쿠키를 적용했습니다.');
  } catch (error) {
    console.warn('[play-dl] 쿠키 적용 실패:', error.message);
    return { cookie: false };
  }

  return { cookie: true };
}

/** play-dl이 `.data`를 쓰려다 죽지 않도록 디렉터리를 미리 만들어 둔다. */
function ensureDataDir() {
  const dir = path.join(process.cwd(), '.data');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* 읽기 전용 FS. play-dl이 알아서 실패하고 우리는 경고만 남긴다. */
  }
}

/**
 * 소스 품질 단계. 0=낮음, 1=중간, 2=높음(기본).
 *
 * 메모리·대역폭이 빠듯하면 `PLAYDL_QUALITY=1`로 낮춘다. 어차피 일반 모드는
 * 128kbps 이하로 재인코딩되므로 체감 차이가 크지 않다.
 */
function qualityLevel() {
  const parsed = Number.parseInt(String(process.env.PLAYDL_QUALITY ?? '').trim(), 10);
  return parsed === 0 || parsed === 1 || parsed === 2 ? parsed : 2;
}

function pickThumbnail(details) {
  const thumbs = details?.thumbnails;
  if (!Array.isArray(thumbs) || thumbs.length === 0) return null;
  return thumbs[thumbs.length - 1]?.url ?? null;
}

/**
 * `v=`가 있는 유튜브 링크에서 그 영상만 가리키는 URL을 뽑는다. 없으면 null이다.
 *
 * **유튜브 앱·유튜브 뮤직에서 복사한 링크에는 `&list=RD...`(자동 믹스)가 딸려 온다.**
 * `play.yt_validate`는 그걸 보고 'playlist'로 판정하는데, 그대로 재생목록의 첫 곡을
 * 집으면 **사용자가 고르지 않은 곡이 재생된다.** 대기열에 올라가는 제목도 그 곡이라
 * 나중에는 왜 딴 곡이 나왔는지 알아내기 어렵다.
 *
 * yt-dlp 쪽은 `--no-playlist`가 같은 일을 한다. 두 엔진이 같은 링크에 다른 곡을
 * 돌려주면 폴백이 일어날 때마다 곡이 바뀌므로, 규칙을 여기서 맞춰 둔다.
 *
 * 네트워크에 의존하지 않는 순수 함수다.
 *
 * @param {string} link
 * @returns {string | null}
 */
function videoUrlFromLink(link) {
  let parsed;
  try {
    parsed = new URL(String(link ?? '').trim());
  } catch {
    return null;
  }

  // youtu.be/<id>는 애초에 'video'로 판정되므로 여기 올 일이 없다. youtube.com만 본다.
  if (!/(^|\.)youtube\.com$/i.test(parsed.hostname)) return null;

  const id = parsed.searchParams.get('v');
  // 영상 ID는 11자다. 이상한 값이 오면 건드리지 않고 원래 경로로 흘려보낸다.
  if (!id || !/^[\w-]{11}$/.test(id)) return null;

  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * 링크 또는 검색어를 재생 가능한 트랙 정보로 바꾼다.
 *
 * youtube.js의 `resolveTrack`과 **같은 모양의 객체**를 돌려준다. 두 엔진을 바꿔 껴도
 * 명령어 쪽 코드가 달라지지 않아야 하기 때문이다.
 *
 * @param {string} query
 * @returns {Promise<{ title: string, url: string, duration: number, thumbnail: string | null }>}
 */
async function resolveTrack(query) {
  const target = String(query ?? '').trim();
  if (!target) throw new Error('검색어가 비어 있습니다.');

  const kind = play.yt_validate(target);
  // list=가 붙어 있어도 v=가 있으면 **그 영상이 사용자가 고른 곡이다.**
  const single = kind === 'playlist' ? videoUrlFromLink(target) : null;

  // 링크인 경우. 순수 재생목록 링크(v=가 없는 것)만 첫 곡을 가져온다.
  if (kind === 'video' || single) {
    const info = await play.video_basic_info(single ?? target);
    const details = info?.video_details;
    if (!details?.url) throw new Error('Video unavailable: 영상 정보를 가져오지 못했습니다.');
    return {
      title: details.title ?? '제목 없음',
      url: details.url,
      duration: details.durationInSec ?? 0,
      thumbnail: pickThumbnail(details),
    };
  }

  if (kind === 'playlist') {
    const list = await play.playlist_info(target, { incomplete: true });
    const first = (await list.all_videos())[0];
    if (!first?.url) throw new Error('Video unavailable: 재생목록에서 영상을 찾지 못했습니다.');
    return {
      title: first.title ?? '제목 없음',
      url: first.url,
      duration: first.durationInSec ?? 0,
      thumbnail: pickThumbnail(first),
    };
  }

  // 검색어. limit 1이면 응답 파싱량도 최소가 된다.
  const [found] = await play.search(target, { limit: 1, source: { youtube: 'video' } });
  if (!found?.url) throw new Error('영상을 찾을 수 없습니다.');
  return {
    title: found.title ?? '제목 없음',
    url: found.url,
    duration: found.durationInSec ?? 0,
    thumbnail: pickThumbnail(found),
  };
}

/**
 * 재생용 오디오 스트림을 연다.
 *
 * `discordPlayerCompatibility: false`가 핵심이다. true면 play-dl이 내부에서
 * ffmpeg로 재인코딩하는데, 우리는 **Opus를 그대로 받아 넘기고 싶다.**
 * 그래야 원음 모드에서 자식 프로세스가 하나도 뜨지 않는다.
 *
 * @param {string} url
 * @returns {Promise<{ stream: import('node:stream').Readable, type: string }>}
 */
async function openStream(url) {
  ensureDataDir();
  const source = await play.stream(url, {
    quality: qualityLevel(),
    discordPlayerCompatibility: false,
    // 라이브는 세그먼트를 계속 버퍼링해 메모리를 잡아먹는다. 최소치로 묶는다.
    htmldata: false,
  });

  if (!source?.stream) throw new Error('play-dl이 오디오 스트림을 열지 못했습니다.');
  return source;
}

module.exports = {
  initPlayDl,
  resolveTrack,
  videoUrlFromLink,
  openStream,
  normalizeCookie,
  readConfiguredCookie,
  qualityLevel,
  DEFAULT_USER_AGENT,
};
