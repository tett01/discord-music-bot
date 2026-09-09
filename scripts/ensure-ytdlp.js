#!/usr/bin/env node
// yt-dlp 바이너리를 bin/에 확보한다. package.json의 postinstall에서 돌린다.
//
// 원래는 yt-dlp-exec가 이 역할을 했는데, 그 패키지의 postinstall이 python 존재를
// 검사한다. python이 없는 호스팅 컨테이너에서는 여기서 npm install 전체가 중단되어
// node_modules가 통째로 안 생긴다. 그래서 yt-dlp-exec는 optionalDependencies로 내리고,
// 실패했을 때 쓸 standalone 바이너리를 여기서 직접 받는다.
//
// 받는 것은 PyInstaller로 묶인 standalone 빌드다. 릴리스의 `yt-dlp`(확장자 없음)는
// python zipapp이라 실행에 python이 필요하므로 쓰면 안 된다.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

const BIN_DIR = path.join(__dirname, '..', 'bin');
const TARGET = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

/**
 * 현재 플랫폼에 맞는 standalone 빌드의 파일 이름을 고른다.
 * @returns {string | null} 지원하지 않는 플랫폼이면 null
 */
function assetName() {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.platform === 'linux') {
    return os.arch() === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  }
  return null;
}

/**
 * 이미 쓸 수 있는 yt-dlp가 있으면 내려받지 않는다.
 * @returns {string | null} 건너뛰는 이유. 받아야 하면 null
 */
function skipReason() {
  // play-dl만 쓰기로 한 배포(무료 호스팅 등)에서는 40MB짜리 바이너리를 받을 이유가 없다.
  // 디스크와 빌드 시간을 아끼려면 SKIP_YTDLP_DOWNLOAD=1을 준다.
  if (String(process.env.SKIP_YTDLP_DOWNLOAD || '').trim() === '1') return 'SKIP_YTDLP_DOWNLOAD=1';

  // 유튜브가 뭔가 바꾸면 낡은 바이너리는 조회까지만 되고 다운로드가 403으로 막힌다.
  // 그런데 아래 "이미 있습니다"에 걸려 npm install을 다시 돌려도 갱신되지 않는다.
  // `npm run update-ytdlp`이 이 변수를 세워 그 문을 연다.
  if (String(process.env.FORCE_YTDLP_DOWNLOAD || '').trim() === '1') return null;

  if ((process.env.AUDIO_ENGINE || '').trim().toLowerCase() === 'playdl') return 'AUDIO_ENGINE=playdl';
  if ((process.env.YTDLP_PATH || '').trim()) return 'YTDLP_PATH가 지정되어 있습니다';
  if (fs.existsSync(TARGET)) return `이미 있습니다: ${TARGET}`;

  try {
    const { YOUTUBE_DL_PATH } = require('yt-dlp-exec/src/constants');
    if (fs.existsSync(YOUTUBE_DL_PATH)) return 'yt-dlp-exec가 설치되어 있습니다';
  } catch {
    // yt-dlp-exec 설치에 실패한 환경. 이게 이 스크립트가 존재하는 이유다.
  }

  return null;
}

/**
 * 리다이렉트를 따라가며 파일을 받는다.
 * @param {string} url
 * @param {string} destination
 * @returns {Promise<void>}
 */
async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  // 받다 만 파일이 남으면 다음 실행이 "이미 있음"으로 건너뛰므로 임시 파일에 받고 옮긴다.
  const temporary = `${destination}.download`;
  fs.writeFileSync(temporary, buffer);
  fs.renameSync(temporary, destination);
}

async function main() {
  const skip = skipReason();
  if (skip) {
    console.log(`[yt-dlp] 건너뜁니다 — ${skip}`);
    return;
  }

  const asset = assetName();
  if (!asset) {
    console.warn(`[yt-dlp] 지원하지 않는 플랫폼입니다: ${process.platform}. 직접 설치한 뒤 YTDLP_PATH를 지정하세요.`);
    return;
  }

  fs.mkdirSync(BIN_DIR, { recursive: true });

  const url = `${RELEASE_BASE}/${asset}`;
  console.log(`[yt-dlp] 내려받는 중: ${url}`);
  await download(url, TARGET);
  if (process.platform !== 'win32') fs.chmodSync(TARGET, 0o755);
  console.log(`[yt-dlp] 준비 완료: ${TARGET}`);
}

main().catch((error) => {
  // 여기서 실패해도 설치를 중단시키지 않는다. 중단시키면 이 스크립트를 만든 이유가
  // 없어진다. 재생을 시도할 때 describeTrackError가 사유를 알려준다.
  console.warn(`[yt-dlp] 내려받지 못했습니다: ${error.message}`);
  console.warn('[yt-dlp] 재생이 실패하면 바이너리를 직접 넣고 YTDLP_PATH를 지정하세요.');
});
