'use strict';
const puppeteer = require('/home/ubuntu/projects/mcp-chromium-arm64/node_modules/puppeteer-core');
const exe = '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const out = __dirname + '/';
const delay = ms => new Promise(r => setTimeout(r, ms));
const P = () => 0;
(async () => {
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'], timeout: 20000 });
  const page = await browser.newPage();
  const issues = [];
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  page.on('console', m => { if (['error','warning'].includes(m.type())) issues.push(m.type()+': '+m.text()); });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:8791/index.html?debug=1', { waitUntil: 'load' }); await delay(500);
  // solo canvas size
  console.log('solo canvas:', await page.evaluate(() => { const c = document.querySelector('canvas'); return [c.width, c.height, c.clientWidth, c.clientHeight, devicePixelRatio]; }));
  await page.click('#enter-versus'); await delay(400);
  await page.keyboard.press('KeyS'); await delay(150); await page.keyboard.press('ArrowDown'); await page.evaluate(() => AR.debug.advance(4.5)); await delay(200);
  console.log('versus canvas:', await page.evaluate(() => Array.from(document.querySelectorAll('canvas')).map(c => [c.width, c.height, c.clientWidth, c.clientHeight])));
  const ins = () => page.evaluate(() => { const s = AR.inspect(); return { phase: s.phase || s.state, p: s.players.map(p => ({ x: Math.round(p.x), vx: Math.round(p.vx), o2: Math.round(p.oxygen), crashed: p.crashed, crashes: p.crashes, blackouts: p.blackouts, lives: p.lives, item: p.item, ghost: p.ghosting })) }; });
  await page.keyboard.down('KeyD'); await page.keyboard.down('ArrowRight'); await page.evaluate(() => AR.debug.advance(4)); await delay(200);
  await page.screenshot({ path: out + 'fix2-race-1x.png' });
  console.log('race 4s:', JSON.stringify(await ins()));
  // overtaking: place P2 15px behind P1, faster
  await page.evaluate(() => { const s = AR.inspect(); const x = s.players[0].x; AR.debug.placePlayer(0, { x: x, vx: 200 }); AR.debug.placePlayer(1, { x: x - 15, vx: 380 }); });
  await page.evaluate(() => AR.debug.advance(2)); await delay(100); let s = await ins(); console.log('overtake after 2s: gap P2-P1 =', s.p[1].x - s.p[0].x, JSON.stringify(s.p));
  // torpedo kill: P2 gets torpedo, P1 ahead
  await page.evaluate(() => { const s = AR.inspect(); const x = Math.max(s.players[0].x, s.players[1].x); AR.debug.placePlayer(0, { x: x + 200, vx: 150 }); AR.debug.placePlayer(1, { x: x, vx: 150 }); AR.debug.giveItem(1, 'torpedo'); });
  await page.keyboard.press('ArrowDown');
  let hit = null; for (let i = 0; i < 30; i++) { await page.evaluate(() => AR.debug.advance(0.25)); s = await ins(); if (s.p[0].crashed) { hit = s.p[0].crashed; break; } }
  console.log('torpedo result: P1 crashed =', hit, 'crashes', s.p[0].crashes);
  await delay(600); await page.screenshot({ path: out + 'fix2-torpedo-1x.png' });
  await page.evaluate(() => AR.debug.advance(3)); s = await ins(); console.log('after respawn:', JSON.stringify(s.p[0]));
  // oxygen blackout
  await page.evaluate(() => AR.debug.setOxygen(1, 0)); await delay(500); s = await ins(); console.log('o2=0 P2:', JSON.stringify(s.p[1]));
  await page.screenshot({ path: out + 'fix2-blackout-1x.png' });
  await page.evaluate(() => AR.debug.advance(4.6)); s = await ins(); console.log('after blackout respawn P2:', JSON.stringify(s.p[1]));
  await page.keyboard.up('KeyD'); await page.keyboard.up('ArrowRight');
  console.log('issues:', issues.length ? issues : 'none');
  await browser.close();
})().catch(e => { console.error('QC FAILED', e); process.exit(1); });
