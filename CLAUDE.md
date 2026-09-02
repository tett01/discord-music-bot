# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 명령어

```bash
npm install
```

```bash
npm run deploy
```

```bash
npm start
```

`npm run deploy`는 슬래시 명령어를 디스코드에 등록합니다. **명령어 정의(이름·설명·옵션)를 바꾸면 반드시 다시 실행해야 합니다.** `execute` 본문만 고쳤다면 재등록은 필요 없고 봇만 재시작하면 됩니다. `.env`의 `GUILD_ID`가 채워져 있으면 해당 서버에 즉시 반영되고, 비어 있으면 전역 등록(최대 1시간)됩니다.

24시간 운영은 pm2를 씁니다: `pm2 start ecosystem.config.js`, `pm2 restart music-bot`, `pm2 logs music-bot`.

```bash
npm run check
```

```bash
npm test
```

`npm run check`는 모든 소스를 `node --check`로 구문 검사하고, `npm test`는 Node 내장 러너(`node --test`)로 `test/*.test.js`를 돌립니다. 둘 다 디스코드 토큰이 필요 없으며 [.github/workflows/ci.yml](.github/workflows/ci.yml)에서 push·PR마다 실행됩니다.

**린터는 없고, 테스트는 순수 로직(명령어 로딩, 대기열·반복 전이, 플레이리스트 DB, 에러 문구 매핑)까지만 봅니다.** 재생·음성 연결·yt-dlp 같은 실제 동작 검증은 여전히 봇을 띄워 디스코드 서버에서 명령어를 실행하는 방식뿐입니다.

## 머지 규칙

**CI가 통과하지 않으면 머지하지 않습니다.** 예외 없습니다.

1. PR을 올린 뒤 CI 결과를 확인합니다. `gh run list --branch <브랜치> --limit 1`
2. **실패하면 원인을 고치고 다시 푸시해 CI를 재실행합니다.** 통과할 때까지 반복합니다. 실패를 남긴 채 머지하거나, 실패한 테스트를 지워서 통과시키지 마세요 — 테스트가 잡아낸 것이 진짜 문제일 가능성부터 확인합니다.
3. `success`를 확인한 뒤에 머지합니다.

머지 후 `main`에서도 CI가 한 번 더 돌므로 그 결과까지 확인합니다. 연속으로 머지하면 `concurrency: cancel-in-progress` 때문에 앞의 실행이 `cancelled`로 남을 수 있는데, 이는 실패가 아닙니다. **가장 최근 실행이 `success`인지**를 보세요.

푸시 전에 로컬에서 `npm run check && npm test`를 돌리면 CI 왕복을 줄일 수 있습니다.

> 이 규칙은 아직 **관례일 뿐 강제되지 않습니다.** GitHub 브랜치 보호(필수 상태 검사)는 설정되어 있지 않으므로, 마음만 먹으면 빨간불로도 머지됩니다.

## 아키텍처

### 명령어 자동 등록

`src/loadCommands.js`가 `src/commands/*.js`를 전부 `require`해서 `data.name` → 모듈 맵을 만듭니다. `index.js`(런타임 디스패치)와 `deploy-commands.js`(등록)가 같은 맵을 씁니다. 명령어 추가는 파일 하나를 떨어뜨리는 것으로 끝나며, 별도 등록 목록은 없습니다.

각 모듈은 세 가지를 내보내야 합니다.

- `data` — `SlashCommandBuilder` 인스턴스
- `execute(interaction)` — 함수
- `musicCommand` — 불리언

`data.name`이나 `execute`가 없으면 **경고 없이 조용히 건너뜁니다.** 명령어가 나타나지 않으면 이 조건부터 확인하세요.

