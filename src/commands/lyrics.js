const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getExistingPlayer } = require('../musicManager');
const { getLyrics, lyricsDisabled } = require('../lyrics');

// 가사판 위치 선택지. value는 musicManager.setLyricsMode가 받는 값과 같아야 한다.
const TARGET_LABELS = {
  voice: '음성 채널 채팅',
  text: '이 채널',
};

module.exports = {
  musicCommand: true,
  data: new SlashCommandBuilder()
    .setName('가사')
    .setDescription('재생 중인 곡의 가사를 실시간으로 표시합니다.')
    .addSubcommand((sub) =>
      sub
        .setName('표시')
        .setDescription('가사판을 띄우고 곡에 맞춰 따라갑니다.')
        .addStringOption((option) =>
          option
            .setName('위치')
            .setDescription('가사판을 띄울 곳 (기본: 음성 채널 채팅)')
            .addChoices(
              { name: '음성 채널 채팅', value: 'voice' },
              { name: '이 채널', value: 'text' }
            )
        )
    )
    .addSubcommand((sub) => sub.setName('끄기').setDescription('가사판을 닫고 자동 표시를 멈춥니다.'))
    .addSubcommand((sub) => sub.setName('전체').setDescription('현재 곡의 가사 전문을 한 번만 보여줍니다.')),

  async execute(interaction) {
    if (lyricsDisabled()) {
      return interaction.reply({
        content: '이 봇에서는 가사 기능이 꺼져 있습니다. (`DISABLE_LYRICS=1`)',
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    // 재생 중이어야만 의미가 있는 명령어라 getExistingPlayer를 쓴다.
    const player = getExistingPlayer(interaction.guildId);

    if (sub === '끄기') {
      if (!player) {
        return interaction.reply({ content: '표시 중인 가사가 없습니다.', flags: MessageFlags.Ephemeral });
      }
      player.setLyricsMode(false);
      return interaction.reply({ content: '🎤 가사 표시를 껐습니다.', flags: MessageFlags.Ephemeral });
    }

    if (!player?.current) {
      return interaction.reply({ content: '재생 중인 곡이 없습니다.', flags: MessageFlags.Ephemeral });
    }

    const track = player.current;

    if (sub === '전체') {
      // 캐시에 없으면 조회에 몇 초가 걸린다.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const lyrics = await getLyrics(track);
      const body = lyrics?.plain ?? lyrics?.synced?.map((line) => line.text).join('\n');
      if (!body?.trim()) {
        return interaction.editReply(`**${track.title}**\n가사를 찾지 못했습니다.`);
      }
      // 디스코드 메시지 상한(2000자)에 맞춘다. 긴 곡은 잘라낸다.
      const clipped = body.length > 1900 ? `${body.slice(0, 1900)}\n…` : body;
      return interaction.editReply(`🎤 **${track.title}**\n${clipped}`);
    }

    // 표시
    const target = interaction.options.getString('위치') ?? 'voice';
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const lyrics = await getLyrics(track);
    if (!lyrics) {
      return interaction.editReply(`**${track.title}**\n가사를 찾지 못했습니다.`);
    }

    // 위치를 'text'로 골랐으면 명령어를 친 채널이 기준이 된다.
    if (target === 'text') player.textChannel = interaction.channel;
    player.setLyricsMode(true, target);
    player.showLyricsNow();

    // 음성 채널을 골랐어도 쓸 권한이 없으면 텍스트 채널로 떨어진다. 실제로 띄운 곳을 알린다.
    const channel = player.lyricsChannel();
    const where = channel ? `<#${channel.id}>` : TARGET_LABELS[player.lyricsTarget];
    const note = lyrics.synced
      ? '곡에 맞춰 가사가 따라갑니다.'
      : '이 곡은 동기 가사가 없어 전문만 표시됩니다.';

    return interaction.editReply(`🎤 ${where} 에 가사판을 띄웠습니다.\n${note}\n-# 다음 곡부터도 자동으로 표시됩니다. 끄려면 \`/가사 끄기\``);
  },
};
