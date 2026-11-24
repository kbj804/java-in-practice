// 매 프레임 다시 그리는 부품. 빌드와 페이지가 같은 함수를 쓴다(페이지에는 export 를 떼고 인라인).
export function makeParts(k, P, M) {
  const at = (point) => k.iso(point, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const D = (points, style) => k.dotsSvg(points, style);

  // 접시: 받침 + 그릇. 표시되면(살아 있음) 그릇 위에 점이 켜진다.
  function dish([x, y, z], mark = false, lit = false) {
    const out = [
      S(k.cylinder(x, y, 3.6, z, 0.8, P, 28, 0.25), { tone: "hi", crease: "lo" }),
      S(k.cylinder(x, y, 2.6, z + 0.8, M.BOWL_TOP - 0.8, P, 24), { tone: "hi", crease: "lo", lit }),
      L(k.ring(x, y, 1.7, z + M.BOWL_TOP, P, 18), { tone: "faint" }),
    ];
    if (mark) out.push(D([at([x, y, z + M.BOWL_TOP])], { size: 0.95, tone: "hi" }));
    return out.join("");
  }

  // 칸 꼬리표: 칸 앞쪽 모서리의 작은 판, 위에 역할 글자(E·S·O·H, ZGC 는 Y·O).
  const tagPlan = (side, i) => {
    const p = M.tilePlan(side, i);
    return { x: p.x + 1.6, y: p.y + 23.6, w: 6.4, d: 5, r: 0.6 };
  };
  function tag(side, i, role, lit) {
    const plan = tagPlan(side, i);
    const top = M.TILE_TOP + 0.6;
    const out = [S(k.slabOf(plan, M.TILE_TOP, 0.6, P, 2, 0.15), { tone: role ? (lit ? "hi" : "mid") : "lo", crease: "none", lit })];
    if (role) out.push(k.faceTextSvg(k.topMatrix([plan.x + plan.w / 2 - 1.1, plan.y + plan.d / 2 + 1.2], top, P), role, { size: 3.4, tone: lit ? "hi" : "mid" }));
    return out.join("");
  }

  // 방문자 명부(G1 의 칸별 기억 집합): 칸 뒤쪽 모서리의 작은 판과 두 줄.
  function log(side, i, lit) {
    const p = M.tilePlan(side, i);
    const plan = { x: p.x + 24.6, y: p.y + 1.2, w: 4.4, d: 3, r: 0.4 };
    const top = M.TILE_TOP + 0.5;
    return [
      S(k.slabOf(plan, M.TILE_TOP, 0.5, P, 2), { tone: lit ? "hi" : "mid", crease: "none", lit }),
      L([0.9, 2.1].map((dy) => k.lineOnTop([plan.x + 0.8, plan.y + dy], [plan.x + plan.w - 0.8, plan.y + dy], top, P)).join(""), { tone: "lo", free: true }),
    ].join("");
  }

  // 주문서 꽂이(요리사 = 스레드).
  const STATION = { g1: { cx: -172, spike: [-182, 37] }, z: { cx: 44, spike: [32, 37] } };
  const SPIKE_TOP = 30;
  const SLOT_Z = (index) => 8 + index * 6;
  function stack(side, tickets, frozen) {
    const [sx, sy] = STATION[side].spike;
    const out = [];
    let from = 5;
    tickets.forEach((ticket, index) => {
      const z = SLOT_Z(index) + ticket.lift;
      if (z > from + 0.05 && from < SPIKE_TOP) out.push(S(k.cylinder(sx, sy, 0.8, from, Math.min(z, SPIKE_TOP) - from, P, 12), { tone: "hi", crease: "none" }));
      const plan = { x: sx - 6.5, y: sy - 6.5, w: 13, d: 13, r: 1 };
      const top = z + 0.8;
      const lines = [3, 6, 9].map((dy, n) => k.lineOnTop([plan.x + 2.5, plan.y + dy], [plan.x + (n === 1 ? 7.5 : 10.5), plan.y + dy], top, P)).join("");
      out.push(
        `<g style="opacity:${ticket.presence.toFixed(3)}">` +
          S(k.slabOf(plan, z, 0.8, P, 3), { tone: "hi", crease: "lo", lit: frozen && index === tickets.length - 1 }) +
          L(lines, { tone: "lo", free: true }) +
          L(k.ring(sx, sy, 1.3, top, P, 12), { tone: "lo" }) +
          D([at([plan.x + plan.w - 2, plan.y + plan.d - 2, top])], { size: 0.55, tone: "hi" }) +
          `</g>`,
      );
      from = Math.max(from, top);
    });
    if (from < SPIKE_TOP) out.push(S(k.cylinder(sx, sy, 0.8, from, SPIKE_TOP - from, P, 12), { tone: "hi", crease: "none" }));
    out.push(D([at([sx, sy, SPIKE_TOP])], { size: 0.6, tone: "hi" }));
    return out.join("");
  }
  function ticketAnchor(side, id, tickets) {
    const [sx, sy] = STATION[side].spike;
    const index = tickets.findIndex((ticket) => ticket.id === id);
    if (index < 0) return null;
    return [sx + 4.5, sy - 4.5, SLOT_Z(index) + tickets[index].lift + 0.8];
  }

  // 끈(참조): 위로 솟았다가 내려오는 3차 곡선.
  function wire(from, to) {
    const lift = Math.max(from[2], to[2]) + 14;
    const c1 = [from[0], from[1], lift];
    const c2 = [to[0], to[1], lift];
    const points = [];
    for (let i = 0; i <= 24; i++) {
      const s = i / 24, r = 1 - s;
      const w = [r * r * r, 3 * r * r * s, 3 * r * s * s, s * s * s];
      points.push(at([0, 1, 2].map((axis) => w[0] * from[axis] + w[1] * c1[axis] + w[2] * c2[axis] + w[3] * to[axis])));
    }
    return { d: k.pathOf(points), from: points[0], to: points[points.length - 1] };
  }
  // 색 스티커(색깔 포인터): 힙 끈의 출발점에 붙은 구슬. 옛 주소면 속이 빈 고리, 고쳐지면 꽉 찬 구슬.
  function bead(point, stale) {
    const [x, y, z] = point;
    if (stale) return S(k.cylinder(x, y, 1.5, z, 0.9, P, 16), { tone: "lo", crease: "mid" }) + L(k.ring(x, y, 0.7, z + 0.9, P, 12), { tone: "mid" });
    return S(k.cylinder(x, y, 1.5, z, 0.9, P, 16), { tone: "hi", crease: "lo", lit: true }) + D([at([x, y, z + 0.9])], { size: 0.5, tone: "hi" });
  }

  // 멈춤 기록계: 기준선 + 멈춤마다 솟는 자국. 할당 대기는 옅은 톤.
  function trace(side, { pen, marks }) {
    const y0 = M.LANE[side];
    const z = 5.4;
    const out = [];
    const points = [[M.CHART_X[0], y0]];
    const stalls = [];
    for (const mark of marks) {
      if (mark.kind === "stall") { stalls.push(mark); continue; }
      if (mark.h < 0.05) continue;
      points.push([mark.x - 0.8, y0], [mark.x, y0 - mark.h], [mark.x + 0.8, y0]);
    }
    points.push([Math.max(pen, M.CHART_X[0] + 0.1), y0]);
    out.push(L(k.onTop(points, z, P), { tone: "hi" }));
    out.push(D([at([M.CHART_X[0], y0, z])], { size: 0.7, tone: "hi" }));
    // 멈춤 길이가 0 에 가까운 것(ZGC, Remark·Cleanup)은 기준선 위 점으로 남긴다.
    const ticks = marks.filter((mark) => mark.kind !== "stall" && mark.h < 0.05).map((mark) => at([mark.x, y0, z]));
    if (ticks.length) out.push(D(ticks, { size: 0.6, tone: "hi" }));
    for (const mark of stalls) out.push(L(k.onTop([[mark.x - 0.8, y0], [mark.x, y0 - mark.h], [mark.x + 0.8, y0]], z, P), { tone: "mid" }));
    return out.join("");
  }
  function pen(x, tips) {
    const bar = { x: x - 1.4, y: M.PAPER.y - 2, w: 2.8, d: M.PAPER.d + 4, r: 0.6 };
    return [
      S(k.slabOf(bar, 6.6, 1.6, P, 2, 0.2), { tone: "mid", crease: "lo" }),
      ...tips.map(([y, lit]) => S(k.cylinder(x, y, 1, 5.4, 1.2, P, 12), { tone: "hi", crease: "lo", lit })),
      D(tips.map(([y]) => at([x, y, 8.2])), { size: 0.45, tone: "hi" }),
    ].join("");
  }

  // G1 멈춤 목표 다이얼: 0 ~ 240ms, 160(목표의 80%)과 200(목표)에 긴 눈금.
  const DIAL = { x: -124, y: 39, r: 10, top: 14, max: 240 };
  const SPAN = 0.75;
  const angleOf = (ms) => -Math.PI * SPAN + Math.min(ms / DIAL.max, 1) * Math.PI * 2 * SPAN;
  function needle(ms) {
    const a = angleOf(ms);
    const { x, y, r, top } = DIAL;
    return k.lineOnTop([x - Math.sin(a) * 2.4, y + Math.cos(a) * 2.4], [x + Math.sin(a) * (r - 3), y - Math.cos(a) * (r - 3)], top + 0.2, P);
  }

  // ZGC 이사 장부: 오른쪽 쪽에 옮긴 접시마다 한 줄. 지금 찾아본 줄은 켜진다.
  const LEDGER = { x: 118, y: 29, w: 15, d: 16 };
  function ledger(entries) {
    const top = 9.2;
    const out = [];
    entries.forEach((entry, n) => {
      const y = LEDGER.y + 2.6 + n * 2.6;
      const len = [10, 8, 11, 7, 9][n % 5];
      out.push(L(k.lineOnTop([LEDGER.x + 2, y], [LEDGER.x + 2 + len, y], top, P), { tone: entry.lit ? "hi" : "mid", free: true }));
      if (entry.lit) out.push(D([at([LEDGER.x + 1, y, top])], { size: 0.55, tone: "hi" }));
    });
    return out.join("");
  }

  return { dish, tag, log, stack, ticketAnchor, wire, bead, trace, pen, needle, ledger, angleOf, STATION, DIAL, SPAN, LEDGER, SPIKE_TOP };
}
