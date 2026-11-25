// 스레드 그림 세 장(4a 플랫폼 스레드, 4b 가상 스레드, 4c 가상 스레드의 함정)이 같이 쓰는 모델.
// 그림의 모든 움직임과 숫자는 여기서 나온다. 장면(scenario)마다 작업 묶음을 정해 두고, 레인(스레드) 4개로
// 0.02초씩 시뮬레이션한 기록을 시간 t 로 보간한다. 규칙은 JDK 21 기준이다.
// - 플랫폼 스레드: 작업이 I/O 를 기다리는 동안에도 스레드를 붙잡는다.
// - 가상 스레드: 블로킹하면 캐리어에서 내려와(unmount) 스택 프레임을 힙으로 옮기고, 깨어나면 FIFO 큐를 거쳐
//   비어 있는 아무 캐리어에 다시 올라간다(remount).
// - synchronized 안에서 블로킹하면 내려오지 못하고 캐리어를 붙잡는다(pinning, JDK 24 의 JEP 491 전까지).

export const LANES = 4; // 그림의 레인 수. 실제 캐리어 수 기본값은 코어 수(이 맥은 10)
export const CONNS = 10; // HikariCP 기본 maximumPoolSize
export const FRAMES = 3; // 작업 하나의 스택 프레임 수(그림용)
export const HEAP_COLS = 6;
export const HEAP_ROWS = 4;
export const DT = 0.02;
export const MOVE = 0.5; // 자리를 옮기는 데 걸리는 시간

// ── 자리(월드 좌표) ──
export const LANE_TOP = 6;
export const TRAY_TOP = 3;
export const HEAP_TOP = 4;
export const RACK_TOP = 8;
export const LANE_W = 18;
export const LANE_Y = -62;
export const LANE_D = 52;
export const SOCKET_Y = -34;
export const LANE_X = [-150, -127, -104, -81];
export const QUEUE = { x: -152, y: 10 };
export const QUEUE_GAP = 11;
export const QUEUE_SLOTS = 8;
export const HEAP = { x: -50, y: -68, w: 124, d: 92, r: 3 };
export const RACK = { x: -54, y: 30, w: 112, d: 16, r: 2 };
export const laneAt = (k) => [LANE_X[k] + LANE_W / 2, SOCKET_Y, LANE_TOP];
export const queueAt = (i) => [QUEUE.x + 4 + i * QUEUE_GAP, QUEUE.y, TRAY_TOP];
export const cellAt = (c) => [HEAP.x + 4.5 + 9.5 + (c % HEAP_COLS) * 19, HEAP.y + 4 + 10.5 + Math.floor(c / HEAP_COLS) * 21, HEAP_TOP];
export const plugAt = (s) => [RACK.x + 8.5 + s * 10.5, RACK.y + RACK.d / 2, RACK_TOP];

