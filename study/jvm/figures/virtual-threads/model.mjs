// 가상 스레드 모델: 그림의 모든 움직임과 숫자는 이 모듈 하나에서 나온다.
// 단계마다 작은 작업 묶음을 정해 두고, 스레드(레인) 4개로 0.02초씩 시뮬레이션한 기록(SIMS)을 시간 t 로 보간한다.
// 규칙은 JDK 21 기준: 플랫폼 스레드는 작업이 I/O 를 기다리는 동안에도 붙잡혀 있고, 가상 스레드는 블로킹하면 캐리어에서 내려와
// 스택 프레임을 힙으로 옮긴 뒤(stack chunk) 깨어나면 FIFO 큐를 거쳐 비어 있는 아무 캐리어에 다시 올라간다.
// synchronized 안에서 블로킹하면 내려오지 못하고 캐리어를 붙잡는다(pinning, JDK 24 의 JEP 491 전까지).

export const LANES = 4; // 그림의 레인 수. 실제 캐리어 수 기본값은 코어 수(이 맥은 10)
export const CONNS = 10; // HikariCP 기본 maximumPoolSize
export const FRAMES = 3; // 작업 하나의 스택 프레임 수(그림용)
export const HEAP_COLS = 6;
export const HEAP_ROWS = 4;
const DT = 0.02;
export const MOVE = 0.5; // 자리를 옮기는 데 걸리는 시간

const cpu = (s) => ["cpu", s];
const io = (s) => ["io", s];
const db = (s) => ["db", s];

export const PHASES = [
  {
    id: "platform", name: "플랫폼 스레드", seconds: 9.6, side: "L",
    tasks: Array.from({ length: 7 }, (_, i) => ({ id: "P" + i, arrive: 0.3 + i * 0.3, seg: [cpu(0.4), io(3.2), cpu(0.4)] })),
  },
  {
    id: "mount", name: "mount", seconds: 5.6, side: "R",
    tasks: Array.from({ length: 6 }, (_, i) => ({ id: "M" + i, arrive: 0.3 + i * 0.25, seg: [cpu(1.8)] })),
  },
  {
    id: "unmount", name: "블로킹 → unmount", seconds: 7.4, side: "R",
    tasks: Array.from({ length: 6 }, (_, i) => ({ id: "U" + i, arrive: 0.3 + i * 0.2, seg: [cpu(0.9), io(9)] })),
  },
  {
    id: "remount", name: "다른 캐리어에 remount", seconds: 6.2, side: "R", track: "A0",
    tasks: [
      ...Array.from({ length: 4 }, (_, i) => ({ id: "A" + i, arrive: 0.2 + i * 0.05, seg: [cpu(0.7), io(2.2), cpu(1.0)] })),
      ...[3.0, 1.2, 1.6, 2.2].map((s, i) => ({ id: "B" + i, arrive: 1.0 + i * 0.05, seg: [cpu(s)] })),
    ],
  },
  {
    id: "pinning", name: "pinning", seconds: 8.4, side: "R",
    tasks: Array.from({ length: 7 }, (_, i) => ({
      id: "S" + i, arrive: 0.3 + i * 0.15, pinned: i < 4,
      seg: i < 4 ? [cpu(0.5), io(3.0), cpu(0.4)] : [cpu(0.5), io(1.5), cpu(0.3)],
    })),
  },
  {
    id: "pool", name: "커넥션 풀 상한", seconds: 7.4, side: "R",
    tasks: Array.from({ length: 20 }, (_, i) => ({ id: "C" + i, arrive: 0.2 + i * 0.12, seg: [cpu(0.25), db(2.2), cpu(0.2)] })),
  },
];
export const STARTS = PHASES.reduce((list, phase, index) => [...list, index ? list[index - 1] + PHASES[index - 1].seconds : 0], []);
export const TOTAL = PHASES.reduce((sum, phase) => sum + phase.seconds, 0);

// ── 자리(월드 좌표) ──
export const LANE_TOP = 6;
export const TRAY_TOP = 3;
export const HEAP_TOP = 4;
export const RACK_TOP = 8;
export const LANE_W = 18;
export const LANE_Y = -62;
export const LANE_D = 52;
export const SOCKET_Y = -34;
export const LANE_X = { L: [-192, -169, -146, -123], R: [-76, -53, -30, -7] };
export const QUEUE = { L: { x: -190, y: 10 }, R: { x: -74, y: 10 } };
export const QUEUE_GAP = 11;
export const QUEUE_SLOTS = 8;
export const HEAP = { x: 38, y: -68, w: 124, d: 92, r: 3 };
export const RACK = { x: 34, y: 30, w: 112, d: 16, r: 2 };
export const laneAt = (side, k) => [LANE_X[side][k] + LANE_W / 2, SOCKET_Y, LANE_TOP];
export const queueAt = (side, i) => [QUEUE[side].x + 4 + i * QUEUE_GAP, QUEUE[side].y, TRAY_TOP];
export const cellAt = (c) => [HEAP.x + 4.5 + 9.5 + (c % HEAP_COLS) * 19, HEAP.y + 4 + 10.5 + Math.floor(c / HEAP_COLS) * 21, HEAP_TOP];
export const plugAt = (s) => [RACK.x + 8.5 + s * 10.5, RACK.y + RACK.d / 2, RACK_TOP];

