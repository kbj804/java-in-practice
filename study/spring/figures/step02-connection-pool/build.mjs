// 2단계 그림: 트랜잭션 안의 외부 호출과 커넥션 풀 고갈(위에서 본 2D 그림 두 장, 같은 시계).
// 숫자와 움직임은 모두 model.mjs 의 simulate 결과에서 나온다. node build.mjs → index.html, index-light.html
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { controls, playerScript, writePages } from "../page.mjs";
import { SETUP, simulate } from "./model.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const inside = simulate("inside"), outside = simulate("outside");
const SECONDS = 1.25;
const r3 = (x) => Math.round(x * 1000) / 1000;
const pack = (sim) => ({
  reqs: sim.reqs.map((r) => ({ id: r.id, hist: r.hist.map(([t, s]) => [r3(t), s]) })),
  conns: sim.conns.map((row) => row.map(([a, b, id, k]) => [r3(a), r3(b), id, k])),
  waiting: sim.waiting, dt: sim.dt, ok: sim.ok, fail: sim.fail, end: r3(sim.end),
});
const DATA = { setup: SETUP, seconds: SECONDS, inside: pack(inside), outside: pack(outside) };

// ── 그림 좌표(viewBox 480 × 240) ──
const slotXY = (i) => [18 + (i % 4) * 48, 56 + Math.floor(i / 4) * 28];
const connY = (s) => 126 + s * 24;

function figureSvg(kind) {
  const threads = Array.from({ length: SETUP.requests }, (_, i) => {
    const [x, y] = slotXY(i);
    return `<rect class="slot" data-th="${i}" x="${x}" y="${y}" width="44" height="24" rx="6"/><text class="t-tok" data-tht="${i}" x="${x + 22}" y="${y + 15.5}" text-anchor="middle">R${i + 1}</text>`;
  }).join("");
  const conns = [0, 1, 2].map((s) =>
    `<rect class="slot" data-conn="${s}" x="236" y="${connY(s)}" width="102" height="20" rx="6"/>` +
    `<text class="t-mute" x="243" y="${connY(s) + 14}">C${s + 1}</text><text class="t-tok" data-conntext="${s}" x="300" y="${connY(s) + 14}" text-anchor="middle"></text>` +
    `<path class="query" data-query="${s}" d="M338 ${connY(s) + 10} H358" style="display:none"/>`).join("");
  return `<svg viewBox="0 0 480 240" role="img" aria-label="${kind === "inside" ? "트랜잭션 안에서 외부 호출" : "외부 호출 뒤 짧은 트랜잭션"}: 요청 스레드 20개, 외부 LLM, 커넥션 풀 3개, DB 를 위에서 본 그림">
<rect class="box" x="10" y="28" width="206" height="186" rx="8"/><text class="t-title" x="18" y="46">Tomcat 스레드 · 요청 20개</text>${threads}
<rect class="box" x="228" y="28" width="118" height="64" rx="8"/><text class="t-title" x="236" y="46">외부 LLM</text><text class="t-mute" x="236" y="62">응답 ${SETUP.external}초</text>
<text class="t-tok" data-ext x="236" y="82"></text>
<rect class="box" x="358" y="28" width="112" height="64" rx="8"/><text class="t-title" x="366" y="46">결과</text>
<text class="t-tok" data-ok x="366" y="66" style="fill:var(--conn)"></text><text class="t-tok" data-fail x="366" y="82" style="fill:var(--fail)"></text>
<rect class="box" x="228" y="104" width="118" height="110" rx="8"/><text class="t-title" x="236" y="120">커넥션 풀 ${SETUP.pool}</text>${conns}<text class="t-mute" x="236" y="208">대기 한도 ${SETUP.timeout}초</text>
<rect class="box" x="358" y="104" width="112" height="110" rx="8"/><text class="t-title" x="366" y="122">PostgreSQL</text><text class="t-mute" x="366" y="138">쿼리 ${SETUP.query * 1000}ms</text>
<text class="t-mute" x="10" y="232">${kind === "inside" ? "주황 칸 = 커넥션을 쥔 채 외부 응답을 기다리는 요청. 커넥션 칸에 쥔 요청 번호가 나옵니다" : "외부 호출은 커넥션 없이 기다리고(파랑), 저장할 때만 커넥션을 씁니다"}</text>
</svg>`;
}

