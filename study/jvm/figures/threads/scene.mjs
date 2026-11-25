// 스레드 그림 세 장의 공통 빌더. 그림마다 build.mjs 가 설정(cfg)을 넘기면 독립 페이지 하나를 쓴다.
// 위: 등각 장면(레인 = 스레드, 트레이 = 대기 큐, 격자판 = 힙, 랙 = 커넥션 풀), 아래: 레인별 시간 막대.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeParts } from "./parts.mjs";
import * as M from "./model.mjs";
import { tagsSvg, TAG_CSS } from "./labels.mjs";
import { legendHtml, LEGEND_CSS } from "../legend.mjs";

const SKILL = process.env.ANATOMY_HOME || join(homedir(), ".claude/skills/anatomy");
const k = await import(pathToFileURL(join(SKILL, "kit/iso-kit.mjs")).href);
const { kitScript } = await import(pathToFileURL(join(SKILL, "scripts/inline-kit.mjs")).href);
const HERE = dirname(fileURLToPath(import.meta.url));

export const WIDTH = 660;
export const HEIGHT = 446;
const SCENE_H = 318; // 장면이 들어가는 위쪽 높이. 그 아래는 시간 막대.
const PLATE_H = 10;
const FOOT_H = 5;
const COLUMN_TOP = 44;
const DRUM = { x: 72, y: 38, r: 8.5, h: 22 };

// 4a 와 4b 는 같은 카메라를 써야 레인과 막대가 같은 자리에 온다. 그래서 카메라는 plate 가 아니라 fit 으로 맞춘다.
export const PLATE_AB = { x: -164, y: -80, w: 252, d: 108, r: 10 };
export const PLATE_A = { x: -164, y: -80, w: 108, d: 108, r: 10 };
export const PLATE_C = { x: -164, y: -80, w: 256, d: 136, r: 10 };
export const fitOf = (plate) => [...k.boxCorners(plate, -PLATE_H - FOOT_H, 0), [M.LANE_X[0] + 2, -69, COLUMN_TOP + 2]];

// 시간 막대 자리(화면 좌표).
const TL = { x0: 92, x1: 636, y0: 322, row: 13, gap: 5 };

