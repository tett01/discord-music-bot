const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getExistingPlayer } = require('../musicManager');

module.exports = {
  musicCommand: true,
  data: new SlashCommandBuilder().setName('대기열').setDescription('현재 재생 대기열을 확인합니다.'),

  async execute(interaction) {
    const player = getExistingPlayer(interaction.guildId);
    if (!player || (!player.current && player.queue.length === 0)) {
      return interaction.reply({ content: '대기열이 비어 있습니다.', flags: MessageFlags.Ephemeral });
    }

    const lines = [];
    if (player.current) {
      lines.push(`▶️ 현재 재생 중: **${player.current.title}**`);
    }
    if (player.queue.length > 0) {
      lines.push('');
      lines.push('**대기열:**');
      player.queue.forEach((track, index) => {
        lines.push(`${index + 1}. ${track.title}`);
      });
    }
    lines.push('');
    lines.push(`반복 모드: ${player.loopMode} | 음량: ${player.volume}%`);

    return interaction.reply(lines.join('\n'));
  },
};