`musicCommand: true`인 명령어만 [index.js](src/index.js)의 텍스트 채널 제한(`/음악채널설정`으로 지정한 채널)을 적용받습니다. 이 필드를 빠뜨리면 falsy로 취급되어 **제한을 우회**하므로, 음악 관련 명령어에는 반드시 명시하세요. 제한의 켜짐/꺼짐은 `text_channel_id`의 `NULL` 여부로만 판별합니다 — `setTextChannel`이 켜고 `clearTextChannel`이 끕니다.

### 상태의 이중 구조

상태가 두 곳에 나뉘어 있고 수명이 다릅니다.

**메모리** — [musicManager.js](src/musicManager.js)의 `GuildMusicPlayer` 인스턴스를 `guildId` 키의 `Map`으로 보관합니다. 음성 연결, 대기열, 현재 곡, ffmpeg/yt-dlp 프로세스가 여기 있습니다. **재시작하면 전부 사라집니다.**

그중 **대기열과 반복 모드의 전이 규칙은 [trackQueue.js](src/trackQueue.js)의 `TrackQueue`로 떼어냈습니다.** 디스코드·음성 연결에 의존하지 않아 단독으로 테스트할 수 있습니다. "다음에 뭘 틀지"는 `advance()`가 정하고, `GuildMusicPlayer`는 그 결과를 재생만 합니다. 이 규칙을 고칠 때는 `musicManager.js`가 아니라 여기를 보세요.

반복 모드는 네 가지이고 **`queue`와 `last`가 헷갈리기 쉽습니다.** `queue`는 대기열 전체를 순환해 마지막 곡 뒤에 첫 곡으로 돌아가고, `last`는 대기열이 남아 있는 동안 `off`처럼 순서대로 넘어가다가 다 떨어지면 마지막 곡만 반복합니다. 곡이 하나뿐이면 둘의 동작이 같아 보이므로, **모드를 검증할 때는 3곡 이상으로 확인하세요.**

`LOOP_MODES`에 모드를 추가하면 [loop.js](src/commands/loop.js)의 `addChoices`와 `labels`도 같이 고쳐야 합니다. 선택지를 빠뜨리면 사용자가 고를 수 없고, 반대로 선택지만 추가하면 `setLoopMode`가 예외를 던집니다. `musicManager.test.js`가 둘의 일치를 검사하며, **선택지가 바뀌었으므로 `npm run deploy`가 필요합니다.**

`player.queue` / `player.current` / `player.loopMode`는 `TrackQueue`를 비추는 **getter**입니다. 명령어 쪽에서 읽기만 하며, **대입하면 터집니다** — 상태를 바꾸려면 `player.tracks`의 메서드를 쓰세요.

**SQLite** — [db.js](src/db.js)의 `data/bot.sqlite`. 음량, 반복 모드, 음질 모드, 음악 채널 지정, 플레이리스트가 들어 있습니다. `db.js`는 `require` 시점에 DB를 열고 스키마 DDL을 실행합니다(모듈 부작용). `.gitignore` 대상이라 저장소에 없으며, 이 파일이 유일한 사본입니다.

경로는 `BOT_DB_PATH` 환경변수로 바꿀 수 있습니다. **테스트는 `require` 전에 이 값을 `':memory:'`로 지정해야 합니다** — 지정하지 않으면 운영 DB를 건드립니다. `db.js`를 직간접적으로 `require`하는 테스트 파일 맨 위에 넣으세요.

새 서버의 기본 음량은 `db.js`의 `DEFAULT_VOLUME`(15)입니다. **DDL의 `DEFAULT`만 고치면 이미 만들어진 DB에는 반영되지 않으므로**(`CREATE TABLE IF NOT EXISTS`는 기존 테이블을 건드리지 않습니다), `getGuildSettings`의 INSERT가 이 값을 직접 넣습니다. 기본값을 바꿀 때는 상수만 고치면 되고, **이미 저장된 서버의 값은 그대로 남습니다** — 필요하면 DB에서 직접 UPDATE해야 합니다.

