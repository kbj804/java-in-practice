// 4단계 그림의 모델: "새 글" 메시지 하나로 이웃 1,000명에게 알림을 보내는 시스템에서, 단계마다 누가 누구에게 무엇을 보냈고
// 그 결과 각 부품(RabbitMQ 큐, 워커, inbox 표, 이웃 휴대폰)이 어떤 상태가 됐는지.
// 단계마다 오간 요청(flows)과 바뀐 상태(patch)만 적고, 앞 단계 상태에 덮어써 가며 쌓는다.
// 마지막 상태로 결과를 내고, 그 값이 NotificationInboxExperimentTest 출력과 같아야 한다.

export const MEMBERS = 1000;
export const BATCH = 100;
export const STAGE_SECONDS = 1.5;

// 그림의 부품
export const NODES = { relay: "OutboxRelay", mq: "RabbitMQ", w1: "리스너 1", w2: "리스너 2", sw: "스케줄러", db: "PostgreSQL", fcm: "FCM", phones: "이웃 휴대폰" };
// 화살표: id → [보내는 쪽, 받는 쪽]
export const FLOWS = {
  pub: ["relay", "mq"],
  "deliver:w1": ["mq", "w1"], "deliver:w2": ["mq", "w2"],
  "ack:w1": ["w1", "mq"], "ack:w2": ["w2", "mq"],
  "db:w1": ["w1", "db"], "db:w2": ["w2", "db"], "db:sw": ["sw", "db"],
  "push:w1": ["w1", "fcm"], "push:w2": ["w2", "fcm"], "push:sw": ["sw", "fcm"],
  fcm: ["fcm", "phones"],
};

// 상태
//   relay    릴레이가 하는 일 (한 줄)
//   queue    [{ id, st }]  st: ready(큐에서 대기) | unacked(리스너가 받음, ack 전) | acked(큐에서 지움) | requeued(다시 큐로)
//   app      up | down(서버 죽음) | restart(다시 뜸)
//   workers  { w1, w2 }  리스너가 하는 일, 없으면 이 장면에서 안 씀
//   sweeper  null(스케줄러 없음) | "…"
//   rows     [[from, to, state, by]]  inbox 행. state: pending | processing | completed, by: w1 | w2 | sw
//   recv     [[from, to, count]]       이웃이 받은 푸시 수
//   tag      푸시에 tag(=event_id)를 실었나. 실었으면 알림창에서 덮어써서 하나만 보인다
//   lease    processing 행의 리스 (null 이면 표시 안 함)
//   lost     true 면 못 받은 이웃을 빨갛게 표시
const INIT = { relay: "대기", queue: [], app: "up", workers: {}, sweeper: null, rows: [], recv: [], tag: true, lease: null, lost: false };

const range = (from, to, ...rest) => [from, to, ...rest];
// 요청 하나: 화살표 id, 화살표 위 짧은 글, 요청 기록에 쓸 설명, run | bad
const f = (id, label, text, kind = "run") => ({ id, label, text, kind });
const m = (st) => ({ id: "m", st });

const pub = (label = "m", text = "PostCreated 메시지 m 발행 (messageId = event_id)") => f("pub", label, text);
const deliver = (w = "w1", label = "m") => f(`deliver:${w}`, label, "m 전달 (prefetch 1)");
const ack = (w = "w1") => f(`ack:${w}`, "ack", "ack → 큐에서 m 지움");

