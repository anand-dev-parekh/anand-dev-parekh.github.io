import test from "node:test";
import assert from "node:assert/strict";
import { Cluster } from "../assets/js/raft/cluster.js";
import { LEADER } from "../assets/js/raft/core.js";

/*
  An invariant checker that runs against the whole cluster after every tick.
  These are Raft's five safety properties (paper, Figure 3). Any violation is
  a real bug, not a flaky test — the simulation is deterministic per seed.
*/
class Invariants {
  constructor() {
    this.leaderByTerm = new Map();  // Election Safety
    this.committed = new Map();     // State Machine Safety
  }

  check(cluster) {
    const nodes = [...cluster.nodes.values()];

    // --- Election Safety: at most one leader per term ----------------------
    for (const n of nodes) {
      if (n.crashed || n.state !== LEADER) continue;
      const seen = this.leaderByTerm.get(n.currentTerm);
      assert.ok(seen === undefined || seen === n.id,
        `two leaders in term ${n.currentTerm}: ${seen} and ${n.id}`);
      this.leaderByTerm.set(n.currentTerm, n.id);
    }

    // --- Log Matching: same index + same term => identical prefixes --------
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].log, b = nodes[j].log;
        const max = Math.min(a.length, b.length) - 1;
        for (let k = max; k >= 1; k--) {
          if (a[k].term === b[k].term) {
            for (let p = 1; p <= k; p++) {
              assert.equal(a[p].term, b[p].term,
                `log mismatch at ${p} between ${nodes[i].id}/${nodes[j].id}`);
              assert.deepEqual(a[p].cmd, b[p].cmd,
                `command mismatch at ${p} between ${nodes[i].id}/${nodes[j].id}`);
            }
            break;
          }
        }
      }
    }

    // --- State Machine Safety: a committed index never changes ------------
    for (const n of nodes) {
      for (let i = 1; i <= n.commitIndex; i++) {
        const e = n.log[i];
        assert.ok(e, `${n.id} claims commit ${i} but has no entry`);
        const key = JSON.stringify({ term: e.term, cmd: e.cmd });
        const prev = this.committed.get(i);
        if (prev === undefined) {
          // Remember the lowest term at which anyone knew this was committed.
          // The commit itself happened in a term no higher than that.
          this.committed.set(i, { key, term: n.currentTerm });
        } else {
          assert.equal(key, prev.key,
            `committed entry ${i} changed: ${prev.key} -> ${key} (on ${n.id})`);
          if (n.currentTerm < prev.term) prev.term = n.currentTerm;
        }
      }
    }

    // --- Leader Completeness ----------------------------------------------
    // An entry committed in some term is present in the log of every leader
    // of a HIGHER term. A stale leader still sitting in an old term (an
    // isolated one that hasn't stepped down yet) is not a counterexample.
    for (const n of nodes) {
      if (n.crashed || n.state !== LEADER) continue;
      for (const [idx, rec] of this.committed) {
        if (n.currentTerm <= rec.term) continue;
        assert.ok(idx <= n.lastIndex(),
          `leader ${n.id} (term ${n.currentTerm}) is missing committed entry ${idx}`);
        const e = n.log[idx];
        assert.equal(JSON.stringify({ term: e.term, cmd: e.cmd }), rec.key,
          `leader ${n.id} (term ${n.currentTerm}) disagrees with committed entry ${idx}`);
      }
    }
  }
}

function run(cluster, ticks, inv, onTick) {
  for (let i = 0; i < ticks; i++) {
    cluster.tick();
    if (onTick) onTick(i);
    if (inv) inv.check(cluster);
  }
}

/* ------------------------------------------------------------- liveness -- */

test("elects a leader with no faults", () => {
  const c = new Cluster({ seed: 1 });
  run(c, 500, new Invariants());
  assert.ok(c.leader(), "expected a leader");
});

test("replicates and commits a write on every node", () => {
  const c = new Cluster({ seed: 2 });
  run(c, 500, new Invariants());
  c.propose({ op: "set", key: "user", value: "anand" });
  run(c, 300, new Invariants());
  for (const n of c.nodes.values()) {
    assert.equal(n.kv.user, "anand", `${n.id} did not apply the write`);
  }
});

test("re-elects after the leader crashes, and keeps committed data", () => {
  const c = new Cluster({ seed: 3 });
  const inv = new Invariants();
  run(c, 500, inv);
  c.propose({ op: "set", key: "a", value: "1" });
  run(c, 300, inv);

  const old = c.leader().id;
  c.crash(old);
  run(c, 1200, inv);

  const ld = c.leader();
  assert.ok(ld, "expected a new leader after the crash");
  assert.notEqual(ld.id, old);
  assert.equal(ld.kv.a, "1", "committed write was lost across the election");
});

test("a restarted node recovers its log from disk", () => {
  const c = new Cluster({ seed: 4 });
  const inv = new Invariants();
  run(c, 500, inv);
  c.propose({ op: "set", key: "k", value: "v" });
  run(c, 300, inv);

  const victim = [...c.nodes.values()].find(n => n.state !== LEADER).id;
  const before = c.nodes.get(victim).log.length;
  c.crash(victim);
  run(c, 200, inv);
  c.restart(victim);
  run(c, 600, inv);

  const n = c.nodes.get(victim);
  assert.ok(n.log.length >= before, "log shrank across a restart");
  assert.equal(n.kv.k, "v");
});

