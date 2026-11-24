// 세대별 GC 주방 모델: 그림의 모든 움직임과 숫자는 이 모듈 하나에서 나온다.
// 객체(접시)의 수명과 GC 시점을 정해 두고, HotSpot 의 Serial GC 규칙대로 한 번 돌려 본 결과(SIM)를
// 시간 t 로 보간한다. 값은 JDK 21 기본값: SurvivorRatio=8, NewRatio=2, MaxTenuringThreshold=15, TargetSurvivorRatio=50.

export const EDEN_CAP = 32; // Eden : S0 : S1 = 8 : 1 : 1
export const SURV_CAP = 4;
export const OLD_CAP = 80; // Old : Young = 2 : 1 (Young = 32 + 4 + 4)
export const MAX_AGE = 15;
export const DESIRED = SURV_CAP * 0.5; // TargetSurvivorRatio 50%
export const SEEDS = 30;
export const CACHE_SLOT = 7; // Old 의 캐시 접시: Young 접시를 붙잡는다(카드 테이블)

export const PHASES = [
  { id: "alloc", name: "할당", seconds: 6 },
  { id: "minor", name: "Minor GC", seconds: 7 },
  { id: "card", name: "카드 테이블", seconds: 8 },
  { id: "age", name: "나이 먹기", seconds: 9 },
  { id: "promote", name: "승격", seconds: 7 },
  { id: "overflow", name: "Survivor 넘침", seconds: 8 },
  { id: "dynamic", name: "동적 임계값", seconds: 7 },
  { id: "full-old", name: "Old 가득", seconds: 7 },
  { id: "full", name: "Full GC", seconds: 10 },
];
export const STARTS = PHASES.reduce((list, phase, index) => [...list, index ? list[index - 1] + PHASES[index - 1].seconds : 0], []);
export const TOTAL = PHASES.reduce((sum, phase) => sum + phase.seconds, 0);
const T = (phase, share) => STARTS[phase] + PHASES[phase].seconds * share;

// ── 자리(월드 좌표) ──
export const COUNTER_TOP = 29;
export const TABLE_TOP = 22;
export const SURV = [{ x: -54, y: -28, w: 22, d: 22 }, { x: -28, y: -28, w: 22, d: 22 }];
export const edenAt = (i) => [-160 + Math.floor(i / 4) * 11, -31 + (i % 4) * 12, COUNTER_TOP];
export const survAt = (space, j) => [SURV[space].x + 6 + (j % 2) * 10, SURV[space].y + 6 + Math.floor(j / 2) * 10, TABLE_TOP];
export const oldAt = (s) => [24 + (s % 10) * 10.5, -76 + Math.floor(s / 10) * 10.5, COUNTER_TOP];
export const RING_H = 1.1;
export const BOWL_TOP = 2.6;

// ── 시나리오 ──
// 주문서(루트). push/pop 은 초 단위 절대 시각.
export const TICKETS = [
  { id: "A1", thread: 0, push: T(0, 0.04), pop: T(8, 0.95) },
  { id: "B1", thread: 1, push: T(0, 0.2), pop: T(2, 0.08) },
  { id: "A2", thread: 0, push: T(4, 0.08), pop: T(7, 0.04) },
  { id: "B2", thread: 1, push: T(5, 0.06), pop: T(7, 0.06) },
];

// GC 시점. at = 시작 시각, dur = 걸리는 시간, ff = 빨리 감기(갠트리 없이 짧게).
const GCS = [];
GCS.push({ at: T(1, 0.08), dur: PHASES[1].seconds * 0.84, type: "minor" });
GCS.push({ at: T(2, 0.4), dur: PHASES[2].seconds * 0.56, type: "minor" });
for (let i = 0; i < 13; i++) GCS.push({ at: T(3, 0.04 + i * 0.068), dur: PHASES[3].seconds * 0.04, type: "minor", ff: true });
GCS.push({ at: T(4, 0.34), dur: PHASES[4].seconds * 0.6, type: "minor" });
GCS.push({ at: T(5, 0.34), dur: PHASES[5].seconds * 0.62, type: "minor" });
GCS.push({ at: T(6, 0.32), dur: PHASES[6].seconds * 0.6, type: "minor" });
const FILL_GCS = 7;
for (let i = 0; i < FILL_GCS; i++) GCS.push({ at: T(7, 0.04 + i * 0.12), dur: PHASES[7].seconds * 0.06, type: "minor", ff: true });
GCS.push({ at: T(8, 0.04), dur: PHASES[8].seconds * 0.88, type: "full" });
GCS.forEach((gc, index) => (gc.no = index + 1));
export { GCS };

