'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('/home/ubuntu/projects/mcp-chromium-arm64/node_modules/puppeteer-core');
const executablePath = process.env.ABYSS_CHROME || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const url = 'file://' + path.resolve(__dirname, '../docs/index.html') + '?debug=1';
(async () => {
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const errors = [], screenshots = [], memory = [];
  try {
    for (const own of [0, 1, 2]) {
      const context = await browser.createBrowserContext(), page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (['error', 'warn'].includes(m.type())) errors.push(m.text()); });
      page.on('request', r => { if (/^https?:/.test(r.url())) errors.push('Unexpected network request: ' + r.url()); });
      // Exercise Safari's HTMLCanvas fallback as well as OffscreenCanvas.
      if (own === 2) await page.evaluateOnNewDocument(() => { window.OffscreenCanvas = undefined; });
      const size = { width: 393, height: own === 1 ? 455 : 428, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
      await page.setViewport(size); await page.goto(url);
      let navigations = 0; page.on('framenavigated', f => { if (f === page.mainFrame()) navigations++; });
      const shot = async label => { const file = '/tmp/abyss-trio-p' + (own + 1) + '-' + label + '.png'; await page.screenshot({ path: file }); screenshots.push(file); };
      if (own === 0) { await shot('title'); assert.match(await page.$eval('#enter-online', e => e.textContent), /2–3 PHONES/); }
      await page.addScriptTag({ path: path.join(__dirname, 'helpers/phone-wire.cjs') });
      await page.evaluate(async own => {
        window.wire = makePhoneWire(); window.Peer = wire.Peer;
        const actual = AR.debug.online, build = AR.Versus.prototype.buildUI;
        window.games = [];
        for (let i = 0; i < 3; i++) {
          let n = actual;
          if (i !== own) {
            AR.Versus.prototype.buildUI = () => {};
            const sound = { unlock() {}, suspend() {}, play() {}, update() {}, setMuted() {} };
            const v = new AR.Versus(new AR.Save(), sound, actual.v.renderer, () => {});
            AR.Versus.prototype.buildUI = build;
            for (const method of ['show', 'hud', 'resultUI']) v[method] = () => {};
            n = new AR.Online(v, { headless: true, now: () => wire.now });
          }
          n.now = () => wire.now; n.connect(i ? 'guest' : 'host', 'TEST'); await Promise.resolve(); games.push(n);
        }
        const tick = actual.tick.bind(actual); actual.tick = dt => { if (window.pumping) tick(dt); };
        window.pump = seconds => {
          window.pumping = true;
          try { for (let i = 0; i < Math.ceil(seconds * 120); i++) { wire.pump(1000 / 120); actual.maintain(); games.forEach(n => n.tick(AR.FIXED_DT)); } }
          finally { window.pumping = false; }
        };
        pump(1); games[0].configure('bestOf', 1); pump(.2);
        for (const n of games.slice(1)) n.v.step = () => { throw new Error('Guest simulated'); };
      }, own);
      assert.equal(await page.evaluate(() => AR.debug.online.index), own);
      assert.equal(await page.evaluate(() => AR.inspect().online.racers), 3);
      await page.select('#online-vehicle', ['rover', 'crab', 'manta'][own]); await page.evaluate(() => pump(.3));
      await shot('lobby');
      const overflow = await page.$eval('#online-screen', e => ({ scroll: e.scrollWidth, client: e.clientWidth })); assert(overflow.scroll <= overflow.client + 1, JSON.stringify(overflow));
      assert.equal(await page.$eval('#online-option-stage', e => e.disabled), own !== 0);
      await page.$eval('#online-ready', e => e.scrollIntoView({ block: 'center' })); await shot('loadout'); await page.tap('#online-ready');
      await page.evaluate(own => { pump(.2); games.forEach((n, i) => { if (i !== own) n.ready(); }); pump(.2); }, own);
      if (own === 0) await page.tap('#online-start'); else await page.evaluate(() => games[0].start());
      await page.evaluate(() => pump(4.4));
      assert.equal(await page.evaluate(() => AR.inspect().state), 'ONLINE_RUNNING');
      await page.evaluate(() => {
        const v = games[0].v; v.players.forEach((p, i) => v.debug().placePlayer(i, { x: 500 + i * 150, oxygen: 100 })); pump(.3);
        AR.debug.online.v.cameras = v.players.map(() => ({})); AR.debug.online.v.hud(); AR.debug.online.ui.status();
      });
      await shot('race');
      const layout = await page.evaluate(() => ({
        visibleHuds: [...document.querySelectorAll('.v-hud')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.id),
        buttons: [...document.querySelectorAll('#online-pedals button')].map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }),
        overscroll: getComputedStyle(document.documentElement).overscrollBehavior
      }));
      assert.deepEqual(layout.visibleHuds, ['v-hud-' + own]); assert.equal(layout.overscroll, 'none');
      for (const r of layout.buttons) assert(r.x >= 0 && r.y >= 0 && r.x + r.w <= size.width + 1 && r.y + r.h <= size.height + 1 && r.w >= 44 && r.h >= 44);
      // Real simultaneous touch: drive + ballast, then cancellation must release.
      const cdp = await page.createCDPSession();
      const touches = await page.evaluate(() => ['online-throttle', 'online-burst'].map((id, i) => { const r = document.getElementById(id).getBoundingClientRect(); return { id: i + 1, x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches }); await page.evaluate(() => pump(.15));
      assert.equal(await page.evaluate(() => AR.inspect().online.input.throttle), true);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await page.evaluate(() => pump(.2));
      assert.equal(await page.evaluate(() => AR.inspect().online.input.throttle), false);
      await page.evaluate(() => { wire.silent.add(games[2].transport.peer.id); pump(5.4); }); await shot('recovery');
      await page.evaluate(() => { wire.silent.clear(); pump(1.8); });
      assert.equal(await page.evaluate(() => AR.inspect().state), 'ONLINE_RUNNING');
      // Repeated orientation changes and many terrain/camera buckets retain a bounded cache.
      await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      await shot('landscape');
      assert.equal(await page.evaluate(() => AR.debug.online.v.renderer.cacheUsage().budget), 24 * 1024 * 1024, 'Phone memory budget survives rotation');
      await page.setViewport(size);
      const usage = await page.evaluate(() => {
        const n = AR.debug.online, v = n.v, renderer = v.renderer;
        for (let i = 0; i < 35; i++) {
          for (const p of v.players) { const dx = i * 90 - p.rover.x; p.rover.x += dx; p.rover.wheels.forEach(w => w.x += dx); p.rover.savePrevious(); }
          v.cameras[n.index] = {}; n.draw(1 / 60);
        }
        const usage = renderer.cacheUsage();
        const canvases = [...renderer.decorationChunks.values(), ...renderer.spriteCache.values(), ...renderer.groundCache.values()].map(v => v.sprite || v);
        renderer.clearCaches();
        if (typeof OffscreenCanvas === 'undefined' && canvases.some(c => c.width !== 1 || c.height !== 1)) throw new Error('Canvas backing store was not released');
        n.draw(1 / 60); return usage;
      });
      assert.equal(usage.budget, 24 * 1024 * 1024); assert(usage.bytes <= usage.budget, JSON.stringify(usage)); memory.push({ own, ...usage });
      await page.evaluate(() => { const v = games[0].v; v.debug().placePlayer(2, { x: v.players[2].startX + 5010, oxygen: 100 }); pump(3.8); AR.debug.online.ui.show(); });
      assert.match(await page.$eval('#versus-overlay-content', e => e.textContent), /PLAYER 3 WINS/);
      assert.equal(await page.$$eval('.v-result-pilot', nodes => nodes.length), 3);
      assert.equal(await page.$eval('#online-rotate', e => e.hidden), true); assert.equal(await page.$eval('#online-quality', e => e.hidden), true);
      await shot('results');
      const resultWidth = await page.$eval('#versus-overlay-content', e => ({ scroll: e.scrollWidth, client: e.clientWidth })); assert(resultWidth.scroll <= resultWidth.client + 1, JSON.stringify(resultWidth));
      assert.equal(navigations, 0, 'Driving, reconnection and orientation never navigate or refresh');
      await page.evaluate(() => { games.forEach(n => { n.active = false; n.transport.close(); }); });
      await context.close();
      console.log('PASS P' + (own + 1) + ' lobby, real multitouch, recovery, 393×' + size.height + ' / 844×390 layouts, results and bounded artwork memory');
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync('/tmp/abyss-trio-browser.json', JSON.stringify({ errors, screenshots, memory }, null, 2));
    console.log('PASS zero console errors, external requests or unexpected page navigations');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
