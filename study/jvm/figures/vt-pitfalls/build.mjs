// Fig 4c 가상 스레드의 함정: synchronized 안의 블로킹(pinning)과 커넥션 풀 상한.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build, fitOf, navFor, PLATE_C } from "../threads/scene.mjs";
import { LANE_X, HEAP, RACK, simulate } from "../threads/model.mjs";

const load = (pinned) => Array.from({ length: 8 }, (_, i) => ({ id: "S" + (i + 1), arrive: 0.2 + i * 0.1, pinned, seg: [["cpu", 0.3], ["io", 2.2], ["cpu", 0.3]] }));
const pinScn = { kind: "virtual", seconds: 6.4, tasks: load(true) };
const lockScn = { kind: "virtual", seconds: 4.2, tasks: load(false) };
const poolScn = { kind: "virtual", seconds: 7.4, readout: "pool", tasks: Array.from({ length: 20 }, (_, i) => ({ id: "C" + (i + 1), arrive: 0.2 + i * 0.12, seg: [["cpu", 0.25], ["db", 2.2], ["cpu", 0.2]] })) };
const pinEnd = simulate(pinScn).finish;
const lockEnd = simulate(lockScn).finish;
const poolEnd = simulate(poolScn).finish;

build({
  dir: dirname(fileURLToPath(import.meta.url)),
  files: ["pit.html", "pit-light.html"],
  fig: "Fig 4c",
  title: "가상 스레드의 함정",
  label: "캐리어 스레드 4개, 대기 큐, 힙, 앞쪽 커넥션 10개짜리 랙과 DB, 아래쪽 캐리어별 시간 막대. synchronized 안에서 블로킹하면 캐리어가 붙잡히고, DB 를 쓰는 가상 스레드는 커넥션 수만큼만 동시에 진행한다.",
  fit: fitOf(PLATE_C),
  plate: PLATE_C,
  heap: true,
  rack: true,
  chip: "VT",
  laneWord: "캐리어",
  holdWord: "붙잡고 기다림 (pinning)",
  holdShort: "pinning",
  axis: 7,
  nav: navFor(2),
  scenarios: [
    { ...pinScn, phases: [{ name: "synchronized → pinning", seconds: 2.8 }, { name: "큐가 밀림", seconds: 3.6 }] },
    { ...lockScn, phases: [{ name: "ReentrantLock 으로 바꾸면", seconds: 4.2 }] },
    { ...poolScn, phases: [{ name: "커넥션 풀 상한", seconds: 7.4 }] },
  ],
  now: [
    { text: "① synchronized 안에서 I/O 를 기다리면 VT 가 내려가지 못하고 캐리어를 붙잡습니다(pinning). 4a 의 플랫폼 스레드와 같은 모양입니다.", zones: ["pin", "carrier"] },
    { text: `② 캐리어 4개가 다 붙잡혀 나머지 VT 는 큐에서 기다립니다. 8개가 ${pinEnd.toFixed(1)}초에 끝납니다.`, zones: ["vtq", "carrier"] },
    { text: `③ 같은 코드를 ReentrantLock 으로 바꾸면 I/O 동안 힙으로 내려갑니다. 8개가 ${lockEnd.toFixed(1)}초에 끝납니다(JDK 24 부터는 synchronized 도 이렇게 동작).`, zones: ["heap", "carrier"] },
    { text: `④ VT 가 20개여도 동시에 DB 를 쓰는 것은 커넥션 수(10)만큼입니다. 나머지는 힙에서 커넥션을 기다리고, 캐리어는 남습니다. ${poolEnd.toFixed(1)}초에 끝.`, zones: ["pool", "db", "heap"] },
  ],
  tags: [
    { zone: "carrier", at: [LANE_X[1] + 9, -66, 46], dx: 20, dy: -24, long: "캐리어 스레드 4개", short: "캐리어", sdx: 20, sdy: -22 },
    { zone: "vtq", at: [-152, 16.5, 3], dx: -14, dy: 30, long: "가상 스레드 대기 큐", short: "대기 큐", sdx: 0, sdy: 32 },
    { zone: "heap", at: [HEAP.x + HEAP.w - 20, HEAP.y, 4], dx: 20, dy: -30, long: "힙: 멈춘 VT 의 스택", short: "힙", sdx: 14, sdy: -28 },
    { zone: "pool", at: [RACK.x + 30, RACK.y + RACK.d, 4], dx: -40, dy: 36, long: "커넥션 풀 (10개)", short: "커넥션 풀", sdx: -40, sdy: 36 },
    { zone: "db", at: [80, 40, 10], dx: 36, dy: 18, long: "DB", short: "DB", sdx: 30, sdy: 22 },
    { zone: "pin", when: "pin", at: [LANE_X[0] + 9 - 5.9, -34, 5], dx: -100, dy: -56, long: "synchronized → 캐리어 고정 (pinning)", short: "pinning", sdx: -70, sdy: -60 },
  ],
  keys: [
    { mark: "lit", label: "밝은 원판 = 지금 CPU 에서 실행 중" },
    { mark: "raised", label: "원판을 두른 고리 = synchronized" },
  ],
  caption: "그림의 레인은 4개로 줄였습니다(실제 기본값은 코어 수). pinning 은 JDK 21 기준이며, JDK 24(JEP 491)부터 synchronized 안에서도 unmount 합니다. 네이티브 프레임 안의 블로킹은 여전히 pinning 입니다. 커넥션 10개는 HikariCP 기본 maximumPoolSize 입니다.",
  legend: [
    ["token", "원판과 위의 얇은 판 (VT)", "가상 스레드와 그 스택 프레임", "얇은 판 하나가 프레임 하나."],
    ["monitor", "원판을 두른 고리", "synchronized 모니터", "이 안에서 블로킹하면 unmount 하지 못합니다(JDK 21)."],
    ["lamp2", "레인 앞 표시등", "캐리어가 일 없이 붙잡힘", "pinning 된 VT 가 I/O 를 기다리는 동안 켜집니다."],
    ["frames", "힙 칸에 놓인 원판", "unmount 된 가상 스레드", "흐린 원판은 커넥션을 기다리는 VT."],
    ["pulse", "깜박이는 점", "I/O 를 기다리는 중", "sleep, 소켓 읽기, DB 응답 대기."],
    ["rack", "랙의 솟은 플러그", "쓰고 있는 커넥션", "커넥션을 쥔 VT 는 쿼리 결과를 기다리는 동안 캐리어를 비웁니다."],
  ],
  steps: [
    ["synchronized → pinning", "synchronized 블록 안에서 I/O 를 기다리면 스택을 힙으로 옮길 수 없어 캐리어를 붙잡습니다(고리 + 표시등)."],
    ["큐가 밀림", "캐리어가 모두 붙잡히면 CPU 가 놀아도 다른 VT 는 실행되지 못합니다. -Djdk.tracePinnedThreads 로 찾습니다."],
    ["ReentrantLock 으로 바꾸면", "임계 구역을 ReentrantLock 으로 바꾸면 블로킹 중에 unmount 하므로 캐리어가 비워집니다."],
    ["커넥션 풀 상한", "가상 스레드는 스레드를 싸게 만들 뿐 커넥션을 늘려 주지 않습니다. 처리량은 풀 크기가 정합니다."],
  ],
});
console.log("pin", pinEnd, "lock", lockEnd, "pool", poolEnd);
