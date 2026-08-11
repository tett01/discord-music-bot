const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setTextChannel } = require('../db');

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
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('채널') ?? interaction.channel;
    setTextChannel(interaction.guildId, channel.id);
    return interaction.reply(`✅ 음악 명령어 전용 채널을 <#${channel.id}> 으로 설정했습니다.`);
  },
};
