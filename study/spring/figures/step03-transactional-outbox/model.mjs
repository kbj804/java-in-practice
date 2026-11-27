// 3단계 그림의 모델: 글 하나를 쓸 때 세 방법(가·나·다)이 두 장애 상황에서 어떤 순서로 무엇을 남기는지.
// 단계마다 바뀌는 상태만 적고(patch), 앞 단계 상태에 덮어써 가며 쌓는다.
// 마지막 상태로 글 하나의 결과를 내고, 글 5개(테스트와 같은 수)로 곱한 값이 EventDeliveryExperimentTest 출력과 같아야 한다.

export const WRITES = 5;
export const STAGE_SECONDS = 1.1;

// 상태
//   tx       - | open | commit | rollback
//   post     - | pending | committed | gone        (글 행)
//   outbox   - | pending | committed | sent | gone  (outbox 행, 다만)
//   attempts outbox 보내기 실패 횟수
//   broker   up | down
//   msg      - | sent | ghost | error | lost        (브로커 쪽 메시지)
//   mem      - | held | dropped                     (나: 메모리에 맡긴 이벤트)
//   relay    - | locked | fail | sent | idle         (다: 릴레이)
//   resp     null | 201 | 500 | 503
// active: 지금 일하는 상자(app | db | broker | relay), flow: 지금 움직이는 화살표
const INIT = { tx: "-", post: "-", outbox: "-", attempts: 0, broker: "up", msg: "-", mem: "-", relay: "-", resp: null };

const start = (down) => [
  { title: down ? "브로커가 죽어 있는 동안 글쓰기 요청이 들어온다" : "글쓰기 요청이 들어온다", active: "app", patch: { broker: down ? "down" : "up" } },
  { title: "트랜잭션을 열고 글을 INSERT 한다 (아직 커밋 전)", active: "db", flow: "app-db", patch: { tx: "open", post: "pending" } },
];

export const SCENARIOS = {
  down: {
    label: "브로커 장애",
    lead: "글을 쓰는 동안 브로커가 죽어 있다가, 응답이 나간 뒤 살아납니다.",
    ways: {
      before: [
        ...start(true),
        { title: "커밋 전에 브로커로 바로 보낸다 → 브로커 장애로 예외", active: "broker", flow: "app-broker", patch: { msg: "error" } },
        { title: "예외가 트랜잭션 밖으로 나가 글까지 롤백된다", active: "db", flow: "app-db", patch: { tx: "rollback", post: "gone" } },
        { title: "503 응답. 브로커 하나 때문에 글쓰기 자체가 실패한다", active: "app", patch: { resp: 503 } },
      ],
      after: [
        ...start(true),
        { title: "이벤트를 메모리에 맡겨 두기만 한다", active: "app", patch: { mem: "held" } },
        { title: "커밋. 글이 확정된다", active: "db", flow: "app-db", patch: { tx: "commit", post: "committed" } },
        { title: "AFTER_COMMIT 리스너가 보낸다 → 브로커 장애로 예외, 로그만 남는다", active: "broker", flow: "app-broker", patch: { msg: "error", mem: "dropped" } },
        { title: "201 응답. 사용자는 성공으로 안다", active: "app", patch: { resp: 201 } },
        { title: "브로커가 살아나도 다시 보내 줄 곳이 없다 → 유실", active: "broker", patch: { broker: "up", msg: "lost" } },
      ],
      outbox: [
        ...start(true),
        { title: "같은 트랜잭션에서 outbox 행도 INSERT 한다", active: "db", flow: "app-db", patch: { outbox: "pending" } },
        { title: "커밋. 글과 outbox 행이 함께 확정된다", active: "db", flow: "app-db", patch: { tx: "commit", post: "committed", outbox: "committed" } },
        { title: "201 응답. 브로커가 죽어 있어도 글쓰기는 성공한다", active: "app", patch: { resp: 201 } },
        { title: "릴레이가 SKIP LOCKED 로 행을 잡아 보낸다 → 실패, attempts 1, 행은 그대로", active: "relay", flow: "relay-broker", patch: { relay: "fail", attempts: 1, msg: "error" } },
        { title: "브로커가 살아난다", active: "broker", patch: { broker: "up", msg: "-", relay: "idle" } },
        { title: "다음 주기에 릴레이가 다시 보낸다 → 성공, published_at 을 찍는다", active: "relay", flow: "relay-broker", patch: { relay: "sent", outbox: "sent", msg: "sent" } },
      ],
    },
  },
  rollback: {
    label: "뒤 단계 실패",
    lead: "메시지를 맡긴 뒤, 같은 트랜잭션의 뒤 단계가 실패해 롤백됩니다. 브로커는 정상입니다.",
    ways: {
      before: [
        ...start(false),
        { title: "커밋 전에 브로커로 바로 보낸다 → 브로커가 받는다", active: "broker", flow: "app-broker", patch: { msg: "sent" } },
        { title: "뒤 단계가 실패해 롤백. 글은 사라진다", active: "db", flow: "app-db", patch: { tx: "rollback", post: "gone" } },
        { title: "이미 나간 메시지는 되돌릴 수 없다 → 없는 글을 가리키는 유령 메시지", active: "broker", patch: { msg: "ghost" } },
        { title: "500 응답", active: "app", patch: { resp: 500 } },
      ],
      after: [
        ...start(false),
        { title: "이벤트를 메모리에 맡겨 두기만 한다", active: "app", patch: { mem: "held" } },
        { title: "뒤 단계가 실패해 롤백. 글은 사라진다", active: "db", flow: "app-db", patch: { tx: "rollback", post: "gone" } },
        { title: "커밋되지 않았으니 리스너는 불리지 않고 이벤트도 버려진다", active: "app", patch: { mem: "dropped" } },
        { title: "500 응답. 글도 메시지도 없다 (정상)", active: "app", patch: { resp: 500 } },
      ],
      outbox: [
        ...start(false),
        { title: "같은 트랜잭션에서 outbox 행도 INSERT 한다", active: "db", flow: "app-db", patch: { outbox: "pending" } },
        { title: "뒤 단계가 실패해 롤백. 글과 outbox 행이 함께 사라진다", active: "db", flow: "app-db", patch: { tx: "rollback", post: "gone", outbox: "gone" } },
        { title: "500 응답", active: "app", patch: { resp: 500 } },
        { title: "릴레이가 돌지만 보낼 행이 없다 (정상)", active: "relay", flow: "relay-db", patch: { relay: "idle" } },
      ],
    },
  },
};

