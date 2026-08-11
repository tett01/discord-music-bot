# 디스코드 음악 봇

유튜브 링크/검색어로 음악을 재생하고, 플레이리스트를 만들어 관리할 수 있는 디스코드 봇입니다.

## 주요 기능

- `/재생 <검색어>` — 유튜브 링크 또는 검색어로 음악 재생 (재생 중이면 대기열에 추가)
- `/일시정지`, `/재개` — 재생 제어
- `/다음곡` — 현재 곡 건너뛰기
- `/반복 <끄기|현재 곡 반복|전체 곡 반복>` — 반복 재생 모드
- `/음량 <0~150>` — 재생 음량 조절
- `/대기열` — 현재 재생 곡 및 대기열 확인
- `/정지` — 재생 정지 및 음성 채널 퇴장
- `/플레이리스트 생성|추가|곡삭제|삭제|목록|재생` — 서버별 플레이리스트 관리
- `/음악채널설정 [채널]` — 음악 명령어를 사용할 수 있는 텍스트 채널 지정 (관리자 권한 필요, 지정하지 않으면 모든 채널에서 사용 가능)

## 사전 준비물

1. **Node.js 23.4 이상** (내장 `node:sqlite`를 플래그 없이 사용하기 위해 필요. 24 LTS 권장)
2. **디스코드 봇 생성** — https://discord.com/developers/applications
   - **Bot** 탭 → Reset Token → 토큰 복사 → `.env`의 `DISCORD_TOKEN`
   - **General Information** → Application ID → `.env`의 `CLIENT_ID`
   - Privileged Gateway Intents는 **전부 꺼둔 채로** 동작합니다 (Guilds, Voice States만 사용)
3. **봇 서버 초대**
   - OAuth2 → URL Generator → Scopes: `bot`, `applications.commands`
   - Bot Permissions: `View Channels`, `Send Messages`, `Connect`, `Speak`
   - 또는 아래 URL의 `<CLIENT_ID>`만 교체해서 사용 (같은 권한 조합)

     ```
     https://discord.com/api/oauth2/authorize?client_id=<CLIENT_ID>&permissions=3148800&scope=bot%20applications.commands
     ```

## 설치 및 실행

```bash
npm install
```

`.env.example`을 복사해 `.env`를 만들고 값을 채웁니다.

```bash
cp .env.example .env
```

슬래시 명령어를 디스코드에 등록합니다 (명령어 정의를 바꾼 뒤에도 다시 실행).

```bash
npm run deploy
```

- `.env`에 `GUILD_ID`를 채우면 해당 서버에 **즉시** 반영됩니다 (테스트 권장).
- 비워두면 전역 등록되며 모든 서버 반영까지 최대 1시간 걸릴 수 있습니다.

봇 실행:

```bash
npm start
```

`✅ 로그인 완료: ...`가 뜨면 준비 완료입니다. 종료는 `Ctrl + C` — 음성 연결을 정리하고 채널에서 나간 뒤 종료합니다.

## 24시간 실행 (pm2)

