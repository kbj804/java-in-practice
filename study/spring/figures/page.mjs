// 단계별 그림이 같이 쓰는 페이지 틀과 색. 위에서 내려다본 2D 그림, 밝은·어두운 테마.
// 각 단계 폴더(stepNN-*)의 build.mjs 가 이 모듈로 index.html(시스템 테마)과 index-light.html(밝은 테마)을 만든다.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const CSS = `
:root{--bg:#f6f5f1;--card:#fff;--ink:#1d1d1b;--mute:#6b6a65;--line:#d9d7cf;--box:#fbfaf7;
--run:#2f6fe4;--runbg:#e3ecfd;--hold:#e08a1e;--holdbg:#fdf0dc;--conn:#1f9d6b;--connbg:#e1f5ec;--fail:#d4483b;--failbg:#fbe4e1;--frame:#b9aee0;--framebg:#f6f4fc}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141413;--card:#1e1e1c;--ink:#ecebe6;--mute:#9b9a94;--line:#3a3935;--box:#252522;
--run:#6c9cff;--runbg:#1d2a45;--hold:#f0a443;--holdbg:#3b2c17;--conn:#3cc28d;--connbg:#173328;--fail:#f07467;--failbg:#3d1f1b;--frame:#6e64a8;--framebg:#23212f}}
:root[data-theme="dark"]{--bg:#141413;--card:#1e1e1c;--ink:#ecebe6;--mute:#9b9a94;--line:#3a3935;--box:#252522;
--run:#6c9cff;--runbg:#1d2a45;--hold:#f0a443;--holdbg:#3b2c17;--conn:#3cc28d;--connbg:#173328;--fail:#f07467;--failbg:#3d1f1b;--frame:#6e64a8;--framebg:#23212f}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 40px}
h1{font-size:20px;margin:0 0 4px}
.lead{color:var(--mute);margin:0 0 16px}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;position:sticky;top:0;z-index:2;background:var(--bg);padding:8px 0}
.bar button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:5px 12px;cursor:pointer}
.bar button[aria-pressed="true"]{border-color:var(--ink)}
.bar input{flex:1;min-width:140px;accent-color:var(--run)}
.clock{font-variant-numeric:tabular-nums;min-width:64px;text-align:right}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 14px 10px}
.head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.head b{font-size:16px}.head span{color:var(--mute);font-size:13px}
.card p{margin:6px 0 8px;font-size:14px}
svg{display:block;width:100%;height:auto}
/* 좁은 화면에서는 넓은 그림이 카드 안에서만 옆으로 스크롤된다 */
.scroll{overflow-x:auto}.scroll svg{min-width:680px}
svg text{fill:var(--ink);font-family:inherit}
.t-title{font-size:12px;font-weight:600}.t-mute{fill:var(--mute);font-size:10.5px}.t-tok{font-size:10px;font-weight:700}
.box{fill:var(--box);stroke:var(--line)}
.frame{fill:var(--framebg);stroke:var(--frame);stroke-dasharray:4 3}
.slot{fill:var(--card);stroke:var(--line)}
.on{stroke-width:1.8}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:14px 0 0;padding:0;list-style:none;font-size:13.5px;color:var(--mute)}
.legend i{display:inline-block;width:12px;height:12px;border-radius:50%;vertical-align:-1px;margin-right:6px;border:1.6px solid}
.cap{color:var(--mute);font-size:13.5px;margin-top:10px}
.query{stroke:var(--conn);stroke-width:2;stroke-dasharray:4 4;fill:none;animation:flow .6s linear infinite}
@keyframes flow{to{stroke-dashoffset:-8}}
@media (prefers-reduced-motion:reduce){.query{animation:none}}
`;

// 재생 막대: 재생/멈춤, 속도, 시간 슬라이더, 시계. 그림 스크립트가 data-* 로 찾아 쓴다.
export const controls = (speeds, initial) => `<div class="bar"><button data-play>❚❚ 멈춤</button>${speeds
  .map((s) => `<button data-speed="${s}" aria-pressed="${s === initial}">${s}×</button>`)
  .join("")}<input type="range" min="0" step="0.005" value="0" data-time aria-label="시간"><span class="clock" data-clock>0.00초</span></div>`;

// 공통 재생 루프. draw(t) 를 부르고, 끝에 닿으면 1.5초 쉬었다가 처음부터 다시 돈다.
// ?t=초 로 열면 그 시각에 멈춘 화면이 나온다(캡처용). 줄인 움직임 설정이면 stillAt 에 멈춘다.
export const playerScript = ({ seconds, speed, stillAt, step }) => `
(() => {
const SECONDS = ${seconds};
const slider = document.querySelector("[data-time]"), clock = document.querySelector("[data-clock]"), play = document.querySelector("[data-play]");
const speeds = [...document.querySelectorAll("[data-speed]")];
let t = 0, playing = true, speed = ${speed}, last = null, hold = 0;
const params = new URLSearchParams(location.search);
if (params.has("t")) { t = Number(params.get("t")); playing = false; }
if (matchMedia("(prefers-reduced-motion: reduce)").matches && !params.has("t")) { t = ${stillAt}; playing = false; }
function render() { window.draw(t); slider.value = t; clock.textContent = t.toFixed(2) + "초"; play.textContent = playing ? "❚❚ 멈춤" : "▶ 재생"; }
function frame(now) {
  if (last !== null && playing && !document.hidden) {
    const dt = Math.min(0.05, (now - last) / 1000);
    if (t >= SECONDS) { hold += dt; if (hold > 1.5) { t = 0; hold = 0; } }
    else t = Math.min(SECONDS, t + dt * speed);
    render();
  }
  last = now; requestAnimationFrame(frame);
}
slider.max = SECONDS;
slider.addEventListener("input", () => { t = Number(slider.value); playing = false; render(); });
play.addEventListener("click", () => { if (t >= SECONDS) t = 0; playing = !playing; render(); });
speeds.forEach((b) => b.addEventListener("click", () => { speed = Number(b.dataset.speed); speeds.forEach((x) => x.setAttribute("aria-pressed", x === b)); playing = true; render(); }));
document.addEventListener("keydown", (e) => {
  if (e.key === " ") { e.preventDefault(); play.click(); }
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") { t = Math.max(0, Math.min(SECONDS, t + (e.key === "ArrowRight" ? ${step} : -${step}))); playing = false; render(); }
});
render(); requestAnimationFrame(frame);
})();
`;

export function writePages(dir, { title, css = "", body }) {
  const page = (light) => `<!doctype html>
<html lang="ko"${light ? ' data-theme="light"' : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${CSS}${css}</style></head>
<body><main>
${body}
</main></body></html>`;
  writeFileSync(join(dir, "index.html"), page(false));
  writeFileSync(join(dir, "index-light.html"), page(true));
}
