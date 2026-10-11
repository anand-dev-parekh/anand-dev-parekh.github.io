/*
  The persistent status bar. This is what makes the site one continuous world
  rather than one clever page — it is present on the blog post too, showing the
  same cluster, still running.
*/

function set(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

export function mountStatusBar(cluster, opts = {}) {
  const bar = document.createElement("div");
  bar.className = "statusbar";
  bar.setAttribute("role", "complementary");
  bar.setAttribute("aria-label", "Cluster status");

  bar.innerHTML = `
    <button type="button" class="sb-state" aria-expanded="false"
            title="Inspect the cluster — dims the page and brings the nodes forward (backtick)">
      <span class="sb-dot" aria-hidden="true"></span>
      <span class="sb-leader mono"></span>
      <span class="sb-meta mono"></span>
      <span class="sb-caret mono" aria-hidden="true">inspect ⌃</span>
    </button>
    <span class="sb-right">
      <span class="sb-request mono" data-kind=""></span>
      <button type="button" class="sb-plain mono" title="Switch to a plain, static version of this site">plain</button>
    </span>`;
  document.body.appendChild(bar);

  const dot = bar.querySelector(".sb-dot");
  const leaderEl = bar.querySelector(".sb-leader");
  const metaEl = bar.querySelector(".sb-meta");
  const requestEl = bar.querySelector(".sb-request");
  const caretEl = bar.querySelector(".sb-caret");

  bar.querySelector(".sb-plain").addEventListener("click", () => {
    if (opts.setPlain) opts.setPlain(true);
  });

  const stateBtn = bar.querySelector(".sb-state");
  stateBtn.addEventListener("click", () => { if (opts.onToggle) opts.onToggle(); });

  let lastHealth = null;

  function render(s) {
    const voters = s.nodes.filter(n => n.isVoter);
    const up = voters.filter(n => !n.crashed).length;
    const quorum = voters.length ? Math.floor(voters.length / 2) + 1 : 1;
    const healthy = !!s.leaderId;

    if (healthy) {
      set(leaderEl, `${s.leaderId} leader`);
      set(metaEl, `term ${s.term} · commit ${leaderCommit(s)} · ${voters.length} voters`);
    } else {
      set(leaderEl, up >= quorum ? "electing…" : "no quorum");
      set(metaEl, `term ${s.term} · ${up}/${voters.length} reachable · need ${quorum}`);
    }

    if (opts.isConsoleOpen) {
      const open = opts.isConsoleOpen();
      stateBtn.setAttribute("aria-expanded", String(open));
      set(caretEl, open ? "close ⌄" : "inspect ⌃");
    }

    const health = healthy ? "ok" : (up >= quorum ? "electing" : "down");
    if (health !== lastHealth) {
      lastHealth = health;
      bar.dataset.health = health;
      document.documentElement.dataset.clusterHealth = health;
    }
  }

  function leaderCommit(s) {
    const ld = s.nodes.find(n => n.id === s.leaderId);
    return ld ? ld.commitIndex : 0;
  }

  return {
    render,
    setRequest(text, kind) {
      set(requestEl, text || "");
      requestEl.dataset.kind = kind || "";
    },
    element: bar
  };
}