const ganttSvg = (kind) => `<svg viewBox="0 0 480 112" role="img" aria-label="시간 막대: 커넥션 3개를 누가 언제 썼는지와 커넥션 대기 수" data-gantt="${kind}"></svg>`;
const stat = (key, label, cls = "") => `<div class="stat ${cls}"><small>${label}</small><b data-stat="${key}">0</b></div>`;
const card = (kind, title, sub, body) => `<section class="card" data-fig="${kind}">
<div class="head"><b>${title}</b><span>${sub}</span></div>
<p>${body}</p>
${figureSvg(kind)}
<div class="stats">${stat("wait", "커넥션 대기", "warn")}${stat("conn", "쓰는 커넥션")}${stat("ok", "성공", "good")}${stat("fail", "실패", "bad")}</div>
${ganttSvg(kind)}
</section>`;

const css = `
.figs{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media (max-width:900px){.figs{grid-template-columns:1fr}}
.slot.s-tag{fill:var(--runbg);stroke:var(--run);stroke-width:1.6}
.slot.s-cwait{fill:var(--card);stroke:var(--hold);stroke-width:1.6;stroke-dasharray:3 2}
.slot.s-holdtag{fill:var(--holdbg);stroke:var(--hold);stroke-width:1.6}
.slot.s-query{fill:var(--connbg);stroke:var(--conn);stroke-width:1.6}
.slot.s-ok{fill:var(--line);stroke:var(--line)}
.slot.s-fail{fill:var(--failbg);stroke:var(--fail);stroke-width:1.6}
.slot.c-holdtag{fill:var(--holdbg);stroke:var(--hold);stroke-width:1.6}
.slot.c-query{fill:var(--connbg);stroke:var(--conn);stroke-width:1.6}
.t-tok.s-ok{fill:var(--mute)}.t-tok.s-fail{fill:var(--fail)}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:6px 0 4px}
.stat{border:1px solid var(--line);border-radius:8px;padding:4px 8px}
.stat small{display:block;color:var(--mute);font-size:11.5px}
.stat b{font-variant-numeric:tabular-nums;font-size:16px}
.stat.warn b{color:var(--hold)}.stat.good b{color:var(--conn)}.stat.bad b{color:var(--fail)}
@media (max-width:520px){.stats{grid-template-columns:1fr 1fr}}
.g-row{fill:none;stroke:var(--line)}.g-holdtag{fill:var(--hold)}.g-query{fill:var(--conn)}.g-wait{fill:var(--hold);opacity:.55}
.g-fail{stroke:var(--fail);stroke-dasharray:3 2}
.playhead{stroke:var(--ink);stroke-width:1.2}
`;

