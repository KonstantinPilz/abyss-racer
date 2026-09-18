'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const puppeteer = require('/home/ubuntu/projects/mcp-chromium-arm64/node_modules/puppeteer-core');
const executablePath = process.env.ABYSS_CHROME || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const url = 'file://' + path.resolve(__dirname, '../docs/index.html') + '?debug=1';
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
(async () => {
  const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage(), errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.goto(url);
    await page.click('#enter-versus');
    await page.select('#versus-mode', 'arena');
    assert.match(await page.$eval('#versus-mode-note', n => n.textContent), /3|Three|three/);
    await page.screenshot({ path: '/tmp/abyss-suggestions-arena-setup.png' });
    await page.click('#versus-start');
    await page.evaluate(() => {
      AR.debug.advance(4.02);
      window.v = AR.debug.online.v;
      window.originalTick = v.tick;
      v.tick = () => {};
      AR.debug.placePlayer(0, { x: 700 }); AR.debug.placePlayer(1, { x: 1060 });
      v.players[0].facing = 1; v.players[1].facing = -1;
    });
    await page.keyboard.press('KeyS');
    assert.equal(await page.evaluate(() => v.projectiles[0].type), 'bubble');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => v.projectiles.length), 2);
    await page.evaluate(() => { for (let i = 0; i < 25; i++) v.step(AR.FIXED_DT); v.hud(); });
    await paint(page); await page.screenshot({ path: '/tmp/abyss-suggestions-arena.png' });
    // Use the real renderer and controller on each new terrain route.
    for (const stage of ['kelp', 'wreck', 'ice']) {
      await page.evaluate(stage => {
        v.config = { ...v.config, mode: 'race', stage }; v.startMatch(); v.phase = 'RUNNING'; v.show();
        const deck = v.terrain.platformsBetween(2500, 5000)[0];
        const x = deck ? deck.start + 130 : 22000;
        const floor = deck ? v.terrain.platformHeight(x, deck) : v.terrain.height(x);
        AR.debug.placePlayer(0, { x, y: floor - 54 }); AR.debug.placePlayer(1, { x: x + 250 });
        v.cameras = [{}, {}]; v.hud();
      }, stage);
      await paint(page); await page.screenshot({ path: '/tmp/abyss-suggestions-' + stage + '.png' });
      if (stage === 'kelp') {
        await page.evaluate(() => { const spring = v.terrain.hotSpringsBetween(2500, 5000)[0]; AR.debug.placePlayer(0, { x: spring.x + 15 }); v.cameras = [{}, {}]; });
        await paint(page); await page.screenshot({ path: '/tmp/abyss-suggestions-spring.png' });
      }
    }
    await page.evaluate(() => {
      v.config = { ...v.config, mode: 'race', stage: 'reef' }; v.startMatch(); v.phase = 'RUNNING'; v.show();
      AR.debug.placePlayer(0, { x: 1300 }); AR.debug.placePlayer(1, { x: 1500 });
      AR.debug.giveItem(0, 'gravity'); v.useItem(0);
      for (let i = 0; i < 360; i++) v.step(AR.FIXED_DT);
      v.cameras = [{}, {}]; v.hud();
    });
    assert.equal(await page.evaluate(() => v.players[0].rover.gravityFlipped), true);
    assert.equal(await page.evaluate(() => v.players[0].rover.crashed), '');
    await paint(page); await page.screenshot({ path: '/tmp/abyss-suggestions-gravity.png' });
    await page.evaluate(() => {
      AR.debug.placePlayer(0, { x: 1500, y: 130 });
      AR.debug.giveItem(0, 'jet'); v.useItem(0); v.keys.add('KeyD');
      for (let i = 0; i < 35; i++) v.step(AR.FIXED_DT);
      v.keys.clear(); v.cameras = [{}, {}]; v.hud();
    });
    assert(await page.evaluate(() => v.players[0].rover.vx > 20));
    await paint(page); await page.screenshot({ path: '/tmp/abyss-suggestions-jet.png' });
    await page.evaluate(() => {
      AR.debug.placePlayer(0, { x: 2820 }); AR.debug.placePlayer(1, { x: 3030 });
      v.hazards.step(v.players.map(p => p.rover), AR.FIXED_DT);
      const shark = v.hazards.sharks[0];
      shark.x = 3030; shark.y = v.terrain.height(shark.x) - 65; shark.phase = 'warning'; shark.timer = 1;
      v.cameras = [{}, {}]; v.hud();
    });
    await paint(page); await page.screenshot({ path: '/tmp/abyss-suggestions-shark.png' });
    for (const viewport of [{ width: 393, height: 428 }, { width: 393, height: 445 }, { width: 416, height: 720 }]) {
      await page.setViewport({ ...viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await page.goto(url);
      await page.click('#enter-garage'); await page.click('#start-run');
      const selection = await page.evaluate(() => {
        const hud = document.querySelector('#hud');
        return { style: getComputedStyle(hud).userSelect, blocked: !hud.dispatchEvent(new Event('selectstart', { cancelable: true, bubbles: true })) };
      });
      assert.equal(selection.style, 'none'); assert(selection.blocked);
      await page.keyboard.press('KeyP'); await page.click('#end-run');
      await page.goto(url);
      await page.evaluate(() => {
        const n = AR.debug.online, pair = AR.LoopbackTransport.pair();
        n.open(); n.attach('host', pair[0]); n.state = 'LOBBY'; n.protocolReady = true; n.peer(1).ready = true;
        n.v.config.mode = 'arena'; n.ui.render();
      });
      assert.equal(await page.$eval('#online-option-mode', n => n.value), 'arena');
      await page.evaluate(() => {
        window.v = AR.debug.online.v; const n = AR.debug.online;
        n.state = 'MATCH'; n.starting = true; v.startMatch(); n.starting = false;
        v.phase = 'RUNNING'; v.tick = () => {}; v.show(); n.ui.render();
        AR.debug.placePlayer(0, { x: 750 }); AR.debug.placePlayer(1, { x: 1120 }); v.hud();
      });
      const buttons = await page.$$eval('#online-pedals button', nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
      for (const b of buttons) { assert(b.width >= 44 && b.height >= 44); assert(b.x >= 0 && b.x + b.width <= viewport.width + 1); assert(b.y >= 0 && b.y + b.height <= viewport.height + 1); }
      await page.tap('#online-item');
      await page.evaluate(() => { v.step(AR.FIXED_DT); v.hud(); AR.debug.online.ui.status(); });
      assert.equal(await page.evaluate(() => v.players[0].itemsUsed), 1);
      assert.equal(await page.evaluate(() => v.projectiles[0].type), 'bubble');
      await page.tap('#online-burst');
      const jump = await page.evaluate(() => { v.step(AR.FIXED_DT); v.hud(); AR.debug.online.ui.status(); return { vy: v.players[0].rover.vy, cooldown: v.players[0].effects.jumpCooldown, oxygen: v.players[0].rover.oxygen, max: v.players[0].rover.maxOxygen }; });
      assert(jump.vy < -100 && jump.cooldown > 0); assert.equal(jump.oxygen, jump.max);
      await paint(page); await page.screenshot({ path: '/tmp/abyss-suggestions-phone-' + viewport.height + '.png' });
      await page.evaluate(() => AR.debug.online.close());
      await page.$eval('#title-suggestions', n => n.click());
      await page.type('#suggestions-text', 'Selection still works here');
      assert.equal(await page.$eval('#suggestions-text', n => getComputedStyle(n).userSelect), 'text');
      assert(await page.$eval('#suggestions-text', n => n.dispatchEvent(new Event('selectstart', { cancelable: true, bubbles: true }))));
      await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    console.log('PASS new terrain/item/arena screenshots, keyboard cannons, 3 short phone layouts, real touch jump/fire, gameplay selection prevention, editable suggestions, zero console errors or network requests');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
