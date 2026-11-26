// Fig 6 코루틴의 블로킹 호출: 위에서 내려다본 2D 그림 두 장(6a Dispatchers.IO, 6b 가상 스레드 디스패처).
// 같은 코루틴 8개가 같은 커넥션 2개를 두고 JDBC 를 부른다. 두 그림은 같은 시계로 나란히 움직인다.
// 숫자와 움직임은 모두 ../threads/model.mjs 의 simulate 결과에서 나온다.
// node build.mjs → io-vt.html(시스템 테마), io-vt-light.html(라이트 고정)
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { simulate, DT, LANES } from "../threads/model.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const CONNS = 2;
const N = 8;
const calls = Array.from({ length: N }, (_, i) => ({ id: "K" + (i + 1), arrive: 0.2 + i * 0.1, seg: [["cpu", 0.2], ["db", 1.2], ["cpu", 0.2]] }));
const SECONDS = 6.6;
const io = simulate({ kind: "platform", seconds: SECONDS, conns: CONNS, tasks: calls });
const vt = simulate({ kind: "virtual", seconds: SECONDS, conns: CONNS, tasks: calls });

const pack = (sim) => ({
  finish: sim.finish,
  tasks: sim.tasks.map((task) => ({ id: task.id, hist: task.hist.map((h) => [Math.round(h.t * 100) / 100, h.loc]) })),
  lanes: sim.counts.map((c) => c.lanes),
  holders: sim.counts.map((c) => c.holders),
  segs: sim.segs.map((row) => row.map((s) => [s.kind, +s.from.toFixed(2), +s.to.toFixed(2)])),
});
const DATA = { dt: DT, lanes: LANES, conns: CONNS, n: N, seconds: SECONDS, io: pack(io), vt: pack(vt) };
const blocked = Math.max(...io.counts.map((c) => c.lanes.filter((k) => k !== "idle" && k !== "run").length));
const maxQueued = Math.max(...io.counts.map((c) => c.queued));
const vtHeld = Math.max(...vt.counts.map((c) => c.lanes.filter((k) => k !== "idle" && k !== "run").length));

const CSS = `
:root{--bg:#f6f5f1;--card:#fff;--ink:#1d1d1b;--mute:#6b6a65;--line:#d9d7cf;--box:#fbfaf7;
--run:#2f6fe4;--hold:#e08a1e;--holdbg:#fdf0dc;--conn:#1f9d6b;--connbg:#e1f5ec;--wait:#9a9890;--heap:#f2effa;--heapline:#b9aee0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141413;--card:#1e1e1c;--ink:#ecebe6;--mute:#9b9a94;--line:#3a3935;--box:#252522;
--run:#6c9cff;--hold:#f0a443;--holdbg:#3b2c17;--conn:#3cc28d;--connbg:#173328;--wait:#77766f;--heap:#26233a;--heapline:#6e64a8}}
:root[data-theme="dark"]{--bg:#141413;--card:#1e1e1c;--ink:#ecebe6;--mute:#9b9a94;--line:#3a3935;--box:#252522;
--run:#6c9cff;--hold:#f0a443;--holdbg:#3b2c17;--conn:#3cc28d;--connbg:#173328;--wait:#77766f;--heap:#26233a;--heapline:#6e64a8}
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
.figs{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media (max-width:900px){.figs{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 14px 10px}
.head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.head b{font-size:16px}.head span{color:var(--mute);font-size:13px}
.card p{margin:6px 0 8px;font-size:14px}
svg{display:block;width:100%;height:auto}
svg text{fill:var(--ink);font-family:inherit}
.t-title{font-size:12px;font-weight:600}.t-mute{fill:var(--mute);font-size:10.5px}.t-tok{font-size:10px;font-weight:700}
.box{fill:var(--box);stroke:var(--line)}
.heapbox{fill:var(--heap);stroke:var(--heapline);stroke-dasharray:4 3}
.nobox{fill:none;stroke:var(--line);stroke-dasharray:4 3}
.slot{fill:var(--card);stroke:var(--line)}
.slot.run{stroke:var(--run);stroke-width:1.6}
.slot.hold{fill:var(--holdbg);stroke:var(--hold);stroke-width:1.6}
.slot.conn{fill:var(--connbg);stroke:var(--conn);stroke-width:1.6}
.tok circle{stroke-width:1.6}
.tok.q circle{fill:var(--card);stroke:var(--mute)}
.tok.run circle{fill:var(--run);stroke:var(--run)}.tok.run text{fill:#fff}
.tok.dbw circle{fill:var(--conn);stroke:var(--conn)}.tok.dbw text{fill:#fff}
.tok.cw circle{fill:var(--card);stroke:var(--hold);stroke-dasharray:3 2}
.tok text.tag{fill:var(--conn)!important;font-size:9.5px;font-weight:600}
.tok.done circle{fill:var(--line);stroke:var(--line)}.tok.done text{fill:var(--mute)}
.link{stroke:var(--conn);stroke-width:2;fill:none}
.query{stroke:var(--conn);stroke-width:2;stroke-dasharray:4 4;fill:none;animation:flow .6s linear infinite}
@keyframes flow{to{stroke-dashoffset:-8}}
@media (prefers-reduced-motion:reduce){.query{animation:none}}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:6px 0 4px}
.stat{border:1px solid var(--line);border-radius:8px;padding:4px 8px}
.stat small{display:block;color:var(--mute);font-size:11.5px}
.stat b{font-variant-numeric:tabular-nums;font-size:16px}
.stat.warn b{color:var(--hold)}
@media (max-width:520px){.stats{grid-template-columns:1fr 1fr}}
.g-run{fill:var(--run)}.g-hconn{fill:var(--hold)}.g-cwait{fill:var(--hold);opacity:.45}.g-conn{fill:var(--conn)}
.g-row{fill:none;stroke:var(--line)}
.playhead{stroke:var(--ink);stroke-width:1.2}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:14px 0 0;padding:0;list-style:none;font-size:13.5px;color:var(--mute)}
.legend i{display:inline-block;width:12px;height:12px;border-radius:50%;vertical-align:-1px;margin-right:6px;border:1.6px solid}
.cap{color:var(--mute);font-size:13.5px;margin-top:10px}
`;

