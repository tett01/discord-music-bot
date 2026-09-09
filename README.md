# 디스코드 음악 봇

유튜브 링크/검색어로 음악을 재생하고, 플레이리스트를 만들어 관리할 수 있는 디스코드 봇입니다.

## 주요 기능

### 재생

| 명령어 | 옵션 | 설명 |
| --- | --- | --- |
| `/재생` | `검색어` (필수) | 유튜브 링크 또는 검색어로 재생. 재생 중이면 대기열에 추가 |
| `/일시정지` | — | 재생 일시정지 |
| `/재개` | — | 일시정지 해제 |
| `/다음곡` | — | 현재 곡 건너뛰기 (한 곡 반복 중이어도 다음 곡으로 넘어감) |
| `/정지` | — | 재생 정지, 대기열 비우기, 음성 채널 퇴장 |
| `/대기열` | — | 현재 곡·대기열·반복 모드·음량 확인 |
| `/반복` | `모드` (필수) | `끄기` / `현재 곡 반복` / `전체 곡(대기열) 반복` |
| `/음량` | `크기` (필수) | **0~150** (%) |
| `/음질` | `모드` (필수) | `일반` / `원음`. 아래 참고 |

#### `/음질 원음`

유튜브 원본 Opus를 **재인코딩 없이** 그대로 디스코드에 전달합니다. 음질 손실이 사라지고 CPU 사용량도 줄어듭니다.

대신 오디오가 PCM 단계를 거치지 않으므로 **`/음량`이 적용되지 않습니다.** 소리 크기는 듣는 사람이 디스코드에서 봇 사용자 볼륨으로 조절해야 합니다. 설정은 **다음 곡부터** 반영됩니다.

> 음질의 상한은 결국 **음성 채널 비트레이트**입니다. 채널이 64kbps 이하라면 원음 모드로도 한계가 있으니 채널 설정을 96kbps 이상으로 올리세요. (인코더는 128kbps에서 잘립니다. 채널 비트레이트는 봇이 입장할 때 읽으므로 바꾼 뒤에는 재입장이 필요합니다)

### 플레이리스트

서버마다 독립적으로 저장됩니다.

| 서브커맨드 | 옵션 | 설명 |
| --- | --- | --- |
| `/플레이리스트 생성` | `이름` (필수) | 빈 플레이리스트 생성 |
| `/플레이리스트 추가` | `이름`, `검색어` (필수) | 곡 추가 |
| `/플레이리스트 목록` | `이름` (선택) | 이름을 주면 그 플레이리스트의 곡 목록, **비우면 전체 플레이리스트 목록** |
| `/플레이리스트 곡삭제` | `이름`, `번호` (필수) | `목록`에 표시된 번호로 곡 제거 (**1부터** 시작) |
| `/플레이리스트 삭제` | `이름` (필수) | 플레이리스트 통째로 삭제 |
| `/플레이리스트 재생` | `이름` (필수) | 플레이리스트 전체를 대기열에 추가 |

### 설정

| 명령어 | 옵션 | 설명 |
| --- | --- | --- |
| `/음악채널설정` | `채널` (선택), `해제` (선택) | 음악 명령어 전용 텍스트 채널 지정. **서버 관리** 권한 필요 |

- `채널`을 비우면 **명령을 실행한 현재 채널**로 지정됩니다.
- `해제: True`로 지정을 풀 수 있습니다.
- 이 명령어를 한 번도 쓰지 않았다면 **모든 채널**에서 음악 명령어를 사용할 수 있습니다.

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

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `DISCORD_TOKEN` | ✅ | 봇 토큰. Developer Portal → **Bot** → Reset Token |
| `CLIENT_ID` | ✅ | 애플리케이션 ID. **General Information** → Application ID |
| `GUILD_ID` | — | 채우면 해당 서버에만 즉시 등록, 비우면 전역 등록 (아래 참고) |

슬래시 명령어를 디스코드에 등록합니다 (명령어 정의를 바꾼 뒤에도 다시 실행).

```bash
npm run deploy
```

