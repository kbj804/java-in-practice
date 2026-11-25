import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeParts } from "./parts.mjs";
import * as M from "./model.mjs";
import { legendHtml, LEGEND_CSS } from "../legend.mjs";
import { tagsSvg, TAG_CSS, NOW } from "./labels.mjs";

// Anatomy 스킬의 kit 을 쓴다: ANATOMY_HOME 이 없으면 ~/.claude/skills/anatomy.
const SKILL = process.env.ANATOMY_HOME || join(homedir(), ".claude/skills/anatomy");
const k = await import(pathToFileURL(join(SKILL, "kit/iso-kit.mjs")).href);
const { kitScript } = await import(pathToFileURL(join(SKILL, "scripts/inline-kit.mjs")).href);

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 660;
const HEIGHT = 400;

const PLATE = { x: -206, y: -80, w: 384, d: 136, r: 10 };
const PLATE_H = 10;
const FOOT_H = 5;
const COLUMN_TOP = 44;
const DRUM = { x: 162, y: 38, r: 8.5, h: 22 };

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-190, -68, COLUMN_TOP], [13, -68, COLUMN_TOP], [DRUM.x, DRUM.y, DRUM.h + 2]],
  WIDTH,
  HEIGHT,
  { pad: 32, azimuth: 70, elevation: 40 },
);
const parts = makeParts(k, P, M);
const { LANES, LANE_X, LANE_W, LANE_Y, LANE_D, LANE_TOP, TRAY_TOP, HEAP, HEAP_TOP, RACK, RACK_TOP, SOCKET_Y } = M;

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const slab = (plan, z, h, style = {}, steps = 3, bevel = 0) => S(k.slabOf(plan, z, h, P, steps, bevel), style);
const cyl = (x, y, r, z, h, style = {}, steps = 24, bevel = 0) => S(k.cylinder(x, y, r, z, h, P, steps, bevel), style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const screws = (points, z, size = 0.45) => D(points.map(([x, y]) => at([x, y, z])), { size });
const group = (attrs, body) => `<g ${Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(" ")}>${body}</g>`;

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
    out.push(cyl(x, y, 7, -PLATE_H - FOOT_H, 1.6, { tone: "lo" }, 28));
    out.push(cyl(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, { tone: "mid" }, 28));
  }
  out.push(slab(PLATE, -PLATE_H, PLATE_H, { tone: "mid" }, 8, 1.6));
  const inner = k.insetPlan(PLATE, 5);
  out.push(L(k.planOutline(inner, 0, P), { tone: "lo" }));
  const corners = k.corners(PLATE, 10);
  out.push(L(corners.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(screws(corners, 0, 0.5));
  // 가운데 칸막이: 왼쪽은 플랫폼 스레드 풀, 오른쪽은 가상 스레드.
  const rail = { x: -98, y: inner.y + 4, w: 3, d: inner.d - 8, r: 0.8 };
  out.push(slab(rail, 0, 2.4, { tone: "mid" }, 3, 0.3));
  out.push(screws([[rail.x + 1.5, rail.y + 2.5], [rail.x + 1.5, rail.y + rail.d - 2.5]], 2.4, 0.4));
  return out.join("");
}

// 레인 묶음 받침: 왼쪽은 고정 스레드 풀, 오른쪽은 캐리어 스레드 풀(ForkJoinPool).
function poolBase(side) {
  const x0 = LANE_X[side][0] - 4;
  const plan = { x: x0, y: -71, w: LANES * 23 + 3, d: 63, r: 2.4 };
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(plan, 0, 0.1, P)}" style="filter:blur(3px)"/>`);
  out.push(slab(plan, 0, 2, { tone: "mid" }, 4, 0.4));
  out.push(screws(k.corners(plan, 2), 2));
  if (side === "R") {
    // ForkJoinPool 받침 앞 띠: 일꾼 수만큼 표시창, 켜진 창 = 일하는 캐리어.
    const strip = { x: plan.x + 6, y: plan.y + plan.d - 4, w: plan.w - 12, d: 2.4, r: 0.6 };
    out.push(slab(strip, 2, 0.5, { tone: "lo", crease: "none" }, 2));
  }
  return out.join("");
}

