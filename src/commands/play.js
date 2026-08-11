const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getPlayer } = require('../musicManager');
const { resolveTrack, describeTrackError } = require('../youtube');

module.exports = {
  musicCommand: true,
  data: new SlashCommandBuilder()
    .setName('재생')
    .setDescription('유튜브 링크나 검색어로 음악을 재생합니다.')
    .addStringOption((option) =>
      option.setName('검색어').setDescription('유튜브 링크 또는 검색어').setRequired(true)
    ),

  async execute(interaction) {
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '먼저 음성 채널에 입장해주세요.', flags: MessageFlags.Ephemeral });
    }

    const query = interaction.options.getString('검색어', true);
    await interaction.deferReply();

    let track;
    try {
      track = await resolveTrack(query);
    } catch (error) {
      console.error('[재생] 트랙 검색 실패:', error);
      return interaction.editReply(describeTrackError(error));
    }

    const player = getPlayer(interaction.guildId, interaction.channel);

    try {
      await player.join(voiceChannel);
    } catch (error) {
      console.error('[재생] 음성 연결 실패:', error);
      return interaction.editReply(error.message);
    }

    await player.enqueue(track);

    if (player.current === track) {
      return interaction.editReply(`🎵 지금 재생합니다: **${track.title}**`);
    }

    const position = player.queue.indexOf(track);
    if (position === -1) {
      return interaction.editReply(`재생을 시작하지 못했습니다: **${track.title}**`);
    }
    return interaction.editReply(`➕ 대기열에 추가되었습니다 (#${position + 1}): **${track.title}**`);
  },
};