- `.env`에 `GUILD_ID`를 채우면 해당 서버에 **즉시** 반영됩니다 (테스트 권장).
- 비워두면 전역 등록되며 모든 서버 반영까지 최대 1시간 걸릴 수 있습니다.

> **`GUILD_ID`를 채웠다가 나중에 비울 때 주의하세요.** 등록은 길드 전용과 전역 중 한쪽에만 이뤄지고, 반대쪽을 지우지는 않습니다. 길드 전용으로 등록한 뒤 값을 비우고 다시 배포하면 **같은 명령어가 두 벌 보입니다.** 이때는 남아 있는 길드 명령어를 비워서 정리합니다.
>
> ```bash
> node -e "require('dotenv').config();const{REST,Routes}=require('discord.js');new REST().setToken(process.env.DISCORD_TOKEN).put(Routes.applicationGuildCommands(process.env.CLIENT_ID,'<GUILD_ID>'),{body:[]}).then(()=>console.log('길드 명령어를 정리했습니다.'))"
> ```

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

윈도우는 `pm2 startup`을 지원하지 않으므로 **작업 스케줄러**를 사용합니다. 로그온 30초 후 `pm2 resurrect`를 실행해 저장된 프로세스를 복원하는 방식입니다.

**1. 복원할 프로세스 목록을 저장합니다.** `pm2 resurrect`는 이때 저장된 목록을 되살립니다. 실행할 프로세스를 바꾼 뒤에는 **반드시 다시 저장**해야 다음 부팅에 반영됩니다.

```bash
pm2 save
```

**2. 작업을 등록합니다.** PowerShell에서 실행하세요. (관리자 권한 불필요)

```powershell
$pm2 = (Get-Command pm2.cmd).Source
$action = New-ScheduledTaskAction -Execute $pm2 -Argument 'resurrect'
$trigger = New-ScheduledTaskTrigger -AtLogOn
$trigger.Delay = 'PT30S'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit 0
Register-ScheduledTask -TaskName 'PM2 Discord Music Bot' -Action $action -Trigger $trigger -Settings $settings -Description 'pm2가 관리하는 디스코드 음악 봇을 로그온 시 복원한다.'
```

작업을 확인하거나 제거하려면:

```powershell
Get-ScheduledTaskInfo -TaskName 'PM2 Discord Music Bot'
```

```powershell
Unregister-ScheduledTask -TaskName 'PM2 Discord Music Bot' -Confirm:$false
```

