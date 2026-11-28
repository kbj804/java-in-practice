// 4단계 그림의 모델: 이웃 1,000명에게 "새 글" 알림을 보내는 워커가 세 장면에서 무엇을 남기는지.
// 단계마다 바뀌는 상태만 적고(patch), 앞 단계 상태에 덮어써 가며 쌓는다.
// 마지막 상태로 결과를 내고, 그 값이 NotificationInboxExperimentTest 출력과 같아야 한다.

export const MEMBERS = 1000;
export const BATCH = 100;
export const STAGE_SECONDS = 1.1;

// 상태
//   queue    [{ id, st }]  st: ready(큐에서 대기) | unacked(워커가 받음, ack 전) | acked(큐에서 지움) | requeued(다시 큐로)
//   workers  { w1: "…", w2: "…" }  워커가 지금 하는 일 (한 줄)
//   sweeper  null(스케줄러 없음) | "…"
//   rows     [[from, to, state, by]]  inbox 행. state: pending | processing | completed, by: w1 | w2 (누가 가져갔나)
//   recv     [[from, to, count]]       이웃이 받은 푸시 수
//   tag      푸시에 tag(=event_id)를 실었나. 실었으면 알림창에서 덮어써서 하나만 보인다
//   lost     true 면 마지막 화면에서 못 받은 이웃 칸을 빨갛게 표시
// active: 지금 일하는 상자(queue | worker | db | sweeper)
const INIT = { queue: [], workers: {}, sweeper: null, rows: [], recv: [], tag: true, lost: false };

const range = (from, to, ...rest) => [from, to, ...rest];
// 0..n 을 BATCH 단위로 나눠 w1·w2 가 번갈아 가져간 모양
const alternate = (n, state) => Array.from({ length: n / BATCH }, (_, i) => range(i * BATCH, (i + 1) * BATCH, state, i % 2 ? "w2" : "w1"));

