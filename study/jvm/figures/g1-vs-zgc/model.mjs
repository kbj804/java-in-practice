// G1 vs ZGC 주방 모델: 그림의 모든 움직임과 숫자는 이 모듈 하나에서 나온다.
// 왼쪽(G1)과 오른쪽(ZGC)은 같은 바닥(같은 크기 칸 15개 = region)과 같은 할당을 받는다.
// 다른 것은 정리 방식뿐이다. G1 은 요리사를 멈추고 옮기고, ZGC 는 영업 중에 옮긴다.
// 멈춤 ms 는 로컬 JDK 21 로그 크기에 맞춘 설명용 값이다(그림 설명 참고).

export const COLS = 5;
export const ROWS = 3;
export const TILE = 30;
export const PITCH = 33;
export const TILE_TOP = 4;
export const BOWL_TOP = 2.6;
export const SIDES = ["g1", "z"];
export const FLOOR = { g1: { x0: -188, y0: -86 }, z: { x0: 22, y0: -86 } };

export const tilePlan = (side, i) => ({ x: FLOOR[side].x0 + (i % COLS) * PITCH, y: FLOOR[side].y0 + Math.floor(i / COLS) * PITCH, w: TILE, d: TILE, r: 1.5 });
export const slotAt = (side, i, j) => {
  const p = tilePlan(side, i);
  return [p.x + 9 + (j % 2) * 12, p.y + 8 + Math.floor(j / 2) * 12, TILE_TOP];
};

export const PHASES = [
  { id: "alloc", name: "할당", seconds: 6 },
  { id: "young", name: "Young GC · 동시 표시", seconds: 8 },
  { id: "satb", name: "SATB 표시 · 옮길 칸", seconds: 8 },
  { id: "pick", name: "후보 고르기 · 동시 이동", seconds: 9 },
  { id: "mixed", name: "Mixed GC · 셀프 힐링", seconds: 9 },
  { id: "burst", name: "할당 폭주", seconds: 9 },
  { id: "sum", name: "정리", seconds: 6 },
];
export const STARTS = PHASES.reduce((list, phase, index) => [...list, index ? list[index - 1] + PHASES[index - 1].seconds : 0], []);
export const TOTAL = PHASES.reduce((sum, phase) => sum + phase.seconds, 0);
const T = (phase, share) => STARTS[phase] + PHASES[phase].seconds * share;
export const RESET = [T(6, 0.72), T(6, 0.98)];

// 멈춤 기록계: 시간 → x, ms → 펜 높이.
export const PAPER = { x: -150, y: 56, w: 300, d: 32, r: 1.5 };
export const LANE = { g1: 71, z: 86 };
export const CHART_X = [-128, 144];
export const SPIKE_MAX = 15;
export const MS_FULL = 120;
export const chartX = (t) => CHART_X[0] + (CHART_X[1] - CHART_X[0]) * (t / TOTAL);
export const spikeH = (ms) => SPIKE_MAX * Math.min(ms, MS_FULL) / MS_FULL;

// G1 멈춤 목표 다이얼.
export const GOAL = 200;
export const GOAL_SHARE = 0.8;
export const PER_REGION = 60; // 설명용 예측값: Old 칸 하나 옮기는 데 드는 ms
export const YOUNG_BASE = 20;

