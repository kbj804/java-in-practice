// 3단계 그림: 글 저장과 메시지 보내기를 묶는 세 방법(가·나·다)을 두 장애 상황에서 비교(위에서 본 2D 그림 세 장, 같은 시계).
// 단계와 결과는 모두 model.mjs 에서 나온다. 모델 결과가 테스트 출력(TEST)과 다르면 빌드가 멈춘다.
// node build.mjs → index.html, index-light.html  (?s=rollback 으로 "뒤 단계 실패" 상황을 열 수 있다)
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { controls, playerScript, writePages } from "../page.mjs";
import { SCENARIOS, STAGE_SECONDS, TEST, WAYS, WRITES, outcome, timeline } from "./model.mjs";

const dir = dirname(fileURLToPath(import.meta.url));

// 모델이 테스트를 재현하는지 확인
for (const [scn, { ways }] of Object.entries(SCENARIOS))
  for (const w of WAYS) {
    const got = JSON.stringify(outcome(ways[w.key])), want = JSON.stringify(TEST[scn][w.key]);
    if (got !== want) throw new Error(`${scn}/${w.key}: model ${got} != test ${want}`);
  }

const maxStages = Math.max(...Object.values(SCENARIOS).flatMap((s) => Object.values(s.ways).map((st) => st.length)));
const SECONDS = maxStages * STAGE_SECONDS + 0.4;
const DATA = {
  stageSeconds: STAGE_SECONDS, writes: WRITES,
  scn: Object.fromEntries(Object.entries(SCENARIOS).map(([k, s]) => [k, {
    label: s.label, lead: s.lead,
    ways: Object.fromEntries(WAYS.map((w) => [w.key, {
      titles: s.ways[w.key].map((st) => st.title),
      active: s.ways[w.key].map((st) => st.active),
      flow: s.ways[w.key].map((st) => st.flow ?? null),
      states: timeline(s.ways[w.key]),
      outcome: outcome(s.ways[w.key]),
    }])),
  }])),
};

// ── 그림 좌표(viewBox 360 × 196) ──
//  앱 | PostgreSQL (+ 아래 OutboxRelay) | 브로커
function figureSvg(way) {
  const isOutbox = way === "outbox", isAfter = way === "after";
  return `<svg viewBox="0 0 360 196" role="img" aria-label="앱, PostgreSQL, ${isOutbox ? "OutboxRelay, " : ""}브로커를 위에서 본 그림">
<path class="arrow" data-flow="app-broker" d="M64 28 V14 H300 V28"/>
<path class="arrow" data-flow="app-db" d="M120 66 H130"/>
${isOutbox ? `<path class="arrow" data-flow="relay-db" d="M185 146 V122"/><path class="arrow" data-flow="relay-broker" d="M240 166 H250"/>` : ""}
<rect class="box" data-box="app" x="8" y="28" width="112" height="160" rx="8"/><text class="t-title" x="16" y="45">앱 · 글쓰기</text>
<rect class="chip" data-chip="tx" x="16" y="52" width="96" height="40" rx="6"/><text class="t-mute" x="24" y="68">트랜잭션</text><text class="t-tok" data-text="tx" x="24" y="84"></text>
${isAfter ? `<rect class="chip" data-chip="mem" x="16" y="100" width="96" height="40" rx="6"/><text class="t-mute" x="24" y="116">메모리의 이벤트</text><text class="t-tok" data-text="mem" x="24" y="132"></text>` : ""}
<text class="t-mute" x="16" y="164">응답</text><text class="t-resp" data-text="resp" x="16" y="180"></text>
<rect class="box" data-box="db" x="130" y="28" width="110" height="94" rx="8"/><text class="t-title" x="138" y="45">PostgreSQL</text>
<rect class="chip" data-chip="post" x="138" y="52" width="94" height="28" rx="6"/><text class="t-mute" x="144" y="64">post 행</text><text class="t-tok" data-text="post" x="144" y="75"></text>
${isOutbox
    ? `<rect class="chip" data-chip="outbox" x="138" y="86" width="94" height="28" rx="6"/><text class="t-mute" data-text="attempts" x="144" y="98">outbox</text><text class="t-tok" data-text="outbox" x="144" y="109"></text>`
    : `<text class="t-mute" x="138" y="104">outbox 표 안 씀</text>`}
${isOutbox ? `<rect class="box" data-box="relay" x="130" y="146" width="110" height="42" rx="8"/><text class="t-title" x="138" y="162">OutboxRelay</text><text class="t-tok" data-text="relay" x="138" y="178"></text>` : ""}
<rect class="box" data-box="broker" x="250" y="28" width="102" height="160" rx="8"/><text class="t-title" x="258" y="45">브로커</text>
<rect class="chip" data-chip="broker" x="258" y="52" width="86" height="24" rx="6"/><text class="t-tok" data-text="broker" x="266" y="68"></text>
<rect class="chip" data-chip="msg" x="258" y="86" width="86" height="40" rx="6"/><text class="t-mute" x="266" y="102">PostCreated</text><text class="t-tok" data-text="msg" x="266" y="118"></text>
</svg>`;
}

