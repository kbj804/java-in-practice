// 5단계 그림: 4단계 inbox 구조(릴레이 → RabbitMQ → 알림 워커 → PostgreSQL · FCM → 이웃) 위에 재시도 규칙을 얹은 설계를 네 장면으로 비교한다.
// 위는 부품과 단계마다 오간 요청(화살표 · 요청 기록), 가운데는 inbox 행 10개와 돋보기로 본 행 하나의 컬럼,
// 아래는 시간축(누가 언제 행을 쥐었나 · 보냈나 · 멈췄나)이다.
// 실험 코드가 없는 설계 단계라, 모델 결과가 노트 06 의 표(EXPECT)와 같은지만 빌드에서 확인한다.
// node build.mjs → index.html, index-light.html  (?s=outage, ?s=fence, ?s=late 로 다른 장면을 연다)
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { controls, playerScript, writePages } from "../page.mjs";
import { FLOWS, NEIGHBORS, NODES, SCENARIOS, STAGE_SECONDS, outcome, timeline } from "./model.mjs";

const dir = dirname(fileURLToPath(import.meta.url));

for (const [scn, s] of Object.entries(SCENARIOS))
  for (const [way, w] of Object.entries(s.ways)) {
    const got = JSON.stringify(outcome(w.stages)), want = JSON.stringify(w.expect);
    if (got !== want) throw new Error(`${scn}/${way}: model ${got} != expect ${want}`);
    for (const st of w.stages) for (const fl of st.flows) if (!FLOWS[fl.id]) throw new Error(`unknown flow ${fl.id}`);
    w.stages.reduce((prev, st) => { if (st.t < prev) throw new Error(`${scn}/${way}: 시각이 거꾸로 감`); return st.t; }, 0);
  }

const maxStages = Math.max(...Object.values(SCENARIOS).flatMap((s) => Object.values(s.ways).map((w) => w.stages.length)));
const SECONDS = maxStages * STAGE_SECONDS + 0.4;

const clock = (unit, t) => unit === "clock" ? `${String(9 + Math.floor(t / 60)).padStart(2, "0")}:${String(Math.round(t % 60)).padStart(2, "0")}` : `${t}초`;

const CARDS = Object.entries(SCENARIOS).flatMap(([scn, s]) => Object.keys(s.ways).map((way) => ({ scn, way, id: `${scn}-${way}` })));
const DATA = {
  stageSeconds: STAGE_SECONDS, nodes: NODES, flows: FLOWS,
  scn: Object.fromEntries(Object.entries(SCENARIOS).map(([k, s]) => [k, { lead: s.lead }])),
  cards: Object.fromEntries(CARDS.map(({ scn, way, id }) => {
    const S = SCENARIOS[scn], w = S.ways[way], states = timeline(w.stages);
    return [id, {
      max: S.axis.max, lanes: Object.keys(S.lanes), segs: w.segs,
      stages: w.stages.map((st, i) => ({ ...states[i], t: st.t, clock: clock(S.unit, st.t), title: st.title, flows: st.flows, note: st.note ?? null, focus: st.focus ?? [] })),
      outcome: outcome(w.stages),
    }];
  })),
};

// ── 그림 좌표(viewBox 990 × 440) ──
const LANE_Y = { w1: 60, sw: 112 };
const ARROWS = {
  pub: { d: "M130 90 H168", cx: 149, cy: 90 },
  "deliver:w1": { d: "M310 55 H368", cx: 339, cy: 55 }, "ack:w1": { d: "M370 65 H312", cx: 341, cy: 65 },
  "push:w1": { d: "M600 60 H648", cx: 624, cy: 60 }, "push:sw": { d: "M600 112 H648", cx: 624, cy: 112 },
  "db:w1": { d: "M430 170 V218", cx: 430, cy: 196 }, "db:sw": { d: "M540 170 V218", cx: 540, cy: 196 },
  fcm: { d: "M760 95 H798", cx: 779, cy: 95 },
};
const TL = { x0: 110, x1: 960, rows: [362, 386, 410] };

