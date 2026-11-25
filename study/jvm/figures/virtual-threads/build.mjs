// Fig 4b 가상 스레드: 4a 와 같은 요청 12개, 같은 레인 4개, 같은 시계. I/O 동안 힙으로 내려가고 캐리어를 비운다.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build, fitOf, navFor, PLATE_AB, WORK, AB_SECONDS } from "../threads/scene.mjs";
import { LANE_X, HEAP, simulate } from "../threads/model.mjs";

// 그림이 따라가는 VT 하나: 처음과 다른 캐리어에 다시 올라타는 첫 요청.
const scn = { kind: "virtual", seconds: AB_SECONDS, tasks: WORK };
const sim = simulate(scn);
const tracked = sim.tasks.find((task) => task.lanes.length > 1 && task.lanes[0].k !== task.lanes[1].k);
const hop = `${tracked.lanes[0].k + 1} → ${tracked.lanes[1].k + 1}`;
const platform = simulate({ ...scn, kind: "platform" });

const model = build({
  dir: dirname(fileURLToPath(import.meta.url)),
  files: ["vt.html", "vt-light.html"],
  fig: "Fig 4b",
  title: "가상 스레드",
  label: "캐리어 스레드 4개(레인)와 가상 스레드 대기 큐 트레이, 오른쪽 격자판(힙), 아래쪽 캐리어별 시간 막대. 4a 와 같은 요청 12개가 I/O 를 기다리는 동안 힙으로 내려가고, 캐리어는 다른 가상 스레드를 실행한다.",
  fit: fitOf(PLATE_AB),
  plate: PLATE_AB,
  heap: true,
  rack: false,
  chip: "VT",
  laneWord: "캐리어",
  holdWord: "붙잡고 I/O 대기 (낭비)",
  holdShort: "붙잡고 대기 (낭비)",
  axis: 14,
  nav: navFor(1),
  scenarios: [{
    ...scn, track: tracked.id,
    phases: [{ name: "mount", seconds: 1.0 }, { name: "I/O → unmount", seconds: 1.9 }, { name: "remount", seconds: 2.7 }, { name: "끝", seconds: 8.9 }],
  }],
  now: [
    { text: "① 가상 스레드(VT)는 대기 큐에 섰다가 비어 있는 캐리어 스레드에 올라타 실행됩니다(mount).", zones: ["carrier", "vtq"] },
    { text: "② I/O 를 기다리는 동안 VT 는 스택째 힙으로 내려가고(unmount), 캐리어는 곧바로 다음 VT 를 실행합니다.", zones: ["heap", "io", "carrier"] },
    { text: `③ I/O 가 끝나면 큐로 돌아가 비어 있는 아무 캐리어에 다시 올라탑니다(remount). 테두리 VT 는 캐리어 ${hop}.`, zones: ["vtq", "carrier", "heap"] },
    { text: `④ 같은 요청 12개가 ${sim.finish.toFixed(1)}초에 끝납니다(4a 플랫폼 스레드는 ${platform.finish.toFixed(1)}초). 시간 막대에 빗금 칸이 없습니다.`, zones: ["carrier"] },
  ],
  tags: [
    { zone: "carrier", at: [LANE_X[1] + 9, -66, 46], dx: 20, dy: -24, long: "캐리어 스레드 4개 (= CPU 코어 수)", short: "캐리어 스레드", sdx: 30, sdy: -22 },
    { zone: "vtq", at: [-66, 16.5, 3], dx: 40, dy: 26, long: "가상 스레드 대기 큐", short: "대기 큐", sdx: 40, sdy: 30 },
    { zone: "heap", at: [HEAP.x + HEAP.w - 20, HEAP.y, 4], dx: 10, dy: -34, long: "힙: 멈춘 VT 의 스택", short: "힙", sdx: 10, sdy: -30 },
    { zone: "io", when: "io", at: [HEAP.x + 14, HEAP.y + 14.5, 14], dx: -10, dy: -52, long: "I/O 대기 (캐리어는 비움)", short: "I/O 대기", sdx: -10, sdy: -56 },
  ],
  keys: [
    { mark: "lit", label: "밝은 원판 = 지금 CPU 에서 실행 중" },
    { mark: "raised", label: "얇은 판 = 스택 프레임" },
  ],
  caption: `4a 와 같은 요청 12개, 같은 레인 4개, 같은 시계입니다. 모델 기준으로 4a 는 ${platform.finish.toFixed(1)}초, 4b 는 ${sim.finish.toFixed(1)}초에 끝납니다. 실제 캐리어 수 기본값은 코어 수(이 맥은 10)이고, 스케줄러는 FIFO 모드의 ForkJoinPool 입니다.`,
  legend: [
    ["column", "레인 뒤 높은 기둥", "캐리어 스레드의 스택 예약", "캐리어도 평범한 플랫폼 스레드라 2MB 스택이 있습니다. VT 가 늘어도 이 기둥은 4개 그대로입니다."],
    ["token", "원판과 위의 얇은 판 (VT)", "가상 스레드와 그 스택 프레임", "얇은 판 하나가 프레임 하나. 캐리어에 올라타면 그 위에서 실행됩니다."],
    ["frames", "힙 칸에 놓인 원판", "unmount 된 가상 스레드", "스택 프레임이 힙의 stack chunk 객체로 옮겨진 상태. 필요한 만큼만 차지합니다."],
    ["pulse", "깜박이는 점", "I/O 를 기다리는 중", "sleep, 소켓 읽기, DB 응답 대기."],
  ],
  steps: [
    ["mount", "VT 는 큐(FIFO)에 줄을 섰다가 비어 있는 캐리어 스레드에 올라타서 실행됩니다."],
    ["I/O → unmount", "블로킹하면 스택 프레임을 힙으로 옮기고 캐리어에서 내려옵니다. 비워진 캐리어는 큐의 다음 VT 를 실행합니다."],
    ["remount", "I/O 가 끝나면 다시 큐에 서고, 그때 비어 있는 아무 캐리어에 올라탑니다. 처음과 다른 캐리어일 수 있습니다."],
    ["끝", "캐리어는 기다리느라 붙잡히지 않으므로 시간 막대가 실행 칸과 빈칸뿐입니다. 4a 와 막대를 나란히 비교해 보세요."],
  ],
});
console.log("finish", sim.finish, "platform", platform.finish, "tracked", tracked.id, hop);
