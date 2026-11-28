// 4단계 그림: "새 글" 메시지 하나가 릴레이 → RabbitMQ → 알림 워커 → PostgreSQL · FCM → 이웃 휴대폰으로 가는 구조를 위에서 본 그림.
// 단계마다 어느 부품이 어느 부품에게 무엇을 보냈는지 화살표로 켜고, 아래 "이번 단계에 오간 요청"에 출발 → 도착을 글로 적는다.
// 서버가 죽는 단계는 워커 상자와 그때 보내던 화살표가 빨갛게 바뀐다.
// 단계와 결과는 모두 model.mjs 에서 나온다. 모델 결과가 테스트 출력(TEST)과 다르면 빌드가 멈춘다.
// node build.mjs → index.html, index-light.html  (?s=concurrent, ?s=crash 로 다른 장면을 열 수 있다)
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { controls, playerScript, writePages } from "../page.mjs";
import { FLOWS, MEMBERS, NODES, SCENARIOS, STAGE_SECONDS, TEST, WAYS, outcome, received, timeline } from "./model.mjs";

const dir = dirname(fileURLToPath(import.meta.url));

// 모델이 테스트를 재현하는지 확인
for (const [scn, { ways }] of Object.entries(SCENARIOS))
  for (const [way, stages] of Object.entries(ways)) {
    const got = JSON.stringify(outcome(stages)), want = JSON.stringify(TEST[scn][way]);
    if (got !== want) throw new Error(`${scn}/${way}: model ${got} != test ${want}`);
    for (const st of stages) for (const fl of st.flows) if (!FLOWS[fl.id]) throw new Error(`unknown flow ${fl.id}`);
  }

const maxStages = Math.max(...Object.values(SCENARIOS).flatMap((s) => Object.values(s.ways).map((st) => st.length)));
const SECONDS = maxStages * STAGE_SECONDS + 0.4;

// 이웃 휴대폰 격자는 한 칸 = 10명. 모델의 범위가 모두 10명 단위라 한 칸 안은 같은 값이다.
const GROUP = 10;
function groups(state) {
  const counts = received(state), out = [];
  for (let g = 0; g < MEMBERS / GROUP; g++) {
    const slice = counts.slice(g * GROUP, (g + 1) * GROUP);
    if (new Set(slice).size !== 1) throw new Error("칸 하나 안에서 받은 수가 다름");
    out.push(slice[0]);
  }
  return out.join("");
}

const CARDS = Object.entries(SCENARIOS).flatMap(([scn, s]) => Object.keys(s.ways).map((way) => ({ scn, way, id: `${scn}-${way}` })));
const DATA = {
  stageSeconds: STAGE_SECONDS, members: MEMBERS, group: GROUP, nodes: NODES, flows: FLOWS,
  scn: Object.fromEntries(Object.entries(SCENARIOS).map(([k, s]) => [k, { label: s.label, lead: s.lead, ways: Object.keys(s.ways) }])),
  cards: Object.fromEntries(CARDS.map(({ scn, way, id }) => {
    const stages = SCENARIOS[scn].ways[way], states = timeline(stages);
    return [id, {
      inbox: way !== "naive",
      stages: stages.map((st, i) => {
        const s = states[i];
        return {
          title: st.title, flows: st.flows, note: st.note ?? null, focus: st.focus ?? [],
          relay: s.relay, queue: s.queue, app: s.app, workers: s.workers, sweeper: s.sweeper,
          rows: s.rows, lease: s.lease, lost: s.lost, tag: s.tag, recv: groups(s),
        };
      }),
      outcome: outcome(stages),
    }];
  })),
};

