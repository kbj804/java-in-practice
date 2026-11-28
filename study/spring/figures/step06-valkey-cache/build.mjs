// 6단계 그림: 이웃 앱 → API 서버(요청 · 캐시 리스너) → Valkey · PostgreSQL, 그리고 outbox → RabbitMQ → 캐시 리스너.
// 위는 부품과 단계마다 오간 요청(화살표 · 요청 기록), 가운데는 Valkey 키 세 개와 PostgreSQL 커넥션 풀,
// 그 아래는 이 방식이 쓰는 Valkey 명령(이번 단계에 쓴 줄을 칠함), 맨 아래는 시간축이다.
// 앞의 세 장면은 실험(FeedCacheExperimentTest) 숫자를 그대로 쓰고, 모델의 마지막 상태가 TEST 와 다르면 빌드가 멈춘다.
// node build.mjs → index.html, index-light.html  (?s=event, ?s=race, ?s=ttl 로 다른 장면을 연다)
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { controls, playerScript, writePages } from "../page.mjs";
import { FLOWS, NODES, SCENARIOS, STAGE_SECONDS, timeline } from "./model.mjs";

const dir = dirname(fileURLToPath(import.meta.url));

// ── 모델 검사 ──
for (const [scn, S] of Object.entries(SCENARIOS))
  for (const [way, w] of Object.entries(S.ways)) {
    const where = `${scn}/${way}`, states = timeline(w.stages), end = states.at(-1);
    for (const st of w.stages) {
      for (const fl of st.flows) if (!FLOWS[fl.id]) throw new Error(`${where}: unknown flow ${fl.id}`);
      for (const i of st.cmd ?? []) if (!w.cmds[i]?.[1]) throw new Error(`${where}: 없는 명령 줄 ${i}`);
      if (st.flows.length > 5) throw new Error(`${where}: 요청 기록은 5줄까지`);
    }
    w.stages.reduce((prev, st) => { if (st.t < prev) throw new Error(`${where}: 시각이 거꾸로 감`); return st.t; }, 0);
    for (const [lane, from, to] of w.segs) {
      if (!S.tl[lane]) throw new Error(`${where}: 시간축에 없는 줄 ${lane}`);
      if (from > to || to > S.axis.max) throw new Error(`${where}: 시간축 범위 밖 ${lane} ${from}~${to}`);
    }
    if (w.check.queries !== undefined && end.queries !== String(w.check.queries)) throw new Error(`${where}: DB ${end.queries} != 실험 ${w.check.queries}`);
    if (w.check.lastT !== undefined && w.stages.at(-1).t !== w.check.lastT) throw new Error(`${where}: 마지막 시각 ${w.stages.at(-1).t} != 실험 ${w.check.lastT}`);
    if (end.pool !== 0 || end.queue !== 0) throw new Error(`${where}: 끝났는데 커넥션을 쥐고 있음`);
  }

const maxStages = Math.max(...Object.values(SCENARIOS).flatMap((s) => Object.values(s.ways).map((w) => w.stages.length)));
const SECONDS = maxStages * STAGE_SECONDS + 0.4;

const clock = (unit, t) => unit === "ms" ? `${t.toLocaleString()}ms` : unit === "clock" ? `7:${String(t).padStart(2, "0")}` : "";

const CARDS = Object.entries(SCENARIOS).flatMap(([scn, s]) => Object.keys(s.ways).map((way) => ({ scn, way, id: `${scn}-${way}` })));
const DATA = {
  stageSeconds: STAGE_SECONDS, nodes: NODES, flows: FLOWS,
  scn: Object.fromEntries(Object.entries(SCENARIOS).map(([k, s]) => [k, { lead: s.lead }])),
  cards: Object.fromEntries(CARDS.map(({ scn, way, id }) => {
    const S = SCENARIOS[scn], w = S.ways[way], states = timeline(w.stages);
    return [id, {
      lanes: S.lanes, off: S.off ?? [], axis: S.axis, tl: Object.keys(S.tl), segs: w.segs, result: w.result,
      stages: w.stages.map((st, i) => ({ ...states[i], fresh: i === 0 ? [] : (states[i].feed ?? []).filter((v) => !(states[i - 1].feed ?? []).includes(v)), t: st.t, clock: clock(S.unit, st.t), title: st.title, flows: st.flows, cmd: st.cmd ?? [], note: st.note ?? null, focus: st.focus ?? [] })),
    }];
  })),
};

