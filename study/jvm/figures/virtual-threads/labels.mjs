// 그림 안 라벨: 구역마다 지시선 달린 태그. 넓은 화면은 긴 글, 폰은 짧은 글(CSS 로 하나만 보인다).
// 태그 위치는 화면 좌표(viewBox), 지시선은 부품 위 한 점(월드 좌표)에서 태그 가장자리까지.

// zone: 단계마다 강조할 구역 이름. when: 이 조건일 때만 보이는 태그(라이브에서 판단).
export const TAGS = [
  { zone: "platform", at: [-160, -66, 46], long: "플랫폼 스레드 (OS 스레드 1:1)", short: "플랫폼 스레드", x: 118, y: 40, sx: 70, sy: 44 },
  { zone: "reqq", at: [-180, 16, 3], long: "요청 대기", short: "요청 대기", x: 30, y: 262, sx: 14, sy: 262 },
  { zone: "carrier", at: [-21, -66, 46], long: "캐리어 스레드 (= CPU 코어 수)", short: "캐리어 스레드", x: 330, y: 62, sx: 300, sy: 62 },
  { zone: "vtq", at: [-60, 16, 3], long: "가상 스레드 대기 큐", short: "대기 큐", x: 150, y: 318, sx: 150, sy: 318 },
  { zone: "heap", at: [130, -68, 4], long: "힙: 멈춘 가상 스레드의 스택", short: "힙", x: 500, y: 132, sx: 560, sy: 130 },
  { zone: "pool", at: [60, 46, 4], long: "커넥션 풀 (10개)", short: "커넥션 풀", x: 300, y: 360, sx: 270, sy: 362 },
  { zone: "db", at: [170, 40, 10], long: "DB", short: "DB", x: 600, y: 330, sx: 590, sy: 336 },
  { zone: "hold", when: "hold", at: [-183, -17, 8.6], long: "I/O 기다리며 스레드 점유 중", short: "점유 중", x: 20, y: 300, sx: 14, sy: 304 },
  { zone: "pin", when: "pin", at: [-62, -30, 14], long: "synchronized → 고정(pinning)", short: "pinning", x: 120, y: 112, sx: 120, sy: 112 },
  { zone: "io", when: "io", at: [52, -53.5, 14], long: "I/O 대기 (캐리어는 비움)", short: "I/O 대기", x: 430, y: 100, sx: 440, sy: 98 },
];

// 단계별 한 줄 설명과 강조 구역.
export const NOW = [
  { text: "① 플랫폼 스레드는 I/O 를 기다리는 동안에도 점유됩니다. 4개가 다 차면 다음 요청은 줄을 섭니다.", zones: ["platform", "reqq", "hold"] },
  { text: "② 가상 스레드(VT)는 큐에 섰다가 비어 있는 캐리어 스레드에 올라타 실행됩니다(mount).", zones: ["carrier", "vtq"] },
  { text: "③ I/O 를 기다리는 동안 가상 스레드는 스택째 힙으로 내려가고, 캐리어는 다른 일을 합니다(unmount).", zones: ["heap", "io", "carrier"] },
  { text: "④ I/O 가 끝나면 큐로 돌아가 비어 있는 아무 캐리어에 다시 올라탑니다(remount). 테두리 VT: 캐리어 1 → 2.", zones: ["heap", "vtq", "carrier", "io"] },
  { text: "⑤ synchronized 안에서 기다리면 내려가지 못하고 캐리어를 붙잡습니다(pinning). 큐가 밀립니다.", zones: ["pin", "carrier", "vtq"] },
  { text: "⑥ 가상 스레드가 많아도 동시에 DB 를 쓰는 것은 커넥션 수(10)만큼입니다. 나머지는 힙에서 기다립니다.", zones: ["pool", "db", "heap"] },
];

const widthOf = (text, size) => [...text].reduce((sum, ch) => sum + (/[가-힣]/.test(ch) ? 0.98 : ch === " " ? 0.3 : 0.6) * size, 0);
const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 태그 하나: 지시선(앵커 점 → 상자 가장자리), 앵커 점, 둥근 상자, 글.
function tagOf(k, P, tag, text, x, y, size, cls) {
  const [ax, ay] = k.iso(tag.at, P);
  const w = widthOf(text, size) + size * 1.1;
  const h = size * 1.75;
  const box = { x: Math.max(4, Math.min(x, 656 - w)), y: y - h / 2, w, h };
  // 지시선은 상자 가장자리 가장 가까운 점에서 끝난다.
  const ex = Math.max(box.x, Math.min(ax, box.x + box.w));
  const ey = Math.max(box.y, Math.min(ay, box.y + box.h));
  const lead = Math.hypot(ax - ex, ay - ey) > 2 ? `<path class="vt-lead" d="M${ax.toFixed(1)} ${ay.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}"/>` : "";
  return `<g class="${cls}">${lead}<circle class="vt-anchor" cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="1.3"/><rect x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(h / 2).toFixed(1)}"/><text x="${(box.x + w / 2).toFixed(1)}" y="${(y + size * 0.36).toFixed(1)}" font-size="${size}">${esc(text)}</text></g>`;
}

export function tagsSvg(k, P) {
  return TAGS.map((tag, i) => `<g class="vt-tag" data-zone="${tag.zone}"${tag.when ? ` data-when="${tag.when}" style="display:none"` : ""} data-i="${i}">${tagOf(k, P, tag, tag.long, tag.x, tag.y, 9.2, "vt-long")}${tagOf(k, P, tag, tag.short, tag.sx, tag.sy, 15, "vt-short")}</g>`).join("");
}

export const TAG_CSS = `<style>
.vt-tag rect{fill:var(--anatomy-page);stroke:var(--anatomy-mid);stroke-width:.7;vector-effect:non-scaling-stroke}
.vt-tag text{fill:var(--anatomy-text);font-family:var(--anatomy-sans,system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif);font-weight:600;text-anchor:middle;letter-spacing:-.01em}
.vt-tag .vt-lead{fill:none;stroke:var(--anatomy-mid);stroke-width:.8;vector-effect:non-scaling-stroke}
.vt-tag .vt-anchor{fill:var(--anatomy-mid)}
.vt-tag[data-on] rect{fill:var(--anatomy-strong);stroke:var(--anatomy-strong)}
.vt-tag[data-on] text{fill:var(--anatomy-page)}
.vt-tag[data-on] .vt-lead{stroke:var(--anatomy-strong)}
.vt-tag[data-on] .vt-anchor{fill:var(--anatomy-strong)}
.vt-short{display:none}
.vt-chip{font:700 5.6px/1 var(--anatomy-mono);fill:var(--anatomy-strong);stroke:var(--anatomy-page);stroke-width:1.4px;paint-order:stroke;text-anchor:middle}
.vt-now{margin:0 0 10px;padding:9px 12px;border-radius:10px;background:var(--anatomy-card);border:1px solid var(--anatomy-faint);color:var(--anatomy-strong);font-size:14px;line-height:1.5;min-height:3em}
@media (max-width:560px){.vt-long{display:none}.vt-short{display:inline}.vt-chip{display:none}.vt-now{font-size:13px}}
</style>`;
