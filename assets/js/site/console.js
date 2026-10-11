/*
  The focus-mode side panel: controls, the replicated log, and applied state.

  It deliberately does NOT list the nodes. In focus mode the canvas shows them
  full size and labelled, so repeating them here would only crowd out the view —
  the old bottom drawer covered the very thing it was about.

  Renders only while open.
*/

const COLOR = {
  leader: "#41BE6E", candidate: "#E0A62A", follower: "#4C8DF5",
  crashed: "#E5484D", learner: "#9A7CF5"
};

function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function nodeColor(n) {
  if (n.crashed) return COLOR.crashed;
  if (n.isLearner) return COLOR.learner;
  if (n.state === "leader") return COLOR.leader;
  if (n.state === "candidate") return COLOR.candidate;
  return COLOR.follower;
}

function roleLabel(n) {
  if (n.crashed) return "CRASHED";
  if (n.isLearner) return "CATCHING UP";
  return n.state.toUpperCase();
}

function describe(cmd) {
  if (!cmd) return "—";
  if (cmd.op === "get") return `GET ${cmd.path}`;
  if (cmd.op === "set") return `SET ${cmd.key}=${cmd.value}`;
  if (cmd.op === "del") return `DEL ${cmd.key}`;
  if (cmd.op === "config") {
    return `CONFIG voters=[${cmd.voters.join(",")}]` +
      (cmd.learners && cmd.learners.length ? ` +learner ${cmd.learners.join(",")}` : "");
  }
  return JSON.stringify(cmd);
}

