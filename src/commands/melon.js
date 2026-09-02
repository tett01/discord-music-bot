const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getPlayer } = require('../musicManager');
const { resolveTrack, describeTrackError } = require('../source');
const { getCachedChart, refreshMelonChart, CHART_SIZE } = require('../melon');

module.exports = {
  musicCommand: true,
  data: new SlashCommandBuilder()
    .setName('멜론차트')
    .setDescription(`멜론 인기차트 TOP ${CHART_SIZE}을 대기열에 추가하고 재생합니다.`),

  async execute(interaction) {
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '먼저 음성 채널에 입장해주세요.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    // 캐시는 1시간마다 채워지지만, 봇 기동 직후나 갱신이 연달아 실패한 뒤에는 비어 있다.
    // 그때만 즉석에서 한 번 더 시도한다.
    let { tracks, updatedAt } = getCachedChart();
    if (tracks.length === 0) {
      await refreshMelonChart();
      ({ tracks, updatedAt } = getCachedChart());
    }
    if (tracks.length === 0) {
      return interaction.editReply('멜론 차트를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    }

    const player = getPlayer(interaction.guildId, interaction.channel);
    try {
      await player.join(voiceChannel);
    } catch (error) {
      console.error('[멜론차트] 음성 연결 실패:', error);
      return interaction.editReply(error.message);
    }

    const added = [];
    const failed = [];

    // 곡마다 yt-dlp 검색이 붙어 10곡이면 십수 초가 걸린다. 진행 상황을 갱신해
    // 봇이 멈춘 것처럼 보이지 않게 한다.
    for (const song of tracks) {
      try {
        const track = await resolveTrack(`${song.artist} ${song.title}`);
        await player.enqueue(track);
        added.push(song);
      } catch (error) {
        console.error(`[멜론차트] ${song.artist} - ${song.title} 검색 실패:`, error.message);
        failed.push({ ...song, reason: describeTrackError(error) });
      }
      await interaction
        .editReply(`🍈 멜론 차트를 대기열에 담는 중… (${added.length + failed.length}/${tracks.length})`)
        .catch(() => {});
    }

    if (added.length === 0) {
      return interaction.editReply('멜론 차트의 곡을 하나도 재생할 수 없었습니다.');
    }

    const lines = added.map((song) => `\`${String(song.rank).padStart(2)}.\` ${song.artist} - ${song.title}`);
    let message = `🍈 **멜론 인기차트 TOP ${tracks.length}** (${added.length}곡 추가)\n${lines.join('\n')}`;
    if (failed.length > 0) {
      message += `\n\n⚠️ 추가하지 못한 곡: ${failed.map((song) => `${song.title}`).join(', ')}`;
    }
    if (updatedAt) {
      message += `\n-# 기준 시각: <t:${Math.floor(updatedAt.getTime() / 1000)}:R>`;
    }

    return interaction.editReply(message);
  },
};
