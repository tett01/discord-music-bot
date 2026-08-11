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
          // timeout으로 우리가 죽인 경우 stderr가 비어 있어 원인을 알 수 없다.
          if (error.killed) {
            reject(new Error('yt-dlp 응답 시간 초과'));
            return;
          }
          const detail = String(stderr || error.message).trim().split('\n').slice(-3).join(' ');
          reject(new Error(`yt-dlp 실행 실패: ${detail}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

// yt-dlp가 stderr로 남기는 대표적인 실패 사유를 사용자에게 보여줄 문장으로 옮긴다.
// 순서가 중요하다. 위쪽일수록 구체적인 사유이므로 먼저 검사한다.
const ERROR_HINTS = [
  [/confirm your age|age.restricted/i, '🔞 연령 제한이 걸린 영상이라 재생할 수 없습니다.'],
  [/members.only|join this channel/i, '💳 멤버십 전용 영상이라 재생할 수 없습니다.'],
  [/private video/i, '🔒 비공개 영상입니다.'],
  [/available in your country|blocked it in your country|geo.restricted/i, '🌍 지역 제한으로 재생할 수 없는 영상입니다.'],
  [/live event will begin|premieres in|not currently live/i, '📡 아직 시작하지 않은 라이브/프리미어 영상입니다.'],
  [/video unavailable|has been removed|no longer available|does not exist/i, '🗑️ 삭제되었거나 이용할 수 없는 영상입니다.'],
  [/시간 초과|timed out|ETIMEDOUT/i, '⌛ 유튜브 응답이 너무 느립니다. 잠시 후 다시 시도해주세요.'],
  [
    /HTTP Error 4\d\d|failed to extract|unable to extract|nsig extraction/i,
    '⚠️ 유튜브에서 영상 정보를 가져오지 못했습니다. yt-dlp가 오래되었을 수 있습니다. (README의 문제 해결 참고)',
  ],
];

/**
 * 트랙 조회 실패 원인을 사용자에게 보여줄 문장으로 바꾼다.
 *
 * 실패 사유가 전부 "영상을 찾지 못했습니다"로 뭉뚱그려지면, 연령 제한처럼
 * 정상적인 제약도 봇 고장으로 오해하게 된다.
 *
 * @param {unknown} error
 * @returns {string}
 */
function describeTrackError(error) {
  const message = String(error?.message ?? '');
  for (const [pattern, hint] of ERROR_HINTS) {
    if (pattern.test(message)) return hint;
  }
  return '영상을 찾지 못했습니다. 링크나 검색어를 확인해주세요.';
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

module.exports = { isYoutubeUrl, resolveTrack, spawnAudioStream, describeTrackError };
