(function (root) {
  'use strict';
  const AR = root.AR, C = AR.OnlineCore;
  const KEYS = { KeyA: 'brake', ArrowLeft: 'brake', KeyD: 'throttle', ArrowRight: 'throttle', KeyW: 'burst', ArrowUp: 'burst', Space: 'burst', KeyS: 'item', ArrowDown: 'item' };
  const validConfig = c => c && ['race', 'survival', 'pearl', 'arena', 'treasure'].includes(c.mode) && (c.carryTarget === undefined || [20, 30, 45].includes(c.carryTarget)) && [500, 1000, 2000].includes(c.target) && [1, 3, 5].includes(c.bestOf) && AR.STAGES.some(s => s.id === c.stage) && Array.isArray(c.vehicles) && c.vehicles.length === 2 && c.vehicles.every(id => AR.VEHICLES.some(v => v.id === id));
  class Online {
    constructor(versus, options = {}) {
      this.v = versus; this.headless = !!options.headless; this.now = options.now || (() => performance.now());
      this.sound = versus.sound; this.active = false; this.role = null; this.state = 'ENTRY'; this.epoch = 0; this.seq = 0; this.eventId = 0;
      this.source = new C.InputSource(); this.inputs = [new C.InputReceiver(), new C.InputReceiver()];
      this.buffer = new C.SnapshotBuffer(); this.ledger = new C.EventLedger(); this.pendingEvents = []; this.journal = []; this.sentPickups = new Set();
      this.watch = new C.ConnectionWatch(this.now()); this.metrics = { snapshots: 0, bytes: 0, maxBytes: 0, rtts: [], events: {}, hitEvents: 0, reconnects: 0, recoveries: 0, invalidPackets: 0 };
      this.held = { throttle: new Set(), brake: new Set() }; this.keys = new Set(); this.ui = options.ui || (this.headless ? { render() {}, show() {}, status() {} } : new AR.OnlineUI(this));
      if (!this.headless) this.timer = setInterval(() => this.maintain(), 100);
    }
    open(join = '') {
      this.active = this.v.active = true; this.v.network = this; this.v.phase = 'SETUP'; this.state = join ? 'JOIN' : 'ENTRY'; this.code = join;
      this.clearInput(); this.sound.suspend(); this.ui.render(); this.show();
    }
    create() { this.connect('host', AR.onlineRoomCode()); }
    join(code) {
      code = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      if (code.length !== 4 || [...code].some(c => !AR.ONLINE_ALPHABET.includes(c))) { this.error = 'Use the four characters shown on the host phone (no I, L, O, 0 or 1).'; this.ui.status(); return; }
      this.connect('guest', code);
    }
    connect(role, code) {
      this.transport?.close(); this.open(); this.role = role; this.index = role === 'host' ? 0 : 1; this.code = code; this.state = 'CONNECTING'; this.error = ''; this.deadline = this.now() + 15000;
      this.attach(role, new AR.PeerTransport(role, code), code); this.ui.render(); this.transport.start();
    }
    attach(role, transport, code = 'TEST') {
      this.role = role; this.index = role === 'host' ? 0 : 1; this.code = code; this.active = this.v.active = true; this.v.network = this; this.transport = transport;
      this.v.sound = { unlock: () => this.sound.unlock(), suspend: () => this.sound.suspend(), setMuted: value => this.sound.setMuted(value), update: (s, dt) => this.sound.update(s, dt), play: name => { this.sound.play(name); this.event('sound', { name }); } };
      this.watch = new C.ConnectionWatch(this.now()); this.abandoned = false; this.lastPing = this.lastBeat = this.lastRetry = -Infinity; this.rtt = null;
      this.source = new C.InputSource(); this.inputs = [new C.InputReceiver(), new C.InputReceiver()]; this.lobbyRev = 0; this.v.ready = [false, false]; this.protocolReady = false;
      const current = fn => value => { if (this.active && this.transport === transport) fn(value); };
      transport.on('room', current(code => { this.code = code; if (role === 'host' && this.state === 'CONNECTING') { this.state = 'WAITING'; this.deadline = null; this.ui.render(); } }));
      transport.on('connecting', current(() => { if (this.state === 'WAITING' && !this.deadline) this.deadline = this.now() + 15000; }));
      transport.on('open', current(() => this.connected()));
      transport.on('data', current(({ data, channel }) => this.receive(data, channel)));
      transport.on('close', current(() => this.lost()));
      transport.on('error', current(error => {
        this.lastError = error.type;
        if (this.state === 'RECONNECTING') return;
        if (['MATCH', 'LOBBY'].includes(this.state)) { if (!transport.connected) this.lost(); return; }
        const reason = error.type === 'peer-unavailable' ? 'Room not found. Check the code and keep the host screen open.' : error.type === 'unavailable-id' ? 'That room code is busy. Create another room.' : error.type === 'load' ? error.message : 'The signalling broker is unavailable. Check your internet connection and try again.';
        this.fail(reason);
      }));
      return this;
    }
    connected() {
      this.deadline = null; this.watch.heard(this.now());
      this.send({ type: 'hello', version: AR.VERSION });
      if (this.role === 'host') {
        if (this.v.players.length && this.v.phase !== 'SETUP' && this.state === 'RECONNECTING') this.sendSync();
        else { this.state = 'LOBBY'; this.watch.recover(this.now()); this.lobby(); }
      }
      this.ui.render();
    }
    send(data, channel = 'events') { return !!this.transport?.send(data, channel); }
    lobby() { this.send({ type: 'lobby', config: this.v.config, ready: this.v.ready, rev: this.lobbyRev }); this.ui.render(); }
    configure(key, value) {
      if (this.state !== 'LOBBY') return;
      if (key === 'vehicle') {
        if (!AR.VEHICLES.some(v => v.id === value)) return;
        if (this.role === 'guest') { this.send({ type: 'vehicle', id: value }); return; }
        this.v.config.vehicles[0] = value;
      } else {
        if (this.role !== 'host') return;
        const next = { ...this.v.config, [key]: value }; if (!validConfig(next)) return; this.v.config = next;
      }
      this.v.ready = [false, false]; this.lobbyRev++; this.lobby();
    }
    ready() {
      this.sound.unlock(); this.wake();
      if (this.state !== 'LOBBY' || !this.protocolReady) return;
      if (this.role === 'host') { this.v.ready[0] = !this.v.ready[0]; this.lobby(); }
      else this.send({ type: 'ready', value: !this.v.ready[1], rev: this.lobbyRev });
    }
    start() {
      if (this.role !== 'host' || this.state !== 'LOBBY' || !this.protocolReady || !this.v.ready.every(Boolean) || !this.transport.connected) return;
      this.epoch++; this.eventId = 0; this.seq = 0; this.journal = []; this.pendingEvents = []; this.ledger = new C.EventLedger();
      this.state = 'MATCH'; this.lastPhase = ''; this.starting = true; this.v.startMatch(); this.starting = false; this.wake(); this.ui.render(); this.publishPhase(); this.snapshot();
    }
    roundStarted() {
      this.sentPickups = new Set(); this.buffer.reset();
      if (this.role !== 'host' || this.applying) return;
      this.send({ type: 'round', epoch: this.epoch, round: this.v.round, config: this.v.matchConfig, scores: this.v.scores, totals: this.v.totals, eventFloor: this.eventId });
    }
    makeRound(m) {
      if (!validConfig(m.config) || !Number.isInteger(m.round) || m.round < 1 || !Number.isInteger(m.epoch) || m.epoch < this.epoch) return false;
      const changed = this.epoch !== m.epoch;
      this.epoch = m.epoch; this.v.matchConfig = structuredClone(m.config); this.v.config = structuredClone(m.config); this.v.round = m.round; this.v.scores = m.scores.slice(); this.v.totals = structuredClone(m.totals);
      this.state = 'MATCH'; this.applying = true; this.v.newRound(); this.applying = false;
      this.ledger = new C.EventLedger(m.eventFloor || 0); if (changed) this.v.matchSaved = false;
      this.lastReceived = -1; this.ui.render(); this.wake(); return true;
    }
    event(type, data) {
      if (this.role !== 'host' || this.applying || this.state !== 'MATCH') return;
      const event = { id: ++this.eventId, type, ...data }; this.pendingEvents.push(event); this.journal.push(event);
    }
    applyEvent(e) {
      this.ledger.receive(e, event => {
        this.metrics.events[event.type] = (this.metrics.events[event.type] || 0) + 1;
        if (event.type === 'crate' && typeof event.key === 'string' && [0, 1].includes(event.index) && Number.isFinite(event.readyAt)) {
          const cooldown = this.v.crateCooldowns.get(event.key) || [0, 0];
          cooldown[event.index] = Math.max(cooldown[event.index], event.readyAt);
          this.v.crateCooldowns.set(event.key, cooldown);
        }
        if (event.type === 'collapse' && Number.isInteger(event.bridge) && Number.isFinite(event.at)) { this.v.terrain.bridges.set(event.bridge, event.at); this.v.terrain.revision++; }
        if (event.type === 'chest' && event.chest && Number.isFinite(event.chest.x + event.chest.y)) this.v.chest = { ...event.chest };
        if (event.type === 'sound' && typeof event.name === 'string') this.sound.play(event.name);
        if (event.type === 'toast' && typeof event.text === 'string') this.v.players.forEach(p => { p.toast = event.text.slice(0, 180); p.toastTime = 3; });
        if (event.type === 'hit') { this.metrics.hitEvents++; if (this.v.players[event.victim]) this.v.players[event.victim].effects.hit = .8; }
        if (event.type === 'explosion' && Number.isFinite(event.x + event.y)) { this.v.explosions.push({ x: event.x, y: event.y, life: .8, maxLife: .8 }); this.v.shake = 1; this.v.flash = .22; }
      });
    }
    applyPickups(keys) {
      for (const key of keys || []) if (typeof key === 'string') this.v.collected.add(key);
      this.v.pickups = this.v.pickups.filter(p => !this.v.collected.has(p.key));
    }
    snapshot() {
      if (this.role !== 'host' || !this.v.players.length || !C.PHASES.includes(this.v.phase)) return;
      const pickups = [...this.v.collected].filter(key => !this.sentPickups.has(key)); pickups.forEach(key => this.sentPickups.add(key));
      const events = this.pendingEvents.splice(0);
      if (pickups.length || events.length) this.send({ type: 'delta', epoch: this.epoch, round: this.v.round, pickups, events });
      const remote = this.inputs[1];
      const bytes = C.Codec.encode(this.v, ++this.seq, this.now(), this.epoch, { b: remote.usedB, i: remote.usedI }, { pickups, events });
      this.metrics.snapshots++; this.metrics.bytes += bytes.byteLength; this.metrics.maxBytes = Math.max(this.metrics.maxBytes, bytes.byteLength);
      this.send(bytes, 'state');
    }
    phaseData() { const v = this.v; return { type: 'phase', epoch: this.epoch, round: v.round, phase: v.phase, beforePause: v.beforePause, phaseTime: v.phaseTime, time: v.time, scores: v.scores, totals: v.totals, roundWinner: v.roundWinner, roundReason: v.roundReason, matchWinner: v.matchWinner, roundStats: v.players.map(p => ({ carryTime: p.carryTime, steals: p.steals })) }; }
    publishPhase() { this.lastPhase = this.v.phase; this.send(this.phaseData()); if (this.v.phase === 'MATCH_RESULT') this.releaseWake(); this.ui.show(); }
    phase(m) {
      if (m.epoch !== this.epoch || m.round !== this.v.round || !C.PHASES.includes(m.phase)) return;
      const v = this.v; const changed = v.phase !== m.phase;
      for (const key of ['phase', 'beforePause', 'phaseTime', 'time', 'scores', 'totals', 'roundWinner', 'roundReason', 'matchWinner']) if (m[key] !== undefined) v[key] = structuredClone(m[key]);
      if (Array.isArray(m.roundStats)) m.roundStats.forEach((stats, i) => { if (v.players[i] && Number.isFinite(stats.carryTime + stats.steals)) Object.assign(v.players[i], stats); });
      v.remaining = Math.max(0, (v.matchConfig.mode === 'arena' ? 120 : 90) - v.time);
      if (this.state === 'RECONNECTING' && this.transport.connected) { this.watch.recover(this.now()); this.state = 'MATCH'; }
      if (changed) { this.clearInput(); v.show(); }
      if (['ROUND_RESULT', 'MATCH_RESULT'].includes(m.phase)) { v.resultUI(m.phase === 'MATCH_RESULT'); this.ui.show(); }
      if (m.phase === 'MATCH_RESULT' && !v.matchSaved && [0, 1].includes(m.matchWinner)) { v.save.finishVersus(m.matchWinner); v.matchSaved = true; this.releaseWake(); }
      this.ui.status();
    }
    receive(m, channel = 'events') {
      this.watch.heard(this.now());
      try {
        if (m instanceof ArrayBuffer) {
          if (this.role !== 'guest' || this.state !== 'MATCH') return;
          const s = C.Codec.decode(m); if (s.epoch !== this.epoch || s.round !== this.v.round) return;
          this.source.acknowledge(s.ack.b, s.ack.i);
          // Process delta hints even from reordered snapshots; pose seq stays monotonic.
          this.applyPickups(s.pickups); s.events.forEach(e => this.applyEvent(e));
          if (this.buffer.push(s, this.now())) { this.lastReceived = s.seq; this.metrics.snapshots++; this.metrics.bytes += m.byteLength; this.metrics.maxBytes = Math.max(this.metrics.maxBytes, m.byteLength); }
          return;
        }
        if (!m || typeof m !== 'object') return;
        if (m.type === 'hello') {
          if (m.version !== AR.VERSION) { this.fail('Game versions differ. Reload both devices, then create a new room.'); return; }
          this.protocolReady = true; if (this.role === 'host' && this.state === 'LOBBY') this.lobby(); this.ui.status(); return;
        }
        if (m.type === 'ping') { this.send({ type: 'pong', t: m.t }); return; }
        if (m.type === 'pong') { if (m.t !== this.pingSent) return; this.rtt = Math.max(0, Math.round(this.now() - m.t)); this.metrics.rtts.push(this.rtt); if (this.metrics.rtts.length > 120) this.metrics.rtts.shift(); this.ui.status(); return; }
        if (m.type === 'beat') { if (this.role === 'host' && Number.isSafeInteger(m.ack)) this.journal = this.journal.filter(e => e.id > m.ack); return; }
        if (m.type === 'leave') { this.abandon('The other diver left. This match was abandoned.'); return; }
        if (this.role === 'host') {
          if (m.type === 'input' && this.state === 'MATCH' && m.epoch === this.epoch && m.round === this.v.round) {
            this.inputs[1].receive(m, this.now()); if (!['COUNTDOWN', 'RUNNING'].includes(this.v.phase)) this.inputs[1].release();
          }
          if (this.state === 'LOBBY') {
            if (m.type === 'vehicle' && AR.VEHICLES.some(v => v.id === m.id)) { this.v.config.vehicles[1] = m.id; this.v.ready = [false, false]; this.lobbyRev++; this.lobby(); }
            if (m.type === 'ready' && m.rev === this.lobbyRev && typeof m.value === 'boolean') { this.v.ready[1] = m.value; this.lobby(); }
          }
          if (m.type === 'pause') this.pause();
          if (m.type === 'resume') this.resume();
          if (m.type === 'syncAck' && m.epoch === this.epoch && this.state === 'RECONNECTING') {
            this.metrics.recoveries++;
            this.watch.recover(this.now()); this.state = 'MATCH';
            if (this.resumeAfterReconnect) this.v.resume(true);
            this.resumeAfterReconnect = false; this.publishPhase(); this.ui.render(); this.snapshot();
          }
        } else {
          if (m.type === 'lobby' && validConfig(m.config)) { this.v.config = structuredClone(m.config); this.v.ready = m.ready.map(Boolean); this.lobbyRev = m.rev; this.v.phase = 'SETUP'; this.state = 'LOBBY'; this.watch.recover(this.now()); this.ui.render(); }
          if (m.type === 'round') this.makeRound(m);
          if (m.type === 'phase') this.phase(m);
          if (m.type === 'delta' && m.epoch === this.epoch && m.round === this.v.round) { this.applyPickups(m.pickups); m.events.forEach(e => this.applyEvent(e)); }
          if (m.type === 'sync') {
            const saved = this.epoch === m.epoch && this.v.matchSaved;
            if (!this.makeRound(m)) return;
            this.v.matchSaved = saved; this.applyPickups(m.collected);
            this.v.crateCooldowns = new Map(m.crateCooldowns || []);
            if (Array.isArray(m.bridges)) { this.v.terrain.bridges = new Map(m.bridges); this.v.terrain.revision++; }
            const s = C.Codec.decode(m.snapshot); this.buffer.push(s, this.now()); this.applySnapshot(s); this.phase(m.phaseData);
            this.send({ type: 'syncAck', epoch: this.epoch }); this.state = 'RECONNECTING'; this.ui.render();
            this.metrics.recoveries++;
          }
        }
      } catch (_) { this.metrics.invalidPackets++; }
    }
    sendSync() {
      const v = this.v;
      this.send({ type: 'sync', epoch: this.epoch, round: v.round, config: v.matchConfig, scores: v.scores, totals: v.totals, eventFloor: this.eventId, collected: [...v.collected], crateCooldowns: [...v.crateCooldowns], bridges: [...v.terrain.bridges], phaseData: this.phaseData(), snapshot: C.Codec.encode(v, ++this.seq, this.now(), this.epoch) });
    }
    controls(i) { return this.inputs[i].held(this.now()); }
    consumeEdges() {
      this.inputs[0].receive(this.source.packet(this.now()), this.now());
      for (let i = 0; i < 2; i++) { const e = this.inputs[i].edges(); this.v.pendingBurst[i] ||= e.burst; if (e.item) this.v.useItem(i); }
      this.source.acknowledge(this.inputs[0].usedB, this.inputs[0].usedI);
    }
    control(key, pressed, id = key) {
      if (!['MATCH'].includes(this.state) || !['RUNNING', 'COUNTDOWN'].includes(this.v.phase)) return;
      if (key === 'burst' || key === 'item') { if (pressed) this.source.edge(key); }
      else if (this.held[key]) { if (pressed) this.held[key].add(id); else this.held[key].delete(id); this.source[key] = this.held[key].size > 0; }
      this.sendInput('events');
    }
    sendInput(channel = 'state') {
      if (this.role !== 'guest' || !this.active) return;
      this.send({ ...this.source.packet(this.now()), epoch: this.epoch, round: this.v.round }, channel);
    }
    pumpInput() {
      // Time slots avoid accumulating a frame of drift when 33.333 ms lies
      // between two animation frames. A slow frame never queues an input backlog.
      const slot = Math.floor(this.now() * 30 / 1000);
      if (this.role === 'guest' && this.state === 'MATCH' && slot !== this.lastInputSlot) { this.lastInputSlot = slot; this.sendInput(); }
    }
    clearInput() {
      this.source.release(); this.keys.clear(); Object.values(this.held).forEach(s => s.clear()); this.inputs.forEach(i => i.release());
      this.sendInput('events'); if (!this.headless) document.querySelectorAll('.online-pedal').forEach(b => b.classList.remove('active'));
    }
    keydown(e) {
      if (e.target.matches('input,textarea,select')) return;
      if (KEYS[e.code] || ['Escape', 'KeyP'].includes(e.code)) e.preventDefault();
      this.sound.unlock();
      if (KEYS[e.code] && !e.repeat && !this.keys.has(e.code)) { this.keys.add(e.code); this.control(KEYS[e.code], true, e.code); }
      if (['Escape', 'KeyP'].includes(e.code) && !e.repeat) { if (this.state !== 'MATCH') { if (e.code === 'Escape' && ['ENTRY', 'JOIN'].includes(this.state)) this.close(); } else if (this.v.phase === 'PAUSED') this.resume(); else this.pause(); }
      if (e.code === 'KeyM' && !e.repeat) { this.v.save.data.settings.muted = !this.v.save.data.settings.muted; this.sound.setMuted(this.v.save.data.settings.muted); this.v.save.save(); }
    }
    keyup(e) { this.keys.delete(e.code); if (KEYS[e.code]) this.control(KEYS[e.code], false, e.code); }
    pause() {
      this.clearInput(); if (this.state !== 'MATCH' || !['RUNNING', 'COUNTDOWN', 'ROUND_RESULT'].includes(this.v.phase)) return;
      if (this.role === 'guest') { this.send({ type: 'pause' }); return; }
      this.v.pause(true); this.publishPhase(); this.ui.show(); this.snapshot();
    }
    resume() {
      if (this.state !== 'MATCH' || this.v.phase !== 'PAUSED' || !this.transport?.connected) return;
      this.sound.unlock(); this.wake();
      if (this.role === 'guest') this.send({ type: 'resume' });
      else { this.v.resume(true); this.publishPhase(); this.snapshot(); }
    }
    returnLobby() {
      if (this.state === 'RECONNECTING' || !this.transport?.connected) { this.close(); return; }
      if (this.role !== 'host') return;
      this.v.phase = 'SETUP'; this.state = 'LOBBY'; this.v.ready = [false, false]; this.clearInput(); this.sound.suspend(); this.releaseWake(); this.lobby(); this.show();
    }
    lost() {
      if (!this.active || this.state === 'RECONNECTING' || this.abandoned || ['ERROR', 'ENTRY', 'JOIN', 'CONNECTING', 'WAITING'].includes(this.state)) return;
      this.watch.drop(this.now()); this.state = 'RECONNECTING'; this.clearInput();
      this.metrics.reconnects++;
      this.resumeAfterReconnect = this.role === 'host' && ['RUNNING', 'COUNTDOWN', 'ROUND_RESULT'].includes(this.v.phase);
      if (this.resumeAfterReconnect) this.v.pause(true);
      this.sound.suspend();
      if (this.transport.resetChannels) { this.transport.connected = false; this.transport.resetChannels(); }
      this.ui.render(); this.show();
    }
    fail(reason) { this.deadline = null; this.error = reason; this.state = 'ERROR'; this.transport?.close(); this.sound.suspend(); this.ui.render(); this.show(); }
    abandon(reason = 'The connection did not recover within 15 seconds. Match abandoned; no result was added.') { this.abandoned = true; this.watch.abandoned = true; this.v.phase = 'PAUSED'; this.clearInput(); this.releaseWake(); this.fail(reason); }
    retry() { if (this.role === 'guest') this.connect('guest', this.code); else this.create(); }
    maintain() {
      if (!this.active) return;
      const now = this.now();
      if (this.deadline && now >= this.deadline) { this.fail('Could not connect within 15 seconds. The broker may be down, or these networks may block TURN relay traffic. Check the code, try Wi-Fi or mobile data, then retry.'); return; }
      if (['MATCH', 'LOBBY'].includes(this.state) && now - this.watch.last > 2000) this.lost();
      if (this.state === 'RECONNECTING') {
        if (this.watch.poll(now) === 'abandoned') { this.abandon(); return; }
        if (now - this.lastRetry > 1000) { this.lastRetry = now; this.transport?.reconnect(); }
        this.ui.status();
      }
      if (!this.transport?.connected) return;
      if (now - this.lastBeat >= 500) { this.lastBeat = now; this.send({ type: 'beat', ack: this.ledger.floor }); }
      if (now - this.lastPing >= 2000) { this.lastPing = this.pingSent = now; this.send({ type: 'ping', t: now }); }
      this.pumpInput();
    }
    tick(dt) {
      if (this.headless) this.maintain();
      if (this.state !== 'MATCH') return;
      this.pumpInput();
      if (this.role === 'host') {
        this.v.tick(dt, true);
        if (this.v.phase !== this.lastPhase) this.publishPhase();
        this.snapshotClock = (this.snapshotClock || 0) + dt;
        if (this.snapshotClock >= .05) { this.snapshotClock %= .05; this.snapshot(); this.ui.status(); }
      } else {
        const s = this.buffer.sample(this.now()); if (s) this.applySnapshot(s);
        // Only presentation timers run here. No Rover.step(), Versus.step(),
        // collect(), projectile update or match adjudication runs on the guest.
        for (const p of this.v.players) p.toastTime = Math.max(0, p.toastTime - dt);
        for (const e of this.v.explosions) e.life -= dt;
        this.v.explosions = this.v.explosions.filter(e => e.life > 0);
        this.hudClock = (this.hudClock || 0) + dt;
        if (this.hudClock >= .08) { this.v.hud(); this.hudClock = 0; this.ui.status(); }
        const p = this.v.players[1]; if (p) this.sound.update({ running: this.v.phase === 'RUNNING' && !p.respawn && !p.out, throttle: this.source.throttle, speed: Math.abs(p.rover.vx), oxygenFraction: p.rover.oxygen / p.rover.maxOxygen }, dt);
      }
    }
    applySnapshot(s) {
      if (s.round !== this.v.round || s.epoch !== this.epoch) return;
      const v = this.v;
      for (let i = 0; i < 2; i++) {
        const p = v.players[i], incoming = s.players[i]; if (!p) return;
        const r = p.rover; Object.assign(p, { ...incoming, rover: r });
        const wheels = r.wheels; Object.assign(r, { ...incoming.rover, wheels });
        wheels.forEach((w, j) => Object.assign(w, incoming.rover.wheels[j])); r.gravityFlipped = p.effects.gravity > 0; r.jetThrust = p.effects.jet > 0 ? 240 : 0; r.savePrevious();
        p.crashReason = r.crashed || (p.respawnKind === 'blackout' ? 'Out of air' : 'Hull crushed');
      }
      v.time = s.time; v.remaining = Math.max(0, (v.matchConfig.mode === 'arena' ? 120 : 90) - s.time); v.phaseTime = s.phaseTime; v.scores = s.scores; v.projectiles = s.projectiles; v.shake = s.shake; v.flash = s.flash;
      v.chest = s.chest;
      const oldTime = v.terrain.worldTime; v.terrain.worldTime = s.time;
      for (const [id, at] of s.bridges || []) { if (!v.terrain.bridges.has(id)) v.terrain.revision++; v.terrain.bridges.set(id, at); }
      for (const at of v.terrain.bridges.values()) if (oldTime - at < .6 && s.time - at >= .6) v.terrain.revision++;
      if (v.hazards) v.hazards.sharks = s.sharks || [];
      for (const [key, times] of v.crateCooldowns) if (times.every(t => t <= v.time)) v.crateCooldowns.delete(key);
      v.generatePickups();
    }
    draw(dt, fallback) {
      const v = this.v;
      if (!v.players.length || !['MATCH', 'RECONNECTING'].includes(this.state)) { v.renderer.draw(fallback, dt, 1); return; }
      const p = v.players[this.index], camera = v.cameras[this.index]; camera.dt = v.phase === 'PAUSED' || this.state === 'RECONNECTING' ? 0 : dt; camera.alpha = this.role === 'host' && v.phase === 'RUNNING' ? Math.min(1, v.accumulator / AR.FIXED_DT) : 1;
      v.renderer.render({ state: 'RUNNING', terrain: v.terrain, stage: v.stage, rover: p.rover, vehicle: p.rover.stats, player: p, players: v.players, mode: v.matchConfig.mode, crateCooldowns: v.crateCooldowns, sharks: v.hazards?.sharks || [], chest: v.chest, pickups: v.pickups, projectiles: v.projectiles, explosions: v.explosions, shake: v.shake, flash: v.flash, time: v.time, headlight: this.index ? '#82edff' : '#ffe2a1', particles: [], texts: [], targetX: v.matchConfig.mode === 'race' ? p.startX + v.matchConfig.target * 10 : null }, camera, { x: 0, y: 0, width: v.renderer.width, height: v.renderer.height });
    }
    show() { this.ui.show(); }
    async wake() {
      if (this.headless || this.wakeLock || !navigator.wakeLock || document.hidden) return;
      try { this.wakeLock = await navigator.wakeLock.request('screen'); if (!this.active) { this.releaseWake(); return; } this.wakeLock.addEventListener('release', () => { this.wakeLock = null; }); } catch (_) { /* Optional on iOS, battery saver and insecure origins. */ }
    }
    releaseWake() { const lock = this.wakeLock; this.wakeLock = null; if (lock) lock.release().catch(() => {}); }
    close() {
      this.send({ type: 'leave' }); this.active = false; this.transport?.close(); this.transport = null; this.releaseWake();
      this.v.network = null; this.v.sound = this.sound; this.v.close(); this.ui.show();
    }
    inspect() { return { role: this.role, state: this.state, code: this.code, epoch: this.epoch, rtt: this.rtt, error: this.error || '', abandoned: this.abandoned, snapshotBytes: this.metrics.snapshots ? Math.round(this.metrics.bytes / this.metrics.snapshots) : 0, maxSnapshotBytes: this.metrics.maxBytes, metrics: structuredClone(this.metrics), input: { throttle: this.source.throttle, brake: this.source.brake, burst: this.source.b, item: this.source.i }, pickups: this.v.collected ? [...this.v.collected] : [], transport: this.transport?.inspect?.() || { kind: 'loopback' } }; }
  }
  AR.Online = Online;
})(globalThis);
