'use strict';
// Run alone: software Chromium shares the server CPU with other test browsers.
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('/home/ubuntu/projects/mcp-chromium-arm64/node_modules/puppeteer-core');
const executablePath = process.env.ABYSS_CHROME || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
(async () => {
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto('file://' + path.resolve(__dirname, '../docs/index.html') + '?debug=1');
    await page.click('#enter-versus');
    if (process.argv[3] === 'performance') await page.select('#versus-graphics', 'performance');
    await page.select('#versus-target', '2000'); await page.click('#versus-start');
    await page.evaluate(() => AR.debug.advance(4.02));
    const result = await page.evaluate(async mode => {
      const proto = AR.Renderer.prototype, methods = ['background', 'ground', 'decorations', 'pickups', 'drawVehicle', 'ambient', 'renderAwarenessLayer', 'render'];
      const totals = {}, counts = {};
      let measuring = false;
      for (const key of methods) {
        const original = proto[key];
        proto[key] = function (...args) {
          const start = performance.now(); const value = original.apply(this, args); const elapsed = performance.now() - start;
          if (measuring) { totals[key] = (totals[key] || 0) + elapsed; counts[key] = (counts[key] || 0) + 1; }
          return value;
        };
      }
      if (mode === 'forced2') {
        const original = proto.updateResolution;
        proto.updateResolution = function (...args) {
          original.apply(this, args);
          if (this.dpr !== 2) { this.dpr = 2; this.canvas.width = Math.round(this.width * 2); this.canvas.height = Math.round(this.height * 2); this.lightCanvas.width = this.canvas.width; this.lightCanvas.height = this.canvas.height; }
          // Prevent repeated buffer resizes in the legacy adaptive renderer.
          this.versusDensity = 2; this.slowFrames = 0;
        };
      }
      let frames = 0, start, previous, sampleStart; const intervals = [];
      return await new Promise(resolve => {
        function frame(now) {
          if (!start) start = now;
          // Repeat the same smooth, flat starting-ground trajectory in every run.
          const x = 100 + ((now - start) * .12 % 1100);
          AR.debug.placePlayer(0, { x, vx: 240, oxygen: 100 });
          AR.debug.placePlayer(1, { x: x + 160, vx: 240, oxygen: 100 });
          if (now - start >= 3000) {
            if (!measuring) { measuring = true; sampleStart = now; } else { frames++; intervals.push(now - previous); }
            previous = now;
          }
          if (now - start < 11000) return requestAnimationFrame(frame);
          const elapsed = now - sampleStart, canvas = document.getElementById('ocean');
          intervals.sort((a,b) => a-b);
          resolve({ mode, viewport: '1440x900@2x', frames, seconds: elapsed / 1000, renderedFps: frames * 1000 / elapsed, backingWidth: canvas.width, backingHeight: canvas.height, density: canvas.width / canvas.clientWidth, p95FrameMs: intervals[Math.floor(intervals.length * .95)], meanRenderSubmitMs: totals.render / counts.render * 2, methodMsPerFrame: Object.fromEntries(Object.keys(totals).map(k => [k, +(totals[k] / (counts.render / 2)).toFixed(3)])) });
        }
        requestAnimationFrame(frame);
      });
    }, process.argv[3] || 'default');
    const filename = '/tmp/abyss-fix2-fps-' + (process.argv[2] || 'current') + '.json';
    fs.writeFileSync(filename, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