// ── 시뮬레이션 ──
// loc: "pend", "q:i", "run:k"(레인 위 실행), "hold:k"(플랫폼 스레드가 I/O 를 기다리며 붙잡힘),
// "pin:k"(가상 스레드가 synchronized 안에서 블로킹해 캐리어를 붙잡음), "heap:c"(unmount, I/O 대기),
// "cw:c"(힙에서 커넥션을 기다림), "conn:s"(커넥션을 쥐고 쿼리 결과를 기다림), "done".
// scn = { kind: "platform" | "virtual", seconds, tasks: [{ id, arrive, seg: [["cpu"|"io"|"db", 초]], pinned }] }
export function simulate(scn) {
  const platform = scn.kind === "platform";
  const tasks = scn.tasks.map((spec, index) => ({ ...spec, index, seg: spec.seg.map((s) => [...s]), at: 0, left: 0, loc: "pend", hist: [{ t: 0, loc: "pend" }], lanes: [] }));
  const lanes = Array(LANES).fill(null);
  const cells = Array(HEAP_COLS * HEAP_ROWS).fill(null);
  const plugs = Array(CONNS).fill(null);
  const reserved = Array(CONNS).fill(null);
  const queue = [];
  const connWait = [];
  const counts = [];
  let t = 0;
  const set = (task, loc) => { if (task.loc !== loc) { task.loc = loc; task.hist.push({ t, loc }); } };
  const toHeap = (task, kind) => { const c = cells.indexOf(null); cells[c] = task; set(task, kind + ":" + c); };
  const leaveHeap = (task) => { const c = cells.indexOf(task); if (c >= 0) cells[c] = null; };
  const enqueue = (task) => { queue.push(task); set(task, "q:" + (queue.length - 1)); };
  const freeLane = (task) => { const k = lanes.indexOf(task); if (k >= 0) lanes[k] = null; };

  // 지금 구간이 끝나면 다음 구간으로. 레인 위에서만 부른다.
  function advance(task) {
    task.at++;
    const k = lanes.indexOf(task);
    if (task.at >= task.seg.length) { freeLane(task); set(task, "done"); return; }
    const [kind, seconds] = task.seg[task.at];
    task.left = seconds;
    if (kind === "cpu") { set(task, "run:" + k); return; }
    if (kind === "io") {
      if (platform) { set(task, "hold:" + k); return; }
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

  const steps = Math.round(scn.seconds / DT);
  for (let step = 0; step <= steps; step++) {
    t = step * DT;
    for (const task of tasks) if (task.loc === "pend" && task.arrive <= t + 1e-9) { task.left = task.seg[0][1]; enqueue(task); }
    for (const task of tasks) {
      const [where, slot] = task.loc.split(":");
      if (!["run", "hold", "pin", "heap", "conn"].includes(where)) continue;
      task.left -= DT;
      if (task.left > 1e-9) continue;
      if (where === "run" || where === "hold" || where === "pin") advance(task);
      else if (where === "heap") { leaveHeap(task); task.at++; task.left = task.seg[task.at][1]; enqueue(task); }
      else if (where === "conn") {
        const s = Number(slot);
        plugs[s] = null;
        task.at++;
        task.left = task.seg[task.at][1];
        enqueue(task);
        // 커넥션을 돌려주면 기다리던 가상 스레드 하나가 깨어난다. 캐리어에 올라 잠깐 돌고 나서 커넥션을 쥔다.
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
  const finish = tasks.every((task) => task.loc === "done") ? Math.max(...tasks.map((task) => task.hist[task.hist.length - 1].t)) : null;
  // 레인별 시간 막대: 같은 상태가 이어지는 구간으로 묶는다.
  const segs = Array.from({ length: LANES }, (_, k) => {
    const out = [];
    for (const c of counts) {
      const kind = c.lanes[k];
      const last = out[out.length - 1];
      if (last && last.kind === kind) last.to = c.t + DT;
      else out.push({ kind, from: c.t, to: c.t + DT });
    }
    return out.filter((seg) => seg.kind !== "idle");
  });
  // 누적 실행 시간(레인-초): 일한 비율 계산용.
  let run = 0;
  const busy = counts.map((c) => (run += c.running * DT));
  return { tasks, counts, segs, busy, finish };
}

// fig = { scenarios: [{ kind, seconds, tasks, track?, readout?, phases: [{ name, seconds }] }] }
export function makeModel(fig) {
  const SIMS = fig.scenarios.map(simulate);
  const PHASES = fig.scenarios.flatMap((scn, s) => scn.phases.map((phase) => ({ ...phase, scenario: s })));
  const STARTS = PHASES.reduce((list, phase, index) => [...list, index ? list[index - 1] + PHASES[index - 1].seconds : 0], []);
  const TOTAL = PHASES.reduce((sum, phase) => sum + phase.seconds, 0);
  const SCN_START = fig.scenarios.map((_, s) => STARTS[PHASES.findIndex((phase) => phase.scenario === s)]);

  function phaseAt(t) {
    const time = ((t % TOTAL) + TOTAL) % TOTAL;
    let index = PHASES.length - 1;
    while (index > 0 && time < STARTS[index]) index--;
    return { index, time };
  }

  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  function posOf(loc, fallback) {
    const [where, n] = loc.split(":");
    const i = Number(n);
    if (where === "q") return queueAt(i);
    if (where === "run" || where === "hold" || where === "pin") return laneAt(i);
    if (where === "heap" || where === "cw") return cellAt(i);
    if (where === "conn") { const [x, y, z] = plugAt(i); return [x, y, z + 1.2]; }
    return fallback;
  }

  function stateAt(t) {
    const { index, time } = phaseAt(t);
    const s = PHASES[index].scenario;
    const scn = fig.scenarios[s];
    const sim = SIMS[s];
    const local = time - SCN_START[s];
    const length = scn.phases.reduce((sum, phase) => sum + phase.seconds, 0);
    const fade = clamp01((length - local) / 0.35) * clamp01(local / 0.25);
    const tail = queueAt(QUEUE_SLOTS);
    const tokens = [];
    for (const task of sim.tasks) {
      let h = task.hist.length - 1;
      while (h > 0 && task.hist[h].t > local) h--;
      const cur = task.hist[h];
      if (cur.loc === "pend") continue;
      const prev = task.hist[h - 1];
      const since = local - cur.t;
      let at;
      let presence = fade;
      if (cur.loc === "done") {
        const from = posOf(prev.loc, tail);
        const u = clamp01(since / 0.45);
        at = [from[0], from[1], from[2] + u * 10];
        presence *= 1 - u;
        if (presence <= 0.01) continue;
      } else {
        const to = posOf(cur.loc, tail);
        if (prev.loc === "pend") {
          const u = clamp01(since / 0.35);
          at = [to[0] + (1 - ease(u)) * 10, to[1], to[2]];
          presence *= u;
        } else if (since < MOVE) {
          const from = posOf(prev.loc, tail);
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
        tracked: task.id === scn.track,
        flying: since < MOVE && cur.loc !== "done" && prev.loc !== "pend",
      });
    }
    const step = Math.min(sim.counts.length - 1, Math.max(0, Math.round(local / DT)));
    const c = sim.counts[step];
    // 일한 비율: 지금까지(끝났으면 끝난 시각까지) 레인 4개가 실제로 CPU 를 돈 시간의 몫.
    const until = sim.finish !== null ? Math.min(local, sim.finish) : local;
    const util = until > 0.05 ? sim.busy[Math.min(step, Math.round(until / DT))] / (LANES * until) : 0;
    let move = null;
    if (scn.track) {
      const task = sim.tasks.find((one) => one.id === scn.track);
      const seen = task.lanes.filter((entry) => entry.t <= local);
      if (seen.length) move = { from: seen[0].k, to: seen.length > 1 ? seen[seen.length - 1].k : null };
    }
    return { phase: index, scenario: s, kind: scn.kind, local, length, tokens, ...c, util, move, finish: sim.finish, total: sim.tasks.length };
  }

  function readoutOf(s) {
    const scn = fig.scenarios[s.scenario];
    if (scn.readout === "pool") return `커넥션 ${s.conns}/${CONNS} · 커넥션 대기 ${s.connWait} · 완료 ${s.done}/${s.total}`;
    const elapsed = s.finish !== null && s.local >= s.finish ? s.finish : s.local;
    return `완료 ${s.done}/${s.total} · 경과 ${elapsed.toFixed(1)}초 · 스레드 실제 일한 비율 ${Math.round(s.util * 100)}%`;
  }

  return { SIMS, PHASES, STARTS, TOTAL, phaseAt, stateAt, readoutOf };
}
