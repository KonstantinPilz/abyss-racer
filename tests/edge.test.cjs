'use strict';
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('/home/ubuntu/projects/mcp-chromium-arm64/node_modules/puppeteer-core');
const executablePath = process.env.ABYSS_CHROME || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log('PASS ' + message); };
let browser;
(async () => {
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'], timeout: 15000 });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error','warn'].includes(message.type())) errors.push(message.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('file://' + path.resolve(__dirname,'../docs/index.html'));
  await page.evaluate(() => {
    // Capture future instances in test code, keeping production inspection read-only.
    const Base = AR.Rover;
    AR.Rover = class extends Base { constructor(...args) { super(...args); window.testRover = this; } };
    const audioUpdate = AR.Audio.prototype.update;
    AR.Audio.prototype.update = function(state, dt) { window.testAudio = this; window.testAudioRunning = state.running; return audioUpdate.call(this, state, dt); };
  });
  await page.click('#enter-garage'); await page.click('#start-run');
  await delay(200);
  // Headless shell keeps every page visible; drive the actual visibility handler
  // with a controlled document.hidden value instead of claiming a real tab switch.
  await page.evaluate(() => {
    window.testHidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.testHidden });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await page.evaluate(() => ({ hidden: document.hidden, state: AR.inspect().state, oxygen: AR.inspect().oxygen }));
  assert(hidden.hidden && hidden.state === 'PAUSED', 'Visibility handler pauses the run on a hidden event');
  await delay(200);
  assert(await page.evaluate(() => AR.inspect().oxygen) === hidden.oxygen, 'No oxygen drain while marked hidden');
  await page.evaluate(() => { window.testHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await page.click('#resume-run'); await delay(100);
  assert(await page.evaluate(() => AR.inspect().state) === 'RUNNING', 'Visibility handler resumes from a fresh timing baseline');
  const before = await page.evaluate(() => AR.inspect().oxygen);
  await page.evaluate(() => {
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => original(timestamp => callback(timestamp + 600000));
  });
  await delay(100);
  const after = await page.evaluate(() => AR.inspect().oxygen);
  assert(before - after < .3, 'A ten-minute timestamp jump is capped to a small simulation step');
  await page.evaluate(() => {
    const rover = window.testRover;
    const step = rover.step;
    window.restoreStep = step;
    // Drive deterministic synthetic airborne rotation through real game scoring.
    rover.step = function() {
      this.savePrevious(); this.angle -= Math.PI / 8;
      this.grounded = false; this.bodyGrounded = false;
      this.impact = 0; this.burstFired = false;
    };
  });
  await delay(500);
  assert(await page.evaluate(() => AR.inspect().flips) >= 1, 'Completed airborne rotations award flip bonuses');
  await page.evaluate(() => { window.testRover.step = function() { this.savePrevious(); this.grounded = false; this.bodyGrounded = true; this.impact = 0; }; });
  await delay(100);
  const airBefore = await page.evaluate(() => AR.inspect().airtime);
  await delay(250);
  assert(await page.evaluate(() => AR.inspect().airtime) === airBefore, 'Resting on the dome cannot farm airtime');
  await page.evaluate(() => { window.testRover.step = window.restoreStep; window.testRover.oxygen = 0.001; window.testRover.crashed = ''; });
  await delay(250);
  assert(await page.evaluate(() => AR.inspect().state) === 'GAMEOVER', 'Natural oxygen depletion triggers game over');
  assert(await page.evaluate(() => window.testAudioRunning) === false, 'Fatal fixed step leaves game-over engine silenced');
  assert(await page.evaluate(() => new AR.Save().data.totals.flips) >= 1, 'Trick statistics persist on completion');
  await page.click('#retry');
  await page.evaluate(() => {
    const r = window.testRover;
    r.sleeping = false; r.sleepTime = 0; r.x = 100; r.y = 327; r.angle = Math.PI; r.vy = 400; r.vx = 0; r.omega = 0; r.crashed = '';
    r.wheels.forEach(w => { w.x = r.x - w.side * r.stats.wheelbase / 2; w.y = r.y - r.stats.restLength - 8; w.vy = 400; w.vx = 0; });
  });
  await delay(300);
  assert(await page.evaluate(() => AR.inspect().state) === 'GAMEOVER', 'A real upside-down dome impact ends the run');
  assert(await page.$eval('#result-reason', n => n.textContent) === 'HULL CRUSHED', 'Hull-crushed reason reaches summary');
  await page.click('#back-garage');
  await page.click('#mute-button');
  await page.reload();
  assert(await page.$eval('#mute-button', n => n.getAttribute('aria-pressed')) === 'true', 'Mute preference survives reload');
  assert(errors.length === 0, 'Edge cases produce no application console errors/warnings: ' + errors.join('; '));
  fs.writeFileSync(path.join(__dirname,'edge.done'), 'PASS controlled browser visibility hidden/resume, capped timestamp gap, flip awards, no grounded airtime farming, natural oxygen and hull deaths, game-over audio silence, mute persistence; zero app console errors/warnings.\n');
  await browser.close();
})().catch(async error => { console.error(error); if (browser) await browser.close(); process.exit(1); });
