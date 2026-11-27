// 2단계 그림의 모델: PoolExhaustionExperimentTest 와 같은 조건을 시간 순서로 계산한다.
// 요청 20개가 동시에 들어오고, 커넥션 풀 3개, 커넥션 대기 한도 1초, 외부 호출 0.5초, 쿼리 10ms.
// 커넥션은 먼저 기다린 요청부터 받는다(FIFO). 대기 한도를 넘기면 그 요청은 실패한다.
//
// 요청 상태(hist 의 두 번째 값)
//   tag       커넥션 없이 외부 호출을 기다림
//   cwait     커넥션을 기다림
//   holdtag   커넥션을 쥔 채 외부 호출을 기다림 (나쁜 버전에서만)
//   query     커넥션으로 쿼리 실행
//   ok / fail 끝남
export const SETUP = { requests: 20, pool: 3, timeout: 1.0, external: 0.5, query: 0.01 };

export function simulate(kind, s = SETUP) {
  const inside = kind === "inside";
  const freeAt = Array(s.pool).fill(0);
  const conns = Array.from({ length: s.pool }, () => []); // [from, to, id, kind]
  const reqs = [];
  for (let i = 0; i < s.requests; i++) {
    const id = "R" + (i + 1);
    const hist = [];
    const need = inside ? 0 : s.external; // 커넥션이 필요해지는 시각
    if (!inside) hist.push([0, "tag"]);
    // 가장 먼저 비는 커넥션(같으면 번호가 작은 것)
    const c = freeAt.indexOf(Math.min(...freeAt));
    const start = Math.max(need, freeAt[c]);
    if (start > need) hist.push([need, "cwait"]);
    if (start - need > s.timeout + 1e-9) {
      hist.push([need + s.timeout, "fail"]);
      reqs.push({ id, hist, result: "fail", end: need + s.timeout });
      continue;
    }
    let t = start;
    if (inside) { hist.push([t, "holdtag"]); conns[c].push([t, t + s.external, id, "holdtag"]); t += s.external; }
    hist.push([t, "query"]); conns[c].push([t, t + s.query, id, "query"]); t += s.query;
    hist.push([t, "ok"]);
    freeAt[c] = t;
    reqs.push({ id, hist, conn: c, result: "ok", end: t });
  }
  const end = Math.max(...reqs.map((r) => r.end));
  // 커넥션을 기다리는 요청 수를 5ms 간격으로 샘플링
  const DT = 0.005;
  const waiting = [];
  for (let k = 0; k * DT <= end + 1e-9; k++) waiting.push(reqs.filter((r) => stateAt(r, k * DT) === "cwait").length);
  return {
    reqs, conns, end, dt: DT, waiting,
    ok: reqs.filter((r) => r.result === "ok").length,
    fail: reqs.filter((r) => r.result === "fail").length,
    maxWaiting: Math.max(...waiting),
  };
}

export function stateAt(req, t) {
  let state = req.hist[0][1];
  for (const [at, st] of req.hist) if (at <= t + 1e-9) state = st;
  return req.hist[0][0] > t ? "pend" : state;
}
