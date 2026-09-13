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
    height(x) {
      const index = Math.floor(x / CHUNK_SIZE);
      const chunk = this.chunk(index);
      const at = (x - index * CHUNK_SIZE) / SAMPLE_SIZE;
      const i = Math.min(chunk.length - 2, Math.floor(at));
      const t = at - i;
      return chunk[i] + (chunk[i + 1] - chunk[i]) * t;
    }
    slope(x) { return (this.height(x + 4) - this.height(x - 4)) / 8; }
    ceiling(x) {
      if (this.arena) return this.arena.ceiling;
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
      const type = { reef: 'coral', kelp: 'kelp', wreck: 'wreck', volcanic: 'vent', ice: 'ice', abyss: 'angler' }[stage];
      for (let i = Math.floor(start / 180); i <= Math.ceil(end / 180); i++) {
        const x = i * 180 + hash(i, this.seed + 3) * 120;
        result.push({ x: x, y: this.height(x), type: type, size: 0.65 + hash(i, this.seed + 8) * 1.1, seed: hash(i, this.seed + 11) });
      }
      return result;
    }
  }
  class WorldHazards {
    constructor(terrain) {
      this.terrain = terrain;
      this.sharks = [];
      this.time = 0;
      this.cooldowns = new WeakMap();
    }
    step(rovers, dt) {
      dt = Math.max(0, Math.min(Number(dt) || 0, 1 / 30));
      this.time += dt;
      const active = (rovers || []).filter(function (rover) { return rover && !rover.crashed && !rover.out && !rover.respawn; });
      if (this.terrain.arena || (this.terrain.stage.id !== 'reef' && this.terrain.stage.id !== 'abyss') || !active.length) { this.sharks = []; return; }
      const needed = new Set();
      for (const rover of active) {
        this.cooldowns.set(rover, Math.max(0, (this.cooldowns.get(rover) || 0) - dt));
        for (let cell = Math.max(0, Math.floor((rover.x - 3600) / 3200)); cell <= Math.floor((rover.x - 1800) / 3200); cell++) {
          const homeX = 2850 + cell * 3200 + hash(cell, this.terrain.seed + 208) * 350;
          if (Math.abs(homeX - rover.x) > 1000) continue;
          needed.add(cell);
          if (!this.sharks.some(function (shark) { return shark.id === cell; })) this.sharks.push({ id: cell, homeX: homeX, x: homeX, y: this.terrain.height(homeX) - 65, phase: 'patrol', direction: -1, timer: 0, vx: 0, vy: 0 });
        }
      }
      this.sharks = this.sharks.filter(function (shark) { return needed.has(shark.id); });
      for (const shark of this.sharks) {
        shark.timer = Math.max(0, shark.timer - dt);
        const target = active.reduce(function (best, rover) { return !best || Math.hypot(rover.x - shark.x, rover.y - shark.y) < Math.hypot(best.x - shark.x, best.y - shark.y) ? rover : best; }, null);
        const distance = Math.hypot(target.x - shark.x, target.y - shark.y);
        if (shark.phase === 'patrol') {
          shark.x = shark.homeX + Math.sin(this.time * 0.7 + shark.id) * 90;
          shark.y = this.terrain.height(shark.x) - 65 - Math.sin(this.time * 1.4 + shark.id) * 12;
          shark.direction = Math.cos(this.time * 0.7 + shark.id) >= 0 ? 1 : -1;
          if (target.x >= 2300 && distance < 390) { shark.phase = 'warning'; shark.timer = 1.05; }
        } else if (shark.phase === 'warning') {
          shark.direction = target.x >= shark.x ? 1 : -1;
          if (!shark.timer) {
            const length = Math.max(1, distance);
            shark.vx = (target.x - shark.x) / length * 235;
            shark.vy = (target.y - shark.y) / length * 235;
            shark.phase = 'lunge'; shark.timer = 1.15;
          }
        } else if (shark.phase === 'lunge') {
          const oldX = shark.x, oldY = shark.y;
          shark.x += shark.vx * dt; shark.y += shark.vy * dt;
          for (const rover of active) {
            if (rover.x < 2300 || this.cooldowns.get(rover) > 0) continue;
            const dx = shark.x - oldX, dy = shark.y - oldY;
            const t = Math.max(0, Math.min(1, ((rover.x - oldX) * dx + (rover.y - oldY) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
            if (Math.hypot(rover.x - oldX - dx * t, rover.y - oldY - dy * t) > 40) continue;
            // A bite costs air and gives a recoverable shove, never a crash.
            rover.oxygen = Math.max(Math.min(rover.oxygen, 1), rover.oxygen - 7);
            rover.sleeping = false; rover.sleepTime = 0;
            rover.vx += shark.direction * 65; rover.vy -= 35;
            rover.wheels.forEach(function (wheel) { wheel.vx += shark.direction * 65; wheel.vy -= 35; });
            rover.sharkBite = 0.65;
            this.cooldowns.set(rover, 4);
            shark.phase = 'recover'; shark.timer = 3;
          }
          if (!shark.timer) { shark.phase = 'recover'; shark.timer = 3; }
        } else if (!shark.timer) shark.phase = 'patrol';
      }
    }
  }
  AR.Terrain = Terrain;
  AR.WorldHazards = WorldHazards;
})(typeof globalThis !== 'undefined' ? globalThis : this);