// 스택 예약 기둥: 플랫폼 스레드마다 OS 가 미리 잡아 두는 스택(기본 2MB). 눈금 하나 = 256KB.
function column(side, i) {
  const x = LANE_X[side][i];
  const plan = { x: x + 2, y: -69, w: LANE_W - 4, d: 5, r: 0.8 };
  const out = [];
  out.push(slab(plan, 2, COLUMN_TOP - 2, { tone: "lo", crease: "lo" }, 2, 0.4));
  const front = plan.y + plan.d;
  const ticks = { minor: [], major: [] };
  for (let n = 1; n < 8; n++) {
    const z = 2 + ((COLUMN_TOP - 4) * n) / 8;
    (n % 4 === 0 ? ticks.major : ticks.minor).push(k.segment([plan.x, front, z], [plan.x + (n % 4 === 0 ? 4.5 : 2.6), front, z], P));
  }
  out.push(L(ticks.minor.join(""), { tone: "faint", free: "end" }), L(ticks.major.join(""), { tone: "lo", free: "end" }));
  out.push(slab({ ...k.insetPlan(plan, -0.6), r: 1 }, COLUMN_TOP, 1.4, { tone: "mid" }, 2, 0.3));
  out.push(D([at([plan.x + plan.w / 2, plan.y + plan.d / 2, COLUMN_TOP + 1.4])], { size: 0.45 }));
  return out.join("");
}

function lane(side, i) {
  const x = LANE_X[side][i];
  const plan = { x, y: LANE_Y, w: LANE_W, d: LANE_D, r: 1.4 };
  const out = [];
  out.push(slab(plan, 2, LANE_TOP - 2, { tone: "mid" }, 3, 0.4));
  const cx = x + LANE_W / 2;
  // 홈: 소켓에서 앞 표시등까지.
  out.push(L(k.lineOnTop([cx, SOCKET_Y + 5.4], [cx, LANE_Y + LANE_D - 10], LANE_TOP, P), { tone: "faint" }));
  out.push(L(k.ring(cx, SOCKET_Y, 5.4, LANE_TOP, P, 28), { tone: "lo" }));
  out.push(L(k.ring(cx, SOCKET_Y, 4.5, LANE_TOP, P, 28), { tone: "faint" }));
  out.push(L(k.planOutline(k.insetPlan(plan, 2), LANE_TOP, P, 3), { tone: "faint" }));
  out.push(screws([[x + 2.2, LANE_Y + LANE_D - 2.2], [x + LANE_W - 2.2, LANE_Y + LANE_D - 2.2], [x + 2.2, LANE_Y + 10], [x + LANE_W - 2.2, LANE_Y + 10]], LANE_TOP, 0.4));
  return out.join("");
}

// 실행 대기 큐 트레이(FIFO): 머리는 레인 쪽(왼쪽 끝).
function tray(side) {
  const { x, y } = M.QUEUE[side];
  const plan = { x: x - 4, y: y - 6.5, w: M.QUEUE_SLOTS * M.QUEUE_GAP + 2, d: 13, r: 1.6 };
  const out = [];
  out.push(slab(plan, 0, TRAY_TOP, { tone: "mid" }, 3, 0.4));
  out.push(L(Array.from({ length: M.QUEUE_SLOTS }, (_, i) => k.ring(...M.queueAt(side, i).slice(0, 2), 5.2, TRAY_TOP, P, 24)).join(""), { tone: "faint" }));
  out.push(L(Array.from({ length: M.QUEUE_SLOTS - 1 }, (_, i) => k.lineOnTop([x + 4 + (i + 0.5) * M.QUEUE_GAP, plan.y], [x + 4 + (i + 0.5) * M.QUEUE_GAP, plan.y + 1.6], TRAY_TOP, P)).join(""), { tone: "lo", free: "end" }));
  // 머리 자리 표시: 맨 앞 칸 앞의 작은 탭.
  out.push(slab({ x: x + 1.5, y: plan.y + plan.d - 0.2, w: 5, d: 1, r: 0.3 }, 0.6, 1.8, { tone: "hi", crease: "none" }, 2));
  out.push(screws([[plan.x + 1.6, plan.y + plan.d / 2], [plan.x + plan.w - 1.6, plan.y + plan.d / 2]], TRAY_TOP, 0.4));
  return out.join("");
}