// Eden 에 들어오는 살아 있는 접시. idx = Eden 자리, root = 붙잡는 쪽, dies = 놓는 시각.
const OBJECTS = [];
const add = (object) => OBJECTS.push({ age: 0, ...object });
add({ id: "H", idx: 10, born: T(0, 0.08), root: "A1", dies: T(8, 0.95), hero: true });
add({ id: "m1", idx: 17, born: T(0, 0.28), root: "B1", dies: T(2, 0.08) });
add({ id: "m2", idx: 13, born: T(2, 0.2), root: "C", dies: T(3, 0.12) });
add({ id: "m3", idx: 9, born: T(4, 0.14), root: "A2", dies: T(7, 0.04) });
[6, 11, 14, 18, 21, 25].forEach((idx, i) => add({ id: "b" + i, idx, born: T(5, 0.1 + i * 0.025), root: "B2", dies: i === 1 ? T(6, 0.15) : T(7, 0.06), batch: true }));
// Old 가득 단계: GC 마다 6개씩 살아 있는 접시가 들어와 넘친다(빨리 감기라 끈은 그리지 않는다).
// 한 번 더 살아남아 다음 GC 에서 임계값 1 로 승격되고, 그다음에 버려진다.
for (let g = 0; g < FILL_GCS; g++) {
  const first = GCS.length - 1 - FILL_GCS + g;
  const gc = GCS[first];
  const after = GCS[first + 1];
  [3, 7, 12, 16, 22, 27].forEach((idx, i) => add({ id: `f${g}_${i}`, idx, born: gc.at - 0.2, root: "B3", dies: after.type === "full" ? after.at : after.at + after.dur * 0.5, ff: true }));
}
// Full GC 때 살아남는 Old 접시: 씨앗 30개 중 하나(12번)는 만료, 대신 승격된 H 가 산다 → 다시 30개.
const SEED_DIES = 12;

