// pm2 등으로 실행할 때 작업 디렉토리가 달라져도 .env를 찾도록 절대경로로 지정한다.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
// db.js가 node:sqlite를 require하기 전에 본다. 순서를 바꾸면 알아보기 힘든 오류로 죽는다.
require('./nodeVersion').assertNodeVersion();
const { Client, GatewayIntentBits, Events, MessageFlags, Options } = require('discord.js');
const { loadCommands } = require('./loadCommands');
const { getGuildSettings } = require('./db');
const { destroyAllPlayers } = require('./musicManager');
const { startMelonChartRefresh, stopMelonChartRefresh } = require('./melon');
const { startKeepAlive, stopKeepAlive } = require('./keepalive');
const { initPlayDl } = require('./playdl');
const { selectedEngine } = require('./source');
const { cookieStatus = () => '쿠키: 상태를 알 수 없습니다' } = require('./youtube');

const { DISCORD_TOKEN } = process.env;

if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN을 .env 파일에 설정해주세요.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],

  // 512MB짜리 무료 인스턴스에서는 discord.js의 기본 캐시가 만만치 않게 먹는다.
  // 이 봇이 쓰지 않는 캐시를 전부 0으로 막는다. (서버가 늘어날수록 차이가 커진다)
  //
  // ⚠️ GuildMemberManager와 UserManager는 **절대 0으로 두면 안 된다.**
  // musicManager.join()이 "지금 채널에 듣는 사람이 있는지"를 channel.members로 판단하는데,
  // 멤버 캐시가 비면 항상 0명으로 보여 사람이 듣고 있는 채널에서 봇이 빠져나간다.
  // discord.js 자체도 이 두 매니저를 0으로 두는 것을 지원하지 않는다.
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    AutoModerationRuleManager: 0,
    BaseGuildEmojiManager: 0,
    GuildBanManager: 0,
    GuildEmojiManager: 0,
    GuildForumThreadManager: 0,
    GuildInviteManager: 0,
    GuildMessageManager: 0,
    GuildScheduledEventManager: 0,
    GuildStickerManager: 0,
    GuildTextThreadManager: 0,
    MessageManager: 0,
    PresenceManager: 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    StageInstanceManager: 0,
    ThreadManager: 0,
    ThreadMemberManager: 0,
  }),

  // 캐시를 막아도 장시간 돌면 스레드 같은 것이 조금씩 쌓인다. 주기적으로 걷어낸다.
  sweepers: {
    ...Options.DefaultSweeperSettings,
    threads: { interval: 3600, lifetime: 1800 },
  },
});

const commands = loadCommands();

let ready = false;

client.once(Events.ClientReady, (c) => {
  ready = true;
  console.log(`✅ 로그인 완료: ${c.user.tag}`);
  console.log(`🎧 오디오 엔진: ${selectedEngine()}`);
  // 쿠키를 설정했는데 왜 그대로냐고 헤매지 않도록 부팅 때 상태를 밝힌다.
  //
  // 파일을 하나씩 올리는 호스팅에서는 src/가 잠시 섞인 상태가 된다. **진단용 한 줄
  // 때문에 봇이 부팅을 못 하는 일은 없어야 한다.** 실제로 youtube.js만 낡은 채로
  // 남았을 때 여기서 TypeError로 죽어 서버가 내려갔다.
  try {
    console.log(`🍪 ${cookieStatus()}`);
  } catch (error) {
    console.warn('🍪 쿠키 상태를 확인하지 못했습니다 (src/youtube.js가 낡았을 수 있습니다):', error.message);
  }
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
    stopKeepAlive();
    destroyAllPlayers();
    await client.destroy();
  } catch (error) {
    console.error('종료 중 오류:', error);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 무료 호스팅은 요청이 없으면 인스턴스를 재운다. UptimeRobot이 5분마다 때릴 수 있도록
// 로그인보다 **먼저** 포트를 연다. Render는 일정 시간 안에 포트가 열리지 않으면 배포를
// 실패로 처리하는데, 디스코드 로그인이 늦어지는 동안 그 시간이 지나갈 수 있다.
startKeepAlive({
  status: () => ({ ready, guilds: client.guilds.cache.size }),
});

// play-dl에 쿠키/UA를 물린다. 첫 재생 전에 끝나 있어야 한다.
initPlayDl();

// 장시간 무인 운영에서는 처리되지 않은 rejection 하나로 프로세스가 죽는다.
// 로그만 남기고 살려 두는 편이 24시간 가동에 유리하다. (진짜 원인은 로그로 추적한다)
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

client.login(DISCORD_TOKEN);
