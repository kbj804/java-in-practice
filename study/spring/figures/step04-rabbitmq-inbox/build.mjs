// 4단계 그림: RabbitMQ 로 받은 "새 글" 메시지로 이웃 1,000명에게 알림을 보내는 워커. 세 장면에서 받는 쪽 설계를 비교한다.
// 이웃 한 명이 격자 한 칸이다. 칸 색은 inbox 행 상태(pending · processing · completed), 빨간 칸은 두 번 받은 이웃이다.
// 단계와 결과는 모두 model.mjs 에서 나온다. 모델 결과가 테스트 출력(TEST)과 다르면 빌드가 멈춘다.
// node build.mjs → index.html, index-light.html  (?s=concurrent, ?s=crash 로 다른 장면을 열 수 있다)
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { controls, playerScript, writePages } from "../page.mjs";
import { BATCH, MEMBERS, SCENARIOS, STAGE_SECONDS, TEST, WAYS, outcome, received, timeline } from "./model.mjs";

const dir = dirname(fileURLToPath(import.meta.url));

// 모델이 테스트를 재현하는지 확인
for (const [scn, { ways }] of Object.entries(SCENARIOS))
  for (const [way, stages] of Object.entries(ways)) {
    const got = JSON.stringify(outcome(stages)), want = JSON.stringify(TEST[scn][way]);
    if (got !== want) throw new Error(`${scn}/${way}: model ${got} != test ${want}`);
  }

const maxStages = Math.max(...Object.values(SCENARIOS).flatMap((s) => Object.values(s.ways).map((st) => st.length)));
const SECONDS = maxStages * STAGE_SECONDS + 0.4;

// 칸마다 상태를 미리 계산해 문자열로 싣는다. 한 글자 = 한 칸.
//   . 행 없음  p pending  r processing(워커 1)  R processing(워커 2)  c completed(워커 1)  C completed(워커 2)
//   대문자/소문자 뒤에 받은 횟수를 따로 싣는다 (0·1·2)
function cells(state) {
  const kind = new Array(MEMBERS).fill(".");
  for (const [from, to, st, by] of state.rows)
    for (let i = from; i < to; i++) kind[i] = st === "pending" ? "p" : st === "processing" ? (by === "w2" ? "R" : "r") : by === "w2" ? "C" : "c";
  return { kind: kind.join(""), recv: received(state).join("") };
}

const CARDS = Object.entries(SCENARIOS).flatMap(([scn, s]) => Object.keys(s.ways).map((way) => ({ scn, way, id: `${scn}-${way}` })));
const DATA = {
  stageSeconds: STAGE_SECONDS, members: MEMBERS,
  scn: Object.fromEntries(Object.entries(SCENARIOS).map(([k, s]) => [k, { label: s.label, lead: s.lead, ways: Object.keys(s.ways) }])),
  cards: Object.fromEntries(CARDS.map(({ scn, way, id }) => {
    const stages = SCENARIOS[scn].ways[way], states = timeline(stages);
    return [id, {
      titles: stages.map((st) => st.title),
      active: stages.map((st) => st.active),
      states: states.map((s) => ({ queue: s.queue, workers: s.workers, sweeper: s.sweeper, lost: s.lost, ...cells(s) })),
      outcome: outcome(stages),
    }];
  })),
};

