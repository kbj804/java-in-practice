// 1단계 그림: POST /posts 요청 한 건이 Spring Boot 앱 안에서 거치는 길(위에서 본 2D).
// 단계 내용은 model.mjs 에서 온다. node build.mjs → index.html, index-light.html
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { controls, playerScript, writePages } from "../page.mjs";
import { MOVE_SECONDS, STAGE_SECONDS, STAGES } from "./model.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const SECONDS = STAGES.length * STAGE_SECONDS;

// 요청 토큰이 각 상자에 있을 때의 자리(viewBox 800 × 250). 상자 오른쪽 위 모서리에 배지처럼 얹는다.
const AT = {
  client: [74, 118], tomcat: [214, 83], dispatch: [366, 44], ctrl: [366, 110],
  proxy: [526, 44], svc: [516, 104], repo: [526, 180], hib: [646, 180],
};

const box = (key, x, y, w, h, title, sub) =>
  `<rect class="box" data-box="${key}" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/>` +
  `<text class="t-title" x="${x + 8}" y="${y + 19}">${title}</text>` +
  (sub ? `<text class="t-mute" x="${x + 8}" y="${y + 35}">${sub}</text>` : "");

const lanes = [0, 1, 2, 3].map((k) =>
  `<rect class="slot" data-lane="${k}" x="126" y="${72 + k * 28}" width="102" height="22" rx="6"/>` +
  `<text class="t-mute" x="133" y="${87 + k * 28}">T${k + 1}</text><text class="t-mute" data-lanetext="${k}" x="152" y="${87 + k * 28}">비어 있음</text>`).join("");
const conns = [0, 1, 2].map((s) =>
  `<rect class="slot" data-conn="${s}" x="556" y="${70 + s * 24}" width="92" height="20" rx="6"/>` +
  `<text class="t-mute" x="563" y="${84 + s * 24}">C${s + 1}</text><text class="t-tok" data-conntext="${s}" x="612" y="${84 + s * 24}" text-anchor="middle"></text>`).join("");

const figure = `<svg viewBox="0 0 800 250" role="img" aria-label="Spring Boot 앱 안에서 요청 한 건이 지나가는 상자들을 위에서 본 그림">
<rect class="frame" x="104" y="14" width="560" height="226" rx="10"/>
<text class="t-title" x="116" y="32">JVM 프로세스 · Spring Boot 앱</text>
${box("client", 12, 118, 76, 60, "클라이언트", "curl")}
${box("tomcat", 118, 44, 118, 156, "Tomcat 스레드 풀")}${lanes}
<text class="t-mute" x="126" y="192">기본 200개 중 4개</text>
${box("dispatch", 252, 44, 128, 46, "DispatcherServlet", "URL → 메서드")}
${box("ctrl", 252, 110, 128, 46, "PostController", "JSON ↔ 객체 · @Valid")}
<rect class="frame" data-box="proxy" x="396" y="44" width="144" height="120" rx="8"/>
<text class="t-title" x="404" y="62">트랜잭션 프록시</text><text class="t-mute" x="404" y="78">@Transactional</text>
${box("svc", 406, 104, 124, 46, "PostService", "Clock 주입")}
${box("repo", 396, 180, 144, 46, "PostRepository", "Spring Data 구현체")}
${box("hib", 548, 180, 108, 46, "Hibernate", "영속성 컨텍스트")}
${box("pool", 548, 44, 108, 120, "HikariCP")}${conns}
<text class="t-mute" x="556" y="155">기본 10개 중 3개</text>
${box("db", 680, 44, 108, 182, "PostgreSQL", "post 테이블")}
<rect class="slot" data-row x="688" y="96" width="92" height="40" rx="6" style="display:none"/>
<text class="t-tok" data-rowtext x="696" y="113"></text><text class="t-mute" data-rowsub x="696" y="128"></text>
<path class="query" data-query d="M648 80 H680" style="display:none"/>
<text class="t-tok" data-sql x="734" y="156" text-anchor="middle" style="fill:var(--conn)"></text>
<text class="t-tok" data-reply x="50" y="198" text-anchor="middle" style="fill:var(--run)"></text>
<g data-token><circle r="11"/><text class="t-tok" y="3" text-anchor="middle">요청</text></g>
</svg>`;

