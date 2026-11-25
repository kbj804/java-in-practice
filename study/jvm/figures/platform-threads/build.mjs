// Fig 4a 플랫폼 스레드: 요청 12개를 스레드 4개로. I/O 를 기다리는 동안에도 스레드를 붙잡는다.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build, fitOf, navFor, PLATE_A, PLATE_AB, WORK, AB_SECONDS } from "../threads/scene.mjs";
import { LANE_X } from "../threads/model.mjs";

build({
  dir: dirname(fileURLToPath(import.meta.url)),
  files: ["pt.html", "pt-light.html"],
  fig: "Fig 4a",
  title: "플랫폼 스레드",
  label: "플랫폼 스레드 4개(레인)와 각 스레드의 스택 예약 기둥, 앞쪽 요청 대기 트레이, 아래쪽 스레드별 시간 막대. 요청 12개가 스레드를 하나씩 차지하고, I/O 를 기다리는 동안에도 스레드를 놓지 않는다.",
  fit: fitOf(PLATE_AB),
  plate: PLATE_A,
  heap: false,
  rack: false,
  chip: "요청",
  laneWord: "스레드",
  holdWord: "붙잡고 I/O 대기 (낭비)",
  holdShort: "붙잡고 대기 (낭비)",
  axis: 14,
  nav: navFor(0),
  scenarios: [{
    kind: "platform", seconds: AB_SECONDS, tasks: WORK,
    phases: [{ name: "요청 하나 = 스레드 하나", seconds: 1.8 }, { name: "I/O 대기 중에도 점유", seconds: 2.6 }, { name: "풀이 차면 줄 서기", seconds: 10.1 }],
  }],
  now: [
    { text: "① 요청이 들어오면 스레드 하나를 통째로 차지합니다. 스레드는 OS 스레드와 1:1 입니다.", zones: ["platform", "reqq"] },
    { text: "② 요청이 I/O(DB, 외부 API)를 기다리는 동안에도 스레드를 놓지 않습니다. CPU 는 놀고 있습니다(빗금 칸).", zones: ["platform", "hold"] },
    { text: "③ 스레드 4개가 다 차면 새 요청은 줄을 섭니다. 앞 요청이 끝나야 다음 요청이 시작합니다.", zones: ["reqq", "platform"] },
  ],
  tags: [
    { zone: "platform", at: [LANE_X[1] + 9, -66, 46], dx: 20, dy: -24, long: "플랫폼 스레드 4개 (OS 스레드 1:1)", short: "플랫폼 스레드", sdx: 30, sdy: -22 },
    { zone: "reqq", at: [-66, 16.5, 3], dx: 70, dy: 26, long: "요청 대기 줄", short: "요청 대기", sdx: 70, sdy: 30 },
    { zone: "hold", when: "hold", at: [LANE_X[0] + 9, -17, 8.6], dx: -95, dy: 58, long: "I/O 기다리며 스레드 점유 중", short: "점유 중", sdx: -80, sdy: 62 },
  ],
  keys: [
    { mark: "lit", label: "밝은 원판 = 지금 CPU 에서 실행 중" },
    { mark: "raised", label: "얇은 판 = 스택 프레임" },
  ],
  caption: "요청 12개, 스레드 4개. 요청마다 CPU 0.4 → I/O 2.4~3.6 → CPU 0.4(모델 초)이고, 4b 가상 스레드와 같은 작업과 같은 시계입니다. 레인 4개는 그림용으로 줄인 수입니다.",
  legend: [
    ["column", "레인 뒤 높은 기둥", "스레드 스택 예약", "플랫폼 스레드마다 기본 2MB(ThreadStackSize=2048K)를 미리 잡습니다. 눈금 하나 256KB."],
    ["token", "원판과 위의 얇은 판 (요청)", "요청 하나와 그 스택 프레임", "얇은 판 하나가 프레임 하나. 프레임은 스레드 스택 위에 있습니다."],
    ["pulse", "깜박이는 점", "I/O 를 기다리는 중", "sleep, 소켓 읽기, DB 응답 대기."],
    ["lamp2", "레인 앞 표시등", "스레드가 일 없이 붙잡힘", "요청이 I/O 를 기다리는 동안 켜집니다."],
  ],
  steps: [
    ["요청 하나 = 스레드 하나", "요청이 들어오면 비어 있는 스레드 하나를 처음부터 끝까지 씁니다."],
    ["I/O 대기 중에도 점유", "DB 나 외부 API 응답을 기다리는 동안에도 스레드는 그 요청에 묶여 있습니다. 시간 막대의 빗금 칸이 이 낭비입니다."],
    ["풀이 차면 줄 서기", "4개가 다 차면 나머지 8개는 트레이에서 기다립니다. 스레드를 늘리면 되지만, 스레드마다 2MB 스택과 OS 스레드가 들어서 무한정 늘릴 수 없습니다."],
  ],
});