// ── 그림 좌표 ──
const LANE_Y = { l1: 55, l2: 95, l3: 135 };
const ROW_Y = { feed: 58, post: 98, lock: 138 };
const ARROWS = {
  "app:l1": { d: "M140 55 H178", cx: 159, cy: 55 }, "app:l2": { d: "M140 95 H178", cx: 159, cy: 95 },
  "l1:vk": { d: "M400 55 H468", cx: 434, cy: 55 }, "l2:vk": { d: "M400 95 H468", cx: 434, cy: 95 }, "l3:vk": { d: "M400 135 H468", cx: 434, cy: 135 },
  "l1:db": { d: "M215 165 V176 H560 V198", cx: 290, cy: 176 }, "l2:db": { d: "M255 165 V186 H640 V198", cx: 545, cy: 186 },
  "db:mq": { d: "M488 245 H457", cx: 472, cy: 245 }, "mq:l3": { d: "M385 198 V167", cx: 385, cy: 182 },
};
const TL = { x0: 120, x1: 960, rows: [447, 470, 493] };

function figureSvg({ scn, way, id: cid }) {
  const S = SCENARIOS[scn], w = S.ways[way], hasTl = !!S.axis;
  const H = hasTl ? 525 : 405;
  const off = (row) => ((S.off ?? []).includes(row) ? ' opacity=".45"' : "");
  const arrows = Object.entries(ARROWS).map(([id, a]) => `<path class="flow" data-flow="${id}" d="${a.d}" marker-end="url(#ah-idle-${cid})"/>`).join("");
  const labels = Object.entries(ARROWS).map(([id, a]) =>
    `<g class="fl" data-fl="${id}" data-cx="${a.cx}" data-cy="${a.cy}" visibility="hidden"><rect rx="6" height="14"/><text text-anchor="middle" x="${a.cx}" y="${a.cy + 3.5}"></text></g>`).join("");
  const lanes = Object.entries(LANE_Y).map(([l, y]) =>
    `<rect class="lane" data-lane="${l}" x="180" y="${y - 17}" width="220" height="34" rx="6"/><text class="t-mute" x="188" y="${y - 3}">${S.lanes[l]}</text><text class="t-tok" data-worker="${l}" x="188" y="${y + 11}"></text>`).join("");
  const cells = Array.from({ length: 6 }, (_, i) =>
    `<rect class="cell" data-cell="${i}" x="${636 + i * 32}" y="${ROW_Y.feed - 13}" width="28" height="19" rx="3"/><text class="t-cap inv" data-cellt="${i}" x="${650 + i * 32}" y="${ROW_Y.feed + 0.5}" text-anchor="middle"></text>`).join("");
  const slots = Array.from({ length: 10 }, (_, i) => `<rect class="slot2" data-slot="${i}" x="${570 + i * 19}" y="226" width="15" height="14" rx="2"/>`).join("");
  const cmdRows = w.cmds.map(([name, cmd], i) =>
    `<g class="sq" data-sq="${i}"><text class="t-mute" x="20" y="${359 + i * 15}">${name}</text><text class="t-code" x="128" y="${359 + i * 15}">${cmd.replace(/</g, "&lt;")}</text></g>`).join("");
  let tl = "";
  if (hasTl) {
    const X = (t) => TL.x0 + (t / S.axis.max) * (TL.x1 - TL.x0);
    const laneNames = Object.entries(S.tl).map(([, name], i) => `<text class="t-mute" x="20" y="${TL.rows[i] + 4}">${name}</text><line class="tl-base" x1="${TL.x0}" x2="${TL.x1}" y1="${TL.rows[i]}" y2="${TL.rows[i]}"/>`).join("");
    const ticks = S.axis.ticks.map((t) => `<line class="tl-base" x1="${X(t)}" x2="${X(t)}" y1="${TL.rows[Object.keys(S.tl).length - 1] + 9}" y2="${TL.rows[Object.keys(S.tl).length - 1] + 13}"/><text class="t-cap" x="${X(t)}" y="514" text-anchor="middle">${clock(S.unit, t)}</text>`).join("");
    tl = `<rect class="box" x="10" y="405" width="970" height="115" rx="8"/>
<text class="t-title" x="20" y="422">시간축</text><text class="t-tok k-run" data-now-t x="70" y="422"></text><text class="t-cap" x="960" y="422" text-anchor="end">굵은 막대 = 기다림 · 바쁨,  얇은 줄 = TTL,  색 띠 = 화면에 보인 값,  세로 눈금 = 지움 · 만료 · 받음</text>
${laneNames}${ticks}<g data-segs></g><line class="tl-cur" data-cursor y1="432" y2="503"/>`;
  }
  return `<svg viewBox="0 0 990 ${H}" role="img" aria-label="이웃 앱, API 서버, Valkey, PostgreSQL, RabbitMQ 사이에 오가는 요청${hasTl ? "과 시간축" : ""}">
<defs>${["idle", "run", "bad"].map((k) => `<marker id="ah-${k}-${cid}" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="${k === "idle" ? 7 : 9}" markerHeight="${k === "idle" ? 7 : 9}" orient="auto"><path class="ah-${k}" d="M0 0L8 4L0 8z"/></marker>`).join("")}</defs>
<rect class="box" data-box="app" x="10" y="30" width="130" height="130" rx="8"/>
<text class="t-title" x="20" y="50">이웃 앱</text><text class="t-mute" x="20" y="65">목록 · 글쓰기</text>
<text class="t-tok" data-app1 x="20" y="112"></text><text class="t-tok" data-app2 x="20" y="128"></text>
<rect class="box" data-box="api" x="170" y="10" width="240" height="155" rx="8"/>
<text class="t-title" x="180" y="27">API 서버 (Spring 앱)</text>
${lanes}
<rect class="box" data-box="vk" x="470" y="10" width="510" height="155" rx="8"/>
<text class="t-title" x="480" y="27">Valkey</text><text class="t-cap" x="970" y="27" text-anchor="end">키 · 값 · 만료</text>
<g${off("feed")}><text class="t-code" x="480" y="${ROW_Y.feed}">${S.keys.feed}</text><text class="t-cap" x="480" y="${ROW_Y.feed + 13}">Sorted Set · 글 ID 만 (최신 순)</text>
${cells}<text class="t-tok" data-feednone x="636" y="${ROW_Y.feed}"></text><text class="t-mute" data-feednote x="970" y="${ROW_Y.feed}" text-anchor="end"></text></g>
<line class="tl-base" x1="480" x2="970" y1="${ROW_Y.feed + 20}" y2="${ROW_Y.feed + 20}"/>
<text class="t-code" x="480" y="${ROW_Y.post}">${S.keys.post}</text><text class="t-cap" x="480" y="${ROW_Y.post + 13}">String · 글 요약 JSON</text>
<text class="t-tok" data-post x="636" y="${ROW_Y.post}"></text><text class="t-mute" data-postttl x="970" y="${ROW_Y.post}" text-anchor="end"></text>
<line class="tl-base" x1="480" x2="970" y1="${ROW_Y.post + 20}" y2="${ROW_Y.post + 20}"/>
<g${off("lock")}><text class="t-code" x="480" y="${ROW_Y.lock}">${S.keys.lock}</text><text class="t-cap" x="480" y="${ROW_Y.lock + 13}">String · 다시 만드는 사람 표시</text>
<text class="t-tok" data-lock x="636" y="${ROW_Y.lock}"></text><text class="t-mute" data-lockpx x="970" y="${ROW_Y.lock}" text-anchor="end"></text></g>
<rect class="box" data-box="log" x="10" y="200" width="325" height="115" rx="8"/>
<text class="t-title" x="20" y="218">이번 단계에 오간 요청</text><g data-log></g>
<rect class="box" data-box="mq" x="345" y="200" width="110" height="115" rx="8"/>
<text class="t-title" x="355" y="218">RabbitMQ</text><text class="t-cap" x="355" y="232">cache.post-events</text><text class="t-tok" data-mq x="355" y="270"></text>
<rect class="box" data-box="db" x="490" y="200" width="490" height="115" rx="8"/>
<text class="t-title" x="500" y="218">PostgreSQL</text><text class="t-mute" x="500" y="237">커넥션 풀</text>${slots}<text class="t-tok" data-pool x="770" y="237"></text>
<text class="t-big" data-q x="500" y="280"></text><text class="t-mute" x="500" y="298">${S.dbLabel}</text><text class="t-tok" data-dbnote x="640" y="280"></text>
<rect class="box" data-box="cmd" x="10" y="325" width="970" height="72" rx="8"/>
<text class="t-title" x="20" y="342">Valkey 명령</text><text class="t-cap" x="970" y="342" text-anchor="end">이번 단계에 쓴 명령은 파랗게</text>
${cmdRows}
${tl}
${arrows}
${labels}
</svg>`;
}

