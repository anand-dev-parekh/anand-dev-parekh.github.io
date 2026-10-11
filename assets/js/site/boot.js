/*
  The site is a running distributed system.

  One Cluster is created here and lives for the whole visit — it survives
  client-side navigation, so browsing builds a real replicated log. Everything
  else (the ambient canvas, the status bar, the router) is a consumer of it.

  Nothing here gates content. The page is complete in static HTML; this layer
  only adds the world around it.
*/
import { Cluster } from "../raft/cluster.js";
import { mountAmbient } from "./ambient.js";
import { mountStatusBar } from "./statusbar.js";
import { mountRouter, tidyPath } from "./router.js";
import { mountConsole } from "./console.js";

const TICKS_PER_FRAME = 4;   // 1x ≈ 240 ticks/sec at 60fps

/*
  At 1x a message crosses the screen in 30-120ms, which is a blur. The slow
  speeds exist so you can actually follow a single AppendEntries out and its
  response back — at 0.1x that same hop takes about a second.
*/
export const SPEEDS = [
  { label: "pause", mult: 0 },
  { label: "0.1×",  mult: 0.1 },
  { label: "0.25×", mult: 0.25 },
  { label: "0.5×",  mult: 0.5 },
  { label: "1×",    mult: 1 },
  { label: "2×",    mult: 2 }
];
const DEFAULT_SPEED = 4;   // 1x
const FADE_IN_MS = 1100;     // the world builds in around content already painted

function readMode() {
  const q = new URLSearchParams(location.search).get("plain");
  try {
    if (q === "1") { localStorage.setItem("site-plain", "1"); return true; }
    if (q === "0") { localStorage.removeItem("site-plain"); return false; }
    return localStorage.getItem("site-plain") === "1";
  } catch (_) {
    return q === "1";   // private mode / storage disabled
  }
}

export function setPlain(on) {
  try {
    if (on) localStorage.setItem("site-plain", "1");
    else localStorage.removeItem("site-plain");
  } catch (_) { /* nothing we can do */ }
  location.reload();
}

function start() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const plain = readMode();
  document.documentElement.dataset.mode = plain ? "plain" : "world";
  if (plain) return;

  const cluster = new Cluster({ seed: (Math.random() * 1e9) | 0 });
  const consumers = [];

  let speedIndex = DEFAULT_SPEED;
  try {
    const saved = parseInt(localStorage.getItem("site-speed"), 10);
    if (saved >= 0 && saved < SPEEDS.length) speedIndex = saved;
  } catch (_) { /* storage disabled */ }

  const clock = {
    speeds: SPEEDS,
    index: () => speedIndex,
    set(i) {
      speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, i));
      try { localStorage.setItem("site-speed", String(speedIndex)); } catch (_) {}
    }
  };

  const ambient = mountAmbient(cluster, { reduced });
  consumers.push(ambient);

  const drawer = mountConsole(cluster, {
    clock,
    // Focus mode: the page dims back and the same nodes come forward, so the
    // canvas takes clicks and the ring replaces the margin layout.
    onOpenChange(open) {
      ambient.setFocus(open);
      ambient.canvas.style.pointerEvents = open ? "auto" : "none";
    }
  });

  // In focus mode the nodes are the control surface: click one to crash it.
  ambient.canvas.addEventListener("click", e => {
    if (!drawer.isOpen()) return;
    const id = ambient.hitTest(e.clientX, e.clientY);
    if (!id) return;
    const node = cluster.nodes.get(id);
    if (!node) return;
    if (node.crashed) cluster.restart(id); else cluster.crash(id);
  });

  const statusbar = mountStatusBar(cluster, {
    reduced, setPlain,
    onToggle: () => drawer.toggle(),
    isConsoleOpen: () => drawer.isOpen()
  });
  consumers.push(statusbar);
  consumers.push(drawer);
  consumers.push(mountRouter(cluster, { statusbar, reduced }));

  // The first page view becomes the first log entry, once there's a leader.
  let seeded = false;

  // Both the animation loop and the test hook go through here, so the seed
  // can't end up stranded in a code path only one of them runs.
  function advance(n) {
    for (let i = 0; i < n; i++) cluster.tick();
    if (!seeded && cluster.leader()) {
      seeded = true;
      cluster.propose({ op: "get", path: tidyPath(location.pathname, "") });
    }
  }

  // Fractional speeds need an accumulator, or anything below 1 tick per frame
  // would floor to zero and the cluster would simply stop.
  let owed = 0;

  // One animation frame's worth of simulation, at the current speed.
  function frameTick() {
    owed += TICKS_PER_FRAME * SPEEDS[speedIndex].mult;
    const due = Math.floor(owed);
    owed -= due;
    advance(due);
    return due;
  }

  const t0 = performance.now();
  function frame(now) {
    frameTick();

    const snapshot = cluster.snapshot();
    const worldOpacity = reduced.matches
      ? 1
      : Math.min(1, (now - t0) / FADE_IN_MS);

    for (const c of consumers) c.render(snapshot, worldOpacity);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* Handle for the console and for headless tests, where requestAnimationFrame
     is throttled and the loop above would never advance. */
  window.__site = {
    cluster,
    step(n) {
      advance(n || 1);
      const s = cluster.snapshot();
      for (const c of consumers) c.render(s, 1);
    },
    // Like step(), but goes through the speed accumulator — the only way to
    // exercise the speed control where requestAnimationFrame is throttled.
    frames(n) {
      let total = 0;
      for (let i = 0; i < (n || 1); i++) total += frameTick();
      const s = cluster.snapshot();
      for (const c of consumers) c.render(s, 1);
      return total;
    },
    clock,
    consumers
  };
}

start();
