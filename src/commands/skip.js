const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getExistingPlayer } = require('../musicManager');

module.exports = {
  musicCommand: true,
  data: new SlashCommandBuilder().setName('다음곡').setDescription('현재 곡을 건너뛰고 다음 곡을 재생합니다.'),

  async execute(interaction) {
    const player = getExistingPlayer(interaction.guildId);
    if (!player || !player.current) {
      return interaction.reply({ content: '재생 중인 음악이 없습니다.', flags: MessageFlags.Ephemeral });
    }
    const skipped = player.current.title;
    player.skip();
    return interaction.reply(`⏭️ 건너뛰었습니다: **${skipped}**`);
  },
};