const card = (c) => {
  const w = SCENARIOS[c.scn].ways[c.way];
  return `<section class="card" data-card="${c.id}" data-scn="${c.scn}" hidden>
<div class="head"><b>${w.name}</b></div>
<div class="cls">${w.rule}</div>
<div class="scroll">${figureSvg(c)}</div>
<p class="now" data-now></p>
<ol class="steps" data-steps></ol>
<div class="stats">${w.result.map(([label], i) => `<div class="stat"><small>${label}</small><b data-stat="${i}">–</b></div>`).join("")}</div>
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
.t-code{font-family:ui-monospace,Menlo,monospace;font-size:9.5px;fill:var(--ink)}
.sq.on .t-code{fill:var(--run);font-weight:700}.sq.on .t-mute{fill:var(--run);font-weight:600}
.t-big{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.box.on{stroke:var(--run);stroke-width:2}
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
.cell{fill:var(--conn);stroke:var(--conn)}
.cell.new{fill:var(--run);stroke:var(--run)}
.slot2{fill:var(--card);stroke:var(--line)}
.slot2.busy{fill:var(--hold);stroke:var(--hold)}
.tl-base{stroke:var(--line);stroke-width:1}
.tl-cur{stroke:var(--run);stroke-width:1.4;stroke-dasharray:3 2}
.sg-lease{fill:var(--runbg);stroke:var(--run);stroke-width:.6}
.sg-send{fill:var(--run)}
.sg-hold{fill:var(--hold)}
.sg-fail{fill:var(--fail)}
.sg-ok{fill:var(--conn)}
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
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:6px 0 4px}
@media (max-width:700px){.stats{grid-template-columns:1fr}}
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
let scn = D.scn[params.get("s")] ? params.get("s") : "stampede";
const scnButtons = [...document.querySelectorAll("[data-scn-btn]")], scnLead = document.querySelector("[data-scn-lead]");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const boxOf = (node) => (node[0] === "l" ? "api" : node);
const kindOf = (v) => /기다|줄 섬|다시 읽기|멈춤|예약/.test(v) ? "hold" : /옛|두 번|실패/.test(v) ? "bad" : /^대기$|안 씀|^—$|^끝$/.test(v) ? "none" : "run";

const cards = Object.keys(D.cards).map((id) => {
  const root = document.querySelector('[data-card="' + id + '"]'), C = D.cards[id];
  const q = (s) => root.querySelector(s), qa = (s) => [...root.querySelectorAll(s)];
  const byData = (attr) => Object.fromEntries(qa("[data-" + attr + "]").map((e) => [e.getAttribute("data-" + attr), e]));
  const boxes = byData("box"), lanes = byData("lane"), arrows = byData("flow"), labels = byData("fl"), workers = byData("worker");
  const cells = byData("cell"), cellTs = byData("cellt"), slots = byData("slot"), sqs = byData("sq"), stats = byData("stat");
  const app1 = q("[data-app1]"), app2 = q("[data-app2]"), mq = q("[data-mq]"), pool = q("[data-pool]"), qn = q("[data-q]"), dbnote = q("[data-dbnote]");
  const feedNone = q("[data-feednone]"), feedNote = q("[data-feednote]"), post = q("[data-post]"), postTtl = q("[data-postttl]"), lock = q("[data-lock]"), lockPx = q("[data-lockpx]");
  const logG = q("[data-log]"), segG = q("[data-segs]"), cursor = q("[data-cursor]"), nowT = q("[data-now-t]");
  const now = q("[data-now]"), steps = q("[data-steps]");
  steps.innerHTML = C.stages.map((s) => "<li>" + esc(s.title) + "</li>").join("");
  const items = [...steps.children];
  const X = (t) => TL.x0 + (t / (C.axis ? C.axis.max : 1)) * (TL.x1 - TL.x0);
  const laneY = Object.fromEntries(C.tl.map((l, i) => [l, TL.rows[i]]));
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
      for (const [b, el] of Object.entries(boxes)) el.setAttribute("class", "box" + (hot.has(b) ? " on" : ""));
      tok(app1, s.app[0], "none"); tok(app2, s.app[1], s.app[2] || "none");
      for (const l of Object.keys(lanes)) {
        const v = s.workers[l], kind = kindOf(v);
        lanes[l].setAttribute("class", "lane" + (kind === "hold" && !hotLanes.has(l) ? " hold" : hotLanes.has(l) ? " on" : ""));
        tok(workers[l], v, kind);
      }
      tok(mq, s.mq, s.mq === "비어 있음" ? "none" : "run");
      // Valkey
      const feed = s.feed || [];
      for (let i = 0; i < 6; i++) {
        const v = feed[i];
        cells[i].setAttribute("visibility", v ? "visible" : "hidden"); cellTs[i].setAttribute("visibility", v ? "visible" : "hidden");
        cellTs[i].textContent = v ? "#" + v : "";
        cells[i].setAttribute("class", "cell" + (v && s.fresh.includes(v) ? " new" : ""));
      }
      tok(feedNone, s.feed ? "" : C.off.includes("feed") ? "이 장면에선 안 씀" : "키 없음", C.off.includes("feed") ? "none" : "bad");
      feedNote.textContent = s.feedNote;
      tok(post, s.post[0], s.post[1]); postTtl.textContent = s.postTtl;
      if (C.off.includes("lock")) tok(lock, "이 장면에선 안 씀", "none"); else tok(lock, s.lock[0], s.lock[1]);
      lockPx.textContent = s.lockPx;
      // PostgreSQL
      for (let i = 0; i < 10; i++) slots[i].setAttribute("class", "slot2" + (i < s.pool ? " busy" : ""));
      tok(pool, s.pool + "/10 사용" + (s.queue ? " · 줄 선 요청 " + s.queue : ""), s.queue ? "bad" : s.pool ? "hold" : "none");
      qn.textContent = s.queries + "번";
      tok(dbnote, s.dbNote, "none");
      for (const [i, g] of Object.entries(sqs)) g.setAttribute("class", "sq" + (s.cmd.includes(Number(i)) ? " on" : ""));
      // 시간축
      if (segG) {
        segG.innerHTML = C.segs.filter(([, from]) => from <= s.t).map(([lane, from, to, kind, label]) => {
          // 지금 시각까지만 그린다. 마지막 단계에서는 남은 띠(새 제목 등)까지 모두 그린다.
          const y = laneY[lane], x1 = X(from), x2 = X(k === n - 1 ? to : Math.min(to, s.t));
          const tick = from === to, thin = kind === "lease";
          const shape = tick ? '<rect class="sg-' + kind + '" x="' + (x1 - 1.5) + '" y="' + (y - 8) + '" width="3" height="16" rx="1"/>'
            : '<rect class="sg-' + kind + '" x="' + x1 + '" y="' + (y + (thin ? -2 : -6)) + '" width="' + Math.max(1, x2 - x1) + '" height="' + (thin ? 4 : 12) + '" rx="' + (thin ? 1.5 : 2.5) + '"/>';
          return shape + (label ? '<text class="t-cap" x="' + (x1 + 4) + '" y="' + (y - 9) + '">' + esc(label) + "</text>" : "");
        }).join("");
        cursor.setAttribute("x1", X(s.t)); cursor.setAttribute("x2", X(s.t));
        nowT.textContent = "지금 " + s.clock;
      }
      // 요청 기록
      const lines = s.flows.map((f, i) => {
        const [from, to] = D.flows[f.id], bad = f.kind === "bad";
        const name = (x) => C.lanes[x] || D.nodes[x];
        return '<text class="lg" x="20" y="' + (236 + i * 16) + '"><tspan class="lg-n' + (bad ? " bad" : "") + '">' + NUM[i] + '</tspan> <tspan class="lg-who">' + esc(name(from)) + " → " + esc(name(to)) + '</tspan>  <tspan class="lg-what' + (bad ? " bad" : "") + '">' + esc(f.text) + "</tspan></text>";
      });
      if (s.note) lines.push('<text class="lg" x="20" y="' + (236 + lines.length * 16) + '"><tspan class="lg-what">요청 없음 · ' + esc(s.note) + "</tspan></text>");
      logG.innerHTML = lines.join("");
      now.textContent = (k + 1) + ". " + (s.clock ? "[" + s.clock + "] " : "") + s.title;
      items.forEach((li, i) => li.className = i < k ? "done" : i === k ? "cur" : "");
    }
    if (done !== shownDone) {
      shownDone = done;
      C.result.forEach(([, value, kind], i) => { stats[i].textContent = done ? value : "–"; stats[i].className = done && kind ? "k-" + kind : ""; });
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

// ?check: 모든 장면 · 모든 단계를 그려 보며 글자가 상자 밖으로 나가거나 다른 글자와 겹치면 console.error 로 알린다.
if (params.has("check")) {
  let problems = 0;
  const inside = (r, x, y) => x >= r.x - 0.5 && x <= r.x + r.width + 0.5 && y >= r.y - 0.5 && y <= r.y + r.height + 0.5;
  for (const key of Object.keys(D.scn)) {
    scn = key; show();
    for (const c of cards.filter((c) => !c.root.hidden)) {
      const C = D.cards[c.root.dataset.card];
      for (let k = 0; k < C.stages.length; k++) {
        c.draw(k * D.stageSeconds + 0.01);
        const svg = c.root.querySelector("svg");
        const boxes = [...svg.querySelectorAll("rect.box, rect.lane")].map((e) => e.getBBox());
        const texts = [...svg.querySelectorAll("text")].filter((t) => t.textContent.trim() && t.closest("[visibility=hidden]") === null && t.getAttribute("visibility") !== "hidden").map((t) => ({ t, b: t.getBBox() }));
        const where = c.root.dataset.card + " 단계 " + (k + 1);
        for (const { t, b } of texts) {
          if (t.closest(".fl")) continue;
          const own = boxes.filter((r) => inside(r, b.x + 1, b.y + b.height / 2)).sort((p, q) => p.width * p.height - q.width * q.height)[0];
          // 상자 오른쪽 테두리 안쪽으로 4px 여백을 남겨야 한다. 테두리에 닿으면 넘친 것처럼 보인다.
          if (own && b.x + b.width > own.x + own.width - 4) { problems++; console.error("넘침", where, JSON.stringify(t.textContent)); }
        }
        // 화살표 이름표가 다른 글자를 가리면 안 된다
        const pills = [...svg.querySelectorAll(".fl")].filter((g) => g.getAttribute("visibility") !== "hidden").map((g) => ({ g, b: g.querySelector("rect").getBBox() }));
        for (const { g, b: p } of pills) for (const { t, b: q } of texts) {
          if (t.closest(".fl")) continue;
          if (p.x < q.x + q.width - 0.5 && q.x < p.x + p.width - 0.5 && p.y < q.y + q.height - 1 && q.y < p.y + p.height - 1) {
            problems++; console.error("가림", where, JSON.stringify(g.textContent), JSON.stringify(t.textContent));
          }
        }
        for (let i = 0; i < pills.length; i++) for (let j = i + 1; j < pills.length; j++) {
          const p = pills[i].b, q = pills[j].b;
          if (p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height) {
            problems++; console.error("이름표 겹침", where, JSON.stringify(pills[i].g.textContent), JSON.stringify(pills[j].g.textContent));
          }
        }
        for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
          const p = texts[i].b, q = texts[j].b;
          if (p.x < q.x + q.width - 0.5 && q.x < p.x + p.width - 0.5 && p.y < q.y + q.height - 1 && q.y < p.y + p.height - 1) {
            problems++; console.error("겹침", where, JSON.stringify(texts[i].t.textContent), JSON.stringify(texts[j].t.textContent));
          }
        }
      }
    }
  }
  console.warn("check done, problems: " + problems);
}
`;

writePages(dir, {
  title: "Valkey 캐시 설계",
  css,
  body: `<h1>Spring Fig 6 · 동네 목록 캐시: 몰린 요청, 이벤트로 고치기, 늦게 들어온 옛 값, 동시 만료</h1>
<p class="lead">동네 최신 글 목록을 Valkey 에 둡니다. 목록 키(region:{id}:latest)에는 글 ID 만, 제목은 글마다 post:{id} 에 둡니다. 위는 단계마다 누가 누구에게 요청을 보냈는지, 가운데는 Valkey 키 세 개와 PostgreSQL 커넥션 풀, 그 아래는 이 방식이 쓰는 Valkey 명령, 맨 아래는 시간축입니다.</p>
<div class="scn">${Object.entries(SCENARIOS).map(([k, s]) => `<button data-scn-btn="${k}">${s.label}</button>`).join("")}</div>
<p class="scn-lead" data-scn-lead></p>
${controls([0.5, 1, 2], 1)}
<div class="figs">
${CARDS.map(card).join("\n")}
</div>
<ul class="legend">
<li><i style="background:var(--runbg);border-color:var(--run);border-radius:2px"></i>파란 화살표 · 이번 단계에 오간 요청</li>
<li><i style="background:var(--failbg);border-color:var(--fail);border-radius:2px"></i>빨간 화살표 · 같은 일을 여러 번, 옛 값을 넣음</li>
<li><i style="background:var(--conn);border-color:var(--conn);border-radius:2px"></i>목록 칸 · 들어 있는 글 ID</li>
<li><i style="background:var(--run);border-color:var(--run);border-radius:2px"></i>목록 칸 · 이번 단계에 새로 들어온 글</li>
<li><i style="background:var(--hold);border-color:var(--hold);border-radius:2px"></i>커넥션 칸 · 쓰는 중</li>
</ul>
<p class="cap">앞의 세 장면은 실제 테스트(FeedCacheExperimentTest, PostgreSQL · RabbitMQ · Valkey Testcontainers) 결과이고, 그림의 단계 모델로 계산한 마지막 상태와 같습니다. 동시에 몰린 150명: 목록 키가 빈 순간 락 없이 cache-aside 로 읽으면 150명이 모두 DB 로 가서 커넥션 10개 앞에 줄을 서고(목록 쿼리 150번, 가장 늦은 응답 ${SCENARIOS.stampede.ways.before.check.lastT}ms), SET NX PX 락으로 한 명만 다시 만들게 하면 목록 쿼리는 1번입니다. 이벤트로 고치기: 새 글은 ZADD, 제목 수정은 DEL post:{id}, 블라인드는 ZREM 으로 고쳐서 목록을 DB 로 다시 만들 일이 없고, 같은 이벤트가 두 번 와도 Sorted Set 이라 한 번만 들어갑니다. 늦게 들어온 옛 값: DB 를 읽고 멈춘 요청이 삭제 뒤에 옛 제목을 넣으면, 한 번만 지우는 방식은 TTL 이 지울 때까지 옛 제목이 남고, 1초 뒤 한 번 더 지우면 1초 안에 사라집니다. TTL 동시 만료는 실험이 아니라 계산입니다. 스페이스로 재생/멈춤, ← →로 한 단계씩 옮깁니다.</p>
<script>${LIVE}${playerScript({ seconds: SECONDS, speed: 1, stillAt: SECONDS - 0.2, step: STAGE_SECONDS })}</script>`,
});
console.log("ok", CARDS.length, "cards,", maxStages, "stages max");