// ── 그림 좌표(viewBox 400 × 300) ──
//  RabbitMQ 큐 | 워커 | 스케줄러
//  PostgreSQL inbox: 이웃 1,000명 = 40 × 25 칸
const COLS = 40, PITCH = 7, GX = 16, GY = 106;
function figureSvg({ scn, way }) {
  const two = scn === "concurrent";
  const grid = Array.from({ length: MEMBERS }, (_, i) =>
    `<rect class="cell" x="${GX + (i % COLS) * PITCH}" y="${GY + Math.floor(i / COLS) * PITCH}" width="6" height="6" rx="1"/>`).join("");
  const legend = [["pend", "pending"], ["proc", "processing"], ["done", "completed"], ["dup", "두 번 받음"], ["lost", "못 받음"]]
    .map(([k, label], i) => `<rect class="cell c-${k}" x="306" y="${112 + i * 30}" width="9" height="9" rx="1.5"/><text class="t-mute" x="320" y="${120 + i * 30}">${label}</text><text class="t-tok" data-count="${k}" x="320" y="${133 + i * 30}"></text>`).join("");
  return `<svg viewBox="0 0 400 300" role="img" aria-label="RabbitMQ 큐, 워커, 스케줄러, 이웃 1,000명의 inbox 행을 위에서 본 그림">
<path class="arrow" data-flow="queue" d="M128 39 H136"/><path class="arrow" data-flow="db" d="M200 70 V80"/><path class="arrow" data-flow="sweeper" d="M332 70 V80"/>
<rect class="box" data-box="queue" x="8" y="8" width="120" height="62" rx="8"/><text class="t-title" x="16" y="24">RabbitMQ 큐</text>
<g data-queue></g>
<rect class="box" data-box="worker" x="136" y="8" width="128" height="62" rx="8"/><text class="t-title" x="144" y="24">워커${two ? " 1 · 2" : ""}</text>
<text class="t-tok" data-worker="w1" x="144" y="42"></text>${two ? `<text class="t-tok" data-worker="w2" x="144" y="58"></text>` : ""}
<rect class="box" data-box="sweeper" x="272" y="8" width="120" height="62" rx="8"/><text class="t-title" x="280" y="24">스케줄러</text><text class="t-tok" data-sweeper x="280" y="42"></text>
<text class="t-mute" x="280" y="58">리스 30초 · ${BATCH}명씩</text>
<rect class="box" data-box="db" x="8" y="80" width="384" height="212" rx="8"/>${way === "naive"
    ? `<text class="t-title" x="16" y="97">이웃 ${MEMBERS.toLocaleString()}명</text><text class="t-mute" x="100" y="97">inbox 표 없음 · 받은 횟수만 칸에 표시</text>`
    : `<text class="t-title" x="16" y="97">PostgreSQL</text><text class="t-mute" x="90" y="97">notification_delivery · 이웃 ${MEMBERS.toLocaleString()}명 = ${MEMBERS.toLocaleString()}칸</text>`}
<g data-grid>${grid}</g>
${legend}
</svg>`;
}

const stat = (key, label) => `<div class="stat"><small>${label}</small><b data-stat="${key}">–</b></div>`;
const card = (c) => `<section class="card" data-card="${c.id}" data-scn="${c.scn}" hidden>
<div class="head"><b>${WAYS[c.way].name}</b></div>
<div class="cls">${WAYS[c.way].cls}</div>
<div class="scroll">${figureSvg(c)}</div>
<p class="now" data-now></p>
<ol class="steps" data-steps></ol>
<div class="stats">${stat("pushes", "푸시")}${stat("reached", "받은 이웃")}${stat("missed", "못 받은 이웃")}${stat("duplicatePushes", "중복 푸시")}${stat("trayDuplicates", "알림창 중복")}</div>
</section>`;

const css = `
.figs{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.figs.one{grid-template-columns:minmax(0,640px)}
@media (max-width:1000px){.figs{grid-template-columns:1fr}}
.scroll svg{min-width:340px}
.cls{color:var(--mute);font-size:12px;font-family:ui-monospace,Menlo,monospace;margin:2px 0 6px;overflow-wrap:anywhere}
.scn{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 4px}
.scn button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:6px 14px;cursor:pointer}
.scn button[aria-pressed="true"]{border-color:var(--ink);font-weight:600}
.scn-lead{color:var(--mute);font-size:14px;margin:4px 0 0}
.box.on{stroke:var(--run);stroke-width:2}
.chip{fill:var(--card);stroke:var(--line)}
.chip.k-run{fill:var(--runbg);stroke:var(--run);stroke-dasharray:3 2}
.chip.k-ok{fill:var(--connbg);stroke:var(--conn);opacity:.55}
.chip.k-hold{fill:var(--holdbg);stroke:var(--hold)}
.chip.k-bad{fill:var(--failbg);stroke:var(--fail)}
.t-tok.k-ok{fill:var(--conn)}.t-tok.k-bad{fill:var(--fail)}.t-tok.k-hold{fill:var(--hold)}.t-tok.k-run{fill:var(--run)}.t-tok.k-none{fill:var(--mute);font-weight:400}
.cell{fill:var(--card);stroke:var(--line);stroke-width:.6}
.cell.c-pend{fill:var(--holdbg);stroke:var(--hold)}
.cell.c-proc{fill:var(--runbg);stroke:var(--run)}
.cell.c-proc2{fill:var(--framebg);stroke:var(--frame)}
.cell.c-done{fill:var(--conn);stroke:var(--conn)}
.cell.c-done2{fill:var(--frame);stroke:var(--frame)}
.cell.c-dup{fill:var(--fail);stroke:var(--fail)}
.cell.c-lost{fill:var(--failbg);stroke:var(--fail);stroke-width:1.4}
.arrow{fill:none;stroke:var(--line);stroke-width:1.4}
.arrow.on{stroke:var(--run);stroke-width:2;stroke-dasharray:4 4;animation:flow .6s linear infinite}
@media (prefers-reduced-motion:reduce){.arrow.on{animation:none}}
.now{min-height:2.9em;font-weight:600;margin:8px 0 4px!important}
.steps{margin:0 0 8px;padding-left:20px;font-size:12.5px;color:var(--mute)}
.steps li{margin:1px 0}.steps li.done{color:var(--ink)}.steps li.cur{color:var(--run);font-weight:600}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:6px 0 4px}
.stat{border:1px solid var(--line);border-radius:8px;padding:4px 8px}
.stat small{display:block;color:var(--mute);font-size:11.5px}
.stat b{font-variant-numeric:tabular-nums;font-size:15px}
.stat b.k-ok{color:var(--conn)}.stat b.k-bad{color:var(--fail)}
`;