// ── 시뮬레이션 ──
// loc: "pend", "q:i", "run:k"(레인 위 실행), "hold:k"(플랫폼 스레드가 I/O 를 기다리며 붙잡힘),
// "pin:k"(가상 스레드가 synchronized 안에서 블로킹해 캐리어를 붙잡음), "heap:c"(unmount, I/O 대기),
// "cw:c"(힙에서 커넥션을 기다림), "conn:s"(커넥션을 쥐고 쿼리 결과를 기다림), "done".
function simulate(phase) {
  const side = phase.side;
  const tasks = phase.tasks.map((spec, index) => ({ ...spec, index, seg: spec.seg.map((s) => [...s]), at: 0, left: 0, loc: "pend", hist: [{ t: 0, loc: "pend" }], lanes: [] }));
  const lanes = Array(LANES).fill(null);
  const cells = Array(HEAP_COLS * HEAP_ROWS).fill(null);
  const plugs = Array(CONNS).fill(null);
  const reserved = Array(CONNS).fill(null);
  const queue = [];
  const connWait = [];
  const counts = [];
  let t = 0;
  const set = (task, loc) => { if (task.loc !== loc) { task.loc = loc; task.hist.push({ t, loc }); } };
  const freeCell = () => cells.indexOf(null);
  const toHeap = (task, kind) => { const c = freeCell(); cells[c] = task; set(task, kind + ":" + c); };
  const leaveHeap = (task) => { const c = cells.indexOf(task); if (c >= 0) cells[c] = null; };
  const enqueue = (task) => { queue.push(task); set(task, "q:" + (queue.length - 1)); };
  const freeLane = (task) => { const k = lanes.indexOf(task); if (k >= 0) lanes[k] = null; return k; };

  // 지금 구간이 끝나면 다음 구간으로. 레인 위에서만 부른다.
  function advance(task) {
    task.at++;
    const k = lanes.indexOf(task);
    if (task.at >= task.seg.length) { freeLane(task); set(task, "done"); return; }
    const [kind, seconds] = task.seg[task.at];
    task.left = seconds;
    if (kind === "cpu") { set(task, "run:" + k); return; }
    if (kind === "io") {
      if (side === "L") { set(task, "hold:" + k); return; }
      if (task.pinned) { set(task, "pin:" + k); return; }
      freeLane(task);
      toHeap(task, "heap");
      return;
    }
    // db: 커넥션을 받으면 쿼리를 보내고 unmount, 못 받으면 힙에서 기다린다(Semaphore.acquire 도 park).
    freeLane(task);
    const mine = reserved.indexOf(task);
    const s = mine >= 0 ? mine : plugs.findIndex((plug, i) => !plug && !reserved[i]);
    if (s >= 0) {
      reserved[s] = null;
      plugs[s] = task;
      set(task, "conn:" + s);
    } else {
      connWait.push(task);
      toHeap(task, "cw");
    }
  }

  const steps = Math.round(phase.seconds / DT);
  for (let step = 0; step <= steps; step++) {
    t = step * DT;
    for (const task of tasks) if (task.loc === "pend" && task.arrive <= t + 1e-9) { task.left = task.seg[0][1]; enqueue(task); }
    for (const task of tasks) {
      const [where, slot] = task.loc.split(":");
      if (!["run", "hold", "pin", "heap", "conn"].includes(where)) continue;
      task.left -= DT;
      if (task.left > 1e-9) continue;
      if (where === "run") advance(task);
      else if (where === "hold" || where === "pin") advance(task);
      else if (where === "heap") { leaveHeap(task); task.at++; task.left = task.seg[task.at][1]; enqueue(task); }
      else if (where === "conn") {
        const s = Number(slot);
        plugs[s] = null;
        task.at++;
        task.left = task.seg[task.at][1];
        enqueue(task);
        // 커넥션을 돌려주면 기다리던 가상 스레드 하나가 깨어난다. 깨어난 스레드가 캐리어에 올라 잠깐 돌고 나서 커넥션을 쥔다.
        const next = connWait.shift();
        if (next) {
          leaveHeap(next);
          reserved[s] = next;
          next.seg.splice(next.at, 0, ["cpu", 0.15]);
          next.left = 0.15;
          enqueue(next);
        }
      }
    }
    // 빈 레인이 큐 앞에서부터 가져간다(FIFO).
    for (let k = 0; k < LANES; k++) {
      if (lanes[k] || !queue.length) continue;
      const task = queue.shift();
      lanes[k] = task;
      task.lanes.push({ t, k });
      set(task, "run:" + k);
    }
    queue.forEach((task, i) => set(task, "q:" + i));
    counts.push({
      t,
      held: lanes.filter(Boolean).length,
      running: tasks.filter((task) => task.loc.startsWith("run")).length,
      queued: queue.length,
      waiting: tasks.filter((task) => /^(hold|pin|heap|conn)/.test(task.loc)).length,
      pinned: tasks.filter((task) => task.loc.startsWith("pin")).length,
      conns: plugs.filter(Boolean).length,
      connWait: connWait.length,
      done: tasks.filter((task) => task.loc === "done").length,
      lanes: lanes.map((task) => (task ? task.loc.split(":")[0] : "idle")),
    });
  }
  const finish = Math.max(...tasks.map((task) => (task.loc === "done" ? task.hist[task.hist.length - 1].t : -1)));
  return { tasks, counts, finish };
}
export const SIMS = PHASES.map(simulate);