const stat = (key, label, cls = "") => `<div class="stat ${cls}"><small>${label}</small><b data-stat="${key}">–</b></div>`;
const card = (w) => `<section class="card" data-fig="${w.key}">
<div class="head"><b>${w.name}</b></div>
<div class="cls">${w.cls}</div>
<div class="scroll">${figureSvg(w.key)}</div>
<p class="now" data-now></p>
<ol class="steps" data-steps></ol>
<div class="stats">${stat("accepted", "요청 성공")}${stat("saved", "저장된 글")}${stat("sent", "보낸 메시지")}${stat("verdict", "판정")}</div>
</section>`;

const css = `
.figs{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
@media (max-width:1000px){.figs{grid-template-columns:1fr}}
.scroll svg{min-width:320px}
.cls{color:var(--mute);font-size:12px;font-family:ui-monospace,Menlo,monospace;margin:2px 0 6px;overflow-wrap:anywhere;min-height:2.9em}
.scn{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 4px}
.scn button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:6px 14px;cursor:pointer}
.scn button[aria-pressed="true"]{border-color:var(--ink);font-weight:600}
.scn-lead{color:var(--mute);font-size:14px;margin:4px 0 0}
.box.on{stroke:var(--run);stroke-width:2}
.chip{fill:var(--card);stroke:var(--line)}
.chip.k-run{fill:var(--runbg);stroke:var(--run);stroke-dasharray:3 2}
.chip.k-ok{fill:var(--connbg);stroke:var(--conn)}
.chip.k-hold{fill:var(--holdbg);stroke:var(--hold)}
.chip.k-bad{fill:var(--failbg);stroke:var(--fail)}
.t-tok.k-ok,.t-resp.k-ok{fill:var(--conn)}.t-tok.k-bad,.t-resp.k-bad{fill:var(--fail)}.t-tok.k-hold{fill:var(--hold)}.t-tok.k-run{fill:var(--run)}.t-tok.k-none{fill:var(--mute);font-weight:400}
.t-resp{font-size:13px;font-weight:700}
.arrow{fill:none;stroke:var(--line);stroke-width:1.4}
.arrow.on{stroke:var(--run);stroke-width:2;stroke-dasharray:4 4;animation:flow .6s linear infinite}
@media (prefers-reduced-motion:reduce){.arrow.on{animation:none}}
.now{min-height:2.9em;font-weight:600;margin:8px 0 4px!important}
.steps{margin:0 0 8px;padding-left:20px;font-size:12.5px;color:var(--mute)}
.steps li{margin:1px 0}.steps li.done{color:var(--ink)}.steps li.cur{color:var(--run);font-weight:600}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:6px 0 4px}
.stat{border:1px solid var(--line);border-radius:8px;padding:4px 8px}
.stat small{display:block;color:var(--mute);font-size:11.5px}
.stat b{font-variant-numeric:tabular-nums;font-size:15px}
.stat b.k-ok{color:var(--conn)}.stat b.k-bad{color:var(--fail)}
`;