// 힙: 격자판. 칸마다 unmount 한 가상 스레드(스택 청크)가 놓인다.
function heap() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(HEAP, 0, 0.1, P)}" style="filter:blur(3px)"/>`);
  out.push(slab(HEAP, 0, HEAP_TOP, { tone: "mid" }, 4, 0.6));
  const inner = { x: HEAP.x + 4.5, y: HEAP.y + 4, w: 19 * M.HEAP_COLS, d: 21 * M.HEAP_ROWS, r: 1.5 };
  out.push(L(k.planOutline(inner, HEAP_TOP, P, 3), { tone: "lo" }));
  const grid = [];
  for (let c = 1; c < M.HEAP_COLS; c++) grid.push(k.lineOnTop([inner.x + c * 19, inner.y], [inner.x + c * 19, inner.y + inner.d], HEAP_TOP, P));
  for (let r = 1; r < M.HEAP_ROWS; r++) grid.push(k.lineOnTop([inner.x, inner.y + r * 21], [inner.x + inner.w, inner.y + r * 21], HEAP_TOP, P));
  out.push(L(grid.join(""), { tone: "faint" }));
  out.push(L(Array.from({ length: M.HEAP_COLS * M.HEAP_ROWS }, (_, c) => k.ring(...M.cellAt(c).slice(0, 2), 6, HEAP_TOP, P, 26)).join(""), { tone: "faint" }));
  out.push(screws(k.corners(HEAP, 2.2), HEAP_TOP));
  // 앞쪽 눈금자 띠.
  const rule = { x: inner.x, y: HEAP.y + HEAP.d - 3.6, w: inner.w, d: 2.4, r: 0.4 };
  const ticks = [];
  for (let x = rule.x + 4.75; x < rule.x + rule.w; x += 4.75) ticks.push(k.lineOnTop([x, rule.y], [x, rule.y + (Math.round((x - rule.x) / 4.75) % 4 === 0 ? 2.4 : 1.2)], HEAP_TOP, P));
  out.push(L(k.planOutline(rule, HEAP_TOP, P, 2), { tone: "faint" }), L(ticks.join(""), { tone: "lo", free: "end" }));
  return out.join("");
}

