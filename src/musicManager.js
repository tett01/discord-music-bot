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

const { openSource, describeTrackError } = require('./source');
const {
  getGuildSettings,
  setVolume: persistVolume,
  setLoopMode: persistLoopMode,
  setAudioQuality: persistAudioQuality,
  AUDIO_QUALITY_MODES,
} = require('./db');
const { TrackQueue, LOOP_MODES } = require('./trackQueue');
const { getLyrics, lyricsDisabled } = require('./lyrics');
const { LyricsSession } = require('./lyricsSession');

/** @type {Map<string, GuildMusicPlayer>} */
const players = new Map();

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

// play-dl이 돌려줄 수 있는 스트림 타입 중, ffmpeg를 거치지 않고 디스코드로 바로 넘길 수
// 있는 것들. 유튜브 오디오는 사실상 항상 'webm/opus'로 온다.
const DIRECT_OPUS_TYPES = new Set(['webm/opus', 'ogg/opus', 'opus']);

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

/**
 * 실제로 인코딩에 쓸 비트레이트(bps)를 정한다.
 *
 * 기본은 채널 설정 그대로다. `MAX_OPUS_BITRATE`(kbps)를 주면 그 값을 넘지 않게 깎는다.
 * CPU가 빠듯한 호스팅에서 채널의 통화 품질은 그대로 두고 봇만 가볍게 돌리기 위한 것이다.
 * 채널 비트레이트를 내리면 그 채널을 쓰는 사람들의 음성까지 같이 나빠진다.
 *
 * 잘못된 값(숫자가 아니거나 0 이하)은 무시하고 채널 값을 쓴다. 여기서 예외를 던지면
 * 재생 자체가 막히는데, 설정 실수 때문에 봇이 안 도는 편이 더 나쁘다.
 *
 * @param {number} channelBitrate 음성 채널의 비트레이트(bps)
 * @param {string | undefined} [maxKbps] MAX_OPUS_BITRATE 환경변수 값
 * @returns {number} 적용할 비트레이트(bps)
 */
function effectiveBitrate(channelBitrate, maxKbps = process.env.MAX_OPUS_BITRATE) {
  const limit = Number.parseInt(String(maxKbps ?? '').trim(), 10);
  if (!Number.isFinite(limit) || limit <= 0) return channelBitrate;
  return Math.min(channelBitrate, limit * 1000);
}

/**
 * ffmpeg에 넘길 인자를 만든다.
 *
 * 일반 모드는 디코딩해서 s16le PCM으로 내보낸다. @discordjs/voice가 여기에 음량을 곱한 뒤
 * 다시 Opus로 인코딩한다. 음량 조절의 대가로 디코딩과 재인코딩이 한 번씩 붙는다.
 *
 * 원음 모드는 `-c:a copy`라 **디코딩도 인코딩도 하지 않는다.** 컨테이너만 WebM에서 Ogg로
 * 바꿔 넘길 뿐이다. 유튜브 Opus가 이미 디스코드가 요구하는 48kHz 스테레오이므로 그대로
 * 통과시킬 수 있다. (`-f opus`는 Ogg Opus 먹서다)
 *
 * @param {boolean} passthrough
 * @returns {string[]}
 */
function ffmpegArgs(passthrough) {
  // 입력 옵션은 -i 앞에 와야 한다.
  const input = ['-analyzeduration', '0', '-loglevel', '0', '-i', 'pipe:0', '-vn'];
  return passthrough
    ? [...input, '-c:a', 'copy', '-f', 'opus']
    : [...input, '-f', 's16le', '-ar', '48000', '-ac', '2'];
}

/**
 * openSource가 돌려준 핸들을 닫는다. (프로세스면 죽이고, 스트림이면 파괴한다)
 *
 * 재생에 쓰지 않고 버리는 핸들에도 필요하다 — 그냥 참조만 버리면 yt-dlp가 살아남는다.
 *
 * @param {{kind: string, child?: import('node:child_process').ChildProcess, stream?: import('node:stream').Readable} | null} handle
 */
function closeSourceHandle(handle) {
  if (!handle) return;
  try {
    if (handle.kind === 'process') handle.child.kill();
    else handle.stream.destroy();
  } catch {
    /* noop */
  }
}

