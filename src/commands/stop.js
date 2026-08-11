const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getExistingPlayer } = require('../musicManager');

module.exports = {
  musicCommand: true,
  data: new SlashCommandBuilder()
    .setName('정지')
    .setDescription('음악을 정지하고 대기열을 비운 뒤 음성 채널에서 나갑니다.'),

  async execute(interaction) {
    const player = getExistingPlayer(interaction.guildId);
    if (!player) {
      return interaction.reply({ content: '재생 중인 음악이 없습니다.', flags: MessageFlags.Ephemeral });
    }
    player.destroy();
    return interaction.reply('⏹️ 재생을 정지하고 음성 채널에서 나갔습니다.');
  },
};