const LABELS = ["도착", "찾기", "검증", "시작", "로직", "save", "INSERT", "커밋", "응답"];
const timeline = `<svg viewBox="0 0 800 86" role="img" aria-label="단계별로 스레드와 커넥션을 쥐고 있는 구간" data-timeline></svg>`;

const css = `
.box.cur{stroke:var(--run);stroke-width:1.8}
.frame.cur{stroke:var(--run);stroke-dasharray:none;stroke-width:1.8}
.slot.run{fill:var(--runbg);stroke:var(--run);stroke-width:1.6}
.slot.conn{fill:var(--connbg);stroke:var(--conn);stroke-width:1.6}
.slot.pending{stroke:var(--conn);stroke-dasharray:3 2}
[data-token] circle{fill:var(--run);stroke:var(--run)}[data-token] text{fill:#fff;font-size:8.5px}
.now{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px}
@media (max-width:760px){.now{grid-template-columns:1fr}}
.now h2{font-size:15px;margin:0 0 4px}.now p{margin:0 0 6px;font-size:14px}
.now .fa{color:var(--mute)}.now .fa b{color:var(--ink);font-weight:600}
.now pre{margin:0;padding:10px 12px;background:var(--box);border:1px solid var(--line);border-radius:8px;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-x:auto}
.tl-row{fill:none;stroke:var(--line)}.tl-run{fill:var(--run)}.tl-conn{fill:var(--conn)}
.tl-sql{fill:var(--card);stroke:var(--conn);stroke-width:1.4}
.playhead{stroke:var(--ink);stroke-width:1.2}
.tl-cur{fill:var(--ink);font-weight:700}
`;

const LIVE = `
const ST = ${JSON.stringify(STAGES)};
const AT = ${JSON.stringify(AT)};
const STAGE = ${STAGE_SECONDS}, MOVE = ${MOVE_SECONDS};
const LABELS = ${JSON.stringify(LABELS)};
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; };
const ease = (u) => u * u * (3 - 2 * u);
const $ = (s) => document.querySelector(s);
const boxes = Object.fromEntries([...document.querySelectorAll("[data-box]")].map((e) => [e.dataset.box, e]));
const lane = $('[data-lane="0"]'), laneText = $('[data-lanetext="0"]');
const conn = $('[data-conn="0"]'), connText = $('[data-conntext="0"]');
const token = $("[data-token]"), query = $("[data-query]"), sql = $("[data-sql]"), reply = $("[data-reply]");
const row = $("[data-row]"), rowText = $("[data-rowtext]"), rowSub = $("[data-rowsub]");
const now = { n: $("[data-sn]"), title: $("[data-stitle]"), spring: $("[data-sspring]"), fast: $("[data-sfast]"), code: $("[data-scode]") };

// 시간 막대: 단계마다 한 칸. 스레드 T1, 커넥션 C1 을 쥔 칸을 칠한다.
const tl = $("[data-timeline]"), X0 = 110, X1 = 788, CW = (X1 - X0) / ST.length;
[["스레드 T1", "thread", "tl-run", 8], ["커넥션 C1", "conn", "tl-conn", 32]].forEach(([name, key, cls, y]) => {
  el("rect", { class: "tl-row", x: X0, y, width: X1 - X0, height: 14, rx: 3 }, tl);
  el("text", { class: "t-mute", x: 10, y: y + 11 }, tl).textContent = name;
  ST.forEach((s, i) => { if (s[key]) el("rect", { class: cls, x: X0 + i * CW + 1, y, width: CW - 2, height: 14, rx: 3 }, tl); });
});
ST.forEach((s, i) => { if (s.sql) { const c = el("rect", { class: "tl-sql", x: X0 + i * CW + CW / 2 - 20, y: 35, width: 40, height: 8, rx: 4 }, tl); } });
const labels = LABELS.map((name, i) => { const t = el("text", { class: "t-mute", x: X0 + i * CW + CW / 2, y: 66, "text-anchor": "middle" }, tl); t.textContent = (i + 1) + " " + name; return t; });
el("text", { class: "t-mute", x: 10, y: 66 }, tl).textContent = "단계";
const head = el("line", { class: "playhead", x1: X0, x2: X0, y1: 2, y2: 52 }, tl);

let shown = -1;
window.draw = (t) => {
  const i = Math.min(ST.length - 1, Math.floor(t / STAGE + 1e-9)), s = ST[i];
  const u = ease(Math.min(1, (t - i * STAGE) / MOVE));
  const from = AT[i === 0 ? "client" : ST[i - 1].at], to = AT[s.at];
  const p = [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u];
  token.setAttribute("transform", "translate(" + p[0].toFixed(1) + " " + p[1].toFixed(1) + ")");
  for (const k in boxes) boxes[k].classList.toggle("cur", k === s.at);
  lane.setAttribute("class", "slot" + (s.thread ? " run" : "")); laneText.textContent = s.thread ? "처리 중" : "비어 있음";
  conn.setAttribute("class", "slot" + (s.conn ? " conn" : "")); connText.textContent = s.conn ? "요청" : "";
  query.style.display = s.sql ? "" : "none"; sql.textContent = s.sql ? "← " + s.sql : "";
  // DB 의 post 행: INSERT 뒤에는 커밋 전(다른 트랜잭션에는 안 보임), 커밋 뒤에는 저장됨
  const inserted = i >= 6, committed = i >= 7 && (i > 7 || u >= 1);
  row.style.display = inserted ? "" : "none"; row.setAttribute("class", "slot" + (committed ? " conn" : " pending"));
  rowText.textContent = inserted ? "id 1" : ""; rowSub.textContent = inserted ? (committed ? "커밋됨" : "커밋 전") : "";
  reply.textContent = i === ST.length - 1 && u >= 1 ? "201 Created" : "";
  head.setAttribute("x1", X0 + (t / STAGE) * CW); head.setAttribute("x2", X0 + (t / STAGE) * CW);
  if (shown !== i) {
    shown = i;
    labels.forEach((l, k) => l.setAttribute("class", k === i ? "t-mute tl-cur" : "t-mute"));
    now.n.textContent = (i + 1) + " / " + ST.length; now.title.textContent = s.title; now.spring.textContent = s.spring;
    now.fast.innerHTML = "<b>FastAPI라면</b> " + s.fastapi; now.code.textContent = s.code;
  }
};
`;

