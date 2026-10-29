# anand-dev-parekh.github.io

A personal site that runs on a real Raft cluster. The cluster is not a widget on
the page — it is what the page runs on. Navigating appends a `{op:"get", path}`
entry to the replicated log and waits for it to commit before the view swaps, so
browsing the site builds a log of your own visit.

## Run it

```sh
npm run dev          # → http://127.0.0.1:4000
```

Or the long way, which is what that script does:

```sh
export PATH="$(brew --prefix ruby)/bin:$PATH"
bundle exec jekyll serve
```

**The `PATH` line matters.** The default `ruby` on macOS is system Ruby 2.6, which
Jekyll 4.4 will not run on. Homebrew Ruby has to come first. Without it you get a
wall of gem errors that don't mention the real cause.

Stop the server with `pkill -f "jekyll serve"`.

On a fresh clone, install gems first — they vendor into `vendor/bundle`, no sudo:

```sh
bundle install
```

## Test

```sh
npm test             # node --test test/ — no Ruby involved
```

Eleven tests. They assert Raft's four safety properties — Election Safety, Log
Matching, State Machine Safety and Leader Completeness — after *every tick*,
including a fuzz run across 30 seeds with random crashes, restarts and partitions.
If these fail, consensus is broken, not the styling.

## Edit

| What | Where |
|---|---|
| Roles | `_data/experience.yml` |
| Degrees | `_data/education.yml` |
| Bio / hero copy | `index.md` |
| Posts | `_posts/YYYY-MM-DD-title.md` |
| Name, tagline, links | `_config.yml` |

Everything hot-rebuilds on save **except `_config.yml`** — that one needs a server
restart.

## How it fits together

```
assets/js/raft/     the algorithm — no DOM, no timers, deterministic
  core.js             RaftNode: election, replication, membership. Tested.
  network.js          simulated network: delays, partitions, drops
  cluster.js          drives the nodes; add/remove/crash/restart/propose

assets/js/site/     the world — everything that touches the page
  boot.js             creates the one Cluster and runs the loop
  ambient.js          background canvas: nodes, edges, packets in flight
  router.js           link clicks → log entries → view swaps
  statusbar.js        the persistent bar, on every page
  console.js          the drawer (press `)
```

`core.js` is the part with tests behind it. Change it deliberately.

The site is complete in static HTML: every project and role renders with
JavaScript off, and `?plain=1` (or the "plain" button) turns the world off
entirely and keeps a fast editorial site.

## Deploy

Push to `main`. `.github/workflows/pages.yml` builds with Ruby 3.3 and deploys, so
the local Ruby situation doesn't affect CI.

**One-time setup:** repo Settings → Pages → Source → **GitHub Actions**. Without
it the workflow runs and nothing ships.

## Troubleshooting

**`bundle exec jekyll serve` explodes with gem errors** — you're on system Ruby.
Check with `ruby -v`; if it says 2.6.x, the `PATH` export is missing. Use
`npm run dev`.

**`npm run dev` can't find Ruby** — the script asks Homebrew where Ruby is. If you
don't use Homebrew, export the `PATH` manually to wherever Ruby 3.1+ lives.

**Port 4000 is busy** — `bundle exec jekyll serve --port 4001`.

**A change didn't show up** — if it was `_config.yml`, restart the server.