**칼럼을 추가할 때는 DDL만 고치면 안 됩니다.** `CREATE TABLE IF NOT EXISTS`가 기존 테이블을 건드리지 않으므로 이미 만들어진 DB에는 반영되지 않고, `data/bot.sqlite`는 저장소에 없는 유일한 사본이라 지우고 다시 만들 수도 없습니다. `ensureColumn(테이블, 칼럼, 정의)`로 따로 붙이세요(NOT NULL은 DEFAULT가 있어야 `ALTER TABLE`로 추가됩니다). [test/dbMigration.test.js](test/dbMigration.test.js)가 옛 스키마를 만들어 두고 이 경로를 검증합니다 — 다른 테스트와 달리 임시 **파일** DB를 씁니다.

`LOOP_MODES`와 마찬가지로 **`AUDIO_QUALITY_MODES`(db.js)와 [quality.js](src/commands/quality.js)의 `addChoices`·`LABELS`도 함께 고쳐야 합니다.** `musicManager.test.js`가 둘의 일치를 검사합니다.

음량과 반복 모드는 **양쪽에 다 있습니다.** `setVolume`/`setLoopMode`는 메모리와 DB에 동시에 쓰고, `GuildMusicPlayer` 생성자가 DB에서 다시 읽어 복원합니다. 한쪽만 갱신하면 재시작 시 값이 되돌아갑니다.

플레이어를 얻는 함수가 두 개이고 의미가 다릅니다.

- `getPlayer(guildId, textChannel)` — 없으면 **생성**. 재생을 시작하거나 설정을 저장하는 명령어용 (`/재생`, `/음량`, `/반복`)
- `getExistingPlayer(guildId)` — 없으면 `null`. 재생 중이어야만 의미가 있는 명령어용 (`/다음곡`, `/정지`, `/대기열`)

### 멜론 차트 캐싱

[melon.js](src/melon.js)가 멜론 인기차트 TOP 10을 **1시간마다 한 번만** 긁어 메모리에 담고, `/멜론차트`는 캐시만 읽습니다. 명령어마다 크롤링하면 요청이 사용자 수만큼 늘어 차단당합니다. `startMelonChartRefresh()`는 `ClientReady`에서 시작하고 `shutdown()`에서 멈춥니다.

- **기본 UA로는 응답이 거부됩니다.** `MELON_HEADERS`의 `User-Agent`/`Referer`가 있어야 200이 옵니다.
- 파싱은 의존성을 늘리지 않으려고 정규식으로 합니다. `parseMelonChart(html, limit)`은 네트워크에 의존하지 않는 순수 함수라 [test/melon.test.js](test/melon.test.js)에서 단독으로 검증합니다.
- **파싱 결과가 비면 캐시를 덮어쓰지 않습니다.** 멜론이 마크업을 바꾸면 빈 배열이 나오는데, 그대로 반영하면 멀쩡한 캐시까지 날아갑니다. `refreshMelonChart`가 이때 로그만 남기고 이전 값을 유지합니다.
- 태그를 공백으로 치환해 텍스트를 뽑기 때문에 `</a>, <a>` 구분자가 `"A , B"`가 됩니다. `stripTags`의 쉼표 앞 공백 제거가 이걸 되돌립니다.

### 소스 엔진이 두 개다

유튜브에서 정보와 오디오를 가져오는 경로가 둘이고, [source.js](src/source.js)가 그 앞에 서서 고릅니다. **명령어와 `musicManager`는 `source.js`만 봅니다** — `youtube.js`나 `playdl.js`를 직접 `require`하지 마세요.

| | [playdl.js](src/playdl.js) | [youtube.js](src/youtube.js) |
| --- | --- | --- |
| 구현 | 순수 JS (play-dl) | 외부 바이너리 (yt-dlp) |
| 프로세스 | 0개 | yt-dlp + ffmpeg 2개 |
| 유튜브 변경 대응 | 느림 (라이브러리 릴리스를 기다려야 함) | 빠름 (바이너리만 갱신) |
| 설치 | 항상 됨 | python·디스크·네트워크가 필요 |