// ── 시나리오 ──
const sides = { g1: newSide(), z: newSide() };
function newSide() {
  return { dishes: new Map(), roles: Array.from({ length: 15 }, () => [[-1, ""]]), tagLit: Array.from({ length: 15 }, () => []), logLit: Array.from({ length: 15 }, () => []), pauses: [], marks: [], sweeps: [], tickets: [], wires: [], labels: [], ledger: [], heals: [], flashes: [], dial: [[-1, 0]] };
}
function sDish(side, id, tile, slot, born = -1) {
  const d = { id, side, born, path: [{ at: born, dur: 0, tile, slot }], gone: null, dims: [] };
  sides[side].dishes.set(id, d);
  return d;
}
const sGet = (side, id) => sides[side].dishes.get(id);
const sMove = (side, id, at, dur, tile, slot) => sGet(side, id).path.push({ at, dur, tile, slot });
const sKill = (side, ids, at, dur = 0.7) => ids.forEach((id) => (sGet(side, id).gone = { at, dur }));
const sDim = (side, ids, at) => ids.forEach((id) => sGet(side, id).dims.push(at));
const sRole = (side, tiles, at, r) => tiles.forEach((i) => sides[side].roles[i].push([at, r]));
const sTag = (side, tiles, from, to) => tiles.forEach((i) => sides[side].tagLit[i].push([from, to]));
const sPause = (side, at, dur, ms, name, kind = "pause") => sides[side].pauses.push({ at, dur, ms, name, kind });
const sLabel = (side, at, text) => sides[side].labels.push([at, text]);
const sIds = (prefix, list) => list.map((x) => prefix + x);

// 처음 상태(양쪽 같음): Old 칸 5·6·7·10·11, Survivor/Young 칸 8.
const OLD0 = { 5: [1, 0, 0, 0], 6: [1, 1, 1, 0], 7: [1, 1, 1, 1], 10: [1, 0, 0, 0], 11: [1, 1, 0, 0] };
const LIVE = new Set();
for (const side of SIDES) {
  for (const [tile, live] of Object.entries(OLD0)) {
    live.forEach((alive, j) => {
      const id = `o${tile}${"abcd"[j]}`;
      sDish(side, id, Number(tile), j);
      if (alive && side === "g1") LIVE.add(id);
    });
    sRole(side, [Number(tile)], -1, "O");
  }
  sDish(side, "s8a", 8, 0);
  sDish(side, "s8b", 8, 1);
  sRole(side, [8], -1, side === "g1" ? "S" : "Y");
  // ① 할당: 배식이 칸 0·1·2 에 하나씩 놓인다. 살아 있는 것은 e01, e12 (주문서가 붙잡음).
  for (let n = 0; n < 12; n++) sDish(side, `e${Math.floor(n / 4)}${n % 4}`, Math.floor(n / 4), n % 4, T(0, 0.1 + n * 0.065));
  sRole(side, [0], T(0, 0.1), side === "g1" ? "E" : "Y");
  sRole(side, [1], T(0, 0.1 + 4 * 0.065), side === "g1" ? "E" : "Y");
  sRole(side, [2], T(0, 0.1 + 8 * 0.065), side === "g1" ? "E" : "Y");
  const s = sides[side];
  s.tickets.push({ id: "T1", push: -1, pop: Infinity }, { id: "T2", push: T(0, 0.08), pop: Infinity }, { id: "T3", push: T(0, 0.5), pop: T(5, 0.95) });
  s.wires.push({ from: "T2", to: "e01", on: [T(0, 0.17), Infinity] }, { from: "T3", to: "e12", on: [T(0, 0.55), T(5, 0.95)] });
  sLabel(side, 0, "새 접시는 빈 칸에");
}

