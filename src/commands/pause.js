const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getExistingPlayer } = require('../musicManager');

module.exports = {
  musicCommand: true,
  data: new SlashCommandBuilder().setName('일시정지').setDescription('현재 재생 중인 음악을 일시정지합니다.'),

  async execute(interaction) {
    const player = getExistingPlayer(interaction.guildId);
    if (!player || !player.current) {
      return interaction.reply({ content: '재생 중인 음악이 없습니다.', flags: MessageFlags.Ephemeral });
    }
    player.pause();
    return interaction.reply('⏸️ 일시정지했습니다.');
  },
};
