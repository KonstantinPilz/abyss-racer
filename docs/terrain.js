(function (root) {
  'use strict';
  const AR = root.AR = root.AR || {};
  const CHUNK_SIZE = 1024;
  const SAMPLE_SIZE = 8;
  const smooth = function (t) { return t * t * (3 - 2 * t); };
  function hash(n, seed) {
    let value = (Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  }
  function noise(x, seed) {
    const cell = Math.floor(x);
    return (hash(cell, seed) * (1 - smooth(x - cell)) + hash(cell + 1, seed) * smooth(x - cell)) * 2 - 1;
  }
  class Terrain {
    constructor(stage, seed) {
      this.stage = stage || AR.STAGES[0];
      this.seed = seed === undefined ? this.stage.seed : seed;
      this.chunks = new Map();
      this.worldTime = 0; this.bridges = new Map(); this.revision = 0;
    }
    rawHeight(x) {
      if (this.arena) return 470 - 32 * Math.pow(Math.sin(Math.PI * Math.max(0, Math.min(1800, x)) / 900), 4);
      if (x < 240) return 400;
      const stage = this.stage;
      const difficulty = 1 + Math.min(1.1, Math.max(0, x - 2000) / 22000);
      const fade = smooth(Math.min(1, (x - 240) / 620));
      const f = stage.frequency;
      let offset = stage.amplitude * difficulty * (
        noise(x * f / 930, this.seed) * 0.95 +
        noise(x * f / 440, this.seed + 17) * 0.31 +
        Math.sin(x * f / 177 + this.seed) * 0.12
      );
      // Each long section has an approach ramp and a steeper exit. The flat top
      // creates predictable launch points; Hermite edges avoid collision spikes.
      const period = 1850 / stage.ramps;
      const section = Math.floor(x / period);
      const rampStart = section * period + period * 0.61;
      const u = x - rampStart;
      const rampHeight = (35 + hash(section, this.seed + 56) * 32) * difficulty;
      if (u >= 0 && u < 170) offset -= rampHeight * smooth(u / 170);
      else if (u < 210 && u >= 170) offset -= rampHeight;
      else if (u >= 210 && u < 325) offset -= rampHeight * (1 - smooth((u - 210) / 115));
      // Rounded exposed rocks are part of the collision surface, never visual-only hazards.
      const rockCell = Math.floor(x / 510);
      const rockX = rockCell * 510 + 280 + hash(rockCell, this.seed + 7) * 110;
      const rockWidth = 34 + stage.rockiness * 22;
      const rockDistance = Math.abs(x - rockX);
      if (hash(rockCell, this.seed + 27) < stage.rockiness && rockDistance < rockWidth) {
        offset -= (6 + stage.rockiness * 13) * (0.5 + Math.cos(rockDistance / rockWidth * Math.PI) * 0.5);
      }
      return 400 + offset * fade;
    }
    chunk(index) {
      if (this.chunks.has(index)) return this.chunks.get(index);
      const heights = new Float64Array(CHUNK_SIZE / SAMPLE_SIZE + 1);
      for (let i = 0; i < heights.length; i++) heights[i] = this.rawHeight(index * CHUNK_SIZE + i * SAMPLE_SIZE);
      this.chunks.set(index, heights);
      return heights;
    }
    baseHeight(x) {
      const index = Math.floor(x / CHUNK_SIZE);
      const chunk = this.chunk(index);
      const at = (x - index * CHUNK_SIZE) / SAMPLE_SIZE;
      const i = Math.min(chunk.length - 2, Math.floor(at));
      const t = at - i;
      return chunk[i] + (chunk[i + 1] - chunk[i]) * t;
    }
    bridgeAt(x) {
      if (this.arena || this.stage.id !== 'city' || x < 1800) return null;
      const id = Math.floor((x - 1800) / 2600), start = 1800 + id * 2600;
      return x <= start + 520 ? { id, start, end: start + 520, y: this.baseHeight(start + 260) } : null;
    }
    height(x) {
      const b = this.bridgeAt(x);
      if (!b) return this.baseHeight(x);
      const u = (x - b.start) / 520, edge = smooth(Math.min(1, u * 2.5, (1 - u) * 2.5));
      const base = this.baseHeight(x) * (1 - edge) + b.y * edge;
      const at = this.bridges.get(b.id);
      return base + (at !== undefined && this.worldTime - at >= .6 ? 112 * edge : 0);
    }
    zonesBetween(start, end) {
      if (this.arena) return [];
      const zones = [];
      for (let i = Math.max(0, Math.floor((start - 3200) / 3000)); i <= Math.floor(end / 3000); i++) {
        const x = 900 + i * 3000;
        const add = (type, from, width, extra = {}) => { if (from <= end && from + width >= start) zones.push({ id: type + i, type, start: from, end: from + width, ...extra }); };
        if (this.stage.id === 'city') add('current', x, 620, { direction: i % 2 ? -1 : 1 });
        if (this.stage.id === 'whale') { add('ribs', x, 820); add('plankton', x + 1000, 650); }
        if (this.stage.id === 'thermal') { add('geyser', x, 110, { offset: i * .73 }); add('mud', x + 500, 390); add('elevator', x + 1500, 210); }
      }
      return zones;
    }
    environment(rover) {
      const out = { current: 0, mud: false, plankton: false, lift: 0 };
      for (const z of this.zonesBetween(rover.x, rover.x)) {
        const depth = this.height(rover.x) - rover.y;
        if (depth < 0 || depth > 320) continue;
        if (z.type === 'current') out.current = z.direction * 48;
        if (z.type === 'mud' && depth < 85) out.mud = true;
        if (z.type === 'plankton' && depth < 230) out.plankton = true;
        if (z.type === 'elevator') out.lift = Math.abs(rover.gravity()) + 42;
      }
      return out;
    }
    ventPhase(z) { return ((this.worldTime + z.offset) % 4 + 4) % 4; }
    stepWorld(rovers, dt) {
      const before = this.worldTime; this.worldTime += dt;
      for (const [id, at] of this.bridges) if (before - at < .6 && this.worldTime - at >= .6) this.revision++;
      for (const r of rovers) {
        if (r.crashed) continue;
        for (const w of r.wheels) {
          const b = this.bridgeAt(w.x);
          if (b && !this.bridges.has(b.id) && w.grounded && Math.abs(w.y + w.radius - this.height(w.x)) < 8) {
            this.bridges.set(b.id, this.worldTime);
            if (this.onCollapse) this.onCollapse(b.id, this.worldTime);
          }
        }
        for (const z of this.zonesBetween(r.x, r.x)) if (z.type === 'geyser') {
          const cycle = Math.floor((this.worldTime + z.offset) / 4);
          if (this.ventPhase(z) >= 3.45 && this.ventPhase(z) < 3.85 && this.height(r.x) - r.y < 300 && r.lastVent !== z.id + ':' + cycle) {
            r.lastVent = z.id + ':' + cycle;
            AR.launchGeyser(r, r.grounded ? 1 : .6, 0); r.naturalGeyser = .8;
            if (this.onGeyser) this.onGeyser(r);
          }
        }
      }
    }
    slope(x) { return (this.height(x + 4) - this.height(x - 4)) / 8; }
    ceiling(x) {
      if (this.arena) return this.arena.ceiling;
      if (this.stage.id === 'whale') {
        const z = this.zonesBetween(x, x).find(z => z.type === 'ribs');
        return z ? this.height(x) - 180 - 90 * Math.pow(Math.abs((x - (z.start + z.end) / 2) / 410), 4) : -Infinity;
      }
      if (this.stage.id !== 'ice') return -Infinity;
      const ice = 87 + noise(x / 490, this.seed + 57) * 35 + Math.sin(x / 116) * 12;
      const clearance = this.height(x) - 250;
      // A smooth minimum follows every rising hill, including late-run ramps.
      // The complete corridor stays at least 250 px high for the largest rover.
      return (ice + clearance - Math.hypot(ice - clearance, 32)) * 0.5;
    }
    gravityCeiling(x) {
      const ceiling = this.ceiling(x);
      return Number.isFinite(ceiling) ? ceiling : this.height(x) - 340;
    }
    setArena() {
      this.arena = { left: 0, right: 1800, ceiling: 40 };
      this.chunks.clear();
      return this;
    }
    platformsBetween(start, end) {
      if (this.arena || (this.stage.id !== 'kelp' && this.stage.id !== 'wreck')) return [];
      const result = [];
      for (let i = Math.max(0, Math.floor((start - 4200) / 4400)); i <= Math.floor((end - 2600) / 4400); i++) {
        const left = 3000 + i * 4400 + hash(i, this.seed + 104) * 260;
        const right = left + 1250;
        if (right < start || left > end) continue;
        result.push({ id: 'deck:' + i, start: left, end: right, type: this.stage.id === 'wreck' ? 'deck' : 'root' });
      }
      return result;
    }
    platformHeight(x, platform) {
      if (!platform || x < platform.start || x > platform.end) return -Infinity;
      // Broad, gently curved decks form a second route with open water below.
      // Tapered ends are reachable with ballast; springs mark the kelp approach.
      const u = (x - platform.start) / (platform.end - platform.start);
      return this.height(x) - (65 + 130 * Math.sin(Math.PI * u));
    }
    platformSlope(x, platform) {
      const left = Math.max(platform.start, x - 4), right = Math.min(platform.end, x + 4);
      return right > left ? (this.platformHeight(right, platform) - this.platformHeight(left, platform)) / (right - left) : 0;
    }
    hotSpringsBetween(start, end) {
      if (this.arena || this.stage.id !== 'kelp') return [];
      return this.platformsBetween(start - 1400, end + 400).map((platform) => ({
        x: platform.start - 65, y: this.height(platform.start - 65), width: 125, strength: 285
      })).filter(function (spring) { return spring.x + spring.width >= start && spring.x - spring.width <= end; });
    }
    vent(x) {
      if (this.arena) return 0;
      if (this.stage.id === 'kelp') {
        const spring = this.hotSpringsBetween(x, x)[0];
        if (!spring) return 0;
        const d = Math.abs(x - spring.x) / spring.width;
        return d < 1 ? Math.cos(d * Math.PI / 2) * spring.strength : 0;
      }
      // Runs start at x=100; leave the first 220 m free of updrafts.
      if (this.stage.id !== 'volcanic' || x < 2300) return 0;
      const position = ((x - 600) % 960 + 960) % 960;
      const d = Math.abs(position - 70);
      const strength = 1 + 0.5 * Math.min(1, Math.max(0, (x - 2300) / 12800));
      return d < 70 ? Math.cos(d / 70 * Math.PI / 2) * 232.5 * strength : 0;
    }
    maintain(x) {
      const center = Math.floor(x / CHUNK_SIZE);
      for (const index of this.chunks.keys()) if (index < center - 3 || index > center + 5) this.chunks.delete(index);
      for (let i = center - 1; i <= center + 3; i++) this.chunk(i);
    }
    rampsBetween(start, end) {
      const result = [];
      const period = 1850 / this.stage.ramps;
      for (let section = Math.floor(start / period) - 1; section <= Math.floor(end / period) + 1; section++) {
        const x = section * period + period * 0.61 + 210;
        if (x < Math.max(860, start) || x > end) continue;
        const difficulty = 1 + Math.min(1.1, Math.max(0, x - 2000) / 22000);
        result.push({ x: x, y: this.height(x), height: (35 + hash(section, this.seed + 56) * 32) * difficulty });
      }
      return result;
    }
    features(start, end) {
      const result = [];
      const stage = this.stage.id;
      const type = { reef: 'coral', kelp: 'kelp', wreck: 'wreck', volcanic: 'vent', ice: 'ice', abyss: 'angler', city: 'column', whale: 'bone', thermal: 'spring' }[stage];
      for (let i = Math.floor(start / 180); i <= Math.ceil(end / 180); i++) {
        const x = i * 180 + hash(i, this.seed + 3) * 120;
        result.push({ x: x, y: this.height(x), type: type, size: 0.65 + hash(i, this.seed + 8) * 1.1, seed: hash(i, this.seed + 11) });
      }
      return result;
    }
  }
  // Shared impulse: every suspension body receives the same velocity change.
  AR.launchGeyser = function (r, strength = 1, spin = (Math.random() * .8 - .4)) {
    const impulse = AR.getStats(r.stats.id, { ballast: 5 }).burst * 1.6 * strength;
    r.sleeping = false; r.sleepTime = 0; r.grounded = false; r.omega += spin;
    for (const body of [r, ...r.wheels]) { body.vy = Math.min(0, body.vy) - impulse; body.vx *= .68; body.grounded = false; }
    r.geyserFlight = 2;
  };
  function sweptCircle(ax, ay, bx, by, radius) {
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(ax + dx * t, ay + dy * t) <= radius;
  }
  function sweptBox(ax, ay, bx, by, halfX, halfY) {
    let lo = 0, hi = 1;
    for (const [a, b, size] of [[ax, bx, halfX], [ay, by, halfY]]) {
      const d = b - a;
      if (Math.abs(d) < 1e-9) { if (Math.abs(a) > size) return false; continue; }
      const t1 = (-size - a) / d, t2 = (size - a) / d;
      lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
      if (lo > hi) return false;
    }
    return true;
  }
  class WorldHazards {
    constructor(terrain, onBite) {
      this.terrain = terrain; this.onBite = onBite;
      this.sharks = []; this.time = 0; this.cooldowns = new WeakMap(); this.retired = new Map();
    }
    hit(shark, oldX, oldY, r) {
      const prev = r.prev || r, c = Math.cos(r.angle), s = Math.sin(r.angle);
      const ax = oldX - prev.x, ay = oldY - prev.y, bx = shark.x - r.x, by = shark.y - r.y;
      if (sweptBox(ax * c + ay * s, -ax * s + ay * c, bx * c + by * s, -bx * s + by * c, r.stats.wheelbase * .45 + 14, 27)) return true;
      return r.wheels.some((w, i) => { const p = prev.wheels?.[i] || w; return sweptCircle(oldX - p.x, oldY - p.y, shark.x - w.x, shark.y - w.y, w.radius + 14); });
    }
    retreat(shark, active) {
      shark.phase = 'recover'; shark.timer = 6; this.retired.set(shark.id, this.time + 6);
      for (const r of active) if (shark.target === r && r.oxygen > 0 && !r.crashed) r.sharkEncounters = (r.sharkEncounters || 0) + 1;
      shark.target = null;
    }
    step(rovers, dt) {
      dt = Math.max(0, Math.min(Number(dt) || 0, 1 / 30)); this.time += dt;
      const active = (rovers || []).filter(r => r && !r.crashed && !r.out && !r.respawn), stage = this.terrain.stage.id;
      if (this.terrain.arena || !['reef', 'abyss', 'wreck', 'whale'].includes(stage) || !active.length) { this.sharks = []; return; }
      for (const [id, until] of this.retired) if (until < this.time - 6) this.retired.delete(id);
      const needed = new Set();
      for (const r of active) {
        this.cooldowns.set(r, Math.max(0, (this.cooldowns.get(r) || 0) - dt));
        for (let cell = Math.max(0, Math.floor((r.x - 3800) / 1700)); cell <= Math.floor((r.x - 1700) / 1700); cell++) {
          const home = 2850 + cell * 1700 + hash(cell, this.terrain.seed + 208) * 240;
          for (let j = 0; j < (['abyss', 'wreck', 'whale'].includes(stage) && cell % 3 === 2 ? 2 : 1); j++) {
            const id = cell * 2 + j, homeX = home + j * 440;
            if (Math.abs(homeX - r.x) > 1350) continue;
            needed.add(id);
            if (!this.sharks.some(q => q.id === id) && !(this.retired.get(id) > this.time)) this.sharks.push({ id, homeX, x: homeX, y: this.terrain.height(homeX) - 38, phase: 'patrol', direction: -1, timer: 0, vx: 0, vy: 0, fish: stage === 'whale' });
          }
        }
      }
      this.sharks = this.sharks.filter(q => needed.has(q.id) || q.phase === 'lunge' || q.phase === 'warning');
      for (const q of this.sharks) {
        q.timer = Math.max(0, q.timer - dt);
        const target = active.reduce((a, r) => !a || Math.abs(r.x - q.x) < Math.abs(a.x - q.x) ? r : a, null);
        if (q.phase === 'recover') { q.x += q.direction * 600 * dt; q.y -= 100 * dt; if (!q.timer) { q.phase = 'patrol'; q.x = q.homeX; } continue; }
        if (q.phase === 'patrol') {
          q.direction = Math.sign(target.x - q.x) || -1;
          q.x += q.direction * Math.max(45, Math.abs(target.vx) * .55) * dt;
          q.y = this.terrain.height(q.x) - 110;
          if (target.x >= 2300 && Math.abs(target.x - q.x) < 480) { q.phase = 'warning'; q.timer = .9; Object.defineProperty(q, 'target', { value: target, writable: true, configurable: true }); q.aimX = target.x + target.vx * 1.4; q.aimY = this.terrain.height(q.aimX) - 38; }
        } else if (q.phase === 'warning') {
          // Commit to the warning line: .9 s warning + .5 s target lead. Braking changes the rover's arrival, not this path.
          q.direction = Math.sign(q.aimX - q.x) || 1;
          if (q.timer <= 1e-8) {
            const dx = q.aimX - q.x, dy = q.aimY - q.y, length = Math.hypot(dx, dy) || 1;
            const speed = Math.max(380, Math.abs(target.vx) * 1.5);
            q.vx = dx / length * speed; q.vy = dy / length * speed;
            q.phase = 'lunge'; q.timer = Math.max(1.2, 600 / speed);
          }
        } else if (q.phase === 'lunge') {
          const oldX = q.x, oldY = q.y; q.x += q.vx * dt; q.y += q.vy * dt;
          for (const r of active) {
            if (r.x < 2300 || this.cooldowns.get(r) > 0 || !this.hit(q, oldX, oldY, r)) continue;
            this.cooldowns.set(r, 2);
            const blocked = this.onBite && this.onBite(r, q);
            if (!blocked && !this.onBite) {
              if (!q.fish) r.oxygen = Math.max(0, r.oxygen - 20);
              r.sleeping = false; r.sleepTime = 0;
              for (const body of [r, ...r.wheels]) { body.vx += q.direction * (q.fish ? 55 : 180); body.vy -= q.fish ? 22 : 65; }
              r.sharkBite = q.fish ? .35 : 1;
              // A bite is recoverable; its shove cannot crush the hull immediately.
              r.gravityGrace = q.fish ? .5 : 1;
              if (!r.oxygen) r.crashed = 'Oxygen depleted';
            }
            this.retreat(q, active); break;
          }
          if (!q.timer && q.phase === 'lunge') this.retreat(q, active);
        }
      }
    }
  }
  AR.Terrain = Terrain;
  AR.WorldHazards = WorldHazards;
})(typeof globalThis !== 'undefined' ? globalThis : this);
