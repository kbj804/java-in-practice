import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeParts } from "./parts.mjs";
import * as M from "./model.mjs";
import { legendHtml, LEGEND_CSS } from "../legend.mjs";

// Anatomy 스킬의 kit 을 쓴다: ANATOMY_HOME 이 없으면 ~/.claude/skills/anatomy.
const SKILL = process.env.ANATOMY_HOME || join(homedir(), ".claude/skills/anatomy");
const k = await import(pathToFileURL(join(SKILL, "kit/iso-kit.mjs")).href);
const { kitScript } = await import(pathToFileURL(join(SKILL, "scripts/inline-kit.mjs")).href);

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 660;
const HEIGHT = 420;

const PLATE = { x: -204, y: -108, w: 408, d: 202, r: 10 };
const PLATE_H = 10;
const FOOT_H = 5;
const BEAM_Z = 38;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-196, -101, BEAM_Z + 10], [-196, 22, BEAM_Z + 4], [196, -101, BEAM_Z + 4], [196, 22, BEAM_Z + 4], [-180, 37, 32]],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: 52, elevation: 36 },
);
const parts = makeParts(k, P, M);
const { tilePlan, TILE_TOP, FLOOR } = M;

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const slab = (plan, z, h, style = {}, steps = 3, bevel = 0) => S(k.slabOf(plan, z, h, P, steps, bevel), style);
const cyl = (x, y, r, z, h, style = {}, steps = 24, bevel = 0) => S(k.cylinder(x, y, r, z, h, P, steps, bevel), style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const screws = (points, z, size = 0.45) => D(points.map(([x, y]) => at([x, y, z])), { size });
const halo = (plan) => `<path class="iso-halo" d="${k.haloOf(plan, 0, 0.1, P)}" style="filter:blur(3px)"/>`;
const group = (attrs, body = "") => `<g ${Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(" ")}>${body}</g>`;

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
  // 가운데 칸막이 홈: 두 주방을 나누는 선.
  out.push(L(k.lineOnTop([-2, inner.y], [-2, 48], 0, P), { tone: "faint" }));
  // 명판: 두 바닥 사이.
  const label = { x: -16, y: -40, w: 28, d: 9, r: 1.2 };
  out.push(slab(label, 0, 0.8, { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 3), { tone: "faint" }));
  out.push(L([18, 13, 16].map((w, i) => k.lineOnTop([label.x + 4, label.y + 2.6 + i * 2], [label.x + 4 + w, label.y + 2.6 + i * 2], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(screws([[label.x + label.w - 3, label.y + 3], [label.x + label.w - 3, label.y + label.d - 3]], 0.8));
  return out.join("");
}

// 바닥: 받침판 위에 같은 크기 칸(region) 15개.
const floorPlan = (side) => ({ x: FLOOR[side].x0 - 4, y: FLOOR[side].y0 - 4, w: 5 * M.PITCH + 5, d: 3 * M.PITCH + 5, r: 2.5 });
function floor(side) {
  const plan = floorPlan(side);
  const out = [];
  out.push(halo(plan));
  out.push(slab(plan, 0, 3, { tone: "lo" }, 4, 0.5));
  out.push(screws(k.corners(plan, 1.8), 3, 0.4));
  for (let i = 0; i < 15; i++) {
    const p = tilePlan(side, i);
    out.push(slab(p, 3, 1, { tone: "mid", crease: "faint" }, 3, 0.3));
    out.push(L(k.planOutline(k.insetPlan(p, 2), TILE_TOP, P, 3), { tone: "faint" }));
  }
  return out.join("");
}

// G1 거대 객체(H): 칸 두 개에 걸친 큰 냄비.
function pot() {
  const x = -57.5, y = -73, r = 9;
  return [
    cyl(x, y, r, TILE_TOP, 1, { tone: "mid" }, 40, 0.3),
    cyl(x, y, r - 0.6, TILE_TOP + 1, 10, { tone: "hi", crease: "lo" }, 40),
    L(k.sideArc(x, y, r - 0.6, TILE_TOP + 6, P, 30), { tone: "faint" }),
    S(k.slabOf({ x: x - r - 2.6, y: y - 1.2, w: 3, d: 2.4, r: 0.6 }, TILE_TOP + 8, 1.2, P, 2), { tone: "mid", crease: "lo" }),
    S(k.slabOf({ x: x + r - 0.4, y: y - 1.2, w: 3, d: 2.4, r: 0.6 }, TILE_TOP + 8, 1.2, P, 2), { tone: "mid", crease: "lo" }),
    cyl(x, y, r + 0.4, TILE_TOP + 11, 1, { tone: "mid" }, 40, 0.3),
    L(k.ring(x, y, r - 2.4, TILE_TOP + 12, P, 36), { tone: "lo" }),
    cyl(x, y, 1.6, TILE_TOP + 12, 1.6, { tone: "mid" }, 16, 0.3),
    D([at([x, y, TILE_TOP + 13.6])], { size: 0.5, tone: "hi" }),
  ].join("");
}

// 표시 카트 갠트리: 바닥 앞뒤 레일을 따라 x 로 움직인다.
const RAILS = [-100, 16];
const RAIL_X = { g1: [-198, -12], z: [12, 198] };
const REST = { g1: -20.5, z: 192 };
function rails(side) {
  const [x0, x1] = RAIL_X[side];
  const out = [];
  for (const y of RAILS) {
    out.push(slab({ x: x0, y, w: x1 - x0, d: 6, r: 1 }, 0, 1.6, { tone: "lo" }, 3, 0.3));
    out.push(L(k.lineOnTop([x0 + 1, y + 3], [x1 - 1, y + 3], 1.6, P), { tone: "faint" }));
    for (const x of [x0, x1 - 4]) {
      out.push(slab({ x, y: y - 1, w: 4, d: 8, r: 1 }, 0, 5, { tone: "mid" }, 2, 0.4));
      out.push(screws([[x + 2, y + 1.5], [x + 2, y + 6.5]], 5));
    }
  }
  return out.join("");
}
function upright(side, y) {
  const gx = REST[side];
  const truck = { x: gx - 6, y: y - 1, w: 12, d: 8, r: 1.4 };
  return [
    slab(truck, 1.6, 4, { tone: "mid" }, 3, 0.4),
    screws([[truck.x + 2, truck.y + 2], [truck.x + truck.w - 2, truck.y + truck.d - 2]], 5.6),
    slab({ x: gx - 2.6, y: y + 0.4, w: 5.2, d: 5.2, r: 0.8 }, 5.6, BEAM_Z - 5.6, { tone: "mid" }, 2, 0.3),
  ].join("");
}
function beam(side) {
  const gx = REST[side];
  const plan = { x: gx - 3.6, y: RAILS[0] - 0.6, w: 7.2, d: RAILS[1] - RAILS[0] + 7.2, r: 1 };
  const head = { x: gx - 3, y: -42, w: 6, d: 8, r: 1 };
  const out = [
    group({ "data-part": "head", "data-side": side }, slab(head, BEAM_Z - 7, 7, { tone: "mid", crease: "lo" }, 3, 0.3)),
    slab(plan, BEAM_Z, 4, { tone: "mid" }, 3, 0.6),
    screws([[gx, plan.y + 3], [gx, plan.y + plan.d - 3]], BEAM_Z + 4),
    L([-30, -18, -6, 6].map((y) => k.lineOnTop([plan.x, y], [plan.x + plan.w, y], BEAM_Z + 4, P)).join(""), { tone: "lo" }),
  ];
  if (side === "g1") {
    // 스냅샷 카메라: 몸통, 렌즈 링, 위에 플래시 전구.
    const body = { x: gx - 3.4, y: -66, w: 6.8, d: 9, r: 1 };
    out.push(slab(body, BEAM_Z + 4, 5, { tone: "mid", crease: "lo" }, 3, 0.4));
    out.push(L(k.sideRing([gx, body.y + body.d, BEAM_Z + 6.5], 1.8, "y", P, 20), { tone: "lo" }));
    out.push(cyl(gx, body.y + 3, 1.2, BEAM_Z + 9, 1.6, { tone: "mid", crease: "none" }, 14));
    out.push(group({ "data-part": "flash" }, cyl(gx, body.y + 3, 1.8, BEAM_Z + 10.6, 1.6, { tone: "hi", crease: "lo" }, 18, 0.3)));
  }
  return out.join("");
}

// 요리사 자리: 주문서 꽂이(Stack), 레시피 카드와 PC, 멈춤 램프. ZGC 는 손목 체크(로드 배리어)도.
function station(side) {
  const { cx, spike } = parts.STATION[side];
  const plan = side === "g1" ? { x: -192, y: 26, w: 40, d: 22, r: 2 } : { x: 22, y: 26, w: 50, d: 22, r: 2 };
  const holder = { x: cx - 3, y: 29, w: 12, d: 15, r: 1 };
  const recipe = { x: cx - 1.2, y: 30.2, w: 8.4, d: 12.6, r: 0.4 };
  const lamp = side === "g1" ? [-158, 31] : [62, 31];
  const out = [
    halo(plan),
    slab(plan, 0, 4, { tone: "mid" }, 4, 0.5),
    screws(k.corners(plan, 2.2), 4),
    cyl(spike[0], spike[1], 4, 4, 2, { tone: "mid" }, 24, 0.3),
    slab(holder, 4, 2.4, { tone: "mid" }, 3, 0.3),
    slab(recipe, 6.4, 0.4, { tone: "hi", crease: "none" }, 2),
    L(Array.from({ length: 7 }, (_, i) => k.lineOnTop([recipe.x + 1.4, recipe.y + 1.2 + i * 1.6], [recipe.x + recipe.w - (i % 3 === 1 ? 3 : 1.4), recipe.y + 1.2 + i * 1.6], 6.8, P)).join(""), { tone: "lo", free: true }),
    cyl(lamp[0], lamp[1], 2.2, 4, 1.2, { tone: "mid" }, 18, 0.3),
    cyl(lamp[0], lamp[1], 0.9, 5.2, 9, { tone: "mid", crease: "none" }, 12),
    cyl(lamp[0], lamp[1], 2.4, 14.2, 1, { tone: "mid" }, 20, 0.3),
    group({ "data-part": "dome", "data-side": side }, cyl(lamp[0], lamp[1], 2, 15.2, 3.4, { tone: "hi", crease: "lo" }, 20, 0.6)),
    group({ "data-part": "lamp", "data-side": side, style: "opacity:0" }, D([at([lamp[0], lamp[1], 18.6])], { size: 1.8, tone: "hi", pulse: true })),
  ];
  if (side === "z") {
    // 손목 체크: 작은 상자와 위의 표시창. 끈을 읽을 때 옛 주소면 켜진다.
    const box = { x: 58, y: 38, w: 9, d: 7, r: 1 };
    out.push(slab(box, 4, 4, { tone: "mid", crease: "lo" }, 3, 0.3));
    out.push(group({ "data-part": "check" }, slab(k.insetPlan(box, 1.6), 8, 0.6, { tone: "mid", crease: "none" }, 2)));
    out.push(screws([[box.x + 1, box.y + 1], [box.x + box.w - 1, box.y + box.d - 1]], 8, 0.35));
  }
  return out.join("");
}
const pointer = (side) => {
  const { cx } = parts.STATION[side];
  return slab({ x: cx - 1.2, y: 30.6, w: 2.2, d: 1.6, r: 0.4 }, 6.4, 1.2, { tone: "hi", crease: "lo" }, 2);
};

// G1 멈춤 목표 다이얼.
function dial() {
  const { x, y, r, top } = parts.DIAL;
  const plan = { x: x - 15, y: y - 13, w: 30, d: 26, r: 3 };
  const out = [halo(plan), slab(plan, 0, 5, { tone: "mid" }, 4, 0.6), screws(k.corners(plan, 2.4), 5)];
  out.push(cyl(x, y, r, 5, top - 5, { tone: "hi", crease: "lo" }, 56, 0.8));
  out.push(L(k.sideArc(x, y, r, 9, P, 36), { tone: "faint" }));
  out.push(L(k.ring(x, y, r - 1.6, top, P, 56), { tone: "lo" }));
  const ticks = k.radialTicks(x, y, r - 2.2, 48, 8, top, [1, 2.2], P, -Math.PI * parts.SPAN, Math.PI * 2 * parts.SPAN);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  // 목표(200)와 80%(160) 표시: 테두리 안쪽에 점.
  for (const ms of [M.GOAL * M.GOAL_SHARE, M.GOAL]) {
    const a = parts.angleOf(ms);
    out.push(D([at([x + Math.sin(a) * (r - 4.4), y - Math.cos(a) * (r - 4.4), top])], { size: ms === M.GOAL ? 0.8 : 0.55, tone: "hi" }));
  }
  out.push(`<path data-part="needle" class="iso-line" data-tone="hi" data-free="start" d="${parts.needle(0)}" style="stroke-width:1.1"/>`);
  out.push(L(k.ring(x, y, 1.3, top, P, 14), { tone: "mid" }));
  out.push(D([at([x, y, top])], { size: 0.7, tone: "hi" }));
  return out.join("");
}

// ZGC 이사 장부(포워딩 테이블): 받침 위 펼친 책.
function ledgerStand() {
  const plan = { x: 96, y: 26, w: 42, d: 22, r: 2 };
  const left = { x: 101, y: 28.6, w: 16, d: 17, r: 0.8 };
  const right = { x: 117, y: 28.6, w: 16, d: 17, r: 0.8 };
  return [
    halo(plan),
    slab(plan, 0, 4, { tone: "mid" }, 4, 0.5),
    screws(k.corners(plan, 2.2), 4),
    slab({ x: 100, y: 28, w: 34, d: 18, r: 1 }, 4, 2, { tone: "lo" }, 3, 0.3),
    slab(left, 6, 3.2, { tone: "hi", crease: "lo" }, 3, 0.3),
    slab(right, 6, 3.2, { tone: "hi", crease: "lo" }, 3, 0.3),
    L([0, 1, 2, 3, 4].map((n) => k.lineOnTop([left.x + 2, left.y + 2.6 + n * 2.6], [left.x + [11, 9, 12, 8, 10][n], left.y + 2.6 + n * 2.6], 9.2, P)).join(""), { tone: "lo", free: true }),
    L(k.lineOnTop([117, 28.6], [117, 45.6], 9.2, P), { tone: "mid" }),
  ].join("");
}

// 멈춤 기록계: 받침, 종이, 양 끝 롤러 하우징, 단계 눈금, 두 줄 이름.
function recorder() {
  const box = { x: -156, y: 52, w: 312, d: 40, r: 2.5 };
  const out = [halo(box), slab(box, 0, 5, { tone: "mid" }, 4, 0.6), screws(k.corners(box, 2.2), 5)];
  out.push(slab(M.PAPER, 5, 0.4, { tone: "hi", crease: "none" }, 3));
  for (const x of [M.PAPER.x - 5, M.PAPER.x + M.PAPER.w + 1]) {
    out.push(slab({ x, y: M.PAPER.y - 1, w: 4, d: M.PAPER.d + 2, r: 1 }, 5, 3.2, { tone: "mid", crease: "lo" }, 3, 0.4));
    out.push(screws([[x + 2, M.PAPER.y + 1.5], [x + 2, M.PAPER.y + M.PAPER.d - 1.5]], 8.2, 0.4));
  }
  const top = 5.4;
  // 단계 경계 눈금: 종이 뒤 가장자리에서 내려온다.
  out.push(L(M.STARTS.slice(1).map((s) => k.lineOnTop([M.chartX(s), M.PAPER.y], [M.chartX(s), M.PAPER.y + 2.4], top, P)).join(""), { tone: "mid" }));
  out.push(L(Array.from({ length: 28 }, (_, i) => M.CHART_X[0] + (i * (M.CHART_X[1] - M.CHART_X[0])) / 27).map((x) => k.lineOnTop([x, M.PAPER.y + M.PAPER.d], [x, M.PAPER.y + M.PAPER.d - 1.2], top, P)).join(""), { tone: "lo" }));
  // 120ms 기준선(옅게): G1 줄 위.
  out.push(L(k.lineOnTop([M.CHART_X[0], M.LANE.g1 - M.SPIKE_MAX], [M.CHART_X[1], M.LANE.g1 - M.SPIKE_MAX], top, P), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([M.PAPER.x + 3, M.LANE.g1 + 0.2], top, P), "G1", { size: 4, tone: "mid" }));
  out.push(k.faceTextSvg(k.topMatrix([M.PAPER.x + 3, M.LANE.z + 0.2], top, P), "ZGC", { size: 4, tone: "mid" }));
  return out.join("");
}

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "G1 과 ZGC 를 나란히 놓은 주방 그림. 왼쪽과 오른쪽에 같은 크기 칸(region) 15개짜리 바닥이 있고, 칸마다 역할 꼬리표가 붙어 있다. 각 바닥 위로 표시 카트 갠트리가 지나간다. 왼쪽(G1)에는 두 칸에 걸친 거대 객체 냄비, 칸별 방문자 명부, 스냅샷 카메라, 멈춤 목표 다이얼이 있고, 오른쪽(ZGC)에는 이사 장부와 요리사 손목 체크가 있다. 앞쪽 기록계가 두 GC 의 멈춤을 같은 종이에 그린다.",
  body: [
    base(),
    rails("g1"),
    rails("z"),
    group({ "data-part": "gantry-back", "data-side": "g1" }, upright("g1", RAILS[0])),
    group({ "data-part": "gantry-back", "data-side": "z" }, upright("z", RAILS[0])),
    floor("g1"),
    floor("z"),
    ...M.SIDES.flatMap((side) => Array.from({ length: 15 }, (_, i) => group({ "data-part": "tag", "data-side": side, "data-i": i }))),
    ...Array.from({ length: 15 }, (_, i) => group({ "data-part": "log", "data-i": i }, parts.log("g1", i, false))),
    pot(),
    group({ "data-part": "dishes", "data-side": "g1" }),
    group({ "data-part": "dishes", "data-side": "z" }),
    group({ "data-part": "gantry-top", "data-side": "g1" }, beam("g1")),
    group({ "data-part": "gantry-top", "data-side": "z" }, beam("z")),
    group({ "data-part": "gantry-front", "data-side": "g1" }, upright("g1", RAILS[1])),
    group({ "data-part": "gantry-front", "data-side": "z" }, upright("z", RAILS[1])),
    ...M.SIDES.map((side) => station(side) + group({ "data-part": "pointer", "data-side": side }, pointer(side)) + group({ "data-part": "stack", "data-side": side })),
    dial(),
    ledgerStand(),
    group({ "data-part": "ledger" }),
    recorder(),
    group({ "data-part": "trace", "data-side": "g1" }),
    group({ "data-part": "trace", "data-side": "z" }),
    group({ "data-part": "pen" }, parts.pen(M.CHART_X[0], [[M.LANE.g1, false], [M.LANE.z, false]])),
    group({ "data-part": "wires" }),
  ],
});

const STEPS = [
  ["할당", "두 주방은 같은 크기 칸(region)으로 나뉜 바닥에 같은 속도로 새 접시(객체)를 놓습니다. 칸 꼬리표가 역할입니다: G1 은 E(Eden)·S(Survivor)·O(Old)·H(거대 객체), ZGC 는 Y(Young)·O(Old)."],
  ["Young GC · 동시 표시", "G1 은 요리사를 모두 멈추고(램프) 살아 있는 young 접시를 빈 칸으로 옮긴 뒤 칸째로 비웁니다. ZGC 는 아주 짧게 멈췄다가(Mark Start) 요리사가 일하는 동안 카트가 살아 있는 접시에 점을 찍습니다."],
  ["SATB 표시 · 옮길 칸", "G1 은 영업 중에 Old 칸을 표시합니다. 시작할 때 사진(스냅샷)을 찍어, 그 뒤 끈이 끊긴 접시도 이번 주기엔 살아 있는 것으로 둡니다. ZGC 는 Mark End 와 Relocate Start 로 두 번 아주 짧게 멈추고, 쓰레기가 많은 칸을 고릅니다."],
  ["후보 고르기 · 동시 이동", "G1 은 Remark·Cleanup 으로 짧게 멈춘 뒤 쓰레기가 많은 Old 칸부터 다이얼(멈춤 목표 200ms)에 맞는 만큼만 고릅니다. ZGC 는 요리사가 일하는 동안 접시를 옮기고, 옛 주소 → 새 주소를 이사 장부에 적고, 비운 칸을 바로 다시 씁니다."],
  ["Mixed GC · 셀프 힐링", "G1 은 다시 모두 멈추고 young 칸과 고른 Old 칸을 비웁니다. 칸별 명부로 바깥에서 들어오는 끈을 찾아 멈춘 동안 전부 고칩니다. ZGC 는 요리사가 옛 주소를 가리키는 끈을 읽는 순간 손목 체크(로드 배리어)가 장부를 보고 끈을 고쳐 맵니다. 다음부터는 바로 갑니다."],
  ["할당 폭주", "할당이 정리보다 빠르면 G1 은 옮길 빈 칸이 없어 Full GC(힙 전체 압축, 가장 긴 멈춤)로 넘어갑니다. ZGC 는 그 요리사만 빈 칸이 날 때까지 기다리고(Allocation Stall), 정리는 계속 돕니다."],
  ["정리", "기록계를 비교합니다: G1 은 멈춤이 수십~백 ms 로 솟고, ZGC 는 멈춤이 0.01ms 라 점으로만 남습니다. 대신 ZGC 는 배리어와 동시 작업에 CPU 를 더 쓰고, 할당이 너무 빠르면 할당 대기가 생깁니다."],
];
const LEGEND = [
  ["tiles", "바닥 타일 칸", "Region", "뒤쪽 주방이 G1, 앞쪽 주방이 ZGC. 두 주방 모두 같은 크기 칸으로 나뉩니다."],
  ["tag", "칸 구석 스티커", "Region 의 역할", "G1 은 E(Eden)·S(Survivor)·O(Old)·H(Humongous), ZGC 는 Y(Young)·O(Old)."],
  ["pot", "두 칸에 걸친 큰 냄비", "Humongous 객체", "Region 절반 이상 크기라 여러 칸을 연달아 차지합니다(G1)."],
  ["log", "칸마다 붙은 명부", "Remembered Set", "바깥 어디에서 이 칸을 가리키는지 적어 둡니다. 옮길 칸의 명부만 보면 됩니다."],
  ["camera", "갠트리의 카메라", "SATB 스냅샷", "표시를 시작한 순간 살아 있던 접시는 이번 사이클 동안 살아 있는 것으로 칩니다."],
  ["gantry", "갠트리", "마킹과 이동", "바닥을 훑으며 살아 있는 접시에 점을 찍고, 고른 칸의 접시를 옮깁니다."],
  ["marked", "접시 위 점", "마킹됨(살아 있음)", "흐려진 접시는 쓰레기로 판명된 것."],
  ["dial", "다이얼", "G1 멈춤 목표", "기본 200ms. 이 안에 끝날 만큼만 Old 칸을 골라 섞습니다(안쪽 점 160 = 80%)."],
  ["spike", "주문서 꽂이", "스레드의 Stack · GC Root", ""],
  ["wire", "끈", "참조", ""],
  ["bead", "끈 끝 구슬", "Colored Pointer", "속이 빈 구슬 = 옛 주소일 수 있음, 꽉 찬 구슬 = 확인된 새 주소."],
  ["wrist", "손목 검사기", "Load Barrier", "끈을 당길(참조를 읽을) 때마다 구슬 색을 봅니다."],
  ["ledger", "펼친 장부", "Forwarding Table", "옛 자리 → 새 자리 기록. 검사기가 여기서 새 주소를 찾아 끈을 다시 맵니다(self-healing)."],
  ["lamp", "요리사 자리 정지등", "그 요리사가 멈춤", "G1 은 Stop-the-World, ZGC 는 짧은 신호 또는 Allocation Stall."],
  ["recorder", "앞쪽 두 줄 기록계", "멈춤 기록", "위 줄 G1, 아래 줄 ZGC. 튀어 오른 높이가 멈춘 시간."],
];
const legendBlock = legendHtml(LEGEND);
const stepsHtml = `<ol class="jk-steps">${STEPS.map(([name, text], i) => `<li><button type="button" data-step="${i}"><span class="jk-n">${i + 1}</span><span><b>${name}</b> ${text}</span></button></li>`).join("")}</ol>`;
const STATS = [["g1n", "G1 멈춤"], ["g1max", "G1 최장"], ["g1sum", "G1 합계"], ["zn", "ZGC 멈춤"], ["zmax", "ZGC 최장"], ["zsum", "ZGC 합계"], ["zstall", "할당 대기"]];
const statsHtml = `<dl class="gc-stats" aria-live="off">${STATS.map(([id, name]) => `<div><dt>${name}</dt><dd data-stat="${id}">–</dd></div>`).join("")}</dl>`;
const PAGE_CSS = `<style>
.jk-steps{list-style:none;margin:18px 0 0;padding:0;display:grid;gap:6px}
.jk-steps button{all:unset;box-sizing:border-box;width:100%;display:flex;gap:10px;align-items:baseline;padding:8px 12px;border-radius:10px;cursor:pointer;color:var(--anatomy-text);font-size:13px;line-height:1.55;border:1px solid transparent}
.jk-steps button:hover{background:var(--anatomy-card)}
.jk-steps button:focus-visible{outline:2px solid var(--anatomy-strong);outline-offset:1px}
.jk-steps button[aria-current="step"]{background:var(--anatomy-card);color:var(--anatomy-strong);border-color:var(--anatomy-faint)}
.jk-steps b{color:var(--anatomy-strong);font-weight:600;margin-right:4px}
.jk-n{flex:none;font:600 11px/18px var(--anatomy-mono);width:18px;height:18px;text-align:center;border-radius:50%;border:1px solid var(--anatomy-mid);color:var(--anatomy-strong)}
.jk-steps button[aria-current="step"] .jk-n{background:var(--anatomy-strong);color:var(--anatomy-card);border-color:var(--anatomy-strong)}
.gc-stats{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin:14px 0 0;font:12px/1.4 var(--anatomy-mono)}
.gc-stats div{padding:6px 8px 8px;border-radius:8px;background:var(--anatomy-card)}
.gc-stats dt{color:var(--anatomy-muted);font-size:10.5px;white-space:nowrap}
.gc-stats dd{margin:2px 0 0;color:var(--anatomy-strong);white-space:nowrap}
.iso-stage{cursor:pointer;border-radius:12px}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-mid);outline-offset:4px}
@media (max-width:560px){.gc-stats{grid-template-columns:repeat(4,minmax(0,1fr))}.iso-stage{overflow:hidden}.iso-stage>svg{transform:scale(1.12);transform-origin:50% 52%}}
</style>`;

const strip = (file) => readFileSync(join(HERE, file), "utf8").replace(/^export \{.*\};?$/gm, "").replace(/^export /gm, "").replace(/^import .*$/gm, "");
const live = `
${strip("model.mjs")}
${strip("parts.mjs")}
const k = { iso, slabOf, cylinder, solidSvg, lineSvg, dotsSvg, lineOnTop, ring, planOutline, pathOf, onTop, faceTextSvg, topMatrix };
const P = ${JSON.stringify(P)};
const M = { BOWL_TOP, TILE_TOP, tilePlan, LANE, CHART_X, PAPER };
const parts = makeParts(k, P, M);
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const $ = (selector) => svg.querySelector(selector);
const $$ = (selector) => [...svg.querySelectorAll(selector)];
const readout = document.querySelector("[data-readout]");
const buttons = [...document.querySelectorAll("[data-step]")];
const stat = Object.fromEntries([...document.querySelectorAll("[data-stat]")].map((node) => [node.dataset.stat, node]));
const bySide = (selector) => Object.fromEntries(SIDES.map((side) => [side, $(selector + '[data-side="' + side + '"]')]));
const el = {
  tags: Object.fromEntries(SIDES.map((side) => [side, $$('[data-part="tag"][data-side="' + side + '"]')])),
  logs: $$('[data-part="log"]'), dishes: bySide('[data-part="dishes"]'), stacks: bySide('[data-part="stack"]'),
  pointers: bySide('[data-part="pointer"]'), lamps: bySide('[data-part="lamp"]'), domes: bySide('[data-part="dome"]'), traces: bySide('[data-part="trace"]'),
  heads: bySide('[data-part="head"]'), gantry: Object.fromEntries(SIDES.map((side) => [side, $$('[data-part^="gantry"][data-side="' + side + '"]')])),
  flash: $('[data-part="flash"]'), check: $('[data-part="check"]'), needle: $('[data-part="needle"]'), ledger: $('[data-part="ledger"]'),
  pen: $('[data-part="pen"]'), wires: $('[data-part="wires"]'),
};
const REST = ${JSON.stringify(REST)};
const still = matchMedia("(prefers-reduced-motion: reduce)");
const move = (node, offset) => node.setAttribute("transform", translateAlong(P, offset));
const lit = (node, on) => node.querySelectorAll(".iso-solid").forEach((solid) => (on ? solid.setAttribute("data-lit", "") : solid.removeAttribute("data-lit")));
const cache = new Map();
const once = (key, value) => { if (cache.get(key) === value) return false; cache.set(key, value); return true; };
const fmt = (ms) => (ms >= 1 ? ms.toFixed(0) : ms > 0 ? ms.toFixed(2) : "0") + "ms";
function draw(t) {
  const s = stateAt(t);
  if (once("phase", s.phase)) buttons.forEach((button, index) => (index === s.phase ? button.setAttribute("aria-current", "step") : button.removeAttribute("aria-current")));
  for (const side of SIDES) {
    const v = s[side];
    v.roles.forEach((role, i) => { const on = v.tags[i]; if (once("tag" + side + i, role + on)) el.tags[side][i].innerHTML = parts.tag(side, i, role, on); });
    const list = [...v.dishes].sort((a, b) => (a.lit - b.lit) || (depthOf(a.at, P) - depthOf(b.at, P)));
    el.dishes[side].innerHTML = list.map((d) => '<g style="opacity:' + (d.presence * (1 - 0.6 * d.dim)).toFixed(3) + '">' + parts.dish(d.at, d.mark, d.lit) + "</g>").join("");
    for (const node of el.gantry[side]) move(node, [v.gantry.x - REST[side], 0, 0]);
    if (once("head" + side, v.gantry.on)) lit(el.heads[side], v.gantry.on);
    el.lamps[side].style.opacity = v.stopped ? "1" : "0";
    if (once("dome" + side, v.stopped)) lit(el.domes[side], v.stopped);
    el.stacks[side].innerHTML = parts.stack(side, v.tickets, v.stopped);
    move(el.pointers[side], [0, (Math.floor(v.work / 0.3) % 7) * 1.6, 0]);
    el.traces[side].style.opacity = s.trace.fade.toFixed(3);
    el.traces[side].innerHTML = parts.trace(side, s.trace[side]);
  }
  s.g1.logs.forEach((on, i) => { if (once("log" + i, on)) el.logs[i].innerHTML = parts.log("g1", i, on); });
  if (once("flash", s.g1.flash)) lit(el.flash, s.g1.flash);
  if (once("check", s.z.check > 0.3)) lit(el.check, s.z.check > 0.3);
  el.needle.setAttribute("d", parts.needle(s.g1.dial));
  const ledgerKey = s.z.ledger.map((e) => e.id + e.lit).join();
  if (once("ledger", ledgerKey)) el.ledger.innerHTML = parts.ledger(s.z.ledger);
  const penX = s.trace.g1.pen;
  el.pen.innerHTML = parts.pen(penX, [[LANE.g1, s.g1.stopped], [LANE.z, s.z.stopped]]);
  const wires = [];
  for (const side of SIDES) {
    const v = s[side];
    for (const w of v.wires) {
      const from = w.heap ? w.from.at : parts.ticketAnchor(side, w.from.ticket, v.tickets);
      if (!from || w.alpha < 0.01) continue;
      const path = parts.wire(from, w.to);
      wires.push('<g class="iso-wire" data-tone="mid" style="opacity:' + w.alpha.toFixed(3) + '"><path class="iso-line" data-tone="' + (w.stale ? "lo" : "mid") + '" d="' + path.d + '"/><circle class="iso-wire-end" cx="' + path.from[0].toFixed(1) + '" cy="' + path.from[1].toFixed(1) + '" r="0.9"/><circle class="iso-wire-end" cx="' + path.to[0].toFixed(1) + '" cy="' + path.to[1].toFixed(1) + '" r="0.9"/></g>');
      if (w.heap) wires.push(parts.bead(from, w.stale));
    }
  }
  el.wires.innerHTML = wires.join("");
  const text = readoutOf(s);
  if (readout.textContent !== text) readout.textContent = text;
  const values = { g1n: s.g1.pauses + "번", g1max: fmt(s.g1.longest), g1sum: fmt(s.g1.total), zn: s.z.pauses + "번", zmax: fmt(s.z.longest), zsum: fmt(s.z.total), zstall: s.z.stalls ? s.z.stalls + "번 · " + fmt(s.z.stallMs) : "0번" };
  for (const [id, value] of Object.entries(values)) if (stat[id].textContent !== value) stat[id].textContent = value;
  stage.setAttribute("aria-valuenow", String(s.phase + 1));
  stage.setAttribute("aria-valuetext", PHASES[s.phase].name + ": " + text);
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
function go(phase) {
  const index = (phase + PHASES.length) % PHASES.length;
  t = STARTS[index] + 0.001;
  hold = STARTS[index] + PHASES[index].seconds - (index === PHASES.length - 1 ? PHASES[index].seconds * 0.32 : 0.02);
  if (still.matches) { t = STILL[index]; draw(t); }
  clearTimeout(idle);
  idle = setTimeout(() => { if (!still.matches) { hold = null; run(); } }, IDLE);
  run();
}
// 움직임을 줄인 경우 단계마다 보여 줄 한 장면.
const STILL = PHASES.map((phase, index) => STARTS[index] + phase.seconds * [0.9, 0.45, 0.5, 0.62, 0.5, 0.6, 0.5][index]);
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); else { cancelAnimationFrame(frame); frame = 0; } }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("click", () => go(phaseAt(t).index + 1));
stage.addEventListener("keydown", (event) => {
  const here = phaseAt(t).index;
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === " ") to = here + 1;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = here - 1;
  if (event.key === "Home") to = 0;
  if (event.key === "End") to = PHASES.length - 1;
  if (/^[1-7]$/.test(event.key)) to = Number(event.key) - 1;
  if (to === null) return;
  event.preventDefault();
  go(to);
});
buttons.forEach((button, index) => button.addEventListener("click", () => go(index)));
window.__gc = { draw, stateAt, go, set: (time) => { t = time; hold = time; draw(time); } };
if (still.matches) go(4); else draw(t);
`;

const start = M.stateAt(0.001);
const body = k.plateHtml({
  fig: "Fig 3",
  title: "G1 과 ZGC",
  hint: "클릭 · ← → · 1–7 로 단계 이동",
  readout: M.readoutOf(start),
  keys: [
    { mark: "lit", label: "지금 옮기거나 확인하는 것 · 램프 = 그 요리사가 멈춤" },
    { mark: "raised", label: "접시 위 점 = 표시됨(살아 있음) · 흐린 접시 = 쓰레기로 판명" },
    { mark: "edge", label: "끈 = 참조 · 끈 끝 구슬 = 색깔 포인터(빈 고리 = 옛 주소)" },
  ],
  caption:
    "칸 하나가 같은 크기의 region 하나입니다(이 맥의 JDK 21 G1 은 4MB). G1 은 JDK 9 부터 기본 GC 이고 멈춤 목표 MaxGCPauseMillis 기본값은 200ms 입니다. ZGC 는 JDK 15 부터 정식, 세대별 ZGC 는 JDK 21 에서 -XX:+ZGenerational 로 켜고 JDK 23 부터 기본, JDK 24 부터 유일한 모드입니다. 기록계의 ms 는 로컬 실험(같은 프로그램, 힙 3GB) 로그 크기에 맞춘 설명용 값입니다: G1 Young 14ms·Remark 0.4ms·Full 110ms, ZGC 멈춤 0.01ms·할당 대기 최대 40ms. 칸당 60ms 예측과 접시 배치는 설명을 위한 단순화입니다.",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="G1 과 ZGC: 클릭하거나 화살표 키로 단계를 옮깁니다" aria-valuemin="1" aria-valuemax="7" aria-valuenow="1">${svg}</div>`,
});

const name = theme === "light" ? "g1-zgc-light.html" : "g1-zgc.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "G1 과 ZGC", theme, body: LEGEND_CSS + PAGE_CSS + body + statsHtml + legendBlock + stepsHtml, script: kitScript() + live, width: 740 }).replace('<html lang="en">', '<html lang="ko">'));
console.log("wrote", name);