// ── G1 ──
{
  const g = "g1";
  const S = sides[g];
  sRole(g, [3, 4], -1, "H");
  // SATB 접시: o7d 는 주문서 T1 이 붙잡고 있다가 표시 도중에 놓인다.
  S.wires.push({ from: "T1", to: "o7d", on: [-1, T(2, 0.25)] });
  // ② Young GC(Concurrent Start): 모두 멈추고 살아 있는 young 접시만 빈 칸 9(S)로 옮긴다.
  const yg = T(1, 0.06);
  sPause(g, yg, PHASES[1].seconds * 0.86, 14, "Young GC");
  sLabel(g, yg, "멈춤 · Young GC");
  S.marks.push({ ids: ["e01", "e12", "s8a"], from: yg + 0.5, to: yg + 5.2 });
  sRole(g, [9], T(1, 0.3), "S");
  sMove(g, "e01", T(1, 0.3), 1.1, 9, 0);
  sMove(g, "e12", T(1, 0.38), 1.1, 9, 1);
  sMove(g, "s8a", T(1, 0.46), 1.1, 9, 2);
  const youngGarbage = [...sIds("e0", [0, 2, 3]), ...sIds("e1", [0, 1, 3]), ...sIds("e2", [0, 1, 2, 3]), "s8b"];
  sKill(g, youngGarbage, T(1, 0.66), 1.2);
  sRole(g, [0, 1, 2, 8], T(1, 0.82), "");
  sLabel(g, T(1, 0.66), "멈춤 · 칸째로 비움");
  sLabel(g, T(1, 0.92), "영업 재개");
  // ③ 동시 표시(SATB): 스냅샷을 찍고, 영업 중에 카트가 Old 칸을 훑으며 표시한다.
  S.flashes.push([T(2, 0.0), T(2, 0.12)]);
  sLabel(g, T(2, 0.0), "스냅샷 · 동시 표시");
  const sweep = { at: T(2, 0.1), dur: PHASES[2].seconds * 0.72, from: -20.5, to: -192, back: 1.6 };
  S.sweeps.push(sweep);
  S.marks.push({ ids: ["o5a", "o6a", "o6b", "o6c", "o7a", "o7b", "o7c", "o7d", "o10a", "o11a", "o11b"], sweep, to: T(4, 0.9) });
  sLabel(g, T(2, 0.25), "끈이 끊겨도 이번엔 산 것");
  // 영업 중 할당은 계속: 칸 0 에 새 접시.
  sRole(g, [0], T(2, 0.3), "E");
  ["n0a", "n0b", "n0c"].forEach((id, j) => sDish(g, id, 0, j, T(2, 0.3 + j * 0.12)));
  S.wires.push({ from: "T2", to: "n0a", on: [T(2, 0.36), Infinity] });
  // ④ Remark · Cleanup: 짧게 두 번 멈추고, 쓰레기가 많은 칸부터 멈춤 목표 안에서 고른다.
  sPause(g, T(3, 0.04), 0.7, 0.4, "Remark");
  sDim(g, ["o5b", "o5c", "o5d", "o6d", "o10b", "o10c", "o10d", "o11c", "o11d"], T(3, 0.08));
  sLabel(g, T(3, 0.04), "멈춤 · Remark");
  sPause(g, T(3, 0.16), 0.6, 0.3, "Cleanup");
  sLabel(g, T(3, 0.16), "멈춤 · Cleanup");
  sLabel(g, T(3, 0.26), "쓰레기 많은 칸부터");
  S.dial.push([T(3, 0.26), YOUNG_BASE], [T(3, 0.36), YOUNG_BASE + PER_REGION], [T(3, 0.5), YOUNG_BASE + PER_REGION * 2], [T(3, 0.64), YOUNG_BASE + PER_REGION * 3], [T(3, 0.78), YOUNG_BASE + PER_REGION * 2]);
  sTag(g, [5], T(3, 0.32), T(4, 0.8));
  sTag(g, [10], T(3, 0.46), T(4, 0.8));
  sTag(g, [11], T(3, 0.6), T(3, 0.78));
  sLabel(g, T(3, 0.64), "칸 11 은 목표 초과 · 다음에");
  sLabel(g, T(3, 0.82), "예상 140ms · 목표 안");
  // ⑤ Mixed GC: 다시 모두 멈추고 young 칸 + 고른 Old 칸(5, 10)을 비운다. 끈은 멈춘 동안 전부 고친다.
  const mx = T(4, 0.04);
  sPause(g, mx, PHASES[4].seconds * 0.86, 45, "Mixed GC");
  sLabel(g, mx, "멈춤 · Mixed GC");
  [0, 9, 5, 10].forEach((i) => S.logLit[i].push([mx + 0.4, T(4, 0.6)]));
  S.marks.push({ ids: ["n0a", "e01", "e12", "s8a"], from: mx + 0.5, to: T(4, 0.85) });
  sRole(g, [12], T(4, 0.28), "S");
  sRole(g, [13], T(4, 0.28), "O");
  sMove(g, "n0a", T(4, 0.28), 1, 12, 0);
  sMove(g, "e01", T(4, 0.33), 1, 12, 1);
  sMove(g, "e12", T(4, 0.38), 1, 12, 2);
  sMove(g, "s8a", T(4, 0.43), 1, 12, 3);
  sMove(g, "o5a", T(4, 0.48), 1.1, 13, 0);
  sMove(g, "o10a", T(4, 0.53), 1.1, 13, 1);
  sKill(g, ["n0b", "n0c", "o5b", "o5c", "o5d", "o10b", "o10c", "o10d"], T(4, 0.66), 1.1);
  sRole(g, [0, 9, 5, 10], T(4, 0.82), "");
  sLabel(g, T(4, 0.62), "옮긴 뒤 끈도 멈춘 채 고침");
  sLabel(g, T(4, 0.92), "영업 재개");
  // ⑥ 할당 폭주: 빈 칸이 바닥나 옮길 곳이 없다 → Full GC(힙 전체 압축, 아주 김).
  const burst = [];
  const free = [0, 1, 2, 5, 9, 10, 14];
  free.forEach((tile, k) => {
    sRole(g, [tile], T(5, 0.03 + k * 0.045), "E");
    for (let j = 0; j < 4; j++) {
      const id = `b${tile}${j}`;
      sDish(g, id, tile, j, T(5, 0.03 + k * 0.045 + j * 0.01));
      burst.push(id);
    }
  });
  sRole(g, [8], T(5, 0.36), "E");
  ["b80", "b81"].forEach((id, j) => { sDish(g, id, 8, j, T(5, 0.34 + j * 0.012)); burst.push(id); });
  sLabel(g, T(5, 0.03), "할당 폭주");
  const full = T(5, 0.38);
  sLabel(g, full, "옮길 빈 칸 없음 → Full GC");
  sPause(g, full, PHASES[5].seconds * 0.58, 110, "Full GC");
  const liveNow = ["o6a", "o6b", "o6c", "o7a", "o7b", "o7c", "o11a", "o11b", "o5a", "o10a", "n0a", "e01", "e12", "s8a", "b00", "b01"];
  S.wires.push({ from: "T3", to: "b00", on: [T(5, 0.06), T(5, 0.95)] }, { from: "T2", to: "b01", on: [T(5, 0.07), Infinity] });
  S.marks.push({ ids: liveNow, from: full + 0.4, to: T(5, 0.95) });
  const garbage = [...burst.filter((id) => !liveNow.includes(id)), "o6d", "o7d", "o11c", "o11d"];
  sDim(g, garbage, full + 0.8);
  sKill(g, garbage, full + 1.6, 1);
  sLabel(g, full + 1.6, "멈춤 · 힙 전체 정리");
  // 압축: 살아 있는 접시를 앞쪽 칸(5·6·7·8)으로 빈틈없이 모은다. 거대 객체(H)는 그대로.
  const packed = [5, 6, 7, 8];
  liveNow.forEach((id, n) => sMove(g, id, full + 2.8 + n * 0.07, 1, packed[Math.floor(n / 4)], n % 4));
  sRole(g, [0, 1, 2, 9, 10, 11, 12, 13, 14], full + 4.1, "");
  sRole(g, packed, full + 2.8, "O");
  sLabel(g, full + 2.9, "멈춤 · 압축");
  sLabel(g, T(5, 0.97), "영업 재개");
  sLabel(g, T(6, 0), "멈춤 5번 · 최장 110ms");
}