export const SCENARIOS = {
  dup: {
    label: "같은 메시지 2번",
    lead: "릴레이가 RabbitMQ 로 보낸 뒤 published_at 을 찍기 전에 죽어서, 같은 메시지를 한 번 더 보냈습니다. 받는 쪽이 이걸 어떻게 거르나.",
    ways: {
      naive: [
        { title: "메시지 m 이 큐에 들어온다", active: "queue", patch: { queue: [{ id: "m", st: "ready" }], tag: false } },
        { title: "워커가 받자마자 이웃 1,000명에게 보낸다 (inbox 없음, tag 없음) → 끝나면 ack", active: "worker", patch: { queue: [{ id: "m", st: "acked" }], workers: { w1: "1,000명에게 보냄" }, recv: [range(0, 1000, 1)] } },
        { title: "같은 메시지 m 이 한 번 더 들어온다", active: "queue", patch: { queue: [{ id: "m", st: "acked" }, { id: "m", st: "ready" }], workers: { w1: "대기" } } },
        { title: "처음 보는 메시지처럼 또 1,000명에게 보낸다 → 이웃 모두 알림 두 개", active: "worker", patch: { queue: [{ id: "m", st: "acked" }, { id: "m", st: "acked" }], workers: { w1: "또 1,000명에게 보냄" }, recv: [range(0, 1000, 2)] } },
      ],
      inbox: [
        { title: "메시지 m 이 큐에 들어온다", active: "queue", patch: { queue: [{ id: "m", st: "ready" }] } },
        { title: "② 1,000명 pending 행 INSERT (유니크 키 event_id + user_id) → 커밋 → ack", active: "db", patch: { queue: [{ id: "m", st: "acked" }], workers: { w1: "행 1,000개 만듦 · ack" }, rows: [range(0, 1000, "pending")] } },
        { title: "③④⑤ 100명씩 가져가(processing) 보내고 completed", active: "worker", patch: { workers: { w1: "100명씩 보냄" }, rows: [range(0, 1000, "completed", "w1")], recv: [range(0, 1000, 1)] } },
        { title: "같은 메시지 m 이 한 번 더 들어온다", active: "queue", patch: { queue: [{ id: "m", st: "acked" }, { id: "m", st: "ready" }], workers: { w1: "대기" } } },
        { title: "② ON CONFLICT DO NOTHING → 새 행 0개 → ack", active: "db", patch: { queue: [{ id: "m", st: "acked" }, { id: "m", st: "acked" }], workers: { w1: "새 행 0개 · ack" } } },
        { title: "③ 가져갈 행이 없다 → 아무것도 안 보낸다", active: "worker", patch: { workers: { w1: "보낼 사람 없음" } } },
      ],
    },
  },
  concurrent: {
    label: "동시에 2번",
    lead: "같은 메시지 두 개가 워커 두 개에 동시에 들어갔습니다 (concurrency 2, prefetch 1). 둘 다 \"처음 보는 메시지\"라고 판단합니다.",
    ways: {
      inbox: [
        { title: "같은 메시지 두 개가 워커 1·2 에 하나씩 들어간다", active: "queue", patch: { queue: [{ id: "m", st: "unacked" }, { id: "m", st: "unacked" }], workers: { w1: "m 받음", w2: "m 받음" } } },
        { title: "② 둘 다 INSERT. 유니크 키 때문에 한쪽만 1,000행, 다른 쪽은 0행 (에러 없이) → 둘 다 ack", active: "db", patch: { queue: [{ id: "m", st: "acked" }, { id: "m", st: "acked" }], workers: { w1: "행 1,000개 · ack", w2: "새 행 0개 · ack" }, rows: [range(0, 1000, "pending")] } },
        { title: "③ 둘 다 가져가기. FOR UPDATE SKIP LOCKED 로 서로 다른 100명씩", active: "db", patch: { workers: { w1: "100명 가져감", w2: "다른 100명 가져감" }, rows: [range(0, 100, "processing", "w1"), range(100, 200, "processing", "w2"), range(200, 1000, "pending")] } },
        { title: "④⑤ 각자 보내고 completed, 다음 100명을 또 가져간다", active: "worker", patch: { workers: { w1: "보내는 중", w2: "보내는 중" }, rows: [...alternate(400, "completed"), range(400, 500, "processing", "w1"), range(500, 600, "processing", "w2"), range(600, 1000, "pending")], recv: [range(0, 400, 1)] } },
        { title: "가져갈 행이 없을 때까지 반복 → 각자 500명, 겹친 사람 0", active: "worker", patch: { workers: { w1: "500명 보냄", w2: "500명 보냄" }, rows: alternate(1000, "completed"), recv: [range(0, 1000, 1)] } },
      ],
    },
  },
  crash: {
    label: "보내다 죽음",
    lead: "300명에게 보낸 뒤, 4번째 묶음(100명) 중 50명에게 보내고 서버가 죽었습니다. 리스는 30초, 한 번에 100명씩 가져갑니다.",
    ways: {
      late: [
        { title: "메시지 m 이 큐에 들어온다", active: "queue", patch: { queue: [{ id: "m", st: "ready" }] } },
        { title: "② 1,000명 pending 행 INSERT (ack 는 다 보낸 뒤에)", active: "db", patch: { queue: [{ id: "m", st: "unacked" }], workers: { w1: "행 1,000개 · ack 안 함" }, rows: [range(0, 1000, "pending")] } },
        { title: "③④⑤ 100명씩 300명 보내고 completed", active: "worker", patch: { workers: { w1: "300명 보냄" }, rows: [range(0, 300, "completed", "w1"), range(300, 1000, "pending")], recv: [range(0, 300, 1)] } },
        { title: "4번째 100명을 processing 으로 가져가 50명 보낸 뒤 서버가 죽는다", active: "worker", patch: { workers: { w1: "죽음 ×" }, rows: [range(0, 300, "completed", "w1"), range(300, 400, "processing", "w1"), range(400, 1000, "pending")], recv: [range(0, 350, 1)] } },
        { title: "ack 전이라 RabbitMQ 가 m 을 바로 다시 준다 (리스는 아직 30초 남음)", active: "queue", patch: { queue: [{ id: "m", st: "requeued" }], workers: { w1: "새 서버 · m 다시 받음" } } },
        { title: "② 새 행 0개, ③ pending 600명만 가져가 보낸다. processing 100명은 리스 중이라 건너뛴다", active: "worker", patch: { queue: [{ id: "m", st: "unacked" }], workers: { w1: "600명 보냄" }, rows: [range(0, 300, "completed", "w1"), range(300, 400, "processing", "w1"), range(400, 1000, "completed", "w1")], recv: [range(0, 350, 1), range(400, 1000, 1)] } },
        { title: "가져갈 행이 없다 → ack. 메시지는 큐에서 지워진다", active: "queue", patch: { queue: [{ id: "m", st: "acked" }], workers: { w1: "ack" } } },
        { title: "31초 뒤 리스가 끝나도 다시 가져갈 계기가 없다 → 50명 못 받음", active: "db", patch: { workers: { w1: "대기" }, lost: true } },
      ],
      early: [
        { title: "메시지 m 이 큐에 들어온다", active: "queue", patch: { queue: [{ id: "m", st: "ready" }], sweeper: "대기" } },
        { title: "② 1,000명 pending 행 INSERT → 커밋 → 바로 ack", active: "db", patch: { queue: [{ id: "m", st: "acked" }], workers: { w1: "행 1,000개 · ack" }, rows: [range(0, 1000, "pending")] } },
        { title: "③④⑤ 100명씩 300명 보내고 completed", active: "worker", patch: { workers: { w1: "300명 보냄" }, rows: [range(0, 300, "completed", "w1"), range(300, 1000, "pending")], recv: [range(0, 300, 1)] } },
        { title: "4번째 100명을 processing 으로 가져가 50명 보낸 뒤 서버가 죽는다. ack 는 이미 갔다", active: "worker", patch: { workers: { w1: "죽음 ×" }, rows: [range(0, 300, "completed", "w1"), range(300, 400, "processing", "w1"), range(400, 1000, "pending")], recv: [range(0, 350, 1)] } },
        { title: "스케줄러가 pending 600명을 가져가 보낸다. processing 100명은 리스 중이라 건너뛴다", active: "sweeper", patch: { sweeper: "600명 보냄", rows: [range(0, 300, "completed", "w1"), range(300, 400, "processing", "w1"), range(400, 1000, "completed", "w1")], recv: [range(0, 350, 1), range(400, 1000, 1)] } },
        { title: "31초 뒤 스케줄러: 리스가 지난 100명을 다시 가져가 보낸다", active: "sweeper", patch: { sweeper: "100명 보냄", rows: [range(0, 1000, "completed", "w1")], recv: [range(0, 300, 1), range(300, 350, 2), range(350, 1000, 1)] } },
        { title: "죽기 전에 받은 50명은 두 번 받았지만 tag = event_id 라 알림창에는 하나만 남는다", active: "db", patch: { sweeper: "대기" } },
      ],
    },
  },
};