// 커넥션 풀 랙과 DB.
function rack() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(RACK, 0, 0.1, P)}" style="filter:blur(3px)"/>`);
  out.push(slab(RACK, 0, RACK_TOP, { tone: "mid" }, 4, 0.5));
  out.push(L(k.planOutline(k.insetPlan(RACK, 2), RACK_TOP, P, 3), { tone: "faint" }));
  out.push(L(Array.from({ length: M.CONNS }, (_, s) => k.ring(...M.plugAt(s).slice(0, 2), 3.6, RACK_TOP, P, 20)).join(""), { tone: "lo" }));
  out.push(screws(k.corners(RACK, 1.8), RACK_TOP, 0.4));
  // 앞면 통풍 홈.
  const front = RACK.y + RACK.d;
  const slots = [];
  for (let i = 0; i < 13; i++) {
    const x = RACK.x + 6 + i * 7.8;
    slots.push(k.pathOf([at([x, front, 2.4]), at([x + 4.5, front, 2.4]), at([x + 4.5, front, 5]), at([x, front, 5])], true));
  }
  out.push(L(slots.join(""), { tone: "lo" }));
  return out.join("");
}
function drum() {
  const { x, y, r, h } = DRUM;
  const out = [];
  out.push(cyl(x, y, r + 2, 0, 1.6, { tone: "lo" }, 36, 0.3));
  for (const [z0, z1] of [[1.6, 8], [8.6, 15], [15.6, h]]) {
    out.push(cyl(x, y, r, z0, z1 - z0, { tone: "hi", crease: "lo" }, 40, 0.5));
    out.push(L(k.sideArc(x, y, r, z0 + (z1 - z0) / 2, P, 30), { tone: "faint" }));
  }
  out.push(L(k.ring(x, y, r - 2.4, h, P, 36), { tone: "lo" }));
  out.push(D([at([x, y, h])], { size: 0.6, tone: "hi" }));
  return out.join("");
}
// 랙 → DB 케이블.
function cable() {
  const from = [RACK.x + RACK.w, RACK.y + RACK.d / 2, 4];
  const to = [DRUM.x - DRUM.r, DRUM.y, 5];
  const points = [];
  for (let i = 0; i <= 16; i++) {
    const s = i / 16;
    points.push(at([from[0] + (to[0] - from[0]) * s, from[1] + (to[1] - from[1]) * s, from[2] + (to[2] - from[2]) * s + Math.sin(Math.PI * s) * 4]));
  }
  return `<g class="iso-wire" data-tone="mid"><path class="iso-line" data-tone="mid" d="${k.pathOf(points)}"/><circle class="iso-wire-end" cx="${points[0][0].toFixed(1)}" cy="${points[0][1].toFixed(1)}" r="0.9"/><circle class="iso-wire-end" cx="${points[16][0].toFixed(1)}" cy="${points[16][1].toFixed(1)}" r="0.9"/></g>`;
}

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "플랫폼 스레드와 가상 스레드를 나란히 놓은 그림. 왼쪽에는 고정 스레드 풀의 레인 4개(플랫폼 스레드)와 뒤쪽 높은 스택 예약 기둥, 앞쪽 대기 큐 트레이가 있다. 오른쪽에는 ForkJoinPool 받침 위 캐리어 레인 4개와 큐 트레이, 그 옆에 격자판(힙), 앞쪽에 커넥션 10개짜리 랙과 DB 원통이 있다. 원판 위 얇은 판 묶음이 작업 하나와 그 스택 프레임이다.",
  body: [
    base(),
    poolBase("L"),
    ...Array.from({ length: LANES }, (_, i) => column("L", i)),
    ...Array.from({ length: LANES }, (_, i) => lane("L", i)),
    poolBase("R"),
    ...Array.from({ length: LANES }, (_, i) => column("R", i)),
    ...Array.from({ length: LANES }, (_, i) => lane("R", i)),
    heap(),
    tray("L"),
    tray("R"),
    rack(),
    cable(),
    drum(),
    ...["L", "R"].flatMap((side) => Array.from({ length: LANES }, (_, i) => `<g data-part="lamp" data-side="${side}" data-i="${i}">${parts.lamp(side, i, false)}</g>`)),
    `<g data-part="plugs">${Array.from({ length: M.CONNS }, (_, s) => parts.plug(s, false)).join("")}</g>`,
    `<g data-part="mobile"></g>`,
    tagsSvg(k, P),
  ],
});