class GuildMusicPlayer {
  constructor(guildId, textChannel) {
    this.guildId = guildId;
    this.textChannel = textChannel;
    this.connection = null;
    this.audioPlayer = createAudioPlayer();
    this.resource = null;
    // 재생 중인 소스 핸들. play-dl이면 Readable 하나, yt-dlp면 자식 프로세스다.
    this.source = null;
    // 디코딩이 필요할 때만 뜨는 ffmpeg. 원음 + play-dl 조합에서는 null로 남는다.
    this.ffmpeg = null;
    this.idleTimer = null;
    // 원음 재생에 실패해 일반 모드로 다시 틀어야 하는 곡. _handleTrackEnd가 집어간다.
    this.pendingFallback = null;
    // _play가 자기 차례인지 확인하는 표. _play는 openSource를 기다리는 동안 몇 초씩
    // 멈춰 있는데, 그 사이에 건너뛰기·정지·다음 곡이 끼어들 수 있다. 자세한 건 _play 참고.
    this._playToken = 0;
    // 실시간 가사판. 곡마다 새로 만들고 곡이 끝나면 버린다. (lyricsSession.js 참고)
    this.lyrics = null;
    // 가사 자동 표시 여부. 프로세스 메모리에만 있어 재시작하면 꺼진 상태로 돌아간다.
    this.lyricsEnabled = false;
    // 가사판을 어디에 띄울지. 'voice'는 음성 채널 채팅, 'text'는 명령어를 친 채널.
    this.lyricsTarget = 'voice';

    const settings = getGuildSettings(guildId);
    // 대기열·반복 모드는 TrackQueue가 관리한다. queue/current/loopMode는 아래 getter로
    // 그대로 노출하므로 명령어 쪽 코드는 바뀌지 않는다.
    this.tracks = new TrackQueue(settings.loop_mode);
    this.volume = settings.volume;
    this.audioQuality = settings.audio_quality;

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

      // 가사판은 옮겨온 채널이 아니라 **이전 채널에 남아 있다.** 여기서 정리하지 않으면
      // 아무도 없는 채널에서 계속 편집되고, 새 채널에는 가사가 안 나온다.
      this._stopLyrics();

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

  /**
   * 오디오 전달 방식을 바꾼다.
   *
   * 재생 중인 곡에는 적용하지 않는다. 파이프라인을 갈아끼우려면 스트림을 다시 열어야 해서
   * 곡이 처음부터 다시 시작되기 때문이다. **다음 곡부터 적용된다.**
   */
  setAudioQuality(quality) {
    if (!AUDIO_QUALITY_MODES.includes(quality)) {
      throw new Error(`알 수 없는 음질 모드: ${quality}`);
    }
    // 메모리와 DB 양쪽에 쓴다. 한쪽만 갱신하면 재시작 시 값이 되돌아간다.
    this.audioQuality = quality;
    persistAudioQuality(this.guildId, quality);
  }

  clearQueue() {
    this.tracks.clear();
  }

  /**
   * 가사 자동 표시를 켜거나 끈다. 다음 곡부터가 아니라 **지금 곡에도 바로 적용된다.**
   *
   * DB에 쓰지 않는다 — 재시작하면 꺼진 상태로 돌아간다. (칼럼 추가는 ensureColumn과
   * 양쪽 백엔드까지 따라오는 작업이라, 기능이 쓸 만한지 확인한 뒤에 붙인다)
   *
   * @param {boolean} enabled
   * @param {'voice' | 'text'} [target]
   */
  setLyricsMode(enabled, target = this.lyricsTarget) {
    this.lyricsEnabled = enabled;
    this.lyricsTarget = target === 'text' ? 'text' : 'voice';
    if (!enabled) this._stopLyrics();
  }

  /** 지금 재생 중인 곡의 가사판을 띄운다. 이미 떠 있으면 아무것도 하지 않는다. */
  showLyricsNow() {
    if (!this.lyricsEnabled || this.lyrics) return;
    if (!this.current || !this.resource) return;
    this._startLyrics(this.current, this.resource);
  }

  destroy() {
    // 스트림을 여는 중이던 _play가 있다면 그 결과를 버리게 한다. 그러지 않으면
    // 나간 뒤에 소스가 열려 재생이 되살아나고 yt-dlp가 살아남는다.
    this._playToken += 1;
    this._clearIdleTimer();
    this._stopLyrics();
    this._killSource();
    this.pendingFallback = null;
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

  /**
   * @param {object} track
   * @param {boolean} [passthrough] 재인코딩 없이 그대로 흘려보낼지. 기본값은 서버 설정을 따른다.
   */
  async _play(track, passthrough = this.audioQuality === 'original') {
    // openSource는 yt-dlp를 띄우므로 몇 초가 걸린다. 그 사이에 사용자가 /다음곡을 누르거나
    // 원음 폴백이 걸리면 **또 다른 _play가 시작되어 우리를 앞질러 간다.** 표를 남겨 두고
    // 기다린 뒤 확인하지 않으면, 늦게 깨어난 쪽이 audioPlayer.play를 다시 불러 **이미
    // 지나간 곡이 잠깐 재생되고** 먼저 시작한 쪽의 yt-dlp/ffmpeg는 아무도 죽이지 않는다.
    const token = (this._playToken += 1);

    this._clearIdleTimer();
    this._stopLyrics();
    this._killSource();
    this.pendingFallback = null;

    // **어느 곡이 실제로 재생됐는지 남기는 유일한 자리다.** 나머지 로그는 전부 실패했을
    // 때만 찍히므로, 이게 없으면 "고르지 않은 곡이 나왔다"는 제보를 사후에 추적할 수
    // 없다(#29). 조회한 엔진까지 남기는 것은 두 엔진이 같은 링크에 다른 곡을 돌려주는
    // 종류의 버그가 실제로 있었기 때문이다.
    //
    // 곡당 한 줄이라 512MB 인스턴스에서도 부담이 없다. 실패 로그가 이미 이 수준이다.
    console.log(
      `[music] guild ${this.guildId} 재생 시작: ${track.title} (${track.url}) ` +
        `engine=${track.engine ?? '?'} mode=${passthrough ? 'original' : 'normal'}`
    );

    let handle;
    try {
      handle = await openSource(track, { opusOnly: passthrough });
    } catch (error) {
      // 우리 차례가 아니면 조용히 물러난다. 여기서 _playNext를 부르면 지금 재생 중인
      // 곡을 남이 건너뛰게 된다.
      if (token !== this._playToken) return;
      // 조회는 됐는데 스트림을 못 연 경우다. 여기서 멈추면 대기열이 통째로 서므로,
      // 사유를 알린 뒤 다음 곡으로 넘어간다.
      console.error(`[music] guild ${this.guildId} 스트림 열기 실패 (${track.title}):`, error);
      this._notify(`⚠️ ${describeTrackError(error)}\n건너뜁니다: **${track.title}**`);
      await this._playNext();
      return;
    }

    // 기다리는 사이에 다음 _play가 시작됐다면 방금 연 소스를 그대로 닫고 끝낸다.
    if (token !== this._playToken) {
      closeSourceHandle(handle);
      return;
    }

    this.source = handle;
    const audioIn = handle.stream;

    let receivedAudio = false;

    if (handle.kind === 'process') {
      this._attachProcessDiagnostics(handle, track, passthrough, () => receivedAudio);
    } else {
      audioIn.on('error', (error) => {
        if (isBenignStreamError(error)) return;
        this._reportError(`오디오 스트림 오류 (${track.title})`, error);
      });
    }

    // 컨테이너만 바꾸는 -c:a copy는 소스가 Opus라고 확신할 수 있는 yt-dlp 경로에서만 쓴다.
    // play-dl은 아래에서 아예 ffmpeg 없이 넘기거나, 그럴 수 없으면 디코딩한다.
    const copyOnly = passthrough && handle.kind === 'process';

    // play-dl이 Opus 컨테이너를 그대로 줬다면 **ffmpeg를 띄우지 않는다.**
    // @discordjs/voice가 JS로 디먹싱하므로 자식 프로세스가 0개가 된다.
    // 512MB짜리 무료 인스턴스에서 이 차이가 가장 크다.
    //
    // 다만 이 지름길은 원음 모드에서만 쓴다. 일반 모드에서까지 쓰면 PCM 단계가 사라져
    // /음량이 조용히 무시되기 때문이다. (원음 모드는 음량 조절 불가가 원래 계약이다)
    // 예외는 raw Opus 패킷인데, 이건 ffmpeg로 디코딩할 수도 없어 그대로 넘기는 수밖에 없다.
    const rawOpus = handle.kind === 'stream' && handle.type === 'opus';
    const direct =
      handle.kind === 'stream' && DIRECT_OPUS_TYPES.has(handle.type) && (passthrough || rawOpus);

    let resource;
    if (direct) {
      resource = createAudioResource(audioIn, { inputType: handle.type });
    } else {
      const ffmpeg = new prism.FFmpeg({ args: ffmpegArgs(copyOnly) });
      this.ffmpeg = ffmpeg;

      ffmpeg.on('error', (error) => {
        if (ffmpeg.__disposed || isBenignStreamError(error)) return;
        this._reportError('ffmpeg 오류', error);
      });

      audioIn.pipe(ffmpeg);

      resource = createAudioResource(
        ffmpeg,
        copyOnly ? { inputType: StreamType.OggOpus } : { inputType: StreamType.Raw, inlineVolume: true }
      );
    }

    // pipe가 흐름을 연 뒤에 붙인다. 먼저 붙이면 pipe가 연결되기 전에 첫 청크가 새어나간다.
    audioIn.on('data', () => {
      receivedAudio = true;
    });

    if (resource.volume) resource.volume.setVolume(this.volume / 100);

    // 인코더 비트레이트를 채널 설정(과 MAX_OPUS_BITRATE 상한)에 맞춘다.
    // prism은 16k~128k로 클램프하므로 그 밖의 값은 어차피 그대로 반영되지 않는다.
    if (resource.encoder && this.voiceChannelBitrate) {
      try {
        resource.encoder.setBitrate(effectiveBitrate(this.voiceChannelBitrate));
      } catch (error) {
        console.error('[music] 비트레이트 설정 실패:', error);
      }
    }

    this.resource = resource;

    this.audioPlayer.play(resource);

    if (this.lyricsEnabled) this._startLyrics(track, resource);
  }

  /**
   * 가사판을 띄운다. **재생을 막지 않도록 기다리지 않는다.**
   *
   * 세션에 `this`를 넘기지 않는 것이 중요하다. 넘기는 것은 위치를 읽는 클로저 하나뿐이고,
   * 그 클로저는 `resource`만 붙잡는다. 자세한 이유는 lyricsSession.js 머리말에 있다.
   */
  _startLyrics(track, resource) {
    if (lyricsDisabled()) return;

    getLyrics(track)
      .then(async (lyrics) => {
        // 조회가 몇 초 걸리는 사이에 곡이 바뀌었거나 정지했을 수 있다. 그때는 버린다.
        if (this.resource !== resource || this.lyrics) return;
        if (!lyrics) return;

        const channel = this.lyricsChannel();
        if (!channel) return;

        // 동기 가사가 없으면 타이머를 아예 만들지 않고 전문을 한 번 보낸다. 추가 메모리 0이다.
        if (!lyrics.synced) {
          const body = lyrics.plain.length > 1900 ? `${lyrics.plain.slice(0, 1900)}\n…` : lyrics.plain;
          channel.send(`🎤 **${track.title}** (동기 가사가 없어 전문만 표시합니다)\n${body}`).catch(() => {});
          return;
        }

        const session = new LyricsSession({
          lines: lyrics.synced,
          title: track.title,
          // ⚠️ player가 아니라 resource만 붙잡는다. playbackDuration은 일시정지 중에는
          // 늘지 않아 /일시정지와 자동으로 맞는다.
          getPositionMs: () => resource.playbackDuration,
          channel,
        });

        this.lyrics = session;
        const status = await session.start();
        if (status !== 'started') {
          this.lyrics = null;
          if (status === 'limit') {
            console.warn(`[가사] guild ${this.guildId} 동시 표시 상한에 걸려 건너뜁니다.`);
          }
        }
      })
      .catch((error) => {
        // 가사는 부가 기능이다. 여기서 던지면 재생까지 흔들린다.
        console.error(`[가사] guild ${this.guildId} 표시 실패:`, error.message);
      });
  }

  _stopLyrics() {
    const session = this.lyrics;
    this.lyrics = null;
    session?.stop();
  }

  /**
   * 가사판을 띄울 채널을 고른다.
   *
   * 기본은 **봇이 들어가 있는 음성 채널의 텍스트 채팅**이다(v14의 음성 채널은 텍스트
   * 채널이기도 하다). 듣는 사람과 보는 사람이 정확히 일치하고, 음악 채널이 가사로
   * 도배되지 않는다. 쓸 권한이 없으면 조용히 명령어를 친 채널로 떨어진다.
   *
   * 음성 채널 ID를 따로 들고 있지 않는 것에 주의. joinConfig에 이미 있으므로 새로
   * 붙잡는 참조가 없다.
   */
  lyricsChannel() {
    if (this.lyricsTarget === 'voice') {
      const voiceId = this.connection?.joinConfig.channelId;
      const voice = voiceId ? this.textChannel?.guild?.channels.cache.get(voiceId) : null;
      if (voice?.isSendable?.()) return voice;
    }
    return this.textChannel ?? null;
  }

  /**
   * yt-dlp 자식 프로세스의 stderr/종료 코드를 지켜본다.
   *
   * 원음 모드는 소스가 Opus일 때만 성립한다. 한 바이트도 못 받고 죽었다면 이 곡에
   * Opus 포맷이 없는 것이므로 같은 곡을 일반 모드로 한 번만 다시 시도한다.
   * (서버 설정은 그대로 둔다 — 다음 곡은 다시 원음으로 시도한다)
   *
   * 여기서 곧바로 _play를 부르지 않는 이유는, 곧 이어질 스트림 종료가 _handleTrackEnd를
   * 깨워 대기열을 넘겨버리기 때문이다. 표식만 남기고 그쪽이 집어가게 한다.
   */
  _attachProcessDiagnostics(handle, track, passthrough, receivedAudio) {
    const child = handle.child;
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      // 실패했을 때 마지막 몇 줄만 쓰므로 무한정 쌓지 않는다.
      stderr = (stderr + chunk.toString()).slice(-2048);
    });
    child.on('error', (error) => this._reportError('yt-dlp 실행 오류', error));
    child.on('exit', (code) => {
      // 건너뛰기/정지로 우리가 죽인 경우(code === null)는 정상이다.
      if (code === 0 || code === null) return;

      const detail = stderr.trim().split('\n').slice(-2).join(' ');
      console.error(`[music] guild ${this.guildId} yt-dlp 종료 code=${code} ${detail}`);
      // 실행한 명령을 같이 남긴다. 같은 호스트에서 손으로 돌리면 되는데 봇에서만
      // 실패하는 일이 있어서, 무엇이 달랐는지는 인자를 봐야 알 수 있다.
      console.error(`[music] guild ${this.guildId} 실행한 명령: ${child.spawnargs.join(' ')}`);

      // 403은 원인이 여럿이라(IP 차단, 곡별 제약, 출력 방식) 로그만으로는 갈리지 않는다.
      // 호스팅 패널에서는 셸을 쓰기 어려운 경우가 많아, 봇이 직접 비교해 로그에 남긴다.
      // 프로세스당 한 번만 돈다 — 곡마다 돌면 실패할 때마다 yt-dlp가 여섯 번씩 뜬다.
      if (/403/.test(stderr)) runProbeOnce(track.url);

      if (passthrough && !receivedAudio() && this.source === handle) {
        console.warn(`[music] guild ${this.guildId} 원음 소스 없음, 일반 모드로 재시도: ${track.title}`);
        this.pendingFallback = track;
      }
    });
    child.stdout.on('error', () => {});
  }

