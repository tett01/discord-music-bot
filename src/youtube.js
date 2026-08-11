const { execFile, spawn } = require('node:child_process');

// yt-dlp-exec의 index는 execa를 감싼 얇은 래퍼일 뿐이라 직접 실행하는 편이 의존성이 가볍다.
// 바이너리 경로만 constants에서 가져오고, 실행은 child_process로 한다.
let YTDLP_PATH;
try {
  YTDLP_PATH = require('yt-dlp-exec/src/constants').YOUTUBE_DL_PATH;
} catch {
  YTDLP_PATH = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

const YOUTUBE_URL_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+$/i;

function isYoutubeUrl(text) {
  return YOUTUBE_URL_REGEX.test(text.trim());
}

/**
 * yt-dlp를 실행하고 stdout을 반환한다.
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function runYtdlp(args) {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP_PATH,
      args,
      { maxBuffer: 32 * 1024 * 1024, timeout: 60_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message).trim().split('\n').slice(-3).join(' ');
          reject(new Error(`yt-dlp 실행 실패: ${detail}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

/**
 * 링크 또는 검색어를 받아 재생 가능한 트랙 정보를 반환한다.
 * @param {string} query
 * @returns {Promise<{ title: string, url: string, duration: number, thumbnail: string | null }>}
 */
async function resolveTrack(query) {
  const target = isYoutubeUrl(query) ? query.trim() : `ytsearch1:${query}`;

  const stdout = await runYtdlp([
    target,
    '--dump-single-json',
    '--no-warnings',
    '--no-check-certificates',
    '--no-playlist',
    '-f',
    'bestaudio/best',
  ]);

  let info;
  try {
    info = JSON.parse(stdout);
  } catch {
    throw new Error('yt-dlp 응답을 해석하지 못했습니다.');
  }

  const entry = info.entries && info.entries.length ? info.entries[0] : info;
  if (!entry || !entry.webpage_url) {
    throw new Error('영상을 찾을 수 없습니다.');
  }

  return {
    title: entry.title,
    url: entry.webpage_url,
    duration: entry.duration ?? 0,
    thumbnail: entry.thumbnail ?? null,
  };
}

/**
 * 오디오를 stdout으로 흘려보내는 yt-dlp 프로세스를 띄운다.
 *
 * yt-dlp가 뽑아준 스트림 URL을 ffmpeg가 직접 열면 403 Forbidden이 나기 쉽다.
 * (URL이 yt-dlp가 사용한 클라이언트/헤더에 묶여 있어 ffmpeg의 요청은 거부된다)
 * yt-dlp가 직접 받아서 파이프로 넘기면 이 문제가 없다.
 *
 * @param {string} webpageUrl
 * @returns {import('node:child_process').ChildProcessWithoutNullStreams}
 */
function spawnAudioStream(webpageUrl) {
  return spawn(
    YTDLP_PATH,
    [
      webpageUrl,
      '-f',
      'bestaudio/best',
      '-o',
      '-',
      '--no-playlist',
      '--no-warnings',
      '--quiet',
      '--no-check-certificates',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
}

module.exports = { isYoutubeUrl, resolveTrack, spawnAudioStream };