const LIVE = `
const D = ${JSON.stringify(DATA)};
const LABEL = {
  tx: { "-": ["시작 전", "none"], open: ["열림", "run"], commit: ["커밋됨", "ok"], rollback: ["롤백됨", "bad"] },
  post: { "-": ["없음", "none"], pending: ["커밋 전", "run"], committed: ["커밋됨", "ok"], gone: ["롤백 · 없음", "bad"] },
  outbox: { "-": ["없음", "none"], pending: ["커밋 전", "run"], committed: ["보낼 차례", "hold"], sent: ["보냄 ✓", "ok"], gone: ["롤백 · 없음", "bad"] },
  mem: { "-": ["없음", "none"], held: ["1건 맡김", "hold"], dropped: ["사라짐", "bad"] },
  relay: { "-": ["대기", "none"], fail: ["실패 · 다음에 재시도", "bad"], sent: ["보냄 ✓", "ok"], idle: ["대기", "none"] },
  broker: { up: ["정상", "ok"], down: ["장애", "bad"] },
  msg: { "-": ["없음", "none"], sent: ["받음 ✓", "ok"], ghost: ["유령 · 글 없음", "bad"], error: ["보내기 실패 ×", "bad"], lost: ["유실 · 다시 안 옴", "bad"] },
};
const params = new URLSearchParams(location.search);
let scn = params.get("s") === "rollback" ? "rollback" : "down";
const scnButtons = [...document.querySelectorAll("[data-scn]")], scnLead = document.querySelector("[data-scn-lead]");

const figs = ${JSON.stringify(WAYS.map((w) => w.key))}.map((key) => {
  const root = document.querySelector('[data-fig="' + key + '"]');
  const q = (s) => root.querySelector(s), qa = (s) => [...root.querySelectorAll(s)];
  const chips = Object.fromEntries(qa("[data-chip]").map((e) => [e.dataset.chip, e]));
  const texts = Object.fromEntries(qa("[data-text]").map((e) => [e.dataset.text, e]));
  const boxes = qa("[data-box]"), arrows = qa("[data-flow]"), now = q("[data-now]"), steps = q("[data-steps]");
  const stats = Object.fromEntries(qa("[data-stat]").map((e) => [e.dataset.stat, e]));
  let shown = null, items = [];
  function setText(name, label, kind) {
    if (texts[name]) { texts[name].textContent = label; texts[name].setAttribute("class", (name === "resp" ? "t-resp" : "t-tok") + " k-" + kind); }
    if (chips[name]) chips[name].setAttribute("class", "chip k-" + kind);
  }
  function draw(t) {
    const w = D.scn[scn].ways[key], n = w.titles.length;
    if (shown !== scn) { steps.innerHTML = w.titles.map((x) => "<li>" + x + "</li>").join(""); items = [...steps.children]; shown = scn; }
    const k = Math.min(n - 1, Math.floor(t / D.stageSeconds)), s = w.states[k];
    for (const name of ["tx", "post", "outbox", "mem", "relay", "broker", "msg"]) { const [label, kind] = LABEL[name][s[name]]; setText(name, label, kind); }
    if (texts.attempts) texts.attempts.textContent = "outbox" + (s.attempts ? " · 실패 " + s.attempts + "회" : "");
    setText("resp", s.resp ? String(s.resp) + (s.resp === 201 ? " 성공" : " 실패") : "아직", s.resp === 201 ? "ok" : s.resp ? "bad" : "none");
    boxes.forEach((b) => b.setAttribute("class", "box" + (b.dataset.box === w.active[k] ? " on" : "")));
    arrows.forEach((a) => a.setAttribute("class", "arrow" + (a.dataset.flow === w.flow[k] ? " on" : "")));
    now.textContent = (k + 1) + ". " + w.titles[k];
    items.forEach((li, i) => li.className = i < k ? "done" : i === k ? "cur" : "");
    const done = t >= (n - 1) * D.stageSeconds + 0.3, o = w.outcome;
    stats.accepted.textContent = done ? o.accepted + "/" + D.writes : "–";
    stats.saved.textContent = done ? o.saved : "–";
    stats.sent.textContent = done ? o.sent : "–";
    const verdict = o.lost ? ["유실 " + o.lost, "bad"] : o.ghost ? ["유령 " + o.ghost, "bad"] : o.accepted === 0 && o.saved === 0 && o.sent === 0 && scn === "down" ? ["쓰기 실패", "bad"] : ["일치 ✓", "ok"];
    stats.verdict.textContent = done ? verdict[0] : "–"; stats.verdict.className = done ? "k-" + verdict[1] : "";
  }
  return { draw };
});
let lastT = 0;
window.draw = (t) => { lastT = t; figs.forEach((f) => f.draw(t)); };
function setScn(next) {
  scn = next; scnButtons.forEach((b) => b.setAttribute("aria-pressed", b.dataset.scn === scn)); scnLead.textContent = D.scn[scn].lead;
  const slider = document.querySelector("[data-time]"); slider.value = 0; slider.dispatchEvent(new Event("input"));
  document.querySelector("[data-play]").click();
}
scnButtons.forEach((b) => b.addEventListener("click", () => setScn(b.dataset.scn)));
scnButtons.forEach((b) => b.setAttribute("aria-pressed", b.dataset.scn === scn)); scnLead.textContent = D.scn[scn].lead;
`;

