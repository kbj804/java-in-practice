// 6단계 그림의 모델: 동네 최신 글 목록을 Valkey 에 두었을 때 네 장면에서 누가 누구에게 무엇을 보냈고 캐시와 DB 가 어떻게 되는지.
// 앞의 세 장면은 실험(FeedCacheExperimentTest)을 그대로 따라가고, 마지막 상태가 TEST 와 다르면 빌드가 멈춘다.
// 마지막 장면(TTL 동시 만료)은 실험이 아니라 계산이다.
//
// 설계
//   region:{id}:latest  Sorted Set, 값 = 글 ID 만 (점수도 글 ID). 100개까지. 제목은 글마다 post:{id}.
//   읽기     ZREVRANGE 로 ID, MGET 으로 요약. 없는 요약만 DB 에서 읽어 SET … EX (TTL + 지터).
//   목록 비면 SET lock NX PX 로 한 명만 DB 에서 다시 만들고, 나머지는 20ms 마다 다시 읽는다(single-flight).
//   이벤트    새 글 → 목록 키가 있을 때만 ZADD, 제목 수정 → DEL post:{id} (+1초 뒤 한 번 더), 블라인드 → ZREM + DEL.

export const STAGE_SECONDS = 1.6;

/** 실험 결과(첫 번째 실행). 세 번 돌린 범위는 노트 07 에 적었다. */
export const TEST = {
  plain: { queries: 150, slowestMs: 790 },
  lock: { queries: 1, slowestMs: 99 },
  event: { rebuilds: 0, list: "글 4 · 글 2 (오타 고침) · 글 1" },
  single: { staleMs: 3040 },
  double: { staleMs: 956 },
};

export const NODES = { app: "이웃 앱", vk: "Valkey", db: "PostgreSQL", mq: "RabbitMQ" };
export const FLOWS = {
  "app:l1": ["app", "l1"], "app:l2": ["app", "l2"],
  "l1:vk": ["l1", "vk"], "l2:vk": ["l2", "vk"], "l3:vk": ["l3", "vk"],
  "l1:db": ["l1", "db"], "l2:db": ["l2", "db"],
  "db:mq": ["db", "mq"], "mq:l3": ["mq", "l3"],
};

// 상태
//   app      [첫 줄, 둘째 줄, 색]       이웃 앱 쪽에서 보이는 것
//   workers  { l1, l2, l3 }             API 서버 안 세 줄이 하는 일
//   mq       큐에 있는 것
//   feed     null(키 없음) | 글 ID 배열 (최신 순)      feedNote 오른쪽 설명
//   post     [값, 색]  postTtl 오른쪽 설명                lock [값, 색]  lockPx 오른쪽 설명
//   pool     쓰는 커넥션 수(10개 중)   queue  커넥션을 기다리는 요청 수
//   queries  DB 큰 숫자(장면마다 뜻이 다름, dbLabel)     dbNote  DB 상자 설명
const INIT = {
  app: ["대기", "", "none"], workers: { l1: "대기", l2: "대기", l3: "대기" }, mq: "비어 있음",
  feed: null, feedNote: "", post: ["", "none"], postTtl: "", lock: ["없음", "none"], lockPx: "",
  pool: 0, queue: 0, queries: "0", dbNote: "",
};

const f = (id, label, text, kind = "run") => ({ id, label, text, kind });

const STAMPEDE_START = {
  app: ["150명이", "동시에 목록을 엶", "run"], workers: { l1: "목록 요청", l2: "목록 요청 149개", l3: "이 장면에선 안 씀" },
  feed: null, feedNote: "키 없음 · 방금 지워짐", post: ["글 30개 요약 모두 있음", "ok"], postTtl: "TTL 3초 (실험값)",
};
const IDS30 = ["30", "29", "28", "27", "26", "25"];

