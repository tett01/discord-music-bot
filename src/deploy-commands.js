require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./loadCommands');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('DISCORD_TOKEN과 CLIENT_ID를 .env 파일에 설정해주세요.');
  process.exit(1);
}

async function main() {
  const commands = [...loadCommands().values()].map((c) => c.data.toJSON());
  const rest = new REST().setToken(DISCORD_TOKEN);

  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);

  console.log(`슬래시 명령어 ${commands.length}개를 등록합니다... (${GUILD_ID ? '길드 전용' : '전역'})`);
  await rest.put(route, { body: commands });
  console.log('명령어 등록이 완료되었습니다.');
}

main().catch((error) => {
  console.error('명령어 등록 중 오류가 발생했습니다:', error);
  process.exit(1);
});
