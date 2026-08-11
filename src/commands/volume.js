const { SlashCommandBuilder } = require('discord.js');
const { getPlayer } = require('../musicManager');

module.exports = {
  musicCommand: true,
  data: new SlashCommandBuilder()
    .setName('음량')
    .setDescription('재생 음량을 설정합니다. (0~150)')
    .addIntegerOption((option) =>
      option.setName('크기').setDescription('음량 (0~150)').setRequired(true).setMinValue(0).setMaxValue(150)
    ),

  async execute(interaction) {
    const level = interaction.options.getInteger('크기', true);
    const player = getPlayer(interaction.guildId, interaction.channel);
    player.setVolume(level);
    return interaction.reply(`🔊 음량을 **${level}%**로 설정했습니다.`);
  },
};