const LIVE = `
const D = ${JSON.stringify(DATA)};
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; };
const connY = ${connY.toString()};
const stateAt = (req, t) => { if (req.hist[0][0] > t + 1e-9) return "pend"; let s = req.hist[0][1]; for (const [at, st] of req.hist) if (at <= t + 1e-9) s = st; return s; };
const AX = { x0: 62, x1: 470 }, X = (t) => AX.x0 + (t / D.seconds) * (AX.x1 - AX.x0);

const figs = ["inside", "outside"].map((key) => {
  const root = document.querySelector('[data-fig="' + key + '"]'), sim = D[key];
  const q = (s) => root.querySelector(s), qa = (s) => [...root.querySelectorAll(s)];
  const th = qa("[data-th]"), tht = qa("[data-tht]"), connRects = qa("[data-conn]"), connTexts = qa("[data-conntext]"), queries = qa("[data-query]");
  const ext = q("[data-ext]"), okT = q("[data-ok]"), failT = q("[data-fail]");
  const stats = Object.fromEntries(qa("[data-stat]").map((e) => [e.dataset.stat, e]));

  // 시간 막대: 커넥션 3줄(주황 = 쥔 채 외부 대기, 초록 = 쿼리) + 커넥션 대기 수
  const g = q("[data-gantt]");
  [0, 1, 2].forEach((s) => {
    const y = 6 + s * 15;
    el("rect", { class: "g-row", x: AX.x0, y, width: AX.x1 - AX.x0, height: 11, rx: 2 }, g);
    el("text", { class: "t-mute", x: 8, y: y + 9 }, g).textContent = "커넥션 C" + (s + 1);
    sim.conns[s].forEach(([a, b, id, k]) => el("rect", { class: "g-" + k, x: X(a), y, width: Math.max(1.2, X(b) - X(a)), height: 11, rx: 2 }, g));
  });
  const WY = 52, WH = 34, max = D.setup.requests;
  el("rect", { class: "g-row", x: AX.x0, y: WY, width: AX.x1 - AX.x0, height: WH, rx: 2 }, g);
  el("text", { class: "t-mute", x: 8, y: WY + 14 }, g).textContent = "커넥션";
  el("text", { class: "t-mute", x: 8, y: WY + 27 }, g).textContent = "대기 수";
  sim.waiting.forEach((n, k) => { if (n) { const h = (n / max) * (WH - 2); el("rect", { class: "g-wait", x: X(k * sim.dt), y: WY + WH - 1 - h, width: Math.max(0.8, X(sim.dt) - X(0)), height: h }, g); } });
  const failAt = sim.reqs.map((r) => r.hist[r.hist.length - 1]).filter(([, s]) => s === "fail").map(([t]) => t);
  if (failAt.length) {
    const fx = X(failAt[0]);
    el("line", { class: "g-fail", x1: fx, x2: fx, y1: 2, y2: WY + WH + 2 }, g);
    const ft = el("text", { class: "t-tok", x: fx - 4, y: WY + 12, "text-anchor": "end", style: "fill:var(--fail)" }, g); ft.textContent = failAt.length + "개 실패";
  }
  for (let k = 0; k <= 6; k++) { const sec = k * 0.2; el("text", { class: "t-mute", x: X(sec), y: 104, "text-anchor": "middle" }, g).textContent = sec.toFixed(1) + "s"; }
  const head = el("line", { class: "playhead", x1: AX.x0, x2: AX.x0, y1: 2, y2: WY + WH + 2 }, g);

  function draw(t) {
    const states = sim.reqs.map((r) => stateAt(r, t));
    states.forEach((s, i) => { th[i].setAttribute("class", "slot s-" + s); tht[i].setAttribute("class", "t-tok s-" + s); tht[i].textContent = s === "ok" ? "✓" : s === "fail" ? "×" : sim.reqs[i].id; });
    let used = 0;
    [0, 1, 2].forEach((s) => {
      const seg = sim.conns[s].find(([a, b]) => t >= a - 1e-9 && t < b - 1e-9);
      connRects[s].setAttribute("class", "slot" + (seg ? " c-" + seg[3] : ""));
      connTexts[s].textContent = seg ? seg[2] : "";
      queries[s].style.display = seg && seg[3] === "query" ? "" : "none";
      if (seg) used++;
    });
    const calling = states.filter((s) => s === "tag" || s === "holdtag").length;
    ext.textContent = calling ? "호출 중 " + calling + "개" : "";
    const ok = states.filter((s) => s === "ok").length, fail = states.filter((s) => s === "fail").length, wait = states.filter((s) => s === "cwait").length;
    okT.textContent = "성공 " + ok; failT.textContent = "실패 " + fail;
    stats.wait.textContent = wait; stats.conn.textContent = used + "/" + D.setup.pool; stats.ok.textContent = ok + "/" + D.setup.requests; stats.fail.textContent = fail;
    head.setAttribute("x1", X(t)); head.setAttribute("x2", X(t));
  }
  return { draw };
});
window.draw = (t) => figs.forEach((f) => f.draw(t));
`;

