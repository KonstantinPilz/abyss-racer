(function (root) {
  'use strict';
  const AR = root.AR = root.AR || {};
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const PHASES = ['COUNTDOWN', 'RUNNING', 'ROUND_RESULT', 'MATCH_RESULT', 'PAUSED'];
  const EFFECTS = ['ink', 'net', 'riptide', 'shield', 'turbo', 'anchor', 'spawnShield', 'torpedo', 'hit', 'siphon', 'siphonGain', 'magnet', 'magnetGain', 'dodged', 'blocked', 'gravity', 'jet', 'fireCooldown', 'jumpCooldown', 'geyserWarning', 'geyser', 'shark', 'fish'];
  const ITEMS = ['', 'ink', 'torpedo', 'net', 'siphon', 'riptide', 'shield', 'turbo', 'magnet', 'anchor', 'gravity', 'jet', 'geyser'];
  const REASONS = ['', 'Hull crushed', 'Stranded', 'Oxygen depleted', 'Torpedoed!', 'Out of air', 'Bubble hit', 'Hull lost', 'Shark bite'];
  const angle = n => Math.atan2(Math.sin(n), Math.cos(n));
  const lerpAngle = (a, b, t) => a + angle(b - a) * t;

  // Cumulative edge counters survive dropped/reordered packets, including two taps
  // between samples. The receiver consumes each edge on a physics step, never draw().
  class InputSource {
    constructor() { this.seq = this.b = this.i = this.ackB = this.ackI = 0; this.throttle = this.brake = false; }
    edge(key) { if (key === 'burst') this.b++; if (key === 'item') this.i++; }
    acknowledge(b, i) { this.ackB = Math.max(this.ackB, Math.min(this.b, b)); this.ackI = Math.max(this.ackI, Math.min(this.i, i)); }
    release() { this.throttle = this.brake = false; }
    packet(t) { return { type: 'input', seq: ++this.seq, t, throttle: this.throttle, brake: this.brake, burst: this.b > this.ackB, item: this.i > this.ackI, b: this.b, i: this.i }; }
  }
  class InputReceiver {
    constructor() { this.seq = -1; this.last = -Infinity; this.b = this.i = this.usedB = this.usedI = 0; this.throttle = this.brake = false; }
    receive(p, now) {
      if (!p || !Number.isSafeInteger(p.seq) || p.seq <= this.seq || ![p.b, p.i].every(n => Number.isSafeInteger(n) && n >= 0) || typeof p.throttle !== 'boolean' || typeof p.brake !== 'boolean') return false;
      this.seq = p.seq; this.last = now; this.throttle = p.throttle; this.brake = p.brake;
      this.b = Math.max(this.b, p.b); this.i = Math.max(this.i, p.i); return true;
    }
    held(now) { return { throttle: now - this.last < 400 && this.throttle, brake: now - this.last < 400 && this.brake }; }
    edges() { const burst = this.usedB < this.b, item = this.usedI < this.i; if (burst) this.usedB++; if (item) this.usedI++; return { burst, item }; }
    release() { this.last = -Infinity; this.usedB = this.b; this.usedI = this.i; }
  }
  class EventLedger {
    constructor(floor = 0) { this.floor = floor; this.seen = new Set(); }
    receive(event, apply) {
      if (!event || !Number.isSafeInteger(event.id) || event.id <= this.floor || this.seen.has(event.id)) return false;
      this.seen.add(event.id); apply(event);
      while (this.seen.delete(this.floor + 1)) this.floor++;
      return true;
    }
  }
  class ConnectionWatch {
    constructor(now = 0) { this.last = now; this.deadline = null; this.abandoned = false; }
    heard(now) { this.last = now; }
    drop(now) { if (this.deadline === null) this.deadline = now + 15000; }
    recover(now) { if (this.abandoned) return false; this.deadline = null; this.last = now; return true; }
    poll(now) { if (this.deadline !== null && now >= this.deadline) this.abandoned = true; return this.abandoned ? 'abandoned' : this.deadline !== null ? 'reconnecting' : 'connected'; }
  }

  // Binary snapshots: 0.1 world-pixel positions (1 cm), 16-bit angles and
  // decisecond effects. Absolute positions use int32 so long/reverse runs cannot wrap.
  const Codec = {
    encode(v, seq, now, epoch, ack = { b: 0, i: 0 }, extras = {}) {
      const bytes = new ArrayBuffer(1200), d = new DataView(bytes); let o = 0;
      const put = (type, value) => { d['set' + type](o, value, true); o += { Uint8: 1, Uint16: 2, Int16: 2, Uint32: 4, Int32: 4, Float32: 4 }[type]; };
      const u8 = x => put('Uint8', clamp(Math.round(x || 0), 0, 255));
      const u16 = x => put('Uint16', clamp(Math.round(x || 0), 0, 65535));
      const a16 = x => u16((angle(x || 0) + Math.PI) / (2 * Math.PI) * 65535);
      u8(3); put('Uint32', epoch); put('Uint32', seq); put('Float32', now); u16(v.round); u8(PHASES.indexOf(v.phase));
      u16(v.phaseTime * 100); put('Float32', v.time); u8(v.scores[0]); u8(v.scores[1]); put('Uint32', ack.b); put('Uint32', ack.i);
      u8(v.shake * 255); u8(v.flash * 255);
      for (const p of v.players) {
        const r = p.rover;
        put('Int32', Math.round(r.x * 10)); put('Int32', Math.round(r.y * 10)); a16(r.angle);
        put('Int16', clamp(Math.round(r.vx), -32768, 32767)); put('Int16', clamp(Math.round(r.vy), -32768, 32767));
        for (const w of r.wheels) { put('Int16', clamp(Math.round((w.x - r.x) * 10), -32768, 32767)); put('Int16', clamp(Math.round((w.y - r.y) * 10), -32768, 32767)); a16(w.angle); }
        u16(r.oxygen * 100); u8(r.cooldown * 10); u8(p.respawn * 50); u8(REASONS.indexOf(r.crashed));
        u8((p.out ? 1 : 0) | (p.catchup ? 2 : 0) | (p.slipstream ? 4 : 0) | (r.ghosting ? 8 : 0) | (r.grounded ? 16 : 0) | (p.respawnKind === 'blackout' ? 32 : p.respawnKind === 'crash' ? 64 : 0));
        u8(ITEMS.indexOf(p.item || '')); u8(p.charges); u8(p.lives); u8(p.facing < 0 ? 0 : 1); u16(p.crashes); u16(p.blackouts); u16(p.itemsUsed);
        put('Uint32', p.pearls); put('Uint32', Math.round(p.distance * 10));
        u16(p.carryTime * 100); u16(p.steals); put('Int32', Math.round((p.geyserX || 0) * 10)); put('Int32', Math.round((p.geyserY || 0) * 10));
        u8((r.environment?.plankton ? 1 : 0) | (r.environment?.mud ? 2 : 0));
        for (const key of EFFECTS) u8((p.effects[key] || 0) * 10);
      }
      // Visible projectiles only; the authoritative world is never capped.
      const shots = (v.projectiles || []).filter(q => v.players.some(p => Math.abs(p.rover.x - q.x) < 2600)).slice(0, 12);
      u8(shots.length);
      for (const q of shots) { u16(q.id); u8((q.type === 'anchor' ? 2 : q.type === 'bubble' ? 4 : 0) | q.owner); put('Int32', Math.round(q.x * 10)); put('Int32', Math.round(q.y * 10)); a16(q.angle || (q.direction < 0 ? Math.PI : 0)); u8(q.life * 10); }
      const visibleSharks = new Map();
      for (const p of v.players) for (const q of [...(v.hazards?.sharks || [])].sort((a, b) => Math.abs(a.x - p.rover.x) - Math.abs(b.x - p.rover.x)).slice(0, 2)) visibleSharks.set(q.id, q);
      const sharks = [...visibleSharks.values()];
      u8(sharks.length);
      for (const shark of sharks) {
        put('Int32', shark.id); put('Int32', Math.round(shark.x * 10)); put('Int32', Math.round(shark.y * 10));
        u8(['patrol', 'warning', 'lunge', 'recover'].indexOf(shark.phase)); u8(shark.direction < 0 ? 0 : 1); u8(shark.timer * 10);
        put('Int16', clamp(Math.round((shark.aimX ?? shark.x + shark.direction * 600) - shark.x), -32768, 32767)); put('Int16', clamp(Math.round((shark.aimY ?? shark.y) - shark.y), -32768, 32767)); u8(shark.fish ? 1 : 0);
      }
      const bridges = [...(v.terrain.bridges || [])].filter(([id]) => v.players.some(p => Math.abs(p.rover.x - (2060 + id * 2600)) < 2800)).slice(0, 6);
      u8(bridges.length); for (const [id, at] of bridges) { put('Int32', id); put('Float32', at); }
      u8(v.chest ? 1 : 0);
      if (v.chest) { const c = v.chest; put('Int32', Math.round(c.x * 10)); put('Int32', Math.round(c.y * 10)); u8(c.carrier + 1); u8(c.previous + 1); u8(c.lock * 100); }
      // Bounded redundant delta hints. The complete batch also travels reliably,
      // so a busy frame or dropped snapshot cannot lose a pickup or an effect.
      let hints = { p: extras.pickups || [], e: extras.events || [] };
      let tail = new TextEncoder().encode(JSON.stringify(hints));
      while (o + 2 + tail.length > 590 && (hints.p.length || hints.e.length)) {
        hints = { p: hints.p.slice(0, Math.max(0, hints.p.length - 1)), e: hints.e.slice(0, Math.max(0, hints.e.length - 1)) };
        tail = new TextEncoder().encode(JSON.stringify(hints));
      }
      u16(tail.length); new Uint8Array(bytes, o, tail.length).set(tail); o += tail.length;
      return bytes.slice(0, o);
    },
    decode(bytes) {
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > 1200 || bytes.byteLength < 160) throw new Error('Invalid snapshot');
      const d = new DataView(bytes); let o = 0;
      const get = type => { const n = d['get' + type](o, true); o += { Uint8: 1, Uint16: 2, Int16: 2, Uint32: 4, Int32: 4, Float32: 4 }[type]; return n; };
      const u8 = () => get('Uint8'), u16 = () => get('Uint16'), a16 = () => u16() / 65535 * 2 * Math.PI - Math.PI;
      if (u8() !== 3) throw new Error('Snapshot version mismatch');
      const s = { epoch: get('Uint32'), seq: get('Uint32'), t: get('Float32'), round: u16(), phase: PHASES[u8()], phaseTime: u16() / 100, time: get('Float32'), scores: [u8(), u8()], ack: { b: get('Uint32'), i: get('Uint32') }, shake: u8() / 255, flash: u8() / 255, players: [] };
      for (let i = 0; i < 2; i++) {
        const r = { x: get('Int32') / 10, y: get('Int32') / 10, angle: a16(), vx: get('Int16'), vy: get('Int16'), wheels: [] };
        for (let j = 0; j < 2; j++) r.wheels.push({ x: r.x + get('Int16') / 10, y: r.y + get('Int16') / 10, angle: a16() });
        r.oxygen = u16() / 100; r.cooldown = u8() / 10; const respawn = u8() / 50; r.crashed = REASONS[u8()] || '';
        const flags = u8(); r.ghosting = !!(flags & 8); r.grounded = !!(flags & 16);
        const p = { rover: r, respawn, out: !!(flags & 1), catchup: !!(flags & 2), slipstream: !!(flags & 4), respawnKind: flags & 32 ? 'blackout' : flags & 64 ? 'crash' : '', item: ITEMS[u8()] || null, charges: u8(), lives: u8(), facing: u8() ? 1 : -1, crashes: u16(), blackouts: u16(), itemsUsed: u16(), pearls: get('Uint32'), distance: get('Uint32') / 10, effects: {} };
        p.carryTime = u16() / 100; p.steals = u16(); p.geyserX = get('Int32') / 10; p.geyserY = get('Int32') / 10;
        const env = u8(); r.environment = { plankton: !!(env & 1), mud: !!(env & 2) };
        for (const key of EFFECTS) p.effects[key] = u8() / 10;
        s.players.push(p);
      }
      s.projectiles = []; const n = u8(); if (n > 12) throw new Error('Invalid projectile count');
      for (let i = 0; i < n; i++) { const id = u16(), flags = u8(); s.projectiles.push({ id, type: flags & 4 ? 'bubble' : flags & 2 ? 'anchor' : 'torpedo', owner: flags & 1, x: get('Int32') / 10, y: get('Int32') / 10, angle: a16(), life: u8() / 10 }); }
      s.sharks = []; const sharks = u8(); if (sharks > 4) throw new Error('Invalid shark count');
      for (let i = 0; i < sharks; i++) {
        const q = { id: get('Int32'), x: get('Int32') / 10, y: get('Int32') / 10, phase: ['patrol', 'warning', 'lunge', 'recover'][u8()], direction: u8() ? 1 : -1, timer: u8() / 10 };
        q.aimX = q.x + get('Int16'); q.aimY = q.y + get('Int16'); q.fish = !!u8(); s.sharks.push(q);
      }
      s.bridges = []; const bridges = u8(); if (bridges > 6) throw new Error('Invalid bridge count');
      for (let i = 0; i < bridges; i++) s.bridges.push([get('Int32'), get('Float32')]);
      s.chest = u8() ? { x: get('Int32') / 10, y: get('Int32') / 10, carrier: u8() - 1, previous: u8() - 1, lock: u8() / 100, vx: 0, vy: 0 } : null;
      const length = u16(); if (o + length !== bytes.byteLength || !s.phase || !Number.isFinite(s.t + s.time)) throw new Error('Invalid snapshot data');
      const hints = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, o, length))); s.pickups = hints.p; s.events = hints.e;
      return s;
    }
  };

  class SnapshotBuffer {
    constructor() { this.reset(); }
    reset() { this.frames = []; this.offset = null; this.cursor = -Infinity; }
    push(s, arrival) {
      const last = this.frames[this.frames.length - 1];
      if (last && s.seq <= last.seq) return false;
      if (last && (s.round !== last.round || s.epoch !== last.epoch)) this.reset();
      const offset = arrival - s.t; this.offset = this.offset === null ? offset : Math.min(this.offset, offset);
      this.frames.push(s); if (this.frames.length > 12) this.frames.shift(); return true;
    }
    sample(now) {
      if (!this.frames.length) return null;
      this.cursor = Math.max(this.cursor, now - this.offset - 100);
      let a = this.frames[0], b = a;
      for (const s of this.frames) { if (s.t <= this.cursor) a = s; b = s; if (s.t >= this.cursor) break; }
      const t = a === b ? 1 : clamp((this.cursor - a.t) / (b.t - a.t), 0, 1);
      const late = a === b && a.phase === 'RUNNING' ? clamp((this.cursor - a.t) / 1000, 0, .15) : 0;
      const out = { ...b, players: b.players.map((p, i) => {
        const old = a.players[i].rover, r = p.rover;
        // Crashes and respawns are discontinuities: never interpolate through sand.
        const snap = a.players[i].respawnKind !== p.respawnKind || a.players[i].out !== p.out;
        const f = snap ? 1 : t, dx = p.respawn || p.out ? 0 : r.vx * late, dy = p.respawn || p.out ? 0 : r.vy * late;
        const pose = (x, y) => ({ x: x.x + (y.x - x.x) * f + dx, y: x.y + (y.y - x.y) * f + dy, angle: lerpAngle(x.angle, y.angle, f) });
        return { ...p, rover: { ...r, ...pose(old, r), wheels: r.wheels.map((w, j) => pose(old.wheels[j], w)) } };
      }) };
      const previous = a === b ? this.frames[this.frames.indexOf(b) - 1] : a;
      out.projectiles = b.projectiles.map(q => {
        const old = previous?.projectiles.find(p => p.id === q.id);
        if (!old) return q;
        const f = a === b ? 1 + late * 1000 / Math.max(1, b.t - previous.t) : t;
        return { ...q, x: old.x + (q.x - old.x) * f, y: old.y + (q.y - old.y) * f, angle: lerpAngle(old.angle, q.angle, Math.min(1, f)) };
      });
      out.sharks = (b.sharks || []).map(shark => {
        const old = a.sharks?.find(q => q.id === shark.id);
        return old ? { ...shark, x: old.x + (shark.x - old.x) * t, y: old.y + (shark.y - old.y) * t } : shark;
      });
      return out;
    }
  }

  // In-process deterministic transport; manual pump() needs no DOM, network or timers.
  class LoopbackTransport {
    static pair(options = {}) {
      const wire = { now: 0, queue: [], latency: options.latency ?? 40, jitter: options.jitter ?? 10, loss: options.loss || 0, seed: options.seed || 7, up: true, order: 0 };
      const a = new LoopbackTransport(wire), b = new LoopbackTransport(wire); a.other = b; b.other = a; return [a, b];
    }
    constructor(wire) { this.wire = wire; this.connected = true; this.handlers = {}; this.lastReliable = 0; }
    on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
    emit(type, value) { (this.handlers[type] || []).forEach(fn => fn(value)); }
    send(data, channel = 'events') {
      const w = this.wire; if (!w.up || !this.connected) return false;
      const random = () => { w.seed = (Math.imul(w.seed, 1664525) + 1013904223) >>> 0; return w.seed / 4294967296; };
      if (channel === 'state' && random() < w.loss) return false;
      let at = w.now + Math.max(0, w.latency + (random() * 2 - 1) * w.jitter);
      if (channel === 'events') { at = Math.max(at, this.lastReliable); this.lastReliable = at; }
      w.queue.push({ at, order: ++w.order, to: this.other, data: structuredClone(data), channel }); return true;
    }
    pump(ms) {
      const w = this.wire, end = w.now + ms;
      while (true) { w.queue.sort((a, b) => a.at - b.at || a.order - b.order); if (!w.queue.length || w.queue[0].at > end) break; const q = w.queue.shift(); w.now = q.at; if (w.up && q.to.connected) q.to.emit('data', { data: q.data, channel: q.channel }); }
      w.now = end;
    }
    drop() { this.wire.up = false; this.wire.queue = []; for (const t of [this, this.other]) { t.connected = false; t.emit('close'); } }
    reconnect() { this.wire.up = true; for (const t of [this, this.other]) { t.connected = true; t.emit('open'); } }
    close() { this.drop(); }
  }
  AR.OnlineCore = { InputSource, InputReceiver, EventLedger, ConnectionWatch, Codec, SnapshotBuffer, PHASES, EFFECTS };
  AR.LoopbackTransport = LoopbackTransport;
})(globalThis);