**조회와 스트림은 따로 폴백합니다.** play-dl은 제목·길이는 잘 가져오면서 재생 URL만 못 푸는 상태가 될 수 있어서(유튜브가 서명 로직을 바꿨을 때), `resolveTrack`과 `openSource`가 각각 폴백을 겁니다. `openSource`의 폴백을 지우면 **조회는 멀쩡한데 모든 곡이 건너뛰어지는** 증상이 납니다.

> **2026년 8월 현재 play-dl 1.9.7은 재생 URL을 풀지 못합니다.** `stream()`이 `Invalid URL`로 죽고 실제 재생은 전부 yt-dlp가 합니다. 그래도 조회는 play-dl이 더 빠르고 가벼워 `auto`의 순서는 그대로 둡니다. play-dl이 갱신되면 코드 변경 없이 가벼운 경로로 돌아갑니다.

`AUDIO_ENGINE`이 순서를 정합니다. 기본 `auto`는 play-dl을 먼저 쓰고 실패하면 yt-dlp로 한 번 더 시도합니다. **단 `isVideoLevelFailure`가 참인 실패(연령·지역·멤버십·비공개·삭제)는 폴백하지 않습니다** — 엔진을 바꿔도 결과가 같아 응답만 두 배로 느려지기 때문입니다.

`resolveTrack`이 돌려주는 트랙에는 **`engine` 필드가 박혀 있습니다.** 조회에 성공한 엔진으로 스트림도 열어야 하므로 이 값을 지우지 마세요.

`openSource()`는 모양이 다른 두 핸들 중 하나를 돌려주고, `_play`가 `kind`로 갈라 씁니다.

- `{ kind: 'stream', stream, type }` — play-dl. `type`은 `'webm/opus'`가 대부분
- `{ kind: 'process', child, stream }` — yt-dlp. `stream`은 `child.stdout`

### keep-alive 웹 서버

[keepalive.js](src/keepalive.js)가 express로 `GET /`(본문 `OK`)와 `GET /health`(JSON)만 여는 서버를 띄웁니다. 무료 호스팅이 **요청이 없으면 인스턴스를 재우기 때문에** UptimeRobot이 5분마다 때릴 곳이 필요하고, Render는 **포트가 열리지 않으면 배포를 실패 처리**합니다.

`index.js`가 `client.login()`보다 **먼저** 이 서버를 띄웁니다. 순서를 바꾸면 디스코드 로그인이 늦어지는 동안 Render의 포트 감지 시간이 지나가 배포가 실패할 수 있습니다.

로컬·pm2에서는 포트를 잡을 이유가 없으므로 `DISABLE_KEEPALIVE=1`로 끕니다. 미들웨어를 하나도 붙이지 않은 것은 의도적입니다 — 처리할 것이 핑 한 종류뿐입니다.

### 메모리 예산

무료 인스턴스가 512MB뿐이라 몇 가지가 기본으로 묶여 있습니다. 되돌리기 전에 이유를 보세요.

- `npm start`에 `--max-old-space-size=256`이 붙어 있습니다.
- `index.js`의 `makeCache`가 discord.js 캐시를 대부분 0으로 막습니다. **`GuildMemberManager`와 `UserManager`는 절대 0으로 두지 마세요** — `join()`이 `channel.members`로 "듣는 사람이 있는지"를 판단하는데, 멤버 캐시가 비면 항상 0명으로 보여 **사람이 듣고 있는 채널에서 봇이 빠져나갑니다.**
- `PLAYDL_QUALITY`(0~2, 기본 2)로 소스 품질을 낮출 수 있습니다. 잘못된 값은 예외를 던지지 않고 기본값으로 떨어집니다 — 설정 실수로 재생이 막히는 편이 더 나쁩니다.

### 오디오 파이프라인

