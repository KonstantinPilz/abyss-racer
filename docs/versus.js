(function () {
  'use strict';
  const AR = window.AR;
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const writeText = (node, value) => { const text = String(value); if (node.textContent !== text) node.textContent = text; };
  const fmt = n => Math.floor(n).toLocaleString('en-US');
  const MODES = { race: 'Race', survival: 'Last Sub Standing', pearl: 'Pearl Rush' };
  const ITEMS = {
    ink: { name: 'Ink Cloud', icon: '●', description: 'Black out their view for 3.5 s.' },
    torpedo: { name: 'Torpedo', icon: '➤', description: 'Instant crash on hit. Jump to dodge!' },
    net: { name: 'Jellyfish Net', icon: '♧', description: 'Tangle their engine for 4 s.' },
    siphon: { name: 'Oxygen Siphon', icon: 'O₂', description: 'Steal up to 25 oxygen.' },
    riptide: { name: 'Riptide', icon: '⇄', description: 'Reverse their drive controls for 4 s.' },
    shield: { name: 'Bubble Shield', icon: '◉', description: 'Block one attack. Lasts 8 s.' },
    turbo: { name: 'Turbo Current', icon: '»', description: 'Extra torque and speed for 3 s.' },
    magnet: { name: 'Pearl Magnet', icon: '∩', description: 'Steal 30% of their round pearls.' },
    anchor: { name: 'Anchor Drop', icon: '⚓', description: 'Two anchors. Each lasts 15 s.' }
  };
  const LEVEL_FIVE = Object.fromEntries(AR.UPGRADES.map(u => [u.id, 5]));
  // Ten percent faster than the quickest level-5 ride. A temporary turbo can
  // buy breathing room, but expires well before the projectile's 12-second life.
  const TORPEDO_SPEED = Math.ceil(Math.max(...AR.VEHICLES.map(v => AR.getStats(v.id, LEVEL_FIVE).topSpeed)) * 1.1);
  const CONTROL_CODES = ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];
  function moveRover(r, x, y, angle = 0, vx = 0, vy = 0) {
    AR.clearRoverGhosting(r);
    r.x = x; r.y = y; r.angle = angle; r.vx = vx; r.vy = vy; r.omega = 0;
    r.sleeping = false; r.sleepTime = 0; r.crashed = ''; r.domeContacts = []; r.strandedTime = 0;
    const c = Math.cos(angle), s = Math.sin(angle);
    r.wheels.forEach(w => {
      const rx = w.side * r.stats.wheelbase / 2, ry = r.stats.restLength + 8;
      w.x = x + rx * c - ry * s; w.y = y + rx * s + ry * c;
      w.vx = vx; w.vy = vy; w.omega = vx / w.radius; w.grounded = false;
    });
    r.grounded = AR.roverNearGround(r);
    r.wheels.forEach(w => { w.grounded = r.grounded && Math.abs(r.terrain.height(w.x) - w.y - w.radius) < 12; });
    r.savePrevious();
  }
  function kick(r, vx, vy, spin = 0) {
    r.sleeping = false; r.sleepTime = 0; r.vx += vx; r.vy += vy; r.omega += spin;
    r.wheels.forEach(w => { w.vx += vx; w.vy += vy; });
  }
  function segmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }

  class Versus {
    constructor(save, sound, renderer, exit) {
      this.save = save; this.sound = sound; this.renderer = renderer; this.exit = exit;
      this.active = false; this.phase = 'SETUP'; this.keys = new Set(); this.pendingBurst = [false, false]; this.players = [];
      this.config = { mode: 'race', target: 500, bestOf: 3, stage: 'reef', vehicles: ['rover', 'rover'] };
      this.ready = [false, false]; this.scores = [0, 0]; this.cameras = [{}, {}];
      this.frames = 0; this.frameSeconds = 0;
      this.buildUI();
    }
    buildUI() {
      const root = document.createElement('div'); root.id = 'versus-root'; root.hidden = true;
      root.innerHTML = '<section id="versus-setup" class="v-setup"><div class="v-heading"><div><div class="eyebrow">ONE KEYBOARD · TWO RIVALS</div><h2>Friends above.<br><span>Rivals below.</span></h2></div><button id="versus-title" class="button secondary">← Title</button></div><div id="versus-tally" class="v-tally"></div><div class="v-pilots">' + [0, 1].map(i => '<article class="v-pilot p' + (i + 1) + '"><div class="v-card-heading"><b>PLAYER ' + (i + 1) + '</b><span>' + (i ? 'BOTTOM VIEW' : 'TOP VIEW') + '</span></div><div class="v-vehicle-select"><button data-cycle="' + i + ':-1" aria-label="Previous vehicle for Player ' + (i + 1) + '">‹</button><canvas id="versus-vehicle-' + i + '"></canvas><button data-cycle="' + i + ':1" aria-label="Next vehicle for Player ' + (i + 1) + '">›</button></div><h3 id="versus-name-' + i + '"></h3><p id="versus-desc-' + i + '"></p><div class="v-controls">' + (i ? '<kbd>←</kbd> Brake <kbd>→</kbd> Drive <kbd>↑</kbd> Ballast <kbd>↓</kbd> Item' : '<kbd>A</kbd> Brake <kbd>D</kbd> Drive <kbd>W</kbd> Ballast <kbd>S</kbd> Item') + '</div><button id="versus-ready-' + i + '" class="button secondary">' + (i ? '↓' : 'S') + ' · READY</button></article>').join('') + '</div><div class="v-options"><label>ROUND MODE<select id="versus-mode"><option value="race">Race</option><option value="survival">Last Sub Standing</option><option value="pearl">Pearl Rush · 90 seconds</option></select></label><label>RACE DISTANCE<select id="versus-target"><option value="500">500 m</option><option value="1000">1,000 m</option><option value="2000">2,000 m</option></select></label><label>ROUNDS<select id="versus-rounds"><option value="1">One round</option><option value="3" selected>Best of 3</option><option value="5">Best of 5</option></select></label><label>OCEAN<select id="versus-stage">' + AR.STAGES.map(s => '<option value="' + s.id + '">' + s.name + '</option>').join('') + '</select></label><label>GRAPHICS<select id="versus-graphics"><option value="crisp">Crisp (default)</option><option value="performance">Performance</option></select></label></div><p id="versus-mode-note" class="v-mode-note"></p><div class="v-launch"><p>All 5 rides & 6 oceans unlocked here.<br>Equal level-5 tune. Bragging rights earned.</p><button id="versus-start" class="button primary">DIVE TOGETHER <span>↗</span></button></div><p class="v-setup-help">Choose rides with A / D and ← / →, then S and ↓ to ready up. Both ready starts the match. Esc / P pauses.</p></section><div id="versus-huds" hidden>' + [0, 1].map(i => '<section class="v-hud p' + (i + 1) + '" id="v-hud-' + i + '" aria-label="Player ' + (i + 1) + ' instruments"><div class="v-hud-row"><div class="v-identity"><b>P' + (i + 1) + '</b><strong id="v-distance-' + i + '">0 m</strong><small id="v-progress-' + i + '"></small></div><div class="v-oxygen"><span>O₂ <b id="v-oxygen-' + i + '"></b></span><div><i id="v-oxygen-fill-' + i + '"></i></div><small class="v-lives" id="v-lives-' + i + '" hidden></small></div><div class="v-counts"><b id="v-pearls-' + i + '"></b><span id="v-crashes-' + i + '"></span></div><div class="v-item" id="v-item-' + i + '"><b id="v-icon-' + i + '">?</b><span id="v-item-name-' + i + '">Find a crate</span><kbd>' + (i ? '↓' : 'S') + '</kbd></div></div><div class="v-status" id="v-status-' + i + '"></div><div class="v-toast" id="v-toast-' + i + '" role="status"></div><div class="v-respawn" id="v-respawn-' + i + '"></div><div class="v-bottom"><span>' + (i ? '← BRAKE　→ DRIVE　↑ BALLAST　↓ ITEM' : 'A BRAKE　D DRIVE　W BALLAST　S ITEM') + '</span><span id="v-ballast-' + i + '"></span><span>P / ESC PAUSE</span></div></section>').join('') + '<div class="v-divider"></div><button id="versus-pause" aria-label="Pause versus">Ⅱ</button></div><section id="versus-overlay" class="v-overlay" hidden><div class="v-result" id="versus-overlay-content"></div></section>';
      document.body.appendChild(root);
      $('versus-title').onclick = () => this.close();
      root.querySelectorAll('[data-cycle]').forEach(b => { b.onclick = () => { const [i, dir] = b.dataset.cycle.split(':').map(Number); this.cycle(i, dir); }; });
      [0, 1].forEach(i => { $('versus-ready-' + i).onclick = () => this.confirm(i); });
      for (const [id, key] of [['mode', 'mode'], ['target', 'target'], ['rounds', 'bestOf'], ['stage', 'stage']]) {
        $('versus-' + id).onchange = e => { this.config[key] = ['target', 'bestOf'].includes(key) ? Number(e.target.value) : e.target.value; this.ready = [false, false]; this.setupUI(); };
      }
      $('versus-graphics').onchange = e => { this.save.data.settings.graphics = e.target.value; this.save.save(); this.renderer.setGraphics(e.target.value); };
      $('versus-start').onclick = () => this.startMatch();
      $('versus-pause').onclick = () => this.pause();
    }
    open() {
      if (this.network) return this.network.returnLobby();
      this.active = true; this.phase = 'SETUP'; this.clearKeys(); this.ready = [false, false];
      $('versus-root').hidden = false; this.sound.suspend(); this.show(); this.setupUI();
      $('versus-start').focus({ preventScroll: true });
    }
    close() { if (this.network) return this.network.close(); this.active = false; this.clearKeys(); this.sound.suspend(); $('versus-root').hidden = true; this.exit(); }
    show() {
      document.body.dataset.versus = this.phase;
      $('versus-setup').hidden = this.phase !== 'SETUP';
      $('versus-huds').hidden = this.phase === 'SETUP';
      $('versus-overlay').hidden = !['COUNTDOWN', 'ROUND_RESULT', 'MATCH_RESULT', 'PAUSED'].includes(this.phase);
      if (this.network) this.network.show();
    }
    setupUI() {
      const t = this.save.data.versus;
      $('versus-graphics').value = this.save.data.settings.graphics || 'crisp';
      $('versus-tally').textContent = 'THE RIVALRY SO FAR　 P1 ' + t.p1Wins + ' — ' + t.p2Wins + ' P2　 /　' + t.matches + ' MATCHES';
      for (let i = 0; i < 2; i++) {
        const v = AR.VEHICLES.find(v => v.id === this.config.vehicles[i]);
        const stats = AR.getStats(v.id, Object.fromEntries(AR.UPGRADES.map(u => [u.id, 5])));
        if (i) stats.color = v.id === 'bike' ? '#609cf1' : '#56dce9';
        this.renderer.thumbnail($('versus-vehicle-' + i), stats);
        $('versus-name-' + i).textContent = v.name;
        $('versus-desc-' + i).textContent = v.description;
        $('versus-ready-' + i).textContent = this.ready[i] ? '✓ READY TO DIVE' : (i ? '↓' : 'S') + ' · READY';
        $('versus-ready-' + i).classList.toggle('ready', this.ready[i]);
      }
      $('versus-target').disabled = this.config.mode !== 'race';
      $('versus-mode-note').textContent = { race: 'First to ' + fmt(this.config.target) + ' m wins. Crash, respawn, settle the score.', survival: 'Three O₂ lives each. Black out, respawn in 4 s with 60% air. Last player with a life wins; oxygen drains 1.5× faster and tanks are scarce.', pearl: '90 seconds. Shared pearls: first to grab gets them. Most pearls wins.' }[this.config.mode];
    }
    cycle(i, dir) {
      const n = AR.VEHICLES.findIndex(v => v.id === this.config.vehicles[i]);
      this.config.vehicles[i] = AR.VEHICLES[(n + dir + 5) % 5].id; this.ready[i] = false; this.setupUI();
    }
    confirm(i) { this.ready[i] = !this.ready[i]; this.setupUI(); if (this.ready.every(Boolean)) this.startMatch(); }
    keydown(e) {
      if (this.network) return this.network.keydown(e);
      if (this.phase === 'SETUP' && e.target.matches('select') && !['Escape', 'KeyP'].includes(e.code)) return;
      if (CONTROL_CODES.includes(e.code) || ['Escape', 'KeyP'].includes(e.code)) e.preventDefault();
      this.sound.unlock();
      if (e.code === 'KeyM' && !e.repeat) { this.save.data.settings.muted = !this.save.data.settings.muted; this.sound.setMuted(this.save.data.settings.muted); this.save.save(); }
      if (this.phase === 'SETUP') {
        if (e.target.matches('select') || e.repeat) return;
        if (e.code === 'KeyA') this.cycle(0, -1); if (e.code === 'KeyD') this.cycle(0, 1);
        if (e.code === 'ArrowLeft') this.cycle(1, -1); if (e.code === 'ArrowRight') this.cycle(1, 1);
        if (e.code === 'KeyS') this.confirm(0); if (e.code === 'ArrowDown') this.confirm(1);
        if (e.code === 'Escape') this.close(); return;
      }
      if (['Escape', 'KeyP'].includes(e.code) && !e.repeat) { if (this.phase === 'PAUSED') this.resume(); else this.pause(); return; }
      if (this.phase === 'MATCH_RESULT' && e.code === 'KeyR' && !e.repeat) { this.startMatch(); return; }
      if (this.phase === 'COUNTDOWN') { this.keys.add(e.code); return; } // held keys count from GO
      if (this.phase !== 'RUNNING') return;
      this.keys.add(e.code);
      if (!e.repeat && ['KeyW', 'ArrowUp'].includes(e.code)) this.pendingBurst[e.code === 'KeyW' ? 0 : 1] = true;
      if (!e.repeat && ['KeyS', 'ArrowDown'].includes(e.code)) this.useItem(e.code === 'KeyS' ? 0 : 1);
    }
    clearKeys() { this.keys.clear(); this.pendingBurst = [false, false]; if (this.network) this.network.clearInput(); }
    controls(i) {
      const input = this.network ? this.network.controls(i) : { throttle: this.keys.has(i ? 'ArrowRight' : 'KeyD'), brake: this.keys.has(i ? 'ArrowLeft' : 'KeyA'), burst: this.keys.has(i ? 'ArrowUp' : 'KeyW') };
      let { throttle, brake } = input;
      if (this.players[i].effects.riptide > 0) [throttle, brake] = [brake, throttle];
      return { throttle, brake, burst: this.pendingBurst[i] || input.burst };
    }
    pause(authoritative = false) {
      if (this.network && !authoritative) return this.network.pause();
      this.clearKeys();
      if (!['RUNNING', 'COUNTDOWN', 'ROUND_RESULT'].includes(this.phase)) return;
      this.beforePause = this.phase; this.phase = 'PAUSED'; this.accumulator = 0; this.sound.suspend(); this.show();
      $('versus-overlay-content').innerHTML = '<div class="eyebrow">BOTH ROVERS PAUSED</div><h2>Holding depth.</h2><p>Take a breath. Your rivalry can wait.</p><div class="v-result-actions"><button id="versus-resume" class="button primary">RESUME</button><button id="versus-abandon" class="button secondary">Change setup</button></div><small>P / Esc to resume</small>';
      $('versus-resume').onclick = () => this.resume(); $('versus-abandon').onclick = () => this.open();
      $('versus-resume').focus({ preventScroll: true });
    }
    resume(authoritative = false) { if (this.network && !authoritative) return this.network.resume(); if (this.phase !== 'PAUSED') return; this.phase = this.beforePause; this.lastCount = null; this.clearKeys(); this.accumulator = 0; this.sound.unlock(); this.show(); if (this.phase === 'ROUND_RESULT') this.resultUI(false); }
    startMatch() {
      if (this.network && !this.network.starting) return this.network.start();
      this.sound.unlock(); this.matchConfig = { ...this.config, vehicles: [...this.config.vehicles] };
      this.scores = [0, 0]; this.round = 1; this.matchSaved = false;
      this.totals = [0, 1].map(() => ({ bestDistance: 0, itemsLanded: 0, crashes: 0, torpedoesDodged: 0, blackouts: 0, itemsUsed: 0, pearls: 0 }));
      this.frames = 0; this.frameSeconds = 0; this.newRound();
    }
    spawn(p, x) {
      const r = new AR.Rover(this.terrain, { ...p.base });
      const half = r.stats.wheelbase / 2;
      const floor = Math.min(this.terrain.height(x - half), this.terrain.height(x + half));
      moveRover(r, x, floor - r.stats.radius - r.stats.restLength - 9);
      p.rover = r;
    }
    newRound() {
      const c = this.matchConfig;
      this.stage = AR.STAGES.find(s => s.id === c.stage);
      this.terrain = new AR.Terrain(this.stage, this.stage.seed + (this.round - 1) * 137);
      this.players = c.vehicles.map((id, index) => {
        const base = AR.getStats(id, Object.fromEntries(AR.UPGRADES.map(u => [u.id, 5])));
        if (index) base.color = id === 'bike' ? '#609cf1' : '#56dce9';
        const p = { index, base, effects: {}, distance: 0, maxX: 0, pearls: 0, crashes: 0, blackouts: 0, lives: 3, respawnKind: '', itemsUsed: 0, item: null, charges: 0, respawn: 0, out: false, catchup: false, slipstream: false, toast: '', toastTime: 0 };
        const x = ((index + this.round) % 2) ? 100 : -40;
        this.spawn(p, x); p.startX = p.maxX = x;
        return p;
      });
      this.pickups = []; this.projectiles = []; this.projectileSeq = 0; this.explosions = []; this.shake = 0; this.flash = 0; this.generated = new Set(); this.collected = new Set(); this.contacts = 0; this.time = 0; this.remaining = 90;
      this.cameras = [{}, {}]; this.accumulator = 0; this.clearKeys(); this.phase = 'COUNTDOWN'; this.phaseTime = 4; this.lastCount = null;
      this.generatePickups(); this.show(); this.hud();
      if (this.network) this.network.roundStarted();
    }
    random(n) { const a = Math.sin(n * 127.1 + this.terrain.seed * 311.7) * 43758.5453; return a - Math.floor(a); }
    generatePickups() {
      // Generate around each player, so a large gap never churns the middle terrain.
      const activeSectors = new Set();
      const add = (sector, slot, item) => { const key = sector + ":" + slot; if (!this.collected.has(key)) this.pickups.push({ ...item, key }); };
      for (const p of this.players) {
        const center = Math.floor(p.rover.x / 1600);
        for (let sector = center - 1; sector <= center + 2; sector++) {
          activeSectors.add(sector);
          if (sector < 0 || this.generated.has(sector)) continue;
          this.generated.add(sector);
          const start = sector * 1600;
          for (let j = 0; j < 10; j++) {
            const x = start + 350 + j * 150;
            const type = j === 6 && (this.matchConfig.mode !== 'survival' || sector % 3 === 0) ? 'oxygen' : this.random(sector * 17 + j) > .97 ? 'gold' : 'pearl';
            add(sector, j, { x, y: this.terrain.height(x) - 44, type, collected: false });
          }
          // Consecutive ground crates are 120–200 m apart; ramp crates are extra.
          const x = start + 900 + this.random(sector + 73) * 400;
          add(sector, 'crate', { x, y: this.terrain.height(x) - 48, type: 'crate', collected: false });
          for (const ramp of this.terrain.rampsBetween(start, start + 1599.999)) {
            add(sector, 'ramp:' + ramp.x, { x: ramp.x, y: ramp.y - 118, type: 'crate', collected: false });
            for (let j = 0; j < 6; j++) add(sector, 'arc:' + ramp.x + ':' + j, { x: ramp.x - 50 + j * 30, y: ramp.y - 70 - Math.sin(j / 5 * Math.PI) * 55, type: 'pearl', collected: false });
          }
        }
      }
      // Keep only two nearby windows; a small collected-key ledger prevents farming on reverse.
      this.pickups = this.pickups.filter(q => !q.collected && activeSectors.has(Number(q.key.split(":")[0])));
      for (const sector of this.generated) if (!activeSectors.has(sector)) this.generated.delete(sector);
      const centers = this.players.map(p => Math.floor(p.rover.x / 1024));
      for (const key of this.terrain.chunks.keys()) if (centers.every(c => key < c - 3 || key > c + 5)) this.terrain.chunks.delete(key);
    }
    currentDistance(p) { return (p.rover.x - p.startX) / 10; }
    rollItem(p) {
      const behind = this.currentDistance(p) < this.currentDistance(this.players[1 - p.index]);
      const table = behind ? ['torpedo', 'torpedo', 'ink', 'net', 'siphon', 'riptide', 'turbo', 'magnet', 'shield'] : ['shield', 'shield', 'turbo', 'turbo', 'anchor', 'ink', 'net'];
      const id = table[Math.floor(Math.random() * table.length)];
      return id === 'magnet' && this.matchConfig.mode !== 'pearl' ? 'turbo' : id;
    }
    collect() {
      for (const q of this.pickups) {
        if (q.collected) continue;
        const candidates = this.players.filter(p => !p.out && !p.respawn && (q.type !== 'crate' || !p.item)).map(p => {
          const r = p.rover, prev = r.prev;
          return { p, d: segmentDistance(q.x, q.y, prev.x, prev.y, r.x, r.y) };
        }).filter(c => c.d < (q.type === 'crate' ? 53 : 48)).sort((a, b) => a.d - b.d || ((a.p.index + this.round) % 2) - ((b.p.index + this.round) % 2));
        if (!candidates.length) continue;
        const p = candidates[0].p; q.collected = true; this.collected.add(q.key);
        if (q.type === 'crate') { p.item = this.rollItem(p); p.charges = p.item === 'anchor' ? 2 : 1; this.toast('P' + (p.index + 1) + ' found ' + ITEMS[p.item].name + '!'); this.sound.play('chest'); }
        else if (q.type === 'oxygen') { p.rover.oxygen = Math.min(p.rover.maxOxygen, p.rover.oxygen + p.rover.maxOxygen * .6); this.sound.play('oxygen'); }
        else { p.pearls += q.type === 'gold' ? 100 : 5; this.sound.play(q.type === 'gold' ? 'gold' : 'pickup'); }
      }
    }
    toast(message) { this.players.forEach(p => { p.toast = message; p.toastTime = 3; }); if (this.network) this.network.event('toast', { text: message }); }
    blocked(victim, attacker, id) {
      if (victim.out || victim.respawn) { this.toast('P' + (victim.index + 1) + ' is out of reach!'); return true; }
      if (victim.effects.spawnShield > 0 || victim.effects.shield > 0) {
        if (!(victim.effects.spawnShield > 0)) victim.effects.shield = 0;
        victim.effects.blocked = .8;
        this.sound.play('shield'); this.toast('P' + (victim.index + 1) + ' blocked P' + (attacker.index + 1) + '’s ' + ITEMS[id].name + '!'); return true;
      }
      return false;
    }
    landed(attacker, victim, id) {
      if (this.network) this.network.event('hit', { attacker: attacker.index, victim: victim.index, item: id });
      this.totals[attacker.index].itemsLanded++; victim.effects.hit = .8;
      this.toast('P' + (attacker.index + 1) + ' hit P' + (victim.index + 1) + ' with ' + ITEMS[id].name + '!');
    }
    useItem(index) {
      const p = this.players[index], v = this.players[1 - index];
      if (this.phase !== 'RUNNING' || !p || p.out || p.respawn || !p.item) return false;
      const id = p.item;
      if (--p.charges <= 0) p.item = null;
      p.itemsUsed++; this.sound.play(id);
      this.toast('P' + (index + 1) + ' used ' + ITEMS[id].name + '!');
      if (id === 'shield') p.effects.shield = 8;
      else if (id === 'turbo') p.effects.turbo = 3;
      else if (id === 'anchor') {
        const x = p.rover.x - (p.rover.vx < -5 ? -1 : 1) * 70;
        this.projectiles.push({ id: ++this.projectileSeq, type: 'anchor', owner: index, x, y: this.terrain.height(x) - 16, life: 15 });
      } else if (id === 'torpedo') {
        const direction = Math.sign(v.rover.x - p.rover.x) || 1, x = p.rover.x + direction * 65;
        this.projectiles.push({ id: ++this.projectileSeq, type: 'torpedo', owner: index, x, y: this.terrain.height(x) - 28, direction, life: 12, passed: false, nearest: Infinity });
      } else if (!this.blocked(v, p, id)) {
        if (id === 'ink') v.effects.ink = 3.5;
        if (id === 'net') v.effects.net = 4;
        if (id === 'riptide') v.effects.riptide = 4;
        if (id === 'siphon') { const amount = Math.min(25, v.rover.oxygen); v.rover.oxygen -= amount; p.rover.oxygen = Math.min(p.rover.maxOxygen, p.rover.oxygen + amount); v.effects.siphon = 1.5; p.effects.siphonGain = 1.5; }
        if (id === 'magnet') { const amount = Math.floor(v.pearls * .3); v.pearls -= amount; if (!p.out) p.pearls += amount; v.effects.magnet = 1.5; p.effects.magnetGain = 1.5; }
        this.landed(p, v, id);
      }
      this.hud(); return true;
    }
    updateProjectiles(dt) {
      for (const q of this.projectiles) {
        q.life -= dt;
        const p = this.players[q.owner], v = this.players[1 - q.owner], r = v.rover;
        const oldX = q.x, oldY = q.y;
        if (q.type === 'torpedo') {
          q.x += q.direction * TORPEDO_SPEED * dt;
          const groundY = this.terrain.height(q.x) - 28;
          // Follow the seabed; homing has a 12px vertical reach, leaving room to jump.
          const targetY = clamp(r.y, groundY - 12, groundY + 8);
          q.y += clamp((targetY - q.y) * 9, -450, 450) * dt;
          q.y = Math.min(q.y, this.terrain.height(q.x) - 12);
          const gap = (r.x - q.x) * q.direction;
          q.nearest = Math.min(q.nearest, Math.abs(gap));
          if (!q.passed && gap < -65) {
            q.passed = true;
            if (!v.out && !v.respawn && q.nearest < 100) { this.totals[v.index].torpedoesDodged++; v.effects.dodged = 1.3; this.toast('P' + (v.index + 1) + ' dodged a Torpedo!'); }
          }
        }
        if (q.life <= 0 || v.out || v.respawn) continue;
        const rprev = r.prev;
        const hit = [r, ...r.wheels].some((body, i) => {
          const prev = i ? rprev.wheels[i - 1] : rprev;
          return segmentDistance(0, 0, oldX - prev.x, oldY - prev.y, q.x - body.x, q.y - body.y) < (q.type === 'anchor' ? 20 : 14) + (i ? body.radius : 24);
        });
        if (hit) {
          q.life = 0;
          if (!this.blocked(v, p, q.type)) {
            if (q.type === 'torpedo') {
              r.crashed = 'Torpedoed!'; this.crash(v); v.effects.torpedo = 1;
              this.explosions.push({ x: q.x, y: q.y, life: .8, maxLife: .8 });
              if (this.network) this.network.event('explosion', { x: q.x, y: q.y });
              this.shake = 1; this.flash = .22; this.sound.play('torpedoHit');
            } else { kick(r, -r.vx * 1.45, -110, Math.sign(r.vx) * 2.8); v.effects.anchor = 1; this.sound.play('crash'); }
            this.landed(p, v, q.type);
          }
        }
      }
      this.projectiles = this.projectiles.filter(q => q.life > 0);
    }
    crash(p) {
      if (p.respawn || p.out) return;
      AR.clearRoverGhosting(p.rover);
      p.crashes++; p.respawn = 2.5; p.respawnKind = 'crash'; p.crashX = p.rover.x; p.crashReason = p.rover.crashed || 'Hull crushed';
      p.item = null; p.charges = 0; p.effects = {};
      if (p.crashReason !== 'Torpedoed!') this.sound.play('crash'); this.toast('P' + (p.index + 1) + ' crashed! Back in 2.5 s.');
    }
    blackout(p) {
      if (p.respawnKind === 'blackout' || p.out) return;
      AR.clearRoverGhosting(p.rover);
      p.blackouts++; p.crashX = p.rover.x; p.crashReason = 'Out of air'; p.respawnKind = 'blackout';
      p.rover.oxygen = 0; p.rover.crashed = 'Out of air'; p.item = null; p.charges = 0; p.effects = {};
      p.catchup = p.slipstream = false;
      if (this.matchConfig.mode === 'survival' && --p.lives <= 0) {
        p.lives = 0; p.out = true; p.respawn = 0; this.toast('P' + (p.index + 1) + ' is out of lives!');
      } else { p.respawn = 4; this.toast('P' + (p.index + 1) + ' is out of air! Back in 4 s.'); }
    }
    step(dt) {
      if (this.phase !== 'RUNNING') return;
      if (this.network) this.network.consumeEdges();
      this.time += dt; this.remaining = Math.max(0, 90 - this.time);
      this.shake = Math.max(0, this.shake - dt * 2.8); this.flash = Math.max(0, this.flash - dt);
      for (const e of this.explosions) e.life -= dt;
      this.explosions = this.explosions.filter(e => e.life > 0);
      const c = this.matchConfig;
      const beforeDistances = this.players.map(p => p.distance);
      // Snapshot shared positions before either physics step, so both boosts use
      // the same instant rather than depending on player update order.
      const progress = this.players.map(p => this.currentDistance(p));
      const ground = this.players.map(p => AR.roverNearGround(p.rover));
      const positions = this.players.map(p => ({ x: p.rover.x, y: p.rover.y }));
      for (const p of this.players) {
        p.toastTime = Math.max(0, p.toastTime - dt);
        for (const key of Object.keys(p.effects)) p.effects[key] = Math.max(0, p.effects[key] - dt);
        if (p.out) { p.rover.savePrevious(); continue; }
        if (p.rover.oxygen <= 0 && !p.respawn) { this.blackout(p); p.rover.savePrevious(); continue; }
        if (p.respawn > 0) {
          p.respawn = Math.max(0, p.respawn - dt); p.rover.savePrevious();
          if (p.respawn <= 1e-8) {
            const blackout = p.respawnKind === 'blackout';
            const oxygen = blackout ? p.rover.maxOxygen * .6 : Math.max(0, p.rover.oxygen - p.rover.maxOxygen * .15);
            this.spawn(p, p.crashX); p.rover.oxygen = oxygen; p.respawn = 0; p.respawnKind = ''; p.effects.spawnShield = 1.5;
            if (!oxygen) this.blackout(p);
          }
          continue;
        }
        const gap = progress[1 - p.index] - progress[p.index];
        const current = clamp((gap - 20) / 40, 0, 1);
        p.catchup = current > 0;
        const behind = positions[1 - p.index].x - positions[p.index].x;
        p.slipstream = ground[p.index] && ground[1 - p.index] && behind >= 80 && behind <= 400 &&
          Math.abs(positions[p.index].y - positions[1 - p.index].y) < 55 && !this.players[1 - p.index].respawn && !this.players[1 - p.index].out;
        const r = p.rover, effect = p.effects, input = this.controls(p.index);
        r.stats.torque = p.base.torque * (effect.turbo > 0 ? 1.6 : 1) * (effect.net > 0 ? .35 : 1) * (1 + .15 * current);
        r.stats.topSpeed = p.base.topSpeed * (effect.turbo > 0 ? 1.4 : 1) * (1 + .25 * current) * (p.slipstream ? 1.1 : 1);
        r.stats.thrustLevel = effect.net > 0 ? 0 : p.base.thrustLevel;
        if (effect.net > 0) { const drag = Math.exp(-dt * 2.4); r.vx *= drag; r.wheels.forEach(w => { w.vx *= drag; w.omega *= drag; }); }
        r.step(input, dt);
        this.pendingBurst[p.index] = false;
        if (c.mode === 'survival') r.oxygen = Math.max(0, r.oxygen - dt * (input.throttle ? 1.02 : .85) * .5);
        if (r.burstFired) this.sound.play('burst');
      }
      if (this.players.every(p => !p.out && !p.respawn && !(p.effects.spawnShield > 0))) {
        const result = AR.resolveRoverContacts(this.players[0].rover, this.players[1].rover);
        this.contacts += result.contacts;
      }
      // Distance includes the final shared-contact position, including a landing shove across the line.
      for (const p of this.players) if (!p.respawn && !p.out) { p.maxX = Math.max(p.maxX, p.rover.x); p.distance = Math.max(0, (p.maxX - p.startX) / 10); }
      this.collect(); this.updateProjectiles(dt);
      for (const p of this.players) {
        if (p.out || p.respawn) continue;
        if (p.rover.oxygen <= 0) this.blackout(p);
        else if (p.rover.crashed === 'Oxygen depleted') p.rover.crashed = '';
        else if (p.rover.crashed) this.crash(p);
      }
      if (Math.floor(this.time * 4) !== Math.floor((this.time - dt) * 4)) this.generatePickups();
      const alive = this.players.filter(p => !p.out);
      if (c.mode === 'race') {
        const finishers = this.players.filter(p => p.distance >= c.target);
        if (finishers.length) {
          const crossing = p => (c.target - beforeDistances[p.index]) / Math.max(.000001, p.distance - beforeDistances[p.index]);
          const winner = finishers.length < 2 ? finishers[0].index : Math.abs(crossing(finishers[0]) - crossing(finishers[1])) < 1e-7 ? -1 : crossing(finishers[0]) < crossing(finishers[1]) ? finishers[0].index : finishers[1].index;
          this.endRound(winner, 'Finish line reached'); return;
        }
      }
      if (c.mode === 'survival' && alive.length < 2) { this.endRound(alive.length ? alive[0].index : this.compare('distance'), alive.length ? 'Last Sub Standing' : 'Both final lives lost · furthest wins'); return; }
      if (c.mode === 'pearl' && this.remaining <= 0) { this.endRound(this.compare('pearls'), 'Pearl Rush complete'); return; }
    }
    compare(key) { const delta = this.players[0][key] - this.players[1][key]; return Math.abs(delta) < .001 ? -1 : delta > 0 ? 0 : 1; }
    endRound(winner, reason) {
      if (this.phase !== 'RUNNING') return;
      this.roundWinner = winner; this.roundReason = reason;
      if (winner >= 0) this.scores[winner]++;
      for (const p of this.players) {
        const t = this.totals[p.index]; t.bestDistance = Math.max(t.bestDistance, p.distance); t.crashes += p.crashes; t.blackouts += p.blackouts; t.itemsUsed += p.itemsUsed; t.pearls += p.pearls;
      }
      this.phase = 'ROUND_RESULT'; this.phaseTime = 3; this.accumulator = 0; this.clearKeys(); this.sound.suspend(); this.sound.play('trick'); this.show(); this.resultUI(false);
    }
    finishMatch() {
      this.phase = 'MATCH_RESULT'; this.matchWinner = this.scores[0] > this.scores[1] ? 0 : 1;
      if (!this.matchSaved) { this.save.finishVersus(this.matchWinner); this.matchSaved = true; }
      this.show(); this.resultUI(true); this.sound.play('level');
    }
    resultUI(match) {
      const winner = match ? this.matchWinner : this.roundWinner;
      const title = winner < 0 ? 'A DEAD HEAT!' : 'PLAYER ' + (winner + 1) + (match ? ' WINS' : ' TAKES THE ROUND');
      const cards = [0, 1].map(i => {
        const p = this.players[i], t = this.totals[i];
        const stats = match ? [['BEST DISTANCE', fmt(t.bestDistance) + ' m'], ['ITEMS LANDED', t.itemsLanded], ['CRASHES', t.crashes], ['BLACKOUTS', t.blackouts], ['TORPEDOES DODGED', t.torpedoesDodged]] : [['DISTANCE', fmt(p.distance) + ' m'], ['CRASHES', p.crashes], ['BLACKOUTS', p.blackouts], ['ITEMS USED', p.itemsUsed], ['PEARLS', p.pearls]];
        return '<div class="v-result-pilot p' + (i + 1) + '"><b>PLAYER ' + (i + 1) + '</b><dl>' + stats.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('') + '</dl></div>';
      }).join('');
      $('versus-overlay-content').innerHTML = '<div class="eyebrow">' + (match ? 'THE OCEAN HAS A CHAMPION' : 'ROUND ' + this.round + ' COMPLETE') + '</div><h2 class="' + (winner === 1 ? 'teal' : '') + '">' + title + '</h2><p>' + (match ? MODES[this.matchConfig.mode] + ' · ' + this.stage.name : this.roundReason) + '</p><div class="v-score"><span>P1</span> ' + this.scores[0] + ' <small>—</small> ' + this.scores[1] + ' <span>P2</span></div><div class="v-result-stats">' + cards + '</div>' + (match ? '<div class="v-result-actions"><button id="versus-rematch" class="button primary">REMATCH <span>R ↻</span></button><button id="versus-change" class="button secondary">Change setup</button><button id="versus-result-title" class="text-button">Title</button></div><small>Rivalry saved on this device.' + (!this.save.storageAvailable ? ' Storage unavailable — session only.' : '') + '</small>' : '<div class="v-next" id="versus-next">Next dive in 3…</div>');
      if (match) { $('versus-rematch').onclick = () => this.startMatch(); $('versus-change').onclick = () => this.open(); $('versus-result-title').onclick = () => this.close(); $('versus-rematch').focus({ preventScroll: true }); }
    }
    tick(dt, authoritative = false) {
      if (this.network && !authoritative) return this.network.tick(dt);
      this.frames++; this.frameSeconds += dt;
      if (['SETUP', 'PAUSED', 'MATCH_RESULT'].includes(this.phase)) return;
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= AR.FIXED_DT && steps < 7) {
        this.accumulator -= AR.FIXED_DT; steps++;
        if (this.phase === 'RUNNING') this.step(AR.FIXED_DT);
        else if (this.phase === 'COUNTDOWN' || this.phase === 'ROUND_RESULT') {
          this.phaseTime -= AR.FIXED_DT;
          if (this.phaseTime <= 1e-8) {
            if (this.phase === 'COUNTDOWN') { this.phase = 'RUNNING'; this.show(); this.pendingBurst = [false, false]; }
            else if (Math.max(...this.scores) >= Math.ceil(this.matchConfig.bestOf / 2)) this.finishMatch();
            else { this.round++; this.newRound(); }
          }
        }
        this.accumulator = Math.max(0, this.accumulator);
      }
      if (steps === 7) this.accumulator %= AR.FIXED_DT;
      if (this.phase === 'COUNTDOWN') {
        const count = this.phaseTime > 1 ? Math.ceil(this.phaseTime) - 1 : 'GO';
        if (count !== this.lastCount) {
          this.lastCount = count; this.sound.play(count === 'GO' ? 'trick' : 'click');
          $('versus-overlay-content').innerHTML = '<div class="eyebrow">' + MODES[this.matchConfig.mode].toUpperCase() + ' · ' + this.stage.name.toUpperCase() + '</div><h2>Round ' + this.round + ' — Dive!</h2><div class="v-countdown">' + count + '</div><p>P1 ' + this.scores[0] + '　—　' + this.scores[1] + ' P2</p>';
        }
      }
      if (this.phase === 'ROUND_RESULT') $('versus-next').textContent = (Math.max(...this.scores) >= Math.ceil(this.matchConfig.bestOf / 2) ? 'Final scores' : this.roundWinner < 0 ? 'Tie · replaying the round' : 'Next dive') + ' in ' + Math.ceil(this.phaseTime) + '…';
      this.hudClock = (this.hudClock || 0) + dt;
      if (this.hudClock >= .08) { this.hud(); this.hudClock = 0; }
      this.sound.update({ running: this.phase === 'RUNNING', players: this.players.map(p => ({ running: this.phase === 'RUNNING' && !p.out && !p.respawn, throttle: this.controls(p.index).throttle, speed: Math.abs(p.rover.vx), oxygenFraction: p.rover.oxygen / p.rover.maxOxygen })) }, dt);
    }
    hud() {
      if (!this.players.length) return;
      for (const p of this.players) {
        const i = p.index, r = p.rover, e = p.effects;
        writeText($('v-distance-' + i), fmt(p.distance) + ' m');
        writeText($('v-progress-' + i), this.matchConfig.mode === 'pearl' ? Math.ceil(this.remaining) + ' s · ROUND ' + this.round : (this.matchConfig.mode === 'race' ? '/ ' + fmt(this.matchConfig.target) + ' m · ' : '') + 'ROUND ' + this.round + ' · ' + this.scores.join('–'));
        writeText($('v-oxygen-' + i), Math.ceil(100 * r.oxygen / r.maxOxygen) + '%');
        $('v-oxygen-fill-' + i).style.width = clamp(100 * r.oxygen / r.maxOxygen, 0, 100) + '%';
        $('v-oxygen-fill-' + i).classList.toggle('low', r.oxygen / r.maxOxygen < .25);
        writeText($('v-pearls-' + i), '● ' + fmt(p.pearls)); writeText($('v-crashes-' + i), p.crashes + (p.crashes === 1 ? ' crash' : ' crashes'));
        writeText($('v-icon-' + i), p.item ? ITEMS[p.item].icon : '?');
        writeText($('v-item-name-' + i), p.item ? ITEMS[p.item].name + (p.charges > 1 ? ' ×' + p.charges : '') : 'Find a crate');
        $('v-item-' + i).dataset.item = p.item || '';
        writeText($('v-status-' + i), [e.riptide > 0 ? 'RIPTIDE! controls reversed ' + Math.ceil(e.riptide) + 's' : '', e.net > 0 ? 'TANGLED! ' + Math.ceil(e.net) + 's' : '', e.ink > 0 ? 'INKED! ' + Math.ceil(e.ink) + 's' : '', e.turbo > 0 ? '» TURBO ' + Math.ceil(e.turbo) + 's' : '', e.spawnShield > 0 ? '◉ RESPAWN SHIELD' : e.shield > 0 ? '◉ SHIELD ' + Math.ceil(e.shield) + 's' : '', p.catchup ? '↑ CATCH-UP CURRENT' : '', p.slipstream ? '» SLIPSTREAM' : '', e.siphon > 0 ? '− OXYGEN SIPHONED!' : '', e.magnet > 0 ? 'PEARLS STOLEN!' : '', e.dodged > 0 ? 'TORPEDO DODGED!' : '', e.blocked > 0 ? 'ATTACK BLOCKED!' : ''].filter(Boolean).join(' · '));
        writeText($('v-toast-' + i), p.toastTime > 0 ? p.toast : '');
        writeText($('v-respawn-' + i), p.respawn > 0 ? p.crashReason.toUpperCase() + ' · RESPAWN ' + p.respawn.toFixed(1) + ' s' : p.out ? 'OUT OF LIVES' : '');
        const lives = $('v-lives-' + i); lives.hidden = this.matchConfig.mode !== 'survival';
        lives.setAttribute('aria-label', p.lives + ' oxygen lives remaining');
        const tanks = [0, 1, 2].map(n => '<i class="v-tank' + (n >= p.lives ? ' empty' : '') + '" aria-hidden="true">O₂</i>').join('');
        if (lives.innerHTML !== tanks) lives.innerHTML = tanks;
        writeText($('v-ballast-' + i), 'BALLAST ' + (r.cooldown > 0 ? r.cooldown.toFixed(1) + 's' : r.oxygen <= 8 ? 'LOW O₂' : 'READY'));
      }
    }
    draw(dt, fallback) {
      if (this.network) return this.network.draw(dt, fallback);
      if (this.phase === 'SETUP') { this.renderer.draw(fallback, dt, 1); return; }
      const h = this.renderer.height, w = this.renderer.width;
      for (const p of this.players) {
        const camera = this.cameras[p.index]; camera.dt = this.phase === 'PAUSED' ? 0 : dt; camera.alpha = this.phase === 'RUNNING' ? clamp(this.accumulator / AR.FIXED_DT, 0, 1) : 1;
        const scene = { state: 'RUNNING', terrain: this.terrain, stage: this.stage, rover: p.rover, vehicle: p.rover.stats, player: p, players: this.players, pickups: this.pickups, projectiles: this.projectiles, explosions: this.explosions, shake: this.shake, flash: this.flash, time: this.time, headlight: p.index ? '#82edff' : '#ffe2a1', particles: [], texts: [], targetX: this.matchConfig.mode === 'race' ? p.startX + this.matchConfig.target * 10 : null };
        this.renderer.render(scene, camera, { x: 0, y: p.index * (h / 2) + (p.index ? 1 : 0), width: w, height: h / 2 - 1 });
      }
    }
    inspect() {
      return { state: 'VERSUS_' + this.phase, players: this.players.map(p => ({ ...p.rover.snapshot(), index: p.index, vehicle: p.base.id, maxOxygen: p.rover.maxOxygen, item: p.item, charges: p.charges, crashes: p.crashes, blackouts: p.blackouts, lives: p.lives, respawnKind: p.respawnKind, ghosting: Boolean(p.rover.ghosting), distance: p.distance, pearls: p.pearls, effects: { ...p.effects }, respawn: p.respawn, out: p.out, catchup: p.catchup, slipstream: p.slipstream, startX: p.startX, itemsUsed: p.itemsUsed, torque: p.rover.stats.torque, topSpeed: p.rover.stats.topSpeed })), versus: { phase: this.phase, round: this.round || 0, scores: [...this.scores], mode: (this.matchConfig || this.config).mode, target: (this.matchConfig || this.config).target, remaining: this.remaining, contacts: this.contacts || 0, time: this.time || 0, tally: { ...this.save.data.versus }, totals: this.totals ? this.totals.map(t => ({ ...t })) : [], projectiles: this.projectiles ? this.projectiles.map(q => ({ ...q })) : [], torpedoSpeed: TORPEDO_SPEED, explosions: this.explosions ? this.explosions.map(e => ({ ...e })) : [], shake: this.shake || 0, flash: this.flash || 0, fps: this.frameSeconds ? this.frames / this.frameSeconds : 0 } };
    }
    debug() {
      return {
        giveItem: (i, id) => { if (!this.active || !this.players[i] || !ITEMS[id]) return false; if (id === 'magnet' && this.matchConfig.mode !== 'pearl') id = 'turbo'; const p = this.players[i]; p.item = id; p.charges = id === 'anchor' ? 2 : 1; this.hud(); return true; },
        placePlayer: (i, values) => {
          const p = this.players[i]; if (!p || !values || typeof values !== 'object') return false;
          const r = p.rover, x = Number.isFinite(values.x) ? values.x : r.x;
          const y = Number.isFinite(values.y) ? values.y : this.terrain.height(x) - r.stats.radius - r.stats.restLength - 9;
          moveRover(r, x, y, Number.isFinite(values.angle) ? values.angle : 0, Number.isFinite(values.vx) ? values.vx : 0, Number.isFinite(values.vy) ? values.vy : 0);
          if (Number.isFinite(values.oxygen)) r.oxygen = clamp(values.oxygen, 0, r.maxOxygen);
          if (Number.isFinite(values.pearls)) p.pearls = Math.max(0, Math.floor(values.pearls));
          p.respawn = 0; p.respawnKind = ''; p.out = false; p.effects = {}; return true;
        },
        setOxygen: (i, value) => { const p = this.players[i]; if (!this.active || !p || !Number.isFinite(value)) return false; p.rover.oxygen = clamp(value, 0, p.rover.maxOxygen); this.hud(); return true; },
        fireTorpedo: i => { const p = this.players[i]; if (!this.active || !p || this.phase !== 'RUNNING' || p.out || p.respawn) return false; p.item = 'torpedo'; p.charges = 1; return this.useItem(i); },
        crashPlayer: i => { const p = this.players[i]; if (!p || this.phase !== 'RUNNING') return false; p.rover.crashed = 'Hull crushed'; this.crash(p); return true; },
        advance: seconds => { for (let n = 0; n < Math.ceil(clamp(seconds, 0, 120) / AR.FIXED_DT); n++) this.tick(AR.FIXED_DT); this.hud(); return this.inspect(); }
      };
    }
  }
  AR.Versus = Versus; AR.VERSUS_ITEMS = ITEMS;
})();