// ── 그림 좌표(viewBox 990 × 426) ──
//  OutboxRelay → RabbitMQ ⇄ 알림 워커(리스너 1 · 리스너 2 · 스케줄러) → FCM → 이웃 휴대폰
//                           ↓
//                       PostgreSQL notification_delivery
const LANES = { w1: 68, w2: 110, sw: 152 };           // 워커 안 줄의 가운데 y
const DBX = { w1: 490, w2: 550, sw: 610 };            // 워커 → PostgreSQL 화살표 x
const ARROWS = {
  pub: { d: "M140 100 H186", cx: 163, cy: 100 },
  "deliver:w1": { d: "M378 63 H438", cx: 409, cy: 63 }, "ack:w1": { d: "M440 73 H380", cx: 409, cy: 73 },
  "deliver:w2": { d: "M378 105 H438", cx: 409, cy: 105 }, "ack:w2": { d: "M440 115 H380", cx: 409, cy: 115 },
  ...Object.fromEntries(Object.entries(LANES).map(([w, y]) => [`push:${w}`, { d: `M660 ${y} H718`, cx: 689, cy: y }])),
  ...Object.fromEntries(Object.entries(DBX).map(([w, x]) => [`db:${w}`, { d: `M${x} 180 V238`, cx: x, cy: 216 }])),
  fcm: { d: "M820 105 H868", cx: 844, cy: 105 },
};
const LANE_NAME = { w1: "리스너 1", w2: "리스너 2", sw: "스케줄러" };

// 그림 아래 "PostgreSQL 쿼리" 상자: [이름, 조건, 칠할 때 쓰는 단어]. step04 코드(NotificationDelivery.kt)와 같은 조건이다.
const INSERT_Q = ["넣기 · 리스너가 메시지를 받으면", "INSERT … SELECT 동네 이웃 FROM region_member   ON CONFLICT (event_id, user_id) DO NOTHING", "INSERT"];
const CLAIM_Q = (who) => [`가져가기 · ${who}`, "WHERE state = 'pending' OR (state = 'processing' AND claimed_at &lt; now − 30초)   ORDER BY id LIMIT 100   FOR UPDATE SKIP LOCKED", "claim"];
const SET_Q = ["가져가며 바꾸는 값", "SET state = 'processing', claimed_at = now   (리스 30초는 이 시각부터)", "claim"];
const DONE_Q = ["끝내기 · 보낸 뒤", "SET state = 'completed'   WHERE id IN (내가 가져간 행) AND state = 'processing'", "완료"];
const SQL = {
  naive: [["읽기 · 리스너가 메시지를 받으면", "SELECT user_id FROM region_member WHERE region_id = ?   → 이웃마다 바로 FCM", "읽기"],
    ["inbox 표 없음", "넣기 · 가져가기 · 끝내기 쿼리가 없다. 같은 메시지가 두 번 오면 두 번 보낸다", "-"]],
  inbox: [INSERT_Q, CLAIM_Q("리스너들과 스케줄러가 같은 쿼리"), SET_Q, DONE_Q],
  late: [INSERT_Q, CLAIM_Q("리스너만 (스케줄러 없음)"), SET_Q, DONE_Q],
  early: [INSERT_Q, CLAIM_Q("리스너와 스케줄러가 같은 쿼리"), SET_Q, DONE_Q],
};