```
play-dl  → Readable(webm/opus) ─┬─(원음)──────────────────────→ AudioResource → AudioPlayer
                                └─(일반)→ prism.FFmpeg → PCM ─→ AudioResource → AudioPlayer
yt-dlp (spawn) → stdout ─────────────────→ prism.FFmpeg ──────→ AudioResource → AudioPlayer
```

**play-dl + 원음 조합에서는 ffmpeg를 띄우지 않습니다.** @discordjs/voice가 WebM을 JS로 디먹싱하므로 자식 프로세스가 0개가 됩니다. 512MB 무료 인스턴스에서 이 차이가 가장 큽니다. 이 지름길의 조건은 `_play`의 `direct`에 있습니다.

**이 지름길을 일반 모드까지 넓히지 마세요.** PCM 단계가 사라지면 `/음량`이 조용히 무시됩니다. 예외는 raw Opus 패킷(`type === 'opus'`, HLS 라이브)뿐인데, 이건 ffmpeg로 디코딩할 수도 없어 그대로 넘길 수밖에 없습니다.

**yt-dlp가 뽑은 스트림 URL을 ffmpeg가 직접 열게 바꾸지 마세요.** 그 URL은 yt-dlp가 쓴 클라이언트/헤더에 묶여 있어 ffmpeg의 요청은 403 Forbidden으로 거부됩니다. yt-dlp가 직접 받아 파이프로 넘기는 현재 구조가 이 문제를 피하는 방식입니다.

yt-dlp 바이너리는 `yt-dlp-exec/src/constants`에서 경로만 가져오고 실행은 `node:child_process`로 직접 합니다([youtube.js](src/youtube.js)). 패키지의 execa 래퍼는 쓰지 않습니다.

**`resolveTrack()`의 실패를 사용자에게 보여줄 때는 반드시 `describeTrackError(error)`를 거치세요.** 연령·지역·멤버십 제한, 라이브, 삭제, 타임아웃은 봇 고장이 아니라 정상적인 제약이며, 이 함수가 yt-dlp stderr와 play-dl 예외 문구를 사유별 문장으로 옮깁니다. **두 엔진의 오류 문구가 `youtube.js`의 `ERROR_HINTS` 한 표에 같이 들어 있습니다** — play-dl 쪽 문구를 추가할 때도 여기에 넣으세요. 원본 에러 메시지를 그대로 노출하거나 "영상을 찾지 못했습니다"로 뭉뚱그리지 마세요. 새 사유를 추가하려면 `ERROR_HINTS` 배열에 넣으며, **구체적인 패턴일수록 앞에** 둬야 합니다(위에서부터 첫 일치를 씁니다).

**전달 방식은 두 가지이고 `ffmpegArgs(passthrough)`가 갈라놓습니다.**

- `normal` — 디코딩해서 PCM으로 넘깁니다. `inlineVolume`으로 음량을 곱한 뒤 다시 Opus로 인코딩합니다. 음량 조절의 대가로 디코딩·재인코딩이 한 번씩 붙습니다.
- `original` — `-c:a copy`라 **디코딩도 인코딩도 하지 않고** 컨테이너만 WebM → Ogg로 바꿉니다(`-f opus`는 Ogg Opus 먹서). 유튜브 Opus가 이미 48kHz 스테레오라 그대로 통과합니다. `StreamType.OggOpus`로 넘깁니다. **이 경로는 yt-dlp 엔진에서만 씁니다**(`copyOnly = passthrough && kind === 'process'`) — play-dl은 ffmpeg 자체를 건너뛰므로 컨테이너를 바꿀 이유가 없습니다.

**원음 모드에는 `resource.volume`도 `resource.encoder`도 없습니다.** PCM 단계가 없으니 곱할 곳도, 우리가 다룰 인코더도 없습니다. 그래서 `/음량`과 `MAX_OPUS_BITRATE`가 이 모드에서는 **무시됩니다** — `volume.js`가 이 사실을 사용자에게 알립니다. 두 경로를 함께 고칠 때 `resource.volume`을 무조건 참조하면 원음 모드에서 터지므로 반드시 존재 여부를 확인하세요.

