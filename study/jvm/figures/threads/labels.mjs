// 그림 안 라벨: 구역마다 지시선 달린 태그. 넓은 화면은 긴 글, 폰은 짧은 글(CSS 로 하나만 보인다).
// 태그 위치는 화면 좌표(viewBox), 지시선은 부품 위 한 점(월드 좌표)에서 태그 가장자리까지.

const widthOf = (text, size) => [...text].reduce((sum, ch) => sum + (/[가-힣]/.test(ch) ? 0.98 : ch === " " ? 0.3 : 0.6) * size, 0);
const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 태그 하나: 지시선(앵커 점 → 상자 가장자리), 앵커 점, 둥근 상자, 글. (x, y) 는 앵커에서 띄운 거리.
function tagOf(k, P, tag, text, dx, dy, size, cls, width) {
  const [ax, ay] = k.iso(tag.at, P);
  const x = ax + dx;
  const y = ay + dy;
  const w = widthOf(text, size) + size * 1.1;
  const h = size * 1.75;
  const box = { x: Math.max(4, Math.min(x - w / 2, width - 4 - w)), y: y - h / 2, w, h };
  // 지시선은 상자 가장자리 가장 가까운 점에서 끝난다.
  const ex = Math.max(box.x, Math.min(ax, box.x + box.w));
  const ey = Math.max(box.y, Math.min(ay, box.y + box.h));
  const lead = Math.hypot(ax - ex, ay - ey) > 2 ? `<path class="vt-lead" d="M${ax.toFixed(1)} ${ay.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}"/>` : "";
  return `<g class="${cls}">${lead}<circle class="vt-anchor" cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="1.3"/><rect x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(h / 2).toFixed(1)}"/><text x="${(box.x + w / 2).toFixed(1)}" y="${(y + size * 0.36).toFixed(1)}" font-size="${size}">${esc(text)}</text></g>`;
}

// tags: [{ zone, when?, at, dx, dy, long, short, sdx?, sdy? }]. 폰 글은 크게 쓰므로 위치를 따로 줄 수 있다.
export function tagsSvg(k, P, tags, width) {
  return tags.map((tag, i) => `<g class="vt-tag" data-zone="${tag.zone}"${tag.when ? ` data-when="${tag.when}" style="display:none"` : ""} data-i="${i}">${tagOf(k, P, tag, tag.long, tag.dx, tag.dy, 9.2, "vt-long", width)}${tagOf(k, P, tag, tag.short, tag.sdx ?? tag.dx, tag.sdy ?? tag.dy, 15, "vt-short", width)}</g>`).join("");
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
