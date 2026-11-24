// JVM 주방 모델: 그림의 모든 움직임과 숫자는 이 모듈 하나에서 나온다.
// 시간 t(초)를 넣으면 그 순간의 주방 상태를 돌려주는 순수 함수만 있다.

export const PHASES = [
  { id: "build", name: "빌드", seconds: 4 },
  { id: "load", name: "클래스 로딩", seconds: 6 },
  { id: "link", name: "링킹·초기화", seconds: 6 },
  { id: "interpret", name: "인터프리터 실행", seconds: 9 },
  { id: "jit", name: "JIT 컴파일", seconds: 6 },
  { id: "gc", name: "GC", seconds: 7 },
];

export const STARTS = PHASES.reduce((list, phase, index) => [...list, index ? list[index - 1] + PHASES[index - 1].seconds : 0], []);
export const TOTAL = PHASES.reduce((sum, phase) => sum + phase.seconds, 0);

// 설명용 값. HotSpot 의 실제 임계값은 계층형 컴파일 설정마다 다르다.
export const THRESHOLD = 10000;
export const DIAL_MAX = 12000;
export const LINES = 7;

// 스레드(요리사) 두 명의 주문서. at 은 [단계, 단계 안 비율].
export const TICKETS = [
  { id: "A1", thread: 0, push: [3, 0.05], pop: null },
  { id: "B1", thread: 1, push: [3, 0.15], pop: null },
  { id: "A2", thread: 0, push: [3, 0.3], pop: [5, 0.2] },
  { id: "B2", thread: 1, push: [3, 0.45], pop: [5, 0.12] },
  { id: "A3", thread: 0, push: [3, 0.6], pop: [5, 0.05] },
];

// 조리대(Heap)의 접시(객체). from 은 이 접시를 붙잡는 쪽: 주문서, 다른 접시, 또는 static.
export const DISHES = [
  { id: 0, slot: [0, 0], alloc: [3, 0.08], from: "A1" },
  { id: 1, slot: [1, 0], alloc: [3, 0.33], from: "A2" },
  { id: 2, slot: [1, 1], alloc: [3, 0.36], from: "d1" },
  { id: 3, slot: [2, 0], alloc: [3, 0.63], from: "A3" },
  { id: 4, slot: [0, 1], alloc: [3, 0.18], from: "B1" },
  { id: 5, slot: [2, 1], alloc: [3, 0.48], from: "B2" },
  { id: 6, slot: [3, 0], alloc: [4, 0.3], from: "static" },
  { id: 7, slot: [3, 1], alloc: [4, 0.7], from: "A3" },
];

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const ease = (value) => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};
const span = (u, from, to) => ease((u - from) / (to - from));
const timeOf = ([phase, share]) => STARTS[phase] + PHASES[phase].seconds * share;

export function phaseAt(t) {
  const time = ((t % TOTAL) + TOTAL) % TOTAL;
  let index = PHASES.length - 1;
  while (index > 0 && time < STARTS[index]) index--;
  return { index, time, u: (time - STARTS[index]) / PHASES[index].seconds };
}

// GC: 쓰레기통 위에 서 있던 갠트리가 조리대를 왼쪽 끝까지 훑고(GC_FROM → GC_TURN) 돌아온다(→ GC_TO).
const GC_FROM = 0.25;
const GC_TURN = 0.6;
const GC_TO = 0.92;
export const GANTRY = [98, -56];

