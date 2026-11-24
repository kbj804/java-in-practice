// 카드 아래 범례: 부품마다 작은 그림 + "부품 = 개념 (한 줄 설명)". 세 그림이 같이 쓴다.
// 그림은 테마 변수만 써서 밝은·어두운 테마 둘 다에서 읽힌다.

const G = {
  // 상자 위에 종이가 나오는 출력기
  printer: '<path class="b" d="M3 7h16v6H3z"/><path d="M6 7V3h10v4"/><path class="l" d="M8 5h6"/><path d="M5 13v2h12v-2"/>',
  // 3단 선반
  shelf: '<path class="b" d="M5 2h12v13H5z"/><path d="M5 6.5h12M5 11h12"/><path class="l" d="M8 3.5v2.5M10 3.5v2.5M8 8v2.5M12 12.5v2"/>',
  // 기둥과 위아래로 움직이는 받침
  lift: '<path d="M8 1.5v13"/><path class="b" d="M8 6h9v3H8z"/><path class="l" d="M12.5 3.5v-2M12.5 13.5v-2"/><path d="M11 3 12.5 1.5 14 3M11 12 12.5 13.5 14 12"/>',
  // 서랍장
  drawers: '<path class="b" d="M4 2h14v13H4z"/><path d="M4 6.5h14M4 11h14"/><path class="l" d="M10 4.2h2M10 8.7h2M10 13.2h2"/>',
  // 양념통 셋 + 트레이
  jars: '<path class="b" d="M3 12h16v3H3z"/><path class="b" d="M5 6h3v6H5zM9.5 4h3v8h-3zM14 7h3v5h-3z"/>',
  // 꼬챙이에 꽂힌 주문서 더미
  spike: '<path class="b" d="M5 13h12v2H5z"/><path d="M11 13V1.5"/><path class="b" d="M6.5 10h9v2h-9zM6.5 7h9v2h-9z"/>',
  // 주문서 한 장
  ticket: '<path class="b" d="M5 3h12v11H5z"/><path class="l" d="M7.5 6h7M7.5 8.5h7M7.5 11h4"/>',
  // 레시피 카드 옆 작은 포인터
  pointer: '<path class="b" d="M7 2h12v12H7z"/><path class="l" d="M9.5 5h7M9.5 8h7M9.5 11h7"/><path class="k" d="M2 7l3.5 1L2 9z"/>',
  // 조리대(긴 상판)
  counter: '<path class="b" d="M2 5h18v4H2z"/><path d="M4 9v6M18 9v6"/>',
  // 접시(받침 + 그릇)
  dish: '<ellipse class="b" cx="11" cy="11" rx="7" ry="2.6"/><path class="b" d="M6.5 7.5h9v3.5h-9z"/><ellipse class="b" cx="11" cy="7.5" rx="4.5" ry="1.5"/>',
  // 끈(참조): 양 끝에 점
  wire: '<path d="M3 12C7 3 15 3 19 10"/><circle class="k" cx="3" cy="12" r="1.4"/><circle class="k" cx="19" cy="10" r="1.4"/>',
  // 계기 다이얼
  dial: '<circle class="b" cx="11" cy="8.5" r="6"/><path class="l" d="M11 3.5v1.3M6 8.5h1.3M16 8.5h-1.3"/><path d="M11 8.5 14 5.5"/><circle class="k" cx="11" cy="8.5" r="0.9"/>',
  // 냉장고 선반 + 밀키트 상자
  fridge: '<path class="b" d="M4 1.5h14v14H4z"/><path d="M4 8.5h14"/><path class="k" d="M7 5h5v3H7z"/><path class="l" d="M15.5 3.5v3"/>',
  // 갠트리(두 기둥과 가로대)
  gantry: '<path d="M4 15V4M18 15V4"/><path class="b" d="M3 3h16v2.5H3z"/><path class="b" d="M9 5.5h4v3H9z"/>',
  // 경광등
  beacon: '<path class="b" d="M7 12h8v3H7z"/><path class="k" d="M8.5 12V8a2.5 2.5 0 0 1 5 0v4z"/><path class="l" d="M5 5 3.5 3.5M17 5l1.5-1.5M11 3V1"/>',
  // 스톱워치
  watch: '<circle class="b" cx="11" cy="9.5" r="5.5"/><path d="M11 4V2.2M9.5 2h3"/><path d="M11 9.5V6.5"/>',
  // 고리가 쌓인 접시
  rings: '<ellipse class="b" cx="11" cy="13" rx="7" ry="2.2"/><path class="b" d="M8 4h6v9H8z"/><path class="l" d="M8 10.5h6M8 8h6"/><path class="k2" d="M8 5.5h6"/>',
  // 고리가 흐린 접시(Old)
  ringsfaded: '<ellipse class="b" cx="11" cy="12" rx="7" ry="2.4"/><path class="b" d="M6.5 8.5h9V12h-9z"/><g opacity=".55"><path class="b" d="M8 6.8h6v1.7H8z"/></g>',
  // 눈금 기둥과 표시 팔
  gauge: '<path class="b" d="M9 1.5h3v14H9z"/><path class="l" d="M12 4h2M12 6.5h1.2M12 9h2M12 11.5h1.2M12 14h2"/><path class="k" d="M3 6h15v1.8H3z"/>',
  // 배식대(칸이 많은 상판)
  eden: '<path class="b" d="M2 5h18v7H2z"/><circle class="l" cx="6" cy="8.5" r="1.5"/><circle class="l" cx="11" cy="8.5" r="1.5"/><circle class="l" cx="16" cy="8.5" r="1.5"/>',
  // 작은 선반 두 개, 하나는 이름표 불이 들어옴
  survivors: '<path class="b" d="M2 6h8v5H2zM12 6h8v5h-8z"/><path d="M3 11v4M9 11v4M13 11v4M19 11v4"/><path class="k" d="M14.5 7.3h3v1.6h-3z"/><path class="l" d="M4.5 7.3h3v1.6h-3z"/>',
  // 큰 보관 선반
  old: '<path class="b" d="M1.5 4h19v9h-19z"/><circle class="l" cx="5" cy="7" r="1.2"/><circle class="l" cx="9" cy="7" r="1.2"/><circle class="l" cx="13" cy="7" r="1.2"/><circle class="l" cx="17" cy="7" r="1.2"/><circle class="l" cx="5" cy="10.5" r="1.2"/><circle class="l" cx="9" cy="10.5" r="1.2"/>',
  // 메모판: 작은 카드 줄, 하나가 섬
  cards: '<path class="b" d="M1.5 10h19v4h-19z"/><path class="l" d="M4 10v-2h2v2M13 10v-2h2v2M17 10v-2h2v2"/><path class="k" d="M8.5 10V5h2.5v5z"/>',
  // 레일 위 탭
  bump: '<path d="M2 11h18"/><path class="l" d="M4 11v2M7 11v2M10 11v2M13 11v2M16 11v2M19 11v2"/><path class="k" d="M10 6h4v5h-4z"/>',
  // 타일 칸
  tiles: '<path class="b" d="M2 3h8v5H2zM12 3h8v5h-8zM2 10h8v5H2zM12 10h8v5h-8z"/>',
  // 칸 스티커
  tag: '<path class="b" d="M3 3h16v11H3z"/><path class="k" d="M5 4.5h5v3H5z"/>',
  // 여러 칸에 걸친 큰 냄비
  pot: '<path d="M1.5 14h9M11.5 14h9"/><path class="b" d="M4 6h14v8H4z"/><ellipse class="b" cx="11" cy="6" rx="7" ry="2"/><path d="M2.5 8H4M18 8h1.5"/>',
  // 칸 구석 명부
  log: '<path class="b" d="M3 3h16v11H3z"/><path class="b" d="M13 4.5h4.5v5H13z"/><path class="l" d="M14 6.2h2.5M14 7.9h2.5"/>',
  // 카메라
  camera: '<path class="b" d="M3 6h16v8H3z"/><path d="M7 6l1.5-2.5h5L15 6"/><circle class="b" cx="11" cy="10" r="2.6"/><circle class="k" cx="17" cy="4" r="1"/>',
  // 점이 찍힌 접시(마킹됨)
  marked: '<ellipse class="b" cx="11" cy="11" rx="7" ry="2.6"/><path class="b" d="M6.5 7.5h9v3.5h-9z"/><ellipse class="b" cx="11" cy="7.5" rx="4.5" ry="1.5"/><circle class="k" cx="11" cy="7.5" r="1.1"/>',
  // 끈 끝 구슬: 속 빈 것과 꽉 찬 것
  bead: '<path d="M2 8h18"/><circle class="b" cx="7" cy="8" r="2.4"/><circle class="k" cx="16" cy="8" r="2.4"/>',
  // 손목 검사기(팔찌 + 램프)
  wrist: '<path d="M2 11h6M14 11h6"/><path class="b" d="M8 7.5h6v7H8z"/><circle class="k" cx="11" cy="5" r="1.4"/><path class="l" d="M11 7.5V6.4"/>',
  // 펼친 장부
  ledger: '<path class="b" d="M2 4l9 1.5V15L2 13.5zM20 4l-9 1.5V15l9-1.5z"/><path class="l" d="M4 7.3l5 .8M4 9.7l5 .8M13 8.1l5-.8M13 10.5l5-.8"/>',
  // 요리사 자리의 정지등
  lamp: '<path class="b" d="M6 12h10v3H6z"/><path d="M11 12V8"/><path class="k" d="M8 8a3 3 0 0 1 6 0z"/>',
  // 두 줄 기록계
  recorder: '<path class="b" d="M1.5 3h19v11h-19z"/><path d="M1.5 8.5h19"/><path class="l" d="M3 6.5h4l1-2.5 1 2.5h10M3 12h7l.5-1 .5 1h8"/>',
};