// ── ZGC ──
{
  const g = "z";
  const S = sides[g];
  const TAP = 0.35;
  const tap = (at, name) => sPause(g, at, TAP, 0.01, name);
  // 힙 안의 끈: Old 접시 o7a 의 필드가 o10a 를 가리킨다(로드 배리어 시연용).
  S.wires.push({ from: "o7a", to: "o10a", on: [-1, Infinity], heap: true });
  // ② Mark Start(아주 짧게) → 영업 중에 카트가 전체를 훑으며 표시.
  tap(T(1, 0.06), "Mark Start");
  sLabel(g, T(1, 0.06), "Mark Start · 0.01ms");
  const sweep = { at: T(1, 0.12), dur: PHASES[1].seconds * 0.72, from: 192, to: 18, back: 1.6 };
  S.sweeps.push(sweep);
  sLabel(g, T(1, 0.14), "영업 중 동시 표시");
  S.marks.push({ ids: ["e01", "e12", "s8a", "o5a", "o6a", "o6b", "o6c", "o7a", "o7b", "o7c", "o7d", "o10a", "o11a", "o11b"], sweep, to: T(3, 0.85) });
  // 표시 중에도 할당: 칸 12 에 새 접시.
  sRole(g, [12], T(1, 0.3), "Y");
  sDish(g, "z12a", 12, 0, T(1, 0.3));
  sDish(g, "z12b", 12, 1, T(1, 0.5));
  // ③ Mark End → 옮길 칸 고르기 → Relocate Start. 멈춤은 두 번 다 아주 짧다.
  tap(T(2, 0.06), "Mark End");
  sLabel(g, T(2, 0.06), "Mark End · 0.01ms");
  const zGarbage = [...sIds("e0", [0, 2, 3]), ...sIds("e1", [0, 1, 3]), ...sIds("e2", [0, 1, 2, 3]), "s8b", "o5b", "o5c", "o5d", "o6d", "o10b", "o10c", "o10d", "o11c", "o11d"];
  sDim(g, zGarbage, T(2, 0.1));
  sLabel(g, T(2, 0.22), "쓰레기 많은 칸 고르기");
  sTag(g, [0, 1, 2, 8, 5, 10], T(2, 0.24), T(3, 0.85));
  tap(T(2, 0.7), "Relocate Start");
  sLabel(g, T(2, 0.7), "Relocate Start · 0.01ms");
  // ④ 동시 이동: 요리사는 계속 일하고, 이사 장부에 새 주소를 적으며 옮긴다. 비운 칸은 바로 다시 쓴다.
  sLabel(g, T(3, 0.04), "영업 중 동시 이동");
  sRole(g, [13], T(3, 0.08), "Y");
  sRole(g, [14], T(3, 0.08), "O");
  const zmoves = [["e01", 13, 0], ["e12", 13, 1], ["s8a", 13, 2], ["o5a", 14, 0], ["o10a", 14, 1]];
  zmoves.forEach(([id, tile, slot], n) => {
    const at = T(3, 0.08 + n * 0.11);
    sMove(g, id, at, 1.1, tile, slot);
    S.ledger.push({ at, id });
  });
  sKill(g, zGarbage, T(3, 0.66), 1);
  sRole(g, [0, 1, 2, 8, 10], T(3, 0.78), "");
  sRole(g, [5], T(3, 0.78), "Y");
  sDish(g, "z5n", 5, 0, T(3, 0.84));
  sLabel(g, T(3, 0.7), "비운 칸 5 바로 재사용");
  // ⑤ 셀프 힐링: 요리사가 o7a 의 끈을 당기면(필드 읽기) 손목 체크가 옛 주소를 잡아 장부를 보고 고쳐 맨다.
  S.heals.push({ at: T(4, 0.16), dur: 1.4, ledger: "o10a" });
  sLabel(g, T(4, 0.06), "o7a 의 끈을 읽음");
  sLabel(g, T(4, 0.16), "로드 배리어 · 옛 주소!");
  sLabel(g, T(4, 0.3), "장부 보고 끈 고쳐 맴");
  sLabel(g, T(4, 0.56), "두 번째부터는 바로");
  // ⑥ 할당 폭주: 빈 칸이 바닥나면 그 요리사만 기다린다(Allocation Stall). GC 는 계속 돈다.
  const burst = [];
  const free = [0, 1, 2, 3, 4, 8, 10, 9];
  free.forEach((tile, k) => {
    sRole(g, [tile], T(5, 0.03 + k * 0.045), "Y");
    for (let j = 0; j < 4; j++) {
      const id = `b${tile}${j}`;
      sDish(g, id, tile, j, T(5, 0.03 + k * 0.045 + j * 0.01));
      burst.push(id);
    }
  });
  sLabel(g, T(5, 0.03), "할당 폭주");
  S.wires.push({ from: "T3", to: "b00", on: [T(5, 0.06), T(5, 0.95)] }, { from: "T2", to: "b01", on: [T(5, 0.07), Infinity] });
  const stall = T(5, 0.42);
  sPause(g, stall, PHASES[5].seconds * 0.34, 40, "Allocation Stall", "stall");
  sLabel(g, stall, "빈 칸 없음 · 이 요리사만 대기");
  tap(T(5, 0.44), "Mark Start");
  const sweep2 = { at: T(5, 0.46), dur: PHASES[5].seconds * 0.2, from: 192, to: 18, back: 1.4 };
  S.sweeps.push(sweep2);
  S.marks.push({ ids: ["b00", "b01", "o6a", "o6b", "o6c", "o7a", "o7b", "o7c", "o11a", "o11b", "e01", "e12", "s8a", "o5a", "o10a", "z5n"], sweep: sweep2, to: T(5, 0.95) });
  tap(T(5, 0.66), "Mark End");
  const empty = [...sIds("b1", [0, 1, 2, 3]), ...sIds("b2", [0, 1, 2, 3]), "z12a", "z12b"];
  sDim(g, [...empty, ...sIds("b0", [2, 3]), ...sIds("b3", [0, 1, 2, 3]), ...sIds("b4", [0, 1, 2, 3]), ...sIds("b8", [0, 1, 2, 3]), ...sIds("b10", [0, 1, 2, 3]), ...sIds("b9", [0, 1, 2, 3])], T(5, 0.67));
  tap(T(5, 0.7), "Relocate Start");
  // 산 접시가 하나도 없는 칸(1, 2, 12)은 옮길 것 없이 통째로 돌려받는다.
  sKill(g, empty, T(5, 0.72), 0.8);
  sRole(g, [1, 2, 12], T(5, 0.8), "");
  sLabel(g, T(5, 0.72), "빈 칸 확보 · 대기 끝");
  sRole(g, [1], T(5, 0.82), "Y");
  sDish(g, "bz", 1, 0, T(5, 0.83));
  sLabel(g, T(5, 0.9), "영업 계속");
  sLabel(g, T(6, 0), "멈춤 6번 · 최장 0.01ms");
}

