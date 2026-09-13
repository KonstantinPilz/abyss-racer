'use strict';
const puppeteer = require('/home/ubuntu/projects/mcp-chromium-arm64/node_modules/puppeteer-core');
const exe = '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const out = __dirname + '/';
const delay = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'], timeout: 20000 });
  const page = await browser.newPage();
  const issues = [];
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  page.on('console', m => { if (['error','warning'].includes(m.type())) issues.push(m.type()+': '+m.text()); });
  for (const [w, h, tag] of [[1280, 720, 'hd'], [1920, 1080, 'fhd']]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto('http://127.0.0.1:8791/index.html?debug=1', { waitUntil: 'load' }); await delay(500);
    await page.click('#enter-versus'); await delay(400);
    await page.keyboard.press('KeyD'); await delay(100); // P1 picks next vehicle
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await delay(100); // P2 picks
    await page.screenshot({ path: out + 'vs-' + tag + '-setup.png' });
    await page.keyboard.press('KeyS'); await delay(150); await page.keyboard.press('ArrowDown'); await delay(500);
    let st = await page.evaluate(() => AR.inspect()); console.log(tag, 'after ready:', JSON.stringify(st).slice(0, 200));
    await delay(4500); // countdown
    await page.keyboard.down('KeyD'); await page.keyboard.down('ArrowRight');
    await delay(3000); await page.screenshot({ path: out + 'vs-' + tag + '-race3s.png' });
    // fps sample
    const fps = await page.evaluate(() => new Promise(res => { let n=0, t0=performance.now(); function f(){ n++; if (performance.now()-t0>2000) res(n/((performance.now()-t0)/1000)); else requestAnimationFrame(f);} requestAnimationFrame(f); }));
    await delay(3000);
    // give P2 an item and fire it at P1
    await page.evaluate(() => AR.debug.giveItem(1, 'net'));
    await page.keyboard.press('ArrowDown'); await delay(600);
    await page.screenshot({ path: out + 'vs-' + tag + '-jelly.png' });
    await page.evaluate(() => AR.debug.giveItem(0, 'riptide')); await page.keyboard.press('KeyS'); await delay(700);
    await page.screenshot({ path: out + 'vs-' + tag + '-riptide.png' });
    await delay(3000);
    st = await page.evaluate(() => AR.inspect());
    console.log(tag, 'fps~' + fps.toFixed(1), 'players:', JSON.stringify(st.players ? st.players.map(p => ({ x: Math.round(p.x), d: Math.round(p.distance), o2: Math.round(p.oxygen), crashes: p.crashes, item: p.item })) : st).slice(0, 300));
    await page.keyboard.up('KeyD'); await page.keyboard.up('ArrowRight');
    await page.keyboard.press('Escape'); await delay(300); await page.screenshot({ path: out + 'vs-' + tag + '-pause.png' });
    await page.keyboard.press('Escape'); await delay(300);
  }
  console.log('issues:', issues.length ? issues : 'none');
  await browser.close();
})().catch(e => { console.error('QC FAILED', e); process.exit(1); });