export function mountConsole(cluster, opts = {}) {
  let open = false;
  let partitioned = false;

  const drawer = document.createElement("div");
  drawer.className = "console";
  drawer.hidden = true;
  drawer.setAttribute("aria-label", "Cluster console");

  const controls = h("div", "console-controls");
  function btn(label, cls, fn) {
    const b = h("button", "btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    controls.appendChild(b);
    return b;
  }
  const addBtn = btn("+ Add node", "", () => cluster.addNode());
  btn("Kill leader", "danger", () => {
    const ld = cluster.leader();
    if (ld) cluster.crash(ld.id); else cluster.log("no leader to kill", "err");
  });
  const partBtn = btn("Partition", "warn", () => {
    partitioned = !partitioned;
    if (!partitioned) { cluster.setPartition(null); return; }
    const ids = [...cluster.nodes.keys()];
    cluster.setPartition([ids.slice(0, Math.ceil(ids.length / 2)), ids.slice(Math.ceil(ids.length / 2))]);
  });
  btn("Restart all", "", () => {
    for (const id of cluster.nodes.keys()) cluster.restart(id);
  });

  // Speed control. The point of slow motion is watching one message travel,
  // so this lives next to the cluster rather than buried in a settings menu.
  const speedRow = h("div", "console-speed");
  speedRow.appendChild(h("span", "console-speed-label mono", "speed"));
  const speedChips = [];
  if (opts.clock) {
    opts.clock.speeds.forEach((sp, i) => {
      const b = h("button", "speed-chip mono", sp.label);
      b.type = "button";
      b.addEventListener("click", () => opts.clock.set(i));
      speedRow.appendChild(b);
      speedChips.push(b);
    });
  }

  const form = h("form", "console-cmd");
  const input = h("input", "mono console-input");
  input.type = "text";
  input.placeholder = "SET name anand";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Send a command to the cluster");
  form.appendChild(h("span", "mono console-prompt", ">"));
  form.appendChild(input);

  const panels = h("div", "console-panels");
  const logPanel = h("div", "console-panel");
  logPanel.appendChild(h("p", "console-title mono", "replicated log"));
  const logList = h("div", "console-log");
  logPanel.appendChild(logList);
  const kvPanel = h("div", "console-panel");
  kvPanel.appendChild(h("p", "console-title mono", "applied state"));
  const kvList = h("div", "console-kv");
  kvPanel.appendChild(kvList);
  panels.appendChild(logPanel);
  panels.appendChild(kvPanel);

  const feed = h("div", "console-feed mono");

  drawer.appendChild(controls);
  drawer.appendChild(speedRow);
  drawer.appendChild(form);
  drawer.appendChild(panels);
  drawer.appendChild(feed);
  document.body.appendChild(drawer);

  form.addEventListener("submit", e => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;
    const p = raw.split(/\s+/);
    const op = p[0].toLowerCase();
    const ld = cluster.leader();
    if (op === "set" && p.length >= 3) {
      cluster.propose({ op: "set", key: p[1], value: p.slice(2).join(" ") });
    } else if (op === "del" && p.length === 2) {
      cluster.propose({ op: "del", key: p[1] });
    } else if (op === "get" && p.length === 2) {
      const v = ld ? ld.kv[p[1]] : undefined;
      cluster.log(ld ? `GET ${p[1]} → ${v === undefined ? "(nil)" : v} · from ${ld.id}`
                     : "no leader — read rejected", ld ? "" : "err");
    } else {
      cluster.log("usage: SET <key> <value> | GET <key> | DEL <key>", "err");
    }
    input.value = "";
  });

  function render(s) {
    if (!open) return;

    if (opts.clock) {
      const active = opts.clock.index();
      speedChips.forEach((b, i) => b.setAttribute("aria-pressed", String(i === active)));
      drawer.dataset.paused = opts.clock.speeds[active].mult === 0 ? "1" : "";
    }

    partBtn.setAttribute("aria-pressed", String(partitioned));
    partBtn.textContent = partitioned ? "Heal partition" : "Partition";
    addBtn.disabled = cluster.nodes.size >= 7;

    const ld = s.nodes.find(n => n.id === s.leaderId) ||
      s.nodes.slice().sort((a, b) => b.lastIndex - a.lastIndex)[0];
    logList.innerHTML = "";
    kvList.innerHTML = "";
    if (!ld) return;

    const voters = s.nodes.filter(n => n.isVoter);
    const entries = ld.log.slice(-8);
    if (!entries.length) logList.appendChild(h("p", "console-empty mono", "log is empty"));
    for (const e of entries) {
      const row = h("div", "console-log-row mono");
      row.appendChild(h("span", "console-log-idx", String(e.index)));
      row.appendChild(h("span", "console-log-term", "t" + e.term));
      row.appendChild(h("span", "console-log-cmd", describe(e.cmd)));
      const stored = voters.filter(v => v.lastIndex >= e.index).length;
      const done = e.index <= ld.commitIndex;
      row.appendChild(h("span", "console-log-state " + (done ? "is-committed" : "is-pending"),
        (done ? "committed" : "replicating") + ` ${stored}/${voters.length}`));
      logList.appendChild(row);
    }

    const keys = Object.keys(ld.kv).sort();
    if (!keys.length) kvList.appendChild(h("p", "console-empty mono", "nothing applied yet"));
    for (const k of keys) {
      const row = h("div", "console-kv-row mono");
      row.appendChild(h("span", "console-kv-key", k));
      row.appendChild(h("span", "console-kv-eq", "="));
      row.appendChild(h("span", "console-kv-val", ld.kv[k]));
      kvList.appendChild(row);
    }

    feed.innerHTML = "";
    for (const e of s.events.slice(-3)) {
      feed.appendChild(h("p", "console-feed-row " + (e.kind || ""), e.text));
    }
  }

  function setOpen(next) {
    open = next;
    drawer.hidden = !open;
    if (open) document.documentElement.dataset.focus = "1";
    else delete document.documentElement.dataset.focus;
    if (opts.onOpenChange) opts.onOpenChange(open);
    if (open) render(cluster.snapshot());
  }

  document.addEventListener("keydown", e => {
    const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === "`" && !typing) { e.preventDefault(); setOpen(!open); }
    if (e.key === "Escape" && open) setOpen(false);
  });

  return {
    render,
    toggle() { setOpen(!open); },
    isOpen() { return open; },
    element: drawer
  };
}
