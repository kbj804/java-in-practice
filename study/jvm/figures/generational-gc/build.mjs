import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeParts } from "./parts.mjs";
import * as M from "./model.mjs";

// Anatomy 스킬의 kit 을 쓴다: ANATOMY_HOME 이 없으면 ~/.claude/skills/anatomy.
const SKILL = process.env.ANATOMY_HOME || join(homedir(), ".claude/skills/anatomy");
const k = await import(pathToFileURL(join(SKILL, "kit/iso-kit.mjs")).href);
const { kitScript } = await import(pathToFileURL(join(SKILL, "scripts/inline-kit.mjs")).href);

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 640;
const HEIGHT = 430;

const PLATE = { x: -192, y: -92, w: 336, d: 166, r: 10 };
const PLATE_H = 10;
const FOOT_H = 5;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-184, -52, 66], [-184, 28, 66], [1, -17, 50], [132, -86, 36], [-80, 58, 42]],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: 55, elevation: 36 },
);
const parts = makeParts(k, P, M);
const { COUNTER_TOP, TABLE_TOP, SURV, edenAt, oldAt } = M;

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const slab = (plan, z, h, style = {}, steps = 3, bevel = 0) => S(k.slabOf(plan, z, h, P, steps, bevel), style);
const cyl = (x, y, r, z, h, style = {}, steps = 24, bevel = 0) => S(k.cylinder(x, y, r, z, h, P, steps, bevel), style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const screws = (points, z, size = 0.45) => D(points.map(([x, y]) => at([x, y, z])), { size });
const frontRise = (x, y, z0, z1) => k.segment([x, y, z0], [x, y, z1], P);
const frontSlot = (x0, x1, z0, z1, y, r = 0.8) => k.pathOf(k.roundedPlan({ x: x0, y: z0, w: x1 - x0, d: z1 - z0, r }, 4).map(([x, z]) => at([x, y, z])), true);
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
  const tiles = [];
  for (let x = inner.x + 34; x < inner.x + inner.w - 20; x += 34) tiles.push(k.lineOnTop([x, inner.y], [x, inner.y + inner.d], 0, P));
  out.push(L(tiles.join(""), { tone: "faint" }));
  const label = { x: 78, y: PLATE.y + PLATE.d - 20, w: 40, d: 9, r: 1.2 };
  out.push(slab(label, 0, 0.8, { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 3), { tone: "faint" }));
  out.push(L([28, 20, 24].map((w, i) => k.lineOnTop([label.x + 4, label.y + 2.6 + i * 2], [label.x + 4 + w, label.y + 2.6 + i * 2], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(screws([[label.x + label.w - 3, label.y + 3], [label.x + label.w - 3, label.y + label.d - 3]], 0.8));
  return out.join("");
}

// 조리대 몸통 공통: 받침, 몸통, 정면 이음매와 손잡이, 상판.
function counterBody(plan, seams) {
  const out = [];
  out.push(slab(k.insetPlan(plan, 2), 0, 4, { tone: "lo" }, 4));
  out.push(slab(plan, 4, 22, { tone: "mid" }, 4, 0.5));
  const front = plan.y + plan.d;
  out.push(L(seams.map((x) => frontRise(x, front, 4, 26)).join(""), { tone: "lo" }));
  const edges = [plan.x, ...seams, plan.x + plan.w];
  for (let i = 0; i < edges.length - 1; i++) {
    const cx = (edges[i] + edges[i + 1]) / 2;
    out.push(slab({ x: cx - 3, y: front, w: 6, d: 1, r: 0.4 }, 20, 1.4, { tone: "mid", crease: "none" }, 2));
  }
  const top = k.insetPlan(plan, -2);
  out.push(slab(top, 26, 3, { tone: "mid" }, 4, 0.8));
  out.push(screws(k.corners(top, 2.4), COUNTER_TOP));
  return { out, top };
}

// ① Eden: 배식대. 8 × 4 자리와 범프 포인터 레일.
const EDEN = { x: -170, y: -40, w: 96, d: 56, r: 3 };
const BUMP_Y = 12;
function eden() {
  const { out, top } = counterBody(EDEN, [-138, -106]);
  out.push(L(k.planOutline(k.insetPlan(top, 3), COUNTER_TOP, P, 4), { tone: "faint" }));
  // 자리 표시: 접시가 놓이는 얕은 원.
  out.push(L(Array.from({ length: M.EDEN_CAP }, (_, i) => k.ring(edenAt(i)[0], edenAt(i)[1], 4.2, COUNTER_TOP, P, 20)).join(""), { tone: "faint" }));
  // 범프 포인터 레일: 다음 빈 열을 가리키는 탭이 이 위를 미끄러진다.
  const rail = { x: -164, y: BUMP_Y, w: 86, d: 2.6, r: 0.6 };
  out.push(slab(rail, COUNTER_TOP, 0.6, { tone: "lo", crease: "none" }));
  const ticks = [];
  for (let c = 0; c <= 8; c++) ticks.push(k.lineOnTop([-165.5 + c * 11, rail.y], [-165.5 + c * 11, rail.y + (c % 4 === 0 ? 2.6 : 1.6)], COUNTER_TOP + 0.6, P));
  out.push(L(ticks.join(""), { tone: "mid" }));
  out.push(screws([[rail.x + 1.2, rail.y + 1.3], [rail.x + rail.w - 1.2, rail.y + 1.3]], COUNTER_TOP + 0.6, 0.4));
  return out.join("");
}
const bumpTab = (count) => {
  const x = -165.5 + (count / 4) * 11;
  return slab({ x: x - 1.6, y: BUMP_Y - 0.6, w: 3.2, d: 3.8, r: 0.6 }, COUNTER_TOP + 0.6, 1.6, { tone: "hi", crease: "lo" }, 2, 0.2);
};

// ② Survivor: 받침대 위 작은 선반 두 개(S0, S1)와 나이 게이지.
const STAND = { x: -60, y: -38, w: 60, d: 40, r: 2 };
function stand() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(STAND, 0, 0.1, P)}" style="filter:blur(3px)"/>`);
  out.push(slab(STAND, 0, 4, { tone: "mid" }, 4, 0.5));
  out.push(screws(k.corners(STAND, 2.4), 4));
  return out.join("");
}
function table(space) {
  const plan = SURV[space];
  const out = [];
  const legs = byDepth(k.corners(plan, 2.2));
  for (const [x, y] of legs) out.push(cyl(x, y, 1.2, 4, TABLE_TOP - 2.4 - 4, { tone: "mid", crease: "none" }, 14));
  out.push(slab({ ...plan, r: 1.6 }, TABLE_TOP - 2.4, 2.4, { tone: "mid" }, 3, 0.4));
  out.push(L(Array.from({ length: M.SURV_CAP }, (_, j) => k.ring(M.survAt(space, j)[0], M.survAt(space, j)[1], 4.2, TABLE_TOP, P, 20)).join(""), { tone: "faint" }));
  out.push(screws(k.corners(plan, 1.6), TABLE_TOP, 0.4));
  // 정면 꼬리표: GC 중 지금 to 공간이면 켜진다.
  const tag = { x: plan.x + 7, y: plan.y + plan.d, w: 8, d: 0.6, r: 0.3 };
  out.push(group({ "data-part": "tag", "data-space": space }, slab(tag, TABLE_TOP - 2.2, 2, { tone: "hi", crease: "none" }, 2)));
  return out.join("");
}
function gauge() {
  const { x, y } = parts.GAUGE;
  const out = [];
  out.push(cyl(x, y, 3.4, 4, 1.6, { tone: "mid" }, 24, 0.3));
  out.push(cyl(x, y, 1.1, 5.6, 46 - 5.6, { tone: "mid", crease: "none" }, 16));
  // 눈금자: 기둥 옆에 선 얇은 띠, 고리 하나 높이마다 한 칸, 5칸마다 긴 눈금.
  const strip = { x: x - 2, y: y + 1.2, w: 4, d: 0.8, r: 0.2 };
  out.push(slab(strip, 5.6, 46 - 5.6, { tone: "lo", crease: "none" }, 2));
  const ticks = { minor: [], major: [] };
  for (let age = 1; age <= M.MAX_AGE; age++) {
    const z = parts.gaugeZ(age);
    (age % 5 === 0 ? ticks.major : ticks.minor).push(k.segment([strip.x, strip.y + strip.d, z], [strip.x + (age % 5 === 0 ? 4 : 2.2), strip.y + strip.d, z], P));
  }
  out.push(L(ticks.minor.join(""), { tone: "lo" }), L(ticks.major.join(""), { tone: "mid" }));
  out.push(cyl(x, y, 2, 46, 1.4, { tone: "mid" }, 16, 0.3));
  out.push(D([at([x, y, 47.4])], { size: 0.5 }));
  return out.join("");
}

// ③ Old: 안쪽 큰 보관 조리대(10 × 8 자리).
const OLD = { x: 12, y: -84, w: 118, d: 92, r: 3 };
function oldCounter() {
  const { out, top } = counterBody(OLD, [41.5, 71, 100.5]);
  out.push(L(k.planOutline(k.insetPlan(top, 3), COUNTER_TOP, P, 4), { tone: "faint" }));
  out.push(L(Array.from({ length: M.OLD_CAP }, (_, s) => k.ring(oldAt(s)[0], oldAt(s)[1], 4.2, COUNTER_TOP, P, 20)).join(""), { tone: "faint" }));
  return out.join("");
}

// ④ 카드 테이블: Old 앞의 메모판. Old 의 열마다 카드 한 장, Young 을 가리키는 끈이 생기면 그 카드가 선다.
const BOARD = { x: 20, y: 14, w: 106, d: 8, r: 1.4 };
const cardPlan = (i) => ({ x: 24.6 + i * 10.5 - 4, y: BOARD.y + 2, w: 8, d: 4, r: 0.5 });
function board() {
  const out = [];
  out.push(slab(BOARD, 0, 5, { tone: "mid" }, 3, 0.4));
  out.push(L(Array.from({ length: 9 }, (_, i) => k.lineOnTop([24.6 + i * 10.5 + 5.25, BOARD.y], [24.6 + i * 10.5 + 5.25, BOARD.y + BOARD.d], 5, P)).join(""), { tone: "faint" }));
  out.push(screws([[BOARD.x + 1.8, BOARD.y + 4], [BOARD.x + BOARD.w - 1.8, BOARD.y + 4]], 5, 0.45));
  return out.join("");
}
const card = (i, up) => slab(cardPlan(i), 5, 0.6 + up * 3.4, { tone: up > 0.5 ? "hi" : "mid", crease: "lo", lit: up > 0.5 }, 2, 0.2);

// ⑤ Eden 청소 갠트리: Eden 만 훑는다(Minor GC). 쉬는 자리는 왼쪽 끝.
const RAIL_X = [-184, -66];
const RAILS = [-52, 22];
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
const GX = M.GANTRY[0];
function upright(y) {
  const truck = { x: GX - 7, y: y - 1, w: 14, d: 8, r: 1.4 };
  return [
    slab(truck, 1.6, 4, { tone: "mid" }, 3, 0.4),
    screws([[truck.x + 2, truck.y + 2], [truck.x + truck.w - 2, truck.y + truck.d - 2]], 5.6),
    slab({ x: GX - 3, y, w: 6, d: 6, r: 0.8 }, 5.6, 50.4, { tone: "mid" }, 2, 0.3),
  ].join("");
}
function beam() {
  const beamPlan = { x: GX - 4, y: RAILS[0] - 1, w: 8, d: RAILS[1] - RAILS[0] + 8, r: 1 };
  const bar = { x: GX - 3, y: -44, w: 6, d: 64, r: 1 };
  return [
    cyl(GX, -30, 0.8, 37, 19, { tone: "mid", crease: "none" }, 12),
    group({ "data-part": "wiper" }, slab(bar, 34, 3, { tone: "hi", crease: "lo" }, 3, 0.3)),
    L([-24, -12, 0, 12, 24].map((y) => k.lineOnTop([bar.x, bar.y + 32 + y], [bar.x + bar.w, bar.y + 32 + y], 37, P)).join(""), { tone: "lo" }),
    cyl(GX, 6, 0.8, 37, 19, { tone: "mid", crease: "none" }, 12),
    slab(beamPlan, 56, 5, { tone: "mid" }, 3, 0.6),
    screws([[GX, beamPlan.y + 3], [GX, beamPlan.y + beamPlan.d - 3]], 61),
    cyl(GX, -12, 2.6, 61, 2.4, { tone: "mid" }, 20),
    L(k.ring(GX, -12, 1, 63.4, P, 12), { tone: "lo" }),
  ].join("");
}

// ⑥ 요리사 자리(스레드): 주문서 꽂이(Stack, GC 루트)와 레시피 카드 + PC.
function stationBase(thread) {
  const cx = parts.STATIONS[thread];
  const plan = { x: cx - 16, y: 46, w: 32, d: 20, r: 2 };
  const sx = cx - 8;
  const holder = { x: cx + 1, y: 49, w: 13, d: 14, r: 1 };
  const recipe = { x: cx + 3, y: 50, w: 9, d: 12, r: 0.4 };
  return [
    `<path class="iso-halo" d="${k.haloOf(plan, 0, 0.1, P)}" style="filter:blur(3px)"/>`,
    slab(plan, 0, 4, { tone: "mid" }, 4, 0.5),
    screws(k.corners(plan, 2.2), 4),
    cyl(sx, parts.SPIKE_Y, 4, 4, 2, { tone: "mid" }, 24, 0.3),
    slab(holder, 4, 2.4, { tone: "mid" }, 3, 0.3),
    slab(recipe, 6.4, 0.4, { tone: "hi", crease: "none" }, 2),
    L(Array.from({ length: 7 }, (_, i) => k.lineOnTop([recipe.x + 1.6, recipe.y + 1.2 + i * 1.6], [recipe.x + recipe.w - (i % 3 === 1 ? 3 : 1.4), recipe.y + 1.2 + i * 1.6], 6.8, P)).join(""), { tone: "lo", free: true }),
  ].join("");
}
const pointer = (thread) => {
  const cx = parts.STATIONS[thread];
  return slab({ x: cx + 1.2, y: 50.4, w: 2.2, d: 1.6, r: 0.4 }, 6.4, 1.2, { tone: "hi", crease: "lo" }, 2);
};

// ⑦ 멈춤 스톱워치(STW): 용두 위 표시등이 멈춘 동안 켜진다.
function watch() {
  const { x, y, r, top } = parts.WATCH;
  const plan = { x: x - 17, y: y - 15, w: 34, d: 30, r: 3 };
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(plan, 0, 0.1, P)}" style="filter:blur(3px)"/>`);
  out.push(slab(plan, 0, 6, { tone: "mid" }, 4, 0.6));
  out.push(screws(k.corners(plan, 2.6), 6));
  out.push(cyl(x, y, 6, 6, 2, { tone: "mid" }, 28, 0.3));
  out.push(cyl(x, y, 3.4, 8, top - 7 - 8, { tone: "mid", crease: "none" }, 24));
  out.push(L(k.sideArc(x, y, 3.4, 13, P, 14), { tone: "faint" }));
  // 용두: 몸통 뒤쪽(-y)에 세운 기둥과 단추.
  out.push(cyl(x, y - r - 1.2, 1.4, top - 4, 6, { tone: "mid", crease: "none" }, 14));
  out.push(cyl(x, y - r - 1.2, 2.2, top + 2, 1.6, { tone: "mid" }, 18, 0.3));
  out.push(L(k.knurl(x, y - r - 1.2, 2.2, top + 2, top + 3.6, 18, P, 0.2), { tone: "lo" }));
  out.push(cyl(x, y, r, top - 7, 7, { tone: "hi", crease: "lo" }, 64, 0.8));
  out.push(L(k.sideArc(x, y, r, top - 2.6, P, 40), { tone: "faint" }));
  out.push(L(k.ring(x, y, r - 1.8, top, P, 64), { tone: "lo" }));
  const ticks = k.radialTicks(x, y, r - 2.4, 50, 5, top, [1.2, 2.4], P, -Math.PI * parts.SPAN, Math.PI * 2 * parts.SPAN);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(`<path data-part="needle" class="iso-line" data-tone="hi" data-free="start" d="${parts.needle(0)}" style="stroke-width:1.1"/>`);
  out.push(L(k.ring(x, y, 1.4, top, P, 14), { tone: "mid" }));
  out.push(D([at([x, y, top])], { size: 0.7, tone: "hi" }));
  out.push(`<g data-part="beacon" style="opacity:0">${D([at([x, y - r - 1.2, top + 3.6])], { size: 1.4, tone: "hi", pulse: true })}</g>`);
  return out.join("");
}

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "Heap 을 세대로 나눈 주방 그림. 왼쪽에 8 × 4 자리 배식대(Eden)와 그 위를 지나는 청소 갠트리, 가운데 작은 선반 두 개(Survivor S0, S1)와 나이 게이지 기둥, 오른쪽 뒤에 10 × 8 자리 큰 보관 조리대(Old)와 그 앞 카드 테이블 메모판, 앞쪽에 요리사 두 명의 주문서 꽂이(GC 루트)와 멈춤 스톱워치가 있다. 접시 위 고리 수가 객체의 나이다.",
  body: [
    base(),
    rails(),
    `<g data-part="gantry-back">${upright(RAILS[0])}</g>`,
    oldCounter(),
    ...Array.from({ length: M.OLD_CAP }, (_, s) => `<g data-part="old" data-i="${s}" style="opacity:0">${parts.dish(oldAt(s))}</g>`),
    board(),
    ...Array.from({ length: 10 }, (_, i) => `<g data-part="card" data-i="${i}">${card(i, 0)}</g>`),
    eden(),
    ...Array.from({ length: M.EDEN_CAP }, (_, i) => `<g data-part="eden" data-i="${i}" style="opacity:0">${parts.dish(edenAt(i))}</g>`),
    `<g data-part="bump">${bumpTab(0)}</g>`,
    stand(),
    gauge(),
    table(0),
    table(1),
    `<g data-part="marker">${parts.marker(M.MAX_AGE, false)}</g>`,
    `<g data-part="gantry-top">${beam()}</g>`,
    `<g data-part="gantry-front">${upright(RAILS[1])}</g>`,
    `<g data-part="mobile"></g>`,
    ...[0, 1].map((t) => stationBase(t) + `<g data-part="pointer" data-thread="${t}">${pointer(t)}</g><g data-part="stack" data-thread="${t}"></g>`),
    watch(),
    `<g data-part="wires"></g>`,
  ],
});