const ms = (s) => Math.round(s * 1000);
writePages(dir, {
  title: "커넥션 풀 고갈",
  css,
  body: `<h1>Spring Fig 2 · 트랜잭션 안의 외부 호출과 커넥션 풀 고갈</h1>
<p class="lead">게시글 요청 ${SETUP.requests}개가 동시에 들어옵니다. 저장할 때 외부 LLM으로 장소 태그를 뽑고(${SETUP.external}초), 커넥션은 ${SETUP.pool}개, 커넥션 대기 한도는 ${SETUP.timeout}초입니다. 두 그림은 같은 시계로 움직입니다.</p>
${controls([0.1, 0.25, 1], 0.25)}
<div class="figs">
${card("inside", "2a · 트랜잭션 안에서 외부 호출", "InsideTxPostWriter", `커넥션을 쥔 채 0.5초를 기다리니 커넥션 하나가 0.5초에 요청 하나만 처리합니다. 0.5초에 ${SETUP.pool}개, 1.0초에 다음 ${SETUP.pool}개만 끝나고, 나머지 ${inside.fail}개는 1초 대기 한도에 걸려 실패합니다. 그동안 DB는 거의 놀고 있습니다.`)}
${card("outside", "2b · 외부 호출 뒤 짧은 트랜잭션", "OutsideTxPostWriter", `외부 호출은 커넥션 없이 ${SETUP.requests}개가 동시에 기다립니다. 0.5초에 ${SETUP.requests}개가 한꺼번에 저장하러 몰려 줄이 생기지만, 저장은 ${SETUP.query * 1000}ms라 ${ms(outside.end - SETUP.external)}ms 만에 줄이 빠지고 모두 성공합니다.`)}
</div>
<ul class="legend">
<li><i style="background:var(--runbg);border-color:var(--run);border-radius:3px"></i>커넥션 없이 외부 응답 대기</li>
<li><i style="background:var(--card);border-color:var(--hold);border-style:dashed;border-radius:3px"></i>커넥션 대기</li>
<li><i style="background:var(--holdbg);border-color:var(--hold);border-radius:3px"></i>커넥션을 쥔 채 외부 응답 대기</li>
<li><i style="background:var(--connbg);border-color:var(--conn);border-radius:3px"></i>커넥션으로 쿼리 (초록 점선 = DB로 가는 SQL)</li>
<li><i style="background:var(--line);border-color:var(--line);border-radius:3px"></i>성공 ✓</li>
<li><i style="background:var(--failbg);border-color:var(--fail);border-radius:3px"></i>실패 ×</li>
</ul>
<p class="cap">처리량 상한은 풀 크기 ÷ 커넥션을 쥐는 시간입니다. 2a는 ${SETUP.pool} ÷ ${SETUP.external}초 = 초당 ${SETUP.pool / SETUP.external}건이라 1초 안에 ${inside.ok}개만 끝납니다. 2b도 커넥션 대기가 생기지만(최대 ${outside.maxWaiting}개) 쥐는 시간이 ${SETUP.query * 1000}ms라 금방 빠집니다. 줄이 생기는 것보다 줄이 빠지는 속도가 중요합니다. 그림은 모델로 계산한 시간이고, 실제 테스트(PoolExhaustionExperimentTest)에서는 2a가 1,164ms에 성공 6 / 실패 14, 2b가 541ms에 20 / 0이었습니다. 차이는 HTTP와 Spring 처리 시간입니다. 스페이스로 재생/멈춤, ← →로 0.01초씩 옮깁니다.</p>
<script>${LIVE}${playerScript({ seconds: SECONDS, speed: 0.25, stillAt: 0.75, step: 0.01 })}</script>`,
});
console.log("inside", inside.ok, "/", inside.fail, inside.end, "outside", outside.ok, "/", outside.fail, outside.end);