function figureSvg({ scn, id: cid }) {
  const S = SCENARIOS[scn];
  const arrows = Object.entries(ARROWS).map(([id, a]) => `<path class="flow" data-flow="${id}" d="${a.d}" marker-end="url(#ah-idle-${cid})"/>`).join("");
  const labels = Object.entries(ARROWS).map(([id, a]) =>
    `<g class="fl" data-fl="${id}" data-cx="${a.cx}" data-cy="${a.cy}" visibility="hidden"><rect rx="6" height="14"/><text text-anchor="middle" x="${a.cx}" y="${a.cy + 3.5}"></text></g>`).join("");
  const lanes = Object.entries(LANE_Y).map(([w, y]) =>
    `<rect class="lane" data-lane="${w}" x="380" y="${y - 20}" width="210" height="40" rx="6"/><text class="t-mute" x="388" y="${y - 4}">${NODES[w]}</text><text class="t-tok" data-worker="${w}" x="388" y="${y + 11}"></text>`).join("");
  const phones = Array.from({ length: NEIGHBORS }, (_, i) => {
    const x = 812 + (i % 5) * 33, y = 48 + Math.floor(i / 5) * 50;
    return `<g data-phone="${i}"><rect class="phone" x="${x}" y="${y}" width="26" height="40" rx="5"/><text class="t-cap" x="${x + 13}" y="${y + 11}" text-anchor="middle">#${i + 1}</text><text class="t-tok ph-n" x="${x + 13}" y="${y + 29}" text-anchor="middle"></text></g>`;
  }).join("");
  const strip = Array.from({ length: NEIGHBORS }, (_, i) =>
    `<rect class="cell${i + 1 === S.focus ? " focus" : ""}" data-cell="${i}" x="${380 + i * 30}" y="248" width="26" height="26" rx="3"/><text class="t-cap" x="${393 + i * 30}" y="265" text-anchor="middle" data-cellt="${i}">#${i + 1}</text>`).join("");
  const kv = [["state", "state"], ["attempts", "attempts"], ["next_attempt_at", "next"], ["occurred_at", "occurred"]]
    .map(([label, key], i) => `<text class="t-mute" x="696" y="${256 + i * 15}">${label}</text><text class="t-tok" data-kv="${key}" x="800" y="${256 + i * 15}"></text>`).join("");
  const laneNames = Object.entries(S.lanes).map(([k, name], i) => `<text class="t-mute" x="20" y="${TL.rows[i] + 4}">${name}</text><line class="tl-base" x1="${TL.x0}" x2="${TL.x1}" y1="${TL.rows[i]}" y2="${TL.rows[i]}"/>`).join("");
  const X = (t) => TL.x0 + (t / S.axis.max) * (TL.x1 - TL.x0);
  const ticks = S.axis.ticks.map((t) => `<line class="tl-base" x1="${X(t)}" x2="${X(t)}" y1="416" y2="420"/><text class="t-cap" x="${X(t)}" y="431" text-anchor="middle">${clock(S.unit, t)}</text>`).join("");
  return `<svg viewBox="0 0 990 440" role="img" aria-label="OutboxRelay, RabbitMQ, 알림 워커, PostgreSQL, FCM, 이웃 휴대폰 사이에 오가는 요청과 시간축">
<defs>${["idle", "run", "bad"].map((k) => `<marker id="ah-${k}-${cid}" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="${k === "idle" ? 7 : 9}" markerHeight="${k === "idle" ? 7 : 9}" orient="auto"><path class="ah-${k}" d="M0 0L8 4L0 8z"/></marker>`).join("")}</defs>
<rect class="box" data-box="relay" x="10" y="50" width="120" height="80" rx="8"/>
<text class="t-title" x="20" y="70">OutboxRelay</text><text class="t-mute" x="20" y="85">outbox → 발행</text><text class="t-tok" data-relay x="20" y="112"></text>
<rect class="box" data-box="mq" x="170" y="30" width="140" height="120" rx="8"/>
<text class="t-title" x="180" y="50">RabbitMQ</text><text class="t-cap" x="180" y="64">notification.post-created</text><text class="t-tok" data-mq x="180" y="100"></text>
<rect class="box" data-box="app" x="370" y="20" width="230" height="150" rx="8"/>
<text class="t-title" x="380" y="35">알림 워커 (Spring 앱)</text>
${lanes}
<text class="t-cap" x="380" y="160">스케줄러는 5초마다 claim</text>
<rect class="box" data-box="fcm" x="650" y="30" width="110" height="130" rx="8"/>
<text class="t-title" x="660" y="50">FCM</text><text class="t-tok" data-fcmst x="660" y="70"></text>
<text class="t-big" data-calls x="660" y="110"></text><text class="t-mute" x="660" y="126">요청 (실패 포함)</text>
<rect class="box" data-box="phones" x="800" y="20" width="180" height="150" rx="8"/>
<text class="t-title" x="810" y="37">이웃 10명</text>${phones}<text class="t-tok" data-stale x="810" y="160"></text>
<text class="t-cap" x="434" y="182">리스너 1</text><text class="t-cap" x="544" y="182">스케줄러</text>
<rect class="box" data-box="log" x="10" y="185" width="352" height="130" rx="8"/>
<text class="t-title" x="20" y="204">이번 단계에 오간 요청</text><g data-log></g>
<rect class="box" data-box="db" x="370" y="220" width="610" height="95" rx="8"/>
<text class="t-title" x="380" y="238">PostgreSQL</text><text class="t-mute" x="452" y="238">notification_delivery · 행 10개</text>
${strip}
<text class="t-cap" x="380" y="292">p 가능 · w 대기 · r/s 보내는 중 · c 끝 · f 포기 · x 버림</text>
<line class="tl-base" x1="684" x2="684" y1="228" y2="306"/><text class="t-title" x="696" y="240">행 #${S.focus} 돋보기</text>
${kv}
<rect class="box" x="10" y="325" width="970" height="110" rx="8"/>
<text class="t-title" x="20" y="343">시간축</text><text class="t-tok k-run" data-now-t x="70" y="343"></text><text class="t-cap" x="960" y="343" text-anchor="end">굵은 막대 = 보냄 · 멈춤 · 장애,  아래 얇은 줄 = 리스 (행을 쥐고 있는 시간),  세로 눈금 = 실패 ┃ 성공</text>
${laneNames}${ticks}
<g data-segs></g><line class="tl-cur" data-cursor y1="350" y2="418"/>
${arrows}
${labels}
</svg>`;
}

