const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getExistingPlayer } = require('../musicManager');

module.exports = {
  musicCommand: true,
  data: new SlashCommandBuilder().setName('재개').setDescription('일시정지된 음악을 다시 재생합니다.'),

  async execute(interaction) {
    const player = getExistingPlayer(interaction.guildId);
    if (!player || !player.current) {
      return interaction.reply({ content: '재생 중인 음악이 없습니다.', flags: MessageFlags.Ephemeral });
    }
    player.resume();
    return interaction.reply('▶️ 다시 재생합니다.');
  },
};
