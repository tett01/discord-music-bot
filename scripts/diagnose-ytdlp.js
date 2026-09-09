#!/usr/bin/env node
// 재생이 실패할 때 원인을 좁힌다. 봇과 **같은 코드 경로**로 조회와 스트림을 시험한다.
//
//   node scripts/diagnose-ytdlp.js [유튜브URL이나 검색어]
//
// 콘솔에 긴 한 줄 명령을 붙여넣기 어려운 호스팅 패널을 위해 파일로 둔다.
// 봇을 띄우지 않으므로 디스코드 토큰이 필요 없다.

// .env를 읽는다. 봇과 같은 설정을 보게 하려는 것이다. 패널 환경변수가 이미
// 있으면 dotenv는 덮어쓰지 않으므로, 봇이 보는 값과 정확히 같아진다.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const youtube = require('../src/youtube');

const TARGET = process.argv[2] || 'https://www.youtube.com/watch?v=jWQx2f-CErU';
const ENOUGH = 300 * 1024; // 이만큼 흘러나오면 재생에 문제가 없다고 본다

const line = (label, value) => console.log(`${label.padEnd(18)} ${value}`);

function version(binary) {
  return new Promise((resolve) => {
    execFile(binary, ['--version'], (error, stdout) => {
      resolve(error ? `확인 실패 (${error.message.split('\n')[0]})` : stdout.trim());
    });
  });
}

/** 봇이 실제로 쓰는 스트림 경로를 열어 바이트가 흘러나오는지 본다. */
function tryStream(url) {
  return new Promise((resolve) => {
    let child;
    try {
      child = youtube.spawnAudioStream(url);
    } catch (error) {
      resolve({ ok: false, bytes: 0, stderr: String(error && error.message) });
      return;
    }

    let bytes = 0;
    let stderr = '';
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes >= ENOUGH) {
        // 충분히 확인했다. 곡 전체를 받을 이유가 없다.
        child.kill();
        finish({ ok: true, bytes, stderr });
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => finish({ ok: false, bytes, stderr: String(error.message) }));
    child.on('close', (code) => finish({ ok: bytes >= ENOUGH, bytes, stderr, code }));
  });
}


/**
 * 조건을 하나씩만 바꿔가며 같은 곡을 받아본다.
 *
 * "손으로 돌리면 되는데 봇에서는 안 된다"를 만났을 때, 두 시도는 대개 **영상도
 * 출력 방식도** 달랐다. 그래서는 무엇이 원인인지 알 수 없다. 여기서는 곡을 고정하고
 * 한 가지씩만 바꾼다.
 *
 * @param {string} url
 */
async function matrix(url) {
  const nodePath = process.execPath;
  const cases = [
    { name: '파일로 저장 (인자 없음)', pipe: false, args: [] },
    { name: '파이프 -o -  (봇과 동일)', pipe: true, args: [] },
    { name: '파이프 + JS런타임', pipe: true, args: ['--js-runtimes', `node:${nodePath}`] },
    { name: '파이프 + tv_embedded', pipe: true, args: ['--extractor-args', 'youtube:player_client=tv_embedded'] },
    { name: '파이프 + web', pipe: true, args: ['--extractor-args', 'youtube:player_client=web'] },
  ];

  const cookies = youtube.cookieArgs();
  if (cookies.length) cases.push({ name: '파이프 + 쿠키', pipe: true, args: cookies });

  console.log('\n\n=== 조건별 비교 (같은 곡, 한 가지씩만 변경) ===\n');

  for (const testCase of cases) {
    const outPath = testCase.pipe ? '-' : path.join(os.tmpdir(), `ytdlp-diag-${Date.now()}.webm`);
    const args = [
      url,
      '-f', 'bestaudio/best',
      '-o', outPath,
      '--no-playlist',
      '--no-check-certificates',
      ...testCase.args,
    ];

    const outcome = await runCase(args, testCase.pipe, outPath);
    console.log(`${testCase.name.padEnd(26)} ${outcome}`);
  }

  console.log('\n읽는 법:');
  console.log('  · 파일은 되는데 파이프만 실패 → 출력 방식 문제 (봇 코드를 고쳐야 함)');
  console.log('  · 전부 실패          → 이 IP에서 이 곡이 막힌 것 (쿠키가 필요함)');
  console.log('  · 특정 클라이언트만 성공 → YTDLP_PLAYER_CLIENT에 그 값을 지정');
}