  async _handleTrackEnd() {
    // 원음 재생에 실패한 경우다. 곡이 끝난 게 아니므로 대기열을 넘기지 않는다.
    const fallback = this.pendingFallback;
    if (fallback) {
      this.pendingFallback = null;
      await this._play(fallback, false);
      return;
    }

    if (this.tracks.isEmpty) return;
    await this._playNext();
  }

  /**
   * 재생 중이던 소스를 정리한다. (곡 전환·정지 시 좀비 프로세스/버퍼 방지)
   *
   * ffmpeg까지 명시적으로 죽이는 것이 중요하다. 파이프가 끊기면 알아서 종료되긴 하지만,
   * 그 타이밍이 늦으면 다음 곡의 ffmpeg와 잠시 겹쳐 메모리가 두 배로 뜬다.
   */
  _killSource() {
    const ffmpeg = this.ffmpeg;
    this.ffmpeg = null;
    if (ffmpeg) {
      // 우리가 죽인 것이므로 이후의 오류는 무시한다.
      ffmpeg.__disposed = true;
      try {
        ffmpeg.destroy();
      } catch {
        /* noop */
      }
    }

    const handle = this.source;
    this.source = null;
    closeSourceHandle(handle);
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
/**
 * 403을 만났을 때 조건별 비교표를 로그에 한 번만 남긴다.
 *
 * `YTDLP_NO_AUTO_PROBE=1`로 끌 수 있다. 여섯 번의 부분 다운로드가 도는 동안
 * 재생에는 영향이 없지만, 512MB 인스턴스에서 신경이 쓰이면 꺼두면 된다.
 *
 * @param {string} url
 */
let probeStarted = false;
function runProbeOnce(url) {
  if (probeStarted) return;
  if (String(process.env.YTDLP_NO_AUTO_PROBE || '').trim() === '1') return;
  probeStarted = true;

  console.error('[music] 403 원인을 좁히기 위해 조건별로 확인합니다. 잠시 걸립니다...');
  // require를 여기서 한다. 진단용이라 평소에는 불러올 이유가 없다.
  const { probe, formatProbe } = require('./ytdlpProbe');
  probe(url)
    .then((results) => console.error(formatProbe(results)))
    .catch((error) => console.error('[music] 조건별 확인 실패:', error.message));
}

module.exports = {
  getPlayer,
  getExistingPlayer,
  destroyAllPlayers,
  LOOP_MODES,
  AUDIO_QUALITY_MODES,
  isBenignStreamError,
  effectiveBitrate,
  ffmpegArgs,
};