// ── 시뮬레이션 ──
function simulate() {
  const old = Array.from({ length: OLD_CAP }, (_, s) => (s < SEEDS ? { id: "s" + s, seed: true, age: MAX_AGE } : null));
  const surv = [[], []];
  let from = 0; // 지금 from 공간. 처음엔 둘 다 비어 있고 첫 GC 의 to 는 S0.
  let to = 0;
  let threshold = MAX_AGE;
  let promoted = 0;
  const steps = [];
  for (const gc of GCS) {
    const t = gc.at + gc.dur * 0.15; // 살아 있는지 판단하는 순간(표시 단계)
    const moves = [];
    const before = { surv: surv.map((list) => list.map((o) => ({ ...o }))), old: old.map((o) => (o ? { ...o } : null)), threshold, from, to };
    if (gc.type === "minor") {
      const target = [];
      const live = (o) => o.dies > t;
      const go = (o, src) => {
        if (src.space !== "eden" && o.age >= threshold) {
          const s = old.indexOf(null);
          old[s] = { id: o.id, age: o.age };
          promoted++;
          moves.push({ id: o.id, src, dst: { space: "old", slot: s }, age: o.age, why: "age" });
        } else if (target.length < SURV_CAP) {
          const moved = { ...o, age: o.age + 1 };
          moves.push({ id: o.id, src, dst: { space: to, slot: target.length }, age: moved.age, why: "copy" });
          target.push(moved);
        } else {
          const s = old.indexOf(null);
          old[s] = { id: o.id, age: o.age + 1 };
          promoted++;
          moves.push({ id: o.id, src, dst: { space: "old", slot: s }, age: o.age + 1, why: "overflow" });
        }
      };
      surv[from].forEach((o, j) => (live(o) ? go(o, { space: from, slot: j }) : moves.push({ id: o.id, src: { space: from, slot: j }, dst: null, age: o.age })));
      OBJECTS.filter((o) => o.born < gc.at && o.born > (steps.length ? GCS[steps.length - 1].at : -1) && live(o)).sort((a, b) => a.idx - b.idx).forEach((o) => go({ ...o, age: 0 }, { space: "eden", slot: o.idx }));
      surv[from] = [];
      surv[to] = target;
      // 동적 나이 판정: 나이 1 부터 누적해서 원하는 크기(50%)를 넘는 나이가 다음 임계값.
      let total = 0;
      threshold = MAX_AGE;
      for (let age = 1; age <= MAX_AGE; age++) {
        total += target.filter((o) => o.age === age).length;
        if (total > DESIRED) { threshold = age; break; }
      }
      from = to;
      to = 1 - to;
    } else {
      // Full GC: 힙 전체를 표시 → 정리 → 압축. Young 은 이 시나리오에서 모두 쓰레기.
      const keep = [];
      old.forEach((o, s) => {
        if (!o) return;
        const alive = o.seed ? s !== SEED_DIES : o.id === "H";
        moves.push({ id: o.id, src: { space: "old", slot: s }, dst: alive ? { space: "old", slot: keep.length } : null, alive });
        if (alive) keep.push(o);
      });
      old.fill(null);
      keep.forEach((o, s) => (old[s] = { ...o, seed: true }));
      surv[0] = [];
      surv[1] = [];
      threshold = MAX_AGE;
    }
    steps.push({ gc, moves, before, after: { surv: surv.map((list) => list.map((o) => ({ ...o }))), old: old.map((o) => (o ? { ...o } : null)), threshold, from, to }, promoted });
  }
  return steps;
}
export const SIM = simulate();

// ── 시간 보간 ──
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const ease = (value) => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};
const lerp = (a, b, s) => a.map((v, i) => v + (b[i] - v) * s);

export function phaseAt(t) {
  const time = ((t % TOTAL) + TOTAL) % TOTAL;
  let index = PHASES.length - 1;
  while (index > 0 && time < STARTS[index]) index--;
  return { index, time, u: (time - STARTS[index]) / PHASES[index].seconds };
}

// GC 하나 안의 구간(비율): 멈춤 → 표시 → 복사 → 정리 → 재개.
const MARK = [0.04, 0.16];
const COPY = [0.18, 0.56];
const WIPE = [0.58, 0.86];
export const GANTRY = [-174, -72];

const posOf = (place) => (place.space === "eden" ? edenAt(place.slot) : place.space === "old" ? oldAt(place.slot) : survAt(place.space, place.slot));