// ── 시간 보간 ──
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
export const ease = (value) => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};
const lerp = (a, b, s) => a.map((v, i) => v + (b[i] - v) * s);
const lastOf = (list, t) => {
  let out = list[0];
  for (const item of list) if (item[0] <= t) out = item;
  return out;
};
const within = (list, t) => list.some(([a, b]) => t >= a && t < b);

export function phaseAt(t) {
  const time = ((t % TOTAL) + TOTAL) % TOTAL;
  let index = PHASES.length - 1;
  while (index > 0 && time < STARTS[index]) index--;
  return { index, time, u: (time - STARTS[index]) / PHASES[index].seconds };
}

function gantryAt(S, t) {
  for (const sweep of S.sweeps) {
    const end = sweep.at + sweep.dur;
    if (t >= sweep.at && t < end) return { x: sweep.from + (sweep.to - sweep.from) * ((t - sweep.at) / sweep.dur), on: true };
    if (t >= end && t < end + sweep.back) return { x: sweep.to + (sweep.from - sweep.to) * ease((t - end) / sweep.back), on: false };
  }
  return { x: S.sweeps[0].from, on: false };
}
const passAt = (sweep, x) => sweep.at + sweep.dur * clamp((x - sweep.from) / (sweep.to - sweep.from));