const stat = (key, label) => `<div class="stat"><small>${label}</small><b data-stat="${key}">–</b></div>`;
const card = (c) => {
  const w = SCENARIOS[c.scn].ways[c.way];
  return `<section class="card" data-card="${c.id}" data-scn="${c.scn}" hidden>
<div class="head"><b>${w.name}</b></div>
<div class="cls">${w.rule}</div>
<div class="scroll">${figureSvg(c)}</div>
<p class="now" data-now></p>
<ol class="steps" data-steps></ol>
<div class="stats">${stat("calls", "FCM 요청")}${stat("reached", "받은 이웃")}${stat("dup", "두 번 받음")}${stat("missed", "못 받음")}${stat("expired", "버림 (expired)")}${stat("stale", "늦게 받음")}</div>
</section>`;
};

const css = `
.figs{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
.scroll svg{min-width:780px}
.cls{color:var(--mute);font-size:12px;font-family:ui-monospace,Menlo,monospace;margin:2px 0 6px;overflow-wrap:anywhere}
.scn{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 4px}
.scn button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:6px 14px;cursor:pointer}
.scn button[aria-pressed="true"]{border-color:var(--ink);font-weight:600}
.scn-lead{color:var(--mute);font-size:14px;margin:4px 0 0}
.t-cap{fill:var(--mute);font-size:9px}
.t-cap.inv{fill:var(--card);font-weight:700}
.t-big{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.box.on{stroke:var(--run);stroke-width:2}
.box.down{fill:var(--failbg);stroke:var(--fail);stroke-width:2}
.box.slow{fill:var(--holdbg);stroke:var(--hold);stroke-width:2}
.lane{fill:var(--card);stroke:var(--line)}
.lane.on{stroke:var(--run);stroke-width:1.8}
.lane.hold{stroke:var(--hold);stroke-dasharray:3 2}
.t-tok.k-ok{fill:var(--conn)}.t-tok.k-bad{fill:var(--fail)}.t-tok.k-hold{fill:var(--hold)}.t-tok.k-run{fill:var(--run)}.t-tok.k-none{fill:var(--mute);font-weight:400}
.flow{fill:none;stroke:var(--line);stroke-width:1.3}
.flow.on{stroke:var(--run);stroke-width:2.4;stroke-dasharray:6 4;animation:flow .6s linear infinite}
.flow.bad{stroke:var(--fail);stroke-width:2.4;stroke-dasharray:6 4;animation:flow .6s linear infinite}
@media (prefers-reduced-motion:reduce){.flow.on,.flow.bad{animation:none}}
.ah-idle{fill:var(--line)}.ah-run{fill:var(--run)}.ah-bad{fill:var(--fail)}
.fl rect{fill:var(--card);stroke:var(--run);stroke-width:1.2}
.fl text{font-size:9.5px;font-weight:700;fill:var(--run)}
.fl.bad rect{stroke:var(--fail);fill:var(--failbg)}.fl.bad text{fill:var(--fail)}
.phone{fill:var(--card);stroke:var(--line)}
.phone.g1{fill:var(--connbg);stroke:var(--conn)}
.phone.g2{fill:var(--failbg);stroke:var(--fail);stroke-width:1.6}
.phone.stale{fill:var(--holdbg);stroke:var(--hold);stroke-width:1.6}
.phone.lost{stroke:var(--fail);stroke-width:1.6;stroke-dasharray:3 2}
.phone.gone{fill:var(--box);stroke:var(--mute);stroke-dasharray:2 2}
.ph-n.k-ok{fill:var(--conn)}
.cell{fill:var(--card);stroke:var(--line)}
.cell.focus{stroke-width:2.2}
.cell.c-p{fill:var(--holdbg);stroke:var(--hold)}
.cell.c-w{fill:var(--card);stroke:var(--hold);stroke-dasharray:3 2}
.cell.c-r{fill:var(--run);stroke:var(--run);fill-opacity:.35}
.cell.c-s{fill:var(--frame);stroke:var(--frame);fill-opacity:.55}
.cell.c-c{fill:var(--conn);stroke:var(--conn)}
.cell.c-f{fill:var(--fail);stroke:var(--fail)}
.cell.c-x{fill:var(--box);stroke:var(--mute);stroke-dasharray:2 2}
.cell.focus{stroke:var(--ink)}
.tl-base{stroke:var(--line);stroke-width:1}
.tl-cur{stroke:var(--run);stroke-width:1.4;stroke-dasharray:3 2}
.sg-lease{fill:var(--runbg);stroke:var(--run);stroke-width:.6}
.sg-send{fill:var(--run)}
.sg-slow{fill:var(--hold)}
.sg-fail{fill:var(--fail)}
.sg-ok{fill:var(--conn)}
.sg-gc{fill:var(--box);stroke:var(--mute);stroke-dasharray:3 2}
.sg-down{fill:var(--failbg);stroke:var(--fail);stroke-width:.8}
.sg-valid{fill:var(--connbg);stroke:var(--conn);stroke-width:.8}
.sg-wrong{fill:var(--holdbg);stroke:var(--hold);stroke-width:.8;stroke-dasharray:3 2}
.lg{font-size:10.5px}
.lg-n{font-weight:700;fill:var(--run)}.lg-n.bad{fill:var(--fail)}
.lg-who{font-weight:700}.lg-what{fill:var(--mute)}.lg-what.bad{fill:var(--fail);font-weight:600}
.now{min-height:1.6em;font-weight:600;margin:8px 0 4px!important}
.steps{margin:0 0 8px;padding-left:22px;font-size:12.5px;color:var(--mute);columns:2;column-gap:28px}
@media (max-width:820px){.steps{columns:1}}
.steps li{margin:1px 0;break-inside:avoid}.steps li.done{color:var(--ink)}.steps li.cur{color:var(--run);font-weight:600}
.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin:6px 0 4px}
@media (max-width:700px){.stats{grid-template-columns:repeat(3,1fr)}}
.stat{border:1px solid var(--line);border-radius:8px;padding:4px 8px}
.stat small{display:block;color:var(--mute);font-size:11.5px}
.stat b{font-variant-numeric:tabular-nums;font-size:15px}
.stat b.k-ok{color:var(--conn)}.stat b.k-bad{color:var(--fail)}.stat b.k-hold{color:var(--hold)}
`;