원음 모드는 소스가 Opus여야만 성립하므로, **yt-dlp 경로에서** `spawnAudioStream(url, { opusOnly: true })`이 `bestaudio[acodec=opus]`를 **대체 포맷 없이** 요청합니다. 대체 포맷을 두면 AAC를 물고 조용히 깨집니다. 없으면 yt-dlp가 실패하고, 그때 `pendingFallback`에 곡을 담아 **같은 곡을 일반 모드로 한 번만 다시 틉니다**(서버 설정은 그대로 두므로 다음 곡은 다시 원음으로 시도합니다). 여기서 `_play`를 곧바로 부르면 안 됩니다 — 곧 이어질 스트림 종료가 `_handleTrackEnd`를 깨워 대기열을 넘겨버리므로, 표식만 남기고 그쪽이 집어가게 합니다. 이미 오디오를 받은 뒤의 실패(네트워크 끊김 등)는 곡을 처음부터 되감게 되므로 `receivedAudio`로 걸러냅니다.

Opus 인코더 비트레이트는 음성 채널 입장 시점에 캐시한 `voiceChannelBitrate`를 트랙마다 적용합니다. **prism이 16k~128k로 클램프하므로 실효 상한은 128 kbps**이고, 채널 비트레이트를 그 이상 올려도 반영되지 않습니다. 캐시는 `join()`에서만 갱신되므로 채널 비트레이트를 바꾸면 재입장이 필요합니다.

### 재생 흐름의 비자명한 규칙

- **의도적 스트림 종료는 오류가 아닙니다.** `ERR_STREAM_PREMATURE_CLOSE`, `EPIPE`, `ECONNRESET`, `ABORT_ERR`는 `BENIGN_STREAM_ERRORS`로 걸러 사용자에게 알리지 않습니다. 정지·건너뛰기의 정상 부산물입니다.
- **`_forceSkip` 플래그**가 사용자의 `/다음곡`과 곡의 자연 종료를 구분합니다. 이게 없으면 `loop: song` 모드에서 건너뛰기가 같은 곡을 다시 재생합니다. `requestSkip()`이 세우고 `advance()`가 한 번 쓴 뒤 내립니다 — **다음 곡으로 넘어간 뒤에도 남아 있으면 그 곡의 반복이 걸리지 않습니다.**
- **서버당 음성 연결은 하나뿐**입니다(디스코드 제약). 다른 채널에서 `/재생`하면 기존 채널에 봇이 아닌 사람이 없을 때만 대기열을 유지한 채 이동하고, 있으면 예외를 던져 거절합니다.
- **5분 유휴 시 자동 퇴장** (`IDLE_TIMEOUT_MS`).
- **`_killSource()`는 ffmpeg까지 명시적으로 죽입니다.** 파이프가 끊기면 알아서 종료되긴 하지만 그 타이밍이 늦으면 다음 곡의 ffmpeg와 잠시 겹쳐 메모리가 두 배로 뜹니다. 죽이기 전에 `__disposed`를 세워 그 뒤의 오류를 무시하게 합니다.
- **스트림을 못 연 곡은 대기열을 세우지 않고 건너뜁니다.** `_play`가 `openSource` 실패를 잡아 사유를 알린 뒤 `_playNext()`를 부릅니다. 여기서 예외를 위로 던지면 대기열이 통째로 멈춥니다.
- `SIGINT`/`SIGTERM`에서 `destroyAllPlayers()`로 음성 연결을 정리한 뒤 종료합니다. 이걸 건너뛰면 봇이 음성 채널에 유령으로 남습니다.

## 의존성 제약

바꾸기 전에 반드시 알아야 할 것들입니다.

