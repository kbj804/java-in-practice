// 매 프레임 다시 그리는 부품. 빌드와 페이지가 같은 함수를 쓴다(페이지에는 export 를 떼고 인라인).
export function makeParts(k, P) {
  const at = (point) => k.iso(point, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const D = (points, style) => k.dotsSvg(points, style);

  const STATIONS = [-30, 40];
  const SPIKE_Y = 56;
  const SPIKE_TOP = 42;
  const SLOT_Z = (index) => 8 + index * 6;
  const spikeX = (thread) => STATIONS[thread] - 8;

  // 주문서 꽂이: 꼬챙이를 주문서 사이사이로 잘라 그려서, 위 주문서가 아래 꼬챙이를 가리게 한다.
  function stack(thread, tickets, lit) {
    const sx = spikeX(thread);
    const mine = tickets
      .filter((ticket) => ticket.thread === thread && ticket.presence > 0.01)
      .map((ticket) => ({ ...ticket, z: SLOT_Z(tickets.filter((other) => other.thread === thread).indexOf(ticket)) + ticket.lift }))
      .sort((a, b) => a.z - b.z);
    const out = [];
    let from = 6;
    for (const ticket of mine) {
      if (ticket.z > from + 0.05 && from < SPIKE_TOP) out.push(S(k.cylinder(sx, SPIKE_Y, 0.8, from, Math.min(ticket.z, SPIKE_TOP) - from, P, 12), { tone: "hi", crease: "none" }));
      const plan = { x: sx - 7, y: SPIKE_Y - 7, w: 14, d: 14, r: 1 };
      const top = ticket.z + 0.8;
      const lines = [3, 6, 9].map((dy, index) => k.lineOnTop([plan.x + 2.5, plan.y + dy], [plan.x + (index === 1 ? 8 : 11), plan.y + dy], top, P)).join("");
      out.push(
        `<g style="opacity:${ticket.presence.toFixed(3)}">` +
          S(k.slabOf(plan, ticket.z, 0.8, P, 3), { tone: "hi", crease: "lo", lit: lit && ticket.alive && ticket === mine[mine.length - 1] }) +
          L(lines, { tone: "lo", free: true }) +
          L(k.ring(sx, SPIKE_Y, 1.3, top, P, 12), { tone: "lo" }) +
          D([at([plan.x + plan.w - 2, plan.y + plan.d - 2, top])], { size: 0.55, tone: "hi" }) +
          `</g>`,
      );
      from = Math.max(from, top);
    }
    if (from < SPIKE_TOP) out.push(S(k.cylinder(sx, SPIKE_Y, 0.8, from, SPIKE_TOP - from, P, 12), { tone: "hi", crease: "none" }));
    out.push(D([at([sx, SPIKE_Y, SPIKE_TOP])], { size: 0.6, tone: "hi" }));
    return out.join("");
  }

  // 주문서 위 끈이 묶이는 점.
  function ticketAnchor(ticket, tickets) {
    const sx = spikeX(ticket.thread);
    const z = SLOT_Z(tickets.filter((other) => other.thread === ticket.thread).indexOf(ticket)) + ticket.lift + 0.8;
    return [sx + 5, SPIKE_Y + 5, z];
  }

  // 클래스 로더 리프트: 기둥을 운반대 위아래로 잘라 그린다.
  const LIFT = { x: -118, y: -63 };
  const SHELF_Z = [10, 38, 66];
  const LIFT_TOP = 100;
  function lift(level, lit) {
    const z = SHELF_Z[0] + 8 + (SHELF_Z[1] - SHELF_Z[0]) * level;
    const carriage = { x: LIFT.x - 5, y: LIFT.y - 6, w: 10, d: 12, r: 1.5 };
    return [
      S(k.cylinder(LIFT.x, LIFT.y, 1.6, 3, z - 3, P, 16), { tone: "mid", crease: "none" }),
      S(k.slabOf(carriage, z, 4, P, 3, 0.4), { tone: "hi", crease: "lo", lit }),
      L(k.ring(LIFT.x, LIFT.y, 2.4, z + 4, P, 16), { tone: "lo" }),
      D([at([carriage.x + 2, carriage.y + carriage.d - 2, z + 4]), at([carriage.x + carriage.w - 2, carriage.y + carriage.d - 2, z + 4])], { size: 0.45 }),
      S(k.cylinder(LIFT.x - 3.2, LIFT.y + 3.6, 1.1, z + 4, 1.2, P, 12), { tone: "hi" }),
      S(k.cylinder(LIFT.x, LIFT.y, 1.6, z + 4, LIFT_TOP - z - 4, P, 16), { tone: "mid", crease: "none" }),
    ].join("");
  }

  // Method Area 서랍: 열린 만큼만 캐비닛 밖으로 나온 부분을 그린다.
  const DRAWER = { x: -99, front: -50, z0: 30, z1: 41 };
  function drawer(open) {
    const out = open * 12;
    const plan = { x: DRAWER.x, y: DRAWER.front, w: 40, d: 1.6 + out, r: 0.6 };
    const h = DRAWER.z1 - DRAWER.z0;
    const parts = [S(k.slabOf(plan, DRAWER.z0, h, P, 3, 0.3), { tone: "mid" })];
    if (out > 3) {
      const rim = { x: plan.x + 1.4, y: plan.y + 0.6, w: plan.w - 2.8, d: out - 0.4, r: 0.4 };
      parts.push(L(k.planOutline(rim, DRAWER.z1, P, 3), { tone: "faint" }));
      const cards = [6, 12, 18, 24, 30].filter((dx) => dx < rim.w - 2).map((dx) => k.lineOnTop([rim.x + dx, rim.y], [rim.x + dx, rim.y + rim.d], DRAWER.z1, P)).join("");
      parts.push(L(cards, { tone: "lo" }));
    }
    const front = plan.y + plan.d;
    const pull = { x: DRAWER.x + 16, y: front, w: 8, d: 1.2, r: 0.5 };
    parts.push(S(k.slabOf(pull, (DRAWER.z0 + DRAWER.z1) / 2 - 0.7, 1.4, P, 2), { tone: "mid", crease: "none" }));
    const holder = { x: DRAWER.x + 3, y: front, w: 8, d: 0.6, r: 0.2 };
    parts.push(S(k.slabOf(holder, DRAWER.z0 + 3, 4, P, 2), { tone: "lo", crease: "none" }));
    return parts.join("");
  }

  // 호출 횟수 다이얼 바늘.
  const DIAL = { x: 129, y: 42, r: 13, top: 35 };
  const SPAN = 0.8;
  function needle(calls, max) {
    const angle = -Math.PI * SPAN + (calls / max) * Math.PI * 2 * SPAN;
    return k.lineOnTop([DIAL.x - Math.sin(angle) * 3, DIAL.y + Math.cos(angle) * 3], [DIAL.x + Math.sin(angle) * (DIAL.r - 4), DIAL.y - Math.cos(angle) * (DIAL.r - 4)], DIAL.top + 0.2, P);
  }

  // 끈(참조): 붙잡는 쪽에서 접시 위까지, 조리대 위로 살짝 띄워서.
  function wire(from, to) {
    // 3차 베지어: 출발점 바로 위로 올라갔다가 접시 바로 위에서 내려온다. 조리대 모서리를 뚫지 않는다.
    const lift = Math.max(from[2], to[2]) + 10;
    const c1 = [from[0], from[1], lift];
    const c2 = [to[0], to[1], lift];
    const points = [];
    for (let i = 0; i <= 20; i++) {
      const s = i / 20, r = 1 - s;
      const w = [r * r * r, 3 * r * r * s, 3 * r * s * s, s * s * s];
      points.push(at([0, 1, 2].map((axis) => w[0] * from[axis] + w[1] * c1[axis] + w[2] * c2[axis] + w[3] * to[axis])));
    }
    return { d: k.pathOf(points), from: points[0], to: points[points.length - 1] };
  }

  return { stack, ticketAnchor, lift, drawer, needle, wire, STATIONS, SPIKE_Y, SHELF_Z, LIFT, DRAWER, DIAL, SPAN };
}