/**
 * 한 조건을 실행하고 사람이 읽을 한 줄을 만든다.
 * @returns {Promise<string>}
 */
function runCase(args, pipe, outPath) {
  return new Promise((resolve) => {
    const child = spawn(youtube.resolveYtdlpPath(), args, {
      stdio: ['ignore', pipe ? 'pipe' : 'ignore', 'pipe'],
    });

    let bytes = 0;
    let stderr = '';
    let settled = false;

    const cleanup = () => {
      if (pipe) return;
      try {
        bytes = fs.statSync(outPath).size;
        fs.unlinkSync(outPath);
      } catch {
        // 파일이 없으면 0바이트 그대로 둔다. 실패로 보고된다.
      }
    };

    const finish = (text) => {
      if (settled) return;
      settled = true;
      resolve(text);
    };

    if (pipe) {
      child.stdout.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes >= ENOUGH) {
          child.kill();
          finish(`✅ 성공 (${bytes.toLocaleString()} 바이트)`);
        }
      });
    }

    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2048);
    });

    child.on('error', (error) => finish(`❌ 실행 실패 — ${error.message}`));
    child.on('close', () => {
      cleanup();
      if (bytes >= ENOUGH) {
        finish(`✅ 성공 (${bytes.toLocaleString()} 바이트)`);
        return;
      }
      const reason =
        (stderr.match(/HTTP Error \d+[^\n]*/) ||
          stderr.match(/ERROR:[^\n]*/) || ['원인 불명'])[0];
      finish(`❌ ${reason.trim().slice(0, 90)}`);
    });
  });
}

async function main() {
  console.log('=== yt-dlp 진단 ===\n');

  const binary = youtube.resolveYtdlpPath();
  line('봇이 쓰는 경로', binary);
  line('버전', await version(binary));

  // extraArgs는 나중에 추가된 것이라, 낡은 youtube.js에서도 돌도록 감싼다.
  const extra = typeof youtube.extraArgs === 'function' ? youtube.extraArgs() : null;
  line('추가 인자', extra === null ? '(이 버전에는 없는 기능)' : JSON.stringify(extra));
  line('쿠키 인자', JSON.stringify(youtube.cookieArgs()));
  line('AUDIO_ENGINE', process.env.AUDIO_ENGINE || '(기본: auto)');
  console.log();

  line('대상', TARGET);
  let track;
  try {
    track = await youtube.resolveTrack(TARGET);
    line('① 조회', `성공 — ${track.title}`);
  } catch (error) {
    line('① 조회', `실패 — ${error.message.split('\n').slice(-3).join(' ')}`);
    console.log('\n조회부터 막혔습니다. 위 메시지가 원인입니다.');
    process.exit(1);
  }

  const result = await tryStream(track.url);
  if (result.ok) {
    line('② 스트림', `성공 — ${result.bytes.toLocaleString()} 바이트 수신`);
    console.log('\n✅ 봇이 쓰는 경로로 오디오가 정상적으로 흘러나옵니다.');
    console.log('   그래도 재생이 안 된다면 yt-dlp가 아니라 음성 연결 쪽 문제입니다.');
    return;
  }

  line('② 스트림', `실패 — ${result.bytes.toLocaleString()} 바이트에서 종료 (code=${result.code})`);
  console.log('\n❌ 조회는 되는데 스트림만 막혔습니다. yt-dlp가 남긴 마지막 메시지입니다.\n');
  console.log(result.stderr.trim().split('\n').slice(-8).join('\n'));

  await matrix(track.url);
  process.exit(1);
}

main().catch((error) => {
  console.error('진단 중 오류:', error);
  process.exit(1);
});
