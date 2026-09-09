const { execFile, execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// scripts/ensure-ytdlp.js가 내려받는 위치. yt-dlp-exec를 설치하지 못한 환경(python이
// 없는 호스팅 컨테이너 등)에서 쓰는 standalone 바이너리다.
const BUNDLED_YTDLP = path.join(
  __dirname,
  '..',
  'bin',
  process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
);

/**
 * 실행할 yt-dlp 바이너리 경로를 정한다. 위에서부터 먼저 잡히는 것을 쓴다.
 *
 * 1. `YTDLP_PATH` — 직접 지정한 경로가 항상 이긴다
 * 2. `bin/yt-dlp` — postinstall이 받아둔 standalone 바이너리
 * 3. `yt-dlp-exec` — 설치에 성공했다면 그 패키지가 받아둔 바이너리
 * 4. PATH의 `yt-dlp`
 *
 * yt-dlp-exec의 postinstall은 python을 요구하므로 python이 없는 컨테이너에서는
 * 설치 자체가 실패한다. 그래서 이 패키지에만 의존하지 않는다.
 *
 * @returns {string}
 */
function resolveYtdlpPath() {
  const override = (process.env.YTDLP_PATH || '').trim();
  if (override) return override;

  if (fs.existsSync(BUNDLED_YTDLP)) return BUNDLED_YTDLP;

  try {
    // yt-dlp-exec의 index는 execa를 감싼 얇은 래퍼일 뿐이라 경로만 가져다 쓴다.
    return require('yt-dlp-exec/src/constants').YOUTUBE_DL_PATH;
  } catch {
    return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  }
}

const YOUTUBE_URL_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+$/i;

// 같은 경고를 매 요청마다 찍지 않도록 이미 알린 경로를 기억한다.
const warnedCookiePaths = new Set();

/**
 * yt-dlp에 붙일 쿠키 인자를 만든다.
 *
 * 클라우드/호스팅 IP는 유튜브가 "Sign in to confirm you're not a bot"으로 막는 일이
 * 잦다. 이때 브라우저에서 뽑은 쿠키 파일을 물리면 통과한다. 로컬 실행에는 필요 없으므로
 * `YTDLP_COOKIES`가 없으면 아무 인자도 붙이지 않는다. (기존 동작 그대로)
 *
 * 경로가 지정됐는데 파일이 없으면, `--cookies`를 그대로 넘겼을 때 yt-dlp가 알아보기
 * 힘든 오류로 죽으므로 경고만 남기고 인자를 뺀다.
 *
 * @returns {string[]}
 */
function cookieArgs() {
  const cookiePath = (process.env.YTDLP_COOKIES || '').trim();
  if (!cookiePath) return [];

  if (!fs.existsSync(cookiePath)) {
    if (!warnedCookiePaths.has(cookiePath)) {
      warnedCookiePaths.add(cookiePath);
      console.warn(`YTDLP_COOKIES에 지정된 쿠키 파일을 찾을 수 없습니다: ${cookiePath}`);
    }
    return [];
  }

  return ['--cookies', cookiePath];
}

let jsRuntimeCache = null;

/**
 * yt-dlp에 JavaScript 런타임을 물려준다.
 *
 * 유튜브는 재생 URL의 `n` 파라미터를 JS로 풀어야 온전한 포맷을 준다. 런타임이 없으면
 * yt-dlp가 그 단계를 건너뛰고 다른 클라이언트로 우회하는데, **그렇게 얻은 URL은
 * IP에 묶여 있어 데이터센터에서 403으로 거부되는 일이 잦다.** yt-dlp 자신도 이 경로를
 * deprecated로 표시하고 경고를 낸다.
 *
 * 기본 런타임은 deno뿐이라 대부분의 호스트에는 없다. 그런데 **우리는 Node 위에서 돌고
 * 있으므로 쓸 수 있는 런타임이 이미 손에 있다.** `process.execPath`를 그대로 물려주면
 * 새로 설치할 것이 없다.
 *
 * `--js-runtimes`는 비교적 최근에 생긴 옵션이라, 낡은 바이너리에 넘기면 "unknown option"으로
 * **재생이 통째로 죽는다.** 그래서 지원 여부를 한 번 확인하고 캐시한다.
 *
 * `YTDLP_JS_RUNTIME=off`로 끌 수 있다.
 *
 * @returns {string[]}
 */
function jsRuntimeArgs() {
  if (jsRuntimeCache) return jsRuntimeCache;

  const setting = (process.env.YTDLP_JS_RUNTIME || '').trim();
  if (setting.toLowerCase() === 'off') {
    jsRuntimeCache = [];
    return jsRuntimeCache;
  }

  let supported = false;
  try {
    // 한 번만 돈다. --help는 네트워크를 타지 않아 빠르다.
    const help = execFileSync(resolveYtdlpPath(), ['--help'], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    supported = help.includes('--js-runtimes');
  } catch {
    // 바이너리를 못 부르면 여기서 판단하지 않는다. 실제 실행이 제 오류를 낼 것이다.
  }

  if (!supported) {
    console.warn(
      '[yt-dlp] 이 바이너리는 --js-runtimes를 모릅니다. 유튜브가 일부 포맷을 주지 않아 ' +
        '403이 날 수 있습니다. `npm run update-ytdlp`으로 갱신해보세요.'
    );
    jsRuntimeCache = [];
    return jsRuntimeCache;
  }

  const runtime = setting || `node:${process.execPath}`;
  console.log(`[yt-dlp] JavaScript 런타임을 사용합니다: ${runtime}`);
  jsRuntimeCache = ['--js-runtimes', runtime];
  return jsRuntimeCache;
}

let warnedExtraArgs = false;

/**
 * 따옴표를 존중하며 명령줄 문자열을 인자 배열로 쪼갠다.
 *
 * 셸을 거치지 않고 spawn에 직접 넘기므로 우리가 직접 잘라야 한다. 셸을 흉내 내려는
 * 것이 아니라 `--extractor-args "youtube:player_client=tv"`처럼 **따옴표로 묶인 값 하나**를
 * 붙여넣는 흔한 경우를 살리는 것이 목적이다.
 *
 * @param {string} input
 * @returns {string[]}
 */
function splitArgs(input) {
  const tokens = [];
  let current = '';
  let quote = null;
  let started = false;

  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      // 따옴표만으로 이루어진 빈 인자도 인자로 친다.
      started = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }

    current += char;
    started = true;
  }

  if (started) tokens.push(current);
  return tokens;
}

