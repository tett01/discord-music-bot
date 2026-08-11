const test = require('node:test');
const assert = require('node:assert/strict');

const { parseMelonChart } = require('../src/melon');

// 실제 멜론 차트 페이지의 행 구조를 줄인 것. 공백/개행과 checkEllipsis 복제까지
// 그대로 두어야 파싱이 실전과 같은 조건에서 검증된다.
function row(rank, title, artist, { multiArtist = false } = {}) {
  const artistLinks = (multiArtist ? artist.split(' & ') : [artist])
    .map((name) => `<a href="/artist/detail.htm?artistId=1" title="${name} - 페이지 이동">${name}</a>`)
    .join(', ');

  return `
    <tr class="lst50" id="lst50" data-song-no="${1000 + rank}">
      <td><div class="wrap t_center"><span class="rank ">${rank}</span></div></td>
      <td><div class="wrap">
        <div class="wrap_song_info">
          <div class="ellipsis rank01"><span>
            <a href="javascript:melon.play.playSong('1000002721',${1000 + rank});" title="${title} 재생">${title}</a>
          </span></div><br>
          <div class="ellipsis rank02">
            ${artistLinks}<span class="checkEllipsis" style="display:none">${artistLinks}</span>
          </div>
        </div>
      </div></td>
    </tr>`;
}

const SAMPLE = `<table><tbody>
  ${row(1, 'LOVE ATTACK', 'RESCENE&nbsp;(리센느)')}
  ${row(2, 'Fish &amp; Chips', '아이유')}
  ${row(3, '밤편지', '아이유 & 박효신', { multiArtist: true })}
  ${row(4, '네 곡', '네 가수')}
</tbody></table>`;

test('차트 행에서 순위·곡명·아티스트를 뽑는다', () => {
  const chart = parseMelonChart(SAMPLE);

  assert.equal(chart.length, 4);
  assert.deepEqual(chart[0], { rank: 1, title: 'LOVE ATTACK', artist: 'RESCENE (리센느)' });
});

test('HTML 엔티티를 사람이 읽는 문자로 되돌린다', () => {
  // 여기서 &amp;가 남으면 그대로 유튜브 검색어에 들어가 엉뚱한 곡을 찾는다.
  const chart = parseMelonChart(SAMPLE);
  assert.equal(chart[1].title, 'Fish & Chips');
  assert.ok(!chart[0].artist.includes('&nbsp;'));
});

test('아티스트가 여럿이면 모두 담고, checkEllipsis 복제본은 버린다', () => {
  // rank02 안에는 같은 목록이 한 번 더 들어 있어, 그대로 벗기면 이름이 두 번 반복된다.
  const chart = parseMelonChart(SAMPLE);
  assert.equal(chart[2].artist, '아이유, 박효신');
});

test('limit만큼만 돌려준다', () => {
  assert.equal(parseMelonChart(SAMPLE, 2).length, 2);
  assert.deepEqual(
    parseMelonChart(SAMPLE, 2).map((t) => t.rank),
    [1, 2]
  );
});

test('마크업이 바뀌면 빈 배열을 돌려준다', () => {
  // 빈 배열은 refreshMelonChart가 기존 캐시를 지키는 신호다. 여기서 부분적으로
  // 망가진 결과가 나오면 캐시가 쓰레기 값으로 덮인다.
  assert.deepEqual(parseMelonChart('<html><body>차트 개편</body></html>'), []);
  assert.deepEqual(parseMelonChart(''), []);
  assert.deepEqual(parseMelonChart('<tr class="lst50"><td>rank01</td></tr>'), []);
});

test('문자열이 아닌 입력에도 터지지 않는다', () => {
  for (const input of [null, undefined, 0, {}]) {
    assert.deepEqual(parseMelonChart(input), []);
  }
});