export const WAYS = {
  naive: { name: "가 · inbox 없이 받자마자 보냄", cls: "NaiveNotificationListener" },
  inbox: { name: "다 · inbox (유니크 키 + 리스)", cls: "PostCreatedNotificationListener + NotificationDispatcher" },
  late: { name: "나 · 다 보낸 뒤 ack, 스케줄러 없음", cls: "LateAckNotificationListener" },
  early: { name: "다 · 행 만든 직후 ack + 스케줄러", cls: "PostCreatedNotificationListener + NotificationSweeper" },
};

/** 단계마다 그때까지 쌓인 상태 */
export function timeline(stages) {
  let s = { ...INIT };
  return stages.map((st) => (s = { ...s, ...st.patch }));
}

/** 이웃 한 명씩 받은 푸시 수 */
export function received(state) {
  const counts = new Array(MEMBERS).fill(0);
  for (const [from, to, n] of state.recv) for (let i = from; i < to; i++) counts[i] = n;
  return counts;
}

/** 테스트 출력과 같은 항목: 푸시, 받은 이웃, 못 받은 이웃, 중복 푸시, 알림창 중복 */
export function outcome(stages) {
  const counts = received(timeline(stages).at(-1));
  const pushes = counts.reduce((a, b) => a + b, 0);
  const reached = counts.filter((n) => n > 0).length;
  const end = timeline(stages).at(-1);
  return { pushes, reached, missed: MEMBERS - reached, duplicatePushes: pushes - reached, trayDuplicates: end.tag ? 0 : pushes - reached };
}

// NotificationInboxExperimentTest 가 실제로 낸 값 ([실험③] 줄)
export const TEST = {
  dup: {
    naive: { pushes: 2000, reached: 1000, missed: 0, duplicatePushes: 1000, trayDuplicates: 1000 },
    inbox: { pushes: 1000, reached: 1000, missed: 0, duplicatePushes: 0, trayDuplicates: 0 },
  },
  concurrent: {
    inbox: { pushes: 1000, reached: 1000, missed: 0, duplicatePushes: 0, trayDuplicates: 0 },
  },
  crash: {
    late: { pushes: 950, reached: 950, missed: 50, duplicatePushes: 0, trayDuplicates: 0 },
    early: { pushes: 1050, reached: 1000, missed: 0, duplicatePushes: 50, trayDuplicates: 0 },
  },
};
