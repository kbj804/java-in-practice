// 5단계 그림의 모델: 4단계 inbox 위에 재시도 규칙(리스 부등식 · 호출 타임아웃 · 지수 백오프 · 펜싱 · 만료)을 얹었을 때,
// 네 장면에서 누가 누구에게 무엇을 보냈고 행과 이웃이 어떻게 되는지.
// 이 단계는 실험 코드 없이 설계만 정리한다. 시각표는 아래 규칙으로 손으로 따라간 것이고,
// 마지막 상태로 계산한 결과가 EXPECT(노트 06 의 표)와 다르면 빌드가 멈춘다.
//
// 규칙(나 쪽)
//   리스 30초 > 묶음 10행 × 호출 타임아웃 2.9초 + 여유
//   claim:  next_attempt_at <= now 인 행을 가져가며 attempts + 1, next_attempt_at = now + 리스
//   성공:   completed, next_attempt_at = null       (WHERE id = ? AND attempts = 내 값)
//   실패:   next_attempt_at = now + 백오프(5 · 10 · 20 · 40초, 최대 60초)  (같은 펜싱 조건)
//   상한:   attempts 10 을 넘으면 failed
//   만료:   occurred_at + 10분 < now 면 보내지 않고 expired
//   스케줄러는 5초마다 돈다.

export const NEIGHBORS = 10;
export const STAGE_SECONDS = 1.6;

export const NODES = { relay: "OutboxRelay", mq: "RabbitMQ", w1: "리스너 1", sw: "스케줄러", db: "PostgreSQL", fcm: "FCM", phones: "이웃 휴대폰" };
export const FLOWS = {
  pub: ["relay", "mq"], "deliver:w1": ["mq", "w1"], "ack:w1": ["w1", "mq"],
  "db:w1": ["w1", "db"], "db:sw": ["sw", "db"],
  "push:w1": ["w1", "fcm"], "push:sw": ["sw", "fcm"], fcm: ["fcm", "phones"],
};

// 상태
//   relay    릴레이가 하는 일          mq  큐에 있는 것
//   fcm      [글, ok | slow | down]   FCM 상태
//   workers  { w1, sw }               리스너 · 스케줄러가 하는 일
//   strip    10글자, 행 #1~#10 의 상태
//            . 없음  p pending(지금 가져갈 수 있음)  w 다음 시도 대기(백오프)  r 리스너 1이 쥠  s 스케줄러가 쥠
//            c completed  f failed(포기)  x expired(만료로 버림)
//   row      돋보기로 보는 행 하나: { state, attempts, next, occurred }
//   recv     10글자, 이웃마다 받은 푸시 수
//   calls    FCM 에 보낸 요청 수(실패 포함)
//   stale    true 면 받은 알림이 유효 시간을 넘긴 것
const INIT = { relay: "대기", mq: "비어 있음", fcm: ["정상", "ok"], workers: { w1: "대기", sw: "5초마다 확인" }, strip: "..........", row: null, recv: "0000000000", calls: 0, stale: false };

const f = (id, label, text, kind = "run") => ({ id, label, text, kind });
const row = (state, attempts, next, occurred = "0초") => ({ state, attempts, next, occurred });

