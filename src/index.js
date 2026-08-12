// pm2 등으로 실행할 때 작업 디렉토리가 달라져도 .env를 찾도록 절대경로로 지정한다.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
// db.js가 node:sqlite를 require하기 전에 본다. 순서를 바꾸면 알아보기 힘든 오류로 죽는다.
require('./nodeVersion').assertNodeVersion();
const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const { loadCommands } = require('./loadCommands');
const { getGuildSettings } = require('./db');
const { destroyAllPlayers } = require('./musicManager');
const { startMelonChartRefresh, stopMelonChartRefresh } = require('./melon');

const { DISCORD_TOKEN } = process.env;

if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN을 .env 파일에 설정해주세요.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const commands = loadCommands();

client.once(Events.ClientReady, (c) => {
  console.log(`✅ 로그인 완료: ${c.user.tag}`);
  // 즉시 한 번 받고 이후 1시간마다 갱신한다. /멜론차트는 이 캐시만 읽는다.
  startMelonChartRefresh();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  if (!interaction.guildId) {
    return interaction.reply({ content: '이 명령어는 서버 내에서만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral });
  }

  if (command.musicCommand) {
    const settings = getGuildSettings(interaction.guildId);
    if (settings.text_channel_id && settings.text_channel_id !== interaction.channelId) {
      return interaction.reply({
        content: `음악 명령어는 <#${settings.text_channel_id}> 채널에서만 사용할 수 있습니다.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[명령어 오류] /${interaction.commandName}:`, error);
    const payload = { content: '명령어 실행 중 오류가 발생했습니다.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

// Ctrl+C 등으로 종료할 때 음성 연결을 정리하고 나간다.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} 수신 — 정리 후 종료합니다.`);
  try {
    stopMelonChartRefresh();
    destroyAllPlayers();
    await client.destroy();
  } catch (error) {
    console.error('종료 중 오류:', error);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(DISCORD_TOKEN);