// ── 그림 좌표(viewBox 480 × 330) ──
const LAYOUT = `
const Q = { x: 10, y: 28, w: 100, h: 160 }, TP = { x: 124, y: 28, w: 150, h: 160 }, CP = { x: 288, y: 28, w: 96, h: 160 };
const DB = { x: 400, y: 58, w: 70, h: 100 }, HP = { x: 10, y: 206, w: 374, h: 86 }, DN = { x: 400, y: 206, w: 70, h: 86 };
const queueAt = (i) => [Q.x + 27 + (i % 2) * 46, Q.y + 40 + Math.floor(i / 2) * 32];
const laneY = (k) => TP.y + 26 + k * 33;
const threadAt = (k) => [TP.x + 122, laneY(k) + 13];
const connY = (s) => CP.y + 44 + s * 58;
const heapWaitAt = (c) => [HP.x + 24 + c * 27, HP.y + 56];
const heapDbAt = (s) => [CP.x + 30 + s * 36, HP.y + 56];
const doneAt = (i) => [DN.x + 15 + (i % 3) * 20, DN.y + 34 + Math.floor(i / 3) * 20];
`;

function figureSvg(kind) {
  const vt = kind === "vt";
  const lanes = Array.from({ length: LANES }, (_, k) => k);
  const conns = Array.from({ length: CONNS }, (_, s) => s);
  return `<svg viewBox="0 0 480 330" role="img" aria-label="${vt ? "가상 스레드 디스패처" : "Dispatchers.IO"}: 대기열, 스레드 풀, 커넥션 풀, DB, ${vt ? "힙" : "힙 없음"} 영역을 위에서 본 그림">
<rect class="box" x="10" y="28" width="100" height="160" rx="8"/><text class="t-title" x="18" y="46">대기열</text><text class="t-mute" x="18" y="180">실행을 기다리는 코루틴</text>
<rect class="box" x="124" y="28" width="150" height="160" rx="8"/><text class="t-title" x="132" y="46">${vt ? "캐리어 스레드 4" : "IO 스레드 풀 4"}</text>
${lanes.map((k) => `<rect class="slot" data-lane="${k}" x="132" y="${54 + k * 33}" width="134" height="26" rx="6"/><text class="t-mute" x="140" y="${71 + k * 33}">T${k + 1}</text><text class="t-mute" data-lanetext="${k}" x="160" y="${71 + k * 33}">비어 있음</text>`).join("")}
<rect class="box" x="288" y="28" width="96" height="160" rx="8"/><text class="t-title" x="296" y="46">커넥션 풀 2</text><text class="t-mute" x="296" y="180">HikariCP</text>
${conns.map((s) => `<rect class="slot" data-conn="${s}" x="298" y="${60 + s * 58}" width="76" height="36" rx="6"/><text class="t-mute" x="306" y="${82 + s * 58}">C${s + 1}</text><text class="t-tok" data-conntext="${s}" x="348" y="${82 + s * 58}" text-anchor="middle"></text>`).join("")}
<rect class="box" x="400" y="58" width="70" height="100" rx="8"/><text class="t-title" x="435" y="112" text-anchor="middle">DB</text>
${conns.map((s) => `<path class="query" data-query="${s}" d="M374 ${78 + s * 58} H400" style="display:none"/>`).join("")}
${vt
    ? `<rect class="heapbox" x="10" y="206" width="374" height="86" rx="8"/><text class="t-title" x="18" y="224">힙: 내려놓은 가상 스레드 스택</text><text class="t-mute" x="18" y="241">커넥션 대기 ↓</text><text class="t-mute" x="${288 + 6}" y="241">DB 응답 대기 ↓</text><line x1="282" y1="232" x2="282" y2="284" stroke="var(--heapline)" stroke-dasharray="3 3"/>`
    : `<rect class="nobox" x="10" y="206" width="374" height="86" rx="8"/><text class="t-title" x="18" y="224" style="fill:var(--mute)">스택을 힙에 내려놓을 수 없음</text><text class="t-mute" x="18" y="246">플랫폼 스레드의 스택은 힙 밖(네이티브 메모리)에 붙어 있어</text><text class="t-mute" x="18" y="262">기다리는 동안에도 스레드를 놓지 못합니다 → 주황 칸</text><text class="t-mute" x="18" y="278">(객체는 6a·6b 모두 같은 힙에 둡니다)</text>`}
<rect class="box" x="400" y="206" width="70" height="86" rx="8"/><text class="t-title" x="408" y="224">완료</text>
<g data-links></g><g data-toks></g>
<text class="t-mute" x="10" y="316">${vt ? "커넥션을 쥔 코루틴도 힙에서 응답을 기다립니다. 캐리어는 비어 있습니다." : "쿼리 하나가 스레드 하나와 커넥션 하나를 동시에 씁니다(초록 선)."}</text>
</svg>`;
}