writePages(dir, {
  title: "요청 한 건의 길",
  css,
  body: `<h1>Spring Fig 1 · 요청 한 건의 길</h1>
<p class="lead">게시글을 쓰는 POST /posts 요청 하나가 Spring Boot 앱 안에서 어떤 상자를 거치는지 단계별로 봅니다. 아래 막대는 단계마다 Tomcat 스레드와 DB 커넥션을 쥐고 있는지 보여 줍니다.</p>
${controls([0.5, 1, 2], 1)}
<section class="card">
<div class="scroll">${figure}
${timeline}</div>
<div class="now"><div><div class="head"><b data-stitle></b><span data-sn></span></div><p data-sspring></p><p class="fa" data-sfast></p></div><pre data-scode></pre></div>
</section>
<ul class="legend">
<li><i style="background:var(--run);border-color:var(--run)"></i>요청이 지금 있는 곳 (파란 테두리 = 지금 실행 중인 상자)</li>
<li><i style="background:var(--runbg);border-color:var(--run);border-radius:3px"></i>이 요청을 맡은 Tomcat 스레드</li>
<li><i style="background:var(--connbg);border-color:var(--conn);border-radius:3px"></i>빌려 쓰는 커넥션 (초록 점선 = DB로 가는 SQL, 시간 막대의 속 빈 칸 = SQL을 보낸 단계)</li>
<li><i style="background:var(--framebg);border-color:var(--frame);border-style:dashed;border-radius:3px"></i>점선 상자 = Spring이 감싼 것(JVM, 트랜잭션 프록시)</li>
</ul>
<p class="cap">스레드는 요청이 도착할 때부터 응답할 때까지 9단계를 모두 쥐지만, 커넥션은 트랜잭션이 열린 4~8단계만 씁니다. 스레드 풀(기본 200)과 커넥션 풀(기본 10)은 따로 있어서, 둘의 크기와 쥐는 시간이 2단계 실험의 주제가 됩니다. 커넥션 3개·스레드 4개만 그렸습니다. 스페이스로 재생/멈춤, ← →로 한 단계씩 옮깁니다.</p>
<script>${LIVE}${playerScript({ seconds: SECONDS, speed: 1, stillAt: STAGE_SECONDS * 6.5, step: STAGE_SECONDS })}</script>`,
});
console.log("stages", STAGES.length, "seconds", SECONDS);
