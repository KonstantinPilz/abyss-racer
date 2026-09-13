'use strict';
const puppeteer = require('/home/ubuntu/projects/mcp-chromium-arm64/node_modules/puppeteer-core');
const exe = '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const delay = ms => new Promise(r => setTimeout(r, ms));
const STAGES = ['reef','kelp','wreck','volcanic','ice','abyss'], VEH = ['rover','crab','bike','truck','manta'];
(async () => {
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'], timeout: 20000 });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const results = [];
  for (const [s, v, up] of [['volcanic','crab',0],['volcanic','truck',0],['volcanic','rover',6],['reef','rover',0],['reef','rover',6]]) {
    await page.goto('http://127.0.0.1:8791/index.html', { waitUntil: 'load' });
    await page.evaluate((s, v, ST, VE, up) => { const u = {}; for (const k of ['engine','propeller','suspension','tires','oxygen','ballast']) u[k] = up; localStorage.setItem('abyss-racer-save', JSON.stringify({ version: 2, pearls: 200000, stages: ST, vehicles: VE, selectedStage: s, selectedVehicle: v, upgrades: { [v]: u } })); }, s, v, STAGES, VEH, up);
    await page.goto('http://127.0.0.1:8791/index.html', { waitUntil: 'load' }); await delay(400);
    await page.click('#enter-garage'); await delay(200); await page.click('#start-run'); await delay(300);
    const t0 = Date.now(); let st;
    while (Date.now() - t0 < 40000) {
      await page.keyboard.down('ArrowRight'); await delay(900); await page.keyboard.up('ArrowRight'); await delay(300);
      st = await page.evaluate(() => AR.inspect()); if (st.state !== 'RUNNING') break;
    }
    results.push({ stage: s, vehicle: v, upgrades: up, distance: Math.round(st.distance), state: st.state, secs: Math.round((Date.now()-t0)/1000) });
  }
  console.table(results);
  await browser.close();
})().catch(e => { console.error('QC FAILED', e); process.exit(1); });