writePages(dir, {
  title: "커밋과 메시지",
  css,
  body: `<h1>Spring Fig 3 · 글 저장과 메시지 보내기를 어떻게 묶을까</h1>
<p class="lead">글을 저장하면 "글이 생겼다"는 메시지를 브로커로 보내야 합니다(알림, 검색 색인 등). DB 커밋과 브로커 전송은 한 트랜잭션으로 묶을 수 없어서, 언제 보내느냐에 따라 사라지는 쪽이 달라집니다. 세 그림은 같은 시계로 움직입니다.</p>
<div class="scn">${Object.entries(SCENARIOS).map(([k, s]) => `<button data-scn="${k}">${s.label}</button>`).join("")}</div>
<p class="scn-lead" data-scn-lead></p>
${controls([0.5, 1, 2], 1)}
<div class="figs">
${WAYS.map(card).join("\n")}
</div>
<ul class="legend">
<li><i style="background:var(--runbg);border-color:var(--run);border-style:dashed;border-radius:3px"></i>커밋 전 (아직 확정 아님)</li>
<li><i style="background:var(--connbg);border-color:var(--conn);border-radius:3px"></i>확정됨 · 받음</li>
<li><i style="background:var(--holdbg);border-color:var(--hold);border-radius:3px"></i>맡겨 둠 · 보낼 차례</li>
<li><i style="background:var(--failbg);border-color:var(--fail);border-radius:3px"></i>사라짐 · 실패</li>
<li><i style="border-color:var(--run);border-radius:3px"></i>파란 테두리 = 지금 일하는 곳, 파란 점선 = 지금 오가는 호출</li>
</ul>
<p class="cap">아래 숫자는 글 ${WRITES}개를 쓴 실제 테스트(EventDeliveryExperimentTest) 결과이고, 그림의 단계 모델로 계산한 값과 같습니다. 가는 롤백된 글의 메시지가 이미 나가 버리고(유령), 브로커가 죽으면 글쓰기까지 막힙니다. 나는 커밋과 전송 사이에 틈이 있어 그 순간의 장애나 서버 종료에 메시지가 사라집니다(유실). 다는 메시지를 글과 같은 트랜잭션으로 DB에 적어 두니 둘이 함께 남거나 함께 사라지고, 보내는 일은 릴레이가 성공할 때까지 반복합니다. 대신 같은 메시지가 두 번 갈 수 있어(적어도 한 번) 받는 쪽이 event_id로 중복을 걸러야 합니다. 릴레이 두 개를 동시에 돌린 테스트에서는 SKIP LOCKED로 10건씩 나눠 가져가 20건이 중복 없이 나갔습니다. 스페이스로 재생/멈춤, ← →로 한 단계씩 옮깁니다.</p>
<script>${LIVE}${playerScript({ seconds: SECONDS, speed: 1, stillAt: SECONDS - 0.2, step: STAGE_SECONDS })}</script>`,
});
for (const [scn, { ways }] of Object.entries(SCENARIOS)) console.log(scn, Object.fromEntries(WAYS.map((w) => [w.key, outcome(ways[w.key])])));
