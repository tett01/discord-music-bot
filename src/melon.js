// 멜론 인기차트 TOP 10을 주기적으로 긁어와 메모리에 캐싱한다.
//
// 명령어를 칠 때마다 크롤링하면 요청이 사용자 수만큼 늘어 차단 위험이 있으므로,
// 1시간에 한 번만 받아두고 명령어는 캐시만 읽는다. 캐시는 프로세스 메모리이며
// 재시작하면 사라진다(재시작 직후 첫 갱신이 바로 돌기 때문에 문제되지 않는다).
//
// 파싱을 정규식으로 하는 이유는 의존성(cheerio 등)을 늘리지 않기 위해서다.
// 멜론이 마크업을 바꾸면 parseMelonChart가 빈 배열을 돌려주는데, 그때
// refreshMelonChart는 기존 캐시를 덮어쓰지 않고 유지한다.

const MELON_CHART_URL = 'https://www.melon.com/chart/index.htm';
const CHART_SIZE = 10;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

// 기본 UA(node-fetch 계열)로 요청하면 멜론이 응답을 거부한다. 브라우저와 같은
// 헤더를 붙여야 정상적인 HTML이 온다.
const MELON_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Referer: 'https://www.melon.com/',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    // 아티스트 구분자는 "</a>, <a>" 형태라, 태그를 공백으로 바꾸면 "A , B"가 된다.
    .replace(/\s+,/g, ',')
    .trim();
}

/**
 * 멜론 차트 페이지 HTML에서 상위 N곡을 뽑는다.
 *
 * 네트워크에 의존하지 않는 순수 함수라 단독으로 테스트할 수 있다.
 *
 * @param {string} html
 * @param {number} limit
 * @returns {{ rank: number, title: string, artist: string }[]}
 */
function parseMelonChart(html, limit = CHART_SIZE) {
  const chart = [];

  // 차트 행은 <tr class="lst50"> / <tr class="lst100">이며 순위 순으로 나온다.
  for (const row of String(html).split(/<tr[\s>]/)) {
    if (chart.length >= limit) break;
    if (!row.includes('rank01')) continue;

    // <span class="rank ">1</span> — 클래스 뒤에 공백이 붙는 경우가 있어 [^"]*로 받는다.
    const rankMatch = row.match(/<span class="rank[^"]*">\s*(\d+)\s*<\/span>/);
    const titleBlock = row.match(/<div class="ellipsis rank01">([\s\S]*?)<\/div>/);
    const artistBlock = row.match(/<div class="ellipsis rank02">([\s\S]*?)<\/div>/);
    if (!rankMatch || !titleBlock || !artistBlock) continue;

    const titleLink = titleBlock[1].match(/<a[^>]*>([\s\S]*?)<\/a>/);
    const title = stripTags(titleLink ? titleLink[1] : titleBlock[1]);

    // checkEllipsis span은 아티스트 목록을 그대로 한 번 더 복제해둔 것이라 잘라낸다.
    // 앞부분만 태그를 벗기면 아티스트가 여럿이어도 "A, B" 형태로 나온다.
    const artist = stripTags(artistBlock[1].split('<span class="checkEllipsis')[0]);

    if (!title || !artist) continue;
    chart.push({ rank: Number(rankMatch[1]), title, artist });
  }

  return chart;
}

/**
 * 멜론 차트를 실제로 내려받아 파싱한다.
 * @returns {Promise<{ rank: number, title: string, artist: string }[]>}
 */
async function fetchMelonChart() {
  const response = await fetch(MELON_CHART_URL, {
    headers: MELON_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`멜론 응답 오류: HTTP ${response.status}`);
  }

  return parseMelonChart(await response.text(), CHART_SIZE);
}

let cachedChart = [];
let cachedAt = null;
let refreshTimer = null;

/**
 * 캐시를 갱신한다. 실패하거나 파싱 결과가 비면 기존 캐시를 유지한다.
 * @returns {Promise<boolean>} 갱신 성공 여부
 */
async function refreshMelonChart() {
  let chart;
  try {
    chart = await fetchMelonChart();
  } catch (error) {
    console.error('[멜론차트] 갱신 실패:', error.message);
    return false;
  }

  if (chart.length === 0) {
    // HTTP는 200인데 결과가 비었다면 마크업이 바뀐 것이다. 덮어쓰면 멀쩡한
    // 캐시까지 날아가므로 그대로 두고 로그만 남긴다.
    console.error('[멜론차트] 파싱 결과가 비어 있습니다. 마크업이 변경되었을 수 있습니다.');
    return false;
  }

  cachedChart = chart;
  cachedAt = new Date();
  console.log(`[멜론차트] 갱신 완료 (${chart.length}곡) — 1위 ${chart[0].artist} - ${chart[0].title}`);
  return true;
}

/**
 * 캐시된 차트를 돌려준다. 호출 측이 배열을 건드려도 캐시가 흔들리지 않도록 복사본을 준다.
 * @returns {{ tracks: { rank: number, title: string, artist: string }[], updatedAt: Date | null }}
 */
function getCachedChart() {
  return { tracks: cachedChart.map((track) => ({ ...track })), updatedAt: cachedAt };
}

/** 즉시 한 번 갱신하고, 이후 1시간 간격으로 반복한다. */
function startMelonChartRefresh() {
  if (refreshTimer) return;
  refreshMelonChart();
  refreshTimer = setInterval(refreshMelonChart, REFRESH_INTERVAL_MS);
  // 타이머 때문에 프로세스가 종료되지 못하는 일이 없도록 한다.
  refreshTimer.unref?.();
}

function stopMelonChartRefresh() {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
}

module.exports = {
  MELON_CHART_URL,
  CHART_SIZE,
  REFRESH_INTERVAL_MS,
  parseMelonChart,
  fetchMelonChart,
  refreshMelonChart,
  getCachedChart,
  startMelonChartRefresh,
  stopMelonChartRefresh,
};
