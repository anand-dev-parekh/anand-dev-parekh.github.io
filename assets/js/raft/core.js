/*
  Raft — the consensus algorithm, for real.

  This module is pure: no DOM, no timers, no randomness beyond a seeded PRNG.
  Time advances only when you call tick(). That makes it deterministic, which
  is what lets test/raft.test.mjs replay thousands of randomized crash and
  partition scenarios and assert Raft's safety invariants after every step.

  Section numbers refer to the extended Raft paper (Ongaro & Ousterhout, 2014)
  and, for membership changes, Ongaro's dissertation.
*/

export const FOLLOWER = "follower";
export const CANDIDATE = "candidate";
export const LEADER = "leader";

// Timing, in ticks. A tick is the simulation's unit of time.
export const DEFAULTS = {
  heartbeatTicks: 50,
  electionMinTicks: 150,
  electionMaxTicks: 300
};

/* A small seeded PRNG (mulberry32) so runs are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RaftNode {
  constructor(id, voters, opts = {}) {
    this.id = id;
    // Object.assign would let an explicit `undefined` clobber a default and
    // turn every timeout into NaN, so only copy keys that actually have values.
    this.opts = Object.assign({}, DEFAULTS);
    for (const k of Object.keys(DEFAULTS)) {
      if (opts[k] !== undefined) this.opts[k] = opts[k];
    }
    this.random = opts.random || Math.random;

    /* ---- persistent state (survives a crash) ---------------------------- */
    this.currentTerm = 0;
    this.votedFor = null;
    // log[0] is a sentinel so that array position === log index.
    this.log = [{ index: 0, term: 0, cmd: null }];
    // The initial configuration. Later configs arrive as log entries.
    this.baseConfig = voters.slice();

    /* ---- volatile state ------------------------------------------------- */
    this.state = FOLLOWER;
    this.commitIndex = 0;
    this.lastApplied = 0;
    this.leaderId = null;
    this.kv = {};           // the replicated state machine
    this.crashed = false;

    /* ---- leader-only volatile state ------------------------------------- */
    this.nextIndex = {};
    this.matchIndex = {};
    this.votesGranted = {};
    // CheckQuorum: peers heard from since the last check window.
    this.recentlyHeard = {};

    this.electionElapsed = 0;
    this.heartbeatElapsed = 0;
    this.electionTimeout = this.randomElectionTimeout();

    this.config = this.baseConfig.slice();
    this.learners = [];     // catching up; replicated to, but never counted
  }

  /* ------------------------------------------------------------ helpers -- */

  randomElectionTimeout() {
    const { electionMinTicks, electionMaxTicks } = this.opts;
    return electionMinTicks +
      Math.floor(this.random() * (electionMaxTicks - electionMinTicks));
  }

  lastIndex() { return this.log.length - 1; }
  lastTerm() { return this.log[this.log.length - 1].term; }
  termAt(i) { return i >= 0 && i < this.log.length ? this.log[i].term : -1; }

  isVoter(id) { return this.config.indexOf(id) !== -1; }
  quorum() { return Math.floor(this.config.length / 2) + 1; }

  // Everyone the leader replicates to: voters (minus self) plus learners.
  replicaIds() {
    const out = [];
    for (const id of this.config) if (id !== this.id) out.push(id);
    for (const id of this.learners) if (out.indexOf(id) === -1 && id !== this.id) out.push(id);
    return out;
  }

  /*
    §4.1: a configuration change takes effect the moment it is APPENDED, not
    when it commits. So the active config is always the latest config entry in
    the log, even if that entry is still uncommitted.
  */
  recomputeConfig() {
    for (let i = this.log.length - 1; i >= 1; i--) {
      const e = this.log[i];
      if (e.cmd && e.cmd.op === "config") {
        this.config = e.cmd.voters.slice();
        this.learners = (e.cmd.learners || []).slice();
        return;
      }
    }
    this.config = this.baseConfig.slice();
  }

  /* ----------------------------------------------------- state changes -- */

  becomeFollower(term, leaderId) {
    if (term > this.currentTerm) {
      this.currentTerm = term;
      this.votedFor = null;
    }
    this.state = FOLLOWER;
    this.leaderId = leaderId !== undefined ? leaderId : null;
    this.electionElapsed = 0;
    this.electionTimeout = this.randomElectionTimeout();
  }

  becomeCandidate(out) {
    this.state = CANDIDATE;
    this.currentTerm += 1;
    this.votedFor = this.id;
    this.leaderId = null;
    this.votesGranted = { [this.id]: true };
    this.electionElapsed = 0;
    this.electionTimeout = this.randomElectionTimeout();

    // A single-voter cluster elects itself immediately.
    if (this.countVotes() >= this.quorum()) { this.becomeLeader(out); return; }

    for (const peer of this.config) {
      if (peer === this.id) continue;
      out.push({
        type: "RequestVote", from: this.id, to: peer,
        term: this.currentTerm,
        lastLogIndex: this.lastIndex(), lastLogTerm: this.lastTerm()
      });
    }
  }

  becomeLeader(out) {
    this.state = LEADER;
    this.leaderId = this.id;
    this.nextIndex = {};
    this.matchIndex = {};
    this.recentlyHeard = { [this.id]: true };
    for (const peer of this.replicaIds()) {
      this.nextIndex[peer] = this.lastIndex() + 1;
      this.matchIndex[peer] = 0;
    }
    this.heartbeatElapsed = 0;
    this.electionElapsed = 0;
    this.broadcastAppend(out);
  }

  countVotes() {
    let n = 0;
    for (const id of this.config) if (this.votesGranted[id]) n++;
    return n;
  }

  /* ---------------------------------------------------------- client op -- */

  // Returns the log index the command landed at, or null if not the leader.
  propose(cmd, out) {
    if (this.state !== LEADER) return null;
    const entry = { index: this.lastIndex() + 1, term: this.currentTerm, cmd };
    this.log.push(entry);
    if (cmd.op === "config") this.recomputeConfig();
    this.matchIndex[this.id] = entry.index;
    this.broadcastAppend(out);
    return entry.index;
  }

  /* ---------------------------------------------------------- messaging -- */

  broadcastAppend(out) {
    for (const peer of this.replicaIds()) this.sendAppend(peer, out);
  }

  sendAppend(peer, out) {
    const next = this.nextIndex[peer] === undefined
      ? this.lastIndex() + 1 : this.nextIndex[peer];
    const prevLogIndex = Math.max(0, next - 1);
    out.push({
      type: "AppendEntries", from: this.id, to: peer,
      term: this.currentTerm,
      prevLogIndex,
      prevLogTerm: this.termAt(prevLogIndex),
      entries: this.log.slice(prevLogIndex + 1).map(e => ({ ...e })),
      leaderCommit: this.commitIndex
    });
  }

  receive(m, out) {
    if (this.crashed) return;

    // §5.1: any RPC with a higher term makes us a follower of that term.
    if (m.term > this.currentTerm) {
      const keepLeader = (m.type === "AppendEntries") ? m.from : null;
      this.becomeFollower(m.term, keepLeader);
    }

    switch (m.type) {
      case "RequestVote":      return this.handleRequestVote(m, out);
      case "RequestVoteResp":  return this.handleRequestVoteResp(m, out);
      case "AppendEntries":    return this.handleAppendEntries(m, out);
      case "AppendEntriesResp":return this.handleAppendEntriesResp(m, out);
    }
  }

  handleRequestVote(m, out) {
    let granted = false;

    if (m.term >= this.currentTerm) {
      // §5.4.1: only vote for a candidate whose log is at least as up to date.
      const upToDate =
        m.lastLogTerm > this.lastTerm() ||
        (m.lastLogTerm === this.lastTerm() && m.lastLogIndex >= this.lastIndex());
      // §5.2: one vote per term (re-voting for the same candidate is fine).
      const free = this.votedFor === null || this.votedFor === m.from;
      if (upToDate && free) {
        granted = true;
        this.votedFor = m.from;
        this.electionElapsed = 0;
        this.electionTimeout = this.randomElectionTimeout();
      }
    }

    out.push({
      type: "RequestVoteResp", from: this.id, to: m.from,
      term: this.currentTerm, voteGranted: granted
    });
  }

  handleRequestVoteResp(m, out) {
    if (this.state !== CANDIDATE || m.term !== this.currentTerm) return;
    if (m.voteGranted) {
      this.votesGranted[m.from] = true;
      if (this.countVotes() >= this.quorum()) this.becomeLeader(out);
    }
  }

  handleAppendEntries(m, out) {
    const reply = (success, matchIndex, conflictIndex) => out.push({
      type: "AppendEntriesResp", from: this.id, to: m.from,
      term: this.currentTerm, success, matchIndex, conflictIndex
    });

    // Stale leader: tell it our term so it steps down.
    if (m.term < this.currentTerm) return reply(false, 0);

    // Valid leader for this term.
    this.state = FOLLOWER;
    this.leaderId = m.from;
    this.electionElapsed = 0;
    this.electionTimeout = this.randomElectionTimeout();

    // §5.3: reject if we don't have the entry the leader assumes we have.
    if (m.prevLogIndex > this.lastIndex() ||
        this.termAt(m.prevLogIndex) !== m.prevLogTerm) {
      // Hint where to back up to, so the leader converges in one round trip
      // per conflicting term rather than one per entry.
      let conflictIndex = Math.min(m.prevLogIndex, this.lastIndex() + 1);
      if (conflictIndex <= this.lastIndex() && conflictIndex > 0) {
        const badTerm = this.termAt(conflictIndex);
        while (conflictIndex > 1 && this.termAt(conflictIndex - 1) === badTerm) {
          conflictIndex--;
        }
      }
      return reply(false, 0, Math.max(1, conflictIndex));
    }

    // §5.3: append, truncating only where an entry actually conflicts.
    let changed = false;
    for (const entry of m.entries) {
      const i = entry.index;
      if (i <= this.lastIndex()) {
        if (this.termAt(i) === entry.term) continue; // already have it
        this.log.length = i;                          // conflict: truncate
        changed = true;
      }
      this.log.push({ ...entry });
      changed = true;
    }
    if (changed) this.recomputeConfig();

    const matchIndex = m.prevLogIndex + m.entries.length;
    if (m.leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(m.leaderCommit, matchIndex);
      this.applyCommitted();
    }
    reply(true, matchIndex);
  }

  handleAppendEntriesResp(m, out) {
    if (this.state !== LEADER || m.term !== this.currentTerm) return;
    this.recentlyHeard[m.from] = true;

    if (m.success) {
      this.matchIndex[m.from] = Math.max(this.matchIndex[m.from] || 0, m.matchIndex);
      this.nextIndex[m.from] = this.matchIndex[m.from] + 1;
      this.advanceCommit();
    } else {
      const back = m.conflictIndex !== undefined
        ? m.conflictIndex
        : Math.max(1, (this.nextIndex[m.from] || 1) - 1);
      this.nextIndex[m.from] = Math.max(1, Math.min(back, this.nextIndex[m.from] - 1 || back));
      this.sendAppend(m.from, out);
    }
  }

  /*
    §5.4.2: a leader may only advance commitIndex to an entry from its OWN
    term. Counting replicas on an older entry is not enough — that's the
    Figure 8 scenario, where a later leader could still overwrite it.
  */
  advanceCommit() {
    for (let n = this.lastIndex(); n > this.commitIndex; n--) {
      if (this.termAt(n) !== this.currentTerm) continue;
      let count = 0;
      for (const id of this.config) {
        const m = id === this.id ? this.lastIndex() : (this.matchIndex[id] || 0);
        if (m >= n) count++;
      }
      if (count >= this.quorum()) {
        this.commitIndex = n;
        this.applyCommitted();
        return;
      }
    }
  }

  applyCommitted() {
    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++;
      const cmd = this.log[this.lastApplied].cmd;
      if (cmd && cmd.op === "set") this.kv[cmd.key] = cmd.value;
      if (cmd && cmd.op === "del") delete this.kv[cmd.key];
    }
  }

  /* --------------------------------------------------------------- time -- */

  tick(out) {
    if (this.crashed) return;
    this.electionElapsed++;

    if (this.state === LEADER) {
      this.heartbeatElapsed++;
      if (this.heartbeatElapsed >= this.opts.heartbeatTicks) {
        this.heartbeatElapsed = 0;
        this.broadcastAppend(out);
      }
      /*
        CheckQuorum. Plain Raft lets a partitioned leader keep the title
        forever; it just can't commit. Stepping down when a majority hasn't
        been heard from in an election timeout is what etcd does, and it makes
        "partition the leader" behave the way people expect.
      */
      if (this.electionElapsed >= this.electionTimeout) {
        this.electionElapsed = 0;
        let heard = 0;
        for (const id of this.config) {
          if (id === this.id || this.recentlyHeard[id]) heard++;
        }
        this.recentlyHeard = { [this.id]: true };
        if (heard < this.quorum()) this.becomeFollower(this.currentTerm, null);
      }
      return;
    }

    // Followers and candidates: election timeout starts a new election.
    // A node not in the current config must never campaign.
    if (this.electionElapsed >= this.electionTimeout) {
      if (this.isVoter(this.id)) this.becomeCandidate(out);
      else { this.electionElapsed = 0; this.electionTimeout = this.randomElectionTimeout(); }
    }
  }

  /* ------------------------------------------------------- crash/restart -- */

  crash() {
    this.crashed = true;
    this.state = FOLLOWER;
    this.leaderId = null;
    this.votesGranted = {};
    this.nextIndex = {};
    this.matchIndex = {};
  }

  restart() {
    // currentTerm, votedFor and log persist. Everything else is rebuilt.
    this.crashed = false;
    this.state = FOLLOWER;
    this.commitIndex = 0;
    this.lastApplied = 0;
    this.kv = {};
    this.leaderId = null;
    this.electionElapsed = 0;
    this.electionTimeout = this.randomElectionTimeout();
    this.recomputeConfig();
  }
}
