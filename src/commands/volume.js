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

    // 원음 모드는 PCM을 거치지 않아 음량을 곱할 곳이 없다. 설정은 저장되지만 지금은
    // 소리에 반영되지 않으므로, 조용히 무시된 것처럼 보이지 않게 알려준다.
    if (player.audioQuality === 'original') {
      return interaction.reply(
        `🔊 음량을 **${level}%**로 저장했습니다.\n` +
          '⚠️ 지금은 **원음 모드**라 이 값이 적용되지 않습니다. ' +
          '디스코드에서 봇 사용자 볼륨으로 조절하시거나 `/음질 일반`으로 바꿔주세요.'
      );
    }

    return interaction.reply(`🔊 음량을 **${level}%**로 설정했습니다.`);
  },
};