const RACE_START = (single) => [
  { t: 0, title: "요청 R: MGET post:7 → 없음 → PostgreSQL 에서 옛 제목 '상추 나눔햇어요' 를 읽고, 캐시에 넣기 전에 GC 로 멈춘다", cmd: [0], flows: [f("app:l1", "목록", "목록 요청"), f("l1:vk", "MGET 없음", "MGET post:7 → 없음"), f("l1:db", "옛 제목", "post 7 읽기 → 상추 나눔햇어요")], patch: { app: ["화면 제목", "(아직 못 받음)", "none"], workers: { l1: "옛 제목을 들고 멈춤", l2: "대기", l3: "대기" }, post: ["없음", "none"], dbNote: "제목: 상추 나눔햇어요", queries: "1" } },
  { t: 0, title: "그사이 작성자가 제목을 고친다: UPDATE 와 outbox 행을 한 트랜잭션에 커밋 → 릴레이가 PostUpdated 발행", flows: [f("app:l2", "제목 수정", "PATCH /posts/7"), f("l2:db", "UPDATE", "UPDATE 제목 + outbox 커밋"), f("db:mq", "PostUpdated", "릴레이 → PostUpdated 발행")], patch: { workers: { l1: "옛 제목을 들고 멈춤", l2: "제목 고침", l3: "대기" }, mq: "PostUpdated #7", dbNote: "제목: 상추 나눔했어요" } },
  single
    ? { t: 0, title: "캐시 리스너: DEL post:7. 아직 아무도 넣지 않아서 지울 것이 없다", cmd: [1], flows: [f("mq:l3", "PostUpdated", "PostUpdated 전달"), f("l3:vk", "DEL", "DEL post:7 → 지울 것 없음")], patch: { workers: { l1: "옛 제목을 들고 멈춤", l2: "대기", l3: "DEL 한 번 · 끝" }, mq: "비어 있음" } }
    : { t: 0, title: "캐시 리스너: DEL post:7, 그리고 1초 뒤에 한 번 더 지우기를 예약한다", cmd: [1], flows: [f("mq:l3", "PostUpdated", "PostUpdated 전달"), f("l3:vk", "DEL +1초 예약", "DEL post:7 · 1초 뒤 DEL 예약")], patch: { workers: { l1: "옛 제목을 들고 멈춤", l2: "대기", l3: "1초 뒤 DEL 예약" }, mq: "비어 있음" } },
  { t: 0, title: "R 이 깨어나 읽어 둔 옛 제목을 넣는다: SET post:7 '상추 나눔햇어요' EX 3. 옛 제목이 캐시에 들어갔다", cmd: [0], flows: [f("l1:vk", "SET 옛 제목", "SET post:7 상추 나눔햇어요 EX 3", "bad")], patch: { app: ["화면 제목", "상추 나눔햇어요", "bad"], workers: { l1: "옛 제목을 넣음", l2: "대기", l3: single ? "대기" : "1초 뒤 DEL 예약" }, post: ["상추 나눔햇어요 (옛 제목)", "bad"], postTtl: "TTL 3초" } },
];
const RACE_FRESH = (t, title) => ({ t, title, cmd: [0], flows: [f("l1:vk", "없음 → SET", "MGET post:7 → 없음 → SET 새 제목"), f("l1:db", "새 제목", "post 7 읽기 → 상추 나눔했어요")], patch: { app: ["화면 제목", "상추 나눔했어요", "ok"], workers: { l1: "새 제목을 넣음", l2: "대기", l3: "대기" }, post: ["상추 나눔했어요", "ok"], postTtl: "TTL 3초", queries: "2" } });

