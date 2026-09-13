(function (root) {
  'use strict';
  const AR = root.AR = root.AR || {};
  // QR Model 2, byte mode, versions 1–4, medium error correction. All modules
  // are constructed here; no runtime QR dependency or external image service.
  const SPECS = [null, [16, 10, 1], [28, 16, 1], [44, 26, 1], [64, 18, 2]];
  function multiply(a, b) {
    let n = 0;
    for (; b; b >>>= 1) { if (b & 1) n ^= a; a <<= 1; if (a & 256) a ^= 0x11d; }
    return n;
  }
  function parity(data, count) {
    let poly = [1], power = 1;
    for (let i = 0; i < count; i++) {
      const next = Array(poly.length + 1).fill(0);
      poly.forEach((n, j) => { next[j] ^= n; next[j + 1] ^= multiply(n, power); });
      poly = next; power = multiply(power, 2);
    }
    const rest = [...data, ...Array(count).fill(0)];
    for (let i = 0; i < data.length; i++) { const factor = rest[i]; for (let j = 0; j < poly.length; j++) rest[i + j] ^= multiply(poly[j], factor); }
    return rest.slice(-count);
  }
  const masks = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => x * y % 2 + x * y % 3 === 0, (x, y) => (x * y % 2 + x * y % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0
  ];
  function penalty(grid) {
    const n = grid.length; let score = 0, dark = 0;
    for (let y = 0; y < n; y++) {
      dark += grid[y].filter(Boolean).length;
      for (let x = 0; x < n - 1; x++) if (y < n - 1 && grid[y][x] === grid[y][x + 1] && grid[y][x] === grid[y + 1][x] && grid[y][x] === grid[y + 1][x + 1]) score += 3;
      for (const line of [grid[y], grid.map(row => row[y])]) {
        let run = 1;
        for (let x = 1; x <= n; x++) { if (x < n && line[x] === line[x - 1]) run++; else { if (run >= 5) score += run - 2; run = 1; } }
        const bits = line.map(Number).join('');
        for (let x = 0; x <= n - 11; x++) if (['00001011101', '10111010000'].includes(bits.slice(x, x + 11))) score += 40;
      }
    }
    return score + Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10;
  }
  function encode(text, forcedMask) {
    const bytes = [...new TextEncoder().encode(text)];
    const version = [1, 2, 3, 4].find(v => 12 + bytes.length * 8 <= SPECS[v][0] * 8);
    if (!version) throw new Error('QR link is too long (maximum 62 UTF-8 bytes).');
    if (forcedMask !== undefined && (!Number.isInteger(forcedMask) || forcedMask < 0 || forcedMask > 7)) throw new Error('Invalid QR mask');
    const [capacity, ecCount, blocks] = SPECS[version], bits = [];
    const append = (n, count) => { for (let i = count - 1; i >= 0; i--) bits.push((n >>> i) & 1); };
    append(4, 4); append(bytes.length, 8); bytes.forEach(n => append(n, 8));
    append(0, Math.min(4, capacity * 8 - bits.length)); while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, bit) => n * 2 + bit, 0));
    for (let i = 0; data.length < capacity; i++) data.push(i % 2 ? 0x11 : 0xec);
    const chunks = Array.from({ length: blocks }, (_, i) => data.slice(i * capacity / blocks, (i + 1) * capacity / blocks));
    const ec = chunks.map(chunk => parity(chunk, ecCount)), words = [];
    for (let i = 0; i < capacity / blocks; i++) chunks.forEach(chunk => words.push(chunk[i]));
    for (let i = 0; i < ecCount; i++) ec.forEach(chunk => words.push(chunk[i]));
    const n = version * 4 + 17, base = Array.from({ length: n }, () => Array(n).fill(false)), reserved = base.map(row => row.slice());
    const set = (x, y, dark) => { if (x >= 0 && y >= 0 && x < n && y < n) { base[y][x] = !!dark; reserved[y][x] = true; } };
    for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); }
    }
    if (version > 1) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(n - 7 + dx, n - 7 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    function format(mask, write) {
      // M is format-level 00; generator x^10+x^8+x^5+x^4+x^2+x+1.
      let rem = mask << 10;
      for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
      const value = ((mask << 10) | rem) ^ 0x5412, bit = i => (value >>> i) & 1;
      for (let i = 0; i <= 5; i++) write(8, i, bit(i));
      write(8, 7, bit(6)); write(8, 8, bit(7)); write(7, 8, bit(8));
      for (let i = 9; i < 15; i++) write(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) write(n - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) write(8, n - 15 + i, bit(i));
      write(8, n - 8, true);
      return value;
    }
    format(0, set);
    let index = 0, up = true;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right--;
      for (let row = 0; row < n; row++) {
        const y = up ? n - 1 - row : row;
        for (let j = 0; j < 2; j++) { const x = right - j; if (!reserved[y][x]) { base[y][x] = !!((words[index >>> 3] || 0) >>> (7 - index % 8) & 1); index++; } }
      }
      up = !up;
    }
    let best, mask, bestScore = Infinity, formatBits;
    for (let m = 0; m < 8; m++) {
      if (forcedMask !== undefined && m !== forcedMask) continue;
      const grid = base.map((row, y) => row.map((value, x) => reserved[y][x] ? value : value !== masks[m](x, y)));
      const f = format(m, (x, y, value) => { grid[y][x] = !!value; });
      const score = penalty(grid); if (score < bestScore) { bestScore = score; best = grid; mask = m; formatBits = f; }
    }
    return { version, size: n, mask, modules: best, data, ec, words, formatBits };
  }
  function draw(canvas, text) {
    const qr = encode(text), scale = 6, margin = 4;
    canvas.width = canvas.height = (qr.size + margin * 2) * scale;
    const c = canvas.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height); c.fillStyle = '#071e2a';
    qr.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) c.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale); }));
    return qr;
  }
  AR.QR = { encode, draw };
})(globalThis);
