/*
  Navigation is a real request.

  Clicking a link appends a {op:"get", path} entry to the Raft log and waits for
  it to commit before swapping the view. The cluster genuinely has to agree that
  you asked for the page.

  It must never hold a human up, though, so every path out is bounded:
    - a hard COMMIT_CAP_MS ceiling, whatever consensus is doing
    - no leader / no quorum still navigates, reported as a cache read
    - no JS, no View Transitions, or plain mode fall through to normal links
  A failure here is cosmetic, never a dead end.
*/

const COMMIT_CAP_MS = 400;

/* "/index.html" and "/" are the same page; the log should say so. */
export function tidyPath(pathname, search) {
  return pathname.replace(/index\.html$/, "") + (search || "");
}
const IDLE_DELAY_MS = 2600;

function sameOrigin(url) {
  return url.origin === location.origin;
}

function isPlainLeftClick(e) {
  return !e.defaultPrevented && e.button === 0 &&
    !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export function mountRouter(cluster, opts = {}) {
  const statusbar = opts.statusbar;
  const reduced = opts.reduced;
  const main = document.querySelector("[data-page]");
  if (!main) return { render() {} };

  // Screen readers get told the page changed; without this a swap is silent.
  const live = document.createElement("div");
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  document.body.appendChild(live);

  let navigating = false;
  let idleTimer;

  function report(text, kind) {
    if (!statusbar) return;
    clearTimeout(idleTimer);
    statusbar.setRequest(text, kind);
    idleTimer = setTimeout(() => statusbar.setRequest("", ""), IDLE_DELAY_MS);
  }

  /* Resolve once the entry commits, or once the ceiling is hit. */
  function awaitCommit(index, startedAt) {
    return new Promise(resolve => {
      if (index === null || index === undefined) {
        resolve({ committed: false, reason: "no-leader" });
        return;
      }
      (function poll() {
        const ld = cluster.leader();
        if (ld && ld.commitIndex >= index && ld.log[index]) {
          resolve({ committed: true });
          return;
        }
        if (performance.now() - startedAt >= COMMIT_CAP_MS) {
          resolve({ committed: false, reason: ld ? "slow" : "no-leader" });
          return;
        }
        setTimeout(poll, 16);
      })();
    });
  }

  function applyDocument(html, url) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const incoming = doc.querySelector("[data-page]");
    if (!incoming) throw new Error("no [data-page] in response");

    document.title = doc.title;
    main.innerHTML = incoming.innerHTML;

    // MathJax does not know the DOM changed; posts use it.
    if (window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise([main]).catch(() => {});
    }

    const heading = main.querySelector("h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
      live.textContent = heading.textContent + " — loaded";
    } else {
      live.textContent = document.title + " — loaded";
    }

    if (url.hash) {
      const target = main.querySelector(url.hash);
      if (target) { target.scrollIntoView(); return; }
    }
    window.scrollTo(0, 0);
  }

  function swap(html, url) {
    const run = () => applyDocument(html, url);
    if (document.startViewTransition && !(reduced && reduced.matches)) {
      document.startViewTransition(run);
    } else {
      run();
    }
  }

  async function navigate(url, { push = true } = {}) {
    if (navigating) return;
    navigating = true;
    document.documentElement.dataset.navigating = "1";

    const path = tidyPath(url.pathname, url.search);
    const started = performance.now();
    const ld = cluster.leader();
    const index = cluster.propose({ op: "get", path });

    report(ld ? `GET ${path} → ${ld.id}` : `GET ${path} → no leader`, ld ? "" : "err");

    try {
      const [res, commit] = await Promise.all([
        fetch(url.href, { headers: { "X-Requested-With": "raft-router" } }),
        awaitCommit(index, started)
      ]);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const html = await res.text();

      if (push) {
        // Remember where we were, so Back lands where it should.
        history.replaceState({ scroll: window.scrollY }, "");
        history.pushState({ scroll: 0 }, "", url.href);
      }
      swap(html, url);

      const ms = Math.round(performance.now() - started);
      if (commit.committed) {
        report(`200 · committed at ${index} · ${ms}ms`, "ok");
      } else if (commit.reason === "no-leader") {
        report(`200 · no quorum — served from cache · ${ms}ms`, "err");
      } else {
        report(`200 · replicating · ${ms}ms`, "warn");
      }
    } catch (err) {
      // Anything unexpected: hand the browser back the wheel.
      location.href = url.href;
      return;
    } finally {
      navigating = false;
      delete document.documentElement.dataset.navigating;
    }
  }

  document.addEventListener("click", e => {
    if (!isPlainLeftClick(e)) return;
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.target || a.hasAttribute("download") || a.dataset.noRoute) return;

    const url = new URL(a.href, location.href);
    if (!sameOrigin(url)) return;
    if (url.pathname.match(/\.(xml|json|png|jpg|svg|pdf|zip)$/)) return;

    // Same page: let the browser handle the hash and the smooth scroll.
    if (url.pathname === location.pathname && url.hash) return;
    if (url.href === location.href) { e.preventDefault(); return; }

    e.preventDefault();
    navigate(url);
  });

  window.addEventListener("popstate", e => {
    const url = new URL(location.href);
    navigate(url, { push: false }).then(() => {
      const y = (e.state && e.state.scroll) || 0;
      window.scrollTo(0, y);
    });
  });

  return { render() {}, navigate };
}