const LIVE = `
const D = ${JSON.stringify(DATA)};
const TL = ${JSON.stringify(TL)};
const NUM = "①②③④⑤⑥";
const params = new URLSearchParams(location.search);
let scn = D.scn[params.get("s")] ? params.get("s") : "slow";
const scnButtons = [...document.querySelectorAll("[data-scn-btn]")], scnLead = document.querySelector("[data-scn-lead]");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const boxOf = (node) => (node === "w1" || node === "sw" ? "app" : node);
const kindOf = (v) => /멈춤|대기 \\d|195초까지/.test(v) ? "hold" : /실패|덮어씀|포기|버림|죽음/.test(v) ? "bad" : /^대기$|확인|없음|^끝/.test(v) ? "none" : "run";

const cards = Object.keys(D.cards).map((id) => {
  const root = document.querySelector('[data-card="' + id + '"]'), C = D.cards[id];
  const q = (s) => root.querySelector(s), qa = (s) => [...root.querySelectorAll(s)];
  const byData = (attr) => Object.fromEntries(qa("[data-" + attr + "]").map((e) => [e.getAttribute("data-" + attr), e]));
  const boxes = byData("box"), lanes = byData("lane"), arrows = byData("flow"), labels = byData("fl"), workers = byData("worker");
  const phones = byData("phone"), cells = byData("cell"), cellTs = byData("cellt"), kv = byData("kv"), stats = byData("stat");
  const relay = q("[data-relay]"), mq = q("[data-mq]"), fcmst = q("[data-fcmst]"), calls = q("[data-calls]"), stale = q("[data-stale]");
  const logG = q("[data-log]"), segG = q("[data-segs]"), cursor = q("[data-cursor]"), nowT = q("[data-now-t]");
  const now = q("[data-now]"), steps = q("[data-steps]");
  steps.innerHTML = C.stages.map((s) => "<li>" + esc(s.title) + "</li>").join("");
  const items = [...steps.children];
  const X = (t) => TL.x0 + (t / C.max) * (TL.x1 - TL.x0);
  const laneY = Object.fromEntries(C.lanes.map((l, i) => [l, TL.rows[i]]));
  let shownK = -1, shownDone = null;
  function tok(el, label, kind) { el.textContent = label; el.setAttribute("class", "t-tok k-" + kind); }
  function draw(t) {
    const n = C.stages.length, k = Math.min(n - 1, Math.floor(t / D.stageSeconds)), s = C.stages[k];
    const done = t >= (n - 1) * D.stageSeconds + 0.3;
    if (k !== shownK) {
      shownK = k;
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
      const hot = new Set(s.focus);
      for (const f of s.flows) for (const node of D.flows[f.id]) hot.add(boxOf(node));
      const hotLanes = new Set(s.flows.flatMap((f) => D.flows[f.id]).filter((x) => lanes[x]));
      const [fcmText, fcmKind] = s.fcm;
      for (const [b, el] of Object.entries(boxes)) el.setAttribute("class", "box" + (b === "fcm" && fcmKind === "down" ? " down" : b === "fcm" && fcmKind === "slow" ? " slow" : hot.has(b) ? " on" : ""));
      tok(relay, s.relay, s.relay === "죽음" ? "bad" : s.relay === "대기" ? "none" : "run");
      tok(mq, s.mq, s.mq === "비어 있음" ? "none" : "run");
      tok(fcmst, fcmText, fcmKind === "ok" ? "ok" : fcmKind === "slow" ? "hold" : "bad");
      calls.textContent = s.calls + "건";
      for (const w of Object.keys(lanes)) {
        const v = s.workers[w], kind = kindOf(v);
        lanes[w].setAttribute("class", "lane" + (kind === "hold" ? " hold" : hotLanes.has(w) ? " on" : ""));
        tok(workers[w], v, kind);
      }
      // 이웃 휴대폰
      const last = k === n - 1;
      for (let i = 0; i < 10; i++) {
        const c = Number(s.recv[i]), g = phones[i], rect = g.querySelector("rect"), num = g.querySelector(".ph-n");
        const gone = s.strip[i] === "x", lost = last && c === 0 && !gone;
        rect.setAttribute("class", "phone" + (c >= 2 ? " g2" : c === 1 ? (s.stale ? " stale" : " g1") : gone ? " gone" : lost ? " lost" : ""));
        num.textContent = c ? String(c) : gone ? "버림" : lost ? "✕" : "";
        num.setAttribute("class", "t-tok ph-n k-" + (c >= 2 || lost ? "bad" : c === 1 ? (s.stale ? "hold" : "ok") : "none"));
      }
      tok(stale, s.stale ? "1시간 늦은 \\"새 글\\"" : "", "hold");
      // inbox 행
      for (let i = 0; i < 10; i++) {
        cells[i].setAttribute("class", "cell" + (s.strip[i] !== "." ? " c-" + s.strip[i] : "") + (cells[i].classList.contains("focus") ? " focus" : ""));
        cellTs[i].setAttribute("class", "t-cap" + ("cf".includes(s.strip[i]) ? " inv" : ""));
      }
      const r = s.row;
      tok(kv.state, r ? r.state : "행 없음", !r ? "none" : r.state === "completed" ? "ok" : /failed|expired/.test(r.state) ? "bad" : r.state === "processing" ? "run" : "hold");
      tok(kv.attempts, r ? String(r.attempts) : "", "run");
      tok(kv.next, r ? r.next : "", "run");
      tok(kv.occurred, r ? r.occurred : "", "none");
      // 시간축
      segG.innerHTML = C.segs.filter(([, from]) => from <= s.t).map(([lane, from, to, kind, label]) => {
        const y = laneY[lane], x1 = X(from), x2 = X(Math.min(to, kind === "valid" || kind === "wrong" ? to : s.t, C.max));
        const tick = from === to, thin = kind === "lease";
        const shape = tick ? '<rect class="sg-' + kind + '" x="' + (x1 - 1.5) + '" y="' + (y - 8) + '" width="3" height="16" rx="1"/>'
          : '<rect class="sg-' + kind + '" x="' + x1 + '" y="' + (y + (thin ? 7 : -6)) + '" width="' + Math.max(1, x2 - x1) + '" height="' + (thin ? 3.5 : 12) + '" rx="' + (thin ? 1.5 : 2.5) + '"/>';
        return shape + (label && !thin ? '<text class="t-cap" x="' + (tick ? x1 + 4 : x1 + 2) + '" y="' + (y - 9) + '">' + esc(label) + "</text>" : "");
      }).join("");
      cursor.setAttribute("x1", X(s.t)); cursor.setAttribute("x2", X(s.t));
      nowT.textContent = "지금 " + s.clock;
      // 요청 기록
      const lines = s.flows.map((f, i) => {
        const [from, to] = D.flows[f.id], bad = f.kind === "bad";
        return '<text class="lg" x="20" y="' + (224 + i * 17) + '"><tspan class="lg-n' + (bad ? " bad" : "") + '">' + NUM[i] + '</tspan> <tspan class="lg-who">' + esc(D.nodes[from]) + " → " + esc(D.nodes[to]) + '</tspan>  <tspan class="lg-what' + (bad ? " bad" : "") + '">' + esc(f.text) + "</tspan></text>";
      });
      if (s.note) lines.push('<text class="lg" x="20" y="' + (224 + lines.length * 17) + '"><tspan class="lg-what">요청 없음 · ' + esc(s.note) + "</tspan></text>");
      logG.innerHTML = lines.join("");
      now.textContent = (k + 1) + ". [" + s.clock + "] " + s.title;
      items.forEach((li, i) => li.className = i < k ? "done" : i === k ? "cur" : "");
    }
    if (done !== shownDone) {
      shownDone = done;
      const o = C.outcome;
      for (const key of Object.keys(stats)) {
        stats[key].textContent = done ? o[key].toLocaleString() : "–";
        const bad = ["dup", "missed", "stale"].includes(key), hold = key === "expired";
        stats[key].className = !done ? "" : bad ? (o[key] > 0 ? "k-bad" : "k-ok") : hold && o[key] > 0 ? "k-hold" : "";
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
  title: "재시도와 리스",
  css,
  body: `<h1>Spring Fig 5 · 느린 FCM, 장애, 늦게 돌아온 워커, 너무 늦은 알림</h1>
