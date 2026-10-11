/*
  The cluster, rendered two ways.

  AMBIENT — scenery. Nodes sit in the margins, dimmed as they pass behind the
  reading column, carrying only a faint id. This is a personal site first: if the
  background competes with the text it has failed.

  FOCUS — the page dims back and the same nodes glide into a real ring, at full
  size, labelled, clickable. Not a different view of the cluster; the same one,
  brought forward.

  A single eased `focusT` (0..1) blends between the two, so the transition is a
  continuous motion rather than a swap.
*/

const COLOR = {
  leader:    [65, 190, 110],
  follower:  [76, 141, 245],
  candidate: [224, 166, 42],
  crashed:   [229, 72, 77],
  learner:   [154, 124, 245]
};

const NODE_ALPHA = 0.70;
const EDGE_ALPHA = 0.07;
const PACKET_ALPHA = 0.5;
const PANEL_W = 340;        // the focus-mode side panel, kept clear of the ring
const MONO = '11px "JetBrains Mono", ui-monospace, monospace';

function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
function lerp(a, b, t) { return a + (b - a) * t; }

function colorFor(n) {
  if (n.crashed) return COLOR.crashed;
  if (n.isLearner) return COLOR.learner;
  if (n.state === "leader") return COLOR.leader;
  if (n.state === "candidate") return COLOR.candidate;
  return COLOR.follower;
}

function roleFor(n) {
  if (n.crashed) return "CRASHED";
  if (n.isLearner) return "CATCHING UP";
  return n.state.toUpperCase();
}