const STEPS = [
  ["플랫폼 스레드", "요청 하나가 스레드 하나를 처음부터 끝까지 씁니다. I/O 를 기다리는 동안에도 스레드를 붙잡고 있어서(표시등), 스레드 4개가 다 차면 다음 요청은 트레이에서 기다립니다. 스레드마다 2MB 스택(뒤 기둥)을 따로 잡습니다."],
  ["mount", "가상 스레드는 큐(FIFO)에 줄을 섰다가 비어 있는 캐리어 스레드에 올라타서(mount) 실행됩니다. 캐리어도 평범한 플랫폼 스레드이고, 수는 기본으로 코어 수만큼입니다."],
  ["블로킹 → unmount", "실행 중에 sleep 이나 소켓 읽기로 블로킹하면, 스택 프레임을 힙으로 옮기고(stack chunk) 캐리어에서 내려옵니다. 비워진 캐리어는 곧바로 큐의 다음 가상 스레드를 실행합니다."],
  ["다른 캐리어에 remount", "I/O 가 끝나면 가상 스레드는 다시 큐 뒤에 서고, 그때 비어 있는 아무 캐리어에 올라탑니다. 처음과 다른 캐리어일 수 있습니다(테두리 표시한 VT: 캐리어 1 → 2)."],
  ["pinning", "synchronized 안에서 블로킹하면 스택을 힙으로 옮길 수 없어서 캐리어를 붙잡습니다(고리 + 표시등). 캐리어 4개가 모두 붙잡히면 큐의 가상 스레드는 기다립니다. JDK 21 기준이고, JDK 24(JEP 491)에서 synchronized 는 해결됐습니다."],
  ["커넥션 풀 상한", "가상 스레드 20개가 DB 를 쓰려 해도 커넥션은 10개입니다. 나머지는 힙에서 커넥션을 기다립니다. 캐리어는 남아도 처리량은 풀 크기가 정합니다."],
];
const LEGEND = [
  ["column", "레인 뒤 높은 기둥", "스레드 스택 예약", "플랫폼 스레드마다 기본 2MB(ThreadStackSize=2048K). 눈금 하나 256KB."],
  ["token", "원판과 위의 얇은 판 (VT · 요청)", "가상 스레드 · 작업 하나", "얇은 판 하나가 스택 프레임 하나. 오른쪽 VT 는 가상 스레드, 왼쪽 요청은 플랫폼 스레드에 묶인 작업."],
  ["frames", "힙 칸에 놓인 원판", "unmount 된 가상 스레드", "스택 프레임이 힙의 stack chunk 객체로 옮겨진 상태. 필요한 만큼만 차지합니다."],
  ["pulse", "깜박이는 점", "I/O 를 기다리는 중", "sleep, 소켓 읽기, DB 응답 대기."],
  ["lamp2", "레인 앞 표시등", "스레드가 일 없이 붙잡힘", "왼쪽은 I/O 대기 중인 플랫폼 스레드, 오른쪽은 pinning 된 캐리어."],
  ["monitor", "원판을 두른 고리", "synchronized 모니터", "이 안에서 블로킹하면 unmount 하지 못합니다(JDK 21)."],
];
const legendBlock = legendHtml(LEGEND);
const stepsHtml = `<ol class="jk-steps">${STEPS.map(([name, text], i) => `<li><button type="button" data-step="${i}"><span class="jk-n">${i + 1}</span><span><b>${name}</b> ${text}</span></button></li>`).join("")}</ol>`;
const STATS = [["held", "스레드 점유"], ["running", "실행 중"], ["queued", "실행 대기"], ["waiting", "I/O 대기"], ["pinned", "pinned"], ["conns", "커넥션"], ["connWait", "커넥션 대기"], ["done", "완료"]];
const statsHtml = `<dl class="gc-stats" aria-live="off">${STATS.map(([id, name]) => `<div><dt>${name}</dt><dd data-stat="${id}">–</dd>${["held", "conns"].includes(id) ? `<i data-bar="${id}"></i>` : ""}</div>`).join("")}</dl>`;
const PAGE_CSS = `<style>
.jk-steps{list-style:none;margin:18px 0 0;padding:0;display:grid;gap:6px}
.jk-steps button{all:unset;box-sizing:border-box;width:100%;display:flex;gap:10px;align-items:baseline;padding:8px 12px;border-radius:10px;cursor:pointer;color:var(--anatomy-text);font-size:13px;line-height:1.55;border:1px solid transparent}
.jk-steps button:hover{background:var(--anatomy-card)}
.jk-steps button:focus-visible{outline:2px solid var(--anatomy-strong);outline-offset:1px}
.jk-steps button[aria-current="step"]{background:var(--anatomy-card);color:var(--anatomy-strong);border-color:var(--anatomy-faint)}
.jk-steps b{color:var(--anatomy-strong);font-weight:600;margin-right:4px}
.jk-n{flex:none;font:600 11px/18px var(--anatomy-mono);width:18px;height:18px;text-align:center;border-radius:50%;border:1px solid var(--anatomy-mid);color:var(--anatomy-strong)}
.jk-steps button[aria-current="step"] .jk-n{background:var(--anatomy-strong);color:var(--anatomy-card);border-color:var(--anatomy-strong)}
.gc-stats{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;margin:14px 0 0;font:12px/1.4 var(--anatomy-mono)}
.gc-stats div{position:relative;padding:6px 8px 8px;border-radius:8px;background:var(--anatomy-card);overflow:hidden}
.gc-stats dt{color:var(--anatomy-muted);font-size:10.5px;white-space:nowrap}
.gc-stats dd{margin:2px 0 0;color:var(--anatomy-strong);white-space:nowrap}
.gc-stats i{position:absolute;left:0;bottom:0;height:2px;width:0;background:var(--anatomy-mid)}
.iso-stage{cursor:pointer;border-radius:12px}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-mid);outline-offset:4px}
@media (max-width:560px){.gc-stats{grid-template-columns:repeat(4,minmax(0,1fr))}}
</style>`;

