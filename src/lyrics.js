// 가사 조회·파싱·캐싱. **디스코드에 의존하지 않는다.**
//
// 소스는 lrclib.net이다. HTML이 아니라 JSON을 주므로 파싱 의존성(cheerio 등)이 필요 없고,
// 동기 가사(LRC)를 그대로 준다. 인증도 없다.
//
// 512MB 인스턴스에서 돌기 때문에 **캐시에 상한이 세 겹 걸려 있다.**
//
//   1. 항목 수    — MAX_CACHE_ENTRIES (기본 50곡, 삽입 순서를 쓰는 Map이라 이것만으로 LRU가 된다)
//   2. 곡당 크기  — MAX_LYRICS_BYTES (32KB. 이상한 응답이 힙을 먹는 것을 막는다)
//   3. 수명       — CACHE_TTL_MS (6시간)
//
// 최악의 경우 상주 메모리는 50 × 32KB = 1.6MB로 고정된다. 상한이 코드에 박혀 있는 것이 요점이다.
//
// melon.js의 규칙 두 개를 그대로 가져왔다: 브라우저와 같은 UA를 붙이고,
// **파싱 결과가 비면 캐시를 덮어쓰지 않는다.**

const LRCLIB_SEARCH_URL = 'https://lrclib.net/api/search';
const FETCH_TIMEOUT_MS = 10_000;

const MAX_LYRICS_BYTES = 32 * 1024;
const DEFAULT_CACHE_ENTRIES = 50;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// 후보를 고를 때 허용하는 길이 오차(초). 유튜브 영상은 인트로/아웃트로가 붙어 원곡보다
// 조금 길기 마련이라 0으로 두면 아무것도 못 고른다. 반대로 너무 넓히면 다른 곡을 물어온다.
const DURATION_TOLERANCE_SEC = 8;

const LYRICS_HEADERS = {
  // lrclib은 어떤 앱이 쓰는지 밝혀주길 요청한다. 기본 UA로도 200이 오지만 예의 문제다.
  'User-Agent': 'tett-music-bot (Discord music bot)',
  Accept: 'application/json',
};

// 유튜브 제목에 붙는 잡음. 가사 검색어에 그대로 넣으면 후보가 하나도 안 나온다.
const TITLE_NOISE_KEYWORDS =
  /official|m\/?v\b|music\s*video|lyrics?|lyric\s*video|audio|visualizer|teaser|trailer|performance|dance\s*practice|color\s*coded|sub(title)?s?|한글|자막|가사|해석|리릭|4k|8k|hd|hq|full\s*ver|inst(rumental)?|karaoke|노래방/i;

// "아티스트 - 제목"을 가르는 구분자. 전각 하이픈과 대시도 받는다.
// K-pop 공식 채널이 즐겨 쓰는 "BTS _ Dynamite" 형태의 밑줄도 같이 받는다.
const ARTIST_SEPARATOR = /\s+[-–—―_]\s+/;

// 괄호 없이 제목 꼬리에 그냥 붙는 잡음. "Ditto Official MV"처럼 온다.
const TRAILING_NOISE = /\s+(official|m\/?v|music\s*video|lyrics?|lyric\s*video|audio|visualizer|4k|8k|hd|hq)\s*$/i;

/**
 * 유튜브 영상 제목을 가사 검색에 쓸 `{ artist, title }`로 정리한다.
 *
 * 가사 매칭 정확도의 거의 전부가 여기서 결정된다. 네트워크에 의존하지 않는 순수 함수다.
 *
 * @param {string} rawTitle
 * @returns {{ artist: string, title: string }}
 */
function normalizeTitle(rawTitle) {
  let text = String(rawTitle ?? '');

  // 대괄호·꺾쇠 안은 대개 통째로 잡음이다. ([MV], 【공식】, 「」)
  text = text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/【[^】]*】/g, ' ')
    .replace(/「[^」]*」/g, ' ')
    .replace(/『[^』]*』/g, ' ');

  // 소괄호는 의미 있는 것도 있으므로(예: "(Prod. by ...)") 잡음 키워드가 들어 있을 때만 지운다.
  text = text.replace(/\(([^()]*)\)/g, (match, inner) => (TITLE_NOISE_KEYWORDS.test(inner) ? ' ' : match));

  // feat./ft./with 이후는 아티스트 목록이라 검색을 방해한다.
  text = text.replace(/\s*[([]?\s*(feat|ft|with)\.?\s[^)\]]*[)\]]?/gi, ' ');

  // "제목 | 채널명" 꼬리
  text = text.replace(/\s*\|[^|]*$/, ' ');

  text = text.replace(/\s+/g, ' ').trim();

  // 꼬리 잡음은 여러 개가 겹쳐 붙는다("... Official MV"). 더 이상 줄지 않을 때까지 깎는다.
  let previous;
  do {
    previous = text;
    text = text.replace(TRAILING_NOISE, '').trim();
  } while (text !== previous);

  const parts = text.split(ARTIST_SEPARATOR);
  if (parts.length >= 2) {
    const artist = parts[0].trim();
    // 구분자가 여러 개면 첫 번째만 아티스트로 보고 나머지는 제목에 되돌린다.
    const title = parts.slice(1).join(' - ').trim();
    if (artist && title) return { artist, title };
  }

  return { artist: '', title: text };
}