export function stateAt(t) {
  const { index, time, u } = phaseAt(t);
  // 지금 진행 중이거나 가장 최근에 끝난 GC.
  let k = -1;
  for (let i = 0; i < SIM.length; i++) if (SIM[i].gc.at <= time) k = i;
  const step = k >= 0 ? SIM[k] : null;
  const g = step ? clamp((time - step.gc.at) / step.gc.dur) : 1;
  const inGc = step && g < 1;
  const base = step ? (inGc ? step.before : step.after) : SIM[SIM.length - 1].after;

  // 멈춤(STW): 비컨과 요리사. Minor 는 짧게, Full 은 길게.
  const stw = inGc ? ease(g / 0.04) * (1 - ease((g - 0.9) / 0.08)) : 0;
  const full = step && step.gc.type === "full";
  // 스톱워치: Minor 약 2ms(로그), Full 은 설명용 80ms.
  const PAUSE = full ? 80 : 2;
  const pauseMs = step ? PAUSE * clamp((g - 0.04) / 0.86) : 0;

  // ── Eden ── 지난 GC 가 끝난 뒤부터 다음 GC 직전까지 범프 포인터가 0 → 32 로 간다.
  const next = SIM[k + 1] ? SIM[k + 1].gc : null;
  const lastAt = step ? step.gc.at : -1;
  let edenCount = EDEN_CAP;
  if (!inGc) {
    if (step && step.gc.type === "full") edenCount = 0;
    else {
      const from = step ? step.gc.at + step.gc.dur : STARTS[0] + PHASES[0].seconds * 0.05;
      const to = (next ? next.at : TOTAL) - (next && next.ff ? 0.03 : 0.2);
      edenCount = Math.round(EDEN_CAP * clamp((time - from) / Math.max(0.05, to - from)));
    }
  }
  const edenObjects = OBJECTS.filter((o) => o.born > lastAt && (next ? o.born < next.at : true));
  const eden = Array.from({ length: EDEN_CAP }, (_, i) => ({ presence: i < edenCount ? 1 : 0, lit: false, live: null }));
  if (inGc) {
    // GC 중: 복사되어 나간 자리는 비고, 남은 쓰레기는 정리 구간에 갠트리가 지나가며 지운다.
    const wipe = ease((g - WIPE[0]) / (WIPE[1] - WIPE[0]));
    const sweptX = GANTRY[0] + (GANTRY[1] - GANTRY[0]) * wipe;
    eden.forEach((cell, i) => {
      const x = edenAt(i)[0];
      cell.presence = step.gc.type === "full" ? 1 - ease((g - 0.2) / 0.3) : step.gc.ff ? 1 - wipe : 1 - clamp((sweptX - x + 4) / 10);
    });
  }
  // 이번 GC 에서 Eden 에서 나간 접시(복사·승격)는 복사가 시작되면 Eden 자리에서 사라진다.
  const moving = [];
  if (inGc && step.gc.type === "minor") {
    step.moves.forEach((move, order) => {
      if (!move.dst) return;
      const count = step.moves.filter((m) => m.dst).length;
      const share = count > 1 ? order / (count - 1) : 0;
      const s0 = COPY[0] + share * (COPY[1] - COPY[0]) * 0.55;
      const s = ease((g - s0) / ((COPY[1] - COPY[0]) * 0.45));
      if (move.src.space === "eden") eden[move.src.slot].presence = s > 0 ? 0 : eden[move.src.slot].presence;
      moving.push({ move, s });
    });
  }
  for (const o of edenObjects) {
    if (o.idx < edenCount || inGc) {
      const cell = eden[o.idx];
      cell.live = o.id;
      if (inGc && step.gc.type === "minor" && g >= MARK[0] && step.moves.some((m) => m.id === o.id && m.dst)) cell.lit = true;
    }
  }

  // ── Survivor ── 쉬고 있는 접시(자리에 그대로 있는 것)와 날아가는 접시.
  const mobile = [];
  const restSurv = inGc && step.gc.type === "minor" ? step.before.surv : base.surv;
  restSurv.forEach((list, space) =>
    list.forEach((o, j) => {
      const hopping = moving.find((m) => m.move.id === o.id && m.move.src.space === space);
      if (hopping && hopping.s > 0) return;
      let presence = 1;
      let lit = false;
      if (inGc && step.gc.type === "minor") {
        const dead = step.moves.find((m) => m.id === o.id && !m.dst);
        if (dead) presence = 1 - ease((g - WIPE[0]) / (WIPE[1] - WIPE[0]));
        else if (g >= MARK[0]) lit = true;
      }
      if (inGc && step.gc.type === "full") presence = 1 - ease((g - 0.2) / 0.3);
      mobile.push({ id: o.id, at: survAt(space, j), age: o.age, presence, lit, hero: o.id === "H" });
    }),
  );
  for (const { move, s } of moving) {
    if (s <= 0) continue;
    const a = posOf(move.src);
    const b = posOf(move.dst);
    const p = lerp(a, b, s);
    p[2] += Math.sin(Math.PI * s) * (move.dst.space === "old" ? 34 : 26);
    const landed = s >= 1;
    if (landed && move.dst.space === "old") continue; // Old 접시는 정적 자리에서 보인다
    const age = s > 0.5 ? move.age : move.src.space === "eden" ? 0 : move.dst.space === "old" && move.why === "age" ? move.age : move.age - 1;
    mobile.push({ id: move.id, at: p, age, presence: 1, lit: !landed || g < WIPE[1], hero: move.id === "H", flying: !landed, why: move.why });
  }

  // ── Old ── 자리마다 접시가 있는지, 압축 중이면 얼마나 밀렸는지.
  // age: 승격될 때의 나이. Old 에서는 더 세지 않아서 흐린 뚜껑 하나로 남겨 둔다(객체 헤더의 나이 비트는 그대로 있다).
  const oldState = Array.from({ length: OLD_CAP }, () => ({ presence: 0, dim: 0, shift: [0, 0], lit: false, age: 0 }));
  const oldSrc = inGc ? step.before.old : base.old;
  oldSrc.forEach((o, s) => {
    if (o) { oldState[s].presence = 1; oldState[s].age = o.age || 0; }
  });
  if (inGc && step.gc.type === "minor") {
    for (const { move, s } of moving) if (move.dst.space === "old" && s >= 1) { oldState[move.dst.slot].presence = 1; oldState[move.dst.slot].lit = true; oldState[move.dst.slot].age = move.age; }
  }
  if (inGc && step.gc.type === "full") {
    const mark = ease((g - 0.1) / 0.18);
    const sweep = ease((g - 0.34) / 0.18);
    const compact = ease((g - 0.56) / 0.28);
    for (const move of step.moves) {
      const cell = oldState[move.src.slot];
      if (!move.alive) {
        cell.dim = mark;
        cell.presence = 1 - sweep;
      } else {
        cell.lit = g >= 0.1 && g < 0.9;
        const a = oldAt(move.src.slot);
        const b = oldAt(move.dst.slot);
        cell.shift = [(b[0] - a[0]) * compact, (b[1] - a[1]) * compact];
      }
    }
  }
  // 승격된 H 의 Old 자리(끈을 잇기 위해).
  let heroOld = null;
  oldSrc.forEach((o, s) => o && o.id === "H" && (heroOld = s));
  if (inGc && step.gc.type === "minor") for (const { move, s } of moving) if (move.id === "H" && move.dst.space === "old" && s >= 1) heroOld = move.dst.slot;

  // ── 카드 테이블 ── Old → Young 참조가 있는 열의 카드가 켜진다.
  const cards = Array.from({ length: 10 }, () => 0);
  const m2 = OBJECTS.find((o) => o.id === "m2");
  if (time >= m2.born && time < m2.dies) cards[CACHE_SLOT % 10] = 1;

  // ── 주문서(루트)와 끈 ──
  const tickets = TICKETS.map((ticket) => {
    const pushed = clamp((time - ticket.push) / 0.6);
    const popped = clamp((time - ticket.pop) / 0.6);
    const alive = time >= ticket.push && time < ticket.pop;
    return { ...ticket, alive, presence: ease(pushed) * (1 - ease(popped)), lift: (1 - ease(pushed)) * 14 + ease(popped) * 14 };
  });
  // 접시가 지금 어디에 그려지는지: Eden 자리, Survivor(쉬거나 날아가는 중), Old 자리.
  const where = (id) => {
    const m = mobile.find((item) => item.id === id);
    if (m) return [m.at[0], m.at[1], m.at[2] + BOWL_TOP + m.age * RING_H];
    if (id === "H" && heroOld !== null) {
      const p = oldAt(heroOld);
      const cell = oldState[heroOld];
      return [p[0] + cell.shift[0], p[1] + cell.shift[1], p[2] + BOWL_TOP + (cell.age ? RING_H : 0)];
    }
    const i = eden.findIndex((cell) => cell.live === id && cell.presence > 0.5);
    if (i >= 0) return [...edenAt(i).slice(0, 2), COUNTER_TOP + BOWL_TOP];
    return null;
  };
  const wires = [];
  for (const o of OBJECTS) {
    if (o.ff || time < o.born || time >= o.dies) continue;
    const to = where(o.id);
    if (!to) continue;
    wires.push({ from: o.root, to, alpha: 1 });
  }

  const survUsed = base.surv.map((list) => list.length);
  if (inGc && (step.gc.type === "minor" ? g >= WIPE[1] : g >= 0.5)) [0, 1].forEach((space) => (survUsed[space] = step.after.surv[space].length));
  const oldUsed = (inGc ? (g >= 0.5 ? step.after.old : step.before.old) : base.old).filter(Boolean).length;
  const promoted = step ? (inGc && g < COPY[1] ? (k ? SIM[k - 1].promoted : 0) : step.promoted) : 0;
  const thresholdNow = step ? (inGc && g < WIPE[1] ? step.before.threshold : step.after.threshold) : MAX_AGE;
  // 게이지 표시는 부드럽게 따라간다.
  const gauge = step && inGc ? step.before.threshold + (step.after.threshold - step.before.threshold) * ease((g - WIPE[0]) / (1 - WIPE[0])) : thresholdNow;
  const gantry = inGc && step.gc.type === "minor" && !step.gc.ff ? ease((g - WIPE[0]) / (WIPE[1] - WIPE[0])) * (1 - ease((g - WIPE[1]) / (1 - WIPE[1]))) : 0;
  const toSpace = inGc && step.gc.type === "minor" ? step.before.to : -1;
  const fromSpace = inGc ? step.before.from : base.from;
  const running = !inGc;
  const pc = [0, 1].map((thread) => (running ? Math.floor(time / 0.3 + thread * 3) % 7 : Math.floor((step.gc.at) / 0.3 + thread * 3) % 7));

  return {
    phase: index,
    u,
    time,
    gcNo: step ? step.gc.no : 0,
    kind: step ? (full ? "Full" : "Minor") : "",
    inGc: Boolean(inGc),
    ff: Boolean(step && step.gc.ff && inGc),
    gcProgress: inGc ? g : 1,
    stw,
    pauseMs,
    lastPause: step ? PAUSE : 0,
    edenCount: inGc ? eden.filter((cell) => cell.presence > 0.5).length : edenCount,
    bump: edenCount,
    eden,
    mobile,
    old: oldState,
    cards,
    tickets,
    wires,
    survUsed,
    oldUsed,
    threshold: thresholdNow,
    gauge,
    promoted,
    toSpace,
    fromSpace,
    why: new Set(moving.map((m) => m.move.why)),
    gantryX: GANTRY[0] + (GANTRY[1] - GANTRY[0]) * gantry,
    pc,
  };
}

