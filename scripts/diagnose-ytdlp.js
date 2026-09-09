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

const { execFile } = require('node:child_process');
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

  const { probe, formatProbe } = require('../src/ytdlpProbe');
  console.log('\n');
  console.log(formatProbe(await probe(track.url)));
  process.exit(1);
}

main().catch((error) => {
  console.error('진단 중 오류:', error);
  process.exit(1);
});