const LIVE = `
const D = ${JSON.stringify(DATA)};
const Q = { ready: ["대기", "hold"], unacked: ["받음 · ack 전", "run"], acked: ["ack ✓", "ok"], requeued: ["다시 큐로", "bad"] };
const params = new URLSearchParams(location.search);
let scn = D.scn[params.get("s")] ? params.get("s") : "dup";
const scnButtons = [...document.querySelectorAll("[data-scn-btn]")], scnLead = document.querySelector("[data-scn-lead]"), figsEl = document.querySelector(".figs");
const NS = "http://www.w3.org/2000/svg";

const cards = Object.keys(D.cards).map((id) => {
  const root = document.querySelector('[data-card="' + id + '"]'), C = D.cards[id];
  const q = (s) => root.querySelector(s), qa = (s) => [...root.querySelectorAll(s)];
  const cellEls = qa("[data-grid] rect"), boxes = qa("[data-box]"), arrows = qa("[data-flow]");
  const queueG = q("[data-queue]"), workers = Object.fromEntries(qa("[data-worker]").map((e) => [e.dataset.worker, e]));
  const sweeper = q("[data-sweeper]"), now = q("[data-now]"), steps = q("[data-steps]");
  const counts = Object.fromEntries(qa("[data-count]").map((e) => [e.dataset.count, e]));
  const stats = Object.fromEntries(qa("[data-stat]").map((e) => [e.dataset.stat, e]));
  steps.innerHTML = C.titles.map((x) => "<li>" + x + "</li>").join("");
  const items = [...steps.children];
  let shownK = -1, shownDone = null;
  function text(el, label, kind) { el.textContent = label; el.setAttribute("class", "t-tok k-" + kind); }
  function draw(t) {
    const n = C.titles.length, k = Math.min(n - 1, Math.floor(t / D.stageSeconds)), s = C.states[k];
    const done = t >= (n - 1) * D.stageSeconds + 0.3;
    if (k !== shownK) {
      shownK = k;
      queueG.innerHTML = s.queue.map((m, i) => {
        const [label, kind] = Q[m.st], x = 14 + i * 56;
        return '<rect class="chip k-' + kind + '" x="' + x + '" y="32" width="52" height="30" rx="6"/><text class="t-mute" x="' + (x + 6) + '" y="44">' + m.id + (i ? " (또)" : "") + '</text><text class="t-tok k-' + kind + '" x="' + (x + 6) + '" y="57">' + label + "</text>";
      }).join("") || '<text class="t-mute" x="16" y="50">비어 있음</text>';
      for (const w of Object.keys(workers)) { const v = s.workers[w] ?? "대기"; text(workers[w], v, v.includes("죽음") ? "bad" : v === "대기" ? "none" : "run"); }
      if (s.sweeper === null) text(sweeper, "없음", "none"); else text(sweeper, s.sweeper, s.sweeper === "대기" ? "none" : "run");
      const tally = { pend: 0, proc: 0, done: 0, dup: 0, lost: 0 };
      for (let i = 0; i < cellEls.length; i++) {
        const kind = s.kind[i], got = Number(s.recv[i]);
        let cls = kind === "p" ? "c-pend" : kind === "r" ? "c-proc" : kind === "R" ? "c-proc2" : kind === "c" ? "c-done" : kind === "C" ? "c-done2" : got ? "c-done" : "";
        if (kind === "p") tally.pend++; else if (kind === "r" || kind === "R") tally.proc++; else if (kind === "c" || kind === "C" || got) tally.done++;
        if (got >= 2) { cls = "c-dup"; tally.dup++; }
        if (s.lost && got === 0) { cls = "c-lost"; tally.lost++; }
        cellEls[i].setAttribute("class", "cell " + cls);
      }
      for (const [key, v] of Object.entries(tally)) counts[key].textContent = v.toLocaleString() + "명";
      boxes.forEach((b) => b.setAttribute("class", "box" + (b.dataset.box === C.active[k] ? " on" : "")));
      arrows.forEach((a) => a.setAttribute("class", "arrow" + (a.dataset.flow === C.active[k] ? " on" : "")));
      now.textContent = (k + 1) + ". " + C.titles[k];
      items.forEach((li, i) => li.className = i < k ? "done" : i === k ? "cur" : "");
    }
    if (done !== shownDone) {
      shownDone = done;
      const o = C.outcome;
      for (const key of Object.keys(stats)) {
        stats[key].textContent = done ? o[key].toLocaleString() : "–";
        const bad = (key === "missed" || key === "trayDuplicates") && o[key] > 0;
        const ok = (key === "missed" || key === "trayDuplicates") && o[key] === 0;
        stats[key].className = done ? (bad ? "k-bad" : ok ? "k-ok" : "") : "";
      }
    }
  }
  return { id, root, draw, reset() { shownK = -1; shownDone = null; } };
});

window.draw = (t) => cards.forEach((c) => { if (!c.root.hidden) c.draw(t); });
function show() {
  scnButtons.forEach((b) => b.setAttribute("aria-pressed", b.dataset.scnBtn === scn));
  scnLead.textContent = D.scn[scn].lead;
  cards.forEach((c) => { c.root.hidden = c.root.dataset.scn !== scn; c.reset(); });
  figsEl.classList.toggle("one", D.scn[scn].ways.length === 1);
}
function setScn(next) {
  scn = next; show();
  const slider = document.querySelector("[data-time]"); slider.value = 0; slider.dispatchEvent(new Event("input"));
  document.querySelector("[data-play]").click();
}
scnButtons.forEach((b) => b.addEventListener("click", () => setScn(b.dataset.scnBtn)));
show();
`;

