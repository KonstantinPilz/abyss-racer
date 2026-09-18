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
    for (const viewport of [
      { width: 1280, height: 720, deviceScaleFactor: 1 },
      { width: 393, height: 428, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    ]) {
      await page.setViewport(viewport); await page.goto(url);
      await page.click('#enter-garage'); await page.click('#start-run');
      // Hold each pose for visual review while using the real generator and renderer.
      await page.evaluate(() => { AR.debug.solo.scene().rover.step = () => {}; });
      for (const [x, expectedId, label] of [[5400, null, 'quiet-stretch'], [8000, 2, 'next-warning']]) {
        const sharks = await page.evaluate(x => {
          AR.debug.solo.place(x);
          const scene = AR.debug.solo.scene();
          scene.hazards = new AR.WorldHazards(scene.terrain);
          scene.hazards.step([scene.rover], AR.FIXED_DT);
          scene.sharks = scene.hazards.sharks;
          scene.hazards.step = () => {};
          AR.debug.solo.advance(4);
          return scene.sharks.map(q => ({ id: q.id, phase: q.phase }));
        }, x);
        assert.deepEqual(sharks, expectedId === null ? [] : [{ id: expectedId, phase: 'warning' }]);
        await page.waitForFunction(() => document.querySelector('#toast-stack').children.length === 0);
        await paint(page);
        await page.screenshot({ path: '/tmp/abyss-shark-frequency-' + viewport.width + 'x' + viewport.height + '-' + label + '.png' });
        assert.equal(await page.evaluate(() => AR.inspect().state), 'RUNNING');
        assert(await page.$eval('meta[name="robots"]', n => n.content.includes('noindex')));
      }
    }
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    console.log('PASS Reduced shark cadence in solo rendering at desktop and 393×428; zero console errors or external requests');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
