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

`npm run check`는 모든 소스를 `node --check`로 구문 검사하고, `npm test`는 Node 내장 러너(`node --test`)로 명령어 모듈 스모크 테스트를 돌립니다. 둘 다 디스코드 토큰이 필요 없으며 [.github/workflows/ci.yml](.github/workflows/ci.yml)에서 push·PR마다 실행됩니다.

**린터는 없고, 테스트는 "명령어가 로드되고 등록 가능한가"까지만 봅니다.** 재생·음성 연결·yt-dlp 같은 실제 동작 검증은 여전히 봇을 띄워 디스코드 서버에서 명령어를 실행하는 방식뿐입니다.

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

`player.queue` / `player.current` / `player.loopMode`는 `TrackQueue`를 비추는 **getter**입니다. 명령어 쪽에서 읽기만 하며, **대입하면 터집니다** — 상태를 바꾸려면 `player.tracks`의 메서드를 쓰세요.

**SQLite** — [db.js](src/db.js)의 `data/bot.sqlite`. 음량, 반복 모드, 음악 채널 지정, 플레이리스트가 들어 있습니다. `db.js`는 `require` 시점에 DB를 열고 스키마 DDL을 실행합니다(모듈 부작용). `.gitignore` 대상이라 저장소에 없으며, 이 파일이 유일한 사본입니다.

경로는 `BOT_DB_PATH` 환경변수로 바꿀 수 있습니다. **테스트는 `require` 전에 이 값을 `':memory:'`로 지정해야 합니다** — 지정하지 않으면 운영 DB를 건드립니다. `db.js`를 직간접적으로 `require`하는 테스트 파일 맨 위에 넣으세요.

음량과 반복 모드는 **양쪽에 다 있습니다.** `setVolume`/`setLoopMode`는 메모리와 DB에 동시에 쓰고, `GuildMusicPlayer` 생성자가 DB에서 다시 읽어 복원합니다. 한쪽만 갱신하면 재시작 시 값이 되돌아갑니다.

플레이어를 얻는 함수가 두 개이고 의미가 다릅니다.

- `getPlayer(guildId, textChannel)` — 없으면 **생성**. 재생을 시작하거나 설정을 저장하는 명령어용 (`/재생`, `/음량`, `/반복`)
- `getExistingPlayer(guildId)` — 없으면 `null`. 재생 중이어야만 의미가 있는 명령어용 (`/다음곡`, `/정지`, `/대기열`)

### 오디오 파이프라인

```
yt-dlp (spawn) → stdout → prism.FFmpeg → s16le raw → AudioResource → AudioPlayer
```

**yt-dlp가 뽑은 스트림 URL을 ffmpeg가 직접 열게 바꾸지 마세요.** 그 URL은 yt-dlp가 쓴 클라이언트/헤더에 묶여 있어 ffmpeg의 요청은 403 Forbidden으로 거부됩니다. yt-dlp가 직접 받아 파이프로 넘기는 현재 구조가 이 문제를 피하는 방식입니다.

yt-dlp 바이너리는 `yt-dlp-exec/src/constants`에서 경로만 가져오고 실행은 `node:child_process`로 직접 합니다([youtube.js](src/youtube.js)). 패키지의 execa 래퍼는 쓰지 않습니다.

**`resolveTrack()`의 실패를 사용자에게 보여줄 때는 반드시 `describeTrackError(error)`를 거치세요.** 연령·지역·멤버십 제한, 라이브, 삭제, 타임아웃은 봇 고장이 아니라 정상적인 제약이며, 이 함수가 yt-dlp stderr를 사유별 문장으로 옮깁니다. 원본 에러 메시지를 그대로 노출하거나 "영상을 찾지 못했습니다"로 뭉뚱그리지 마세요. 새 사유를 추가하려면 `ERROR_HINTS` 배열에 넣으며, **구체적인 패턴일수록 앞에** 둬야 합니다(위에서부터 첫 일치를 씁니다).

Opus 인코더 비트레이트는 음성 채널 입장 시점에 캐시한 `voiceChannelBitrate`를 트랙마다 적용합니다. **prism이 16k~128k로 클램프하므로 실효 상한은 128 kbps**이고, 채널 비트레이트를 그 이상 올려도 반영되지 않습니다. 캐시는 `join()`에서만 갱신되므로 채널 비트레이트를 바꾸면 재입장이 필요합니다.

### 재생 흐름의 비자명한 규칙

- **의도적 스트림 종료는 오류가 아닙니다.** `ERR_STREAM_PREMATURE_CLOSE`, `EPIPE`, `ECONNRESET`, `ABORT_ERR`는 `BENIGN_STREAM_ERRORS`로 걸러 사용자에게 알리지 않습니다. 정지·건너뛰기의 정상 부산물입니다.
- **`_forceSkip` 플래그**가 사용자의 `/다음곡`과 곡의 자연 종료를 구분합니다. 이게 없으면 `loop: song` 모드에서 건너뛰기가 같은 곡을 다시 재생합니다. `requestSkip()`이 세우고 `advance()`가 한 번 쓴 뒤 내립니다 — **다음 곡으로 넘어간 뒤에도 남아 있으면 그 곡의 반복이 걸리지 않습니다.**
- **서버당 음성 연결은 하나뿐**입니다(디스코드 제약). 다른 채널에서 `/재생`하면 기존 채널에 봇이 아닌 사람이 없을 때만 대기열을 유지한 채 이동하고, 있으면 예외를 던져 거절합니다.
- **5분 유휴 시 자동 퇴장** (`IDLE_TIMEOUT_MS`).
- `SIGINT`/`SIGTERM`에서 `destroyAllPlayers()`로 음성 연결을 정리한 뒤 종료합니다. 이걸 건너뛰면 봇이 음성 채널에 유령으로 남습니다.

## 의존성 제약

바꾸기 전에 반드시 알아야 할 두 가지입니다.

- **`better-sqlite3`를 추가하지 마세요.** `@discordjs/voice` 0.19와 함께 로드하면 프로세스가 SIGABRT로 죽습니다. 그래서 Node 내장 `node:sqlite`를 쓰고, 그 때문에 **Node 23.4 이상**이 필요합니다(플래그 없이 쓰기 위해).
- **`@discordjs/voice`를 0.19 미만으로 내리지 마세요.** 디스코드가 DAVE(종단간 암호화)를 요구하므로 `@snazzah/davey`와 함께 0.19+ 가 필수입니다. 구버전은 음성 서버가 `4017 E2EE/DAVE protocol required`로 연결을 거부합니다.

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
