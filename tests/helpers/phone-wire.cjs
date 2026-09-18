/* Test-only PeerJS boundary, usable in Node and Chromium. Production room,
 * admission, channel replacement, input, codec and recovery code runs unchanged. */
(function (root) {
  class Emitter {
    constructor() { this.handlers = {}; }
    on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
    emit(type, data) { (this.handlers[type] || []).forEach(fn => fn(data)); }
  }
  root.makePhoneWire = function ({ loss = .2, latency = 35, jitter = 18 } = {}) {
    const wire = { now: 0, queue: [], peers: new Map(), serial: 0, seed: 93, dials: 0, silent: new Set(), rejected: 0 };
    wire.random = () => ((wire.seed = (Math.imul(wire.seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    wire.enqueue = (after, fn) => wire.queue.push({ at: wire.now + after, order: ++wire.serial, fn });
    wire.pump = ms => {
      const end = wire.now + ms;
      for (;;) {
        wire.queue.sort((a, b) => a.at - b.at || a.order - b.order);
        if (!wire.queue.length || wire.queue[0].at > end) break;
        const q = wire.queue.shift(); wire.now = q.at; q.fn();
      }
      wire.now = end;
    };
    class Channel extends Emitter {
      constructor(owner, peer, options) {
        super(); this.owner = owner; this.peer = peer; this.label = options.label; this.metadata = options.metadata;
        this.open = false; this.closed = false; this.lastReliable = 0; this.bufferSize = 0;
        this.dataChannel = { bufferedAmount: 0, ordered: options.reliable, maxRetransmits: null };
      }
      send(data) {
        if (!this.open) return;
        if (wire.silent.has(this.owner) || wire.silent.has(this.peer)) return;
        if (this.label === 'state' && wire.random() < loss) return;
        let at = wire.now + latency + (wire.random() * 2 - 1) * jitter;
        if (this.label === 'events') { at = Math.max(at, this.lastReliable + .001); this.lastReliable = at; }
        const copy = structuredClone(data);
        wire.enqueue(at - wire.now, () => { if (this.other.open && !wire.silent.has(this.owner) && !wire.silent.has(this.peer)) this.other.emit('data', copy); });
      }
      close() {
        for (const c of [this, this.other]) {
          if (!c || c.closed) continue;
          c.closed = true; c.open = false; c.emit('close');
        }
      }
    }
    wire.Peer = class extends Emitter {
      constructor(id) {
        super(); this.id = id || 'guest-' + ++wire.serial; this.disconnected = this.destroyed = false; this.connections = [];
        if (wire.peers.has(this.id)) wire.enqueue(1, () => this.emit('error', { type: 'unavailable-id' }));
        else { wire.peers.set(this.id, this); wire.enqueue(1, () => this.emit('open', this.id)); }
      }
      connect(id, options) {
        wire.dials++;
        const a = new Channel(this.id, id, options), b = new Channel(id, this.id, options); a.other = b; b.other = a;
        this.connections.push(a);
        wire.enqueue(2, () => {
          const remote = wire.peers.get(id);
          if (!remote) { this.emit('error', { type: 'peer-unavailable' }); return; }
          remote.connections.push(b); remote.emit('connection', b);
          wire.enqueue(2, () => { if (a.closed || b.closed) return; a.open = b.open = true; b.emit('open'); a.emit('open'); });
        });
        return a;
      }
      reconnect() { this.disconnected = false; wire.enqueue(1, () => this.emit('open', this.id)); }
      destroy() { this.destroyed = true; this.connections.forEach(c => c.close()); if (wire.peers.get(this.id) === this) wire.peers.delete(this.id); }
    };
    return wire;
  };
})(globalThis);
