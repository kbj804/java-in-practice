// Fig 6 코루틴의 블로킹 호출: Dispatchers.IO(플랫폼 스레드) vs 가상 스레드 디스패처.
// 같은 코루틴 8개가 같은 커넥션 2개를 두고 JDBC 를 부른다. 스레드 풀과 커넥션 풀이 서로 다른 자원이라는 것,
// 실제 상한은 커넥션 수라는 것, 차이는 기다리는 동안 스레드를 붙잡느냐뿐이라는 것을 보여 준다.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build, fitOf, PLATE_C } from "../threads/scene.mjs";
import { LANE_X, HEAP, RACK, simulate } from "../threads/model.mjs";

const CONNS = 2;
const calls = Array.from({ length: 8 }, (_, i) => ({ id: "K" + (i + 1), arrive: 0.2 + i * 0.1, seg: [["cpu", 0.2], ["db", 1.2], ["cpu", 0.2]] }));
const ioScn = { kind: "platform", seconds: 6.4, conns: CONNS, readout: "pool", tasks: calls };
const vtScn = { kind: "virtual", seconds: 7.0, conns: CONNS, readout: "pool", tasks: calls };
const io = simulate(ioScn);
const vt = simulate(vtScn);
// 커넥션을 기다리며 스레드를 붙잡은 최대 개수(IO 쪽).
const blocked = Math.max(...io.counts.map((c) => c.lanes.filter((lane) => lane === "cwait").length));
const rackEnd = RACK.x + 17 + (CONNS - 1) * 10.5;

build({
  dir: dirname(fileURLToPath(import.meta.url)),
  files: ["io-vt.html", "io-vt-light.html"],
  fig: "Fig 6",
  title: "코루틴의 블로킹 호출",
  label: "스레드 레인 4개, 대기 큐 트레이, 힙 격자판, 앞쪽 커넥션 2개짜리 랙과 DB, 아래쪽 레인별 시간 막대. 같은 코루틴 8개가 JDBC 를 부를 때, Dispatchers.IO 에서는 스레드가 커넥션과 응답을 기다리며 붙잡히고, 가상 스레드 디스패처에서는 힙으로 내려가 캐리어가 빈다.",
  fit: fitOf(PLATE_C),
  plate: PLATE_C,
  heap: true,
  rack: true,
  conns: CONNS,
  chip: "co",
  laneWord: "스레드",
  holdWord: "붙잡고 기다림 (커넥션·DB 응답)",
  holdShort: "붙잡고 기다림",
  axis: 7,
  nav: [],
  scenarios: [
    { ...ioScn, phases: [{ name: "Dispatchers.IO", seconds: 2.6 }, { name: "커넥션 대기", seconds: io.finish + 0.9 - 2.6 }] },
    { ...vtScn, phases: [{ name: "가상 스레드 디스패처", seconds: 2.6 }, { name: "같은 상한", seconds: vt.finish + 0.9 - 2.6 }] },
  ],
  now: [
    { text: "① Dispatchers.IO: async 하나가 플랫폼 스레드 하나를 잡고 JDBC 를 부릅니다. 커넥션 2개를 쥔 스레드는 DB 응답을 기다리는 동안 레인을 붙잡고 있습니다.", zones: ["carrier", "pool", "db"] },
    { text: `② 커넥션이 없는 스레드 ${blocked}개는 커넥션을 기다리며 레인을 붙잡습니다. 스레드 풀과 커넥션 풀은 다른 자원이고, 동시에 도는 쿼리는 커넥션 수(${CONNS})만큼입니다. ${io.finish.toFixed(1)}초에 끝.`, zones: ["carrier", "vtq", "pool"] },
    { text: "③ 가상 스레드 디스패처: 같은 async 8개가 가상 스레드에서 돕니다. 커넥션을 기다리거나 DB 응답을 기다리는 동안 힙으로 내려가고, 캐리어는 비어 다른 일을 받을 수 있습니다.", zones: ["heap", "carrier", "pool"] },
    { text: `④ 그래도 동시에 도는 쿼리는 여전히 ${CONNS}개라 끝나는 시간은 비슷합니다(${vt.finish.toFixed(1)}초). 바뀐 것은 기다리는 동안 스레드를 붙잡느냐뿐입니다.`, zones: ["pool", "db", "heap"] },
  ],
  tags: [
    { zone: "carrier", at: [LANE_X[1] + 9, -66, 46], dx: 20, dy: -24, long: "스레드 4개 (IO 풀 / 캐리어)", short: "스레드", sdx: 20, sdy: -22 },
    { zone: "vtq", at: [-152, 16.5, 3], dx: -14, dy: 30, long: "실행을 기다리는 코루틴", short: "대기", sdx: 0, sdy: 32 },
    { zone: "heap", at: [HEAP.x + HEAP.w - 20, HEAP.y, 4], dx: 20, dy: -30, long: "힙: 멈춘 가상 스레드", short: "힙", sdx: 14, sdy: -28 },
    { zone: "pool", at: [RACK.x + 8, RACK.y + RACK.d, 4], dx: -30, dy: 36, long: `커넥션 풀 (${CONNS}개)`, short: "커넥션 풀", sdx: -30, sdy: 36 },
    { zone: "db", at: [80, 40, 10], dx: 36, dy: 18, long: "DB", short: "DB", sdx: 30, sdy: 22 },
  ],
  keys: [
    { mark: "lit", label: "밝은 원판 = 지금 CPU 에서 실행 중" },
    { mark: "raised", label: "켜진 플러그 = 쥐고 있는 커넥션" },
  ],
  caption: `그림의 스레드는 4개, 커넥션은 ${CONNS}개로 줄였습니다(실제 Dispatchers.IO 는 최대 64개, HikariCP 기본은 10개). 두 장면 모두 같은 async 8개가 CPU 0.2초 → JDBC 1.2초 → CPU 0.2초를 실행합니다. 가상 스레드 쪽은 커넥션을 넘겨받을 때 다시 올라타는 시간이 있어 조금 늦게 끝납니다.`,
  legend: [
    ["token", "원판과 위의 얇은 판", "async 로 띄운 코루틴 하나", "얇은 판 하나가 스택 프레임 하나."],
    ["lamp2", "레인 앞 표시등", "스레드가 일 없이 붙잡힘", "Dispatchers.IO 에서 커넥션이나 DB 응답을 기다리는 동안 켜집니다."],
    ["frames", "힙 칸에 놓인 원판", "내려간 가상 스레드", "흐린 원판은 커넥션을 기다리는 중."],
    ["pulse", "깜박이는 점", "기다리는 중", "커넥션 또는 DB 응답."],
  ],
  steps: [
    ["Dispatchers.IO", "코루틴이 IO 풀의 플랫폼 스레드를 잡고 JDBC 를 부릅니다. 커넥션을 쥔 스레드는 응답이 올 때까지 레인을 붙잡습니다."],
    ["커넥션 대기", "커넥션이 모자라면 스레드는 커넥션을 기다리며 그대로 붙잡혀 있습니다. 실제 IO 풀 64개, 커넥션 10개라면 54개가 이렇게 기다립니다."],
    ["가상 스레드 디스패처", "같은 코드가 가상 스레드에서 돌면, 기다리는 동안 힙으로 내려가고 캐리어가 빕니다."],
    ["같은 상한", "동시에 도는 쿼리 수는 그대로 커넥션 수입니다. 가상 스레드는 기다림을 싸게 만들 뿐, DB 를 빠르게 하지 않습니다."],
  ],
});
console.log("io", io.finish, "vt", vt.finish, "blocked", blocked, "rackEnd", rackEnd);
