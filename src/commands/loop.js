const { SlashCommandBuilder } = require('discord.js');
const { getPlayer } = require('../musicManager');

module.exports = {
  musicCommand: true,
  data: new SlashCommandBuilder()
    .setName('반복')
    .setDescription('반복 재생 모드를 설정합니다.')
    .addStringOption((option) =>
      option
        .setName('모드')
        .setDescription('반복 모드')
        .setRequired(true)
        .addChoices(
          { name: '끄기', value: 'off' },
          { name: '현재 곡 반복', value: 'song' },
          { name: '전체 곡(대기열) 반복', value: 'queue' }
        )
    ),

  async execute(interaction) {
    const mode = interaction.options.getString('모드', true);
    const player = getPlayer(interaction.guildId, interaction.channel);
    player.setLoopMode(mode);

    const labels = { off: '반복 끄기', song: '현재 곡 반복', queue: '전체 곡 반복' };
    return interaction.reply(`🔁 반복 모드: **${labels[mode]}**`);
  },
};
