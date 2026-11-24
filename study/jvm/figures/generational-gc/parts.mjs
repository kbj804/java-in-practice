// 매 프레임 다시 그리는 부품. 빌드와 페이지가 같은 함수를 쓴다(페이지에는 export 를 떼고 인라인).
export function makeParts(k, P, M) {
  const at = (point) => k.iso(point, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const D = (points, style) => k.dotsSvg(points, style);

  // 접시: 받침 + 그릇, 그 위에 나이만큼 얇은 스티커 고리가 쌓인다(Minor GC 를 한 번 넘길 때마다 하나).
  function dish([x, y, z], age = 0, lit = false) {
    const out = [
      S(k.cylinder(x, y, 3.6, z, 0.8, P, 28, 0.25), { tone: "hi", crease: "lo" }),
      S(k.cylinder(x, y, 2.6, z + 0.8, M.BOWL_TOP - 0.8, P, 24), { tone: "hi", crease: "lo", lit }),
      L(k.ring(x, y, 1.7, z + M.BOWL_TOP, P, 18), { tone: "faint" }),
    ];
    return out.join("") + rings([x, y, z], age, lit);
  }
  // 나이 고리. faded 는 Old 로 승격된 접시: 나이 비트는 남아 있지만 더 세지 않으므로,
  // 고리를 쌓지 않고 납작한 흐린 뚜껑 하나로 눌러 둔다(Old 선반이 촘촘해서 높은 고리 탑은 읽히지 않는다).
  function rings([x, y, z], age, lit = false, faded = false) {
    if (!age) return "";
    if (faded) {
      return `<g opacity=".55">${S(k.cylinder(x, y, 2.1, z + M.BOWL_TOP, M.RING_H, P, 20), { tone: "lo", crease: "lo" })}${D([at([x, y, z + M.BOWL_TOP + M.RING_H])], { size: 0.5, tone: "lo" })}</g>`;
    }
    const out = [];
    for (let i = 0; i < age; i++) {
      out.push(S(k.cylinder(x, y, 2.1, z + M.BOWL_TOP + i * M.RING_H, M.RING_H, P, 20), { tone: i % 5 === 4 ? "mid" : "hi", crease: "lo", lit: lit && i === age - 1 }));
    }
    out.push(D([at([x, y, z + M.BOWL_TOP + age * M.RING_H])], { size: 0.5, tone: "hi" }));
    return out.join("");
  }

  // 주문서 꽂이(요리사 = 스레드). 꼬챙이를 주문서 사이사이로 잘라 그린다.
  const STATIONS = [-146, -82];
  const SPIKE_Y = 56;
  const SPIKE_TOP = 40;
  const SLOT_Z = (index) => 8 + index * 6;
  const spikeX = (thread) => STATIONS[thread] - 8;
  const slotOf = (ticket, tickets) => tickets.filter((other) => other.thread === ticket.thread).indexOf(ticket);
  function stack(thread, tickets, lit) {
    const sx = spikeX(thread);
    const mine = tickets
      .filter((ticket) => ticket.thread === thread && ticket.presence > 0.01)
      .map((ticket) => ({ ...ticket, z: SLOT_Z(slotOf(ticket, tickets)) + ticket.lift }))
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
  function ticketAnchor(ticket, tickets) {
    const sx = spikeX(ticket.thread);
    return [sx + 5, SPIKE_Y + 5, SLOT_Z(slotOf(ticket, tickets)) + ticket.lift + 0.8];
  }

  // 끈(참조): 붙잡는 쪽에서 접시 위까지, 위로 솟았다가 내려오는 3차 곡선.
  function wire(from, to) {
    const lift = Math.max(from[2], to[2]) + 12;
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

  // 멈춤 스톱워치 바늘: 0 ~ 100ms.
  const WATCH = { x: -6, y: 52, r: 12, top: 30, max: 100 };
  const SPAN = 0.8;
  function needle(ms) {
    const angle = -Math.PI * SPAN + Math.min(ms / WATCH.max, 1) * Math.PI * 2 * SPAN;
    const { x, y, r, top } = WATCH;
    return k.lineOnTop([x - Math.sin(angle) * 3, y + Math.cos(angle) * 3], [x + Math.sin(angle) * (r - 4), y - Math.cos(angle) * (r - 4)], top + 0.2, P);
  }

  // 나이 게이지: 기둥 위를 오르내리는 표시 고리. 높이 = 임계값만큼 쌓인 고리의 높이.
  const GAUGE = { x: -30, y: -31 };
  const gaugeZ = (age) => M.TABLE_TOP + M.BOWL_TOP + age * M.RING_H;
  function marker(age, lit) {
    const z = gaugeZ(age) - 0.6;
    // 양쪽 선반 위로 뻗은 팔: 접시 고리 꼭대기가 이 높이에 닿으면 승격.
    const arm = { x: GAUGE.x - 13, y: GAUGE.y - 0.5, w: 26, d: 1, r: 0.4 };
    const collar = { x: GAUGE.x - 2.4, y: GAUGE.y - 2.4, w: 4.8, d: 4.8, r: 1.2 };
    return [
      S(k.slabOf(arm, z + 0.2, 0.8, P, 2), { tone: "hi", crease: "lo", lit }),
      S(k.slabOf(collar, z, 1.2, P, 3, 0.2), { tone: "hi", crease: "lo", lit }),
      L(k.ring(GAUGE.x, GAUGE.y, 1.1, z + 1.2, P, 12), { tone: "lo" }),
    ].join("");
  }

  return { dish, rings, stack, ticketAnchor, wire, needle, marker, gaugeZ, STATIONS, SPIKE_Y, WATCH, SPAN, GAUGE };
}