- **`better-sqlite3`를 추가하지 마세요.** `@discordjs/voice` 0.19와 함께 로드하면 프로세스가 SIGABRT로 죽습니다. 그래서 Node 내장 `node:sqlite`를 쓰고, 그 때문에 **Node 23.4 이상**이 필요합니다(플래그 없이 쓰기 위해).
- **`@discordjs/voice`를 0.19 미만으로 내리지 마세요.** 디스코드가 DAVE(종단간 암호화)를 요구하므로 `@snazzah/davey`와 함께 0.19+ 가 필수입니다. 구버전은 음성 서버가 `4017 E2EE/DAVE protocol required`로 연결을 거부합니다.
- **play-dl(1.9.7)은 유지보수가 멈춘 라이브러리이고, 지금도 이미 반쯤 막혀 있습니다.** 마지막 릴리스가 2023년이라 유튜브가 그 뒤 바꾼 서명(nsig) 로직을 풀지 못합니다. 조회는 되지만 `stream()`은 `Invalid URL`로 죽습니다. 그래서 이 저장소는 play-dl로 갈아탄 것이 아니라 **앞에 세워 둔 것**이고, **yt-dlp 경로가 실제 재생을 담당합니다.** 정리한다는 이유로 `youtube.js`나 `bin/yt-dlp` 확보 경로를 지우면 소리가 아예 안 납니다.
- **쿠키는 두 엔진이 같은 파일을 씁니다.** `YTDLP_COOKIES`(Netscape cookies.txt)를 지정하면 `playdl.js`의 `normalizeCookie`가 그걸 헤더 문자열로 바꿔 play-dl에도 먹입니다. 형식을 갈라 놓으면 폴백으로 넘어갔을 때 쿠키가 없어 똑같이 차단당합니다.

## 코드 관례

- **슬래시 명령어 이름, 옵션 이름, 사용자에게 보이는 모든 문자열이 한국어입니다.** `setName('재생')`, `getString('검색어', true)`처럼 옵션을 한글 키로 조회합니다. 새 명령어도 이 관례를 따르세요.
- 비공개 응답은 `flags: MessageFlags.Ephemeral`을 씁니다. `ephemeral: true`는 사용하지 않습니다(deprecated).
- 인텐트는 `Guilds`와 `GuildVoiceStates` 둘뿐입니다. 메시지 내용이나 멤버 목록에 의존하는 기능은 추가할 수 없습니다(Privileged Intent 필요).
- yt-dlp 호출처럼 수 초가 걸리는 작업은 `deferReply()` 후 `editReply()`로 응답합니다.
- 플레이리스트 곡 번호는 **DB에서 0-based `position`, 사용자에게는 1-based**입니다. `playlist.js`에서 `position - 1`로 변환합니다.
- **`position`은 항상 0부터 빈틈없이 이어져야 합니다.** `/플레이리스트 목록`은 표시 순서(배열 인덱스)로 번호를 매기는데 `/플레이리스트 곡삭제`는 `position` 값으로 지우기 때문에, 구멍이 남으면 사용자가 본 번호와 다른 곡이 지워집니다. `removeTrackFromPlaylist`가 삭제 후 재정렬하고 `addTrackToPlaylist`는 `MAX(position) + 1`을 씁니다(`COUNT(*)`는 충돌합니다).

## 문제 해결

**`Unknown interaction` 또는 무응답** — 봇이 두 개 이상 떠 있을 가능성이 큽니다. pm2가 띄운 프로세스는 커맨드라인이 `ProcessContainerFork.js`로 나타나 `index.js` 검색에 잡히지 않으므로, `pm2 list`와 `node.exe` 프로세스 목록을 각각 확인해야 합니다.

**모든 재생이 갑자기 실패** — 유튜브 변경으로 yt-dlp 바이너리가 낡았을 가능성이 높습니다. 바이너리는 `npm install` 시점에 받은 것이 그대로 유지됩니다.
