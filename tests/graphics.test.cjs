'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('/home/ubuntu/projects/mcp-chromium-arm64/node_modules/puppeteer-core');
const executablePath = process.env.ABYSS_CHROME || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage(), issues = [];
    page.on('pageerror', error => issues.push(error.message));
    page.on('console', m => { if (['error','warn'].includes(m.type())) issues.push(m.text()); });
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto('file://' + path.resolve(__dirname, '../docs/index.html') + '?debug=1');
    const backing = async density => {
      await page.waitForFunction(d => { const c = document.getElementById('ocean'); return c.width === Math.round(c.clientWidth * d) && c.height === Math.round(c.clientHeight * d); }, {}, density);
      const b = await page.$eval('#ocean', c => ({ width: c.width, height: c.height, cssWidth: c.clientWidth, cssHeight: c.clientHeight }));
      assert.equal(b.width, Math.round(b.cssWidth * density)); assert.equal(b.height, Math.round(b.cssHeight * density)); return b;
    };
    assert.equal(await page.evaluate(() => new AR.Save().data.settings.graphics), 'crisp');
    await page.click('#enter-garage'); await page.click('#start-run');
    const solo = await backing(2);
    await page.keyboard.down('ArrowRight'); await delay(750); await page.keyboard.up('ArrowRight');
    await page.screenshot({ path: '/tmp/abyss-fix2-solo.png' });
    await page.keyboard.press('KeyP'); await page.click('#end-run'); await page.click('#back-garage');
    await page.reload(); await page.click('#title-help');
    assert.equal(await page.$eval('#graphics-setting', n => n.value), 'crisp');
    await page.select('#graphics-setting', 'performance'); await backing(1);
    await page.reload(); assert.equal(await page.evaluate(() => new AR.Save().data.settings.graphics), 'performance'); await backing(1);
    await page.click('#enter-versus'); assert.equal(await page.$eval('#versus-graphics', n => n.value), 'performance');
    await page.select('#versus-graphics', 'crisp'); await backing(2);
    await page.click('#versus-start'); await page.evaluate(() => AR.debug.advance(4.02));
    const versus = await backing(2);
    await page.evaluate(() => { AR.debug.placePlayer(0, { x: 350, vx: 150 }); AR.debug.placePlayer(1, { x: 450, vx: 170 }); });
    await delay(400); await page.screenshot({ path: '/tmp/abyss-fix2-versus.png' });
    // Inspect the real renderer's overlap alpha and retain an exact explosion
    // frame without a pause overlay hiding the two viewport effects.
    await page.evaluate(() => {
      AR.debug.placePlayer(0, { x: 350 }); AR.debug.placePlayer(1, { x: 335 }); AR.debug.advance(.02);
      window.fix2Tick = AR.Versus.prototype.tick; AR.Versus.prototype.tick = function () {};
      window.fix2Alphas = [];
      const draw = AR.Renderer.prototype.drawVehicle;
      AR.Renderer.prototype.drawVehicle = function (c, rover, ...args) { window.fix2Alphas.push(c.globalAlpha); return draw.call(this, c, rover, ...args); };
    });
    await delay(450); await page.screenshot({ path: '/tmp/abyss-fix2-overtake.png' });
    assert(await page.evaluate(() => fix2Alphas.some(a => Math.abs(a - .55) < .001)), 'Overlapping rear rover renders at55%');
    await page.evaluate(() => {
      AR.Versus.prototype.tick = fix2Tick;
      AR.debug.placePlayer(0, { x: 100, oxygen: 100 }); AR.debug.placePlayer(1, { x: 700, oxygen: 100 }); AR.debug.fireTorpedo(0);
      for (let i = 0; i < 240 && !AR.inspect().players[1].respawn; i++) AR.debug.advance(AR.FIXED_DT);
      AR.debug.advance(.12); AR.Versus.prototype.tick = function () {};
    });
    assert.equal(await page.evaluate(() => AR.inspect().players[1].crashed), 'Torpedoed!');
    await delay(300); await page.screenshot({ path: '/tmp/abyss-fix2-explosion.png' });
    await page.evaluate(() => {
      AR.Versus.prototype.tick = fix2Tick; AR.debug.placePlayer(1, { x: 700, oxygen: 100 });
      AR.debug.setOxygen(0, 0); AR.debug.advance(.02); AR.Versus.prototype.tick = function () {};
    });
    assert.match(await page.$eval('#v-respawn-0', n => n.textContent), /OUT OF AIR.*RESPAWN 4.0 s/);
    await page.screenshot({ path: '/tmp/abyss-fix2-blackout.png' });
    await page.evaluate(() => { AR.Versus.prototype.tick = fix2Tick; AR.debug.placePlayer(0, { x: 100, oxygen: 100 }); });
    // Exercise sustained slow samples directly: backing size must remain fixed.
    const slow = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.style.cssText = 'width:1440px;height:900px';
      const r = new AR.Renderer(c); r.width = 1440; r.height = 900; r.canvas.width = 2880; r.canvas.height = 1800;
      for (const versus of [false, true]) for (let i = 0; i < 600; i++) r.updateResolution(versus, .05, { y: 0 });
      const size = { width: c.width, dpr: r.dpr }; r.showAwarenessLayer(false); r.awarenessCanvas.remove();
      let count = 0; const ellipse = r.ctx.ellipse.bind(r.ctx); r.ctx.ellipse = (...args) => { count++; return ellipse(...args); };
      r.versusView = true; r.ambient(r.ctx, { id: 'reef' }); const crispParticles = count; count = 0;
      r.graphics = 'performance'; r.ambient(r.ctx, { id: 'reef' });
      return { ...size, crispParticles, performanceParticles: count };
    });
    assert.equal(slow.width, 2880); assert.equal(slow.dpr, 2); assert(slow.performanceParticles < slow.crispParticles, 'Performance reduces particles'); await backing(2);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 3 }); await backing(2);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: .75 }); await backing(1);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 }); await backing(2);
    await page.keyboard.press('KeyP'); await page.click('#versus-abandon'); await page.select('#versus-graphics', 'performance');
    await page.click('#versus-start'); await page.evaluate(() => AR.debug.advance(4.02)); await backing(1);
    await page.reload(); await backing(1);
    // Invalid and legacy saves keep Crisp as the default without changing progress.
    const clean = await page.evaluate(() => {
      const original = localStorage.getItem('abyss-racer-save');
      const data = JSON.parse(original); data.settings.graphics = 'automatic'; localStorage.setItem('abyss-racer-save', JSON.stringify(data));
      const invalid = new AR.Save().data.settings.graphics;
      delete data.settings.graphics; localStorage.setItem('abyss-racer-save', JSON.stringify(data));
      const missing = new AR.Save().data.settings.graphics;
      localStorage.setItem('abyss-racer-save', original); return { invalid, missing };
    });
    assert.deepEqual(clean, { invalid: 'crisp', missing: 'crisp' });
    assert.deepEqual(issues, []);
    fs.writeFileSync('/tmp/abyss-fix2-graphics.json', JSON.stringify({ solo, versus, issues, tests: 'Crisp default/persistence, Performance persistence across modes/reload, invalid/legacy defaults, DPR 2 and 3 cap, DPR below1 floor, 600 slow frames without switching' }, null, 2));
    console.log('PASS graphics: solo/versus 2880×1800 at CSS1440×900 DPR2; settings persist; no adaptive changes; DPR ceiling/floor; screenshots; zero console issues');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
