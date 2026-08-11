// 모든 소스 파일을 `node --check`로 구문 검사한다.
// index.js처럼 DISCORD_TOKEN이 없으면 즉시 종료해버려서 require로는 검증할 수 없는
// 파일까지 확인하기 위한 단계다. 윈도우/리눅스 양쪽에서 같은 명령으로 돌도록 JS로 짰다.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const TARGET_DIRS = ['src', 'scripts', 'test'];
const ROOT_FILES = ['ecosystem.config.js'];

function collect(dir) {
  const absolute = path.join(root, dir);
  if (!fs.existsSync(absolute)) return [];

  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return collect(relative);
    return entry.name.endsWith('.js') ? [relative] : [];
  });
}

const targets = [...TARGET_DIRS.flatMap(collect), ...ROOT_FILES.filter((f) => fs.existsSync(path.join(root, f)))];

let failed = 0;
for (const file of targets) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
  } catch (error) {
    failed += 1;
    console.error(`✖ ${file}\n${String(error.stderr ?? error.message).trim()}\n`);
  }
}

if (failed > 0) {
  console.error(`구문 오류 ${failed}건 — 검사한 파일 ${targets.length}개`);
  process.exit(1);
}

console.log(`✔ 구문 검사 통과 — 파일 ${targets.length}개`);