/**
 * yt-dlp에 덧붙일 추가 인자를 만든다.
 *
 * 유튜브의 봇 판정은 **쿠키 말고 클라이언트를 바꾸는 것만으로 비껴가는 경우가 있다.**
 * 계정을 걸지 않아도 되는 길이라 먼저 시도해볼 값이 있는데, 그때마다 코드를 고치게
 * 두지 않으려고 환경변수로 열어둔다.
 *
 * - `YTDLP_PLAYER_CLIENT` — 흔히 쓰는 경우를 위한 지름길. `tv,web_safari`처럼 적으면
 *   `--extractor-args youtube:player_client=tv,web_safari`가 된다.
 * - `YTDLP_EXTRA_ARGS` — 그 밖의 무엇이든. 문자열을 그대로 잘라 붙인다.
 *
 * 둘 다 있으면 순서대로 모두 붙는다. 잘못된 값을 넣으면 yt-dlp가 거부하므로,
 * 무엇이 붙었는지 한 번은 로그에 남겨 원인을 찾을 수 있게 한다.
 *
 * @returns {string[]}
 */
function extraArgs() {
  const args = [];

  const playerClient = (process.env.YTDLP_PLAYER_CLIENT || '').trim();
  if (playerClient) args.push('--extractor-args', `youtube:player_client=${playerClient}`);

  const extra = (process.env.YTDLP_EXTRA_ARGS || '').trim();
  if (extra) args.push(...splitArgs(extra));

  if (args.length && !warnedExtraArgs) {
    warnedExtraArgs = true;
    console.log(`[yt-dlp] 추가 인자를 사용합니다: ${args.join(' ')}`);
  }

  return args;
}

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
      resolveYtdlpPath(),
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
  // 호스팅 IP가 봇으로 의심받는 경우. 영상 문제가 아니므로 다른 사유보다 먼저 본다.
  [
    /not a bot|cookies for the authentication|--cookies-from-browser|login required|LOGIN_REQUIRED|consent\.youtube/i,
    '🤖 유튜브가 이 서버를 봇으로 의심해 차단했습니다. 쿠키 설정이 필요합니다. (YOUTUBE_COOKIE / YTDLP_COOKIES)',
  ],
  [/confirm your age|age.restricted/i, '🔞 연령 제한이 걸린 영상이라 재생할 수 없습니다.'],
  [/members.only|join this channel/i, '💳 멤버십 전용 영상이라 재생할 수 없습니다.'],
  [/private video/i, '🔒 비공개 영상입니다.'],
  [/available in your country|blocked it in your country|geo.restricted/i, '🌍 지역 제한으로 재생할 수 없는 영상입니다.'],
  [/live event will begin|premieres in|not currently live/i, '📡 아직 시작하지 않은 라이브/프리미어 영상입니다.'],
  [/video unavailable|has been removed|no longer available|does not exist/i, '🗑️ 삭제되었거나 이용할 수 없는 영상입니다.'],
  [/시간 초과|timed out|ETIMEDOUT/i, '⌛ 유튜브 응답이 너무 느립니다. 잠시 후 다시 시도해주세요.'],
  [
    // 뒤쪽 세 패턴은 play-dl이 유튜브 응답을 파싱하지 못했을 때 내는 문구다.
    // 두 엔진의 '추출 실패'는 사용자 입장에서 같은 상황이라 한 문장으로 묶는다.
    /HTTP Error 4\d\d|failed to extract|unable to extract|nsig extraction|While getting info from url|Got error while parsing|Could not extract functions/i,
    '⚠️ 유튜브에서 영상 정보를 가져오지 못했습니다. 소스 엔진이 오래되었을 수 있습니다. (README의 문제 해결 참고)',
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
    ...cookieArgs(),
    ...jsRuntimeArgs(),
    ...extraArgs(),
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
 * `opusOnly`는 원음(재인코딩 없는 전달) 모드용이다. 디스코드가 요구하는 것이 48kHz
 * 스테레오 Opus이므로, 소스가 Opus일 때만 재인코딩을 건너뛸 수 있다. AAC(m4a)가 잡히면
 * 그대로 넘길 수 없으므로 **일부러 대체 포맷을 두지 않는다** — 여기서 실패하게 두고
 * 호출한 쪽이 일반 모드로 되돌리는 편이, 엉뚱한 코덱을 물고 조용히 깨지는 것보다 낫다.
 *
 * @param {string} webpageUrl
 * @param {{ opusOnly?: boolean }} [options]
 * @returns {import('node:child_process').ChildProcessWithoutNullStreams}
 */
function spawnAudioStream(webpageUrl, { opusOnly = false } = {}) {
  return spawn(
    resolveYtdlpPath(),
    [
      webpageUrl,
      '-f',
      opusOnly ? 'bestaudio[acodec=opus]' : 'bestaudio/best',
      '-o',
      '-',
      '--no-playlist',
      '--no-warnings',
      '--quiet',
      '--no-check-certificates',
      // 조회가 쿠키로 통과했어도 스트림 요청에 쿠키가 없으면 여기서 다시 막힌다.
      ...cookieArgs(),
      // 조회를 통과시킨 클라이언트로 스트림도 열어야 한다. 한쪽에만 붙이면
      // 검색은 되는데 재생만 막히는, 원인을 찾기 어려운 상태가 된다.
      ...jsRuntimeArgs(),
      ...extraArgs(),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
}

module.exports = {
  isYoutubeUrl,
  resolveTrack,
  spawnAudioStream,
  describeTrackError,
  cookieArgs,
  extraArgs,
  jsRuntimeArgs,
  splitArgs,
  resolveYtdlpPath,
};