function dishAt(d, t) {
  let place = d.path[0];
  let at = slotAt(d.side, place.tile, place.slot);
  let flying = 0;
  let before = at;
  for (let n = 1; n < d.path.length; n++) {
    const key = d.path[n];
    if (t < key.at) break;
    const to = slotAt(d.side, key.tile, key.slot);
    const s = ease((t - key.at) / key.dur);
    before = at;
    at = lerp(at, to, s);
    if (s < 1) {
      at[2] += Math.sin(Math.PI * s) * 16;
      flying = s;
    }
    at = s < 1 ? at : to;
    place = key;
  }
  let presence = d.born < 0 ? 1 : ease((t - d.born) / 0.35);
  if (d.born >= 0 && t < d.born + 0.35) at = [at[0], at[1], at[2] + (1 - presence) * 8];
  if (d.gone) presence *= 1 - ease((t - d.gone.at) / d.gone.dur);
  const dimmed = d.dims.some((a) => t >= a) ? ease((t - Math.min(...d.dims.filter((a) => t >= a))) / 0.5) : 0;
  return { at, presence, dim: dimmed, flying, before };
}

function stoppedAt(S, t) {
  return S.pauses.some((p) => t >= p.at && t < p.at + p.dur);
}
function stoppedBefore(S, t) {
  return S.pauses.reduce((sum, p) => sum + clamp(t - p.at, 0, p.dur), 0);
}

