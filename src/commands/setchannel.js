const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setTextChannel, clearTextChannel } = require('../db');

module.exports = {
  musicCommand: false,
  data: new SlashCommandBuilder()
    .setName('음악채널설정')
    .setDescription('음악 명령어를 사용할 수 있는 채팅 채널을 지정합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('채널')
        .setDescription('음악 명령어 전용 채널 (비우면 현재 채널로 지정)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addBooleanOption((option) =>
      option
        .setName('해제')
        .setDescription('지정을 해제해 모든 채널에서 사용할 수 있게 합니다.')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (interaction.options.getBoolean('해제')) {
      clearTextChannel(interaction.guildId);
      return interaction.reply('✅ 음악 채널 지정을 해제했습니다. 이제 모든 채널에서 사용할 수 있습니다.');
    }

    const channel = interaction.options.getChannel('채널') ?? interaction.channel;
    setTextChannel(interaction.guildId, channel.id);
    return interaction.reply(`✅ 음악 명령어 전용 채널을 <#${channel.id}> 으로 설정했습니다.`);
  },
};