export function readoutOf(s) {
  const p = s.phase;
  if (p === 0) return `새 접시는 Eden 에 · ${s.edenCount}/${EDEN_CAP}`;
  if (s.inGc && s.kind === "Full") {
    const g = s.gcProgress;
    return g < 0.34 ? "Full GC · 힙 전체 표시" : g < 0.56 ? "Full GC · 끊긴 접시 정리" : "Full GC · 압축(빈틈 메우기)";
  }
  if (s.inGc && s.ff) return `빨리 감기 · GC #${s.gcNo}`;
  if (s.inGc) {
    const g = s.gcProgress;
    if (g < 0.18) return `Minor GC #${s.gcNo} · 멈춤 · 산 접시 표시`;
    if (g < 0.58) {
      if (s.why.has("overflow")) return `S${s.toSpace} 가 넘쳐 나머지는 Old 로 바로`;
      if (s.why.has("age")) return `나이 ≥ 임계값 ${s.threshold} → Old 로 승격`;
      return `살아남은 접시 → S${s.toSpace} (나이 +1)`;
    }
    return "Eden 과 from 을 통째로 비움";
  }
  if (p === 7) return s.u > 0.9 ? `Old ${s.oldUsed}/${OLD_CAP} · 다음 승격이 안 들어감` : `Old ${s.oldUsed}/${OLD_CAP} · 빨리 감기`;
  if (p === 8) return `Full GC 끝 · Old ${s.oldUsed}/${OLD_CAP} · 멈춤 ${s.lastPause}ms`;
  if (p === 2 && s.cards.some(Boolean)) return "Old → Young 끈 = 카드 테이블 표시";
  if (p === 3) return `나이 먹기 · GC #${s.gcNo}`;
  if (p === 5 && s.threshold < MAX_AGE) return `임계값 ${MAX_AGE} → ${s.threshold}`;
  return `Eden ${s.edenCount}/${EDEN_CAP} · 임계값 ${s.threshold}`;
}