export function stateAt(t, dishX = (slot) => slot[0]) {
  const { index, time, u } = phaseAt(t);
  const after = (at) => time >= timeOf(at);
  const since = (at, seconds) => clamp((time - timeOf(at)) / seconds);
  // 새 바퀴가 시작될 때 지난 바퀴에 남은 것(살아남은 주문서와 접시)을 지운다.
  const wipe = index === 0 ? 1 - span(u, 0, 0.12) : 1;

  const tickets = TICKETS.map((ticket) => {
    const pushed = since(ticket.push, 0.6);
    const popped = ticket.pop ? since(ticket.pop, 0.6) : 0;
    const alive = after(ticket.push) && !(ticket.pop && after(ticket.pop));
    let presence = ease(pushed) * (1 - ease(popped));
    let lift = (1 - ease(pushed)) * 14 + ease(popped) * 14;
    if (index === 0) {
      // 이전 바퀴에서 남은 주문서(pop 없는 것)만 사라지며 보인다.
      presence = ticket.pop ? 0 : wipe;
      lift = (1 - wipe) * 14;
    }
    return { ...ticket, alive: index === 0 ? false : alive, presence, lift };
  });
  const roots = new Set(tickets.filter((ticket) => ticket.alive).map((ticket) => ticket.id));
  const staticSet = index >= 2 && !(index === 2 && u < 0.7);
  if (index >= 4 || index === 5) roots.add("static");

  const gcOn = index === 5 && u >= GC_FROM && u < GC_TO;
  const out = index === 5 ? span(u, GC_FROM, GC_TURN) : 0;
  const back = index === 5 ? span(u, GC_TURN, GC_TO) : 0;
  const gantryX = GANTRY[0] + (GANTRY[1] - GANTRY[0]) * (out - back);
  // 지금까지 훑고 지나간 가장 왼쪽 위치.
  const swept = GANTRY[0] + (GANTRY[1] - GANTRY[0]) * out;

  const dishes = DISHES.map((dish) => {
    const born = after(dish.alloc) && index !== 0;
    const reachable = dish.from.startsWith("d") ? false : roots.has(dish.from);
    return { ...dish, born, reachable };
  });
  // 접시가 다른 접시를 통해서만 닿는 경우를 한 번 더 따라간다.
  for (const dish of dishes) if (dish.from.startsWith("d")) dish.reachable = dishes[Number(dish.from.slice(1))].reachable && dishes[Number(dish.from.slice(1))].born;

  let collected = 0;
  for (const dish of dishes) {
    const drop = (1 - since(dish.alloc, 0.6)) * 10;
    let presence = dish.born ? ease(since(dish.alloc, 0.6)) : 0;
    let gone = 0;
    if (index === 5 && !dish.reachable && dish.born) {
      gone = clamp((dishX(dish.slot) + 4 - swept) / 12);
      if (gone >= 1) collected++;
    }
    if (index === 0) {
      const survived = ["A1", "B1", "static"].includes(dish.from);
      presence = survived ? wipe : 0;
    }
    dish.presence = presence * (1 - ease(gone));
    dish.lift = drop + ease(gone) * 12;
    dish.gone = gone;
  }
  const heapUsed = dishes.filter((dish) => dish.presence > 0.5).length;

  // 호출 횟수: 인터프리터 동안 임계값 바로 아래까지, JIT 단계 초반에 넘는다.
  let calls = 0;
  if (index === 3) calls = Math.round(9600 * u);
  if (index === 4) calls = Math.round(u < 0.15 ? 9600 + (THRESHOLD - 9600) * (u / 0.15) * 1.02 : THRESHOLD + (DIAL_MAX - THRESHOLD - 200) * ((u - 0.15) / 0.85));
  if (index === 5) calls = DIAL_MAX - 200 + Math.round(u < GC_FROM ? 200 * (u / GC_FROM) * 0.5 : gcOn ? 100 : 100 + 100 * clamp((u - GC_TO) / (1 - GC_TO)));
  if (index === 0) calls = Math.round((DIAL_MAX) * wipe);
  calls = Math.min(calls, DIAL_MAX);
  const hot = calls >= THRESHOLD && index >= 4;
  const kit = index === 4 ? span(u, 0.2, 0.6) : index === 5 ? 1 : index === 0 ? wipe : 0;
  const compiled = index === 5 || (index === 4 && u >= 0.6);

  // PC: 카드의 몇 번째 줄을 하고 있는지. 인터프리터는 0.3초에 한 줄, 기계어는 줄을 읽지 않는다.
  const running = index === 3 || index === 4 || (index === 5 && !gcOn);
  const pc = [0, 1].map((thread) => {
    if (!running || !roots.size) return 0;
    if (compiled) return 0;
    return Math.floor(time / 0.3 + thread * 3) % LINES;
  });
  const stack = [0, 1].map((thread) => tickets.filter((ticket) => ticket.thread === thread && ticket.alive).length);

  return {
    phase: index,
    u,
    time,
    printer: index === 0 ? span(u, 0.15, 0.7) : index === 1 ? 1 - span(u, 0, 0.2) : 0,
    lift: liftAt(index, u),
    ask: index === 1 ? (u < 0.35 ? 2 : u < 0.6 ? 1 : 0) : -1,
    found: index === 1 && u >= 0.75,
    pick: index === 1 ? span(u, 0.78, 0.95) : index === 2 ? 1 - span(u, 0.85, 1) : 0,
    step: index === 2 ? (u < 0.25 ? 0 : u < 0.5 ? 1 : u < 0.7 ? 2 : 3) : -1,
    drawer: index === 2 ? span(u, 0.05, 0.25) * (1 - span(u, 0.85, 1)) : 0,
    staticSet,
    ingredient: index === 2 ? span(u, 0.7, 0.9) : index >= 3 ? 1 : wipe,
    tickets,
    stack,
    pc,
    dishes,
    heapUsed,
    collected,
    calls,
    hot,
    kit,
    compiled,
    gcOn,
    paused: gcOn,
    gantryX,
  };
}

// 리프트 높이: 0 = 지점(Application), 1 = 지역(Platform), 2 = 본사(Bootstrap).
function liftAt(index, u) {
  if (index !== 1) return 0;
  const keys = [[0, 0], [0.25, 2], [0.35, 2], [0.5, 1], [0.6, 1], [0.75, 0], [1, 0]];
  for (let i = 1; i < keys.length; i++) {
    const [u0, a] = keys[i - 1];
    const [u1, b] = keys[i];
    if (u <= u1) return a + (b - a) * ease((u - u0) / (u1 - u0));
  }
  return 0;
}

export const LEVELS = ["지점(Application)", "지역(Platform)", "본사(Bootstrap)"];
export const LINK_STEPS = ["검증: 카드에 이상한 지시가 없는지", "준비: static 재료통 = 0", "해석: 이름 → 실제 위치", "초기화: static 재료통 = 진짜 값"];

export function readoutOf(s) {
  const n = (value) => value.toLocaleString("en-US");
  if (s.phase === 0) return "javac: .java → .class 카드";
  if (s.phase === 1) return s.found ? `${LEVELS[0]}에서 찾음` : `${LEVELS[s.ask]} 확인 → 없음`;
  if (s.phase === 2) return LINK_STEPS[s.step];
  const stack = `스택 ${s.stack[0]}·${s.stack[1]}`;
  const heap = `힙 ${s.heapUsed}/8`;
  if (s.phase === 3) return `한 줄씩 해석 · ${stack} · ${heap} · 호출 ${n(s.calls)}`;
  if (s.phase === 4) return s.compiled ? `밀키트로 바로 · 호출 ${n(s.calls)} · ${heap}` : `호출 ${n(s.calls)}/${n(THRESHOLD)} → JIT`;
  return s.gcOn ? `STW 정지 · 회수 ${s.collected} · ${heap}` : `${stack} · ${heap} · 회수 ${s.collected}`;
}