const ganttSvg = (kind) => `<svg viewBox="0 0 480 120" role="img" aria-label="시간 막대: 스레드 4개와 커넥션 2개가 언제 무엇을 했는지" data-gantt="${kind}"></svg>`;

const stat = (key, label, warn) => `<div class="stat${warn ? " warn" : ""}"><small>${label}</small><b data-stat="${key}">0</b></div>`;
const card = (kind, title, sub, body) => `<section class="card" data-fig="${kind}">
<div class="head"><b>${title}</b><span>${sub}</span></div>
<p>${body}</p>
${figureSvg(kind)}
<div class="stats">${stat("held", "붙잡힌 스레드", true)}${stat("run", "CPU 실행 중")}${stat("conn", "쓰는 커넥션")}${stat("done", "완료")}</div>
${ganttSvg(kind)}
</section>`;

const LIVE = `
const D = ${JSON.stringify(DATA)};
${LAYOUT}
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; };
const MOVE = 0.15;
const ease = (u) => u * u * (3 - 2 * u);
const LANE_TEXT = { idle: "비어 있음", run: "CPU 실행", hconn: "DB 응답 대기", cwait: "커넥션 대기" };
const AX = { x0: 56, x1: 470 }, X = (t) => AX.x0 + (t / D.seconds) * (AX.x1 - AX.x0);

function locAt(task, t) { let i = 0; while (i + 1 < task.hist.length && task.hist[i + 1][0] <= t + 1e-9) i++; return i; }
function posOf(loc, sim, idx, order) {
  const [w, a] = loc.split(":"); const n = Number(a);
  if (w === "q") return queueAt(n);
  if (w === "run" || w === "hconn" || w === "cwait") return threadAt(n);
  if (w === "cw") return heapWaitAt(n);
  if (w === "conn") return heapDbAt(n);
  if (w === "done") return doneAt(order);
  return null; // pend
}
function cls(loc) { const w = loc.split(":")[0]; return { q: "q", run: "run", hconn: "dbw", conn: "dbw", cwait: "cw", cw: "cw", done: "done" }[w] || "q"; }

const figs = ["io", "vt"].map((key) => {
  const root = document.querySelector('[data-fig="' + key + '"]');
  const sim = D[key];
  const toks = root.querySelector("[data-toks]"), links = root.querySelector("[data-links]");
  // 끝난 순서(완료 칸 자리)
  const doneOrder = {}; sim.tasks.map((task) => [task.id, task.hist[task.hist.length - 1][0]]).sort((a, b) => a[1] - b[1]).forEach(([id], i) => (doneOrder[id] = i));
  const tokEls = sim.tasks.map((task) => { const g = el("g", { class: "tok q" }, toks); el("circle", { r: 11 }, g); const tx = el("text", { class: "t-tok", "text-anchor": "middle", y: 3.5 }, g); tx.textContent = task.id; const tag = el("text", { class: "tag", "text-anchor": "middle", y: 22 }, g); g.tag = tag; return g; });
  const linkEls = Array.from({ length: D.conns }, () => el("path", { class: "link", style: "display:none" }, links));
  // 시간 막대
  const g = root.querySelector("[data-gantt]");
  const rows = [...Array.from({ length: D.lanes }, (_, k) => "T" + (k + 1)), ...Array.from({ length: D.conns }, (_, s) => "C" + (s + 1))];
  rows.forEach((name, r) => { const y = 6 + r * 15 + (r >= D.lanes ? 6 : 0); el("rect", { class: "g-row", x: AX.x0, y, width: AX.x1 - AX.x0, height: 11, rx: 2 }, g); const tx = el("text", { class: "t-mute", x: 8, y: y + 9 }, g); tx.textContent = (r < D.lanes ? "스레드 " : "커넥션 ") + name; });
  sim.segs.forEach((row, k) => row.forEach(([kind, a, b]) => el("rect", { class: "g-" + kind, x: X(a), y: 6 + k * 15, width: Math.max(0.6, X(b) - X(a)), height: 11, rx: 2 }, g)));
  for (let s = 0; s < D.conns; s++) {
    let from = null;
    sim.holders.forEach((h, i) => { const on = !!h[s]; if (on && from === null) from = i; if ((!on || i === sim.holders.length - 1) && from !== null) { el("rect", { class: "g-conn", x: X(from * D.dt), y: 6 + (D.lanes + s) * 15 + 6, width: X(i * D.dt) - X(from * D.dt), height: 11, rx: 2 }, g); from = null; } });
  }
  for (let sec = 0; sec <= Math.floor(D.seconds); sec++) { const tx = el("text", { class: "t-mute", x: X(sec), y: 116, "text-anchor": "middle" }, g); tx.textContent = sec + "s"; }
  if (sim.finish) { const fx = X(sim.finish); el("line", { x1: fx, x2: fx, y1: 4, y2: 103, stroke: "var(--mute)", "stroke-dasharray": "2 2" }, g); }
  const head = el("line", { class: "playhead", x1: AX.x0, x2: AX.x0, y1: 2, y2: 106 }, g);
  const stats = Object.fromEntries([...root.querySelectorAll("[data-stat]")].map((e) => [e.dataset.stat, e]));
  const laneRects = [...root.querySelectorAll("[data-lane]")], laneTexts = [...root.querySelectorAll("[data-lanetext]")];
  const connRects = [...root.querySelectorAll("[data-conn]")], connTexts = [...root.querySelectorAll("[data-conntext]")], queries = [...root.querySelectorAll("[data-query]")];

  function draw(t) {
    const idx = Math.min(sim.lanes.length - 1, Math.max(0, Math.round(t / D.dt)));
    const lanes = sim.lanes[idx], holders = sim.holders[idx];
    const where = {};
    sim.tasks.forEach((task, i) => {
      const h = locAt(task, t), loc = task.hist[h][1];
      let p = posOf(loc, sim, idx, doneOrder[task.id]);
      const target = p;
      const e = tokEls[i];
      if (!p) { e.style.display = "none"; return; }
      e.style.display = "";
      if (h > 0) { const prev = posOf(task.hist[h - 1][1], sim, idx, doneOrder[task.id]); const u = (t - task.hist[h][0]) / MOVE; if (prev && u < 1) { const k = ease(Math.max(0, u)); p = [prev[0] + (p[0] - prev[0]) * k, prev[1] + (p[1] - prev[1]) * k]; } }
      e.setAttribute("transform", "translate(" + p[0].toFixed(1) + " " + p[1].toFixed(1) + ")" + (loc === "done" ? " scale(0.82)" : ""));
      // 옮겨 가는 중에는 앞 절반 동안 이전 상태 색을 유지한다.
      const from = h > 0 && posOf(task.hist[h - 1][1], sim, idx, doneOrder[task.id]);
      const moving = from && t - task.hist[h][0] < MOVE / 2 && (from[0] !== target[0] || from[1] !== target[1]);
      e.setAttribute("class", "tok " + cls(moving ? task.hist[h - 1][1] : loc));
      where[task.id] = p;
      e.tag.textContent = "";
    });
    let held = 0, run = 0;
    lanes.forEach((kind, k) => { const c = kind === "run" ? "run" : kind === "idle" ? "" : "hold"; if (c === "hold") held++; if (c === "run") run++; laneRects[k].setAttribute("class", "slot " + c); laneTexts[k].textContent = LANE_TEXT[kind] || kind; });
    let used = 0;
    holders.forEach((id, s) => {
      connRects[s].setAttribute("class", "slot" + (id ? " conn" : "")); connTexts[s].textContent = id || ""; queries[s].style.display = id ? "" : "none";
      const p = id && where[id];
      if (id) used++;
      if (id && D.vt === sim) { const i = sim.tasks.findIndex((task) => task.id === id); tokEls[i].tag.textContent = "C" + (s + 1) + " 쥠"; }
      if (p && D.io === sim) { linkEls[s].setAttribute("d", "M" + (p[0] + 11).toFixed(1) + " " + p[1].toFixed(1) + " L298 " + (78 + s * 58)); linkEls[s].style.display = ""; }
      else linkEls[s].style.display = "none";
    });
    const done = sim.tasks.filter((task) => task.hist[locAt(task, t)][1] === "done").length;
    stats.held.textContent = held + "/" + D.lanes; stats.run.textContent = run; stats.conn.textContent = used + "/" + D.conns; stats.done.textContent = done + "/" + D.n;
    head.setAttribute("x1", X(t)); head.setAttribute("x2", X(t));
  }
  return { draw };
});

const slider = document.querySelector("[data-time]"), clock = document.querySelector("[data-clock]"), play = document.querySelector("[data-play]");
const speeds = [...document.querySelectorAll("[data-speed]")];
let t = 0, playing = true, speed = 0.5, last = null, hold = 0;
const params = new URLSearchParams(location.search);
if (params.has("t")) { t = Number(params.get("t")); playing = false; }
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (reduce && !params.has("t")) { t = 1.2; playing = false; }
function render() { figs.forEach((f) => f.draw(t)); slider.value = t; clock.textContent = t.toFixed(1) + "초"; play.textContent = playing ? "❚❚ 멈춤" : "▶ 재생"; }
function frame(now) {
  if (last !== null && playing && !document.hidden) {
    const dt = Math.min(0.05, (now - last) / 1000);
    if (t >= D.seconds) { hold += dt; if (hold > 1.5) { t = 0; hold = 0; } }
    else t = Math.min(D.seconds, t + dt * speed);
    render();
  }
  last = now; requestAnimationFrame(frame);
}
slider.max = D.seconds;
slider.addEventListener("input", () => { t = Number(slider.value); playing = false; render(); });
play.addEventListener("click", () => { if (t >= D.seconds) t = 0; playing = !playing; render(); });
speeds.forEach((b) => b.addEventListener("click", () => { speed = Number(b.dataset.speed); speeds.forEach((x) => x.setAttribute("aria-pressed", x === b)); if (!playing) { playing = true; } render(); }));
document.addEventListener("keydown", (e) => { if (e.key === " ") { e.preventDefault(); play.click(); } if (e.key === "ArrowRight" || e.key === "ArrowLeft") { t = Math.max(0, Math.min(D.seconds, t + (e.key === "ArrowRight" ? 0.1 : -0.1))); playing = false; render(); } });
render(); requestAnimationFrame(frame);
`;

