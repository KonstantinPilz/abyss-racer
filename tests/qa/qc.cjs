'use strict';
const puppeteer = require('/home/ubuntu/projects/mcp-chromium-arm64/node_modules/puppeteer-core');
const exe = '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const out = '/tmp/claude-1001/-home-ubuntu/01404a13-b171-4183-8644-9ad697ee2e4d/scratchpad/qc/';
const delay = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'], timeout: 20000 });
  const page = await browser.newPage();
  const issues = [];
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  page.on('console', m => { if (['error','warning'].includes(m.type())) issues.push(m.type()+': '+m.text()); });
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:8791/index.html', { waitUntil: 'load' });
  await delay(800);
  await page.screenshot({ path: out + '01-title.png' });
  await page.click('#enter-garage'); await delay(400);
  await page.screenshot({ path: out + '02-garage.png' });
  await page.click('#tab-upgrades'); await delay(300);
  await page.screenshot({ path: out + '03-upgrades.png' });
  await page.click('#tab-stages'); await delay(300);
  await page.screenshot({ path: out + '04-stages.png' });
  await page.click('#tab-achievements'); await delay(300);
  await page.screenshot({ path: out + '05-achievements.png' });
  await page.click('#tab-vehicles'); await delay(200);
  await page.click('#start-run'); await delay(500);
  await page.screenshot({ path: out + '06-run-start.png' });
  // drive, with a few frame-time samples
  await page.keyboard.down('ArrowRight');
  await delay(4000);
  await page.screenshot({ path: out + '07-run-4s.png' });
  const fps = await page.evaluate(() => new Promise(res => { let n=0, t0=performance.now(); function f(){ n++; if (performance.now()-t0>2000) res(n/((performance.now()-t0)/1000)); else requestAnimationFrame(f);} requestAnimationFrame(f); }));
  await delay(4000);
  await page.screenshot({ path: out + '08-run-10s.png' });
  await page.keyboard.up('ArrowRight');
  let s = await page.evaluate(() => AR.inspect());
  console.log('after 10s:', JSON.stringify(s), 'fps~', fps.toFixed(1));
  // pause screen
  await page.keyboard.press('p'); await delay(300);
  await page.screenshot({ path: out + '09-pause.png' });
  await page.keyboard.press('p'); await delay(200);
  // drive until game over or 60s
  await page.keyboard.down('ArrowRight');
  for (let i=0;i<30;i++){ await delay(2000); s = await page.evaluate(()=>AR.inspect()); if (s.state!=='RUNNING') break; }
  await page.keyboard.up('ArrowRight');
  console.log('end state:', JSON.stringify(s));
  await delay(600);
  await page.screenshot({ path: out + '10-gameover.png' });
  // Mobile viewport
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto('http://127.0.0.1:8791/index.html', { waitUntil: 'load' }); await delay(800);
  await page.screenshot({ path: out + '11-mobile-title.png' });
  await page.click('#enter-garage'); await delay(400);
  await page.screenshot({ path: out + '12-mobile-garage.png' });
  await page.click('#start-run'); await delay(2500);
  await page.screenshot({ path: out + '13-mobile-run.png' });
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await delay(800);
  await page.screenshot({ path: out + '14-mobile-landscape-run.png' });
  console.log('issues:', issues.length ? issues : 'none');
  await browser.close();
})().catch(e => { console.error('QC FAILED', e); process.exit(1); });
