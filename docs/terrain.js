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
      if (this.stage.id !== 'ice') return -Infinity;
      return 87 + noise(x / 490, this.seed + 57) * 35 + Math.sin(x / 116) * 12;
    }
    vent(x) {
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
  AR.Terrain = Terrain;
})(typeof globalThis !== 'undefined' ? globalThis : this);