const page = (light) => `<!doctype html>
<html lang="ko"${light ? ' data-theme="light"' : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>코루틴의 블로킹 호출</title><style>${CSS}</style></head>
<body><main>
<h1>Fig 6 · 코루틴의 블로킹 호출</h1>
<p class="lead">같은 코루틴 8개(K1~K8)가 CPU 0.2초 → JDBC 쿼리 1.2초 → CPU 0.2초를 실행합니다. 스레드는 4개, 커넥션은 2개입니다. 두 그림은 같은 시계로 움직입니다.</p>
<div class="bar"><button data-play>❚❚ 멈춤</button><button data-speed="0.25" aria-pressed="false">0.25×</button><button data-speed="0.5" aria-pressed="true">0.5×</button><button data-speed="1" aria-pressed="false">1×</button><input type="range" min="0" step="0.02" value="0" data-time aria-label="시간"><span class="clock" data-clock>0.0초</span></div>
<div class="figs">
${card("io", "6a · Dispatchers.IO", "플랫폼 스레드", `기다리는 동안에도 스레드를 붙잡습니다. 커넥션이 2개뿐이라 스레드 ${blocked}개가 주황색(일 없이 붙잡힘)이 되고, 나머지 코루틴은 대기열에서 기다립니다(최대 ${maxQueued}개). ${io.finish.toFixed(1)}초에 끝납니다.`)}
${card("vt", "6b · 가상 스레드 디스패처", "가상 스레드", `기다리는 동안 힙으로 내려가 캐리어가 빕니다(붙잡힌 캐리어 최대 ${vtHeld}개). 그래도 동시에 도는 쿼리는 커넥션 수(${CONNS}개)만큼이라 ${vt.finish.toFixed(1)}초에 끝납니다.`)}
</div>
<ul class="legend">
<li><i style="background:var(--card);border-color:var(--mute)"></i>대기열의 코루틴</li>
<li><i style="background:var(--run);border-color:var(--run)"></i>스레드 위에서 CPU 실행</li>
<li><i style="background:var(--conn);border-color:var(--conn)"></i>커넥션을 쥐고 DB 응답 대기 (초록 선 = 쥔 커넥션)</li>
<li><i style="background:var(--card);border-color:var(--hold);border-style:dashed"></i>커넥션 대기</li>
<li><i style="background:var(--holdbg);border-color:var(--hold);border-radius:3px"></i>스레드 칸이 주황 = 일 없이 붙잡힌 스레드</li>
<li>시간 막대: <b style="color:var(--run)">파랑</b> CPU 실행 · <b style="color:var(--hold)">주황</b> 붙잡고 DB 응답 대기 · <b style="color:var(--hold);opacity:.55">연한 주황</b> 붙잡고 커넥션 대기 · <b style="color:var(--conn)">초록</b> 커넥션 사용 중 · 점선 = 모두 끝난 시각</li>
</ul>
<p class="cap">스레드 풀과 커넥션 풀은 서로 다른 상자입니다. 6a에서는 커넥션을 쥔 코루틴이 스레드 칸에 앉아 있고(초록 선), 6b에서는 힙에 내려가 있습니다(“C1 쥠”). 아래 시간 막대의 커넥션 두 줄은 두 그림이 거의 같고, 스레드 네 줄만 다릅니다. 실제 Dispatchers.IO는 최대 64개, HikariCP 기본은 10개입니다. 6b가 조금 늦게 끝나는 것은 커넥션을 넘겨받은 가상 스레드가 캐리어에 다시 올라타는 시간을 그림에서 0.15초로 크게 그렸기 때문입니다. 실제로는 마이크로초 단위라, 끝나는 시간은 둘이 같다고 보면 됩니다. 스페이스로 재생/멈춤, ← →로 0.1초씩 옮깁니다.</p>
</main>
<script>${LIVE}</script>
</body></html>`;

writeFileSync(join(dir, "io-vt.html"), page(false));
writeFileSync(join(dir, "io-vt-light.html"), page(true));
console.log("io", io.finish, "vt", vt.finish, "blocked", blocked, "maxQueued", maxQueued, "vtHeld", vtHeld);
