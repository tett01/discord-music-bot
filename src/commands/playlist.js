const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  createPlaylist,
  getPlaylist,
  listPlaylists,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  getPlaylistTracks,
} = require('../db');
const { resolveTrack, describeTrackError } = require('../source');
const { getPlayer } = require('../musicManager');

module.exports = {
  musicCommand: true,
  data: new SlashCommandBuilder()
    .setName('플레이리스트')
    .setDescription('플레이리스트를 관리합니다.')
    .addSubcommand((sub) =>
      sub
        .setName('생성')
        .setDescription('새 플레이리스트를 만듭니다.')
        .addStringOption((opt) => opt.setName('이름').setDescription('플레이리스트 이름').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('추가')
        .setDescription('플레이리스트에 곡을 추가합니다.')
        .addStringOption((opt) => opt.setName('이름').setDescription('플레이리스트 이름').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('검색어').setDescription('유튜브 링크 또는 검색어').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('곡삭제')
        .setDescription('플레이리스트에서 특정 곡을 제거합니다.')
        .addStringOption((opt) => opt.setName('이름').setDescription('플레이리스트 이름').setRequired(true))
        .addIntegerOption((opt) =>
          opt.setName('번호').setDescription('목록 명령으로 확인한 곡 번호').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('삭제')
        .setDescription('플레이리스트를 삭제합니다.')
        .addStringOption((opt) => opt.setName('이름').setDescription('플레이리스트 이름').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('목록')
        .setDescription('플레이리스트 목록 또는 곡 목록을 확인합니다.')
        .addStringOption((opt) =>
          opt.setName('이름').setDescription('곡 목록을 볼 플레이리스트 이름 (생략 시 전체 목록)')
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('재생')
        .setDescription('플레이리스트 전체를 대기열에 추가하고 재생합니다.')
        .addStringOption((opt) => opt.setName('이름').setDescription('플레이리스트 이름').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === '생성') {
      const name = interaction.options.getString('이름', true);
      try {
        createPlaylist(guildId, name);
      } catch {
        return interaction.reply({ content: `이미 존재하는 플레이리스트입니다: **${name}**`, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply(`📃 플레이리스트를 생성했습니다: **${name}**`);
    }

    if (sub === '추가') {
      const name = interaction.options.getString('이름', true);
      const query = interaction.options.getString('검색어', true);
      const playlist = getPlaylist(guildId, name);
      if (!playlist) {
        return interaction.reply({ content: `존재하지 않는 플레이리스트입니다: **${name}**`, flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply();
      let track;
      try {
        track = await resolveTrack(query);
      } catch (error) {
        console.error('[플레이리스트 추가] 검색 실패:', error);
        return interaction.editReply(describeTrackError(error));
      }
      addTrackToPlaylist(playlist.id, track.title, track.url);
      return interaction.editReply(`➕ **${name}** 플레이리스트에 추가했습니다: **${track.title}**`);
    }

    if (sub === '곡삭제') {
      const name = interaction.options.getString('이름', true);
      const position = interaction.options.getInteger('번호', true);
      const playlist = getPlaylist(guildId, name);
      if (!playlist) {
        return interaction.reply({ content: `존재하지 않는 플레이리스트입니다: **${name}**`, flags: MessageFlags.Ephemeral });
      }
      const result = removeTrackFromPlaylist(playlist.id, position - 1);
      if (result.changes === 0) {
        return interaction.reply({ content: '해당 번호의 곡을 찾을 수 없습니다.', flags: MessageFlags.Ephemeral });
      }
      return interaction.reply(`🗑️ **${name}** 플레이리스트에서 ${position}번 곡을 제거했습니다.`);
    }

    if (sub === '삭제') {
      const name = interaction.options.getString('이름', true);
      const ok = deletePlaylist(guildId, name);
      if (!ok) {
        return interaction.reply({ content: `존재하지 않는 플레이리스트입니다: **${name}**`, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply(`🗑️ 플레이리스트를 삭제했습니다: **${name}**`);
    }

    if (sub === '목록') {
      const name = interaction.options.getString('이름');
      if (!name) {
        const playlists = listPlaylists(guildId);
        if (playlists.length === 0) {
          return interaction.reply({ content: '생성된 플레이리스트가 없습니다.', flags: MessageFlags.Ephemeral });
        }
        return interaction.reply(`**플레이리스트 목록:**\n${playlists.map((p) => `- ${p.name}`).join('\n')}`);
      }
      const playlist = getPlaylist(guildId, name);
      if (!playlist) {
        return interaction.reply({ content: `존재하지 않는 플레이리스트입니다: **${name}**`, flags: MessageFlags.Ephemeral });
      }
      const tracks = getPlaylistTracks(playlist.id);
      if (tracks.length === 0) {
        return interaction.reply(`**${name}** 플레이리스트가 비어 있습니다.`);
      }
      const lines = tracks.map((t, i) => `${i + 1}. ${t.title}`);
      return interaction.reply(`**${name}** 플레이리스트:\n${lines.join('\n')}`);
    }

    if (sub === '재생') {
      const name = interaction.options.getString('이름', true);
      const voiceChannel = interaction.member.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: '먼저 음성 채널에 입장해주세요.', flags: MessageFlags.Ephemeral });
      }
      const playlist = getPlaylist(guildId, name);
      if (!playlist) {
        return interaction.reply({ content: `존재하지 않는 플레이리스트입니다: **${name}**`, flags: MessageFlags.Ephemeral });
      }
      const tracks = getPlaylistTracks(playlist.id);
      if (tracks.length === 0) {
        return interaction.reply({ content: `**${name}** 플레이리스트가 비어 있습니다.`, flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply();

      const player = getPlayer(guildId, interaction.channel);
      try {
        await player.join(voiceChannel);
      } catch (error) {
        console.error('[플레이리스트 재생] 음성 연결 실패:', error);
        return interaction.editReply(error.message);
      }

      for (const t of tracks) {
        await player.enqueue({ title: t.title, url: t.url });
      }

      return interaction.editReply(`▶️ **${name}** 플레이리스트 (${tracks.length}곡)를 대기열에 추가했습니다.`);
    }

    return interaction.reply({ content: '알 수 없는 명령입니다.', flags: MessageFlags.Ephemeral });
  },
};