export function mountAmbient(cluster, opts = {}) {
  const reduced = opts.reduced;
  const canvas = document.createElement("canvas");
  canvas.className = "ambient";
  canvas.setAttribute("aria-hidden", "true");
  document.body.insertBefore(canvas, document.body.firstChild);
  const ctx = canvas.getContext("2d");

  let W = 0, H = 0, dpr = 1;
  let focusT = 0, focusTarget = 0;
  let lastPositions = {};      // for hit-testing clicks in focus mode

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    // Measure the canvas itself, not window.innerWidth — innerWidth includes
    // the scrollbar, which would make the canvas overflow the page.
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });

  // Per-node drift parameters, created lazily so added nodes join smoothly.
  const PHASE_MOD = 997;
  const drift = new Map();
  function driftFor(id) {
    let d = drift.get(id);
    if (!d) {
      const seed = id.charCodeAt(id.length - 1) * 7919;
      d = {
        f1: 0.00013 + (seed % 7) * 0.000017,
        f2: 0.00011 + (seed % 5) * 0.000019,
        p1: (seed % PHASE_MOD) / PHASE_MOD * Math.PI * 2,
        p2: ((seed * 3) % PHASE_MOD) / PHASE_MOD * Math.PI * 2
      };
      drift.set(id, d);
    }
    return d;
  }

  const narrowNow = () => W < 620;

  /* Scenery placement: left and right margins, never above the text column. */
  function marginPos(i, total) {
    const narrow = narrowNow();
    const side = i % 2 === 0 ? -1 : 1;
    const tier = Math.floor(i / 2);
    const tiers = Math.max(1, Math.ceil(total / 2));
    const yFrac = tiers === 1 ? 0.5 : 0.20 + (tier / (tiers - 1)) * 0.60;
    const xFrac = (narrow ? 0.42 : 0.34) + ((i * 0.041) % 0.12);
    return [W / 2 + side * xFrac * W, H * yFrac];
  }

  /* Focus placement: an honest ring, offset to leave the side panel clear. */
  function ringPos(i, total) {
    const narrow = narrowNow();
    // On a phone the panel is a bottom sheet, so the ring has to sit in the
    // upper band or the lower nodes end up behind it, labels and all.
    const panel = narrow ? 0 : PANEL_W;
    const cx = (W - panel) / 2;
    const cy = narrow ? H * 0.27 : H / 2 - 10;
    const r = narrow
      ? Math.min(W * 0.29, H * 0.17)
      : Math.min((W - panel) * 0.34, (H - 150) * 0.40);
    const a = -Math.PI / 2 + (i / total) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  }

  function positionOf(id, i, total, t) {
    const d = driftFor(id);
    const [mx, my] = marginPos(i, total);
    const [rx, ry] = ringPos(i, total);
    const wander = (narrowNow() ? 14 : 30) * (1 - focusT);
    return [
      lerp(mx, rx, focusT) + Math.sin(t * d.f1 + d.p1) * wander,
      lerp(my, ry, focusT) + Math.cos(t * d.f2 + d.p2) * wander
    ];
  }

  /* Fade anything drifting behind the reading column — irrelevant once the page
     itself has dimmed, so it relaxes as focus takes over. */
  function clearance(x) {
    const half = Math.min(400, W / 2);
    const dist = Math.abs(x - W / 2);
    const amb = Math.max(0, Math.min(1, (dist - half * 0.55) / (half * 0.6)));
    return lerp(amb, 1, focusT);
  }

  function glow(x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(0.45, rgba(color, alpha * 0.32));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function render(s, worldOpacity) {
    // ease toward the current mode
    if (reduced && reduced.matches) focusT = focusTarget;
    else focusT += (focusTarget - focusT) * 0.14;
    if (Math.abs(focusTarget - focusT) < 0.002) focusT = focusTarget;

    ctx.clearRect(0, 0, W, H);
    if ((worldOpacity <= 0.01 && focusT === 0) || !s.nodes.length) return;

    const t = reduced && reduced.matches ? 0 : performance.now();
    const narrow = narrowNow();
    const total = s.nodes.length;
    const pos = {};
    const idx = {};
    s.nodes.forEach((n, i) => {
      pos[n.id] = positionOf(n.id, i, total, t);
      idx[n.id] = i;
    });
    lastPositions = pos;

    const voters = s.nodes.filter(n => n.isVoter);
    const up = voters.filter(n => !n.crashed).length;
    const healthy = voters.length ? up >= Math.floor(voters.length / 2) + 1 : true;
    const health = healthy ? 1 : 0.45;
    const O = Math.max(worldOpacity, focusT) * lerp(health, 1, focusT * 0.7);

    // Brought forward, everything gets more presence.
    const boost = 1 + focusT * 1.1;
    const edgeA = EDGE_ALPHA * (1 + focusT * 3.2);

    // edges
    ctx.lineWidth = 1 + focusT * 0.5;
    for (let i = 0; i < s.nodes.length; i++) {
      for (let j = i + 1; j < s.nodes.length; j++) {
        const a = s.nodes[i], b = s.nodes[j];
        if (a.crashed || b.crashed) continue;
        if (!cluster.net.connected(a.id, b.id)) continue;
        const [ax, ay] = pos[a.id], [bx, by] = pos[b.id];
        const ca = clearance(ax), cb = clearance(bx);
        const cm = clearance((ax + bx) / 2);
        if (ca <= 0.02 && cb <= 0.02 && cm <= 0.02) continue;
        const grad = ctx.createLinearGradient(ax, ay, bx, by);
        grad.addColorStop(0, `rgba(150,170,200,${edgeA * ca * O})`);
        grad.addColorStop(0.5, `rgba(150,170,200,${edgeA * cm * O})`);
        grad.addColorStop(1, `rgba(150,170,200,${edgeA * cb * O})`);
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    // in-flight messages — real heartbeats and votes, not decoration
    const showPackets = !(reduced && reduced.matches) && (!narrow || focusT > 0.5);
    if (showPackets) {
      for (const p of s.packets) {
        if (idx[p.from] === undefined || idx[p.to] === undefined) continue;
        const [ax, ay] = pos[p.from], [bx, by] = pos[p.to];
        const x = ax + (bx - ax) * p.progress;
        const y = ay + (by - ay) * p.progress;
        const vis = clearance(x);
        if (vis <= 0.02) continue;
        const c = p.type.startsWith("RequestVote") ? COLOR.learner : COLOR.follower;
        const a = PACKET_ALPHA * vis * O * (p.type.endsWith("Resp") ? 0.5 : 1);
        glow(x, y, 10 * boost, c, a * 0.5);
        ctx.fillStyle = rgba(c, a);
        ctx.beginPath();
        ctx.arc(x, y, 2.3 * boost, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // nodes
    ctx.textAlign = "center";
    for (const n of s.nodes) {
      const [x, y] = pos[n.id];
      const vis = clearance(x);
      if (vis <= 0.02) continue;
      const c = colorFor(n);
      const a = NODE_ALPHA * vis * O * (n.crashed ? 0.55 : 1);
      const dotR = (narrow ? (n.state === "leader" ? 5.4 : 4.4)
                           : (n.state === "leader" ? 7 : 5.6)) * boost;

      if (n.state === "leader" && !n.crashed && !(reduced && reduced.matches)) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.0022);
        glow(x, y, (38 + pulse * 16) * boost, c, a * 0.16);
      }
      glow(x, y, (narrow ? 19 : 26) * boost, c, a * 0.30);

      // a ring around the dot reads as "node" rather than "speck", and gives
      // the leader an outline you can pick out instantly
      if (focusT > 0.01) {
        ctx.strokeStyle = rgba(c, a * 0.5 * focusT);
        ctx.lineWidth = n.state === "leader" ? 2 : 1.2;
        ctx.beginPath();
        ctx.arc(x, y, dotR + 9 + focusT * 7, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = rgba(c, a);
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fill();

      // Labels. A faint id in the margins; the full story once brought forward.
      const labelY = y + dotR + 16 + focusT * 6;
      if (!narrow || focusT > 0.3) {
        ctx.font = MONO;
        ctx.fillStyle = rgba(c, a * lerp(0.42, 1, focusT));
        ctx.fillText(n.id, x, labelY);
      }
      if (focusT > 0.05) {
        ctx.fillStyle = `rgba(121,130,143,${a * focusT})`;
        ctx.fillText(roleFor(n), x, labelY + 14);
        ctx.fillStyle = `rgba(76,84,95,${a * focusT})`;
        // the full line runs off a 360px phone, so narrow gets the short form
        ctx.fillText(narrow
          ? `t${n.term} · ${n.commitIndex}/${n.lastIndex}`
          : `term ${n.term} · log ${n.lastIndex} · commit ${n.commitIndex}`,
          x, labelY + 27);
      }
    }
  }

  /* Which node is under this point? Used for click-to-crash in focus mode. */
  function hitTest(px, py) {
    let best = null, bestDist = 34;
    for (const id in lastPositions) {
      const [x, y] = lastPositions[id];
      const d = Math.hypot(px - x, py - y);
      if (d < bestDist) { bestDist = d; best = id; }
    }
    return best;
  }

  return {
    render,
    setFocus(on) { focusTarget = on ? 1 : 0; },
    hitTest,
    canvas
  };
}
