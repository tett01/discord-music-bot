const { SlashCommandBuilder } = require('discord.js');
const { getPlayer } = require('../musicManager');

// 선택지 value는 db.js의 AUDIO_QUALITY_MODES와 정확히 일치해야 한다.
// 어긋나면 setAudioQuality가 예외를 던진다. commands.test.js가 둘을 묶어 검사한다.
const LABELS = {
  normal: '일반',
  original: '원음',
};

module.exports = {
  musicCommand: true,
  data: new SlashCommandBuilder()
    .setName('음질')
    .setDescription('오디오 전달 방식을 설정합니다.')
    .addStringOption((option) =>
      option
        .setName('모드')
        .setDescription('전달 방식')
        .setRequired(true)
        .addChoices(
          { name: '일반 (음량 조절 가능)', value: 'normal' },
          { name: '원음 (음질 우선, 음량 조절 불가)', value: 'original' }
        )
    ),

  async execute(interaction) {
    const mode = interaction.options.getString('모드', true);
    const player = getPlayer(interaction.guildId, interaction.channel);
    player.setAudioQuality(mode);

    const detail =
      mode === 'original'
        ? '유튜브 원본 Opus를 재인코딩 없이 그대로 전달합니다. 음질 손실과 CPU 사용이 줄어듭니다.\n' +
          '⚠️ **`/음량`이 동작하지 않습니다.** 소리 크기는 디스코드에서 봇 사용자 볼륨으로 조절해주세요.'
        : '음량을 조절할 수 있는 기본 방식입니다.';

    return interaction.reply(
      `🎧 음질 모드: **${LABELS[mode]}**\n${detail}\n\n다음 곡부터 적용됩니다.`
    );
  },
};