// [mm:ss.xx] 또는 [mm:ss:xx]. 시(hh)는 없다고 봐도 되지만 분이 세 자리인 LRC도 있다.
const LRC_TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/**
 * LRC 텍스트를 `[{ at, text }]`로 바꾼다. `at`은 곡 시작부터의 밀리초다.
 *
 * - 한 줄에 타임스탬프가 여러 개 붙어 있으면(후렴 반복) 각각을 따로 만든다.
 * - `[ar:...]` 같은 메타데이터 태그는 숫자로 시작하지 않아 자연히 걸러진다.
 * - 가사가 빈 줄(간주)도 `text: ''`로 남긴다. 화면에서 음표로 표시한다.
 *
 * 순수 함수다.
 *
 * @param {string} lrc
 * @returns {{ at: number, text: string }[]}
 */
function parseLrc(lrc) {
  const lines = [];

  for (const rawLine of String(lrc ?? '').split(/\r?\n/)) {
    LRC_TIMESTAMP.lastIndex = 0;
    const stamps = [];
    let match;
    while ((match = LRC_TIMESTAMP.exec(rawLine)) !== null) {
      const [, min, sec, frac] = match;
      // .5 → 500ms, .55 → 550ms, .555 → 555ms
      const fraction = frac ? Number(frac.padEnd(3, '0')) : 0;
      stamps.push(Number(min) * 60_000 + Number(sec) * 1000 + fraction);
    }
    if (stamps.length === 0) continue;

    const text = rawLine.replace(LRC_TIMESTAMP, '').trim();
    for (const at of stamps) lines.push({ at, text });
  }

  // 후렴 반복 때문에 순서가 섞여 나올 수 있다. lineIndexAt이 이분 탐색을 쓰므로 정렬은 필수다.
  lines.sort((a, b) => a.at - b.at);
  return lines;
}

/**
 * 현재 재생 위치에 해당하는 줄의 인덱스를 이분 탐색으로 찾는다.
 *
 * 아직 첫 줄 전(전주)이면 -1을 준다. 곡마다 수십 번 불리므로 선형 탐색을 쓰지 않는다.
 *
 * @param {{ at: number }[]} lines
 * @param {number} positionMs
 * @returns {number} -1이면 아직 시작 전
 */
function lineIndexAt(lines, positionMs) {
  if (!lines || lines.length === 0) return -1;

  let low = 0;
  let high = lines.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid].at <= positionMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

const WINDOW_BEFORE = 2;
const WINDOW_AFTER = 2;

// 색을 쓰지 않을 때(LYRICS_PLAIN_STYLE=1) 빈 줄을 채우는 제로폭 공백.
// 코드블록 밖에서는 빈 문자열을 넣으면 디스코드가 줄을 접어 화면이 튄다.
const BLANK_LINE = '\u200b';

// 코드블록은 줄바꿈이 일어나면 색이 이어진 줄까지 번져 정렬이 흐트러진다.
// 정상적인 가사 한 줄은 이보다 훨씬 짧다.
const MAX_LINE_CHARS = 64;

// 디스코드가 ```ansi 코드블록에서 해석하는 SGR 코드.
// 0;30 어두운 회색 / 1;33 굵은 노랑 / 0;37 흰색 / 0 되돌리기
const ANSI = {
  past: '\u001b[0;30m',
  current: '\u001b[1;33m',
  next: '\u001b[0;37m',
  reset: '\u001b[0m',
};

// 색을 쓰지 않을 때 현재 줄을 가리키는 표시. 두 칸으로 맞춰 줄이 밀리지 않게 한다.
const PLAIN_MARKERS = { current: '\u25b8 ', other: '  ' };

/**
 * 가사 한 줄을 코드블록에 넣어도 안전한 모양으로 만든다.
 *
 * **백틱을 지우지 않으면 가사 한 줄이 코드블록을 통째로 깨뜨린다.** 제어문자를 지우는
 * 것도 같은 이유다 — 가사에 ESC가 섞여 있으면 우리가 정한 색을 덮어쓴다.
 *
 * @param {string} text
 * @returns {string}
 */