function sideState(side, t) {
  const S = sides[side];
  const gantry = gantryAt(S, t);
  const dishes = [];
  const pos = new Map();
  for (const d of S.dishes.values()) {
    if (d.born >= 0 && t < d.born) continue;
    const s = dishAt(d, t);
    if (s.presence <= 0.002) continue;
    let mark = false;
    for (const m of S.marks) {
      if (!m.ids.includes(d.id) || t >= m.to) continue;
      const from = m.sweep ? passAt(m.sweep, s.at[0]) : m.from;
      if (t >= from) mark = true;
    }
    const item = { id: d.id, at: s.at, presence: s.presence, dim: s.dim, mark, lit: s.flying > 0 };
    dishes.push(item);
    pos.set(d.id, item);
  }
  const roles = S.roles.map((list) => lastOf(list, t)[1]);
  const tags = S.tagLit.map((list) => within(list, t));
  const logs = S.logLit.map((list) => within(list, t));
  const stopped = stoppedAt(S, t);
  const stall = S.pauses.some((p) => p.kind === "stall" && t >= p.at && t < p.at + p.dur);
  const work = t - stoppedBefore(S, t);
  const tickets = S.tickets.map((ticket) => {
    const pushed = ticket.push < 0 ? 1 : ease((t - ticket.push) / 0.6);
    const popped = ease((t - ticket.pop) / 0.6);
    return { id: ticket.id, presence: pushed * (1 - popped), lift: (1 - pushed) * 12 + popped * 12, alive: t >= ticket.push && t < ticket.pop };
  }).filter((ticket) => ticket.presence > 0.01);
  // 끈: 주문서 → 접시, 또는 접시 → 접시(힙 필드). ZGC 의 힙 끈은 옮겨진 뒤 고쳐질 때까지 옛 자리를 가리킨다.
  const wires = [];
  S.wires.forEach((wire) => {
    if (t < wire.on[0] || t >= wire.on[1]) return;
    const to = pos.get(wire.to);
    if (!to) return;
    const alpha = ease((t - wire.on[0]) / 0.5) * to.presence;
    let end = [to.at[0], to.at[1], to.at[2] + BOWL_TOP];
    let stale = false;
    let heal = 0;
    const h = wire.heap ? S.heals[0] : null;
    if (wire.heap) {
      const d = S.dishes.get(wire.to);
      const moved = d.path.find((key, n) => n > 0 && t >= key.at);
      if (moved) {
        const old = slotAt(side, d.path[0].tile, d.path[0].slot);
        heal = h ? ease((t - h.at - h.dur * 0.45) / (h.dur * 0.4)) : 0;
        const here = [to.at[0], to.at[1], to.at[2] + BOWL_TOP];
        const ghost = [old[0], old[1], TILE_TOP + 0.6];
        end = lerp(ghost, here, heal);
        stale = heal < 1;
      }
    }
    const from = wire.heap ? pos.get(wire.from) : null;
    wires.push({ from: wire.heap ? { dish: wire.from, at: from && [from.at[0], from.at[1], from.at[2] + BOWL_TOP] } : { ticket: wire.from }, to: end, alpha: wire.heap ? 1 : alpha, stale, heap: Boolean(wire.heap) });
  });
  const flash = within(S.flashes, t);
  const heal = S.heals.find((h) => t >= h.at && t < h.at + h.dur);
  const check = heal ? ease((t - heal.at) / 0.2) * (1 - ease((t - heal.at - heal.dur + 0.3) / 0.3)) : 0;
  const ledger = S.ledger.filter((entry) => t >= entry.at && t < T(5, 0.44)).map((entry) => ({ id: entry.id, lit: (heal && heal.ledger === entry.id && t >= heal.at + 0.3) || (t - entry.at < 0.8) }));
  // 다이얼: 키프레임 사이를 부드럽게.
  let dial = 0;
  for (let n = 0; n < S.dial.length; n++) {
    const [at, value] = S.dial[n];
    if (t < at) break;
    const prev = n ? S.dial[n - 1][1] : 0;
    dial = prev + (value - prev) * ease((t - at) / 0.8);
  }
  if (t > T(4, 0.9)) dial *= 1 - ease((t - T(4, 0.9)) / 0.8);
  const done = S.pauses.filter((p) => p.at <= t);
  const real = done.filter((p) => p.kind === "pause");
  const stalls = done.filter((p) => p.kind === "stall");
  const current = S.pauses.find((p) => t >= p.at && t < p.at + p.dur);
  return {
    dishes, roles, tags, logs, gantry, stopped, stall, work, tickets, wires, flash, check, ledger, dial,
    pauses: real.length, longest: real.reduce((m, p) => Math.max(m, p.ms), 0), total: real.reduce((s, p) => s + p.ms, 0),
    stalls: stalls.length, stallMs: stalls.reduce((s, p) => s + p.ms, 0),
    current: current ? current.name : "", label: lastOf([[-1, ""], ...S.labels], t)[1],
  };
}

