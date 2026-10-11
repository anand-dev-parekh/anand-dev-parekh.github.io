/*
  A simulated network. Messages take time to arrive, and a partition is simply
  a rule that refuses to deliver between groups.

  Connectivity is checked at DELIVERY time, not send time, so a message already
  in flight when you cut the network is lost — which is the interesting case.
*/
export class Network {
  constructor(opts = {}) {
    this.random = opts.random || Math.random;
    this.minDelay = opts.minDelay || 8;
    this.maxDelay = opts.maxDelay || 30;
    this.now = 0;
    this.seq = 0;
    this.inFlight = [];
    // null = fully connected. Otherwise an array of id-arrays; two nodes can
    // talk only if they share a group.
    this.groups = null;
    this.dropped = 0;
    this.delivered = 0;
  }

  connected(a, b) {
    if (a === b) return true;
    if (!this.groups) return true;
    for (const g of this.groups) {
      if (g.indexOf(a) !== -1 && g.indexOf(b) !== -1) return true;
    }
    return false;
  }

  send(m) {
    const delay = this.minDelay +
      Math.floor(this.random() * (this.maxDelay - this.minDelay));
    this.inFlight.push({
      id: ++this.seq, m, sentAt: this.now, deliverAt: this.now + delay
    });
  }

  /* Advance one tick; returns the messages that actually arrive. */
  tick(isCrashed) {
    this.now++;
    const due = [];
    const keep = [];
    for (const p of this.inFlight) {
      if (p.deliverAt > this.now) { keep.push(p); continue; }
      if (!this.connected(p.m.from, p.m.to) ||
          isCrashed(p.m.to) || isCrashed(p.m.from)) {
        this.dropped++;
        continue;
      }
      this.delivered++;
      due.push(p.m);
    }
    this.inFlight = keep;
    return due;
  }

  /* Drop anything in flight that can no longer be delivered. */
  prune(isCrashed) {
    this.inFlight = this.inFlight.filter(p => {
      const ok = this.connected(p.m.from, p.m.to) &&
        !isCrashed(p.m.to) && !isCrashed(p.m.from);
      if (!ok) this.dropped++;
      return ok;
    });
  }

  /* For the UI: each message's position along its path, 0..1. */
  packets() {
    return this.inFlight.map(p => ({
      id: p.id, from: p.m.from, to: p.m.to, type: p.m.type,
      progress: Math.min(1, (this.now - p.sentAt) / Math.max(1, p.deliverAt - p.sentAt))
    }));
  }
}