export function phaseAt(t) {
  const time = ((t % TOTAL) + TOTAL) % TOTAL;
  let index = PHASES.length - 1;
  while (index > 0 && time < STARTS[index]) index--;
  return { index, time, local: time - STARTS[index], u: (time - STARTS[index]) / PHASES[index].seconds };
}

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp01 = (x) => Math.max(0, Math.min(1, x));
function posOf(side, loc, fallback) {
  const [where, n] = loc.split(":");
  const i = Number(n);
  if (where === "q") return queueAt(side, i);
  if (where === "run" || where === "hold" || where === "pin") return laneAt(side, i);
  if (where === "heap" || where === "cw") return cellAt(i);
  if (where === "conn") { const [x, y, z] = plugAt(i); return [x, y, z + 1.2]; }
  return fallback;
}

export function stateAt(t) {
  const { index, local } = phaseAt(t);
  const phase = PHASES[index];
  const sim = SIMS[index];
  const side = phase.side;
  const fade = clamp01((phase.seconds - local) / 0.35) * clamp01(local / 0.25);
  const tokens = [];
  for (const task of sim.tasks) {
    let h = task.hist.length - 1;
    while (h > 0 && task.hist[h].t > local) h--;
    const cur = task.hist[h];
    if (cur.loc === "pend") continue;
    const prev = task.hist[h - 1];
    const since = local - cur.t;
    const tail = queueAt(side, QUEUE_SLOTS);
    let at;
    let presence = fade;
    if (cur.loc === "done") {
      const from = posOf(side, prev.loc, tail);
      const u = clamp01(since / 0.45);
      at = [from[0], from[1], from[2] + u * 10];
      presence *= 1 - u;
      if (presence <= 0.01) continue;
    } else {
      const to = posOf(side, cur.loc, tail);
      if (prev.loc === "pend") {
        const u = clamp01(since / 0.35);
        at = [to[0] + (1 - ease(u)) * 10, to[1], to[2]];
        presence *= u;
      } else if (since < MOVE) {
        const from = posOf(side, prev.loc, tail);
        const u = ease(since / MOVE);
        const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const lift = Math.min(18, 2 + dist * 0.22) * Math.sin(Math.PI * u);
        at = [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u, from[2] + (to[2] - from[2]) * u + lift];
      } else at = to;
    }
    const where = cur.loc.split(":")[0];
    tokens.push({
      id: task.id, at, presence, where, pinned: !!task.pinned,
      lit: where === "run" && since > MOVE * 0.6,
      waiting: where === "hold" || where === "pin" || where === "heap" || where === "conn",
      tracked: task.id === phase.track,
      flying: since < MOVE && cur.loc !== "done" && prev.loc !== "pend",
    });
  }
  const c = sim.counts[Math.min(sim.counts.length - 1, Math.max(0, Math.round(local / DT)))];
  // remount 추적: 지금까지 이 작업이 올라탄 레인 기록.
  let move = null;
  if (phase.track) {
    const task = sim.tasks.find((one) => one.id === phase.track);
    const seen = task.lanes.filter((entry) => entry.t <= local);
    if (seen.length) move = { from: seen[0].k, to: seen.length > 1 ? seen[seen.length - 1].k : null };
  }
  return { phase: index, side, local, tokens, ...c, lanes: c.lanes, move, finish: sim.finish };
}

export function readoutOf(s) {
  const n = (x) => x + "/" + LANES;
  switch (PHASES[s.phase].id) {
    case "platform":
      return `스레드 점유 ${n(s.held)} · 실제 실행 ${s.running} · 대기 요청 ${s.queued}`;
    case "mount":
      return `캐리어 ${n(s.held)} · 실행 대기 ${s.queued}`;
    case "unmount":
      return `캐리어 ${n(s.held)} · 힙에서 I/O 대기 ${s.waiting}`;
    case "remount":
      return s.move && s.move.to !== null ? `A0 캐리어 ${s.move.from + 1} → ${s.move.to + 1}` : `캐리어 ${n(s.held)} · I/O 대기 ${s.waiting}`;
    case "pinning":
      return `고정된 캐리어 ${n(s.pinned)} · 실행 대기 ${s.queued}`;
    default:
      return `커넥션 ${s.conns}/${CONNS} · 커넥션 대기 ${s.connWait} · 캐리어 ${n(s.held)}`;
  }
}