export const SCENARIOS = {
  slow: {
    label: "FCM 한 건이 멈춤",
    lead: "리스너 1이 10행 묶음을 보내는데, #3 의 FCM 호출이 25초 동안 응답하지 않습니다. 다른 호출은 1초씩 걸리고 리스는 30초입니다.",
    unit: "s", axis: { max: 45, ticks: [0, 10, 20, 30, 40] }, focus: 3,
    lanes: { w1: "리스너 1", sw: "스케줄러", fcm: "FCM" },
    ways: {
      before: {
        name: "가 · 호출 타임아웃 없음, 묶음이 끝나야 completed", rule: "4단계 그대로: 묶음 100행 대신 10행으로 줄였을 뿐",
        stages: [
          { t: 0, title: "리스너 1 → PostgreSQL: 10행 claim (attempts 1, 리스 30초까지)", flows: [f("db:w1", "claim 10", "claim → #1~#10, 리스 30초까지")], patch: { workers: { w1: "10행 가져감", sw: "5초마다 확인" }, strip: "rrrrrrrrrr", row: row("processing", 1, "30초") } },
          { t: 2, title: "리스너 1 → FCM: #1, #2 보냄. completed 는 묶음이 끝나야 찍는다", flows: [f("push:w1", "#1 #2", "푸시 2건 (1초씩)"), f("fcm", "2건", "이웃 2명에게 알림")], patch: { workers: { w1: "#2 까지 보냄", sw: "5초마다 확인" }, recv: "1100000000", calls: 2 } },
          { t: 27, title: "리스너 1 → FCM: #3 호출이 25초 동안 응답 없음. 타임아웃이 없어 그대로 기다린다", flows: [f("push:w1", "#3 …25초", "#3 호출, 25초 기다림 (타임아웃 없음)", "bad"), f("fcm", "1건", "이웃 #3 에게 알림 (25초 뒤)")], patch: { fcm: ["#3 에 25초 걸림", "slow"], workers: { w1: "#3 기다림 25초", sw: "5초마다 확인" }, recv: "1110000000", calls: 3 } },
          { t: 30, title: "리스너 1 → FCM: #4~#6. 30초, 리스가 끝났는데 #7~#10 이 남았다", flows: [f("push:w1", "#4~#6", "푸시 3건"), f("fcm", "3건", "이웃 3명에게 알림")], patch: { fcm: ["정상", "ok"], workers: { w1: "#6 까지 보냄 · 리스 끝남", sw: "5초마다 확인" }, recv: "1111110000", calls: 6 } },
          { t: 30, title: "스케줄러 → PostgreSQL: 리스가 지난 10행을 claim (attempts 2). 리스너 1은 아직 보내는 중", flows: [f("db:sw", "claim 10", "claim → 리스 지난 #1~#10 (attempts 2)", "bad")], patch: { workers: { w1: "#7 보내는 중", sw: "10행 가져감" }, strip: "ssssssssss", row: row("processing", 2, "60초") } },
          { t: 34, title: "리스너 1 → FCM #7~#10, 스케줄러 → FCM #1~#4. 같은 행을 둘이 동시에 보낸다", flows: [f("push:w1", "#7~#10", "푸시 4건"), f("push:sw", "#1~#4", "푸시 4건 (이미 받은 사람)", "bad"), f("fcm", "8건", "이웃 8명에게 알림 (4명은 두 번째)")], patch: { workers: { w1: "#10 까지 보냄", sw: "#4 까지 보냄" }, recv: "2222111111", calls: 14 } },
          { t: 34, title: "리스너 1 → PostgreSQL: 10행 completed (WHERE id = ?). 스케줄러가 보내는 중인 행이다", flows: [f("db:w1", "completed", "completed ×10 (남의 리스를 덮어씀)", "bad")], patch: { workers: { w1: "끝", sw: "#5 보내는 중" }, strip: "cccccccccc", row: row("completed", 2, "null") } },
          { t: 40, title: "스케줄러 → FCM #5~#10 → completed. 10명 모두 두 번 받았다", flows: [f("push:sw", "#5~#10", "푸시 6건 (이미 받은 사람)", "bad"), f("fcm", "6건", "이웃 6명에게 두 번째 알림"), f("db:sw", "completed", "completed ×10")], patch: { workers: { w1: "끝", sw: "끝" }, recv: "2222222222", calls: 20 } },
        ],
        segs: [["w1", 0, 30, "lease"], ["w1", 0, 2, "send"], ["w1", 2, 27, "slow", "#3 25초"], ["w1", 27, 34, "send"], ["sw", 30, 45, "lease"], ["sw", 30, 40, "send", "같은 10행"], ["fcm", 2, 27, "slow"]],
        expect: { calls: 20, reached: 10, dup: 10, missed: 0, expired: 0, stale: 0 },
      },
      after: {
        name: "나 · 호출 타임아웃 2.9초 + 행마다 completed", rule: "리스 30초 > 10행 × 2.9초 + 여유",
        stages: [
          { t: 0, title: "리스너 1 → PostgreSQL: 10행 claim (attempts 1, 리스 30초까지)", flows: [f("db:w1", "claim 10", "claim → #1~#10, 리스 30초까지")], patch: { workers: { w1: "10행 가져감", sw: "5초마다 확인" }, strip: "rrrrrrrrrr", row: row("processing", 1, "30초") } },
          { t: 2, title: "리스너 1 → FCM: #1, #2 보내고 행마다 바로 completed", flows: [f("push:w1", "#1 #2", "푸시 2건"), f("fcm", "2건", "이웃 2명에게 알림"), f("db:w1", "completed", "completed ×2 (WHERE attempts = 1)")], patch: { workers: { w1: "#2 까지 끝", sw: "5초마다 확인" }, strip: "ccrrrrrrrr", recv: "1100000000", calls: 2 } },
          { t: 4.9, title: "리스너 1 → FCM: #3 이 2.9초 안에 응답이 없어 끊는다 → PostgreSQL: #3 실패, next_attempt_at = 9.9초", flows: [f("push:w1", "#3 2.9초 ×", "#3 호출, 2.9초 타임아웃", "bad"), f("db:w1", "실패 기록", "#3: next_attempt_at = 지금 + 5초")], patch: { fcm: ["#3 응답 없음 → 끊음", "slow"], workers: { w1: "#3 포기, 다음 행으로", sw: "5초마다 확인" }, strip: "ccwrrrrrrr", row: row("pending", 1, "9.9초"), calls: 3 } },
          { t: 9.9, title: "리스너 1 → FCM: #4~#8 보내고 행마다 completed", flows: [f("push:w1", "#4~#8", "푸시 5건"), f("fcm", "5건", "이웃 5명에게 알림"), f("db:w1", "completed", "completed ×5")], patch: { fcm: ["정상", "ok"], workers: { w1: "#8 까지 끝", sw: "5초마다 확인" }, strip: "ccwcccccrr", recv: "1101111100", calls: 8 } },
          { t: 11.9, title: "스케줄러(10초) → PostgreSQL: next_attempt_at 이 지난 #3 만 claim (attempts 2) → FCM → completed. 리스너 1은 #9, #10 을 마저 보낸다", flows: [f("db:sw", "claim #3", "claim → #3 (attempts 2) → completed"), f("push:sw", "#3", "푸시 1건"), f("push:w1", "#9 #10", "푸시 2건"), f("fcm", "3건", "이웃 3명에게 알림")], patch: { workers: { w1: "끝 · 12초", sw: "#3 보냄" }, strip: "cccccccccc", row: row("completed", 2, "null"), recv: "1111111111", calls: 11 } },
          { t: 12, title: "묶음이 12초 만에 끝나 리스 30초 안이다. 같은 행을 두 번 가져간 적이 없다", flows: [], focus: ["db"], note: "PostgreSQL: 10행 모두 completed, 리스가 끝난 행 없음", patch: { workers: { w1: "대기", sw: "5초마다 확인" } } },
        ],
        segs: [["w1", 0, 11.9, "lease"], ["w1", 0, 2, "send"], ["w1", 2, 4.9, "fail", "2.9초"], ["w1", 4.9, 11.9, "send"], ["sw", 10, 11, "send", "#3"], ["fcm", 2, 4.9, "slow"]],
        expect: { calls: 11, reached: 10, dup: 0, missed: 0, expired: 0, stale: 0 },
      },
    },
  },
  outage: {
    label: "FCM 3분 장애",
    lead: "FCM 이 0초부터 180초까지 모든 요청에 503 을 돌려줍니다. 묶음 10행이 모두 같은 일을 겪고, 스케줄러는 5초마다 돕니다.",
    unit: "s", axis: { max: 210, ticks: [0, 30, 60, 90, 120, 150, 180, 210] }, focus: 1,
    lanes: { w1: "리스너 1", sw: "스케줄러", fcm: "FCM" },
    ways: {
      before: {
        name: "가 · 상한 5번, 백오프 없음", rule: "실패하면 next_attempt_at = 지금 (바로 다시)",
        stages: [
          { t: 0, title: "리스너 1 → PostgreSQL: 10행 claim (attempts 1) → FCM 10건 → 503 → 바로 다시 가져갈 수 있게 기록", flows: [f("db:w1", "claim·실패", "claim → 실패 기록, next = 지금"), f("push:w1", "10건 → 503", "푸시 10건 모두 503", "bad")], patch: { fcm: ["장애 503", "down"], workers: { w1: "10건 실패", sw: "5초마다 확인" }, strip: "pppppppppp", row: row("pending", 1, "0초 (바로)"), calls: 10 } },
          { t: 5, title: "5초: 스케줄러 → PostgreSQL claim (attempts 2) → FCM 10건 → 503", flows: [f("db:sw", "claim·실패", "claim (attempts 2) → 실패 기록"), f("push:sw", "10건 → 503", "푸시 10건 모두 503", "bad")], patch: { workers: { w1: "대기", sw: "10건 실패" }, row: row("pending", 2, "5초 (바로)"), calls: 20 } },
          { t: 15, title: "10초, 15초: 똑같이 바로 다시 → 503 (attempts 3, 4)", flows: [f("db:sw", "claim·실패", "claim 두 번 → 실패 기록"), f("push:sw", "20건 → 503", "푸시 20건 모두 503", "bad")], patch: { workers: { w1: "대기", sw: "20건 실패" }, row: row("pending", 4, "15초 (바로)"), calls: 40 } },
          { t: 20, title: "20초: attempts 5 → 503 → 상한에 닿아 10행 모두 failed", flows: [f("db:sw", "failed", "attempts 5 → failed ×10", "bad"), f("push:sw", "10건 → 503", "푸시 10건 모두 503", "bad")], patch: { workers: { w1: "대기", sw: "포기" }, strip: "ffffffffff", row: row("failed", 5, "null"), calls: 50 } },
          { t: 180, title: "180초: FCM 이 살아났다. 하지만 스케줄러가 가져갈 행이 없다", flows: [f("db:sw", "claim 0", "claim → 0행")], patch: { fcm: ["정상", "ok"], workers: { w1: "대기", sw: "가져갈 행 없음" } } },
          { t: 200, title: "10명 모두 못 받음. 장애가 시작되고 20초 만에 포기했다", flows: [], focus: ["phones"], note: "이웃 휴대폰: 알림 없음", patch: { workers: { w1: "대기", sw: "5초마다 확인" } } },
        ],
        segs: [["fcm", 0, 180, "down", "503"], ["w1", 0, 0, "fail"], ["sw", 5, 5, "fail"], ["sw", 10, 10, "fail"], ["sw", 15, 15, "fail"], ["sw", 20, 20, "fail", "포기"]],
        expect: { calls: 50, reached: 0, dup: 0, missed: 10, expired: 0, stale: 0 },
      },
      after: {
        name: "나 · 지수 백오프 (5 · 10 · 20 · 40초, 최대 60초)", rule: "실패하면 next_attempt_at = 지금 + 백오프",
        stages: [
          { t: 0, title: "리스너 1 → PostgreSQL: 10행 claim (attempts 1) → FCM 10건 → 503 → next_attempt_at = 5초", flows: [f("db:w1", "claim·실패", "claim → 실패 기록, next = +5초"), f("push:w1", "10건 → 503", "푸시 10건 모두 503", "bad")], patch: { fcm: ["장애 503", "down"], workers: { w1: "10건 실패", sw: "5초마다 확인" }, strip: "wwwwwwwwww", row: row("pending", 1, "5초"), calls: 10 } },
          { t: 5, title: "5초: 스케줄러 → PostgreSQL claim (attempts 2) → 503 → next_attempt_at = 15초 (10초 뒤)", flows: [f("db:sw", "claim·실패", "claim (attempts 2) → next = +10초"), f("push:sw", "10건 → 503", "푸시 10건 모두 503", "bad")], patch: { workers: { w1: "대기", sw: "10건 실패" }, row: row("pending", 2, "15초"), calls: 20 } },
          { t: 35, title: "15초, 35초: attempts 3, 4 → 503 → next_attempt_at = 35초, 75초 (20초, 40초 뒤)", flows: [f("db:sw", "claim·실패", "claim 두 번 → next = +20초, +40초"), f("push:sw", "20건 → 503", "푸시 20건 모두 503", "bad")], patch: { workers: { w1: "대기", sw: "20건 실패" }, row: row("pending", 4, "75초"), calls: 40 } },
          { t: 135, title: "75초, 135초: attempts 5, 6 → 503 → 간격이 최대 60초에 닿아 next_attempt_at = 135초, 195초", flows: [f("db:sw", "claim·실패", "claim 두 번 → next = +60초 (최대)"), f("push:sw", "20건 → 503", "푸시 20건 모두 503", "bad")], patch: { workers: { w1: "대기", sw: "20건 실패" }, row: row("pending", 6, "195초"), calls: 60 } },
          { t: 180, title: "180초: FCM 이 살아났다. 행은 next_attempt_at 인 195초까지 기다린다", flows: [], focus: ["fcm", "db"], note: "스케줄러: 180~190초 claim → 아직 시각이 안 된 행이라 0행", patch: { fcm: ["정상", "ok"], workers: { w1: "대기", sw: "195초까지 대기" } } },
          { t: 195, title: "195초: 스케줄러 → PostgreSQL claim (attempts 7) → FCM 10건 성공 → completed. 장애가 끝나고 15초 뒤에 받았다", flows: [f("db:sw", "claim·완료", "claim (attempts 7) → completed ×10"), f("push:sw", "10건", "푸시 10건 성공"), f("fcm", "10건", "이웃 10명에게 알림")], patch: { workers: { w1: "대기", sw: "10건 보냄" }, strip: "cccccccccc", row: row("completed", 7, "null"), recv: "1111111111", calls: 70 } },
        ],
        segs: [["fcm", 0, 180, "down", "503"], ["w1", 0, 0, "fail"], ["sw", 5, 5, "fail"], ["sw", 15, 15, "fail"], ["sw", 35, 35, "fail"], ["sw", 75, 75, "fail"], ["sw", 135, 135, "fail"], ["sw", 195, 195, "ok", "성공"]],
        expect: { calls: 70, reached: 10, dup: 0, missed: 0, expired: 0, stale: 0 },
      },
    },
  },
  fence: {
    label: "늦게 돌아온 워커",
    lead: "리스너 1이 10행을 가져간 직후 GC 로 35초 멈춥니다. 그사이 리스(30초)가 끝나 스케줄러가 같은 10행을 가져가 보냅니다. 깨어난 리스너 1의 FCM 호출은 끊긴 연결 때문에 실패합니다.",
    unit: "s", axis: { max: 45, ticks: [0, 10, 20, 30, 40] }, focus: 1,
    lanes: { w1: "리스너 1", sw: "스케줄러", fcm: "FCM" },
    ways: {
      before: {
        name: "가 · 펜싱 없음", rule: "UPDATE … WHERE id = ?",
        stages: [
          { t: 0, title: "리스너 1 → PostgreSQL: 10행 claim (attempts 1, 리스 30초까지). 커밋하면 행 잠금은 풀린다", flows: [f("db:w1", "claim 10", "claim → attempts 1 을 받아 둠")], patch: { workers: { w1: "10행 가져감 · attempts 1", sw: "5초마다 확인" }, strip: "rrrrrrrrrr", row: row("processing", 1, "30초") } },
          { t: 30, title: "리스너 1 이 GC 로 멈춘 사이 30초에 리스가 끝난다. DB 에는 이 행을 지키는 잠금이 없다", flows: [], focus: ["app", "db"], note: "리스너 1: GC 멈춤 (0~35초), 행은 리스만으로 지킴", patch: { workers: { w1: "GC 멈춤", sw: "5초마다 확인" } } },
          { t: 31, title: "스케줄러 → PostgreSQL: 리스 지난 10행 claim (attempts 2) → FCM 10건 → completed", flows: [f("db:sw", "claim·완료", "claim (attempts 2) → completed ×10"), f("push:sw", "10건", "푸시 10건"), f("fcm", "10건", "이웃 10명에게 알림")], patch: { workers: { w1: "GC 멈춤", sw: "10건 보냄" }, strip: "cccccccccc", row: row("completed", 2, "null"), recv: "1111111111", calls: 10 } },
          { t: 35, title: "리스너 1 깨어남 → FCM 실패 → PostgreSQL: 실패 기록 WHERE id = ? → 끝난 10행이 pending 으로 되살아남", flows: [f("push:w1", "10건 ×", "푸시 10건, 끊긴 연결로 실패", "bad"), f("db:w1", "실패 기록", "WHERE id = ? → 10행 바뀜, next = 40초", "bad")], patch: { workers: { w1: "남의 행을 실패로 덮어씀", sw: "5초마다 확인" }, strip: "wwwwwwwwww", row: row("pending", 2, "40초"), calls: 20 } },
          { t: 41, title: "40초: 스케줄러 → PostgreSQL claim (attempts 3) → FCM 10건 → completed. 이미 받은 10명이 또 받는다", flows: [f("db:sw", "claim·완료", "claim (attempts 3) → completed ×10"), f("push:sw", "10건", "푸시 10건 (두 번째)", "bad"), f("fcm", "10건", "이웃 10명에게 두 번째 알림")], patch: { workers: { w1: "대기", sw: "10건 또 보냄" }, strip: "cccccccccc", row: row("completed", 3, "null"), recv: "2222222222", calls: 30 } },
        ],
        segs: [["w1", 0, 30, "lease"], ["w1", 0, 35, "gc", "GC 멈춤"], ["w1", 35, 35, "fail", "덮어씀"], ["sw", 30, 31, "send"], ["sw", 40, 41, "send", "또"]],
        expect: { calls: 30, reached: 10, dup: 10, missed: 0, expired: 0, stale: 0 },
      },
      after: {
        name: "나 · 펜싱 토큰 attempts", rule: "UPDATE … WHERE id = ? AND attempts = 내 값",
        stages: [
          { t: 0, title: "리스너 1 → PostgreSQL: 10행 claim (attempts 1, 리스 30초까지). 커밋하면 행 잠금은 풀린다", flows: [f("db:w1", "claim 10", "claim → attempts 1 을 받아 둠")], patch: { workers: { w1: "10행 가져감 · attempts 1", sw: "5초마다 확인" }, strip: "rrrrrrrrrr", row: row("processing", 1, "30초") } },
          { t: 30, title: "리스너 1 이 GC 로 멈춘 사이 30초에 리스가 끝난다. DB 에는 이 행을 지키는 잠금이 없다", flows: [], focus: ["app", "db"], note: "리스너 1: GC 멈춤 (0~35초), 행은 리스만으로 지킴", patch: { workers: { w1: "GC 멈춤", sw: "5초마다 확인" } } },
          { t: 31, title: "스케줄러 → PostgreSQL: 리스 지난 10행 claim (attempts 2) → FCM 10건 → completed (WHERE attempts = 2 → 10행)", flows: [f("db:sw", "claim·완료", "claim (attempts 2) → completed ×10"), f("push:sw", "10건", "푸시 10건"), f("fcm", "10건", "이웃 10명에게 알림")], patch: { workers: { w1: "GC 멈춤", sw: "10건 보냄 · attempts 2" }, strip: "cccccccccc", row: row("completed", 2, "null"), recv: "1111111111", calls: 10 } },
          { t: 35, title: "리스너 1 깨어남 → FCM 실패 → PostgreSQL: 실패 기록 WHERE attempts = 1 → 0행. 내 행이 아니라는 걸 알고 손대지 않는다", flows: [f("push:w1", "10건 ×", "푸시 10건, 끊긴 연결로 실패", "bad"), f("db:w1", "attempts=1 → 0행", "WHERE id = ? AND attempts = 1 → 0행")], patch: { workers: { w1: "0행 · 내 행 아님", sw: "5초마다 확인" }, calls: 20 } },
          { t: 41, title: "40초: 스케줄러가 돌아도 가져갈 행이 없다. 10명 모두 한 번씩", flows: [f("db:sw", "claim 0", "claim → 0행")], patch: { workers: { w1: "대기", sw: "가져갈 행 없음" } } },
        ],
        segs: [["w1", 0, 30, "lease"], ["w1", 0, 35, "gc", "GC 멈춤"], ["w1", 35, 35, "ok", "0행"], ["sw", 30, 31, "send"]],
        expect: { calls: 20, reached: 10, dup: 0, missed: 0, expired: 0, stale: 0 },
      },
    },
  },
  late: {
    label: "너무 늦은 알림",
    lead: "09:00 에 글이 올라왔는데 OutboxRelay 가 1시간 동안 죽어 있었습니다. 10:00 에 릴레이가 살아나 메시지를 보냅니다. \"새 글\" 알림의 유효 시간은 10분입니다.",
    unit: "clock", axis: { max: 75, ticks: [0, 10, 20, 30, 40, 50, 60, 70] }, focus: 1,
    lanes: { relay: "OutboxRelay", w1: "리스너 1", valid: "알림 유효" },
    ways: {
      before: {
        name: "가 · 기준 = inbox 행을 만든 시각 created_at", rule: "created_at + 10분 < now 면 버림",
        stages: [
          { t: 0, title: "09:00 글 작성. 글과 outbox 행이 같은 트랜잭션으로 저장된다. OutboxRelay 는 죽어 있다", flows: [], focus: ["relay"], note: "OutboxRelay: 죽음 · 1시간 동안 발행 못 함", patch: { relay: "죽음" } },
          { t: 60, title: "10:00 릴레이가 살아나 RabbitMQ 로 m 발행 → 리스너 1 이 받는다", flows: [f("pub", "m", "m 발행 (발생 시각은 안 실음)"), f("deliver:w1", "m", "m 전달")], patch: { relay: "m 발행", mq: "m 받음 · ack 전", workers: { w1: "m 받음", sw: "5초마다 확인" } } },
          { t: 60, title: "리스너 1 → PostgreSQL: 10행 INSERT (created_at = 10:00) → 커밋 → ack", flows: [f("db:w1", "INSERT", "INSERT 10행, created_at = 10:00"), f("ack:w1", "ack", "ack")], patch: { relay: "대기", mq: "비어 있음", workers: { w1: "행 10개 · ack", sw: "5초마다 확인" }, strip: "pppppppppp", row: row("pending", 0, "10:00", "10:00 (created_at)") } },
          { t: 60, title: "리스너 1 claim: created_at(10:00) + 10분 > 지금 → 만료 아님 → FCM 10건. 1시간 지난 글이 \"새 글\"로 간다", flows: [f("db:w1", "claim 10", "claim → 만료 아님"), f("push:w1", "10건", "푸시 10건 (1시간 늦음)", "bad"), f("fcm", "10건", "이웃 10명에게 1시간 늦은 알림")], patch: { workers: { w1: "10건 보냄", sw: "5초마다 확인" }, strip: "cccccccccc", row: row("completed", 1, "null", "10:00 (created_at)"), recv: "1111111111", calls: 10, stale: true } },
        ],
        segs: [["relay", 0, 60, "down", "죽음 1시간"], ["relay", 60, 60, "ok", "발행"], ["valid", 0, 10, "valid", "09:00~09:10"], ["valid", 60, 70, "wrong", "created_at 기준"], ["w1", 60, 60, "ok", "보냄"]],
        expect: { calls: 10, reached: 10, dup: 0, missed: 0, expired: 0, stale: 10 },
      },
      after: {
        name: "나 · 기준 = 메시지에 실은 발생 시각 occurredAt", rule: "occurred_at + 10분 < now 면 expired",
        stages: [
          { t: 0, title: "09:00 글 작성. 글과 outbox 행(occurred_at = 09:00)이 같은 트랜잭션으로 저장된다. OutboxRelay 는 죽어 있다", flows: [], focus: ["relay"], note: "OutboxRelay: 죽음 · 1시간 동안 발행 못 함", patch: { relay: "죽음" } },
          { t: 60, title: "10:00 릴레이가 살아나 RabbitMQ 로 m 발행 (occurredAt = 09:00 을 실음) → 리스너 1 이 받는다", flows: [f("pub", "m 09:00", "m 발행 (occurredAt = 09:00)"), f("deliver:w1", "m", "m 전달")], patch: { relay: "m 발행", mq: "m 받음 · ack 전", workers: { w1: "m 받음", sw: "5초마다 확인" } } },
          { t: 60, title: "리스너 1 → PostgreSQL: 10행 INSERT (occurred_at = 09:00) → 커밋 → ack", flows: [f("db:w1", "INSERT", "INSERT 10행, occurred_at = 09:00"), f("ack:w1", "ack", "ack")], patch: { relay: "대기", mq: "비어 있음", workers: { w1: "행 10개 · ack", sw: "5초마다 확인" }, strip: "pppppppppp", row: row("pending", 0, "10:00", "09:00") } },
          { t: 60, title: "리스너 1 claim: occurred_at(09:00) + 10분 < 지금 → 10행을 expired 로 기록하고 FCM 은 부르지 않는다", flows: [f("db:w1", "expired 10", "claim → 만료 → expired ×10")], patch: { workers: { w1: "10행 버림 (expired)", sw: "5초마다 확인" }, strip: "xxxxxxxxxx", row: row("expired", 0, "null", "09:00") } },
        ],
        segs: [["relay", 0, 60, "down", "죽음 1시간"], ["relay", 60, 60, "ok", "발행"], ["valid", 0, 10, "valid", "09:00~09:10"], ["w1", 60, 60, "fail", "expired"]],
        expect: { calls: 0, reached: 0, dup: 0, missed: 0, expired: 10, stale: 0 },
      },
    },
  },
};

/** 단계마다 그때까지 쌓인 상태 */
export function timeline(stages) {
  let s = { ...INIT };
  return stages.map((st) => (s = { ...s, ...st.patch }));
}

/** 결과: FCM 요청, 받은 이웃, 두 번 받음, 못 받음, 버림(expired), 늦게 받음 */
export function outcome(stages) {
  const end = timeline(stages).at(-1);
  const got = [...end.recv].map(Number), strip = [...end.strip];
  const reached = got.filter((n) => n > 0).length;
  const expired = strip.filter((c) => c === "x").length;
  return {
    calls: end.calls, reached, dup: got.filter((n) => n >= 2).length,
    missed: got.filter((n, i) => n === 0 && strip[i] !== "x").length, expired, stale: end.stale ? reached : 0,
  };
}
