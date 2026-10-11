/*
  Drives a set of RaftNodes over a simulated Network, and provides the
  operator-level actions the UI exposes: add, remove, crash, restart,
  partition, and propose.

  Membership deserves a note. Raft (§4.1) changes one server at a time, and a
  config entry takes effect on append rather than on commit. Adding a server
  happens in two steps, and this driver owns the second one the way a real
  admin tool would:

    1. the new server joins as a LEARNER — replicated to, never counted for
       quorum, never allowed to campaign. It starts with an empty log, so
       counting it immediately could stall commits or even lose them.
    2. once it has caught up, the leader appends a config entry promoting it
       to voter.
*/
import { RaftNode, LEADER, rng } from "./core.js";
import { Network } from "./network.js";

export class Cluster {
  constructor(opts = {}) {
    const seed = opts.seed === undefined ? 12345 : opts.seed;
    this.random = rng(seed);
    this.opts = opts;
    this.nodes = new Map();
    this.counter = 0;
    this.net = new Network({
      random: this.random,
      minDelay: opts.minDelay, maxDelay: opts.maxDelay
    });
    this.events = [];

    const n = opts.size === undefined ? 3 : opts.size;
    const ids = [];
    for (let i = 0; i < n; i++) ids.push("N" + (++this.counter));
    for (const id of ids) this.nodes.set(id, this.makeNode(id, ids));
  }

  makeNode(id, voters) {
    return new RaftNode(id, voters, {
      random: this.random,
      heartbeatTicks: this.opts.heartbeatTicks,
      electionMinTicks: this.opts.electionMinTicks,
      electionMaxTicks: this.opts.electionMaxTicks
    });
  }

  isCrashed(id) {
    const n = this.nodes.get(id);
    return !n || n.crashed;
  }

  leader() {
    let best = null;
    for (const n of this.nodes.values()) {
      if (n.crashed || n.state !== LEADER) continue;
      if (!best || n.currentTerm > best.currentTerm) best = n;
    }
    return best;
  }

  log(text, kind) {
    this.events.push({ at: this.net.now, text, kind: kind || "" });
    if (this.events.length > 200) this.events.shift();
  }

  /* ---------------------------------------------------------------- time -- */

  tick() {
    const out = [];
    const due = this.net.tick(id => this.isCrashed(id));

    for (const m of due) {
      const node = this.nodes.get(m.to);
      if (node) node.receive(m, out);
    }
    for (const node of this.nodes.values()) node.tick(out);

    for (const m of out) this.net.send(m);

    this.maintainMembership();
    return out.length;
  }

  /* ---------------------------------------------------------- membership -- */

  /*
    Promote any learner that has caught up, and finish pending removals.
    This runs outside the algorithm on purpose — it's the admin layer.
  */
  maintainMembership() {
    const ld = this.leader();
    if (!ld) return;

    for (const id of ld.learners.slice()) {
      const match = ld.matchIndex[id] || 0;
      if (match > 0 && match >= ld.commitIndex && ld.commitIndex > 0) {
        const voters = ld.config.concat([id]);
        const learners = ld.learners.filter(x => x !== id);
        const out = [];
        ld.propose({ op: "config", voters, learners }, out);
        for (const m of out) this.net.send(m);
        this.log(id + " caught up — promoted to voter", "ok");
      }
    }

    if (this.pendingRemoval && ld.commitIndex >= this.pendingRemoval.index) {
      const id = this.pendingRemoval.id;
      this.nodes.delete(id);
      this.net.prune(x => this.isCrashed(x));
      this.log(id + " removed from the cluster", "ok");
      this.pendingRemoval = null;
    }
  }

  addNode() {
    const ld = this.leader();
    if (!ld) { this.log("can't add a node — no leader", "err"); return null; }

    const id = "N" + (++this.counter);
    // A new server starts with an empty log and an empty config: it learns
    // the configuration from the leader, and can never start an election.
    this.nodes.set(id, this.makeNode(id, []));

    const out = [];
    ld.propose({
      op: "config", voters: ld.config.slice(), learners: ld.learners.concat([id])
    }, out);
    for (const m of out) this.net.send(m);
    this.log(id + " joined as a learner — catching up", "");
    return id;
  }

  removeNode(id) {
    const ld = this.leader();
    if (!ld) { this.log("can't remove a node — no leader", "err"); return false; }
    if (!this.nodes.has(id)) return false;
    if (ld.config.indexOf(id) !== -1 && ld.config.length <= 1) {
      this.log("can't remove the last voter", "err");
      return false;
    }

    const voters = ld.config.filter(x => x !== id);
    const learners = ld.learners.filter(x => x !== id);
    const out = [];
    const index = ld.propose({ op: "config", voters, learners }, out);
    for (const m of out) this.net.send(m);
    this.pendingRemoval = { id, index };
    this.log(id + " leaving — config change replicating", "");
    return true;
  }

  crash(id) {
    const n = this.nodes.get(id);
    if (!n || n.crashed) return;
    n.crash();
    this.net.prune(x => this.isCrashed(x));
    this.log(id + " crashed", "err");
  }

  restart(id) {
    const n = this.nodes.get(id);
    if (!n || !n.crashed) return;
    n.restart();
    this.log(id + " restarted — log and term recovered from disk", "ok");
  }

  setPartition(groups) {
    this.net.groups = groups;
    this.net.prune(x => this.isCrashed(x));
    this.log(groups ? "network partitioned" : "partition healed",
             groups ? "err" : "ok");
  }

  /* ------------------------------------------------------------- client -- */

  propose(cmd) {
    const ld = this.leader();
    if (!ld) { this.log("no leader — write rejected", "err"); return null; }
    const out = [];
    const index = ld.propose(cmd, out);
    for (const m of out) this.net.send(m);
    return index;
  }

  /* --------------------------------------------------------------- view -- */

  snapshot() {
    const ld = this.leader();
    const nodes = [];
    for (const n of this.nodes.values()) {
      nodes.push({
        id: n.id,
        state: n.crashed ? "crashed" : n.state,
        crashed: n.crashed,
        term: n.currentTerm,
        commitIndex: n.commitIndex,
        lastIndex: n.lastIndex(),
        votedFor: n.votedFor,
        isVoter: ld ? ld.config.indexOf(n.id) !== -1 : n.isVoter(n.id),
        isLearner: ld ? ld.learners.indexOf(n.id) !== -1 : false,
        log: n.log.slice(1).map(e => ({ index: e.index, term: e.term, cmd: e.cmd })),
        kv: { ...n.kv }
      });
    }
    return {
      now: this.net.now,
      nodes,
      leaderId: ld ? ld.id : null,
      term: ld ? ld.currentTerm : Math.max(0, ...nodes.map(n => n.term)),
      packets: this.net.packets(),
      events: this.events.slice(-8),
      partitioned: !!this.net.groups
    };
  }
}