터미널을 닫아도 계속 돌리고, 봇이 죽으면 자동으로 되살리려면 [pm2](https://pm2.keymetrics.io/)를 사용합니다. 설정은 [ecosystem.config.js](ecosystem.config.js)에 있습니다.

```bash
npm install -g pm2
```

```bash
pm2 start ecosystem.config.js
```

자주 쓰는 명령:

```bash
pm2 list
```

```bash
pm2 logs music-bot
```

```bash
pm2 restart music-bot
```

```bash
pm2 stop music-bot
```

### 부팅 시 자동 시작 (윈도우)

윈도우는 `pm2 startup`을 지원하지 않으므로 **작업 스케줄러**를 사용합니다. 현재 이 PC에는 `PM2 Discord Music Bot`이라는 작업이 등록되어 있으며, 로그온 30초 후 `pm2 resurrect`를 실행해 저장된 프로세스를 복원합니다.

실행할 프로세스 목록을 바꾼 뒤에는 **반드시 저장**해야 다음 부팅에 반영됩니다.

```bash
pm2 save
```

작업을 확인하거나 제거하려면:

```bash
powershell -Command "Get-ScheduledTaskInfo -TaskName 'PM2 Discord Music Bot'"
```

```bash
powershell -Command "Unregister-ScheduledTask -TaskName 'PM2 Discord Music Bot' -Confirm:$false"
```

> 로그온 시점에 실행되므로 PC를 켜고 **로그인까지** 해야 봇이 살아납니다. 로그인 없이 부팅만으로 띄우려면 pm2를 윈도우 서비스로 등록하는 [pm2-installer](https://github.com/jessety/pm2-installer)가 필요합니다 (관리자 권한 필요).

절전 모드에 들어가면 봇도 멈춥니다. 깨어난 뒤 음성 연결은 대개 복구되지 않으므로 `/재생`을 다시 하거나 `pm2 restart music-bot`을 실행하세요.

## 음질 설정

봇은 접속한 음성 채널의 **비트레이트에 맞춰 자동으로 인코딩**합니다. 음질을 높이려면 디스코드에서 채널 비트레이트를 올리세요.

- 음성 채널 우클릭 → **채널 편집** → **비트레이트** 조정
- 값을 바꾼 뒤에는 `/정지` 후 다시 `/재생` (입장 시점에 값을 읽습니다)

서버 부스트 티어별 상한: 티어 0 = **96 kbps**, 티어 1 = 128, 티어 2 = 256, 티어 3 = 384 kbps. 디스코드 기본값은 64 kbps이므로, 부스트가 없어도 **96 kbps로 올리면 체감 차이가 있습니다.**

## 기술적 참고 사항

- **데이터 저장**: Node 내장 `node:sqlite`를 사용하며 `data/bot.sqlite`에 저장됩니다. 네이티브 빌드 도구가 필요 없습니다.
  > `better-sqlite3`는 `@discordjs/voice` 0.19와 함께 로드하면 프로세스가 SIGABRT로 죽는 충돌이 있어 사용하지 않습니다.
- **유튜브**: `yt-dlp` 실행 파일은 `npm install` 시 `yt-dlp-exec`가 자동으로 내려받습니다. 다만 실행은 `child_process`로 직접 하고, 바이너리 경로만 이 패키지에서 가져옵니다.
- **오디오 전달 방식**: yt-dlp가 오디오를 받아 **stdout으로 ffmpeg에 파이프**합니다. yt-dlp가 뽑아준 스트림 URL을 ffmpeg가 직접 열면 URL이 yt-dlp의 클라이언트/헤더에 묶여 있어 **403 Forbidden**이 발생할 수 있기 때문입니다.
- **ffmpeg**: `ffmpeg-static`에 포함된 바이너리를 사용하므로 별도 설치가 필요 없습니다.
- **음성 암호화**: 디스코드가 요구하는 **DAVE(종단간 암호화)** 프로토콜을 위해 `@discordjs/voice` 0.19+ 와 `@snazzah/davey`가 필요합니다. 구버전(0.17/0.18)은 음성 서버가 `4017 E2EE/DAVE protocol required`로 연결을 거부합니다.
- `/음악채널설정`으로 채널을 지정하면 그 밖에서는 음악 명령어가 동작하지 않습니다.
- **서버별 독립 동작**: 대기열·음량·반복 모드·플레이리스트가 서버마다 분리되어 있어, 여러 서버에서 동시에 사용할 수 있습니다.
- **한 서버에서는 음성 채널 하나만**: 디스코드 제약상 봇 하나는 서버당 음성 연결을 하나만 가집니다. 다른 음성 채널에서 `/재생`을 하면 — 기존 채널에 듣는 사람이 **없으면 대기열을 유지한 채 이동**하고, **있으면 거절**합니다.
- 대기열이 빈 채 5분이 지나면 음성 채널에서 자동으로 나갑니다.

## 문제 해결

**봇이 명령어에 응답하지 않거나 `Unknown interaction` 오류가 납니다**

봇이 두 개 이상 실행 중일 가능성이 높습니다. 코드를 수정하고 다시 실행할 때 이전 프로세스가 남아 있으면 발생합니다.

**pm2로 실행 중이라면** pm2 목록부터 확인하세요.

```bash
pm2 list
```

pm2가 띄운 봇은 커맨드라인이 `ProcessContainerFork.js`로 나타나므로 `index.js`로 검색해도 잡히지 않습니다. pm2 밖에서 따로 띄운 프로세스가 있는지는 아래로 확인합니다.

```bash
powershell -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId, CommandLine | Format-List"
```

pm2가 관리하는 봇은 `pm2 stop music-bot`으로, 그 밖의 잔여 프로세스는 PID를 지정해 종료하세요.

```bash
powershell -Command "Stop-Process -Id <PID> -Force"
```

**소리가 나지 않습니다**

- 봇에게 해당 음성 채널의 `Connect`/`Speak` 권한이 있는지 확인하세요.
- 연결에 실패하면 채팅에 **음성 서버 종료 코드**가 함께 표시됩니다. 그 번호를 확인하세요.
- 음질이 뭉개진다면 위의 [음질 설정](#음질-설정)을 참고하세요.

**종료할 때 `ERR_STREAM_PREMATURE_CLOSE`가 보입니다**

정상입니다. 재생 스트림을 의도적으로 끊을 때 나는 신호이며 무시하도록 처리되어 있습니다.

## 라이선스 / 이용 주의

유튜브 이용약관과 저작권법을 준수하는 범위 내에서 사용하세요.
