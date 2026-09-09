// 같은 곡을 조건만 바꿔가며 받아보고 무엇이 원인인지 좁힌다.
//
// "손으로 돌리면 되는데 봇에서는 안 된다"를 쫓을 때, 두 시도는 대개 **영상도 출력
// 방식도** 달랐다. 그래서는 어느 쪽이 원인인지 알 수 없다. 여기서는 곡을 고정하고
// 한 가지씩만 바꾼다.
//
// [scripts/diagnose-ytdlp.js](../scripts/diagnose-ytdlp.js)가 손으로 부르고,
// musicManager가 403을 만나면 자동으로 한 번 부른다. **호스팅 패널에서 셸을 쓰기
// 어려운 경우가 많아, 로그만 보고도 판단할 수 있어야 한다.**
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveYtdlpPath, cookieArgs, cookieStatus } = require('./youtube');

// 이만큼 흘러나오면 재생에 문제가 없다고 본다. 곡 전체를 받을 이유가 없다.
const ENOUGH = 300 * 1024;

/** 한 조건을 실행하고 결과를 사람이 읽을 수 있게 만든다. */
function runCase(args, pipe, outPath) {
  return new Promise((resolve) => {
    const child = spawn(resolveYtdlpPath(), args, {
      stdio: ['ignore', pipe ? 'pipe' : 'ignore', 'pipe'],
    });

    let bytes = 0;
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    if (pipe) {
      child.stdout.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes >= ENOUGH) {
          child.kill();
          finish({ ok: true, detail: `${bytes.toLocaleString()} 바이트` });
        }
      });
    }

    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2048);
    });

    child.on('error', (error) => finish({ ok: false, detail: `실행 실패 — ${error.message}` }));
    child.on('close', () => {
      if (!pipe) {
        try {
          bytes = fs.statSync(outPath).size;
          fs.unlinkSync(outPath);
        } catch {
          // 파일이 없으면 0바이트 그대로 둔다. 실패로 보고된다.
        }
      }

      if (bytes >= ENOUGH) {
        finish({ ok: true, detail: `${bytes.toLocaleString()} 바이트` });
        return;
      }

      const match = stderr.match(/HTTP Error \d+[^\n]*/) || stderr.match(/ERROR:[^\n]*/);
      finish({ ok: false, detail: (match ? match[0] : '원인 불명').trim().slice(0, 90) });
    });
  });
}

/**
 * 조건별로 받아보고 결과 배열을 돌려준다.
 * @param {string} url
 * @returns {Promise<Array<{name: string, ok: boolean, detail: string}>>}
 */
async function probe(url) {
  const cases = [
    { name: '파일로 저장 (인자 없음)', pipe: false, args: [] },
    { name: '파이프 -o -  (봇과 동일)', pipe: true, args: [] },
    { name: '파이프 + JS런타임', pipe: true, args: ['--js-runtimes', `node:${process.execPath}`] },
    { name: '파이프 + tv_embedded', pipe: true, args: ['--extractor-args', 'youtube:player_client=tv_embedded'] },
    { name: '파이프 + web_safari', pipe: true, args: ['--extractor-args', 'youtube:player_client=web_safari'] },
    { name: '파이프 + android_vr', pipe: true, args: ['--extractor-args', 'youtube:player_client=android_vr'] },
  ];

  const cookies = cookieArgs();
  if (cookies.length) cases.push({ name: '파이프 + 쿠키', pipe: true, args: cookies });

  const results = [];
  for (const testCase of cases) {
    const outPath = testCase.pipe
      ? '-'
      : path.join(os.tmpdir(), `ytdlp-probe-${process.pid}-${results.length}.webm`);

    const outcome = await runCase(
      [url, '-f', 'bestaudio/best', '-o', outPath, '--no-playlist', '--no-check-certificates', ...testCase.args],
      testCase.pipe,
      outPath
    );
    results.push({ name: testCase.name, ...outcome });
  }

  return results;
}

/**
 * 결과를 로그에 그대로 붙일 수 있는 여러 줄 문자열로 만든다.
 *
 * 표만 있으면 무엇을 해야 할지 알기 어려우므로 해석까지 같이 낸다.
 * @param {Array<{name: string, ok: boolean, detail: string}>} results
 * @returns {string}
 */
function formatProbe(results) {
  const lines = ['=== yt-dlp 조건별 비교 (같은 곡, 한 가지씩만 변경) ===', `  ${cookieStatus()}`, ''];
  for (const r of results) {
    lines.push(`  ${r.name.padEnd(26)} ${r.ok ? '성공' : '실패'}  ${r.detail}`);
  }

  const byName = (needle) => results.find((r) => r.name.includes(needle));
  const file = byName('파일로 저장');
  const pipe = byName('봇과 동일');
  const working = results.filter((r) => r.ok && r.name.includes('+'));

  lines.push('');
  if (pipe && pipe.ok) {
    // 봇과 같은 조건이 지금은 되는데 재생은 실패했다면, 곡이나 시점의 문제다.
    lines.push('→ 봇과 같은 조건이 여기서는 성공했습니다. 곡마다 갈리거나 일시적인 차단입니다.');
    lines.push('  같은 곡으로 다시 재생해보고, 계속 실패하면 쿠키를 설정하세요.');
  } else if (file && file.ok && pipe && !pipe.ok) {
    lines.push('→ 파일은 되는데 파이프만 막혔습니다. 출력 방식 문제입니다.');
  } else if (results.every((r) => !r.ok)) {
    lines.push('→ 전부 막혔습니다. 이 IP에서 이 곡이 차단된 것이라 쿠키가 필요합니다.');
    lines.push('  (YTDLP_COOKIES에 Netscape 형식 cookies.txt 경로를 지정하세요)');
  } else if (working.length) {
    const hint = working[0].name.replace('파이프 + ', '');
    lines.push(`→ "${hint}" 조건에서 성공했습니다. 이 값을 지정하면 재생됩니다.`);
    if (!hint.includes('쿠키') && !hint.includes('JS런타임')) {
      lines.push(`  YTDLP_PLAYER_CLIENT=${hint}`);
    }
  } else {
    lines.push('→ 결과가 엇갈립니다. 이 표를 그대로 알려주세요.');
  }

  return lines.join('\n');
}

module.exports = { probe, formatProbe };