<p class="lead">4단계 inbox 의 리스 · 스케줄러 위에 재시도 규칙을 얹습니다: 리스 &gt; 묶음 × 호출 타임아웃, 지수 백오프와 상한, next_attempt_at 한 컬럼, 펜싱 토큰(attempts), 발생 시각 기준 만료. 위는 단계마다 누가 누구에게 요청을 보냈는지, 가운데는 inbox 행 10개와 행 하나의 컬럼, 아래는 시간축입니다.</p>
<div class="scn">${Object.entries(SCENARIOS).map(([k, s]) => `<button data-scn-btn="${k}">${s.label}</button>`).join("")}</div>
<p class="scn-lead" data-scn-lead></p>
${controls([0.5, 1, 2], 1)}
<div class="figs">
${CARDS.map(card).join("\n")}
</div>
<ul class="legend">
<li><i style="background:var(--runbg);border-color:var(--run);border-radius:2px"></i>파란 화살표 · 이번 단계에 오간 요청</li>
<li><i style="background:var(--failbg);border-color:var(--fail);border-radius:2px"></i>빨간 화살표 · 실패, 중복, 남의 행을 덮어씀</li>
<li><i style="background:var(--holdbg);border-color:var(--hold);border-radius:2px"></i>p · 지금 가져갈 수 있음</li>
<li><i style="background:var(--card);border-color:var(--hold);border-style:dashed;border-radius:2px"></i>w · next_attempt_at 까지 대기</li>
<li><i style="background:color-mix(in srgb,var(--run) 35%,transparent);border-color:var(--run);border-radius:2px"></i>r · 리스너 1이 쥠</li>
<li><i style="background:color-mix(in srgb,var(--frame) 55%,transparent);border-color:var(--frame);border-radius:2px"></i>s · 스케줄러가 쥠</li>
<li><i style="background:var(--conn);border-color:var(--conn);border-radius:2px"></i>c · completed</li>
<li><i style="background:var(--fail);border-color:var(--fail);border-radius:2px"></i>f · failed (포기)</li>
<li><i style="background:var(--box);border-color:var(--mute);border-style:dashed;border-radius:2px"></i>x · expired (만료로 버림)</li>
</ul>
<p class="cap">이 단계는 실험 코드 없이 설계만 정리했습니다. 시각표는 그림 위 규칙(리스 30초, 호출 타임아웃 2.9초, 백오프 5 · 10 · 20 · 40초 최대 60초, 스케줄러 5초 주기, 알림 유효 10분)으로 손으로 따라간 것이고, 아래 숫자는 그 시각표의 마지막 상태로 계산했습니다. FCM 한 건이 멈춤: 호출 타임아웃이 없으면 한 건이 묶음 전체의 리스를 잡아먹어 스케줄러가 같은 10행을 또 보냅니다. FCM 3분 장애: 백오프 없이 5초마다 다시 보내면 20초 만에 상한에 닿아 포기하고, 지수 백오프는 장애가 끝난 뒤 15초 만에 보냅니다. 늦게 돌아온 워커: DB 잠금은 claim 커밋과 함께 풀리므로, 펜싱 없이 WHERE id = ? 로 쓰면 리스가 끝난 워커가 남의 행을 덮어씁니다. 너무 늦은 알림: 만료 기준을 inbox 행을 만든 시각으로 잡으면 릴레이가 1시간 밀렸을 때 늦은 알림이 그대로 나갑니다. 타임아웃으로 끊은 호출은 FCM 이 실제로 보냈는지 알 수 없어, 다시 보내면 두 번 갈 수 있습니다(tag = event_id 로 알림창에서는 하나). 스페이스로 재생/멈춤, ← →로 한 단계씩 옮깁니다.</p>
<script>${LIVE}${playerScript({ seconds: SECONDS, speed: 1, stillAt: SECONDS - 0.2, step: STAGE_SECONDS })}</script>`,
});
for (const [scn, s] of Object.entries(SCENARIOS)) console.log(scn, Object.fromEntries(Object.entries(s.ways).map(([w, x]) => [w, outcome(x.stages)])));