const STEPS = [
  ["할당", "새 접시(객체)는 모두 배식대(Eden)에 놓입니다. 레일 위 탭(범프 포인터)이 다음 빈 자리를 가리킵니다."],
  ["Minor GC", "Eden 이 차면 요리사가 잠깐 멈추고(STW), 주문서 끈이 닿는 접시만 빈 선반(S0)으로 옮기며 고리를 하나 붙입니다(나이 1). 나머지는 갠트리가 한 번에 쓸어 냅니다."],
  ["카드 테이블", "Old 의 캐시 접시가 Young 접시를 붙잡으면 메모판 카드가 섭니다. Minor GC 는 Old 전체를 보지 않고 선 카드만 루트로 봅니다."],
  ["나이 먹기", "GC 마다 살아남은 접시는 S0 ↔ S1 을 오가며 고리가 하나씩 늘어납니다. 두 선반 중 하나는 늘 비어 있습니다(빨리 감기)."],
  ["승격", "고리가 게이지 표시(임계값 15)에 닿은 접시는 다음 GC 에서 Old 로 옮겨집니다."],
  ["Survivor 넘침", "살아남은 접시가 선반(4칸)보다 많으면 남는 접시는 바로 Old 로 갑니다(조기 승격). 선반이 절반 넘게 차서 임계값이 1 로 내려갑니다."],
  ["동적 임계값", "임계값이 1 이라 나이 1 인 접시도 다음 GC 에서 Old 로 승격됩니다. 선반이 비면 임계값은 다시 15 입니다."],
  ["Old 가득", "승격이 계속되면 Old 가 찹니다. 다음 승격이 들어갈 자리가 없습니다(빨리 감기)."],
  ["Full GC", "힙 전체를 멈추고 오래 정리합니다: 끈이 닿는 접시 표시 → 끊긴 접시 정리 → 남은 접시를 앞으로 모으기(압축)."],
];
const stepsHtml = `<ol class="jk-steps">${STEPS.map(([name, text], i) => `<li><button type="button" data-step="${i}"><span class="jk-n">${i + 1}</span><span><b>${name}</b> ${text}</span></button></li>`).join("")}</ol>`;
const STATS = [["gc", "GC"], ["eden", "Eden"], ["s0", "S0"], ["s1", "S1"], ["old", "Old"], ["thr", "임계값"], ["prom", "승격"], ["pause", "멈춤"]];
const statsHtml = `<dl class="gc-stats" aria-live="off">${STATS.map(([id, name]) => `<div><dt>${name}</dt><dd data-stat="${id}">–</dd>${["eden", "s0", "s1", "old"].includes(id) ? `<i data-bar="${id}"></i>` : ""}</div>`).join("")}</dl>`;
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
.gc-stats dt{color:var(--anatomy-muted);font-size:10.5px}
.gc-stats dd{margin:2px 0 0;color:var(--anatomy-strong);white-space:nowrap}
.gc-stats i{position:absolute;left:0;bottom:0;height:2px;width:0;background:var(--anatomy-mid)}
.iso-stage{cursor:pointer;border-radius:12px}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-mid);outline-offset:4px}
@media (max-width:560px){.gc-stats{grid-template-columns:repeat(4,minmax(0,1fr))}.iso-stage{overflow:hidden}.iso-stage>svg{transform:scale(1.14);transform-origin:50% 55%}}
</style>`;

const strip = (file) => readFileSync(join(HERE, file), "utf8").replace(/^export \{.*\};?$/gm, "").replace(/^export /gm, "").replace(/^import .*$/gm, "");
const live = `
${strip("model.mjs")}
${strip("parts.mjs")}
const k = { iso, slabOf, cylinder, solidSvg, lineSvg, dotsSvg, lineOnTop, ring, planOutline, pathOf };
const P = ${JSON.stringify(P)};
const M = { BOWL_TOP, RING_H, TABLE_TOP };
const parts = makeParts(k, P, M);
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const $ = (selector) => svg.querySelector(selector);
const $$ = (selector) => [...svg.querySelectorAll(selector)];
const readout = document.querySelector("[data-readout]");
const buttons = [...document.querySelectorAll("[data-step]")];
const stat = Object.fromEntries([...document.querySelectorAll("[data-stat]")].map((node) => [node.dataset.stat, node]));
const bar = Object.fromEntries([...document.querySelectorAll("[data-bar]")].map((node) => [node.dataset.bar, node]));
const el = {
  eden: $$('[data-part="eden"]'), old: $$('[data-part="old"]'), cards: $$('[data-part="card"]'), tags: $$('[data-part="tag"]'),
  mobile: $('[data-part="mobile"]'), marker: $('[data-part="marker"]'), bump: $('[data-part="bump"]'),
  wires: $('[data-part="wires"]'), beacon: $('[data-part="beacon"]'), needle: $('[data-part="needle"]'),
  gantry: $$('[data-part^="gantry"]'), wiper: $('[data-part="wiper"] .iso-solid'),
  stacks: $$('[data-part="stack"]'), pointers: $$('[data-part="pointer"]'),
};
const still = matchMedia("(prefers-reduced-motion: reduce)");
const move = (node, offset) => node.setAttribute("transform", translateAlong(P, offset));
const lit = (node, on) => node.querySelectorAll(".iso-solid").forEach((solid) => (on ? solid.setAttribute("data-lit", "") : solid.removeAttribute("data-lit")));
const cache = new Map();
const once = (key, value) => { if (cache.get(key) === value) return false; cache.set(key, value); return true; };
const BUMP_X = (count) => (count / 4) * 11;
function draw(t) {
  const s = stateAt(t);
  if (once("phase", s.phase)) buttons.forEach((button, index) => (index === s.phase ? button.setAttribute("aria-current", "step") : button.removeAttribute("aria-current")));
  s.eden.forEach((cell, i) => {
    const node = el.eden[i];
    node.style.opacity = cell.presence.toFixed(3);
    if (once("e" + i, cell.lit)) lit(node, cell.lit);
  });
  s.old.forEach((cell, i) => {
    const node = el.old[i];
    node.style.opacity = (cell.presence * (1 - 0.6 * cell.dim)).toFixed(3);
    move(node, [cell.shift[0], cell.shift[1], 0]);
    if (once("o" + i, cell.lit)) lit(node, cell.lit);
  });
  s.cards.forEach((up, i) => { if (once("c" + i, up)) el.cards[i].innerHTML = card(i, up); });
  el.tags.forEach((node, space) => { const on = s.toSpace === space; if (once("t" + space, on)) lit(node, on); });
  move(el.bump, [BUMP_X(Math.min(s.bump, ${M.EDEN_CAP})), 0, 0]);
  const marker = Math.round(s.gauge * 20) / 20;
  if (once("m", marker + ":" + s.inGc)) el.marker.innerHTML = parts.marker(marker, s.inGc && Math.abs(s.gauge - s.threshold) > 0.01);
  el.mobile.innerHTML = s.mobile.filter((dish) => dish.presence > 0.01).sort((a, b) => (a.flying - b.flying) || (depthOf(a.at, P) - depthOf(b.at, P))).map((dish) => '<g style="opacity:' + dish.presence.toFixed(3) + '">' + parts.dish(dish.at, dish.age, dish.lit) + "</g>").join("");
  for (const node of el.gantry) move(node, [s.gantryX - ${GX}, 0, 0]);
  if (once("wiper", s.gantryX > ${GX} + 0.5)) s.gantryX > ${GX} + 0.5 ? el.wiper.setAttribute("data-lit", "") : el.wiper.removeAttribute("data-lit");
  el.beacon.style.opacity = s.stw.toFixed(3);
  el.needle.setAttribute("d", parts.needle(s.inGc ? s.pauseMs : 0));
  el.stacks.forEach((node, thread) => (node.innerHTML = parts.stack(thread, s.tickets, s.inGc)));
  el.pointers.forEach((node, thread) => move(node, [0, s.pc[thread] * 1.6, 0]));
  const anchors = Object.fromEntries(s.tickets.filter((ticket) => ticket.presence > 0.02).map((ticket) => [ticket.id, { at: parts.ticketAnchor(ticket, s.tickets), alpha: ticket.presence }]));
  const cache7 = oldAt(${M.CACHE_SLOT});
  anchors.C = { at: [cache7[0], cache7[1], cache7[2] + BOWL_TOP], alpha: 1 };
  el.wires.innerHTML = s.wires.filter((wire) => anchors[wire.from]).map((wire) => {
    const w = parts.wire(anchors[wire.from].at, wire.to);
    const alpha = anchors[wire.from].alpha * wire.alpha;
    return '<g class="iso-wire" data-tone="mid" style="opacity:' + alpha.toFixed(3) + '"><path class="iso-line" data-tone="mid" d="' + w.d + '"/><circle class="iso-wire-end" cx="' + w.from[0].toFixed(1) + '" cy="' + w.from[1].toFixed(1) + '" r="0.9"/><circle class="iso-wire-end" cx="' + w.to[0].toFixed(1) + '" cy="' + w.to[1].toFixed(1) + '" r="0.9"/></g>';
  }).join("");
  const text = readoutOf(s);
  if (readout.textContent !== text) readout.textContent = text;
  const values = {
    gc: s.gcNo ? "#" + s.gcNo + " " + s.kind : "–",
    eden: s.edenCount + "/" + EDEN_CAP, s0: s.survUsed[0] + "/" + SURV_CAP, s1: s.survUsed[1] + "/" + SURV_CAP, old: s.oldUsed + "/" + OLD_CAP,
    thr: String(s.threshold), prom: String(s.promoted), pause: s.gcNo ? (s.inGc ? s.pauseMs.toFixed(s.kind === "Full" ? 0 : 1) : s.lastPause) + "ms" : "–",
  };
  for (const [id, value] of Object.entries(values)) if (stat[id].textContent !== value) stat[id].textContent = value;
  const fill = { eden: s.edenCount / EDEN_CAP, s0: s.survUsed[0] / SURV_CAP, s1: s.survUsed[1] / SURV_CAP, old: s.oldUsed / OLD_CAP };
  for (const [id, value] of Object.entries(fill)) bar[id].style.width = (value * 100).toFixed(1) + "%";
  stage.setAttribute("aria-valuenow", String(s.phase + 1));
  stage.setAttribute("aria-valuetext", PHASES[s.phase].name + ": " + text);
}
function card(i, up) {
  const plan = { x: 24.6 + i * 10.5 - 4, y: ${BOARD.y + 2}, w: 8, d: 4, r: 0.5 };
  return solidSvg(slabOf(plan, 5, 0.6 + up * 3.4, P, 2, 0.2), { tone: up > 0.5 ? "hi" : "mid", crease: "lo", lit: up > 0.5 });
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
  if (still.matches) { t = STILL[index]; draw(t); }
  clearTimeout(idle);
  idle = setTimeout(() => { if (!still.matches) { hold = null; run(); } }, IDLE);
  run();
}
// 움직임을 줄인 경우 단계마다 보여 줄 한 장면.
const STILL = PHASES.map((phase, index) => STARTS[index] + phase.seconds * [0.9, 0.4, 0.55, 0.95, 0.52, 0.5, 0.5, 0.95, 0.7][index]);
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); else { cancelAnimationFrame(frame); frame = 0; } }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("click", () => go(phaseAt(t).index + 1));
stage.addEventListener("keydown", (event) => {
  const here = phaseAt(t).index;
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === " ") to = here + 1;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = here - 1;
  if (event.key === "Home") to = 0;
  if (event.key === "End") to = PHASES.length - 1;
  if (/^[1-9]$/.test(event.key)) to = Number(event.key) - 1;
  if (to === null) return;
  event.preventDefault();
  go(to);
});
buttons.forEach((button, index) => button.addEventListener("click", () => go(index)));
window.__gc = { draw, stateAt, go, set: (time) => { t = time; hold = time; draw(time); } };
if (still.matches) go(1); else draw(t);
`;

const start = M.stateAt(0.001);
const body = k.plateHtml({
  fig: "Fig 2",
  title: "Heap 세대와 GC",
  hint: "클릭 · ← → · 1–9 로 단계 이동",
  readout: M.readoutOf(start),
  keys: [
    { mark: "lit", label: "지금 옮기거나 표시하는 것" },
    { mark: "raised", label: "접시 위 고리 = 나이(살아남은 Minor GC 수)" },
    { mark: "edge", label: "끈 = 참조(주문서·Old → 접시)" },
  ],
  caption:
    "칸 수는 JDK 21 기본값 비율 그대로입니다: Eden:S0:S1 = 8:1:1(SurvivorRatio=8), Old:Young = 2:1(NewRatio=2), 최대 나이 15(MaxTenuringThreshold), Survivor 가 50% 넘게 차면 임계값을 낮춤(TargetSurvivorRatio=50). 접시 하나가 같은 크기의 객체 하나이고, 규칙은 Serial GC 기준입니다. 기본 GC 인 G1 은 힙을 같은 크기 구역(region)으로 나눠 Eden·Survivor·Old 를 붙이지만 나이 먹기와 승격 규칙은 같습니다. Minor GC 멈춤 2ms 는 로컬 로그 값, Full GC 80ms 는 설명용 예시입니다.",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Heap 세대와 GC: 클릭하거나 화살표 키로 단계를 옮깁니다" aria-valuemin="1" aria-valuemax="9" aria-valuenow="1">${svg}</div>`,
});

const name = theme === "light" ? "gc-light.html" : "gc.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "Heap 세대와 GC", theme, body: PAGE_CSS + body + statsHtml + stepsHtml, script: kitScript() + live, width: 720 }).replace('<html lang="en">', '<html lang="ko">'));
console.log("wrote", name);