export const LEGEND_CSS = `<style>
.jk-legend{margin:16px 0 0;padding:12px 14px;border:1px solid var(--anatomy-faint);border-radius:12px;background:var(--anatomy-card)}
.jk-legend h2{margin:0 0 8px;font:600 11px/1 var(--anatomy-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--anatomy-muted)}
.jk-legend ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:6px 18px}
.jk-legend li{display:flex;gap:9px;align-items:flex-start;font-size:13px;line-height:1.5;color:var(--anatomy-text)}
.jk-legend b{color:var(--anatomy-strong);font-weight:600}
.jk-legend span.jk-why{color:var(--anatomy-muted)}
.jk-glyph{flex:none;width:22px;height:17px;margin-top:1px;overflow:visible}
.jk-glyph *{fill:none;stroke:var(--anatomy-mid);stroke-width:1;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.jk-glyph .b{fill:var(--anatomy-page);stroke:var(--anatomy-hi)}
.jk-glyph .l{stroke:var(--anatomy-lo)}
.jk-glyph .k{fill:var(--anatomy-lit);stroke:var(--anatomy-lit)}
.jk-glyph .k2{stroke:var(--anatomy-hi);stroke-width:1.6}
@media (max-width:560px){.jk-legend{padding:10px 12px}.jk-legend ul{grid-template-columns:1fr}}
</style>`;

const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// items: [glyph, 부품, 개념, 설명?]
export function legendHtml(items) {
  const rows = items.map(([glyph, part, concept, why]) => {
    if (!G[glyph]) throw new Error("legend: unknown glyph " + glyph);
    return `<li><svg class="jk-glyph" viewBox="0 0 22 17" aria-hidden="true">${G[glyph]}</svg><span><b>${esc(part)}</b> = ${esc(concept)}${why ? ` <span class="jk-why">${esc(why)}</span>` : ""}</span></li>`;
  });
  return `<section class="jk-legend" aria-label="범례"><h2>범례</h2><ul>${rows.join("")}</ul></section>`;
}