> 로그온 시점에 실행되므로 PC를 켜고 **로그인까지** 해야 봇이 살아납니다. 로그인 없이 부팅만으로 띄우려면 pm2를 윈도우 서비스로 등록하는 [pm2-installer](https://github.com/jessety/pm2-installer)가 필요합니다 (관리자 권한 필요).

절전 모드에 들어가면 봇도 멈춥니다. 깨어난 뒤 음성 연결은 대개 복구되지 않으므로 `/재생`을 다시 하거나 `pm2 restart music-bot`을 실행하세요.

## 무료 호스팅으로 24시간 돌리기 (Render / Replit + UptimeRobot)

집 PC를 켜 두지 않고 돌리는 방법입니다. pm2 방식과 달리 **웹 서버가 함께 뜹니다.**

### 1. 왜 웹 서버가 필요한가

무료 플랜은 **일정 시간 요청이 없으면 인스턴스를 재웁니다.** (Render는 15분) 잠들면 음성 연결이 끊기고 봇이 오프라인으로 보입니다. 그래서 `src/keepalive.js`가 express로 아주 작은 서버를 띄우고, UptimeRobot이 5분마다 그 주소를 때려 깨어 있게 만듭니다.

Render는 여기에 더해 **컨테이너가 포트를 열지 않으면 배포 자체를 실패로 처리합니다.** 이 서버는 선택이 아니라 필수입니다.

| 경로 | 용도 |
| --- | --- |
| `GET /` | UptimeRobot이 때릴 곳. 본문은 `OK` 한 줄 |
| `GET /health` | 로그인 여부·서버 수·업타임·메모리(RSS) 확인용 JSON |

로컬이나 pm2로 돌릴 때는 포트를 잡을 이유가 없으므로 `.env`에 `DISABLE_KEEPALIVE=1`을 넣으세요.

### 2. Render 배포

저장소 루트의 [render.yaml](render.yaml)을 그대로 쓸 수 있습니다. 대시보드에서 **New → Blueprint**로 저장소를 연결하면 됩니다. 수동으로 만들 때는 이렇게 맞춥니다.

- **Environment**: Node
- **Build Command**: `npm install --omit=optional`
- **Start Command**: `npm start`
- **Health Check Path**: `/health`
- **환경변수**: `NODE_VERSION=24`, `DISCORD_TOKEN`, `CLIENT_ID`, `AUDIO_ENGINE=auto`, `YOUTUBE_COOKIE`

`NODE_VERSION`을 빠뜨리면 안 됩니다. 이 봇은 Node 내장 SQLite(`node:sqlite`)를 쓰므로 **23.4 미만에서는 부팅 시 바로 종료됩니다.**

`PORT`는 Render가 자동으로 넣어 주므로 직접 설정하지 마세요.

배포가 끝나면 브라우저로 `https://<서비스이름>.onrender.com/`을 열어 `OK`가 나오는지 먼저 확인합니다.

### 3. UptimeRobot 연결

1. [uptimerobot.com](https://uptimerobot.com)에서 **Add New Monitor**
2. Monitor Type: **HTTP(s)**
3. URL: `https://<서비스이름>.onrender.com/`
4. Monitoring Interval: **5 minutes**

> Render 무료 플랜은 **월 750시간**까지만 돕니다. 서비스가 하나면 한 달 내내(약 730시간) 돌릴 수 있지만, 두 개를 동시에 켜 두면 달 중간에 멈춥니다.

### 4. 유튜브 쿠키 설정 (IP 차단 회피) — 가장 중요

무료 호스팅은 **여러 사용자가 IP를 공유**합니다. 그 IP에서 유튜브 요청이 쏟아지면 유튜브가 봇으로 판단해 막습니다. 증상은 이렇습니다.

```
Sign in to confirm you're not a bot
```

봇은 이 경우 `🤖 유튜브가 이 서버를 봇으로 의심해 차단했습니다...`라고 알려 줍니다. 해결은 **로그인된 사용자의 쿠키를 붙이는 것**입니다. 유튜브 입장에서 익명 서버가 아니라 로그인한 사람으로 보이게 됩니다.

#### JavaScript 런타임 (403의 흔한 원인)

유튜브는 재생 URL의 `n` 파라미터를 **JS로 풀어야** 온전한 포맷을 내줍니다. 런타임이 없으면 yt-dlp가 그 단계를 건너뛰고 다른 클라이언트로 우회하는데, **그렇게 얻은 URL은 IP에 묶여 있어 데이터센터에서 403으로 거부되는 일이 잦습니다.** 손으로 받으면 되는데 봇에서만 403이 나는 상황이 여기서 생깁니다.

yt-dlp의 기본 런타임은 `deno` 하나뿐이라 대부분의 호스트에는 없습니다. **이 봇은 따로 설치하지 않습니다** — Node 위에서 돌고 있으므로 `--js-runtimes node:<현재 Node 경로>`를 자동으로 물려줍니다. 적용되면 첫 검색 때 한 번 찍힙니다.

```
[yt-dlp] JavaScript 런타임을 사용합니다: node:/home/container/bin/node
```

낡은 바이너리는 이 옵션 자체를 모르므로(넘기면 실행이 통째로 죽습니다) 지원 여부를 한 번 확인한 뒤에만 붙이고, 지원하지 않으면 갱신을 권하는 경고를 남깁니다. `YTDLP_JS_RUNTIME=off`로 끄거나, `YTDLP_JS_RUNTIME=deno`처럼 다른 런타임을 지정할 수 있습니다.

#### 재생이 안 될 때 원인 좁히기

```bash
node scripts/diagnose-ytdlp.js
```

봇과 **같은 코드 경로**로 조회와 스트림을 시험해, 어느 단계에서 막혔는지 알려줍니다. 봇이 실제로 쓰는 yt-dlp 경로와 버전, 붙는 인자, 쿠키 적용 여부도 함께 찍습니다. 디스코드 토큰이 필요 없고, 특정 곡만 확인하려면 URL이나 검색어를 인자로 줍니다.

- **조회부터 실패** → 봇 판정이나 영상 자체의 제약입니다. 메시지를 그대로 보세요.
- **조회는 되는데 스트림만 실패** → 대개 [바이너리가 낡았거나](#yt-dlp-바이너리-갱신) `YTDLP_PLAYER_CLIENT`가 나쁜 값입니다.
- **둘 다 성공인데 봇에서만 안 됨** → yt-dlp가 아니라 음성 연결 쪽입니다. 봇을 재시작했는지부터 확인하세요.

#### yt-dlp 바이너리 갱신

```bash
npm run update-ytdlp
```

**재생이 갑자기 전부 실패하면 여기부터 보세요.** 유튜브가 무언가 바꾸면 낡은 바이너리는 제목 조회까지만 되고 **오디오 다운로드에서 `HTTP Error 403: Forbidden`이 납니다.** 로그가 이렇게 보이면 거의 이 경우입니다.

```
[음악] guild ... yt-dlp 종료 코드=1 오류: ... HTTP 오류 403: 금지됨
```

바이너리는 `npm install` 시점에 받은 것이 그대로 남고, **`npm install`을 다시 돌려도 갱신되지 않습니다**(이미 있으면 건너뜁니다). 그래서 갱신에는 위 명령이 필요합니다. 현재 버전은 `./bin/yt-dlp --version`으로 확인합니다.

호스팅 패널의 콘솔에서는 yt-dlp 자체 업데이트도 됩니다.

```bash
./bin/yt-dlp -U
```

#### 쿠키 없이 먼저 시도해보기

봇 판정은 **클라이언트를 바꾸는 것만으로 비껴가는 경우가 있습니다.** 계정을 걸지 않아도 되므로 쿠키보다 먼저 시도해볼 값이 있습니다. 되면 5분, 안 되면 5분 버리는 것이라 손해가 적습니다.

> **먼저 [yt-dlp를 최신으로](#yt-dlp-바이너리-갱신) 갱신하세요.** 재생이 전부 실패하는 원인은 클라이언트보다 **낡은 바이너리**인 경우가 훨씬 많습니다. 바이너리부터 갱신하지 않으면 아래 값을 아무리 바꿔도 소용이 없습니다.

```
YTDLP_PLAYER_CLIENT=tv_embedded
```

yt-dlp에 `--extractor-args youtube:player_client=tv_embedded`로 전달됩니다. 쉼표로 여러 개를 적으면 앞에서부터 시도합니다.

**한 조합이 막히면 다른 조합으로 바꿔가며 시도해보세요.** 유튜브 쪽 사정으로 자주 바뀝니다. 2026년 9월, 차단되지 않은 IP에서 **최신 바이너리로 실제 오디오를 받아본** 결과는 이렇습니다.

| 값 | 결과 |
| --- | --- |
| (설정 없음) | 정상 — **대개 이게 최선입니다** |
| `tv_embedded` | 정상 |
| `android_vr` | 조회는 되지만 **다운로드가 403** |
| `web_safari`, `ios`, `mweb` | 포맷을 받지 못함 (PO Token 필요) |

> ⚠️ **`--print title`처럼 조회만 확인하면 안 됩니다.** `android_vr`은 제목은 멀쩡히 가져오면서 실제 오디오 요청에서 403이 납니다. 반드시 **오디오를 받아보는 것까지** 확인하세요.

**IP에 따라 결과가 다릅니다.** 위 표는 출발점일 뿐이니, 막힌 호스트에서는 직접 바꿔가며 확인하세요. 설정 없이 되는 것이 가장 좋으므로, **막히지 않는다면 이 변수는 비워 두세요.**

그 밖의 인자가 필요하면 `YTDLP_EXTRA_ARGS`에 그대로 적습니다. 따옴표로 묶인 값도 인식합니다.

```
YTDLP_EXTRA_ARGS=--extractor-args "youtube:player_client=tv" --sleep-requests 1
```

둘 다 지정하면 순서대로 모두 붙습니다. 적용되면 부팅 후 첫 검색 때 로그에 한 번 찍힙니다.

```
[yt-dlp] 추가 인자를 사용합니다: --extractor-args youtube:player_client=tv,web_safari
```

> 이 방법으로 통과하지 못하면 아래 쿠키로 넘어가세요. **`--extractor-args`는 play-dl 쪽에는 적용되지 않습니다** — yt-dlp가 실제 재생을 담당하므로 실용상 문제는 없습니다.

#### 쿠키 뽑기

> ⚠️ **주 계정을 쓰지 마세요.** 쿠키는 그 계정의 로그인 세션 자체입니다. 유출되면 비밀번호 없이도 계정에 접근할 수 있고, 유튜브가 자동화로 판단하면 그 계정이 제재를 받을 수 있습니다. **봇 전용으로 만든 부계정**으로만 하세요.

**방법 A — 브라우저에서 Cookie 헤더 복사 (Render 권장)**

1. 부계정으로 유튜브에 로그인합니다.
2. 그 상태에서 **시크릿 창**을 열고 다시 로그인합니다. (일반 창의 쿠키는 계속 갱신되어 금방 만료됩니다. 시크릿 창을 끝까지 닫지 않으면 세션이 고정됩니다)
3. `F12` → **Network** 탭 → `youtube.com` 문서 요청 클릭 → **Request Headers**의 `Cookie:` 값을 통째로 복사합니다.
4. Render 환경변수 `YOUTUBE_COOKIE`에 붙여 넣습니다. (`Cookie: ` 접두사가 붙어 있어도 봇이 알아서 떼어 냅니다)
5. 복사한 시크릿 창은 **로그아웃하지 말고 그냥 닫습니다.** 로그아웃하면 그 쿠키가 즉시 무효가 됩니다.

**방법 B — cookies.txt 파일**

브라우저 확장(“Get cookies.txt LOCALLY” 등)으로 유튜브 쿠키를 Netscape 형식으로 내보낸 뒤, 파일 경로를 `YOUTUBE_COOKIE_FILE`에 지정합니다.

이미 yt-dlp용으로 `YTDLP_COOKIES`를 쓰고 있었다면 **그대로 두면 됩니다.** play-dl이 같은 파일을 읽습니다. 두 형식(헤더 문자열 / Netscape) 모두 인식합니다.

#### 적용 확인

부팅 로그에 이렇게 찍히면 적용된 것입니다.

```
[play-dl] 유튜브 쿠키를 적용했습니다.
```

쿠키가 없으면 대신 경고가 뜹니다. 봇은 그래도 뜨고, 차단당하기 전까지는 정상 재생됩니다.

```
[play-dl] 유튜브 쿠키가 설정되지 않았습니다. 무료 호스팅에서는 ...
```

play-dl은 받은 쿠키를 `.data/youtube.data`에 저장하고 이후 토큰을 스스로 갱신합니다. Render처럼 재배포마다 디스크가 초기화되는 환경에서는 환경변수의 쿠키를 매번 다시 읽으므로 문제되지 않습니다.

> 쿠키는 영구적이지 않습니다. 보통 수 주~수 개월 뒤 만료되며, 그때 `🤖` 안내가 다시 나오면 위 과정을 반복해 갱신하세요.

### 5. 오디오 엔진 선택

| `AUDIO_ENGINE` | 동작 | 언제 쓰나 |
| --- | --- | --- |
| `auto` (기본) | play-dl로 조회하고, 스트림이 막히면 yt-dlp로 자동 전환 | **권장.** 한쪽이 막혀도 재생이 멈추지 않는다 |
| `playdl` | play-dl만 | 아래 경고를 확인한 뒤에만 |
| `ytdlp` | yt-dlp만 | play-dl 조회까지 실패할 때 |

> ⚠️ **`playdl`로 고정하지 마세요 (2026년 8월 확인).** play-dl은 마지막 릴리스가 2023년(1.9.7)이라 유튜브가 그 뒤 바꾼 서명(nsig) 로직을 풀지 못합니다. 제목·길이 같은 **정보 조회는 정상이지만 재생 URL이 비어 나옵니다.** 그래서 `auto`는 조회는 play-dl(빠르고 가볍다)로, 스트림은 실패 시 yt-dlp로 넘깁니다. 로그에 이 줄이 보이면 그 전환이 일어난 것입니다.
>
> ```
> [source] play-dl 스트림 실패, yt-dlp로 전환합니다: Invalid URL
> ```
>
> 나중에 play-dl이 갱신되면 이 줄이 사라지고 자동으로 가벼운 경로를 타게 됩니다. 코드는 바꿀 필요가 없습니다.

즉 **호스팅에도 yt-dlp 바이너리가 필요합니다.** `postinstall`이 python 없이 실행되는 standalone 빌드(약 40MB)를 자동으로 받으므로 따로 할 일은 없습니다. play-dl이 되살아나 yt-dlp를 완전히 빼고 싶어지면 그때 `AUDIO_ENGINE=playdl`과 `SKIP_YTDLP_DOWNLOAD=1`을 함께 주면 됩니다.

### 6. 메모리 512MB에서 살아남기

무료 인스턴스는 RAM이 512MB뿐이라, 아래가 기본으로 적용되어 있습니다.

- **`npm start`가 `--max-old-space-size=256`으로 실행됩니다.** 힙을 절반으로 묶어 두면 GC가 더 자주 돌지만, 컨테이너가 OOM으로 죽는 것보다 낫습니다.
- **discord.js 캐시를 대부분 0으로 막아 뒀습니다.** (메시지·프레젠스·이모지·스레드 등) 단 멤버/유저 캐시는 남겨 둡니다 — 봇이 “지금 채널에 듣는 사람이 있는지”를 이 캐시로 판단합니다.
- **`/음질 원음`이 가장 가볍습니다.** play-dl이 준 Opus를 그대로 디스코드로 넘기므로 **ffmpeg 프로세스가 아예 뜨지 않습니다.** 대신 원음 모드에서는 `/음량`이 동작하지 않습니다. (위 경고대로 지금은 yt-dlp로 전환되므로 이 지름길이 실제로 쓰이지는 않습니다. play-dl이 갱신되면 자동으로 적용됩니다)
- 그래도 빠듯하면 `PLAYDL_QUALITY=1`(중간 품질 소스)과 `MAX_OPUS_BITRATE=96`을 추가하세요.

현재 사용량은 `/health`의 `rssMb`로 볼 수 있습니다. 곡 하나를 재생 중일 때 200MB 안쪽이면 정상입니다.

### 7. 무료 호스팅의 한계 (알고 시작하기)

- **디스크가 재배포·재시작마다 초기화됩니다.** `data/bot.sqlite`에 저장되는 음량·반복 모드·플레이리스트가 전부 사라집니다. 플레이리스트를 오래 보관하려면 Render의 유료 Persistent Disk를 붙이고 `BOT_DB_PATH`를 그쪽으로 지정해야 합니다.
- **UptimeRobot으로 깨워 둬도 Render는 배포·유지보수로 컨테이너를 재시작합니다.** 그때 재생 중이던 대기열은 메모리에 있으므로 사라집니다.
- Replit도 같은 구조로 동작합니다. `PORT` 환경변수와 keep-alive 주소만 Replit이 주는 값으로 바꾸면 됩니다.

## 음질 설정

봇은 접속한 음성 채널의 **비트레이트에 맞춰 자동으로 인코딩**합니다. 음질을 높이려면 디스코드에서 채널 비트레이트를 올리세요.

- 음성 채널 우클릭 → **채널 편집** → **비트레이트** 조정
- 값을 바꾼 뒤에는 `/정지` 후 다시 `/재생` (입장 시점에 값을 읽습니다)

> **봇의 실효 상한은 128 kbps입니다.** 사용 중인 Opus 인코더가 비트레이트를 16~128 kbps로 제한하기 때문에, 채널 비트레이트를 그보다 높게 잡아도 음질은 더 좋아지지 않습니다.

디스코드 기본값은 64 kbps이므로 **96 kbps로만 올려도 체감 차이가 있고, 128 kbps에서 상한에 도달합니다.** 참고로 채널이 허용하는 값은 서버 부스트 티어에 따라 다릅니다 — 티어 0 = 96 kbps, 티어 1 = 128, 티어 2 = 256, 티어 3 = 384 kbps. 즉 **부스트는 이 봇의 음질과 무관하며**, 티어 1이면 이미 충분합니다.

## 기술적 참고 사항

- **데이터 저장**: Node 내장 `node:sqlite`를 사용하며 `data/bot.sqlite`에 저장됩니다. 네이티브 빌드 도구가 필요 없습니다.
  > `better-sqlite3`는 `@discordjs/voice` 0.19와 함께 로드하면 프로세스가 SIGABRT로 죽는 충돌이 있어 사용하지 않습니다.

  플레이리스트·음량·반복 모드·음악 채널 지정이 **전부 이 파일 하나에** 들어 있습니다. `data/`는 `.gitignore` 대상이라 저장소에 올라가지 않으므로, **이 파일을 잃으면 플레이리스트도 함께 사라집니다.** 백업/이전은 아래 [데이터 백업](#데이터-백업)을 참고하세요.
- **유튜브**: `yt-dlp` 실행 파일은 `npm install` 시 `yt-dlp-exec`가 자동으로 내려받습니다. 다만 실행은 `child_process`로 직접 하고, 바이너리 경로만 이 패키지에서 가져옵니다.
- **오디오 전달 방식**: yt-dlp가 오디오를 받아 **stdout으로 ffmpeg에 파이프**합니다. yt-dlp가 뽑아준 스트림 URL을 ffmpeg가 직접 열면 URL이 yt-dlp의 클라이언트/헤더에 묶여 있어 **403 Forbidden**이 발생할 수 있기 때문입니다.
- **ffmpeg**: `ffmpeg-static`에 포함된 바이너리를 사용하므로 별도 설치가 필요 없습니다.
- **음성 암호화**: 디스코드가 요구하는 **DAVE(종단간 암호화)** 프로토콜을 위해 `@discordjs/voice` 0.19+ 와 `@snazzah/davey`가 필요합니다. 구버전(0.17/0.18)은 음성 서버가 `4017 E2EE/DAVE protocol required`로 연결을 거부합니다.
- `/음악채널설정`으로 채널을 지정하면 그 밖에서는 음악 명령어가 동작하지 않습니다.
- **서버별 독립 동작**: 대기열·음량·반복 모드·플레이리스트가 서버마다 분리되어 있어, 여러 서버에서 동시에 사용할 수 있습니다.
- **한 서버에서는 음성 채널 하나만**: 디스코드 제약상 봇 하나는 서버당 음성 연결을 하나만 가집니다. 다른 음성 채널에서 `/재생`을 하면 — 기존 채널에 듣는 사람이 **없으면 대기열을 유지한 채 이동**하고, **있으면 거절**합니다.
- 대기열이 빈 채 5분이 지나면 음성 채널에서 자동으로 나갑니다.

## 데이터 백업

플레이리스트와 서버 설정은 `data/bot.sqlite` 하나에 모여 있습니다. 이 파일을 복사해 두면 다른 PC로 그대로 옮길 수 있습니다.

다만 WAL 모드로 동작하므로 **실행 중에 파일만 복사하면 최근 변경이 빠질 수 있습니다.** 봇을 멈추고 복사하는 것이 가장 안전합니다.

```bash
pm2 stop music-bot
```

멈춘 뒤 `data/` 폴더를 통째로 복사하세요. (`bot.sqlite`와 함께 생기는 `-wal`, `-shm` 파일도 같이 옮기면 확실합니다.)

봇을 멈출 수 없다면 SQLite에게 정합성 있는 사본을 만들게 합니다.

```bash
node -e "const{DatabaseSync}=require('node:sqlite');new DatabaseSync('data/bot.sqlite').exec(\"VACUUM INTO 'data/backup.sqlite'\");console.log('data/backup.sqlite 생성 완료');"
```

복원할 때는 봇을 멈춘 뒤 백업 파일을 `data/bot.sqlite`로 되돌려 놓고 다시 시작하면 됩니다.

## 문제 해결

**봇이 명령어에 응답하지 않거나 `Unknown interaction` 오류가 납니다**

봇이 두 개 이상 실행 중일 가능성이 높습니다. 코드를 수정하고 다시 실행할 때 이전 프로세스가 남아 있으면 발생합니다.

**pm2로 실행 중이라면** pm2 목록부터 확인하세요.

```bash
pm2 list
```

pm2가 띄운 봇은 커맨드라인이 `ProcessContainerFork.js`로 나타나므로 `index.js`로 검색해도 잡히지 않습니다. pm2 밖에서 따로 띄운 프로세스가 있는지는 아래로 확인합니다.

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, CommandLine | Format-List
```

pm2가 관리하는 봇은 `pm2 stop music-bot`으로, 그 밖의 잔여 프로세스는 PID를 지정해 종료하세요.

```powershell
Stop-Process -Id <PID> -Force
```

**어제까지 되던 재생이 갑자기 전부 실패합니다**

유튜브가 내부 동작을 바꾸면 낡은 `yt-dlp`는 추출에 실패합니다. 이 봇에서 가장 흔한 장애 원인입니다.

`yt-dlp` 바이너리는 `npm install` 시점에 받은 것이 그대로 유지되며 **자동으로 갱신되지 않습니다.** 다음으로 최신 버전을 받으세요.

```bash
node -e "console.log(require('yt-dlp-exec/src/constants').YOUTUBE_DL_PATH)"
```

출력된 경로의 실행 파일에 `-U`를 붙여 실행하면 자체 업데이트됩니다. 갱신 후 봇을 재시작하세요.

```bash
pm2 restart music-bot
```

**특정 영상만 재생되지 않습니다**

일부 영상은 봇으로 재생할 수 없으며, 이는 고장이 아닙니다.

- **연령 제한** 영상 — 로그인이 필요해 재생할 수 없습니다
- **지역 제한** 영상 — 봇이 돌아가는 PC의 지역에서 차단된 경우
- **비공개·삭제**된 영상
- **라이브 스트림** — 실시간 방송은 지원하지 않습니다

원인은 콘솔 로그에 `yt-dlp` 메시지로 남습니다. `pm2 logs music-bot`으로 확인하세요.

**소리가 나지 않습니다**

- 봇에게 해당 음성 채널의 `Connect`/`Speak` 권한이 있는지 확인하세요.
- 연결에 실패하면 채팅에 **음성 서버 종료 코드**가 함께 표시됩니다. 그 번호를 확인하세요.
- 음질이 뭉개진다면 위의 [음질 설정](#음질-설정)을 참고하세요.

**종료할 때 `ERR_STREAM_PREMATURE_CLOSE`가 보입니다**

정상입니다. 재생 스트림을 의도적으로 끊을 때 나는 신호이며 무시하도록 처리되어 있습니다.

## 라이선스 / 이용 주의

개인용 프로젝트로, 공개 배포를 전제로 하지 않습니다 (`package.json`의 `"license": "UNLICENSED"`, `"private": true`). 외부에 공개할 계획이 생기면 MIT 등 원하는 라이선스를 정해 `LICENSE` 파일을 추가하고 `package.json`의 `license` 필드를 함께 바꾸세요.

유튜브 이용약관과 저작권법을 준수하는 범위 내에서 사용하세요.