// 기록계: 지금까지 그려진 멈춤 자국.
export function traceOf(side, t) {
  const marks = [];
  for (const p of sides[side].pauses) {
    if (p.at > t) continue;
    const grow = ease((t - p.at) / Math.min(p.dur, 0.6));
    marks.push({ x: chartX(p.at), h: spikeH(p.ms) * grow, kind: p.kind, ms: p.ms });
  }
  return { pen: chartX(Math.min(t, TOTAL)), marks };
}

export function stateAt(t) {
  const { index, time, u } = phaseAt(t);
  // 마지막 몇 초는 처음 상태로 부드럽게 넘어간다(끝 장면은 흐려지고 첫 장면이 떠오름).
  const reset = ease((time - RESET[0]) / (RESET[1] - RESET[0]));
  const now = { g1: sideState("g1", time), z: sideState("z", time) };
  if (reset > 0) {
    const start = { g1: sideState("g1", 0), z: sideState("z", 0) };
    for (const side of SIDES) {
      const a = now[side];
      const b = start[side];
      a.dishes = [...a.dishes.map((d) => ({ ...d, presence: d.presence * (1 - reset), mark: false })), ...b.dishes.map((d) => ({ ...d, presence: d.presence * reset }))];
      a.wires = reset < 0.5 ? a.wires.map((w) => ({ ...w, alpha: w.alpha * (1 - reset * 2) })) : b.wires.map((w) => ({ ...w, alpha: w.alpha * (reset * 2 - 1) }));
      if (reset >= 0.5) { a.roles = b.roles; a.tickets = b.tickets; }
    }
  }
  return { phase: index, u, time, reset, ...now, trace: { g1: traceOf("g1", time), z: traceOf("z", time), fade: 1 - reset } };
}

export function readoutOf(s) {
  return `G1 · ${s.g1.label}  |  ZGC · ${s.z.label}`;
}