function figureSvg({ way, id: cid }) {
  const inbox = way !== "naive";
  const sqlRows = SQL[way].map(([name, cond, key], i) =>
    `<g class="sq" data-sq="${key}"><text class="t-mute" x="20" y="${368 + i * 15}">${name}</text><text class="t-code" x="218" y="${368 + i * 15}">${cond}</text></g>`).join("");
  const arrows = Object.entries(ARROWS).map(([id, a]) => `<path class="flow" data-flow="${id}" d="${a.d}" marker-end="url(#ah-idle-${cid})"${!inbox && id.startsWith("db:") ? ' opacity=".4"' : ""}/>`).join("");
  const labels = Object.entries(ARROWS).map(([id, a]) =>
    `<g class="fl" data-fl="${id}" data-cx="${a.cx}" data-cy="${a.cy}" visibility="hidden"><rect rx="6" height="14"/><text text-anchor="middle" x="${a.cx}" y="${a.cy + 3.5}"></text></g>`).join("");
  const lanes = Object.entries(LANES).map(([w, y]) =>
    `<rect class="lane" data-lane="${w}" x="450" y="${y - 18}" width="200" height="36" rx="6"/><text class="t-mute" x="458" y="${y - 3}">${LANE_NAME[w]}</text><text class="t-tok" data-worker="${w}" x="458" y="${y + 11}"></text>`).join("");
  const dbCaps = Object.entries(DBX).map(([w, x]) => `<text class="t-cap" x="${x + 4}" y="192">${LANE_NAME[w]}</text>`).join("");
  const grid = Array.from({ length: MEMBERS / GROUP }, (_, i) =>
    `<rect class="cell" x="${880 + (i % 10) * 9.2}" y="${62 + Math.floor(i / 10) * 9.2}" width="7.6" height="7.6" rx="1.2"/>`).join("");
  return `<svg viewBox="0 0 990 426" role="img" aria-label="OutboxRelay, RabbitMQ, 알림 워커, PostgreSQL, FCM, 이웃 휴대폰 사이에 오가는 요청을 위에서 본 그림">
<defs>${["idle", "run", "bad"].map((k) => `<marker id="ah-${k}-${cid}" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="${k === "idle" ? 7 : 9}" markerHeight="${k === "idle" ? 7 : 9}" orient="auto"><path class="ah-${k}" d="M0 0L8 4L0 8z"/></marker>`).join("")}</defs>
<rect class="box" data-box="relay" x="10" y="56" width="130" height="88" rx="8"/>
<text class="t-title" x="20" y="76">OutboxRelay</text><text class="t-mute" x="20" y="92">글 쓴 쪽 · step03</text><text class="t-tok" data-relay x="20" y="124"></text>
<rect class="box" data-box="mq" x="188" y="20" width="190" height="160" rx="8"/>
<text class="t-title" x="198" y="40">RabbitMQ</text><text class="t-mute" x="198" y="55">exchange community.events</text>
<rect class="slot" x="198" y="64" width="170" height="106" rx="6"/><text class="t-mute" x="206" y="80">queue notification.post-created</text>
<g data-queue></g>
<rect class="box" data-box="app" x="440" y="20" width="220" height="160" rx="8"/>
<text class="t-title" x="450" y="40">알림 워커 (Spring 앱)</text><text class="t-tok" data-app x="650" y="40" text-anchor="end"></text>
${lanes}
${dbCaps}
<g${inbox ? "" : ' opacity=".4"'}><rect class="box" data-box="db" x="420" y="240" width="270" height="85" rx="8"/>
<text class="t-title" x="430" y="258">PostgreSQL</text><text class="t-mute" x="502" y="258">${inbox ? "notification_delivery" : "inbox 표 없음 (안 씀)"}</text>
<rect class="slot" x="430" y="266" width="250" height="14" rx="3"/><g data-bar></g>
<text class="t-mute" data-dbcount x="430" y="296"></text><text class="t-tok" data-lease x="430" y="314"></text></g>
<rect class="box" data-box="fcm" x="720" y="40" width="100" height="130" rx="8"/>
<text class="t-title" x="730" y="60">FCM</text><text class="t-mute" x="730" y="75">푸시 서버</text>
<text class="t-big" data-fcm x="730" y="104"></text><text class="t-mute" x="730" y="120">누적 푸시</text>
<rect class="box" data-box="phones" x="870" y="20" width="112" height="305" rx="8"/>
<text class="t-title" x="880" y="40">이웃 1,000명</text><text class="t-mute" x="880" y="54">칸 하나 = 10명</text>
<g data-grid>${grid}</g>
<text class="t-tok" data-pc="got" x="880" y="174"></text><text class="t-tok" data-pc="dup" x="880" y="190"></text><text class="t-tok" data-pc="none" x="880" y="206"></text>
<text class="t-mute" x="880" y="230">한 사람의 알림창</text><g data-tray></g>
<rect class="box" data-box="log" x="10" y="200" width="368" height="125" rx="8"/>
<text class="t-title" x="20" y="220">이번 단계에 오간 요청</text><g data-log></g>
<rect class="box" data-box="sql" x="10" y="334" width="972" height="86" rx="8"/>
<text class="t-title" x="20" y="351">PostgreSQL 쿼리</text><text class="t-cap" x="972" y="351" text-anchor="end">이번 단계에 쓴 쿼리는 파랗게</text>
${sqlRows}
${arrows}
${labels}
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
.figs{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
.scroll svg{min-width:780px}
.cls{color:var(--mute);font-size:12px;font-family:ui-monospace,Menlo,monospace;margin:2px 0 6px;overflow-wrap:anywhere}
.scn{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 4px}
.scn button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:6px 14px;cursor:pointer}
.scn button[aria-pressed="true"]{border-color:var(--ink);font-weight:600}
.scn-lead{color:var(--mute);font-size:14px;margin:4px 0 0}
.t-cap{fill:var(--mute);font-size:9px}
.t-code{font-family:ui-monospace,Menlo,monospace;font-size:9.5px;fill:var(--ink)}
.sq.on .t-code{fill:var(--run);font-weight:700}.sq.on .t-mute{fill:var(--run);font-weight:600}
.t-big{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.box.on{stroke:var(--run);stroke-width:2}
.box.down{fill:var(--failbg);stroke:var(--fail);stroke-width:2}
.lane{fill:var(--card);stroke:var(--line)}
.lane.on{stroke:var(--run);stroke-width:1.8}
.lane.dead{stroke:var(--fail);stroke-dasharray:3 2}
.lane.off{opacity:.45}
.t-tok.k-ok{fill:var(--conn)}.t-tok.k-bad{fill:var(--fail)}.t-tok.k-hold{fill:var(--hold)}.t-tok.k-run{fill:var(--run)}.t-tok.k-none{fill:var(--mute);font-weight:400}
.chip{fill:var(--card);stroke:var(--line)}
.chip.k-run{fill:var(--runbg);stroke:var(--run);stroke-dasharray:3 2}
.chip.k-ok{fill:var(--connbg);stroke:var(--conn);opacity:.55}
.chip.k-hold{fill:var(--holdbg);stroke:var(--hold)}
.chip.k-bad{fill:var(--failbg);stroke:var(--fail)}
.flow{fill:none;stroke:var(--line);stroke-width:1.3}
.flow.on{stroke:var(--run);stroke-width:2.4;stroke-dasharray:6 4;animation:flow .6s linear infinite}
.flow.bad{stroke:var(--fail);stroke-width:2.4;stroke-dasharray:6 4;animation:flow .6s linear infinite}
@media (prefers-reduced-motion:reduce){.flow.on,.flow.bad{animation:none}}
.ah-idle{fill:var(--line)}.ah-run{fill:var(--run)}.ah-bad{fill:var(--fail)}
.fl rect{fill:var(--card);stroke:var(--run);stroke-width:1.2}
.fl text{font-size:9.5px;font-weight:700;fill:var(--run)}
.fl.bad rect{stroke:var(--fail);fill:var(--failbg)}.fl.bad text{fill:var(--fail)}
.cell{fill:var(--card);stroke:var(--line);stroke-width:.6}
.cell.c-pend{fill:var(--holdbg);stroke:var(--hold)}
.cell.c-proc{fill:var(--runbg);stroke:var(--run)}
.cell.c-proc2{fill:var(--framebg);stroke:var(--frame)}
.cell.c-done{fill:var(--conn);stroke:var(--conn)}
.cell.c-done2{fill:var(--frame);stroke:var(--frame)}
.cell.c-dup{fill:var(--fail);stroke:var(--fail)}
.cell.c-lost{fill:var(--failbg);stroke:var(--fail);stroke-width:1.4}
.note{fill:var(--card);stroke:var(--line)}
.lg-n{font-weight:700;fill:var(--run)}.lg-n.bad{fill:var(--fail)}
.lg-who{font-weight:700}.lg-what{fill:var(--mute)}.lg-what.bad{fill:var(--fail);font-weight:600}
.lg{font-size:10.5px}
.now{min-height:1.6em;font-weight:600;margin:8px 0 4px!important}
.steps{margin:0 0 8px;padding-left:22px;font-size:12.5px;color:var(--mute);columns:2;column-gap:28px}
@media (max-width:820px){.steps{columns:1}}
.steps li{margin:1px 0;break-inside:avoid}.steps li.done{color:var(--ink)}.steps li.cur{color:var(--run);font-weight:600}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:6px 0 4px}
.stat{border:1px solid var(--line);border-radius:8px;padding:4px 8px}
.stat small{display:block;color:var(--mute);font-size:11.5px}
.stat b{font-variant-numeric:tabular-nums;font-size:15px}
.stat b.k-ok{color:var(--conn)}.stat b.k-bad{color:var(--fail)}
`;

const LIVE = `
const D = ${JSON.stringify(DATA)};
const Q = { ready: ["대기", "hold"], unacked: ["받음 · ack 전", "run"], acked: ["ack ✓ 지움", "ok"], requeued: ["다시 ready", "bad"] };
const NUM = "①②③④⑤⑥";
const params = new URLSearchParams(location.search);
let scn = D.scn[params.get("s")] ? params.get("s") : "dup";
const scnButtons = [...document.querySelectorAll("[data-scn-btn]")], scnLead = document.querySelector("[data-scn-lead]");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const boxOf = (node) => (node === "w1" || node === "w2" || node === "sw" ? "app" : node);

const cards = Object.keys(D.cards).map((id) => {
  const root = document.querySelector('[data-card="' + id + '"]'), C = D.cards[id];
  const q = (s) => root.querySelector(s), qa = (s) => [...root.querySelectorAll(s)];
  const byData = (attr) => Object.fromEntries(qa("[data-" + attr + "]").map((e) => [e.getAttribute("data-" + attr), e]));
  const cellEls = qa("[data-grid] rect"), boxes = byData("box"), lanes = byData("lane"), arrows = byData("flow"), labels = byData("fl");
  const workers = byData("worker"), pcs = byData("pc"), stats = byData("stat");
  const queueG = q("[data-queue]"), barG = q("[data-bar]"), logG = q("[data-log]"), trayG = q("[data-tray]");
  const relay = q("[data-relay]"), app = q("[data-app]"), fcm = q("[data-fcm]"), dbcount = q("[data-dbcount]"), lease = q("[data-lease]");
  const now = q("[data-now]"), steps = q("[data-steps]");
  steps.innerHTML = C.stages.map((s) => "<li>" + esc(s.title) + "</li>").join("");
  const items = [...steps.children];
  let shownK = -1, shownDone = null;
  function tok(el, label, kind) { el.textContent = label; el.setAttribute("class", "t-tok k-" + kind); }
  function draw(t) {
    const n = C.stages.length, k = Math.min(n - 1, Math.floor(t / D.stageSeconds)), s = C.stages[k];
    const done = t >= (n - 1) * D.stageSeconds + 0.3;
    if (k !== shownK) {
      shownK = k;
      // 화살표와 그 위 짧은 글
      const on = Object.fromEntries(s.flows.map((f) => [f.id, f]));
      for (const [fid, a] of Object.entries(arrows)) {
        const kind = on[fid] ? (on[fid].kind === "bad" ? "bad" : "run") : "idle";
        a.setAttribute("class", "flow" + (kind === "idle" ? "" : kind === "bad" ? " bad" : " on"));
        a.setAttribute("marker-end", "url(#ah-" + kind + "-" + id + ")");
      }
      for (const [fid, g] of Object.entries(labels)) {
        const f = on[fid];
        if (!f) { g.setAttribute("visibility", "hidden"); continue; }
        g.setAttribute("visibility", "visible"); g.setAttribute("class", "fl" + (f.kind === "bad" ? " bad" : ""));
        const txt = g.querySelector("text"), r = g.querySelector("rect");
        txt.textContent = f.label;
        const w = txt.getComputedTextLength() + 10, cx = Number(g.dataset.cx), cy = Number(g.dataset.cy);
        r.setAttribute("x", cx - w / 2); r.setAttribute("y", cy - 7); r.setAttribute("width", w);
      }
      // 상자 강조: 요청을 보낸 쪽과 받은 쪽
      // 이번 단계에 PostgreSQL 로 간 요청이 어느 쿼리인지 칠한다
      const dbTexts = s.flows.filter((f) => f.id.startsWith("db:")).map((f) => f.label + " " + f.text).join(" ");
      for (const g of qa("[data-sq]")) { const key = g.dataset.sq; g.setAttribute("class", "sq" + (key.length > 1 && dbTexts.includes(key) ? " on" : "")); }
      const hot = new Set(s.focus);
      for (const f of s.flows) for (const node of D.flows[f.id]) hot.add(boxOf(node));
      const hotLanes = new Set(s.flows.flatMap((f) => D.flows[f.id]).filter((x) => lanes[x]));
      for (const [b, el] of Object.entries(boxes)) el.setAttribute("class", "box" + (b === "app" && s.app === "down" ? " down" : hot.has(b) ? " on" : ""));
      // 릴레이 · 큐
      tok(relay, s.relay, s.relay === "대기" ? "none" : "run");
      queueG.innerHTML = s.queue.map((m, i) => {
        const [label, kind] = Q[m.st], x = 206 + i * 82;
        return '<rect class="chip k-' + kind + '" x="' + x + '" y="92" width="74" height="40" rx="6"/><text class="t-mute" x="' + (x + 7) + '" y="107">' + m.id + (i ? " (두 번째)" : "") + '</text><text class="t-tok k-' + kind + '" x="' + (x + 7) + '" y="123">' + label + "</text>";
      }).join("") || '<text class="t-mute" x="206" y="112">비어 있음</text>';
      // 워커 앱과 줄
      tok(app, s.app === "down" ? "서버 죽음 ×" : s.app === "restart" ? "다시 뜸" : "실행 중", s.app === "down" ? "bad" : s.app === "restart" ? "run" : "none");
      for (const w of Object.keys(lanes)) {
        const v = w === "sw" ? s.sweeper : s.workers[w];
        const off = v === null || v === undefined, dead = v === "죽음";
        lanes[w].setAttribute("class", "lane" + (off ? " off" : dead ? " dead" : hotLanes.has(w) ? " on" : ""));
        tok(workers[w], off ? (w === "sw" ? "없음 (이 방식엔 없음)" : "이 장면에선 안 씀") : dead ? "죽음 ×" : v, off ? "none" : dead ? "bad" : /대기|확인/.test(v) ? "none" : "run");
      }
      // PostgreSQL inbox 표
      const tally = { pending: 0, processing: 0, completed: 0 };
      barG.innerHTML = s.rows.map(([from, to, st, by]) => {
        tally[st] += to - from;
        const cls = st === "pending" ? "c-pend" : st === "processing" ? (by === "w2" ? "c-proc2" : "c-proc") : by === "w2" ? "c-done2" : "c-done";
        return '<rect class="cell ' + cls + '" x="' + (430 + from / 4) + '" y="266" width="' + (to - from) / 4 + '" height="14"/>';
      }).join("");
      dbcount.textContent = C.inbox ? "pending " + tally.pending + " · processing " + tally.processing + " · completed " + tally.completed : "받은 메시지를 적어 두지 않는다";
      if (s.lease === null) tok(lease, "", "none");
      else if (s.lease > 0) tok(lease, "리스 " + s.lease + "초 남음 · 아무도 못 가져감", "run");
      else tok(lease, "리스 끝남 · " + (s.sweeper ? "스케줄러가 가져감" : "가져갈 주체 없음"), s.sweeper ? "ok" : "bad");
      // FCM · 이웃 휴대폰
      let pushes = 0, got = 0, dup = 0, none = 0;
      for (let i = 0; i < cellEls.length; i++) {
        const c = Number(s.recv[i]);
        pushes += c * D.group; if (c >= 1) got += D.group; if (c >= 2) dup += D.group; if (c === 0) none += D.group;
        cellEls[i].setAttribute("class", "cell" + (c >= 2 ? " c-dup" : c === 1 ? " c-done" : s.lost ? " c-lost" : ""));
      }
      fcm.textContent = pushes.toLocaleString() + "건";
      tok(pcs.got, "받음 " + got.toLocaleString() + "명", got ? "ok" : "none");
      tok(pcs.dup, "두 번 받음 " + dup.toLocaleString() + "명", dup ? "bad" : "none");
      tok(pcs.none, (s.lost ? "못 받음 " : "아직 안 받음 ") + none.toLocaleString() + "명", s.lost && none ? "bad" : "none");
      const maxGot = Math.max(0, ...[...s.recv].map(Number));
      const pills = maxGot === 0 ? [] : maxGot === 1 || s.tag ? ["새 글 알림"] : ["새 글 알림", "새 글 알림"];
      trayG.innerHTML = (pills.map((p, i) => '<rect class="chip ' + (i ? "k-bad" : "") + '" x="880" y="' + (238 + i * 26) + '" width="92" height="22" rx="5"/><text class="t-mute" x="887" y="' + (253 + i * 26) + '">' + p + "</text>").join("")
        || '<text class="t-mute" x="880" y="254">알림 없음</text>')
        + (maxGot >= 2 ? '<text class="t-tok k-' + (s.tag ? "ok" : "bad") + '" x="880" y="' + (s.tag ? 278 : 306) + '">' + (s.tag ? "같은 tag → 덮어씀" : "tag 없음 → 2개") + "</text>" : "");
      // 이번 단계에 오간 요청
      const lines = s.flows.map((f, i) => {
        const [from, to] = D.flows[f.id], bad = f.kind === "bad";
        return '<text class="lg" x="20" y="' + (242 + i * 17) + '"><tspan class="lg-n' + (bad ? " bad" : "") + '">' + NUM[i] + '</tspan> <tspan class="lg-who">' + esc(D.nodes[from]) + " → " + esc(D.nodes[to]) + '</tspan>  <tspan class="lg-what' + (bad ? " bad" : "") + '">' + esc(f.text) + "</tspan></text>";
      });
      if (s.note) lines.push('<text class="lg" x="20" y="' + (242 + lines.length * 17) + '"><tspan class="lg-what">요청 없음 · ' + esc(s.note) + "</tspan></text>");
      logG.innerHTML = lines.join("");
      now.textContent = (k + 1) + ". " + s.title;
      items.forEach((li, i) => li.className = i < k ? "done" : i === k ? "cur" : "");
    }
    if (done !== shownDone) {
      shownDone = done;
      const o = C.outcome;
      for (const key of Object.keys(stats)) {
        stats[key].textContent = done ? o[key].toLocaleString() : "–";
        const watch = key === "missed" || key === "trayDuplicates";
        stats[key].className = done && watch ? (o[key] > 0 ? "k-bad" : "k-ok") : "";
      }
    }
  }
  return { root, draw, reset() { shownK = -1; shownDone = null; } };
});

window.draw = (t) => cards.forEach((c) => { if (!c.root.hidden) c.draw(t); });
function show() {
  scnButtons.forEach((b) => b.setAttribute("aria-pressed", b.dataset.scnBtn === scn));
  scnLead.textContent = D.scn[scn].lead;
  cards.forEach((c) => { c.root.hidden = c.root.dataset.scn !== scn; c.reset(); });
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
<p class="lead">글이 생기면 릴레이가 RabbitMQ 로 메시지를 보내고, 알림 워커가 받아 이웃 1,000명에게 FCM 푸시를 보냅니다. outbox 는 "적어도 한 번" 보내서 같은 메시지가 두 번 올 수 있고, 워커는 보내다 죽을 수 있습니다. 단계마다 어느 부품이 어디로 요청을 보냈는지 파란 화살표로, 죽은 곳은 빨간색으로 봅니다.</p>
<div class="scn">${Object.entries(SCENARIOS).map(([k, s]) => `<button data-scn-btn="${k}">${s.label}</button>`).join("")}</div>
<p class="scn-lead" data-scn-lead></p>
${controls([0.5, 1, 2], 1)}
<div class="figs">
${CARDS.map(card).join("\n")}
</div>
<ul class="legend">
<li><i style="background:var(--runbg);border-color:var(--run);border-radius:2px"></i>파란 화살표 · 이번 단계에 오간 요청</li>
<li><i style="background:var(--failbg);border-color:var(--fail);border-radius:2px"></i>빨간 화살표·상자 · 보내다 죽음, 잘못 보냄</li>
<li><i style="background:var(--holdbg);border-color:var(--hold);border-radius:2px"></i>pending · 아직 아무도 안 가져감</li>
<li><i style="background:var(--runbg);border-color:var(--run);border-radius:2px"></i>processing · 가져가 보내는 중 (리스 30초)</li>
<li><i style="background:var(--conn);border-color:var(--conn);border-radius:2px"></i>completed · 받음</li>
<li><i style="background:var(--frame);border-color:var(--frame);border-radius:2px"></i>리스너 2 가 처리</li>
<li><i style="background:var(--fail);border-color:var(--fail);border-radius:2px"></i>두 번 받음</li>
<li><i style="background:var(--failbg);border-color:var(--fail);border-radius:2px"></i>못 받음</li>
</ul>
<p class="cap">아래 숫자는 이웃 ${MEMBERS.toLocaleString()}명에게 보낸 실제 테스트(NotificationInboxExperimentTest, RabbitMQ·PostgreSQL Testcontainers) 결과이고, 그림의 단계 모델로 계산한 값과 같습니다. 같은 메시지 2번: inbox 가 없으면 이웃 모두가 두 번 받고, inbox 는 (event_id, user_id) 유니크 키와 ON CONFLICT DO NOTHING 으로 두 번째 메시지에서 새 행을 만들지 않습니다. 동시에 2번: 두 리스너가 FOR UPDATE SKIP LOCKED 로 100행씩 번갈아 가져가 500 · 500 으로 나눠 보냈고 겹친 사람은 0명입니다. 보내다 죽음: 다 보낸 뒤 ack 하면 RabbitMQ 가 메시지를 바로 다시 주지만, 그때는 processing 행의 리스가 남아 있어 가져가지 못하고 ack 해 버려 50명이 못 받습니다(테스트에서는 서버 죽음을 예외 + nack 으로 흉내 냅니다). 행을 만든 직후 ack 하고 스케줄러를 두면 리스가 지난 뒤 다시 보내 못 받은 사람이 0명입니다. 대신 죽기 전에 보냈던 50명은 두 번 받는데, tag = event_id 라 알림창에는 하나만 남습니다. 스페이스로 재생/멈춤, ← →로 한 단계씩 옮깁니다.</p>
<script>${LIVE}${playerScript({ seconds: SECONDS, speed: 1, stillAt: SECONDS - 0.2, step: STAGE_SECONDS })}</script>`,
});
for (const [scn, { ways }] of Object.entries(SCENARIOS)) console.log(scn, Object.fromEntries(Object.entries(ways).map(([w, st]) => [w, outcome(st)])));