export function build(cfg) {
  const theme = process.argv.includes("--light") ? "light" : "dark";
  const P = k.fitProjection(cfg.fit, WIDTH, SCENE_H, { pad: 30, azimuth: 70, elevation: 40 });
  const parts = makeParts(k, P, M);
  const { LANES, LANE_X, LANE_W, LANE_Y, LANE_D, LANE_TOP, TRAY_TOP, HEAP, HEAP_TOP, RACK, RACK_TOP, SOCKET_Y } = M;
  const PLATE = cfg.plate;

  const at = (point) => k.iso(point, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const D = (points, style) => k.dotsSvg(points, style);
  const slab = (plan, z, h, style = {}, steps = 3, bevel = 0) => S(k.slabOf(plan, z, h, P, steps, bevel), style);
  const cyl = (x, y, r, z, h, style = {}, steps = 24, bevel = 0) => S(k.cylinder(x, y, r, z, h, P, steps, bevel), style);
  const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  const screws = (points, z, size = 0.45) => D(points.map(([x, y]) => at([x, y, z])), { size });

  function base() {
    const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
    for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
      out.push(cyl(x, y, 7, -PLATE_H - FOOT_H, 1.6, { tone: "lo" }, 28));
      out.push(cyl(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, { tone: "mid" }, 28));
    }
    out.push(slab(PLATE, -PLATE_H, PLATE_H, { tone: "mid" }, 8, 1.6));
    out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
    const corners = k.corners(PLATE, 10);
    out.push(L(corners.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
    out.push(screws(corners, 0, 0.5));
    return out.join("");
  }

  // 레인 묶음 받침.
  function poolBase() {
    const plan = { x: LANE_X[0] - 4, y: -71, w: LANES * 23 + 3, d: 63, r: 2.4 };
    return [
      `<path class="iso-halo" d="${k.haloOf(plan, 0, 0.1, P)}" style="filter:blur(3px)"/>`,
      slab(plan, 0, 2, { tone: "mid" }, 4, 0.4),
      screws(k.corners(plan, 2), 2),
    ].join("");
  }

  // 스택 예약 기둥: 플랫폼 스레드마다 OS 가 미리 잡아 두는 스택(기본 2MB). 눈금 하나 = 256KB.
  function column(i) {
    const plan = { x: LANE_X[i] + 2, y: -69, w: LANE_W - 4, d: 5, r: 0.8 };
    const out = [slab(plan, 2, COLUMN_TOP - 2, { tone: "lo", crease: "lo" }, 2, 0.4)];
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

  function lane(i) {
    const x = LANE_X[i];
    const plan = { x, y: LANE_Y, w: LANE_W, d: LANE_D, r: 1.4 };
    const cx = x + LANE_W / 2;
    return [
      slab(plan, 2, LANE_TOP - 2, { tone: "mid" }, 3, 0.4),
      L(k.lineOnTop([cx, SOCKET_Y + 5.4], [cx, LANE_Y + LANE_D - 10], LANE_TOP, P), { tone: "faint" }),
      L(k.ring(cx, SOCKET_Y, 5.4, LANE_TOP, P, 28), { tone: "lo" }),
      L(k.ring(cx, SOCKET_Y, 4.5, LANE_TOP, P, 28), { tone: "faint" }),
      L(k.planOutline(k.insetPlan(plan, 2), LANE_TOP, P, 3), { tone: "faint" }),
      screws([[x + 2.2, LANE_Y + LANE_D - 2.2], [x + LANE_W - 2.2, LANE_Y + LANE_D - 2.2], [x + 2.2, LANE_Y + 10], [x + LANE_W - 2.2, LANE_Y + 10]], LANE_TOP, 0.4),
    ].join("");
  }

  // 대기 큐 트레이(FIFO): 머리는 레인 쪽(왼쪽 끝).
  function tray() {
    const { x, y } = M.QUEUE;
    const plan = { x: x - 4, y: y - 6.5, w: M.QUEUE_SLOTS * M.QUEUE_GAP + 2, d: 13, r: 1.6 };
    return [
      slab(plan, 0, TRAY_TOP, { tone: "mid" }, 3, 0.4),
      L(Array.from({ length: M.QUEUE_SLOTS }, (_, i) => k.ring(...M.queueAt(i).slice(0, 2), 5.2, TRAY_TOP, P, 24)).join(""), { tone: "faint" }),
      L(Array.from({ length: M.QUEUE_SLOTS - 1 }, (_, i) => k.lineOnTop([x + 4 + (i + 0.5) * M.QUEUE_GAP, plan.y], [x + 4 + (i + 0.5) * M.QUEUE_GAP, plan.y + 1.6], TRAY_TOP, P)).join(""), { tone: "lo", free: "end" }),
      slab({ x: x + 1.5, y: plan.y + plan.d - 0.2, w: 5, d: 1, r: 0.3 }, 0.6, 1.8, { tone: "hi", crease: "none" }, 2),
      screws([[plan.x + 1.6, plan.y + plan.d / 2], [plan.x + plan.w - 1.6, plan.y + plan.d / 2]], TRAY_TOP, 0.4),
    ].join("");
  }

  // 힙: 격자판. 칸마다 unmount 한 가상 스레드(스택 청크)가 놓인다.
  function heap() {
    const out = [`<path class="iso-halo" d="${k.haloOf(HEAP, 0, 0.1, P)}" style="filter:blur(3px)"/>`, slab(HEAP, 0, HEAP_TOP, { tone: "mid" }, 4, 0.6)];
    const inner = { x: HEAP.x + 4.5, y: HEAP.y + 4, w: 19 * M.HEAP_COLS, d: 21 * M.HEAP_ROWS, r: 1.5 };
    out.push(L(k.planOutline(inner, HEAP_TOP, P, 3), { tone: "lo" }));
    const grid = [];
    for (let c = 1; c < M.HEAP_COLS; c++) grid.push(k.lineOnTop([inner.x + c * 19, inner.y], [inner.x + c * 19, inner.y + inner.d], HEAP_TOP, P));
    for (let r = 1; r < M.HEAP_ROWS; r++) grid.push(k.lineOnTop([inner.x, inner.y + r * 21], [inner.x + inner.w, inner.y + r * 21], HEAP_TOP, P));
    out.push(L(grid.join(""), { tone: "faint" }));
    out.push(L(Array.from({ length: M.HEAP_COLS * M.HEAP_ROWS }, (_, c) => k.ring(...M.cellAt(c).slice(0, 2), 6, HEAP_TOP, P, 26)).join(""), { tone: "faint" }));
    out.push(screws(k.corners(HEAP, 2.2), HEAP_TOP));
    const rule = { x: inner.x, y: HEAP.y + HEAP.d - 3.6, w: inner.w, d: 2.4, r: 0.4 };
    const ticks = [];
    for (let x = rule.x + 4.75; x < rule.x + rule.w; x += 4.75) ticks.push(k.lineOnTop([x, rule.y], [x, rule.y + (Math.round((x - rule.x) / 4.75) % 4 === 0 ? 2.4 : 1.2)], HEAP_TOP, P));
    out.push(L(k.planOutline(rule, HEAP_TOP, P, 2), { tone: "faint" }), L(ticks.join(""), { tone: "lo", free: "end" }));
    return out.join("");
  }

  // 커넥션 풀 랙, 케이블, DB.
  function rack() {
    const out = [`<path class="iso-halo" d="${k.haloOf(RACK, 0, 0.1, P)}" style="filter:blur(3px)"/>`, slab(RACK, 0, RACK_TOP, { tone: "mid" }, 4, 0.5)];
    out.push(L(k.planOutline(k.insetPlan(RACK, 2), RACK_TOP, P, 3), { tone: "faint" }));
    out.push(L(Array.from({ length: M.CONNS }, (_, s) => k.ring(...M.plugAt(s).slice(0, 2), 3.6, RACK_TOP, P, 20)).join(""), { tone: "lo" }));
    out.push(screws(k.corners(RACK, 1.8), RACK_TOP, 0.4));
    const front = RACK.y + RACK.d;
    const slots = [];
    for (let i = 0; i < 13; i++) {
      const x = RACK.x + 6 + i * 7.8;
      slots.push(k.pathOf([at([x, front, 2.4]), at([x + 4.5, front, 2.4]), at([x + 4.5, front, 5]), at([x, front, 5])], true));
    }
    out.push(L(slots.join(""), { tone: "lo" }));
    const from = [RACK.x + RACK.w, RACK.y + RACK.d / 2, 4];
    const to = [DRUM.x - DRUM.r, DRUM.y, 5];
    const points = [];
    for (let i = 0; i <= 16; i++) {
      const s = i / 16;
      points.push(at([from[0] + (to[0] - from[0]) * s, from[1] + (to[1] - from[1]) * s, from[2] + (to[2] - from[2]) * s + Math.sin(Math.PI * s) * 4]));
    }
    out.push(`<g class="iso-wire" data-tone="mid"><path class="iso-line" data-tone="mid" d="${k.pathOf(points)}"/><circle class="iso-wire-end" cx="${points[0][0].toFixed(1)}" cy="${points[0][1].toFixed(1)}" r="0.9"/><circle class="iso-wire-end" cx="${points[16][0].toFixed(1)}" cy="${points[16][1].toFixed(1)}" r="0.9"/></g>`);
    const { x, y, r, h } = DRUM;
    out.push(cyl(x, y, r + 2, 0, 1.6, { tone: "lo" }, 36, 0.3));
    for (const [z0, z1] of [[1.6, 8], [8.6, 15], [15.6, h]]) {
      out.push(cyl(x, y, r, z0, z1 - z0, { tone: "hi", crease: "lo" }, 40, 0.5));
      out.push(L(k.sideArc(x, y, r, z0 + (z1 - z0) / 2, P, 30), { tone: "faint" }));
    }
    out.push(L(k.ring(x, y, r - 2.4, h, P, 36), { tone: "lo" }));
    out.push(D([at([x, y, h])], { size: 0.6, tone: "hi" }));
    return out.join("");
  }

  // 시간 막대 틀: 레인마다 한 줄, 아래에 초 눈금, 위에 칸 설명.
  const tlX = (s) => TL.x0 + (s / cfg.axis) * (TL.x1 - TL.x0);
  const rowY = (i) => TL.y0 + i * (TL.row + TL.gap);
  function timelineFrame() {
    const out = [`<defs><pattern id="tl-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" class="tl-hold-bg"/><path d="M0 0V4" class="tl-hatch-line"/></pattern></defs>`];
    const head = TL.y0 - 26;
    const keyX = [TL.x0, TL.x0 + 84, TL.x0 + 84 + 30 + cfg.holdWord.length * 6.2];
    // 폰에서는 짧은 글(holdShort)만 보이고, 쉬는 중 칸 설명은 숨긴다.
    out.push(`<g class="tl-key"><rect x="${keyX[0]}" y="${head - 5}" width="12" height="8" class="tl-run"/><text x="${keyX[0] + 16}" y="${head + 2}">CPU 실행</text><rect x="${keyX[1]}" y="${head - 5}" width="12" height="8" fill="url(#tl-hatch)" class="tl-hold"/><text x="${keyX[1] + 16}" y="${head + 2}"><tspan class="vt-long">${cfg.holdWord}</tspan><tspan class="vt-short">${cfg.holdShort}</tspan></text><g class="tl-idle-key"><rect x="${keyX[2]}" y="${head - 5}" width="12" height="8" class="tl-row"/><text x="${keyX[2] + 16}" y="${head + 2}">쉬는 중</text></g></g>`);
    for (let i = 0; i < LANES; i++) {
      out.push(`<text class="tl-name" x="${TL.x0 - 8}" y="${rowY(i) + TL.row - 3}">${cfg.laneWord} ${i + 1}</text>`);
      out.push(`<rect class="tl-row" x="${TL.x0}" y="${rowY(i)}" width="${TL.x1 - TL.x0}" height="${TL.row}" rx="2"/>`);
    }
    const axisY = rowY(LANES) + 2;
    const ticks = [];
    const labels = [];
    for (let s = 0; s <= cfg.axis + 1e-9; s += 1) {
      const x = tlX(s);
      ticks.push(`M${x.toFixed(1)} ${axisY}V${axisY + (s % 2 === 0 ? 4 : 2.5)}`);
      if (s % 2 === 0) labels.push(`<text x="${x.toFixed(1)}" y="${axisY + 13}">${s}초</text>`);
    }
    out.push(`<path class="tl-axis" d="M${TL.x0} ${axisY}H${TL.x1}${ticks.join("")}"/>`, `<g class="tl-ticks">${labels.join("")}</g>`);
    return out.join("");
  }

  const svg = k.figureSvg({
    width: WIDTH,
    height: HEIGHT,
    label: cfg.label,
    body: [
      base(),
      poolBase(),
      ...Array.from({ length: LANES }, (_, i) => column(i)),
      ...Array.from({ length: LANES }, (_, i) => lane(i)),
      cfg.heap ? heap() : "",
      tray(),
      cfg.rack ? rack() : "",
      ...Array.from({ length: LANES }, (_, i) => `<g data-part="lamp" data-i="${i}">${parts.lamp(i, false)}</g>`),
      cfg.rack ? `<g data-part="plugs">${Array.from({ length: M.CONNS }, (_, s) => parts.plug(s, false)).join("")}</g>` : "",
      `<g data-part="mobile"></g>`,
      tagsSvg(k, P, cfg.tags, WIDTH),
      timelineFrame(),
      `<g data-part="tl"></g>`,
    ],
  });

  const stepsHtml = `<ol class="jk-steps">${cfg.steps.map(([name, text], i) => `<li><button type="button" data-step="${i}"><span class="jk-n">${i + 1}</span><span><b>${name}</b> ${text}</span></button></li>`).join("")}</ol>`;
  const navHtml = `<nav class="vt-nav">${cfg.nav.map(([dark, light, text, here]) => (here ? `<b>${text}</b>` : `<a href="${theme === "light" ? light : dark}">${text}</a>`)).join('<span aria-hidden="true">·</span>')}</nav>`;
  const PAGE_CSS = `<style>
.jk-steps{list-style:none;margin:18px 0 0;padding:0;display:grid;gap:6px}
.jk-steps button{all:unset;box-sizing:border-box;width:100%;display:flex;gap:10px;align-items:baseline;padding:8px 12px;border-radius:10px;cursor:pointer;color:var(--anatomy-text);font-size:13px;line-height:1.55;border:1px solid transparent}
.jk-steps button:hover{background:var(--anatomy-card)}
.jk-steps button:focus-visible{outline:2px solid var(--anatomy-strong);outline-offset:1px}
.jk-steps button[aria-current="step"]{background:var(--anatomy-card);color:var(--anatomy-strong);border-color:var(--anatomy-faint)}
.jk-steps b{color:var(--anatomy-strong);font-weight:600;margin-right:4px}
.jk-n{flex:none;font:600 11px/18px var(--anatomy-mono);width:18px;height:18px;text-align:center;border-radius:50%;border:1px solid var(--anatomy-mid);color:var(--anatomy-strong)}
.jk-steps button[aria-current="step"] .jk-n{background:var(--anatomy-strong);color:var(--anatomy-card);border-color:var(--anatomy-strong)}
.vt-nav{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:0 0 10px;font-size:13px;color:var(--anatomy-muted)}
.vt-nav a{color:var(--anatomy-text);text-decoration:underline;text-underline-offset:3px}
.vt-nav b{color:var(--anatomy-strong);font-weight:600}
.iso-stage{cursor:pointer;border-radius:12px}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-mid);outline-offset:4px}
.tl-row{fill:none;stroke:var(--anatomy-faint);stroke-width:.8;vector-effect:non-scaling-stroke}
.tl-run{fill:var(--anatomy-strong)}
.tl-hold{stroke:var(--anatomy-mid);stroke-width:.6;vector-effect:non-scaling-stroke}
.tl-hold-bg{fill:var(--anatomy-card)}
.tl-hatch-line{stroke:var(--anatomy-mid);stroke-width:1.4}
.tl-axis{fill:none;stroke:var(--anatomy-mid);stroke-width:.8;vector-effect:non-scaling-stroke}
.tl-ticks text,.tl-key text{font:500 8.5px var(--anatomy-mono);fill:var(--anatomy-muted)}
.tl-ticks text{text-anchor:middle}
.tl-name{font:600 9px system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif;fill:var(--anatomy-text);text-anchor:end}
.tl-now{stroke:var(--anatomy-strong);stroke-width:1;vector-effect:non-scaling-stroke}
.tl-end{stroke:var(--anatomy-strong);stroke-width:1;stroke-dasharray:3 2;vector-effect:non-scaling-stroke}
.tl-end-text{font:700 9.5px system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif;fill:var(--anatomy-strong)}
@media (max-width:560px){.tl-ticks text{font-size:13px}.tl-key text{font-size:14px}.tl-key .tl-run,.tl-key .tl-hold{transform:scale(1)}.tl-idle-key{display:none}.tl-name{font-size:14px}.tl-end-text{font-size:15px}}
</style>`;

  const strip = (file) => readFileSync(join(HERE, file), "utf8").replace(/^export \{.*\};?$/gm, "").replace(/^export /gm, "").replace(/^import .*$/gm, "");
  const FIG = { scenarios: cfg.scenarios };
  const live = `
${strip("model.mjs")}
${strip("parts.mjs")}
const k = { iso, slabOf, cylinder, solidSvg, lineSvg, dotsSvg, ring };
const P = ${JSON.stringify(P)};
const M = { FRAMES, LANE_X, LANE_W, LANE_Y, LANE_D, LANE_TOP, plugAt };
const parts = makeParts(k, P, M);
const { SIMS, PHASES, STARTS, TOTAL, phaseAt, stateAt, readoutOf } = makeModel(${JSON.stringify(FIG)});
const NOW = ${JSON.stringify(cfg.now)};
const TL = ${JSON.stringify(TL)};
const AXIS = ${cfg.axis};
const CHIP = ${JSON.stringify(cfg.chip)};
const RACKED = ${cfg.rack ? "true" : "false"};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const $ = (selector) => svg.querySelector(selector);
const $$ = (selector) => [...svg.querySelectorAll(selector)];
const readout = document.querySelector("[data-readout]");
const buttons = [...document.querySelectorAll("[data-step]")];
const now = document.querySelector(".vt-now");
const el = { mobile: $('[data-part="mobile"]'), plugs: $('[data-part="plugs"]'), lamps: $$('[data-part="lamp"]'), tags: $$(".vt-tag"), tl: $('[data-part="tl"]') };
const still = matchMedia("(prefers-reduced-motion: reduce)");
const cache = new Map();
const once = (key, value) => { if (cache.get(key) === value) return false; cache.set(key, value); return true; };
const tlX = (s) => TL.x0 + (Math.min(s, AXIS) / AXIS) * (TL.x1 - TL.x0);
const rowY = (i) => TL.y0 + i * (TL.row + TL.gap);
// 시간 막대: 지금 시각까지의 칸만 그린다.
function timeline(s) {
  const sim = SIMS[s.scenario];
  const out = [];
  sim.segs.forEach((segs, i) => {
    for (const seg of segs) {
      if (seg.from >= s.local) break;
      const x0 = tlX(seg.from), x1 = tlX(Math.min(seg.to, s.local));
      if (x1 - x0 < 0.2) continue;
      const cls = seg.kind === "run" ? 'class="tl-run"' : 'class="tl-hold" fill="url(#tl-hatch)"';
      out.push('<rect ' + cls + ' x="' + x0.toFixed(1) + '" y="' + (rowY(i) + 1.5) + '" width="' + (x1 - x0).toFixed(1) + '" height="' + (TL.row - 3) + '"/>');
    }
  });
  const bottom = rowY(LANES) + 2;
  if (s.finish !== null && s.local >= s.finish) {
    const x = tlX(s.finish);
    out.push('<path class="tl-end" d="M' + x.toFixed(1) + ' ' + (TL.y0 - 4) + 'V' + bottom + '"/>');
    const right = x > TL.x1 - 150;
    out.push('<text class="tl-end-text" x="' + (right ? x - 5 : x + 5).toFixed(1) + '" y="' + (TL.y0 - 7) + '" text-anchor="' + (right ? "end" : "start") + '">' + s.total + '개 완료 ' + s.finish.toFixed(1) + '초</text>');
  } else if (s.local <= AXIS) {
    const x = tlX(s.local);
    out.push('<path class="tl-now" d="M' + x.toFixed(1) + ' ' + (TL.y0 - 3) + 'V' + bottom + '"/>');
  }
  return out.join("");
}
function draw(t) {
  const s = stateAt(t);
  if (once("phase", s.phase)) {
    now.textContent = NOW[s.phase].text;
    el.tags.forEach((node) => (NOW[s.phase].zones.includes(node.dataset.zone) ? node.setAttribute("data-on", "") : node.removeAttribute("data-on")));
    buttons.forEach((button, index) => (index === s.phase ? button.setAttribute("aria-current", "step") : button.removeAttribute("aria-current")));
    stage.setAttribute("aria-valuenow", String(s.phase + 1));
    stage.setAttribute("aria-valuetext", PHASES[s.phase].name);
  }
  // 조건부 태그: 레인 1 이 점유/pinning, 힙 첫 칸에서 I/O 대기.
  const when = {
    hold: s.lanes[0] === "hold",
    pin: s.lanes[0] === "pin",
    io: s.tokens.some((token) => token.where === "heap" && !token.flying && Math.abs(token.at[0] - cellAt(0)[0]) < 1 && Math.abs(token.at[1] - cellAt(0)[1]) < 1),
  };
  el.tags.forEach((node) => { const key = node.dataset.when; if (key && once("w" + key, when[key])) node.style.display = when[key] ? "" : "none"; });
  el.lamps.forEach((node) => {
    const i = Number(node.dataset.i);
    const on = s.lanes[i] === "hold" || s.lanes[i] === "pin";
    if (once("l" + i, on)) node.innerHTML = parts.lamp(i, on);
  });
  if (RACKED) {
    const busy = s.tokens.filter((token) => token.where === "conn").map((token) => Math.round((token.at[0] - plugAt(0)[0]) / 10.5));
    if (once("plugs", busy.join(","))) el.plugs.innerHTML = Array.from({ length: CONNS }, (_, slot) => parts.plug(slot, busy.includes(slot))).join("");
  }
  el.mobile.innerHTML = s.tokens
    .sort((a, b) => (a.flying - b.flying) || (depthOf(a.at, P) - depthOf(b.at, P)))
    .map((token) => '<g style="opacity:' + token.presence.toFixed(3) + '">' + parts.token({ ...token, dim: token.where === "cw", chip: CHIP }) + "</g>")
    .join("");
  if (once("tl", s.scenario + ":" + Math.round(s.local / 0.04))) el.tl.innerHTML = timeline(s);
  const text = readoutOf(s);
  if (readout.textContent !== text) readout.textContent = text;
}
// 투어: 단계를 계속 돈다. 사용자가 단계를 고르면 그 단계를 끝까지 보여 주고 멈췄다가, 조용하면 다시 돈다.
let t = 0.001, hold = null, frame = 0, last = 0, visible = false, idle = 0;
const IDLE = 9000;
function tick(stamp) {
  const dt = last ? Math.min((stamp - last) / 1000, 1 / 20) : 1 / 60;
  last = stamp;
  if (hold === null) t = (t + dt) % TOTAL;
  else t = Math.min(t + dt, hold);
  draw(t);
  frame = visible && !(hold !== null && t >= hold) ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
// 움직임을 줄인 경우 단계마다 보여 줄 한 장면: 단계 끝 무렵.
const STILL = PHASES.map((phase, index) => STARTS[index] + phase.seconds * 0.85);
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
  if (/^[1-9]$/.test(event.key) && Number(event.key) <= PHASES.length) to = Number(event.key) - 1;
  if (to === null) return;
  event.preventDefault();
  go(to);
});
buttons.forEach((button, index) => button.addEventListener("click", () => go(index)));
window.__vt = { draw, stateAt, go, STARTS, PHASES, set: (time) => { t = time; hold = time; draw(time); } };
if (still.matches) go(0); else draw(t);
`;

  const model = M.makeModel(FIG);
  const body = k.plateHtml({
    fig: cfg.fig,
    title: cfg.title,
    hint: `클릭 · ← → · 1–${model.PHASES.length} 로 단계 이동`,
    readout: model.readoutOf(model.stateAt(0.001)),
    keys: cfg.keys,
    caption: cfg.caption,
    body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="${cfg.title}: 클릭하거나 화살표 키로 단계를 옮깁니다" aria-valuemin="1" aria-valuemax="${model.PHASES.length}" aria-valuenow="1">${svg}</div>`,
  });
  const page = LEGEND_CSS + PAGE_CSS + TAG_CSS + navHtml + `<p class="vt-now" aria-live="polite">${cfg.now[0].text}</p>` + body + legendHtml(cfg.legend) + stepsHtml;
  const name = theme === "light" ? cfg.files[1] : cfg.files[0];
  writeFileSync(join(cfg.dir, name), k.pageHtml({ title: cfg.title, theme, body: page, script: kitScript() + live, width: 720 }).replace('<html lang="en">', '<html lang="ko">'));
  console.log("wrote", name);
  return model;
}

// 세 그림 사이를 오가는 링크: [다크, 라이트, 글]. 그림마다 자기 자리에 here 를 붙인다.
export const NAV = [
  ["../platform-threads/pt.html", "../platform-threads/pt-light.html", "4a 플랫폼 스레드"],
  ["../virtual-threads/vt.html", "../virtual-threads/vt-light.html", "4b 가상 스레드"],
  ["../vt-pitfalls/pit.html", "../vt-pitfalls/pit-light.html", "4c 가상 스레드의 함정"],
];
export const navFor = (index) => NAV.map((entry, i) => [...entry, i === index]);

// 4a·4b 가 같이 쓰는 작업 부하: 요청 12개, 각 요청은 CPU 0.4 → I/O 2.4~3.6 → CPU 0.4(모델 초).
export const WORK = Array.from({ length: 12 }, (_, i) => ({ id: "R" + (i + 1), arrive: 0.2 + i * 0.1, seg: [["cpu", 0.4], ["io", 2.4 + ((i * 7) % 5) * 0.3], ["cpu", 0.4]] }));
export const AB_SECONDS = 14.5;
