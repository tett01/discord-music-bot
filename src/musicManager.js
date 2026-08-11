const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
} = require('@discordjs/voice');
const prism = require('prism-media');

const { spawnAudioStream } = require('./youtube');
const { getGuildSettings, setVolume: persistVolume, setLoopMode: persistLoopMode } = require('./db');
const { TrackQueue, LOOP_MODES } = require('./trackQueue');

/** @type {Map<string, GuildMusicPlayer>} */
const players = new Map();

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

// 정지/건너뛰기로 스트림을 의도적으로 끊을 때 나는 오류들. 실제 고장이 아니므로 알리지 않는다.
const BENIGN_STREAM_ERRORS = new Set([
  'ERR_STREAM_PREMATURE_CLOSE',
  'EPIPE',
  'ECONNRESET',
  'ABORT_ERR',
]);

function isBenignStreamError(error) {
  return BENIGN_STREAM_ERRORS.has(error?.code);
}

class GuildMusicPlayer {
  constructor(guildId, textChannel) {
    this.guildId = guildId;
    this.textChannel = textChannel;
    this.connection = null;
    this.audioPlayer = createAudioPlayer();
    this.resource = null;
    this.sourceProcess = null;
    this.idleTimer = null;

    const settings = getGuildSettings(guildId);
    // 대기열·반복 모드는 TrackQueue가 관리한다. queue/current/loopMode는 아래 getter로
    // 그대로 노출하므로 명령어 쪽 코드는 바뀌지 않는다.
    this.tracks = new TrackQueue(settings.loop_mode);
    this.volume = settings.volume;

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      this._handleTrackEnd().catch((error) => this._reportError('다음 곡 재생 실패', error));
    });

    this.audioPlayer.on('error', (error) => {
      if (!isBenignStreamError(error)) {
        this._reportError(`재생 중 오류 (${this.current?.title ?? '알 수 없음'})`, error);
      }
      this._handleTrackEnd().catch((err) => this._reportError('다음 곡 재생 실패', err));
    });
  }

  // 명령어들이 player.queue / player.current / player.loopMode를 직접 읽는다.
  get queue() {
    return this.tracks.tracks;
  }

  get current() {
    return this.tracks.current;
  }

  get loopMode() {
    return this.tracks.loopMode;
  }

  /**
   * 음성 채널에 접속하고 실제로 통신 가능한 상태가 될 때까지 기다린다.
   *
   * 디스코드는 봇 하나가 서버당 음성 연결을 하나만 가질 수 있다. 이미 다른 채널에 있다면
   * 그 채널에 듣는 사람이 없을 때만 옮겨가고, 있으면 거절한다. (조건부 이동)
   */
  async join(voiceChannel) {
    const existing = this.connection;
    if (existing && existing.state.status !== VoiceConnectionStatus.Destroyed) {
      const currentChannelId = existing.joinConfig.channelId;
      if (currentChannelId === voiceChannel.id) return existing;

      const currentChannel = voiceChannel.guild.channels.cache.get(currentChannelId);
      const listeners = currentChannel
        ? currentChannel.members.filter((member) => !member.user.bot).size
        : 0;

      if (listeners > 0) {
        throw new Error(
          `봇이 이미 <#${currentChannelId}> 채널에서 재생 중입니다. (듣는 사람 ${listeners}명)\n` +
            '그 채널로 오시거나, 재생이 끝난 뒤 다시 시도해주세요.'
        );
      }

      // 듣는 사람이 없으니 옮겨간다. 대기열과 재생 상태는 그대로 유지된다.
      this.voiceChannelBitrate = voiceChannel.bitrate;
      existing.rejoin({ channelId: voiceChannel.id, selfDeaf: true, selfMute: false });

      try {
        await entersState(existing, VoiceConnectionStatus.Ready, 20_000);
      } catch {
        this.destroy();
        throw new Error('음성 채널 이동에 실패했습니다.');
      }

      this._notify(
        `🔀 <#${currentChannelId}> 채널에 듣는 사람이 없어 <#${voiceChannel.id}> 채널로 이동했습니다.`
      );
      return existing;
    }

    // Opus 인코더를 채널 허용치에 맞추기 위해 기억해 둔다.
    // 지정하지 않으면 libopus 기본값(약 99kbps)으로 인코딩되어 64kbps 채널에서 음질이 뭉개진다.
    this.voiceChannelBitrate = voiceChannel.bitrate;

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    this.connection.subscribe(this.audioPlayer);

    this.connection.on('error', (error) => this._reportError('음성 연결 오류', error));

    // 연결 실패 원인을 알 수 있도록 음성 WebSocket 종료 코드를 기록해 둔다.
    this.lastVoiceCloseCode = null;
    this.connection.on('stateChange', (_old, newState) => {
      const net = newState.networking;
      if (!net || net.__closeHooked) return;
      net.__closeHooked = true;
      net.on('stateChange', (_o, n) => {
        const ws = n.ws;
        if (!ws || ws.__closeHooked) return;
        ws.__closeHooked = true;
        ws.on('close', (event) => {
          if (event?.code && event.code !== 1000) {
            this.lastVoiceCloseCode = `${event.code}${event.reason ? ` ${event.reason}` : ''}`;
          }
        });
      });
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroy();
      }
    });

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      const closeCode = this.lastVoiceCloseCode;
      this.destroy();
      console.error(`[music] guild ${this.guildId} 음성 연결 실패 (close=${closeCode ?? '없음'})`);
      throw new Error(
        closeCode
          ? `음성 채널 연결에 실패했습니다. (음성 서버 종료 코드: ${closeCode})`
          : '음성 채널 연결에 실패했습니다. 봇의 연결/말하기 권한과 네트워크를 확인해주세요.'
      );
    }

    return this.connection;
  }

  async enqueue(track) {
    this.tracks.enqueue(track);
    if (this.audioPlayer.state.status === AudioPlayerStatus.Idle && !this.current) {
      await this._playNext();
    }
  }

  skip() {
    // 한 곡 반복 중이어도 skip은 무조건 다음 곡으로 넘어가야 한다.
    this.tracks.requestSkip();
    this.audioPlayer.stop(true);
  }

  pause() {
    return this.audioPlayer.pause();
  }

  resume() {
    return this.audioPlayer.unpause();
  }

  setLoopMode(mode) {
    // 메모리와 DB 양쪽에 쓴다. 한쪽만 갱신하면 재시작 시 값이 되돌아간다.
    this.tracks.setLoopMode(mode);
    persistLoopMode(this.guildId, mode);
  }

  setVolume(volumePercent) {
    this.volume = volumePercent;
    persistVolume(this.guildId, volumePercent);
    if (this.resource?.volume) {
      this.resource.volume.setVolume(volumePercent / 100);
    }
  }

  clearQueue() {
    this.tracks.clear();
  }

  destroy() {
    this._clearIdleTimer();
    this._killSource();
    this.tracks.reset();
    try {
      this.audioPlayer.stop(true);
    } catch {
      /* noop */
    }
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      try {
        this.connection.destroy();
      } catch {
        /* noop */
      }
    }
    this.connection = null;
    players.delete(this.guildId);
  }

  async _playNext() {
    // 다음에 뭘 틀지는 TrackQueue가 정한다. 여기서는 그 결과를 재생만 한다.
    const next = this.tracks.advance();
    if (!next) {
      this._killSource();
      this._startIdleTimer();
      return;
    }

    await this._play(next);
  }

  async _play(track) {
    this._clearIdleTimer();
    this._killSource();

    // yt-dlp가 오디오를 직접 받아 stdout으로 넘기고, ffmpeg는 그 파이프를 읽는다.
    const source = spawnAudioStream(track.url);
    this.sourceProcess = source;

    let sourceStderr = '';
    source.stderr.on('data', (chunk) => {
      sourceStderr += chunk.toString();
    });
    source.on('error', (error) => this._reportError('yt-dlp 실행 오류', error));
    source.on('exit', (code) => {
      // 건너뛰기/정지로 우리가 죽인 경우(code === null)는 정상이다.
      if (code !== 0 && code !== null) {
        const detail = sourceStderr.trim().split('\n').slice(-2).join(' ');
        console.error(`[music] guild ${this.guildId} yt-dlp 종료 code=${code} ${detail}`);
      }
    });
    // ffmpeg가 먼저 닫히면 파이프가 끊기는데, 이는 정상 종료 과정이다.
    source.stdout.on('error', () => {});

    const ffmpeg = new prism.FFmpeg({
      args: [
        // 입력 옵션은 -i 앞에 와야 한다.
        '-analyzeduration',
        '0',
        '-loglevel',
        '0',
        '-i',
        'pipe:0',
        '-vn',
        '-f',
        's16le',
        '-ar',
        '48000',
        '-ac',
        '2',
      ],
    });

    ffmpeg.on('error', (error) => {
      if (isBenignStreamError(error)) return;
      this._reportError('ffmpeg 오류', error);
    });

    source.stdout.pipe(ffmpeg);

    const resource = createAudioResource(ffmpeg, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    resource.volume.setVolume(this.volume / 100);

    // 인코더 비트레이트를 채널 설정에 맞춘다. (prism은 16k~128k로 클램프)
    if (resource.encoder && this.voiceChannelBitrate) {
      try {
        resource.encoder.setBitrate(this.voiceChannelBitrate);
      } catch (error) {
        console.error('[music] 비트레이트 설정 실패:', error);
      }
    }

    this.resource = resource;

    this.audioPlayer.play(resource);
  }

  async _handleTrackEnd() {
    if (this.tracks.isEmpty) return;
    await this._playNext();
  }

  /** 재생 중이던 yt-dlp 프로세스를 종료한다. (곡 전환·정지 시 좀비 프로세스 방지) */
  _killSource() {
    if (!this.sourceProcess) return;
    try {
      this.sourceProcess.kill();
    } catch {
      /* noop */
    }
    this.sourceProcess = null;
  }

  _startIdleTimer() {
    this._clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.tracks.isEmpty) {
        this._notify('⏳ 재생할 곡이 없어 음성 채널에서 나갑니다.');
        this.destroy();
      }
    }, IDLE_TIMEOUT_MS);
  }

  _clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  _notify(message) {
    this.textChannel?.send(message).catch(() => {});
  }

  _reportError(context, error) {
    console.error(`[music] guild ${this.guildId} ${context}:`, error);
    this._notify(`⚠️ ${context}`);
  }
}

function getPlayer(guildId, textChannel) {
  let player = players.get(guildId);
  if (!player) {
    player = new GuildMusicPlayer(guildId, textChannel);
    players.set(guildId, player);
  } else if (textChannel) {
    player.textChannel = textChannel;
  }
  return player;
}

function getExistingPlayer(guildId) {
  return players.get(guildId) ?? null;
}

/** 봇 종료 시 모든 음성 연결을 정리한다. (음성 채널에 유령처럼 남는 것을 방지) */
function destroyAllPlayers() {
  for (const player of [...players.values()]) {
    try {
      player.destroy();
    } catch {
      /* noop */
    }
  }
}

// isBenignStreamError는 내부용이지만, 여기에 없는 코드가 들어오면 정지·건너뛰기의
// 정상 부산물이 사용자에게 오류로 보이므로 테스트할 수 있게 내보낸다.
module.exports = { getPlayer, getExistingPlayer, destroyAllPlayers, LOOP_MODES, isBenignStreamError };