writePages(dir, {
  title: "알림 워커 inbox",
  css,
  body: `<h1>Spring Fig 4 · 같은 메시지가 두 번 와도, 보내다 죽어도</h1>
<p class="lead">outbox 는 "적어도 한 번" 보내서 같은 메시지가 두 번 올 수 있고, 받는 워커는 보내다 죽을 수 있습니다. 알림 워커가 받은 메시지를 이웃 한 명당 inbox 행 하나로 적고(유니크 키), 행을 리스로 가져가 보내면 중복과 유실을 어떻게 막는지 봅니다.</p>
<div class="scn">${Object.entries(SCENARIOS).map(([k, s]) => `<button data-scn-btn="${k}">${s.label}</button>`).join("")}</div>
<p class="scn-lead" data-scn-lead></p>
${controls([0.5, 1, 2], 1)}
<div class="figs">
${CARDS.map(card).join("\n")}
</div>
<ul class="legend">
<li><i style="background:var(--holdbg);border-color:var(--hold);border-radius:2px"></i>pending · 아직 아무도 안 가져감</li>
<li><i style="background:var(--runbg);border-color:var(--run);border-radius:2px"></i>processing · 워커가 가져가 보내는 중 (리스 30초)</li>
<li><i style="background:var(--conn);border-color:var(--conn);border-radius:2px"></i>completed · 받음</li>
<li><i style="background:var(--frame);border-color:var(--frame);border-radius:2px"></i>워커 2가 가져간 행</li>
<li><i style="background:var(--fail);border-color:var(--fail);border-radius:2px"></i>두 번 받음</li>
<li><i style="background:var(--failbg);border-color:var(--fail);border-radius:2px"></i>못 받음</li>
</ul>
<p class="cap">아래 숫자는 이웃 ${MEMBERS.toLocaleString()}명에게 보낸 실제 테스트(NotificationInboxExperimentTest, RabbitMQ·PostgreSQL Testcontainers) 결과이고, 그림의 단계 모델로 계산한 값과 같습니다. 같은 메시지 2번: inbox 가 없으면 이웃 모두가 두 번 받고, inbox 는 (event_id, user_id) 유니크 키와 ON CONFLICT DO NOTHING 으로 두 번째 메시지에서 새 행을 만들지 않습니다. 동시에 2번: 두 워커가 FOR UPDATE SKIP LOCKED 로 100명씩 번갈아 가져가 500 · 500 으로 나눠 보냈고 겹친 사람은 0명입니다. 보내다 죽음: 다 보낸 뒤 ack 하면 RabbitMQ 가 메시지를 바로 다시 주지만, 그때는 processing 행의 리스가 남아 있어 가져가지 못하고 ack 해 버려 50명이 못 받습니다. 행을 만든 직후 ack 하고 스케줄러를 두면 리스가 지난 뒤 다시 보내 못 받은 사람이 0명입니다. 대신 죽기 전에 보냈던 50명은 두 번 받는데, tag = event_id 라 알림창에는 하나만 남습니다. 스페이스로 재생/멈춤, ← →로 한 단계씩 옮깁니다.</p>
<script>${LIVE}${playerScript({ seconds: SECONDS, speed: 1, stillAt: SECONDS - 0.2, step: STAGE_SECONDS })}</script>`,
});
for (const [scn, { ways }] of Object.entries(SCENARIOS)) console.log(scn, Object.fromEntries(Object.entries(ways).map(([w, st]) => [w, outcome(st)])));