export const SCENARIOS = {
  dup: {
    label: "같은 메시지 2번",
    lead: "릴레이가 RabbitMQ 로 보낸 뒤 published_at 을 찍기 전에 죽어서, 같은 메시지 m 을 한 번 더 보냈습니다. 받는 쪽이 두 번째 m 을 어떻게 거르나.",
    ways: {
      naive: [
        { title: "릴레이 → RabbitMQ: 메시지 m 발행", flows: [pub()], patch: { relay: "m 발행", queue: [m("ready")], tag: false } },
        { title: "RabbitMQ → 리스너 1: m 전달", flows: [deliver()], patch: { relay: "대기", queue: [m("unacked")], workers: { w1: "m 받음" } } },
        { title: "리스너 1 → FCM → 이웃: inbox 없이 1,000명에게 바로 푸시 (tag 없음)", flows: [f("push:w1", "1,000건", "푸시 1,000건 (tag 없음)"), f("fcm", "1,000건", "이웃 1,000명에게 알림")], patch: { workers: { w1: "1,000명에게 보냄" }, recv: [range(0, 1000, 1)] } },
        { title: "리스너 1 → RabbitMQ: ack. m 은 큐에서 지워진다", flows: [ack()], patch: { queue: [m("acked")], workers: { w1: "대기" } } },
        { title: "릴레이 → RabbitMQ: 같은 m 을 한 번 더 발행 (보낸 뒤 published_at 을 찍기 전에 죽었다)", flows: [pub("m 또", "같은 m 을 다시 발행")], patch: { relay: "m 다시 발행", queue: [m("acked"), m("ready")] } },
        { title: "RabbitMQ → 리스너 1: m 전달. 리스너는 처음 보는 메시지로 안다", flows: [deliver()], patch: { relay: "대기", queue: [m("acked"), m("unacked")], workers: { w1: "m 받음" } } },
        { title: "리스너 1 → FCM → 이웃: 또 1,000건. 이웃 모두 알림이 두 개", flows: [f("push:w1", "1,000건", "푸시 1,000건 또 (tag 없음)", "bad"), f("fcm", "1,000건", "이웃 1,000명에게 같은 알림 또")], patch: { workers: { w1: "또 1,000명에게 보냄" }, recv: [range(0, 1000, 2)] } },
        { title: "리스너 1 → RabbitMQ: ack", flows: [ack()], patch: { queue: [m("acked"), m("acked")], workers: { w1: "대기" } } },
      ],
      inbox: [
        { title: "릴레이 → RabbitMQ: 메시지 m 발행", flows: [pub()], patch: { relay: "m 발행", queue: [m("ready")] } },
        { title: "RabbitMQ → 리스너 1: m 전달", flows: [deliver()], patch: { relay: "대기", queue: [m("unacked")], workers: { w1: "m 받음" } } },
        { title: "리스너 1 → PostgreSQL: 이웃 1,000명 pending 행 INSERT (유니크 키 event_id + user_id) → 커밋", flows: [f("db:w1", "INSERT", "INSERT → 1,000행 생김 → 커밋")], patch: { workers: { w1: "행 1,000개 만듦" }, rows: [range(0, 1000, "pending")] } },
        { title: "리스너 1 → RabbitMQ: 행이 커밋됐으니 바로 ack", flows: [ack()], patch: { queue: [m("acked")], workers: { w1: "ack" } } },
        { title: "리스너 1 ↔ PostgreSQL · FCM: 100행씩 가져가(processing) → 푸시 → completed 를 10번", flows: [f("db:w1", "claim·완료", "claim 100행 → completed, 10번"), f("push:w1", "100건 ×10", "푸시 100건씩 10번 (tag = event_id)"), f("fcm", "1,000건", "이웃 1,000명에게 알림")], patch: { workers: { w1: "1,000명에게 보냄" }, rows: [range(0, 1000, "completed", "w1")], recv: [range(0, 1000, 1)] } },
        { title: "릴레이 → RabbitMQ: 같은 m 을 한 번 더 발행", flows: [pub("m 또", "같은 m 을 다시 발행")], patch: { relay: "m 다시 발행", queue: [m("acked"), m("ready")], workers: { w1: "대기" } } },
        { title: "RabbitMQ → 리스너 1: m 전달", flows: [deliver()], patch: { relay: "대기", queue: [m("acked"), m("unacked")], workers: { w1: "m 받음" } } },
        { title: "리스너 1 → PostgreSQL: INSERT … ON CONFLICT DO NOTHING → 새 행 0개 (에러 없음)", flows: [f("db:w1", "INSERT", "INSERT → 0행 (이미 있음, 에러 없음)")], patch: { workers: { w1: "새 행 0개" } } },
        { title: "리스너 1 → RabbitMQ: ack. 이어서 claim 해도 가져갈 행이 0개라 아무에게도 안 보낸다", flows: [ack(), f("db:w1", "claim 0", "claim → 0행, 보낼 사람 없음")], patch: { queue: [m("acked"), m("acked")], workers: { w1: "보낼 사람 없음" } } },
      ],
    },
  },
  concurrent: {
    label: "동시에 2번",
    lead: "같은 메시지 두 개가 리스너 두 개에 동시에 들어갔습니다 (concurrency 2, prefetch 1). 둘 다 \"처음 보는 메시지\"라고 판단합니다.",
    ways: {
      inbox: [
        { title: "릴레이 → RabbitMQ: 같은 m 이 두 번 들어간다", flows: [pub("m ×2", "같은 m 을 두 번 발행")], patch: { relay: "m 두 번 발행", queue: [m("ready"), m("ready")] } },
        { title: "RabbitMQ → 리스너 1 · 2: m 을 하나씩 동시에 준다", flows: [deliver("w1"), deliver("w2")], patch: { relay: "대기", queue: [m("unacked"), m("unacked")], workers: { w1: "m 받음", w2: "m 받음" } } },
        { title: "리스너 1 · 2 → PostgreSQL: 둘 다 INSERT. 유니크 키 때문에 한쪽만 1,000행, 다른 쪽은 0행 (에러 없음)", flows: [f("db:w1", "INSERT", "INSERT → 1,000행 생김"), f("db:w2", "INSERT", "INSERT → 0행 (충돌, 에러 없음)")], patch: { workers: { w1: "행 1,000개 만듦", w2: "새 행 0개" }, rows: [range(0, 1000, "pending")] } },
        { title: "리스너 1 · 2 → RabbitMQ: 둘 다 ack", flows: [ack("w1"), ack("w2")], patch: { queue: [m("acked"), m("acked")], workers: { w1: "ack", w2: "ack" } } },
        { title: "리스너 1 · 2 → PostgreSQL: 둘 다 claim. FOR UPDATE SKIP LOCKED 라 서로 다른 100행씩", flows: [f("db:w1", "claim 100", "claim → 0~99번 100행"), f("db:w2", "claim 100", "claim → 100~199번 (잠긴 행은 건너뜀)")], patch: { workers: { w1: "100명 가져감", w2: "다른 100명 가져감" }, rows: [range(0, 100, "processing", "w1"), range(100, 200, "processing", "w2"), range(200, 1000, "pending")] } },
        { title: "리스너 1 · 2 → FCM: 각자 100건 푸시 → completed, 다음 100행을 또 가져간다", flows: [f("push:w1", "100건", "푸시 100건"), f("push:w2", "100건", "푸시 100건 (다른 100명)"), f("fcm", "200건", "이웃 200명에게 알림"), f("db:w1", "완료·claim", "completed → 다음 100행 claim"), f("db:w2", "완료·claim", "completed → 다음 100행 claim")], patch: { workers: { w1: "보내는 중", w2: "보내는 중" }, rows: [range(0, 100, "completed", "w1"), range(100, 200, "completed", "w2"), range(200, 300, "processing", "w1"), range(300, 400, "processing", "w2"), range(400, 1000, "pending")], recv: [range(0, 200, 1)] } },
        { title: "가져갈 행이 없을 때까지 반복 → 리스너마다 500명", flows: [f("push:w1", "500건", "푸시 500건"), f("push:w2", "500건", "푸시 500건"), f("fcm", "1,000건", "이웃 1,000명에게 알림")], patch: { workers: { w1: "500명 보냄", w2: "500명 보냄" }, rows: Array.from({ length: 10 }, (_, i) => range(i * BATCH, (i + 1) * BATCH, "completed", i % 2 ? "w2" : "w1")), recv: [range(0, 1000, 1)] } },
        { title: "리스너 1 · 2 → PostgreSQL: claim → 0행. 둘이 겹쳐 보낸 사람은 0명", flows: [f("db:w1", "claim 0", "claim → 0행, 끝"), f("db:w2", "claim 0", "claim → 0행, 끝")], patch: { workers: { w1: "끝 · 500명", w2: "끝 · 500명" } } },
      ],
    },
  },
  crash: {
    label: "보내다 죽음",
    lead: "300명에게 보낸 뒤, 4번째 묶음(100명) 중 50명에게 보내고 서버가 죽었습니다. 리스는 30초, 한 번에 100행씩 가져갑니다. 언제 ack 하느냐에 따라 다시 보내 줄 주체가 달라집니다.",
    ways: {
      late: [
        { title: "릴레이 → RabbitMQ: 메시지 m 발행", flows: [pub()], patch: { relay: "m 발행", queue: [m("ready")] } },
        { title: "RabbitMQ → 리스너 1: m 전달", flows: [deliver()], patch: { relay: "대기", queue: [m("unacked")], workers: { w1: "m 받음" } } },
        { title: "리스너 1 → PostgreSQL: 1,000행 pending INSERT → 커밋. ack 는 다 보낸 뒤에 하기로 해서 아직 안 한다", flows: [f("db:w1", "INSERT", "INSERT → 1,000행 생김 (ack 는 나중에)")], patch: { workers: { w1: "행 1,000개 · ack 안 함" }, rows: [range(0, 1000, "pending")] } },
        { title: "리스너 1 ↔ PostgreSQL · FCM: 100행씩 3번, 300명 보내고 completed", flows: [f("db:w1", "claim·완료", "claim 100행 → completed, 3번"), f("push:w1", "300건", "푸시 100건씩 3번"), f("fcm", "300건", "이웃 300명에게 알림")], patch: { workers: { w1: "300명 보냄" }, rows: [range(0, 300, "completed", "w1"), range(300, 1000, "pending")], recv: [range(0, 300, 1)] } },
        { title: "리스너 1 → PostgreSQL: 4번째 100행을 claim. processing, claimed_at = 지금 (리스 30초 시작)", flows: [f("db:w1", "claim 100", "claim → 300~399번 processing")], patch: { workers: { w1: "100명 가져감" }, rows: [range(0, 300, "completed", "w1"), range(300, 400, "processing", "w1"), range(400, 1000, "pending")], lease: 30 } },
        { title: "리스너 1 → FCM: 50건 보낸 뒤 서버가 죽는다. 남은 50건은 못 보냈고 100행은 processing 으로 남는다", flows: [f("push:w1", "50 ✓ · 50 ×", "50건 보낸 뒤 서버 죽음, 50건 못 보냄", "bad"), f("fcm", "50건", "이웃 50명에게 알림")], patch: { app: "down", workers: { w1: "죽음" }, recv: [range(0, 350, 1)], lease: 29 } },
        { title: "RabbitMQ: ack 를 못 받은 채 연결이 끊겨 m 을 다시 큐에 넣는다. 서버는 다시 뜬다", flows: [], focus: ["mq", "app"], note: "RabbitMQ: 연결이 끊긴 리스너의 unacked m → 다시 ready", patch: { app: "restart", queue: [m("requeued")], workers: { w1: "다시 뜸" }, lease: 26 } },
        { title: "RabbitMQ → 리스너 1: m 을 다시 준다. 리스는 아직 남아 있다", flows: [deliver("w1", "m 다시")], patch: { queue: [m("unacked")], workers: { w1: "m 다시 받음" }, lease: 25 } },
        { title: "리스너 1 → PostgreSQL: INSERT → 새 행 0개 (이미 있음)", flows: [f("db:w1", "INSERT", "INSERT → 0행 (이미 있음)")], patch: { workers: { w1: "새 행 0개" }, lease: 24 } },
        { title: "리스너 1 ↔ PostgreSQL · FCM: pending 600행만 가져가 보낸다. 리스 중인 processing 100행은 건너뛴다", flows: [f("db:w1", "claim·완료", "claim → pending 600행만 (리스 중 100행 제외)"), f("push:w1", "600건", "푸시 600건"), f("fcm", "600건", "이웃 600명에게 알림")], patch: { workers: { w1: "600명 보냄" }, rows: [range(0, 300, "completed", "w1"), range(300, 400, "processing", "w1"), range(400, 1000, "completed", "w1")], recv: [range(0, 350, 1), range(400, 1000, 1)], lease: 20 } },
        { title: "리스너 1 → RabbitMQ: claim 이 0행이라 다 끝난 줄 알고 ack. m 은 큐에서 지워진다", flows: [f("db:w1", "claim 0", "claim → 0행 (남은 100행은 리스 중)"), ack()], patch: { queue: [m("acked")], workers: { w1: "ack · 끝" }, lease: 19 } },
        { title: "31초 뒤 리스가 끝나도 이 100행을 다시 가져갈 메시지도 스케줄러도 없다 → 50명 못 받음", flows: [], focus: ["db"], note: "아무도 PostgreSQL 에 남은 행을 묻지 않는다", patch: { workers: { w1: "대기" }, lease: 0, lost: true } },
      ],
      early: [
        { title: "릴레이 → RabbitMQ: 메시지 m 발행", flows: [pub()], patch: { relay: "m 발행", queue: [m("ready")], sweeper: "5초마다 확인" } },
        { title: "RabbitMQ → 리스너 1: m 전달", flows: [deliver()], patch: { relay: "대기", queue: [m("unacked")], workers: { w1: "m 받음" } } },
        { title: "리스너 1 → PostgreSQL: 1,000행 pending INSERT → 커밋. 이어서 리스너 1 → RabbitMQ: 바로 ack (할 일은 이제 DB 에 남아 있다)", flows: [f("db:w1", "INSERT", "INSERT → 1,000행 생김 → 커밋"), ack()], patch: { queue: [m("acked")], workers: { w1: "행 1,000개 · ack" }, rows: [range(0, 1000, "pending")] } },
        { title: "리스너 1 ↔ PostgreSQL · FCM: 100행씩 3번, 300명 보내고 completed", flows: [f("db:w1", "claim·완료", "claim 100행 → completed, 3번"), f("push:w1", "300건", "푸시 100건씩 3번"), f("fcm", "300건", "이웃 300명에게 알림")], patch: { workers: { w1: "300명 보냄" }, rows: [range(0, 300, "completed", "w1"), range(300, 1000, "pending")], recv: [range(0, 300, 1)] } },
        { title: "리스너 1 → PostgreSQL: 4번째 100행을 claim. processing, claimed_at = 지금 (리스 30초 시작)", flows: [f("db:w1", "claim 100", "claim → 300~399번 processing")], patch: { workers: { w1: "100명 가져감" }, rows: [range(0, 300, "completed", "w1"), range(300, 400, "processing", "w1"), range(400, 1000, "pending")], lease: 30 } },
        { title: "리스너 1 → FCM: 50건 보낸 뒤 서버가 죽는다. ack 는 이미 갔다", flows: [f("push:w1", "50 ✓ · 50 ×", "50건 보낸 뒤 서버 죽음, 50건 못 보냄", "bad"), f("fcm", "50건", "이웃 50명에게 알림")], patch: { app: "down", workers: { w1: "죽음" }, sweeper: "죽음", recv: [range(0, 350, 1)], lease: 29 } },
        { title: "서버가 다시 뜬다. m 은 이미 ack 돼서 RabbitMQ 가 다시 줄 메시지는 없다", flows: [], focus: ["mq", "app"], note: "RabbitMQ 큐: 비어 있음 (m 은 ack 로 지워짐)", patch: { app: "restart", workers: { w1: "다시 뜸 · 받을 m 없음" }, sweeper: "5초마다 확인", lease: 26 } },
        { title: "스케줄러 ↔ PostgreSQL · FCM: pending 600행을 가져가 보낸다. 리스 중인 processing 100행은 건너뛴다", flows: [f("db:sw", "claim·완료", "claim → pending 600행만 (리스 중 100행 제외)"), f("push:sw", "600건", "푸시 600건"), f("fcm", "600건", "이웃 600명에게 알림")], patch: { sweeper: "600명 보냄", rows: [range(0, 300, "completed", "w1"), range(300, 400, "processing", "w1"), range(400, 1000, "completed", "sw")], recv: [range(0, 350, 1), range(400, 1000, 1)], lease: 20 } },
        { title: "31초 뒤 스케줄러 → PostgreSQL: 리스가 지난 processing 100행을 다시 가져간다", flows: [f("db:sw", "claim 100", "claim → 리스 지난 300~399번")], patch: { sweeper: "리스 지난 100행 가져감", rows: [range(0, 300, "completed", "w1"), range(300, 400, "processing", "sw"), range(400, 1000, "completed", "sw")], lease: 0 } },
        { title: "스케줄러 → FCM: 100건 보내고 completed. 죽기 전에 받았던 50명은 두 번 받는다", flows: [f("push:sw", "100건", "푸시 100건 (그중 50명은 두 번째)"), f("fcm", "100건", "이웃 100명에게 알림"), f("db:sw", "완료", "completed")], patch: { sweeper: "100명 보냄", rows: [range(0, 300, "completed", "w1"), range(300, 1000, "completed", "sw")], recv: [range(0, 300, 1), range(300, 350, 2), range(350, 1000, 1)], lease: null } },
        { title: "tag = event_id 라 두 번째 알림이 첫 알림을 덮어써서 알림창에는 하나만 남는다", flows: [], focus: ["phones"], note: "이웃 휴대폰: 같은 tag 알림은 새로 쌓지 않고 바꿔 끼운다", patch: { sweeper: "5초마다 확인" } },
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
  const end = timeline(stages).at(-1);
  const counts = received(end);
  const pushes = counts.reduce((a, b) => a + b, 0);
  const reached = counts.filter((n) => n > 0).length;
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
