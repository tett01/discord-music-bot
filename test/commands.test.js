// 테스트 프레임워크 없이 Node 내장 러너(node --test)만 쓴다. 의존성을 늘리지 않기 위해서다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadCommands } = require('../src/loadCommands');

const commandsDir = path.join(__dirname, '..', 'src', 'commands');
const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'));

// musicCommand: false 여도 되는 명령어. 여기 없는 명령어가 false면 텍스트 채널 제한을
// 우회하게 되므로 테스트가 실패한다.
const NON_MUSIC_COMMANDS = new Set(['setchannel.js']);

const commands = loadCommands();

test('모든 명령어 파일이 실제로 등록된다', () => {
  // loadCommands는 data.name이나 execute가 없으면 조용히 건너뛴다.
  // 파일 수와 등록 수가 어긋나면 어느 파일이 누락됐는지 짚어준다.
  const skipped = files.filter((file) => {
    const command = require(path.join(commandsDir, file));
    return !command?.data?.name || typeof command.execute !== 'function';
  });

  assert.deepEqual(skipped, [], `data.name 또는 execute가 없어 등록되지 않는 파일: ${skipped.join(', ')}`);
  assert.equal(commands.size, files.length);
});

test('명령어 이름이 중복되지 않는다', () => {
  // Map은 같은 이름을 덮어쓰므로 size 비교만으로는 충돌을 못 잡는다.
  const names = files.map((file) => require(path.join(commandsDir, file)).data.name);
  assert.equal(new Set(names).size, names.length, `중복된 명령어 이름: ${names.join(', ')}`);
});

test('musicCommand 플래그가 명시되어 있다', () => {
  for (const file of files) {
    const command = require(path.join(commandsDir, file));
    assert.equal(
      typeof command.musicCommand,
      'boolean',
      `${file}: musicCommand가 boolean이 아님 (누락 시 falsy로 취급되어 채널 제한을 우회함)`
    );

    if (!NON_MUSIC_COMMANDS.has(file)) {
      assert.equal(command.musicCommand, true, `${file}: 음악 명령어인데 musicCommand가 true가 아님`);
    }
  }
});

test('deploy에 보낼 JSON으로 직렬화된다', () => {
  // npm run deploy가 하는 일과 같다. 여기서 터지면 실제 등록도 터진다.
  for (const [name, command] of commands) {
    const json = command.data.toJSON();
    assert.equal(json.name, name);
    assert.ok(json.description?.length > 0, `${name}: 설명이 비어 있음`);
  }
});

test('명령어 이름과 옵션 이름이 한국어 관례를 따른다', () => {
  const hasKorean = (text) => /[가-힣]/.test(text);

  for (const [name, command] of commands) {
    assert.ok(hasKorean(name), `/${name}: 명령어 이름이 한국어가 아님`);

    for (const option of command.data.toJSON().options ?? []) {
      // 서브커맨드(type 1)와 그룹(type 2)은 자식 옵션까지 확인한다.
      const children = option.type === 1 || option.type === 2 ? (option.options ?? []) : [];
      for (const child of [option, ...children]) {
        assert.ok(hasKorean(child.name), `/${name}: 옵션 '${child.name}'이 한국어가 아님`);
      }
    }
  }
});