export const SCENARIOS = {
  stampede: {
    label: "동시에 몰린 150명",
    lead: "저녁 7시, 한 동네 목록 키(region:42:latest)가 지워진 순간 150명이 동시에 목록을 엽니다. 목록 DB 쿼리는 50ms 가 걸리고, DB 커넥션 풀은 10개입니다. 글 요약(post:{id})은 모두 캐시에 있습니다.",
    lanes: { l1: "먼저 온 요청", l2: "나머지 149명", l3: "캐시 리스너" },
    keys: { feed: "region:42:latest", post: "post:{id}", lock: "lock:region:42" }, dbLabel: "목록 쿼리 (누적)",
    unit: "ms", axis: { max: 820, ticks: [0, 200, 400, 600, 800] }, tl: { req: "요청들", db: "PostgreSQL" },
    ways: {
      before: {
        name: "가 · 락 없이 cache-aside", rule: "없으면 각자 DB 에서 읽어 캐시에 넣는다",
        cmds: [
          ["읽기", "ZREVRANGE region:42:latest 0 30   → 없으면 각자 DB 에서 목록을 만든다"],
          ["다시 만들기", "Lua 한 번: DEL → ZADD -1 \"0\"(표시용) → ZADD 글ID × 30 → PEXPIRE   (읽는 쪽이 빈 목록을 보지 않게)"],
          ["락", "없음. 처음에 없음을 본 요청은 모두 DB 로 간다"],
        ],
        stages: [
          { t: 0, title: "목록 키가 지워진 순간, 150명이 동시에 동네 목록을 연다", flows: [f("app:l1", "1명", "목록 요청 1건"), f("app:l2", "149명", "목록 요청 149건")], patch: STAMPEDE_START },
          { t: 1, title: "150명 모두 ZREVRANGE → 없음. 각자 DB 에서 목록을 만들러 간다", cmd: [0, 2], flows: [f("l1:vk", "없음", "ZREVRANGE → 없음"), f("l2:vk", "없음 ×149", "ZREVRANGE ×149 → 없음", "bad")], patch: { workers: { l1: "없음 → DB 로", l2: "149개 모두 없음 → DB 로", l3: "이 장면에선 안 씀" } } },
          { t: 2, title: "150명이 같은 목록 쿼리를 PostgreSQL 에 보낸다. 커넥션은 10개라 140명은 줄을 선다", flows: [f("l1:db", "쿼리", "목록 쿼리 (50ms)"), f("l2:db", "쿼리 ×149", "쿼리 149건 · 140건 줄 섬", "bad")], patch: { pool: 10, queue: 140, dbNote: "같은 쿼리 150건", workers: { l1: "쿼리 중", l2: "9개 쿼리 중 · 140개 줄 섬", l3: "이 장면에선 안 씀" } } },
          { t: 50, title: "50ms: 먼저 커넥션을 얻은 10명이 목록을 받아 각자 캐시에 넣는다. 140명은 아직 못 받았다(10명 쿼리 중 · 130명 줄)", cmd: [1], flows: [f("l1:vk", "목록 넣기", "Lua: DEL → ZADD ×30"), f("l2:vk", "목록 넣기 ×9", "같은 목록 9번 더 넣음", "bad")], patch: { feed: IDS30, feedNote: "채워짐 · 같은 목록을 10번 씀", queries: "10", queue: 130, workers: { l1: "받음 · 끝", l2: "9개 받음 · 130개 줄 섬", l3: "이 장면에선 안 씀" } } },
          { t: TEST.plain.slowestMs, title: `${TEST.plain.slowestMs}ms: 줄 선 140명이 10명씩 차례로 끝난다. 캐시는 50ms 에 이미 찼지만, 처음에 없음을 본 요청은 모두 DB 를 거쳤다`, cmd: [1], flows: [f("l2:db", "쿼리 ×140", "쿼리 140건 더 · 누적 150", "bad"), f("l2:vk", "목록 넣기 ×140", "같은 목록 140번 더 넣음", "bad")], patch: { app: ["150명 모두 받음", `가장 늦게 ${TEST.plain.slowestMs}ms`, "hold"], feedNote: "같은 목록을 150번 씀", queries: String(TEST.plain.queries), pool: 0, queue: 0, dbNote: "같은 쿼리 150건", workers: { l1: "끝", l2: `끝 · 가장 늦게 ${TEST.plain.slowestMs}ms`, l3: "이 장면에선 안 씀" } } },
        ],
        segs: [["req", 0, TEST.plain.slowestMs, "hold", `커넥션을 기다림 · 가장 늦은 사람 ${TEST.plain.slowestMs}ms`], ["db", 2, TEST.plain.slowestMs, "down", "커넥션 10개 꽉 참 · 쿼리 150번"]],
        result: [["목록 DB 쿼리", `${TEST.plain.queries}번`, "bad"], ["가장 늦은 응답", `${TEST.plain.slowestMs}ms`, "bad"], ["받은 사람", "150명", ""]],
        check: { queries: TEST.plain.queries, lastT: TEST.plain.slowestMs },
      },
      after: {
        name: "나 · single-flight (SET NX PX 락)", rule: "없으면 락을 잡은 한 명만 DB 에서 다시 만들고, 나머지는 20ms 마다 다시 읽는다",
        cmds: [
          ["읽기", "ZREVRANGE region:42:latest 0 30   → 없으면 락을 잡아 본다"],
          ["락 잡기", "SET lock:region:42 <토큰> NX PX 500   → 한 명만 OK. 나머지는 20ms 마다 다시 읽기 (최대 10번)"],
          ["넣고 풀기", "Lua: DEL → ZADD → PEXPIRE,  이어서 Lua: lock 값이 내 토큰이면 DEL"],
        ],
        stages: [
          { t: 0, title: "목록 키가 지워진 순간, 150명이 동시에 동네 목록을 연다", flows: [f("app:l1", "1명", "목록 요청 1건"), f("app:l2", "149명", "목록 요청 149건")], patch: STAMPEDE_START },
          { t: 1, title: "모두 ZREVRANGE → 없음 → SET lock NX PX 500. 먼저 온 요청만 OK, 149명은 실패한다", cmd: [0, 1], flows: [f("l1:vk", "없음 · 락 OK", "없음 → SET NX → OK"), f("l2:vk", "없음 · 락 실패", "없음 → SET NX ×149 → 실패")], patch: { lock: ["토큰 a1 (먼저 온 요청)", "run"], lockPx: "PX 500ms", workers: { l1: "락 잡음", l2: "20ms 쉬고 다시 읽기", l3: "이 장면에선 안 씀" } } },
          { t: 2, title: "락을 잡은 한 명만 PostgreSQL 에 목록 쿼리(50ms). 149명은 20ms, 40ms 에 다시 읽지만 아직 없다", cmd: [0], flows: [f("l1:db", "쿼리 1", "목록 쿼리 (50ms)"), f("l2:vk", "다시 읽기", "20 · 40ms 에 다시 읽기 → 없음")], patch: { pool: 1, queue: 0, dbNote: "쿼리 1건만", workers: { l1: "쿼리 중", l2: "20ms 마다 다시 읽기", l3: "이 장면에선 안 씀" } } },
          { t: 52, title: "52ms: 쿼리 끝 → 목록을 Lua 한 번으로 바꿔 넣고 → 락을 푼다(값이 내 토큰일 때만 DEL)", cmd: [2], flows: [f("l1:vk", "넣고 락 풀기", "목록 넣기 · 내 토큰이면 DEL lock")], patch: { feed: IDS30, feedNote: "채워짐 · 한 번 씀", lock: ["없음", "none"], lockPx: "", pool: 0, queries: String(TEST.lock.queries), workers: { l1: "받음 · 끝", l2: "20ms 마다 다시 읽기", l3: "이 장면에선 안 씀" } } },
          { t: 60, title: "60ms: 149명이 세 번째 다시 읽기(20 · 40 · 60ms)에서 목록을 받는다", cmd: [0], flows: [f("l2:vk", "있음 ×149", "ZREVRANGE ×149 → 있음")], patch: { workers: { l1: "끝", l2: "149개 받음", l3: "이 장면에선 안 씀" } } },
          { t: TEST.lock.slowestMs, title: `계산으로는 60ms 지만, 150개 요청이 한꺼번에 도는 실험에서 가장 늦은 응답은 ${TEST.lock.slowestMs}ms. 목록 DB 쿼리는 1번`, flows: [], focus: ["db"], note: "PostgreSQL: 목록 쿼리 1번, 커넥션 1개만 50ms", patch: { app: ["150명 모두 받음", `가장 늦게 ${TEST.lock.slowestMs}ms`, "ok"], workers: { l1: "끝", l2: "끝", l3: "이 장면에선 안 씀" } } },
        ],
        segs: [["req", 1, 60, "hold", "149명이 20ms 마다 다시 읽다가 60ms 에 받음"], ["req", 60, 60, "ok"], ["db", 2, 52, "send", "쿼리 1번"]],
        result: [["목록 DB 쿼리", `${TEST.lock.queries}번`, "ok"], ["가장 늦은 응답", `${TEST.lock.slowestMs}ms`, "ok"], ["받은 사람", "150명", ""]],
        check: { queries: TEST.lock.queries, lastT: TEST.lock.slowestMs },
      },
    },
  },
  event: {
    label: "이벤트로 고치기",
    lead: "글 1~3 이 있는 동네에 글 4 가 올라오고, 글 2 의 제목이 고쳐지고, 글 3 이 신고로 가려집니다. 릴레이는 글 4 의 PostCreated 를 정상으로 한 번 보낸 뒤 같은 메시지를 두 번 더 보냅니다. 캐시는 글 쓰는 API 가 아니라 이벤트를 받은 캐시 리스너가 고칩니다.",
    lanes: { l1: "글 API", l2: "목록 요청", l3: "캐시 리스너" },
    keys: { feed: "region:42:latest", post: "post:2", lock: "lock:region:42" }, off: ["lock"], dbLabel: "목록 쿼리 (누적)",
    unit: null, axis: null, tl: {},
    ways: {
      only: {
        name: "다 · 이벤트로 고치기 (목록 키는 지우지 않음)", rule: "새 글 ZADD (키가 있을 때만) · 제목 수정 DEL post:{id} · 블라인드 ZREM + DEL",
        cmds: [
          ["새 글", "Lua: region:42:latest 가 있으면 ZADD 글ID 글ID → ZREMRANGEBYRANK 로 100개만 남김. 없으면 안 넣는다"],
          ["제목 수정", "DEL post:{id}   (+ 1초 뒤 한 번 더 DEL)   목록의 ID 는 그대로"],
          ["블라인드", "ZREM region:42:latest {id}  +  DEL post:{id}  (+ 1초 뒤 한 번 더 DEL)"],
        ],
        stages: [
          { t: 0, title: "글 1~3 작성 → PostCreated 3건. 목록 키가 아직 없어서 넣지 않는다 (넣으면 글 하나짜리 반쪽 목록이 완전한 목록처럼 읽힌다)", cmd: [0], flows: [f("db:mq", "PostCreated ×3", "릴레이 → PostCreated 3건"), f("mq:l3", "×3", "PostCreated 3건 전달"), f("l3:vk", "키 없음 → 안 넣음", "EXISTS → 0 → 안 넣음")], patch: { workers: { l1: "글 1~3 씀", l2: "대기", l3: "키 없음 · 그냥 넘김" }, feedNote: "키 없음", post: ["없음", "none"] } },
          { t: 0, title: "첫 목록 요청: 없음 → PostgreSQL 에서 목록을 만들어 넣는다 (목록 쿼리 1번)", flows: [f("app:l2", "목록", "목록 요청"), f("l2:vk", "없음 → 넣기", "없음 → 목록 · 요약 넣기"), f("l2:db", "목록 쿼리", "목록 쿼리 + 글 요약 3건 읽기")], patch: { app: ["화면 목록", "글 3 · 글 2 · 글 1", "ok"], workers: { l1: "대기", l2: "목록 만듦", l3: "대기" }, feed: ["3", "2", "1"], feedNote: "TTL 10분", post: ["글 2", "ok"], postTtl: "TTL 3초 (실험값)", queries: "1" } },
          { t: 0, title: "글 4 작성: 글과 outbox 행을 한 트랜잭션에 저장 → 릴레이가 PostCreated 발행", flows: [f("app:l1", "글 4", "POST /posts (글 4)"), f("l1:db", "INSERT", "INSERT 글 + outbox 커밋"), f("db:mq", "PostCreated", "릴레이 → PostCreated 발행")], patch: { workers: { l1: "글 4 씀", l2: "대기", l3: "대기" }, mq: "PostCreated #4" } },
          { t: 0, title: "캐시 리스너: 목록 키가 있으니 ZADD 4 → 점수(글 ID)가 가장 커서 맨 앞에 선다", cmd: [0], flows: [f("mq:l3", "PostCreated", "PostCreated 전달"), f("l3:vk", "ZADD 4", "ZADD region:42:latest 4 4")], patch: { workers: { l1: "대기", l2: "대기", l3: "ZADD 4" }, mq: "비어 있음", feed: ["4", "3", "2", "1"] } },
          { t: 0, title: "글 2 제목 수정 → PostUpdated → 캐시 리스너가 DEL post:2. 목록의 ID 는 그대로 둔다", cmd: [1], flows: [f("app:l1", "제목 수정", "PATCH /posts/2"), f("l1:db", "UPDATE", "UPDATE 제목 + outbox 커밋"), f("db:mq", "PostUpdated", "릴레이 → PostUpdated 발행"), f("mq:l3", "PostUpdated", "PostUpdated 전달"), f("l3:vk", "DEL post:2", "DEL post:2 (+1초 뒤 한 번 더)")], patch: { workers: { l1: "제목 고침", l2: "대기", l3: "DEL post:2" }, post: ["없음 (지움)", "none"], postTtl: "" } },
          { t: 0, title: "글 3 신고 블라인드 → PostBlinded → 캐시 리스너가 ZREM 3 + DEL post:3. 목록 키는 지우지 않아서 빈 순간이 없다", cmd: [2], flows: [f("app:l1", "블라인드", "POST /posts/3/blind"), f("l1:db", "UPDATE", "blinded_at + outbox 커밋"), f("db:mq", "PostBlinded", "릴레이 → PostBlinded 발행"), f("mq:l3", "PostBlinded", "PostBlinded 전달"), f("l3:vk", "ZREM 3", "ZREM 3 · DEL post:3")], patch: { workers: { l1: "가림", l2: "대기", l3: "ZREM 3" }, feed: ["4", "2", "1"] } },
          { t: 0, title: "같은 PostCreated(글 4)가 두 번 더 왔다 → ZADD 4 두 번 더. 이미 있는 값이라 목록은 그대로", cmd: [0], flows: [f("db:mq", "PostCreated ×2", "같은 PostCreated 2번 더", "bad"), f("mq:l3", "×2", "PostCreated 2번 전달"), f("l3:vk", "ZADD 4 ×2", "ZADD 4 두 번 더 → 그대로")], patch: { workers: { l1: "대기", l2: "대기", l3: "ZADD 4 ×2 · 그대로" } } },
          { t: 0, title: "다음 목록 요청: ID 는 캐시에서 읽고, 요약이 없는 글만 DB 에서 읽는다(글 2 는 지웠고 글 4 는 아직 아무도 안 읽었다). 목록 쿼리는 처음 1번뿐", flows: [f("app:l2", "목록", "목록 요청"), f("l2:vk", "ID · 요약", "ID 4 · 2 · 1, 요약 2 · 4 없음"), f("l2:db", "없는 요약만", "없는 글 요약만 읽기 → SET")], patch: { app: ["화면 목록", "4 · 2(새 제목) · 1", "ok"], workers: { l1: "대기", l2: "목록 받음", l3: "대기" }, post: ["글 2 (오타 고침)", "ok"], postTtl: "TTL 3초 (실험값)", dbNote: "없는 요약만 읽음" } },
        ],
        segs: [],
        result: [["목록 다시 만들기", `${TEST.event.rebuilds}번 (처음 1번 뒤)`, "ok"], ["화면 목록", TEST.event.list, "ok"], ["같은 이벤트 2번 더", "목록에 1개", "ok"]],
        check: { queries: 1 + TEST.event.rebuilds },
      },
    },
  },
  race: {
    label: "늦게 들어온 옛 값",
    lead: "요청 R 이 DB 에서 옛 제목을 읽고 멈춘 사이 작성자가 제목을 고치고, 캐시 리스너가 post:7 을 지웁니다. 그 뒤에 깨어난 R 이 옛 제목을 캐시에 넣습니다. 시간축은 R 이 옛 제목을 넣은 때부터입니다. 실험이라 글 요약 TTL 은 3초로 줄였습니다.",
    lanes: { l1: "요청 R", l2: "글 API", l3: "캐시 리스너" },
    keys: { feed: "region:42:latest", post: "post:7", lock: "lock:region:42" }, off: ["feed", "lock"], dbLabel: "글 7 읽기 (누적)",
    unit: "ms", axis: { max: 3500, ticks: [0, 1000, 2000, 3000] }, tl: { lis: "캐시 리스너", ttl: "post:7 TTL", screen: "화면 제목" },
    ways: {
      before: {
        name: "라 · 한 번만 지움", rule: "제목이 바뀌면 DEL post:7 한 번. 늦게 들어온 옛 값은 TTL 이 지운다",
        cmds: [
          ["읽기", "MGET post:7   → 없으면 DB 에서 읽어 SET post:7 {…} EX 3"],
          ["제목 수정", "DEL post:7   (한 번만)"],
          ["안전망", "TTL 3초 (실험용. 운영은 10분 + 지터 0~2분)"],
        ],
        stages: [
          ...RACE_START(true),
          { t: 1000, title: "1초: 화면에는 아직 옛 제목. 이 키를 다시 지울 사람이 없다", cmd: [2], flows: [], focus: ["vk"], note: "Valkey: post:7 = 옛 제목, TTL 2초 남음", patch: { postTtl: "TTL 2초 남음", workers: { l1: "대기", l2: "대기", l3: "대기" } } },
          RACE_FRESH(TEST.single.staleMs, `${TEST.single.staleMs.toLocaleString()}ms: TTL 3초가 지나 키가 사라짐 → 다음 읽기(MGET)가 없음 → DB 에서 새 제목을 읽어 넣는다 (100ms 마다 읽어서 3초보다 조금 늦게 본다)`),
        ],
        segs: [["lis", 0, 0, "ok", "DEL (지울 것 없음)"], ["ttl", 0, 3000, "lease"], ["ttl", 3000, 3000, "fail", "TTL 이 지움"], ["screen", 0, TEST.single.staleMs, "wrong", "옛 제목"], ["screen", TEST.single.staleMs, 3500, "valid", "새 제목"]],
        result: [["옛 제목이 보인 시간", `${TEST.single.staleMs.toLocaleString()}ms`, "bad"], ["옛 값을 지운 것", "TTL 3초", "hold"]],
        check: { lastT: TEST.single.staleMs },
      },
      after: {
        name: "마 · 지연 이중 삭제 (1초 뒤 한 번 더)", rule: "DEL post:7 하고 1초 뒤 한 번 더 DEL. 그 사이에 들어온 옛 값을 지운다",
        cmds: [
          ["읽기", "MGET post:7   → 없으면 DB 에서 읽어 SET post:7 {…} EX 3"],
          ["제목 수정", "DEL post:7,  1초 뒤 DEL post:7 한 번 더 (지연 이중 삭제)"],
          ["안전망", "TTL 3초 (실험용. 운영은 10분 + 지터 0~2분)"],
        ],
        stages: [
          ...RACE_START(false),
          { t: TEST.double.staleMs, title: `${TEST.double.staleMs}ms: 예약해 둔 두 번째 DEL → 옛 제목이 지워진다. R 이 첫 DEL 보다 조금 늦게 넣어서 1초보다 조금 짧다 (실험은 100ms 마다 읽어 몇십 ms 오차가 있다)`, cmd: [1], flows: [f("l3:vk", "두 번째 DEL", "DEL post:7 (예약해 둔 두 번째)")], patch: { workers: { l1: "대기", l2: "대기", l3: "두 번째 DEL" }, post: ["없음 (지움)", "none"], postTtl: "" } },
          RACE_FRESH(TEST.double.staleMs, "다음 읽기(MGET)가 없음 → DB 에서 새 제목을 읽어 넣는다"),
        ],
        segs: [["lis", 0, 0, "ok", "DEL"], ["lis", TEST.double.staleMs, TEST.double.staleMs, "ok", "두 번째 DEL"], ["ttl", 0, TEST.double.staleMs, "lease"], ["screen", 0, TEST.double.staleMs, "wrong", "옛 제목"], ["screen", TEST.double.staleMs, 3500, "valid", "새 제목"]],
        result: [["옛 제목이 보인 시간", `${TEST.double.staleMs}ms`, "ok"], ["옛 값을 지운 것", "두 번째 DEL", "ok"]],
        check: { lastT: TEST.double.staleMs },
      },
    },
  },
  ttl: {
    label: "TTL 동시 만료 (계산)",
    lead: "실험이 아니라 계산입니다. 7시 정각 배포 직후 3초 동안 인기 글 5만 개의 post:{id} 가 채워졌습니다. 모두 인기 글이라 만료되면 곧바로 다시 읽힌다고 봅니다.",
    lanes: { l1: "읽는 요청들", l2: "—", l3: "—" },
    keys: { feed: "region:42:latest", post: "post:{id}", lock: "lock:region:42" }, off: ["feed", "lock"], dbLabel: "글 요약 DB 읽기 (누적)",
    unit: "clock", axis: { max: 13, ticks: [0, 2, 4, 6, 8, 10, 12] }, tl: { fill: "채움 (SET)", expire: "만료 → DB" },
    ways: {
      before: {
        name: "가 · EX 600 (모두 같은 10분)", rule: "SET post:{id} {…} EX 600",
        cmds: [["채우기", "SET post:{id} {…} EX 600"], ["만료", "7:00:00~7:00:03 에 채운 키 → 7:10:00~7:10:03 에 만료"], ["", ""]],
        stages: [
          { t: 0, title: "7:00:00~7:00:03 배포 직후 인기 글 5만 개를 읽으며 SET post:{id} EX 600 으로 채운다", cmd: [0], flows: [f("app:l1", "읽기", "인기 글 읽기"), f("l1:vk", "SET ×5만", "SET post:{id} EX 600 × 5만"), f("l1:db", "읽기 ×5만", "글 요약 5만 건 읽기")], patch: { app: ["배포 직후", "인기 글을 읽음", "run"], workers: { l1: "5만 개 채움", l2: "—", l3: "—" }, post: ["5만 개", "run"], postTtl: "만료 7:10:00~7:10:03", queries: "5만" } },
          { t: 10, title: "7:10:00~7:10:03 5만 개가 3초 안에 한꺼번에 만료 → 다음 읽기가 모두 없음 → 3초 동안 DB 읽기 5만 번 (초당 약 1만 7천)", cmd: [1], flows: [f("l1:vk", "없음 ×5만", "읽기 → 3초 동안 5만 번 없음", "bad"), f("l1:db", "읽기 ×5만", "3초에 5만 건 · 초당 약 1.7만", "bad")], patch: { app: ["7:10", "목록이 느려짐", "bad"], workers: { l1: "5만 개 다시 채움", l2: "—", l3: "—" }, post: ["3초 동안 5만 개 사라짐", "bad"], postTtl: "", queries: "10만", dbNote: "초당 약 1만 7천 건" } },
          { t: 13, title: "키마다 락(single-flight)을 걸어도 키가 5만 개라 5만 번이다. 만료 시각 자체를 흩어야 한다", flows: [], focus: ["db"], note: "PostgreSQL: 3초에 5만 건이 몰림", patch: {} },
        ],
        segs: [["fill", 0, 0, "ok", "5만 개 채움"], ["expire", 10, 10, "fail", "5만 개 · 3초 안에 만료"]],
        result: [["만료가 몰린 시간", "3초", "bad"], ["그동안 초당 DB 읽기", "약 1만 7천", "bad"]],
        check: {},
      },
      after: {
        name: "나 · EX 600 + 지터 0~120초", rule: "SET post:{id} {…} EX (600 + 무작위 0~120)",
        cmds: [["채우기", "SET post:{id} {…} EX (600 + 무작위 0~120)"], ["만료", "7:10:00~7:12:03 에 고르게 흩어져 만료"], ["", ""]],
        stages: [
          { t: 0, title: "7:00:00~7:00:03 같은 5만 개를 채우되, 키마다 TTL 에 0~120초를 무작위로 더한다", cmd: [0], flows: [f("app:l1", "읽기", "인기 글 읽기"), f("l1:vk", "SET ×5만", "SET post:{id} EX 600+지터 × 5만"), f("l1:db", "읽기 ×5만", "글 요약 5만 건 읽기")], patch: { app: ["배포 직후", "인기 글을 읽음", "run"], workers: { l1: "5만 개 채움", l2: "—", l3: "—" }, post: ["5만 개", "run"], postTtl: "만료 7:10~7:12 사이", queries: "5만" } },
          { t: 10, title: "7:10:00 부터 만료가 시작되지만 2분에 고르게 흩어진다 → DB 읽기 초당 약 420번", cmd: [1], flows: [f("l1:vk", "없음 (조금씩)", "읽기 → 초당 약 420번 없음"), f("l1:db", "초당 ~420", "글 요약 읽기 초당 약 420건")], patch: { app: ["7:10", "평소처럼", "ok"], workers: { l1: "조금씩 다시 채움", l2: "—", l3: "—" }, post: ["2분에 걸쳐 조금씩", "ok"], postTtl: "", dbNote: "초당 약 420건" } },
          { t: 12, title: "7:12:03 이면 모두 한 번씩 다시 채워졌다. 읽기가 TTL 을 늘리지 않으니, 옛 값이 남아도 최대 12분이면 사라진다", flows: [], focus: ["db"], note: "PostgreSQL: 2분 동안 초당 약 420건", patch: { queries: "10만" } },
        ],
        segs: [["fill", 0, 0, "ok", "5만 개 채움"], ["expire", 10, 12, "down", "2분에 걸쳐 만료 · 초당 약 420"]],
        result: [["만료가 몰린 시간", "2분", "ok"], ["그동안 초당 DB 읽기", "약 420", "ok"]],
        check: {},
      },
    },
  },
};

/** 단계마다 그때까지 쌓인 상태 */
export function timeline(stages) {
  let s = { ...INIT };
  return stages.map((st) => (s = { ...s, ...st.patch }));
}