const strip = (file) => readFileSync(join(HERE, file), "utf8").replace(/^export \{.*\};?$/gm, "").replace(/^export /gm, "").replace(/^import .*$/gm, "");
const live = `
${strip("model.mjs")}
${strip("parts.mjs")}
const k = { iso, slabOf, cylinder, solidSvg, lineSvg, dotsSvg, ring };
const P = ${JSON.stringify(P)};
const M = { FRAMES, LANE_X, LANE_W, LANE_Y, LANE_D, LANE_TOP, plugAt };
const parts = makeParts(k, P, M);
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const $ = (selector) => svg.querySelector(selector);
const $$ = (selector) => [...svg.querySelectorAll(selector)];
const readout = document.querySelector("[data-readout]");
const buttons = [...document.querySelectorAll("[data-step]")];
const stat = Object.fromEntries([...document.querySelectorAll("[data-stat]")].map((node) => [node.dataset.stat, node]));
const bar = Object.fromEntries([...document.querySelectorAll("[data-bar]")].map((node) => [node.dataset.bar, node]));
const el = { mobile: $('[data-part="mobile"]'), plugs: $('[data-part="plugs"]'), lamps: $$('[data-part="lamp"]'), tags: $$(".vt-tag") };
const now = document.querySelector(".vt-now");
const NOW = ${JSON.stringify(NOW)};
const still = matchMedia("(prefers-reduced-motion: reduce)");
const cache = new Map();
const once = (key, value) => { if (cache.get(key) === value) return false; cache.set(key, value); return true; };
function draw(t) {
  const s = stateAt(t);
  if (once("phase", s.phase)) {
    now.textContent = NOW[s.phase].text;
    el.tags.forEach((node) => (NOW[s.phase].zones.includes(node.dataset.zone) ? node.setAttribute("data-on", "") : node.removeAttribute("data-on")));
  }
  // 조건부 태그: 왼쪽 레인 1 이 점유 중, 오른쪽 레인 1 이 pinning, 힙 첫 칸에서 I/O 대기.
  const when = {
    hold: s.side === "L" && s.lanes[0] === "hold",
    pin: s.side === "R" && s.lanes[0] === "pin",
    io: s.tokens.some((token) => token.where === "heap" && !token.flying && Math.abs(token.at[0] - cellAt(0)[0]) < 1 && Math.abs(token.at[1] - cellAt(0)[1]) < 1),
  };
  el.tags.forEach((node) => { const key = node.dataset.when; if (key && once("w" + key, when[key])) node.style.display = when[key] ? "" : "none"; });
  if (once("phase2", s.phase)) buttons.forEach((button, index) => (index === s.phase ? button.setAttribute("aria-current", "step") : button.removeAttribute("aria-current")));
  el.lamps.forEach((node) => {
    const i = Number(node.dataset.i);
    const on = node.dataset.side === s.side && (s.lanes[i] === "hold" || s.lanes[i] === "pin");
    if (once("l" + node.dataset.side + i, on)) node.innerHTML = parts.lamp(node.dataset.side, i, on);
  });
  const plugKey = s.tokens.filter((token) => token.where === "conn").map((token) => token.at[0].toFixed(0)).join(",");
  if (once("plugs", plugKey)) {
    const busy = new Set(s.tokens.filter((token) => token.where === "conn").map((token) => Math.round((token.at[0] - plugAt(0)[0]) / 10)));
    el.plugs.innerHTML = Array.from({ length: CONNS }, (_, slot) => parts.plug(slot, busy.has(slot))).join("");
  }
  el.mobile.innerHTML = s.tokens
    .sort((a, b) => (a.flying - b.flying) || (depthOf(a.at, P) - depthOf(b.at, P)))
    .map((token) => '<g style="opacity:' + token.presence.toFixed(3) + '">' + parts.token({ ...token, dim: token.where === "cw", chip: s.side === "R" ? "VT" : "요청" }) + "</g>")
    .join("");
  const text = readoutOf(s);
  if (readout.textContent !== text) readout.textContent = text;
  const values = {
    held: s.held + "/" + LANES, running: String(s.running), queued: String(s.queued), waiting: String(s.waiting),
    pinned: String(s.pinned), conns: s.conns + "/" + CONNS, connWait: String(s.connWait), done: String(s.done),
  };
  for (const [id, value] of Object.entries(values)) if (stat[id].textContent !== value) stat[id].textContent = value;
  bar.held.style.width = ((s.held / LANES) * 100).toFixed(1) + "%";
  bar.conns.style.width = ((s.conns / CONNS) * 100).toFixed(1) + "%";
  if (once("aria", s.phase)) {
    stage.setAttribute("aria-valuenow", String(s.phase + 1));
    stage.setAttribute("aria-valuetext", PHASES[s.phase].name);
  }
}
// 투어: 단계를 계속 돈다. 사용자가 단계를 고르면 그 단계를 끝까지 보여 주고 멈췄다가, 조용하면 다시 돈다.
let t = 0.001, hold = null, frame = 0, last = 0, visible = false, idle = 0;
const IDLE = 9000;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
  last = now;
  if (hold === null) t = (t + dt) % TOTAL;
  else t = Math.min(t + dt, hold);
  draw(t);
  frame = visible && !(hold !== null && t >= hold) ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
// 움직임을 줄인 경우 단계마다 보여 줄 한 장면.
const STILL = PHASES.map((phase, index) => STARTS[index] + phase.seconds * [0.5, 0.45, 0.6, 0.62, 0.45, 0.42][index]);
function go(phase) {
  const index = (phase + PHASES.length) % PHASES.length;
  t = STARTS[index] + 0.001;
  hold = STARTS[index] + PHASES[index].seconds - 0.4;
  if (still.matches) { t = STILL[index]; hold = t; draw(t); }
  clearTimeout(idle);
  idle = setTimeout(() => { if (!still.matches) { hold = null; run(); } }, IDLE);
  run();
}
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); else { cancelAnimationFrame(frame); frame = 0; } }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("click", () => go(phaseAt(t).index + 1));
stage.addEventListener("keydown", (event) => {
  const here = phaseAt(t).index;
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === " ") to = here + 1;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = here - 1;
  if (event.key === "Home") to = 0;
  if (event.key === "End") to = PHASES.length - 1;
  if (/^[1-6]$/.test(event.key)) to = Number(event.key) - 1;
  if (to === null) return;
  event.preventDefault();
  go(to);
});
buttons.forEach((button, index) => button.addEventListener("click", () => go(index)));
window.__vt = { draw, stateAt, go, set: (time) => { t = time; hold = time; draw(time); } };
if (still.matches) go(1); else draw(t);
`;