/* ----------------------------------------------------------- partitions -- */

test("a minority partition cannot commit; the majority can", () => {
  const c = new Cluster({ seed: 5 });
  const inv = new Invariants();
  run(c, 600, inv);

  const ld = c.leader().id;
  const others = [...c.nodes.keys()].filter(id => id !== ld);
  // isolate the leader alone
  c.setPartition([[ld], others]);
  run(c, 1500, inv);

  const isolated = c.nodes.get(ld);
  const commitBefore = isolated.commitIndex;
  // the isolated node must not be able to commit anything new
  if (isolated.state === LEADER) isolated.propose({ op: "set", key: "ghost", value: "1" }, []);
  run(c, 800, inv);
  assert.equal(isolated.commitIndex, commitBefore,
    "an isolated leader committed an entry without a quorum");

  // the majority side must elect its own leader and make progress
  const major = others.map(id => c.nodes.get(id)).find(n => n.state === LEADER);
  assert.ok(major, "majority side failed to elect a leader");

  c.setPartition(null);
  run(c, 1500, inv);
  assert.equal([...c.nodes.values()].filter(n => n.state === LEADER).length, 1,
    "more than one leader survived the heal");
});

test("an isolated leader steps down (CheckQuorum)", () => {
  const c = new Cluster({ seed: 6 });
  const inv = new Invariants();
  run(c, 600, inv);
  const ld = c.leader().id;
  const others = [...c.nodes.keys()].filter(id => id !== ld);
  c.setPartition([[ld], others]);
  run(c, 1500, inv);
  assert.notEqual(c.nodes.get(ld).state, LEADER,
    "leader kept the title with no quorum");
});

/* ---------------------------------------------------------- membership -- */

test("adds a node: learner catches up, then becomes a voter", () => {
  const c = new Cluster({ seed: 8 });
  const inv = new Invariants();
  run(c, 500, inv);
  c.propose({ op: "set", key: "a", value: "1" });
  c.propose({ op: "set", key: "b", value: "2" });
  run(c, 400, inv);

  const id = c.addNode();
  assert.ok(id, "addNode returned nothing");
  run(c, 2000, inv);

  const ld = c.leader();
  assert.ok(ld.config.includes(id), `${id} was never promoted to voter`);
  assert.equal(c.nodes.get(id).kv.a, "1", "new node did not catch up");
  assert.equal(c.nodes.get(id).kv.b, "2");
});

test("removes a node and keeps committing", () => {
  const c = new Cluster({ seed: 9, size: 5 });
  const inv = new Invariants();
  run(c, 700, inv);

  const victim = [...c.nodes.keys()].find(id => id !== c.leader().id);
  c.removeNode(victim);
  run(c, 1500, inv);

  assert.ok(!c.nodes.has(victim), `${victim} still present`);
  c.propose({ op: "set", key: "after", value: "yes" });
  run(c, 600, inv);
  assert.equal(c.leader().kv.after, "yes", "cluster stalled after removal");
});

/* -------------------------------------------------------- router contract -- */

test("a page view replicates and commits like any other entry", () => {
  const c = new Cluster({ seed: 41 });
  const inv = new Invariants();
  run(c, 600, inv);

  const index = c.propose({ op: "get", path: "/posts/" });
  assert.ok(index, "propose returned no index");
  run(c, 400, inv);

  const ld = c.leader();
  assert.ok(ld.commitIndex >= index, "page view never committed");
  assert.equal(ld.log[index].cmd.path, "/posts/");
  for (const n of c.nodes.values()) {
    assert.equal(n.log[index].cmd.path, "/posts/", `${n.id} missing the page view`);
  }
});

test("with no leader a page view is rejected, not queued", () => {
  const c = new Cluster({ seed: 42 });
  run(c, 600, new Invariants());
  for (const id of [...c.nodes.keys()]) c.crash(id);
  run(c, 200, null);
  assert.equal(c.propose({ op: "get", path: "/posts/" }), null,
    "propose should return null so the router can fall back to a cache read");
});

/* ---------------------------------------------------------------- fuzz -- */

test("safety holds under randomized crashes, restarts and partitions", () => {
  for (let seed = 100; seed < 130; seed++) {
    const c = new Cluster({ seed, size: 5 });
    const inv = new Invariants();
    const rand = () => (c.random());
    let writes = 0;

    run(c, 6000, inv, i => {
      if (i % 40 !== 0) return;
      const r = rand();
      const ids = [...c.nodes.keys()];
      const pick = ids[Math.floor(rand() * ids.length)];

      if (r < 0.22) c.crash(pick);
      else if (r < 0.48) { for (const id of ids) c.restart(id); }
      else if (r < 0.60) {
        const shuffled = ids.slice().sort(() => rand() - 0.5);
        const cut = 1 + Math.floor(rand() * (shuffled.length - 1));
        c.setPartition([shuffled.slice(0, cut), shuffled.slice(cut)]);
      }
      else if (r < 0.72) c.setPartition(null);
      else c.propose({ op: "set", key: "k" + (writes % 5), value: String(writes++) });
    });
  }
});