export const WAYS = [
  { key: "before", name: "가 · 커밋 전에 바로 보냄", cls: "BeforeCommitPostWriter" },
  { key: "after", name: "나 · 커밋 후에 보냄", cls: "AfterCommitPostWriter + @TransactionalEventListener" },
  { key: "outbox", name: "다 · outbox 에 적고 릴레이가 보냄", cls: "OutboxPostWriter + OutboxRelay" },
];

/** 단계마다 그때까지 쌓인 상태 */
export function timeline(stages) {
  let s = { ...INIT };
  return stages.map((st) => (s = { ...s, ...st.patch }));
}

/** 글 하나의 결과 × WRITES. 테스트 출력과 같은 항목. */
export function outcome(stages) {
  const end = timeline(stages).at(-1);
  const saved = end.post === "committed" ? 1 : 0;
  const sent = end.msg === "sent" || end.msg === "ghost" ? 1 : 0;
  const one = { accepted: end.resp === 201 ? 1 : 0, saved, sent, lost: saved && !sent ? 1 : 0, ghost: end.msg === "ghost" ? 1 : 0 };
  return Object.fromEntries(Object.entries(one).map(([k, v]) => [k, v * WRITES]));
}

// EventDeliveryExperimentTest 가 실제로 낸 값 ([실험②] 줄)
export const TEST = {
  down: {
    before: { accepted: 0, saved: 0, sent: 0, lost: 0, ghost: 0 },
    after: { accepted: 5, saved: 5, sent: 0, lost: 5, ghost: 0 },
    outbox: { accepted: 5, saved: 5, sent: 5, lost: 0, ghost: 0 },
  },
  rollback: {
    before: { accepted: 0, saved: 0, sent: 5, lost: 0, ghost: 5 },
    after: { accepted: 0, saved: 0, sent: 0, lost: 0, ghost: 0 },
    outbox: { accepted: 0, saved: 0, sent: 0, lost: 0, ghost: 0 },
  },
};