const start = M.stateAt(0.001);
const body = k.plateHtml({
  fig: "Fig 4",
  title: "플랫폼 스레드와 가상 스레드",
  hint: "클릭 · ← → · 1–6 으로 단계 이동",
  readout: M.readoutOf(start),
  keys: [
    { mark: "lit", label: "밝은 원판 = 지금 CPU 에서 실행 중" },
    { mark: "raised", label: "얇은 판 = 스택 프레임" },
    { mark: "edge", label: "레인 = 플랫폼 스레드" },
  ],
  caption:
    "그림은 레인 4개로 줄였습니다. 실제 캐리어 수 기본값은 코어 수(jdk.virtualThreadScheduler.parallelism, 이 맥은 10)이고 최대 256입니다. 스케줄러는 FIFO 모드의 ForkJoinPool 입니다(JDK 21 VirtualThread.createDefaultScheduler). 움직임은 단계별 작업 묶음을 레인 4개로 0.02초씩 시뮬레이션한 결과이며, 시간 축은 설명용입니다. 실제 숫자는 노트의 실험 결과를 보세요.",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="플랫폼 스레드와 가상 스레드: 클릭하거나 화살표 키로 단계를 옮깁니다" aria-valuemin="1" aria-valuemax="6" aria-valuenow="1">${svg}</div>`,
});

const name = theme === "light" ? "vt-light.html" : "vt.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "플랫폼 스레드와 가상 스레드", theme, body: LEGEND_CSS + PAGE_CSS + TAG_CSS + `<p class="vt-now" aria-live="polite">${NOW[0].text}</p>` + body + statsHtml + legendBlock + stepsHtml, script: kitScript() + live, width: 720 }).replace('<html lang="en">', '<html lang="ko">'));
console.log("wrote", name);
