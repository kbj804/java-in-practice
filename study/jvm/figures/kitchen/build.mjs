import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeParts } from "./parts.mjs";
import { DISHES, LINES, PHASES, THRESHOLD, DIAL_MAX, GANTRY, stateAt, readoutOf } from "./model.mjs";

// Anatomy 스킬의 kit 을 쓴다: ANATOMY_HOME 이 없으면 ~/.claude/skills/anatomy.
const SKILL = process.env.ANATOMY_HOME || join(homedir(), ".claude/skills/anatomy");
const k = await import(pathToFileURL(join(SKILL, "kit/iso-kit.mjs")).href);
const { kitScript } = await import(pathToFileURL(join(SKILL, "scripts/inline-kit.mjs")).href);

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 640;
const HEIGHT = 420;

const PLATE = { x: -182, y: -88, w: 346, d: 168, r: 10 };
const PLATE_H = 10;
const FOOT_H = 5;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-170, -76, 100], [-118, -63, 103], [150, -80, 94], [-60, -44, 70], [92, 44, 70]],
  WIDTH,
  HEIGHT,
  { pad: 34, azimuth: 55, elevation: 32 },
);
const parts = makeParts(k, P);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const slab = (plan, z, h, style = {}, steps = 3, bevel = 0) => S(k.slabOf(plan, z, h, P, steps, bevel), style);
const cyl = (x, y, r, z, h, style = {}, steps = 24, bevel = 0) => S(k.cylinder(x, y, r, z, h, P, steps, bevel), style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const screws = (points, z, size = 0.45) => D(points.map(([x, y]) => at([x, y, z])), { size });
// +y 면(정면) 위의 닫힌 슬롯.
const frontSlot = (x0, x1, z0, z1, y, r = 0.8) => k.pathOf(k.roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, 4).map(([x, z]) => at([x, y, z])), true);
// 상자 정면(+y)의 세로 줄: 면의 아래부터 위까지.
const frontRise = (x, y, z0, z1) => k.segment([x, y, z0], [x, y, z1], P);
const group = (attrs, body) => `<g ${Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(" ")}>${body}</g>`;

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
  // 바닥 타일 줄: 판의 홈에서 홈까지.
  const inner = k.insetPlan(PLATE, 5);
  const tiles = [];
  for (let x = inner.x + 34; x < inner.x + inner.w - 20; x += 34) tiles.push(k.lineOnTop([x, inner.y], [x, inner.y + inner.d], 0, P));
  out.push(L(tiles.join(""), { tone: "faint" }));
  const strip = { x: -60, y: PLATE.y + PLATE.d - 13, w: 168, d: 6, r: 1 };
  out.push(slab(strip, 0, 0.6, { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [1.8, 3.4], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(screws([[strip.x + 2, strip.y + 3], [strip.x + strip.w - 2, strip.y + 3]], 0.6));
  const label = { x: -172, y: PLATE.y + PLATE.d - 16, w: 40, d: 9, r: 1.2 };
  out.push(slab(label, 0, 0.8, { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 3), { tone: "faint" }));
  out.push(L([28, 20, 24].map((w, i) => k.lineOnTop([label.x + 4, label.y + 2.6 + i * 2], [label.x + 4 + w, label.y + 2.6 + i * 2], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(screws([[label.x + label.w - 3, label.y + 3], [label.x + label.w - 3, label.y + label.d - 3]], 0.8));
  return out.join("");
}

// ① 클래스 로더: 3층 레시피 카드 선반과 리프트.
const RACK = { x: -168, y: -74, w: 44, d: 30 };
const CARD_H = [16, 13, 15, 16];
const OUR_CARD = { x: -161 + 3 * 8, y: -70, w: 1.4, d: 18, r: 0.3 };
function rack() {
  const out = [];
  out.push(slab({ x: RACK.x - 2, y: RACK.y - 2, w: RACK.w + 4, d: RACK.d + 4, r: 2 }, 0, 6, { tone: "lo" }, 4, 0.6));
  out.push(slab({ x: RACK.x, y: RACK.y - 2, w: RACK.w, d: 2, r: 0.4 }, 6, 90, { tone: "mid" }));
  out.push(slab({ x: RACK.x, y: RACK.y, w: 3, d: RACK.d, r: 0.5 }, 6, 90, { tone: "mid" }));
  parts.SHELF_Z.forEach((z, level) => {
    const shelf = { x: RACK.x + 3, y: RACK.y, w: RACK.w - 6, d: RACK.d, r: 0.5 };
    out.push(slab(shelf, z - 2.5, 2.5, { tone: "mid" }, 3, 0.4));
    const lip = { x: shelf.x + 4, y: RACK.y + RACK.d - 0.2, w: 12, d: 0.6, r: 0.2 };
    out.push(slab(lip, z - 2.3, 2, { tone: "lo", crease: "none" }));
    CARD_H.forEach((h, i) => {
      if (level === 0 && i === 3) return;
      const card = { x: -161 + i * 8, y: -70, w: 1.4, d: 18, r: 0.3 };
      out.push(slab(card, z, h, { tone: level === 2 ? "hi" : "mid", crease: "lo" }, 2));
    });
  });
  // 지점 선반의 빈 자리: 우리 카드가 들어 있던 홈.
  out.push(L(k.planOutline({ ...OUR_CARD, x: OUR_CARD.x - 0.4, w: 2.2 }, parts.SHELF_Z[0], P, 2), { tone: "faint" }));
  out.push(group({ "data-part": "rack-card", "data-litgroup": "1" }, slab(OUR_CARD, parts.SHELF_Z[0], CARD_H[3], { tone: "hi", crease: "lo" }, 2)));
  out.push(slab({ x: RACK.x + RACK.w - 3, y: RACK.y, w: 3, d: RACK.d, r: 0.5 }, 6, 90, { tone: "mid" }));
  out.push(L(parts.SHELF_Z.map((z) => frontRise(RACK.x + RACK.w - 1.5, RACK.y + RACK.d, z - 2.5, z)).join(""), { tone: "faint" }));
  out.push(slab({ x: RACK.x - 2, y: RACK.y - 2, w: RACK.w + 4, d: RACK.d + 4, r: 1.6 }, 96, 3, { tone: "mid" }, 4, 0.8));
  out.push(screws(k.corners({ x: RACK.x - 2, y: RACK.y - 2, w: RACK.w + 4, d: RACK.d + 4 }, 3), 99));
  return out.join("");
}
function liftStatic() {
  const foot = { x: parts.LIFT.x - 5, y: parts.LIFT.y - 5, w: 10, d: 10, r: 1.5 };
  return [
    slab(foot, 0, 3, { tone: "mid" }, 3, 0.4),
    screws(k.corners(foot, 1.8), 3),
  ].join("");
}
function liftTop() {
  const { x, y } = parts.LIFT;
  return [cyl(x, y, 3, 100, 2.2, { tone: "mid" }, 24, 0.3), L(k.ring(x, y, 1, 102.2, P, 12), { tone: "lo" })].join("");
}

// ② Method Area: 레시피 보관함과 static 재료통.
const CAB = { x: -102, y: -76, w: 46, d: 26, r: 2 };
const TRAY = { x: -74, y: -74, w: 14, d: 14, r: 1.5 };
const INGREDIENT = { x: -71, y: -71, w: 8, d: 8, r: 1 };
function cabinet() {
  const out = [];
  out.push(slab({ ...k.insetPlan(CAB, 1), r: 1 }, 0, 3, { tone: "lo" }, 3));
  out.push(slab(CAB, 3, 41, { tone: "mid" }, 4, 0.6));
  const front = CAB.y + CAB.d;
  for (const [z0, z1] of [[5, 15.5], [17.5, 28]]) {
    out.push(slab({ x: CAB.x + 3, y: front, w: 40, d: 1.6, r: 0.6 }, z0, z1 - z0, { tone: "mid" }, 3, 0.3));
    out.push(slab({ x: CAB.x + 19, y: front + 1.6, w: 8, d: 1.2, r: 0.5 }, (z0 + z1) / 2 - 0.7, 1.4, { tone: "mid", crease: "none" }, 2));
    out.push(slab({ x: CAB.x + 6, y: front + 1.6, w: 8, d: 0.6, r: 0.2 }, z0 + 3, 4, { tone: "lo", crease: "none" }, 2));
  }
  out.push(group({ "data-part": "drawer" }, parts.drawer(0)));
  const lid = { x: CAB.x - 2, y: CAB.y - 2, w: CAB.w + 4, d: CAB.d + 4, r: 1.6 };
  out.push(slab(lid, 44, 2, { tone: "mid" }, 4, 0.6));
  for (const [x, y] of byDepth([[-96, -70], [-88, -70], [-96, -60], [-88, -60]])) {
    out.push(cyl(x, y, 3.4, 46, 8, { tone: "mid", crease: "lo" }, 24));
    out.push(L(k.sideArc(x, y, 3.4, 50, P, 16), { tone: "faint" }));
    out.push(cyl(x, y, 3.8, 54, 1.8, { tone: "mid" }, 24, 0.3));
    out.push(cyl(x, y, 1.2, 55.8, 1, { tone: "mid" }, 12));
  }
  out.push(slab(TRAY, 46, 3, { tone: "mid" }, 3, 0.4));
  out.push(L(k.planOutline(k.insetPlan(TRAY, 1.4), 49, P, 3), { tone: "lo" }));
  out.push(group({ "data-part": "ingredient", "data-litgroup": "2" }, slab(INGREDIENT, 47.6, 4.4, { tone: "hi", crease: "lo" }, 3, 0.3)));
  return out.join("");
}

// ③ 코드 캐시: 밀키트 냉장 선반.
const FRIDGE = { x: 106, y: -80, w: 46, d: 42 };
const KIT = { x: 114, y: -72, w: 18, d: 16, r: 1 };
function fridge() {
  const out = [];
  out.push(slab({ ...FRIDGE, r: 2 }, 0, 4, { tone: "lo" }, 4, 0.5));
  out.push(slab({ x: FRIDGE.x + 1, y: FRIDGE.y + 1, w: FRIDGE.w - 2, d: 2, r: 0.4 }, 4, 80, { tone: "mid" }));
  const post = (x, y) => slab({ x, y, w: 3, d: 3, r: 0.6 }, 4, 80, { tone: "mid" }, 2);
  out.push(post(FRIDGE.x + 1, FRIDGE.y + 1), post(FRIDGE.x + FRIDGE.w - 4, FRIDGE.y + 1));
  // 먼저 컴파일된 다른 메서드들.
  for (const [x, w] of [[110, 14], [127, 18]]) {
    const box = { x, y: -70, w, d: 18, r: 1 };
    out.push(slab(box, 4, 9, { tone: "mid", crease: "lo" }, 3, 0.3));
    out.push(L(k.lineOnTop([box.x, box.y + 6], [box.x + box.w, box.y + 6], 13, P), { tone: "faint" }));
  }
  for (const z of [22, 46]) {
    const shelf = { x: FRIDGE.x + 1, y: FRIDGE.y + 3, w: FRIDGE.w - 2, d: FRIDGE.d - 4, r: 0.6 };
    out.push(slab(shelf, z, 2, { tone: "mid" }, 3, 0.4));
    out.push(D(k.dotGrid(shelf.x + 4, shelf.y + 4, 10, 8, 4.2, z + 2, P), { size: 0.35, tone: "lo" }));
  }
  const old = { x: 136, y: -70, w: 12, d: 16, r: 1 };
  out.push(slab(old, 24, 8, { tone: "mid", crease: "lo" }, 3, 0.3));
  out.push(group({ "data-part": "kit", "data-litgroup": "4" }, slab(KIT, 48, 10, { tone: "hi", crease: "lo" }, 3, 0.4) + L(k.lineOnTop([KIT.x, KIT.y + 5], [KIT.x + KIT.w, KIT.y + 5], 58, P), { tone: "lo" }) + D([at([KIT.x + KIT.w - 3, KIT.y + KIT.d - 3, 58])], { size: 0.55, tone: "hi" })));
  out.push(post(FRIDGE.x + 1, FRIDGE.y + FRIDGE.d - 4), post(FRIDGE.x + FRIDGE.w - 4, FRIDGE.y + FRIDGE.d - 4));
  for (const z of [22, 46]) out.push(slab({ x: FRIDGE.x + 4, y: FRIDGE.y + FRIDGE.d - 1.4, w: FRIDGE.w - 8, d: 0.6, r: 0.2 }, z, 2, { tone: "lo", crease: "none" }));
  const top = { ...FRIDGE, r: 2 };
  out.push(slab(top, 84, 10, { tone: "mid" }, 4, 0.8));
  const vents = [];
  for (let i = 0; i < 6; i++) vents.push(frontSlot(FRIDGE.x + 8 + i * 5.4, FRIDGE.x + 10.4 + i * 5.4, 86.5, 91.5, FRIDGE.y + FRIDGE.d));
  out.push(L(vents.join(""), { tone: "lo" }));
  out.push(D([at([FRIDGE.x + FRIDGE.w - 6, FRIDGE.y + FRIDGE.d, 89])], { size: 0.8, tone: "hi" }));
  out.push(screws(k.corners(top, 3), 94));
  return out.join("");
}

// ④ GC 갠트리.
const RAIL_X = [-74, 104];
const RAILS = [-44, 38];
function rails() {
  const out = [];
  for (const y of RAILS) {
    out.push(slab({ x: RAIL_X[0], y, w: RAIL_X[1] - RAIL_X[0], d: 6, r: 1 }, 0, 1.6, { tone: "lo" }, 3, 0.3));
    out.push(L(k.lineOnTop([RAIL_X[0], y + 3], [RAIL_X[1], y + 3], 1.6, P), { tone: "faint" }));
    for (const x of [RAIL_X[0] - 4, RAIL_X[1]]) {
      out.push(slab({ x, y: y - 1, w: 4, d: 8, r: 1 }, 0, 5, { tone: "mid" }, 2, 0.4));
      out.push(screws([[x + 2, y + 1.5], [x + 2, y + 6.5]], 5));
    }
  }
  return out.join("");
}
const GX = GANTRY[0];
function upright(y) {
  const truck = { x: GX - 7, y: y - 1, w: 14, d: 8, r: 1.4 };
  return [
    slab(truck, 1.6, 4, { tone: "mid" }, 3, 0.4),
    screws([[truck.x + 2, truck.y + 2], [truck.x + truck.w - 2, truck.y + truck.d - 2]], 5.6),
    slab({ x: GX - 3, y, w: 6, d: 6, r: 0.8 }, 5.6, 56.4, { tone: "mid" }, 2, 0.3),
  ].join("");
}
function beam() {
  const beamPlan = { x: GX - 4, y: RAILS[0] - 1, w: 8, d: RAILS[1] - RAILS[0] + 8, r: 1 };
  const bar = { x: GX - 3, y: -26, w: 6, d: 52, r: 1 };
  return [
    cyl(GX, -18, 0.8, 50, 12, { tone: "mid", crease: "none" }, 12),
    group({ "data-litgroup": "5" }, slab(bar, 47, 3, { tone: "hi", crease: "lo" }, 3, 0.3)),
    L([-20, -10, 0, 10, 20].map((y) => k.lineOnTop([bar.x, bar.y + 26 + y], [bar.x + bar.w, bar.y + 26 + y], 50, P)).join(""), { tone: "lo" }),
    cyl(GX, 18, 0.8, 50, 12, { tone: "mid", crease: "none" }, 12),
    slab(beamPlan, 62, 5, { tone: "mid" }, 3, 0.6),
    screws([[GX, beamPlan.y + 3], [GX, beamPlan.y + beamPlan.d - 3]], 67),
    cyl(GX, 0, 2.6, 67, 2.6, { tone: "mid" }, 20),
    cyl(GX, 0, 1.6, 69.6, 1.6, { tone: "hi", crease: "lo" }, 16),
    `<g data-part="beacon" style="opacity:0">${D([at([GX, 0, 71.2])], { size: 1.4, tone: "hi", pulse: true })}</g>`,
  ].join("");
}

// ⑤ Heap: 공용 조리대와 접시.
const COUNTER = { x: -48, y: -30, w: 132, d: 60, r: 3 };
const COUNTER_TOP = 35;
export const dishX = (slot) => -32 + slot[0] * 30;
const dishY = (slot) => -14 + slot[1] * 26;
function counter() {
  const out = [];
  out.push(slab(k.insetPlan(COUNTER, 2), 0, 4, { tone: "lo" }, 4));
  out.push(slab(COUNTER, 4, 28, { tone: "mid" }, 4, 0.5));
  const front = COUNTER.y + COUNTER.d;
  out.push(L([-15, 18, 51].map((x) => frontRise(x, front, 4, 32)).join(""), { tone: "lo" }));
  for (const x of [-34, -2, 31, 64]) {
    out.push(slab({ x: x - 3, y: front, w: 6, d: 1, r: 0.4 }, 26, 1.4, { tone: "mid", crease: "none" }, 2));
  }
  const top = k.insetPlan(COUNTER, -2);
  out.push(slab(top, 32, 3, { tone: "mid" }, 4, 0.8));
  out.push(L(k.planOutline(k.insetPlan(top, 4), COUNTER_TOP, P, 4), { tone: "faint" }));
  out.push(screws(k.corners(top, 2.4), COUNTER_TOP));
  return out.join("");
}
function dish(slot) {
  const x = dishX(slot);
  const y = dishY(slot);
  return [
    cyl(x, y, 8, COUNTER_TOP, 1.4, { tone: "hi", crease: "lo" }, 40, 0.4),
    L(k.ring(x, y, 6, COUNTER_TOP + 1.4, P, 32), { tone: "faint" }),
    cyl(x, y, 4.6, COUNTER_TOP + 1.4, 3.4, { tone: "hi", crease: "lo" }, 28),
    L(k.sideArc(x, y, 4.6, COUNTER_TOP + 2.6, P, 18), { tone: "faint" }),
    D([at([x + 1.4, y - 1, COUNTER_TOP + 4.8])], { size: 0.6, tone: "mid" }),
  ].join("");
}
const BIN = { x: 90, y: -12, w: 16, d: 24, r: 2 };
function bin() {
  return [
    slab(BIN, 0, 22, { tone: "mid" }, 4, 0.5),
    L(k.planOutline(k.insetPlan(BIN, 1.6), 22, P, 3), { tone: "lo" }),
    `<path class="iso-halo" d="${k.pathOf(k.roundedPlan(k.insetPlan(BIN, 2.2), 3).map(([x, y]) => at([x, y, 22])), true)}" style="opacity:.5"/>`,
    slab({ x: BIN.x + BIN.w, y: BIN.y + 8, w: 2, d: 8, r: 0.5 }, 1, 2, { tone: "mid", crease: "none" }, 2),
    L(k.sideSeam(BIN, 18, P, 4), { tone: "faint" }),
  ].join("");
}

// ⑥ 요리사 자리(스레드): 주문서 꽂이(Stack)와 레시피 카드 + PC 포인터.
function stationBase(thread) {
  const cx = parts.STATIONS[thread];
  const plan = { x: cx - 16, y: 46, w: 32, d: 20, r: 2 };
  const sx = cx - 8;
  const holder = { x: cx + 1, y: 49, w: 13, d: 14, r: 1 };
  const card = { x: cx + 3, y: 50, w: 9, d: 12, r: 0.4 };
  return [
    `<path class="iso-halo" d="${k.haloOf(plan, 0, 0.1, P)}" style="filter:blur(3px)"/>`,
    slab(plan, 0, 4, { tone: "mid" }, 4, 0.5),
    screws(k.corners(plan, 2.2), 4),
    cyl(sx, parts.SPIKE_Y, 4, 4, 2, { tone: "mid" }, 24, 0.3),
    slab(holder, 4, 2.4, { tone: "mid" }, 3, 0.3),
    slab(card, 6.4, 0.4, { tone: "hi", crease: "none" }, 2),
    L(Array.from({ length: LINES }, (_, i) => k.lineOnTop([card.x + 1.6, card.y + 1.2 + i * 1.6], [card.x + card.w - (i % 3 === 1 ? 3 : 1.4), card.y + 1.2 + i * 1.6], 6.8, P)).join(""), { tone: "lo", free: true }),
  ].join("");
}
function pointer(thread) {
  const cx = parts.STATIONS[thread];
  const tab = { x: cx + 1.2, y: 50.4, w: 2.2, d: 1.6, r: 0.4 };
  return slab(tab, 6.4, 1.2, { tone: "hi", crease: "lo" }, 2);
}

// 카드 인쇄기(javac).
const PRINTER = { x: -170, y: 22, w: 34, d: 36, r: 3 };
const PRINT_CARD = { x: -162, y: 58.6, w: 18, d: 12, r: 0.5 };
function printer() {
  const out = [];
  const front = PRINTER.y + PRINTER.d;
  out.push(slab(k.insetPlan(PRINTER, 1.5), 0, 2, { tone: "lo" }, 3));
  out.push(slab(PRINTER, 2, 20, { tone: "mid" }, 4, 0.6));
  out.push(L(k.sideSeam(PRINTER, 14, P, 4), { tone: "faint" }));
  out.push(L(frontSlot(-163, -143, 9.4, 11.4, front, 0.8), { tone: "lo" }));
  out.push(slab(k.insetPlan(PRINTER, 2), 22, 2.4, { tone: "mid" }, 3, 0.4));
  const hopper = { x: -166, y: 26, w: 22, d: 20, r: 1 };
  out.push(slab(hopper, 24.4, 1.2, { tone: "lo" }, 2));
  out.push(slab({ x: hopper.x + 2, y: hopper.y + 2, w: 18, d: 15, r: 0.4 }, 25.6, 0.6, { tone: "hi", crease: "none" }, 2));
  out.push(slab({ x: hopper.x + 2.6, y: hopper.y + 2.6, w: 18, d: 15, r: 0.4 }, 26.2, 0.6, { tone: "hi", crease: "lo" }, 2));
  out.push(L([4, 7, 10, 13].map((dy, i) => k.lineOnTop([hopper.x + 4.6, hopper.y + 2.6 + dy], [hopper.x + (i % 2 ? 14 : 18), hopper.y + 2.6 + dy], 26.8, P)).join(""), { tone: "lo", free: true }));
  out.push(cyl(-141, 50, 3.6, 24.4, 3.6, { tone: "mid" }, 28));
  out.push(L(k.knurl(-141, 50, 3.6, 24.4, 28, 24, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([-141, 50], [-141 + 3.6, 50], 28, P), { tone: "hi" }));
  out.push(cyl(-150, 54, 1.4, 24.4, 1, { tone: "hi", crease: "lo" }, 14));
  // 출력 받침대와 다리.
  const tray = { x: -165, y: front, w: 24, d: 14, r: 0.8 };
  for (const x of [tray.x + 1.5, tray.x + tray.w - 3.5]) out.push(slab({ x, y: front + tray.d - 3, w: 2, d: 2, r: 0.4 }, 0, 8.6, { tone: "mid" }, 2));
  out.push(slab(tray, 8.6, 0.8, { tone: "mid" }, 3, 0.3));
  out.push(group({ "data-part": "print-card", "data-litgroup": "0" }, slab(PRINT_CARD, 9.4, 0.6, { tone: "hi", crease: "lo" }, 2) + L([3, 6, 9].map((dy, i) => k.lineOnTop([PRINT_CARD.x + 2, PRINT_CARD.y + dy], [PRINT_CARD.x + (i === 1 ? 11 : 15), PRINT_CARD.y + dy], 10, P)).join(""), { tone: "lo", free: true })));
  return out.join("");
}

// 호출 횟수 다이얼.
function dial() {
  const { x, y, r, top } = parts.DIAL;
  const plan = { x: 112, y: 26, w: 34, d: 30, r: 3 };
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(plan, 0, 0.1, P)}" style="filter:blur(3px)"/>`);
  out.push(slab(plan, 0, 6, { tone: "mid" }, 4, 0.6));
  out.push(screws(k.corners(plan, 2.6), 6));
  out.push(cyl(x, y, 6, 6, 2, { tone: "mid" }, 28, 0.3));
  out.push(cyl(x, y, 3.6, 8, top - 7 - 8, { tone: "mid", crease: "none" }, 24));
  out.push(L(k.sideArc(x, y, 3.6, 18, P, 14), { tone: "faint" }));
  out.push(cyl(x, y, r, top - 7, 7, { tone: "hi", crease: "lo" }, 64, 0.8));
  out.push(L(k.knurl(x, y, r, top - 2.6, top, 72, P, 0.3), { tone: "lo" }));
  out.push(L(k.sideArc(x, y, r, top - 2.6, P, 40), { tone: "faint" }));
  out.push(L(k.ring(x, y, r - 1.8, top, P, 64), { tone: "lo" }));
  const ticks = k.radialTicks(x, y, r - 2.4, 48, 4, top, [1.2, 2.4], P, -Math.PI * parts.SPAN, Math.PI * 2 * parts.SPAN);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  const mark = -Math.PI * parts.SPAN + (THRESHOLD / DIAL_MAX) * Math.PI * 2 * parts.SPAN;
  out.push(L(k.lineOnTop([x + Math.sin(mark) * (r - 1.8), y - Math.cos(mark) * (r - 1.8)], [x + Math.sin(mark) * (r - 6), y - Math.cos(mark) * (r - 6)], top, P), { tone: "hi" }));
  out.push(`<path data-part="needle" class="iso-line" data-tone="hi" data-free="start" d="${parts.needle(0, DIAL_MAX)}" style="stroke-width:1.1"/>`);
  out.push(L(k.ring(x, y, 1.4, top, P, 14), { tone: "mid" }));
  out.push(D([at([x, y, top])], { size: 0.7, tone: "hi" }));
  return out.join("");
}

const start = stateAt(0.001);
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "JVM 을 식당 주방으로 그린 그림. 왼쪽 뒤에 3층 레시피 카드 선반과 리프트(클래스 로더), 그 옆에 서랍장과 재료통(Method Area), 가운데 큰 공용 조리대와 접시(Heap 과 객체), 앞에 요리사 두 명의 주문서 꽂이와 레시피 카드(JVM Stack 과 PC), 오른쪽 뒤에 밀키트 냉장 선반(코드 캐시), 오른쪽 앞에 호출 횟수 다이얼(핫스팟 감지), 조리대 위를 지나가는 청소 갠트리(GC), 왼쪽 앞에 카드 인쇄기(javac)가 있다.",
  body: [
    base(),
    rack(),
    liftStatic(),
    `<g data-part="lift">${parts.lift(0, false)}</g>`,
    liftTop(),
    cabinet(),
    fridge(),
    rails(),
    `<g data-part="gantry-back">${upright(RAILS[0])}</g>`,
    counter(),
    ...DISHES.map((d) => `<g data-part="dish" data-id="${d.id}" style="opacity:0">${dish(d.slot)}</g>`),
    bin(),
    `<g data-part="gantry-top">${beam()}</g>`,
    `<g data-part="gantry-front">${upright(RAILS[1])}</g>`,
    ...[0, 1].map((t) => stationBase(t) + `<g data-part="pointer" data-thread="${t}" data-litgroup="3">${pointer(t)}</g><g data-part="stack" data-thread="${t}"></g>`),
    printer(),
    dial(),
    `<g data-part="wires"></g>`,
  ],
});

const STEPS = [
  ["빌드", "카드 인쇄기(javac)가 레시피 원고(.java)를 표준 레시피 카드(.class: 바이트코드 + 메타데이터)로 찍어 냅니다."],
  ["클래스 로딩", "리프트가 본사(Bootstrap) → 지역(Platform) → 지점(Application) 선반 순서로 카드를 찾습니다. 필요할 때만 꺼냅니다."],
  ["링킹·초기화", "검증 → 준비(static 재료통 = 0) → 해석 → 초기화(재료통에 진짜 값). 서랍장과 재료통이 Method Area 입니다."],
  ["인터프리터", "요리사 두 명(스레드)이 주문서 꽂이(JVM Stack)에 주문을 꽂고, 카드 옆 포인터(PC)로 한 줄씩 읽으며 접시(객체)를 조리대(Heap)에 올립니다."],
  ["JIT 컴파일", "다이얼(호출 횟수)이 임계값을 넘으면 그 메뉴를 밀키트(기계어)로 만들어 냉장 선반(코드 캐시)에 둡니다. 다음 주문은 카드를 읽지 않습니다."],
  ["GC", "주문서·재료통 어디와도 끈(참조)이 닿지 않는 접시를 청소 갠트리가 치웁니다. 그동안 요리사는 잠깐 멈춥니다(Stop-the-World)."],
];
const stepsHtml = `<ol class="jk-steps">${STEPS.map(([name, text], i) => `<li><button type="button" data-step="${i}"><span class="jk-n">${i + 1}</span><span><b>${name}</b> ${text}</span></button></li>`).join("")}</ol>`;
const STEP_CSS = `<style>
.jk-steps{list-style:none;margin:18px 0 0;padding:0;display:grid;gap:6px}
.jk-steps button{all:unset;box-sizing:border-box;width:100%;display:flex;gap:10px;align-items:baseline;padding:8px 12px;border-radius:10px;cursor:pointer;color:var(--anatomy-text);font-size:13px;line-height:1.55;border:1px solid transparent}
.jk-steps button:hover{background:var(--anatomy-card)}
.jk-steps button:focus-visible{outline:2px solid var(--anatomy-strong);outline-offset:1px}
.jk-steps button[aria-current="step"]{background:var(--anatomy-card);color:var(--anatomy-strong);border-color:var(--anatomy-faint)}
.jk-steps b{color:var(--anatomy-strong);font-weight:600;margin-right:4px}
.jk-n{flex:none;font:600 11px/18px var(--anatomy-mono);width:18px;height:18px;text-align:center;border-radius:50%;border:1px solid var(--anatomy-mid);color:var(--anatomy-strong)}
.jk-steps button[aria-current="step"] .jk-n{background:var(--anatomy-strong);color:var(--anatomy-card);border-color:var(--anatomy-strong)}
.iso-stage{cursor:pointer}
@media (max-width:520px){.iso-stage{overflow:hidden}.iso-stage>svg{transform:scale(1.16);transform-origin:50% 55%}}
</style>`;

const strip = (file) => readFileSync(join(HERE, file), "utf8").replace(/^export /gm, "").replace(/^import .*$/gm, "");
const live = `
${strip("model.mjs")}
${strip("parts.mjs")}
const k = { iso, slabOf, cylinder, solidSvg, lineSvg, dotsSvg, lineOnTop, ring, planOutline, pathOf };
const P = ${JSON.stringify(P)};
const parts = makeParts(k, P);
const dishX = (slot) => -32 + slot[0] * 30;
const KIT_FROM = 26, CARD_OUT = 12, PICK = 10, DROP = 16, PC_STEP = 1.6;
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const $ = (selector) => svg.querySelector(selector);
const $$ = (selector) => [...svg.querySelectorAll(selector)];
const readout = document.querySelector("[data-readout]");
const buttons = [...document.querySelectorAll("[data-step]")];
const el = {
  lift: $('[data-part="lift"]'), rackCard: $('[data-part="rack-card"]'), printCard: $('[data-part="print-card"]'),
  drawer: $('[data-part="drawer"]'), ingredient: $('[data-part="ingredient"]'), kit: $('[data-part="kit"]'),
  needle: $('[data-part="needle"]'), wires: $('[data-part="wires"]'), beacon: $('[data-part="beacon"]'),
  gantry: $$('[data-part^="gantry"]'), dishes: $$('[data-part="dish"]'),
  stacks: $$('[data-part="stack"]'), pointers: $$('[data-part="pointer"]'),
};
const still = matchMedia("(prefers-reduced-motion: reduce)");
const move = (node, offset) => node.setAttribute("transform", translateAlong(P, offset));
const DISH_AT = DISHES.map((dish) => [dishX(dish.slot), -14 + dish.slot[1] * 26, ${COUNTER_TOP} + 4.8]);
const STATIC_AT = [${INGREDIENT.x + INGREDIENT.w / 2}, ${INGREDIENT.y + INGREDIENT.d / 2}, 52];
let litPhase = -1;
function setLit(phase) {
  if (phase === litPhase) return;
  litPhase = phase;
  for (const node of $$('[data-litgroup] .iso-solid, [data-litgroup].iso-solid')) node.removeAttribute("data-lit");
  for (const group of $$('[data-litgroup="' + phase + '"]')) {
    for (const node of group.matches(".iso-solid") ? [group] : group.querySelectorAll(".iso-solid")) node.setAttribute("data-lit", "");
  }
    buttons.forEach((button, index) => (index === phase ? button.setAttribute("aria-current", "step") : button.removeAttribute("aria-current")));
}
function draw(t) {
  const s = stateAt(t, dishX);
  setLit(s.phase);
  move(el.printCard, [0, -CARD_OUT * (1 - s.printer), 0]);
  el.printCard.style.opacity = s.printer.toFixed(3);
  el.lift.innerHTML = parts.lift(s.lift, s.phase === 1);
  move(el.rackCard, [0, PICK * s.pick, 0]);
  el.drawer.innerHTML = parts.drawer(s.drawer);
  move(el.ingredient, [0, 0, DROP * (1 - s.ingredient)]);
  el.ingredient.style.opacity = s.ingredient.toFixed(3);
  move(el.kit, [0, KIT_FROM * (1 - s.kit), 0]);
  el.kit.style.opacity = s.kit.toFixed(3);
  for (const node of el.gantry) move(node, [s.gantryX - ${GX}, 0, 0]);
  el.beacon.style.opacity = s.gcOn ? "1" : "0";
  el.needle.setAttribute("d", parts.needle(s.calls, DIAL_MAX));
  s.dishes.forEach((dish, index) => {
    const node = el.dishes[index];
    node.style.opacity = dish.presence.toFixed(3);
    move(node, [0, 0, dish.lift]);
  });
  el.stacks.forEach((node, thread) => (node.innerHTML = parts.stack(thread, s.tickets, s.phase === 3)));
  el.pointers.forEach((node, thread) => move(node, [0, s.pc[thread] * PC_STEP, 0]));
  const wires = [];
  for (const dish of s.dishes) {
    if (dish.presence < 0.02) continue;
    let from, alpha = dish.presence;
    if (dish.from === "static") from = STATIC_AT;
    else if (dish.from.startsWith("d")) {
      const other = s.dishes[Number(dish.from.slice(1))];
      if (other.presence < 0.02) continue;
      from = [DISH_AT[other.id][0], DISH_AT[other.id][1], DISH_AT[other.id][2] + other.lift];
      alpha *= other.presence;
    } else {
      const ticket = s.tickets.find((item) => item.id === dish.from);
      if (!ticket || ticket.presence < 0.02) continue;
      from = parts.ticketAnchor(ticket, s.tickets);
      alpha *= ticket.presence;
    }
    const to = [DISH_AT[dish.id][0], DISH_AT[dish.id][1], DISH_AT[dish.id][2] + dish.lift];
    const w = parts.wire(from, to);
    wires.push('<g class="iso-wire" data-tone="mid" style="opacity:' + alpha.toFixed(3) + '"><path class="iso-line" data-tone="mid" d="' + w.d + '"/><circle class="iso-wire-end" cx="' + w.from[0].toFixed(1) + '" cy="' + w.from[1].toFixed(1) + '" r="0.9"/><circle class="iso-wire-end" cx="' + w.to[0].toFixed(1) + '" cy="' + w.to[1].toFixed(1) + '" r="0.9"/></g>');
  }
  el.wires.innerHTML = wires.join("");
  const text = readoutOf(s);
  if (readout.textContent !== text) readout.textContent = text;
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
  hold = STARTS[index] + PHASES[index].seconds - 0.02;
  if (still.matches) { t = hold; draw(t); }
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
if (still.matches) go(3); else draw(t);
`;

const body = k.plateHtml({
  fig: "Fig 1",
  title: "JVM 주방",
  hint: "클릭 · ← → · 1–6 으로 단계 이동",
  readout: readoutOf(start),
  keys: [
    { mark: "lit", label: "지금 일하는 부분" },
    { mark: "raised", label: "접시 = Heap 의 객체" },
    { mark: "edge", label: "끈 = 참조(주문서·재료통 → 접시)" },
  ],
  caption:
    "ByteByteGo「How the JVM Actually Works」의 다섯 단계를 식당 주방으로 옮겼습니다. 다이얼의 임계값 10,000 과 주문 수, 접시 수는 설명용 예시이고, 실제 HotSpot 의 컴파일 임계값은 계층형 컴파일 설정에 따라 다릅니다.",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="JVM 주방: 클릭하거나 화살표 키로 단계를 옮깁니다" aria-valuemin="1" aria-valuemax="6" aria-valuenow="1">${svg}</div>`,
});

const name = theme === "light" ? "kitchen-light.html" : "kitchen.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "JVM 주방", theme, body: STEP_CSS + body + stepsHtml, script: kitScript() + live, width: 720 }).replace('<html lang="en">', '<html lang="ko">'));
console.log("wrote", name);
