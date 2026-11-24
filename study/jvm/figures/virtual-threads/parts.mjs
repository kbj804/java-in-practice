// 매 프레임 다시 그리는 부품. 빌드와 페이지가 같은 함수를 쓴다(페이지에는 export 를 떼고 인라인).
export function makeParts(k, P, M) {
  const at = (point) => k.iso(point, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const D = (points, style) => k.dotsSvg(points, style);

  // 작업(가상 스레드) 하나: 원판 위에 스택 프레임 판이 쌓인다.
  // pinned 는 프레임을 두른 고리(synchronized 모니터), waiting 은 꼭대기에서 깜박이는 점(I/O 를 기다리는 중).
  const PUCK_H = 1.8;
  const FRAME_H = 1.5;
  function token({ at: [x, y, z], lit, waiting, pinned, tracked, dim }) {
    const out = [];
    if (tracked) out.push(L(k.ring(x, y, 7.2, z + 0.05, P, 32), { tone: "hi" }));
    out.push(S(k.cylinder(x, y, 5, z, PUCK_H, P, 32, 0.3), { tone: dim ? "lo" : "hi", crease: "lo", lit: lit && !waiting }));
    out.push(L(k.ring(x, y, 4.3, z + PUCK_H, P, 24), { tone: "faint" }));
    let top = z + PUCK_H;
    for (let f = 0; f < M.FRAMES; f++) {
      const w = 7.4 - f * 1.1;
      const plan = { x: x - w / 2, y: y - w / 2, w, d: w, r: 0.5 };
      out.push(S(k.slabOf(plan, top, FRAME_H - 0.2, P, 2, 0.15), { tone: dim ? "lo" : f === M.FRAMES - 1 ? "hi" : "mid", crease: "lo", lit: lit && !waiting && f === M.FRAMES - 1 }));
      if (pinned && f === 0) {
        // 모니터 고리: 맨 아래 프레임 높이를 두른다. 위 프레임은 고리 안쪽 위에 놓이므로 고리 다음에 그린다.
        out.push(S(k.cylinder(x, y, 5.9, top, FRAME_H, P, 32, 0.2), { tone: "mid", crease: "lo", lit: waiting }));
        out.push(L(k.ring(x, y, 5.0, top + FRAME_H, P, 28), { tone: "lo" }));
      }
      top += FRAME_H;
    }
    out.push(D([at([x, y, top])], { size: 0.45, tone: dim ? "lo" : "hi" }));
    if (waiting) out.push(D([at([x, y, top + 3])], { size: 1.1, tone: "hi", pulse: true }));
    return out.join("");
  }

  // 레인 앞 표시등: 스레드가 일은 안 하면서 붙잡혀 있을 때(hold, pin) 켜진다.
  function lamp(side, kIndex, on) {
    const x = M.LANE_X[side][kIndex] + M.LANE_W / 2;
    const y = M.LANE_Y + M.LANE_D - 7;
    return [
      S(k.cylinder(x, y, 2.4, M.LANE_TOP, 1, P, 20, 0.2), { tone: "mid", crease: "lo" }),
      S(k.cylinder(x, y, 1.5, M.LANE_TOP + 1, 1.6, P, 16, 0.4), { tone: on ? "hi" : "lo", crease: "lo", lit: on }),
      D([at([x, y, M.LANE_TOP + 2.6])], { size: on ? 0.9 : 0.4, tone: on ? "hi" : "lo", pulse: on }),
    ].join("");
  }

  // 커넥션 플러그: 쥐고 있으면 솟아 켜진다.
  function plug(s, used) {
    const [x, y, z] = M.plugAt(s);
    return [
      S(k.cylinder(x, y, 2.6, z - 1.4, 1.4 + (used ? 1.2 : 0), P, 20, 0.3), { tone: used ? "hi" : "mid", crease: "lo", lit: used }),
      L(k.ring(x, y, 1.2, z + (used ? 1.2 : 0), P, 12), { tone: "lo" }),
    ].join("");
  }

  return { token, lamp, plug, PUCK_H, FRAME_H };
}
