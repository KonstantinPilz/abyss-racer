'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('/home/ubuntu/projects/mcp-chromium-arm64/node_modules/puppeteer-core');
const executablePath = process.env.ABYSS_CHROME || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const url = 'file://' + path.resolve(__dirname, '../docs/index.html') + '?debug=1';
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
(async () => {
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const screenshots = [], errors = [];
  try {
    const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    for (const size of [{ width: 1280, height: 720, deviceScaleFactor: 1 }, { width: 844, height: 390, deviceScaleFactor: 2 }]) {
      await page.setViewport(size); const label = size.width + 'x' + size.height;
      const shot = async name => { await paint(page); const file = '/tmp/abyss-r5-' + label + '-' + name + '.png'; await page.screenshot({ path: file }); screenshots.push(file); };
      for (const stage of ['city', 'whale', 'thermal']) {
        await page.goto(url); await page.evaluate(stage => localStorage.setItem('abyss-racer-save', JSON.stringify({ version: 2, selectedStage: stage, stages: AR.STAGES.map(s => s.id), pearls: 100000 })), stage);
        await page.goto(url); await page.click('#enter-garage');
        if (stage === 'city') { await page.click('[data-tab="stages"]'); await page.$eval('[data-stage-art=city]', n => n.closest('article').scrollIntoView({ block: 'start' })); await shot('garage'); assert.equal(await page.$$eval('[data-stage-art]', ns => ns.length), 9); }
        await page.click('#start-run');
        await page.evaluate(stage => {
          AR.debug.solo.place(stage === 'city' ? 2020 : stage === 'whale' ? 1220 : 955);
          const scene = AR.debug.solo.scene(); scene.terrain.worldTime = stage === 'thermal' ? 3.58 : 1;
          scene.rover.step = () => {}; scene.terrain.stepWorld = () => {};
        }, stage);
        await shot(stage + '-solo'); assert.equal(await page.evaluate(() => AR.inspect().state), 'RUNNING');
        await page.goto(url); await page.$eval('#enter-versus', n => n.click()); await page.select('#versus-stage', stage); await page.click('#versus-start');
        await page.evaluate(stage => {
          window.v = AR.debug.online.v; v.phase = 'RUNNING'; v.tick = () => {}; v.show();
          const x = stage === 'city' ? 2030 : stage === 'whale' ? 1230 : 955;
          AR.debug.placePlayer(0, { x }); AR.debug.placePlayer(1, { x: x + 210 });
          v.time = v.terrain.worldTime = stage === 'thermal' ? 3.6 : 1;
          if (stage === 'city') v.terrain.bridges.set(0, .2);
          v.cameras = [{}, {}]; v.hud();
        }, stage);
        await shot(stage + '-versus');
      }
      await page.evaluate(() => {
        v.config.stage = 'reef'; v.startMatch(); v.phase = 'RUNNING'; v.show();
        AR.debug.placePlayer(0, { x: 800 }); AR.debug.placePlayer(1, { x: 1000 });
        AR.debug.giveItem(0, 'geyser'); v.useItem(0); for (let i = 0; i < 50; i++) v.step(AR.FIXED_DT); v.cameras = [{}, {}]; v.hud();
      }); await shot('geyser');
      await page.evaluate(() => { AR.debug.giveItem(0, 'riptide'); v.useItem(0); v.hud(); }); await shot('riptide');
      assert.equal(await page.$eval('#v-reversed-1', n => n.hidden), false);
      await page.evaluate(() => {
        v.config.mode = 'treasure'; v.config.carryTarget = 20; v.startMatch(); v.phase = 'RUNNING'; v.show();
        AR.debug.placePlayer(0, { x: 800 }); AR.debug.placePlayer(1, { x: 1050 }); v.chest.carrier = 0; v.players[0].carryTime = 14.2; v.players[1].carryTime = 9.6; v.updateChest(AR.FIXED_DT); v.hud();
      }); await shot('treasure-hud');
      assert.match(await page.$eval('#v-treasure-0', n => n.textContent), /14.2s.*9.6s/);
      await page.evaluate(() => { v.players[0].carryTime = 20 - AR.FIXED_DT; v.players[0].steals = 2; v.updateChest(AR.FIXED_DT); v.finishMatch(); }); await shot('treasure-results');
      assert.match(await page.$eval('#versus-overlay-content', n => n.textContent), /CARRY TIME.*20.0 s.*STEALS.*2/);
      // Real codec and loopback delivery into the actual guest renderer/UI.
      await page.goto(url);
      await page.evaluate(() => {
        const n = AR.debug.online, [ht, gt] = AR.LoopbackTransport.pair({ latency: 40, loss: .2, seed: 43 });
        const build = AR.Versus.prototype.buildUI; AR.Versus.prototype.buildUI = () => {};
        const hv = new AR.Versus({ data: { versus: {}, settings: {} }, finishVersus() {} }, { unlock() {}, suspend() {}, play() {}, update() {} }, n.v.renderer, () => {}); AR.Versus.prototype.buildUI = build;
        for (const name of ['show', 'hud', 'resultUI']) hv[name] = () => {};
        window.host = new AR.Online(hv, { headless: true, now: () => ht.wire.now });
        n.open(); n.now = () => ht.wire.now; n.attach('guest', gt); host.attach('host', ht);
        host.state = n.state = 'CONNECTING'; host.connected(); n.connected();
        window.pump = seconds => { for (let i = 0; i < Math.ceil(seconds * 120); i++) { ht.pump(1000 / 120); host.tick(AR.FIXED_DT); n.tick(AR.FIXED_DT); } };
        pump(.5); host.configure('mode', 'treasure'); host.configure('stage', 'city'); host.configure('bestOf', 1); host.configure('carryTarget', 20); pump(.3); host.ready(); n.ready(); pump(.3); host.start(); pump(4.4);
        n.v.tick = () => {}; n.v.step = () => { throw new Error('Guest stepped physics'); };
        window.v = host.v; v.debug().placePlayer(0, { x: 2300 }); v.debug().placePlayer(1, { x: 2060 });
        v.players[1].rover.wheels.forEach(w => { w.grounded = true; w.y = v.terrain.height(w.x) - w.radius; }); pump(.8);
        v.chest.carrier = 1; v.players[1].carryTime = 8.6; v.players[0].carryTime = 5.2;
        v.debug().giveItem(0, 'riptide'); v.useItem(0); v.debug().giveItem(0, 'geyser'); v.useItem(0); pump(.5);
        n.v.hud(); n.ui.status();
      });
      await shot('online-geyser-riptide-collapse');
      assert(await page.evaluate(() => AR.debug.online.v.players[1].effects.riptide > 0 && AR.debug.online.v.players[1].effects.geyser > 0 && AR.debug.online.v.terrain.bridges.has(0)));
      assert.equal(await page.$$eval('.online-pedal.reversed', ns => ns.length), 2);
      for (const stage of ['whale', 'thermal']) {
        await page.evaluate(stage => {
          const n = AR.debug.online; v.matchConfig.stage = stage; v.round++; v.newRound(); pump(.3); v.phase = 'RUNNING'; host.publishPhase();
          const x = stage === 'whale' ? 2150 : 955;
          v.debug().placePlayer(0, { x: x + 300 }); v.debug().placePlayer(1, { x }); v.time = v.terrain.worldTime = stage === 'thermal' ? 3.42 : 1;
          pump(.4); n.v.hud(); n.ui.status();
        }, stage); await shot('online-' + stage);
      }
      await page.evaluate(() => {
        const n = AR.debug.online; v.chest.carrier = 1; v.players[1].carryTime = 19.99; v.updateChest(.02); v.finishMatch(); host.publishPhase(); pump(.3); n.v.hud(); n.ui.status();
      }); await shot('online-treasure-results');
      const layout = await page.evaluate(() => {
        const result = document.getElementById('versus-overlay-content'), r = result.getBoundingClientRect();
        return { width: r.width, viewport: innerWidth, scroll: result.scrollWidth, client: result.clientWidth };
      }); assert(layout.width <= layout.viewport && layout.scroll <= layout.client + 1);
      // Every shark phase is delivered through the production wire and painted by the guest.
      await page.evaluate(() => {
        v.matchConfig.mode = 'race'; v.matchConfig.stage = 'wreck'; v.round++; v.newRound(); pump(.3); v.phase = 'RUNNING'; host.publishPhase();
        v.debug().placePlayer(0, { x: 3100 }); v.debug().placePlayer(1, { x: 2700 }); pump(.2);
        v.hazards.step = () => {}; v.hazards.sharks = [{ id: 1, x: 3010, y: v.terrain.height(3010) - 110, direction: -1, timer: .8, aimX: 2700, aimY: v.terrain.height(2700) - 38, fish: false, phase: 'warning' }];
      });
      for (const phase of ['patrol', 'warning', 'lunge', 'recover']) {
        await page.evaluate(phase => { v.hazards.sharks[0].phase = phase; host.snapshot(); pump(.2); AR.debug.online.v.hud(); }, phase);
        await paint(page); assert.equal(await page.evaluate(() => AR.debug.online.v.hazards.sharks[0].phase), phase);
        if (phase === 'warning') await shot('online-shark-warning');
      }
      assert.deepEqual(errors, []);
    }
    fs.writeFileSync('/tmp/abyss-r5-browser.json', JSON.stringify({ screenshots, errors }, null, 2));
    console.log('PASS Round 5 browser: ' + screenshots.length + ' screenshots, solo/local/loopback guest, both viewport sizes, zero console errors');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
