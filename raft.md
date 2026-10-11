---
layout: page
title: The cluster behind this site
permalink: /raft/
---

This page is served by a real Raft cluster running in your browser. Not an
animation of one — an implementation, with the safety rules that make consensus
actually safe. Press <kbd>`</kbd> to open the console and watch it work.

### What it implements

Leader election with randomized timeouts, log replication with conflict
backtracking, and single-server membership changes. The rules that matter:

- **§5.2** — one vote per term.
- **§5.4.1** — a vote is only granted to a candidate whose log is at least as
  up to date as the voter's.
- **§5.4.2** — a leader may only advance its commit index to an entry from its
  *own* term. Counting replicas on an older entry is the Figure 8 trap.
- **CheckQuorum** — a leader that hasn't heard from a majority within an
  election timeout steps down, instead of holding the title from inside a
  minority partition.

Adding a node is two steps, not one. A new server joins as a **learner**:
replicated to, never counted toward quorum, never allowed to campaign. Counting
an empty-log node immediately could stall commits or lose them. Only once it has
caught up does the leader append a config entry promoting it to voter.

### Navigation is a real request

Opening a page on this site appends a `{op:"get", path}` entry to the log and
waits for it to commit before the view swaps. The cluster genuinely has to agree
that you asked for the page — so the log in the console is a record of your own
visit.

It is bounded, though. Consensus gets 400ms; past that the page loads regardless.
Kill every node from the console and the site still works, and tells you it's
serving from cache.

### How it's tested

Nine tests assert Raft's four safety properties — Election Safety, Log Matching,
State Machine Safety and Leader Completeness — after *every tick*, including a
fuzz run over 30 seeds with random crashes, restarts and partitions.

    node --test test/

[Source]({{ site.social[0].url }}/anand-dev-parekh.github.io/tree/main/assets/js/raft)