function sanitizeLyricLine(text) {
  const clean = String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/`/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return clean.length > MAX_LINE_CHARS ? `${clean.slice(0, MAX_LINE_CHARS - 1)}\u2026` : clean;
}

/** ANSI 색이 깨져 보이는 환경을 위한 탈출구. 값이 '1'이면 색 없이 그린다. */
function plainStyle() {
  return String(process.env.LYRICS_PLAIN_STYLE || '').trim() === '1';
}

/**
 * 현재 줄을 화면 가운데에 고정한 5줄 창을 그린다.
 *
 * 디스코드에는 애니메이션이 없다. **같은 메시지를 다시 그리는 것으로 스크롤을 흉내낸다.**
 *
 * 대비는 크기가 아니라 **색**으로 준다. 헤딩(`## `)과 서브텍스트(`-# `)를 섞으면 한 블록
 * 안에 글씨 크기가 세 종류가 되어 줄 높이가 들쭉날쭉해진다. ```ansi 코드블록은 모든 줄이
 * 같은 크기라 화면이 흔들리지 않는다.
 *
 *   - 지난 줄  회색
 *   - 현재 줄  굵은 노랑   ← 여기가 "뚜렷하게"
 *   - 다음 줄  흰색
 *
 * 순수 함수다. 돌려주는 문자열은 500바이트 안쪽이고 즉시 GC된다.
 *
 * @param {{ at: number, text: string }[]} lines
 * @param {number} index lineIndexAt의 결과. -1이면 전주
 * @param {{ color?: boolean }} [options]
 * @returns {string}
 */
function renderWindow(lines, index, { color = !plainStyle() } = {}) {
  const body = [];

  for (let i = index - WINDOW_BEFORE; i <= index + WINDOW_AFTER; i += 1) {
    if (!lines || i < 0 || i >= lines.length) {
      // 곡의 처음/끝에서 창의 높이가 출렁이지 않도록 빈 줄로 채운다.
      body.push(color ? '' : BLANK_LINE);
      continue;
    }

    // 간주 구간을 빈 줄로 두면 화면이 비어 멈춘 것처럼 보인다.
    const text = sanitizeLyricLine(lines[i].text) || '\u266a';

    if (!color) {
      body.push(`${i === index ? PLAIN_MARKERS.current : PLAIN_MARKERS.other}${text}`);
      continue;
    }

    const style = i === index ? ANSI.current : i < index ? ANSI.past : ANSI.next;
    body.push(`${style}${text}${ANSI.reset}`);
  }

  return color ? ['```ansi', ...body, '```'].join('\n') : body.join('\n');
}

/**
 * lrclib 검색 결과에서 가장 그럴듯한 후보를 고른다.
 *
 * 길이가 맞는 것을 우선하고, 그 안에서 동기 가사가 있는 것을 우선한다. **길이를 안 보면
 * 같은 제목의 다른 버전(라이브·리믹스)을 물어와 가사가 곡과 어긋난다.**
 *
 * 순수 함수다.
 *
 * @param {Array<object>} candidates lrclib 응답 배열
 * @param {number | null} durationSec 재생할 곡의 길이(초). 모르면 null
 * @returns {object | null}
 */
function pickLyricsCandidate(candidates, durationSec) {
  const usable = (Array.isArray(candidates) ? candidates : []).filter(
    (item) => item && !item.instrumental && (item.syncedLyrics || item.plainLyrics)
  );
  if (usable.length === 0) return null;

  const score = (item) => {
    const gap =
      Number.isFinite(durationSec) && Number.isFinite(item.duration)
        ? Math.abs(item.duration - durationSec)
        : Number.POSITIVE_INFINITY;
    return {
      // 길이가 허용 오차 안인지가 1순위다.
      inTolerance: gap <= DURATION_TOLERANCE_SEC ? 0 : 1,
      synced: item.syncedLyrics ? 0 : 1,
      gap,
    };
  };

  return usable
    .map((item) => ({ item, s: score(item) }))
    .sort((a, b) => a.s.inTolerance - b.s.inTolerance || a.s.synced - b.s.synced || a.s.gap - b.s.gap)[0].item;
}

/** 32KB를 넘는 본문은 버린다. 정상적인 가사는 15KB를 넘지 않는다. */
function withinSizeLimit(text) {
  return typeof text === 'string' && text.length > 0 && Buffer.byteLength(text, 'utf8') <= MAX_LYRICS_BYTES;
}

/**
 * lrclib에서 가사를 받아 온다. 못 찾으면 null이다.
 *
 * @param {{ title: string, duration?: number }} track
 * @returns {Promise<{ synced: {at:number,text:string}[] | null, plain: string | null, trackName: string, artistName: string } | null>}
 */
async function fetchLyrics(track) {
  const { artist, title } = normalizeTitle(track.title);
  if (!title) return null;

  const params = new URLSearchParams();
  // 아티스트를 못 가려냈으면 제목 전체로 통째 검색한다(q). 가르면 필드로 나눠 보내는 쪽이 정확하다.
  if (artist) {
    params.set('track_name', title);
    params.set('artist_name', artist);
  } else {
    params.set('q', title);
  }

  const response = await fetch(`${LRCLIB_SEARCH_URL}?${params}`, {
    headers: LYRICS_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    // 404는 "그런 가사 없음"이라 오류가 아니다.
    if (response.status === 404) return null;
    throw new Error(`가사 서버 응답 오류: HTTP ${response.status}`);
  }

  const picked = pickLyricsCandidate(await response.json(), track.duration ?? null);
  if (!picked) return null;

  const synced = withinSizeLimit(picked.syncedLyrics) ? parseLrc(picked.syncedLyrics) : [];
  const plain = withinSizeLimit(picked.plainLyrics) ? picked.plainLyrics : null;

  if (synced.length === 0 && !plain) return null;

  return {
    synced: synced.length > 0 ? synced : null,
    plain,
    trackName: picked.trackName ?? title,
    artistName: picked.artistName ?? artist,
  };
}

function parseCacheLimit(raw = process.env.LYRICS_CACHE_SIZE) {
  const value = Number.parseInt(String(raw ?? '').trim(), 10);
  // 잘못된 값에 예외를 던지지 않는다. 설정 실수로 기능이 막히는 편이 더 나쁘다.
  if (!Number.isInteger(value) || value < 1 || value > 500) return DEFAULT_CACHE_ENTRIES;
  return value;
}

const cacheLimit = parseCacheLimit();
/** @type {Map<string, { value: object | null, at: number }>} */
const cache = new Map();
/** 같은 곡을 동시에 여러 번 조회하지 않도록 진행 중인 조회를 공유한다. */
const inflight = new Map();

function cacheGet(url) {
  const entry = cache.get(url);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(url);
    return undefined;
  }
  return entry;
}

function cacheSet(url, value) {
  // 갱신이면 한 번 지워서 삽입 순서를 맨 뒤로 보낸다(LRU).
  cache.delete(url);
  cache.set(url, { value, at: Date.now() });
  while (cache.size > cacheLimit) {
    // Map은 삽입 순서를 지키므로 첫 키가 가장 오래된 것이다.
    cache.delete(cache.keys().next().value);
  }
}

/**
 * 가사를 돌려준다. 캐시에 있으면 네트워크를 타지 않는다.
 *
 * **못 찾은 결과(null)도 캐싱한다.** 안 그러면 한 곡 반복 재생에서 같은 조회를 끝없이 반복한다.
 *
 * @param {{ title: string, url: string, duration?: number }} track
 * @returns {Promise<object | null>}
 */
async function getLyrics(track) {
  const key = track?.url ?? track?.title;
  if (!key) return null;

  const cached = cacheGet(key);
  if (cached) return cached.value;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = fetchLyrics(track)
    .then((value) => {
      cacheSet(key, value);
      return value;
    })
    .catch((error) => {
      // 실패는 캐싱하지 않는다. 일시적인 네트워크 오류를 6시간 동안 기억할 이유가 없다.
      console.error(`[가사] 조회 실패 (${track.title}):`, error.message);
      return null;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

/** 기능을 통째로 끌 수 있게 한다. keepalive.js의 DISABLE_KEEPALIVE와 같은 관례다. */
function lyricsDisabled() {
  return String(process.env.DISABLE_LYRICS || '').trim() === '1';
}

module.exports = {
  MAX_LYRICS_BYTES,
  CACHE_TTL_MS,
  DURATION_TOLERANCE_SEC,
  WINDOW_BEFORE,
  WINDOW_AFTER,
  BLANK_LINE,
  ANSI,
  MAX_LINE_CHARS,
  sanitizeLyricLine,
  plainStyle,
  normalizeTitle,
  parseLrc,
  lineIndexAt,
  renderWindow,
  pickLyricsCandidate,
  parseCacheLimit,
  fetchLyrics,
  getLyrics,
  lyricsDisabled,
  // 테스트에서 캐시 상태를 보고 비우기 위한 창. 운영 코드는 건드리지 않는다.
  cacheState: () => ({ limit: cacheLimit, size: cache.size, keys: [...cache.keys()] }),
  clearLyricsCache: () => cache.clear(),
};
