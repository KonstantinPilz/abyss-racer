'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('/home/ubuntu/projects/mcp-chromium-arm64/node_modules/puppeteer-core');
const executablePath = process.env.ABYSS_CHROME || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const pass = message => console.log('PASS ' + message);
const url = 'file://' + path.resolve(__dirname, '../docs/index.html');
let browser;

(async () => {
  browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'], timeout: 15000 });
  const page = await browser.newPage();
  const issues = [], external = [], screenshots = [];
  page.on('pageerror', error => issues.push(error.message));
  page.on('console', message => { if (['error', 'warn'].includes(message.type())) issues.push(message.type() + ': ' + message.text()); });
  page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const inspect = () => page.evaluate(() => AR.inspect());
  const advance = seconds => page.evaluate(seconds => AR.debug.advance(seconds), seconds);
  const screenshot = async name => {
    const filename = '/tmp/abyss-versus-' + name + '.png';
    await page.screenshot({ path: filename });
    screenshots.push(filename);
  };
  const place = (index, values) => page.evaluate(({ index, values }) => AR.debug.placePlayer(index, values), { index, values });
  const give = async (index, id) => {
    assert.equal(await page.evaluate(({ index, id }) => AR.debug.giveItem(index, id), { index, id }), true);
    assert.equal((await inspect()).players[index].item, id === 'magnet' && (await inspect()).versus.mode !== 'pearl' ? 'turbo' : id);
    await page.keyboard.press(index ? 'ArrowDown' : 'KeyS');
  };
  const resetPositions = async (first = 100, second = 700) => {
    await page.evaluate(({ first, second }) => {
      const players = AR.inspect().players;
      AR.debug.placePlayer(0, { x: first, oxygen: players[0].maxOxygen });
      AR.debug.placePlayer(1, { x: second, oxygen: players[1].maxOxygen });
    }, { first, second });
  };
  const untilEffect = async (index, effect, seconds = 2) => page.evaluate(({ index, effect, seconds }) => {
    let state = AR.inspect();
    for (let tick = 0; tick < seconds / AR.FIXED_DT && !(state.players[index].effects[effect] > 0); tick++) state = AR.debug.advance(AR.FIXED_DT);
    return state;
  }, { index, effect, seconds });
  const configure = async ({ mode = 'race', target = '500', rounds = '1' } = {}) => {
    assert.equal((await inspect()).state, 'VERSUS_SETUP');
    await page.select('#versus-mode', mode);
    if (mode === 'race') await page.select('#versus-target', target);
    await page.select('#versus-rounds', rounds);
    await page.click('#versus-ready-0');
    await page.keyboard.press('ArrowDown');
    assert.equal((await inspect()).state, 'VERSUS_COUNTDOWN');
    await advance(4.05);
    assert.equal((await inspect()).state, 'VERSUS_RUNNING');
  };
  const finishRace = async winner => {
    await page.evaluate(winner => {
      const s = AR.inspect();
      AR.debug.placePlayer(winner, { x: s.players[winner].startX + s.versus.target * 10 + 2, oxygen: s.players[winner].maxOxygen });
      AR.debug.advance(AR.FIXED_DT * 2);
    }, winner);
    assert.equal((await inspect()).state, 'VERSUS_ROUND_RESULT');
  };
  const changeSetup = async () => {
    if ((await inspect()).state === 'VERSUS_MATCH_RESULT') await page.click('#versus-change');
    else { await page.keyboard.press('Escape'); await page.click('#versus-abandon'); }
    assert.equal((await inspect()).state, 'VERSUS_SETUP');
  };
  const projectileDefenses = async () => {
    await resetPositions(100, 900);
    await advance(5);
    await resetPositions(100, 900);
    const dodgeBefore = await inspect();
    await give(0, 'torpedo');
    await advance(.08);
    await page.keyboard.press('ArrowUp');
    const dodged = await untilEffect(1, 'dodged', 1.2);
    assert.ok(dodged.players[1].effects.dodged > 0, 'timed ArrowUp ballast jump clears the passing torpedo: ' + JSON.stringify({ player: dodged.players[1], projectiles: dodged.versus.projectiles, totals: dodged.versus.totals }));
    assert.equal(dodged.versus.totals[1].torpedoesDodged, dodgeBefore.versus.totals[1].torpedoesDodged + 1);
    assert.equal(dodged.versus.totals[0].itemsLanded, dodgeBefore.versus.totals[0].itemsLanded);
    assert.ok(!dodged.players[1].effects.torpedo && !dodged.players[1].respawn);
    assert.ok(dodged.players[1].oxygen < dodgeBefore.players[1].oxygen - 7, 'dodge spends real ballast oxygen');
    await resetPositions(900, 100);
    await give(1, 'shield');
    const landedBefore = (await inspect()).versus.totals[0].itemsLanded;
    await give(0, 'torpedo');
    assert.ok((await inspect()).versus.projectiles.some(q => q.type === 'torpedo' && q.direction === -1), 'torpedo automatically launches backward toward the opponent');
    const blocked = await untilEffect(1, 'blocked', 2);
    assert.ok(blocked.players[1].effects.blocked > 0, 'shield blocks a real projectile contact');
    assert.equal(blocked.players[1].effects.shield, 0);
    assert.ok(!blocked.players[1].effects.torpedo);
    assert.equal(blocked.versus.totals[0].itemsLanded, landedBefore);
    pass('actual ballast torpedo dodge/counter and shield consuming a backward torpedo without damage');
  };
  const compactStatusScreenshot = async () => {
    await page.setViewport({ width: 1024, height: 640, deviceScaleFactor: 1 });
    await resetPositions(1200, 100);
    for (const item of ['ink', 'net', 'riptide', 'siphon']) await give(0, item);
    await give(1, 'turbo'); await give(1, 'shield');
    await advance(.08);
    await screenshot('compact-status');
    const layout = await page.evaluate(() => {
      const status = document.getElementById('v-status-1').getBoundingClientRect();
      const toast = document.getElementById('v-toast-1').getBoundingClientRect();
      const columns = Array.from(document.querySelector('#v-hud-1 .v-hud-row').children).map(node => node.getBoundingClientRect());
      return { statusBottom: status.bottom, toastTop: toast.top, overlap: columns.slice(1).some((rect, index) => rect.left < columns[index].right - 1), width: document.documentElement.scrollWidth };
    });
    assert.equal(layout.overlap, false, '1024px compact HUD columns do not overlap');
    assert.ok(layout.statusBottom <= layout.toastTop, 'stacked status feedback clears the toast at1024×640: ' + JSON.stringify(layout));
    assert.equal(layout.width, 1024);
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    pass('1024×640 screenshot with stacked ink/net/riptide/siphon/turbo/shield/catch-up status has no text overlap or clipping');
  };

  // A focused iteration path exercises new projectile/layout regressions without
  // repeating the full20 s driving benchmark. The default invocation runs all checks.
  if (process.argv.includes('--focus-items')) {
    await page.goto(url + '?debug=1', { waitUntil: 'load' });
    await page.click('#enter-versus');
    await configure({ target: '2000' });
    await projectileDefenses();
    await compactStatusScreenshot();
    assert.deepEqual(issues, []); assert.deepEqual(external, []);
    await browser.close(); browser = null;
    return;
  }

  await page.goto(url, { waitUntil: 'load' });
  assert.equal(await page.evaluate(() => typeof AR.debug), 'undefined', 'debug mutation hooks require ?debug=1');
  const soloBefore = await page.evaluate(() => {
    const save = new AR.Save();
    Object.assign(save.data, { pearls: 321, totalRuns: 7, totalDistance: 1850 });
    save.data.upgrades.rover.engine = 11;
    save.save();
    const solo = JSON.parse(JSON.stringify(save.data)); delete solo.versus; return solo;
  });
  await page.goto(url + '?debug=1', { waitUntil: 'load' });
  assert.equal(await page.evaluate(() => typeof AR.debug.giveItem), 'function');
  assert.equal(await page.evaluate(() => typeof AR.debug.setOxygen), 'function');
  assert.equal(await page.evaluate(() => typeof AR.debug.fireTorpedo), 'function');
  await page.click('#enter-versus');
  assert.equal((await inspect()).state, 'VERSUS_SETUP');
  assert.equal(await page.$$eval('#versus-stage option', options => options.length), 6);
  assert.equal(await page.$$eval('#versus-rounds option', options => options.map(option => option.value).join('/')), '1/3/5');
  assert.equal(await page.$$eval('#versus-target option', options => options.map(option => option.value).join('/')), '500/1000/2000');
  const p1Vehicles = [], p2Vehicles = [];
  for (let i = 0; i < 5; i++) {
    p1Vehicles.push(await page.$eval('#versus-name-0', node => node.textContent));
    p2Vehicles.push(await page.$eval('#versus-name-1', node => node.textContent));
    await page.keyboard.press('KeyD'); await page.keyboard.press('ArrowRight');
  }
  assert.equal(new Set(p1Vehicles).size, 5);
  assert.deepEqual(p1Vehicles, p2Vehicles);
  await page.select('#versus-target', '2000');
  await page.select('#versus-rounds', '1');
  await page.click('#versus-name-0');
  await screenshot('setup');
  await page.keyboard.press('KeyS');
  assert.match(await page.$eval('#versus-ready-0', node => node.textContent), /READY TO DIVE/);
  await page.keyboard.press('ArrowDown');
  assert.equal((await inspect()).state, 'VERSUS_COUNTDOWN');
  const frozen = await inspect();
  await page.keyboard.down('KeyD'); await page.keyboard.down('ArrowRight');
  await advance(2);
  const halfway = await inspect();
  assert.deepEqual(halfway.players.map(p => [p.x, p.y, p.oxygen]), frozen.players.map(p => [p.x, p.y, p.oxygen]));
  await page.keyboard.up('KeyD'); await page.keyboard.up('ArrowRight');
  await page.waitForFunction(() => AR.inspect().state === 'VERSUS_RUNNING', { timeout: 5000 });
  const tournament = await page.evaluate(() => {
    const levels = Object.fromEntries(AR.UPGRADES.map(upgrade => [upgrade.id, 5]));
    const stats = AR.getStats('rover', levels);
    return { actual: AR.inspect().players.map(p => [p.torque, p.topSpeed / (p.slipstream ? 1.1 : 1), p.maxOxygen]), expected: [stats.torque, stats.topSpeed, stats.oxygen] };
  });
  assert.deepEqual(tournament.actual[0], tournament.actual[1]);
  assert.equal(tournament.actual[0][0], tournament.expected[0]);
  assert.equal(tournament.actual[0][1], tournament.expected[1]);
  pass('keyboard vehicle selection, all five tournament vehicles/six stages, setup options, and frozen 3-2-1-GO countdown');

  // Only real browser frames run during this driving and FPS measurement section.
  const start = await inspect();
  await page.keyboard.down('KeyD'); await page.keyboard.down('ArrowRight');
  const measured = await page.evaluate(() => new Promise(resolve => {
    let first = null, frames = 0;
    function sample(now) {
      if (first === null) first = now;
      else frames++;
      if (now - first >= 5000) resolve({ fps: frames * 1000 / (now - first), frames, milliseconds: now - first });
      else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }));
  await delay(15000);
  await page.keyboard.up('KeyD'); await page.keyboard.up('ArrowRight');
  const driven = await inspect();
  assert.equal(driven.state, 'VERSUS_RUNNING');
  driven.players.forEach((p, i) => assert.ok(p.distance > start.players[i].distance + 30, 'P' + (i + 1) + ' progresses with simultaneous keyboard controls'));
  await screenshot('mid-race');
  pass('20 s simultaneous real-frame driving: ' + driven.players.map(p => p.distance.toFixed(1) + ' m').join(' / ') + '; measured ' + measured.fps.toFixed(1) + ' rAF fps over 5 s');
  const overlaps = await page.evaluate(() => [0, 1].flatMap(i => {
    const nodes = Array.from(document.querySelector('#v-hud-' + i + ' .v-hud-row').children);
    return nodes.slice(1).filter((node, index) => node.getBoundingClientRect().left < nodes[index].getBoundingClientRect().right - 1).map(node => node.className);
  }));
  assert.deepEqual(overlaps, [], 'compact HUD columns do not overlap');
  assert.equal(await page.evaluate(() => scrollY), 0, 'arrow keys never scroll the page');
  const prevented = await page.evaluate(() => ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].every(code => {
    const e = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    document.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    return e.defaultPrevented;
  }));
  assert.equal(prevented, true);
  await page.keyboard.press('KeyP');
  const paused = await inspect();
  await delay(180);
  assert.equal((await inspect()).state, 'VERSUS_PAUSED');
  assert.deepEqual((await inspect()).players.map(p => p.oxygen), paused.players.map(p => p.oxygen));
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.testHidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.testHidden });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal((await inspect()).state, 'VERSUS_PAUSED');
  await page.evaluate(() => { window.testHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await page.click('#versus-resume');
  assert.equal((await inspect()).state, 'VERSUS_RUNNING');
  pass('HUD layout, event.code controls/default prevention, shared pause, frozen oxygen, and visibility pause/resume');

  const collisionBefore = (await inspect()).versus.contacts;
  await page.evaluate(() => {
    AR.debug.placePlayer(0, { x: 100, vx: 200 });
    AR.debug.placePlayer(1, { x: 85, vx: 380 });
  });
  const passed = await advance(2);
  assert.equal(passed.versus.contacts, collisionBefore, 'ground overtake generates no rover contacts');
  assert.ok(passed.players[1].x > passed.players[0].x + 60, '380 px/s trailer passes the 200 px/s leader');
  assert.ok(passed.players.every(p => !p.crashed && !p.respawn));
  await page.evaluate(() => {
    AR.debug.placePlayer(1, { x: 700 });
    AR.debug.placePlayer(0, { x: 715, y: AR.inspect().players[1].y - 60, vy: 220 });
  });
  const landed = await advance(.05);
  assert.ok(landed.versus.contacts > collisionBefore, 'a rover 60 px above resolves landing contact');
  pass('grounded overtaking clears 60 px within 2 s; above-rover landing still resolves physical contact');

  await resetPositions();
  // The default-prevention probe fired ArrowUp earlier; let its real cooldown expire.
  await advance(5);
  await resetPositions();
  const oxygenBeforeBurst = (await inspect()).players.map(p => p.oxygen);
  await page.keyboard.down('KeyW'); await page.keyboard.down('ArrowUp');
  await advance(.05);
  await page.keyboard.up('KeyW'); await page.keyboard.up('ArrowUp');
  assert.ok((await inspect()).players.every((p, i) => p.oxygen < oxygenBeforeBurst[i] - 7));
  for (const id of ['ink', 'net', 'riptide']) {
    await resetPositions();
    const original = await inspect();
    await give(0, id);
    let hit = await advance(.04);
    assert.ok(hit.players[1].effects[id] > 0 && hit.players[1].effects.hit > 0, id + ' visibly affects the opponent');
    assert.equal(hit.players[0].item, null);
    assert.ok(hit.players[0].itemsUsed > original.players[0].itemsUsed);
    assert.ok(hit.versus.totals[0].itemsLanded > original.versus.totals[0].itemsLanded);
    const toasts = await page.$$eval('.v-toast', nodes => nodes.map(node => node.textContent));
    assert.equal(toasts[0], toasts[1]); assert.match(toasts[0], /P1 hit P2/);
    if (id === 'ink') { await advance(.5); await screenshot('ink'); }
    if (id === 'net') assert.ok(hit.players[1].torque <= original.players[1].torque * .36);
    if (id === 'riptide') {
      await page.keyboard.down('ArrowRight');
      hit = await advance(.3);
      await page.keyboard.up('ArrowRight');
      assert.ok(hit.players[1].vx < 0, 'riptide makes the actual throttle key drive in reverse');
      assert.match(await page.$eval('#v-status-1', node => node.textContent), /controls reversed/);
    }
  }
  await resetPositions();
  await place(0, { x: 100, oxygen: 50 }); await place(1, { x: 700, oxygen: 20 });
  await give(0, 'siphon');
  const siphoned = await inspect();
  assert.equal(siphoned.players[1].oxygen, 0);
  assert.ok(siphoned.players[0].oxygen > 69 && siphoned.players[0].oxygen <= 70);
  assert.ok(siphoned.players[0].effects.siphonGain > 0);
  assert.ok(siphoned.players[1].effects.siphon > 0 || siphoned.players[1].respawnKind === 'blackout', 'a lethal siphon proceeds to out-of-air respawn');
  await resetPositions();
  const baseSpeed = (await advance(.02)).players[0].topSpeed;
  await give(0, 'turbo');
  const turbo = await advance(.02);
  assert.ok(turbo.players[0].effects.turbo > 0);
  assert.ok(turbo.players[0].topSpeed >= baseSpeed * 1.39);
  await resetPositions();
  await give(0, 'magnet');
  assert.ok((await inspect()).players[0].effects.turbo > 0, 'magnet is replaced by turbo outside Pearl Rush');
  await resetPositions();
  await give(1, 'shield');
  assert.ok((await inspect()).players[1].effects.shield > 0);
  const beforeBlocked = (await inspect()).versus.totals[0].itemsLanded;
  await give(0, 'ink');
  const blocked = await inspect();
  assert.equal(blocked.players[1].effects.shield, 0);
  assert.ok(blocked.players[1].effects.blocked > 0);
  assert.ok(!(blocked.players[1].effects.ink > 0));
  assert.equal(blocked.versus.totals[0].itemsLanded, beforeBlocked);
  pass('both ballast keys, item consumption/toasts, ink/net/riptide gameplay effects, capped siphon, turbo tune, non-Pearl magnet replacement, and one-hit shield');

  await resetPositions(100, 900);
  await give(0, 'torpedo');
  await advance(.2);
  let flight = await inspect();
  assert.ok(flight.versus.projectiles.some(q => q.type === 'torpedo' && q.x > 165 && q.life > 0));
  await screenshot('torpedo');
  const hit = await untilEffect(1, 'torpedo', 2);
  assert.ok(hit.players[1].effects.torpedo > 0, 'torpedo reaches the opponent through production swept hit detection');
  assert.equal(hit.players[1].crashed, 'Torpedoed!');
  assert.ok(hit.players[1].respawn > 2 && hit.players[1].respawn <= 2.5);
  assert.ok(hit.versus.explosions.length > 0 && hit.versus.shake > 0 && hit.versus.flash > 0);
  const torpedoRespawn = await advance(2.5);
  assert.equal(torpedoRespawn.players[1].respawn, 0); assert.equal(torpedoRespawn.players[1].crashed, '');
  await resetPositions(400, 0);
  await give(0, 'anchor');
  const firstAnchor = (await inspect()).versus.projectiles.find(q => q.type === 'anchor');
  assert.ok(firstAnchor && firstAnchor.life > 14);
  assert.equal((await inspect()).players[0].charges, 1);
  assert.equal((await inspect()).players[0].item, 'anchor');
  await place(0, { x: 100 });
  await place(1, { x: firstAnchor.x + 55, vx: -200 });
  const anchored = await untilEffect(1, 'anchor', 1);
  assert.ok(anchored.players[1].effects.anchor > 0);
  assert.ok(anchored.players[1].vx > 0 && anchored.players[1].vy < 0, 'anchor reverses the incoming velocity and bounces its victim');
  await page.keyboard.press('KeyS');
  assert.equal((await inspect()).players[0].item, null);
  assert.ok((await inspect()).versus.projectiles.some(q => q.type === 'anchor'));
  pass('torpedo flight, lethal hit, shared explosion, 2.5 s respawn, and two-charge terrain anchor stop/bounce');
  await projectileDefenses();
  await compactStatusScreenshot();

  await resetPositions(100, 700);
  const beforeCrash = await inspect();
  assert.equal(await page.evaluate(() => AR.debug.crashPlayer(0)), true);
  await advance(.03);
  assert.match(await page.$eval('#v-respawn-0', node => node.textContent), /RESPAWN/);
  const respawnStarted = Date.now();
  await page.waitForFunction(() => AR.inspect().players[0].respawn === 0, { timeout: 3000 });
  const respawned = await inspect();
  assert.ok(Date.now() - respawnStarted < 3000);
  assert.equal(respawned.players[0].crashes, beforeCrash.players[0].crashes + 1);
  assert.ok(Math.abs(respawned.players[0].x - beforeCrash.players[0].x) < 8);
  assert.ok(Math.abs(respawned.players[0].angle) < .3);
  assert.ok(respawned.players[0].oxygen <= beforeCrash.players[0].oxygen - beforeCrash.players[0].maxOxygen * .15 + .1);
  assert.ok(respawned.players[0].effects.spawnShield > 1.2);
  await give(1, 'net');
  assert.ok((await inspect()).players[0].effects.blocked > 0);
  assert.ok(!(await inspect()).players[0].effects.net);
  pass('real-time crash countdown respawns within 3 s upright at crash position, subtracts 15% oxygen, and blocks spawn-camping');

  await resetPositions(100, 700);
  const oxygenStart = await inspect();
  assert.equal(await page.evaluate(() => AR.debug.setOxygen(0, 0)), true);
  await advance(.04);
  const blackout = await inspect();
  assert.equal(blackout.players[0].blackouts, oxygenStart.players[0].blackouts + 1);
  assert.equal(blackout.players[0].out, false); assert.ok(blackout.players[0].respawn > 3.9);
  assert.match(await page.$eval('#v-respawn-0', node => node.textContent), /OUT OF AIR · RESPAWN [34]\.\d s/);
  await advance(4);
  const airRespawn = await inspect();
  assert.equal(airRespawn.players[0].respawn, 0); assert.equal(airRespawn.players[0].out, false);
  assert.ok(Math.abs(airRespawn.players[0].oxygen / airRespawn.players[0].maxOxygen - .6) < .005);
  assert.ok(Math.abs(airRespawn.players[0].x - 100) < 8);
  pass('Race out-of-air HUD countdown, one blackout, 4 s respawn at the same location, 60% oxygen');

  await finishRace(0);
  assert.deepEqual((await inspect()).versus.scores, [1, 0]);
  assert.match(await page.$eval('#versus-overlay-content', node => node.textContent), /ITEMS USED/);
  assert.match(await page.$eval('#versus-overlay-content', node => node.textContent), /BLACKOUTS/);
  await screenshot('round-results');
  await advance(3.05);
  assert.equal((await inspect()).state, 'VERSUS_MATCH_RESULT');
  assert.deepEqual((await inspect()).versus.tally, { p1Wins: 1, p2Wins: 0, matches: 1 });
  assert.match(await page.$eval('#versus-overlay-content', node => node.textContent), /PLAYER 1 WINS/);
  assert.match(await page.$eval('#versus-overlay-content', node => node.textContent), /TORPEDOES DODGED/);
  assert.match(await page.$eval('#versus-overlay-content', node => node.textContent), /BLACKOUTS/);
  await screenshot('match-results');
  await advance(4);
  assert.equal((await inspect()).versus.tally.matches, 1, 'results frames cannot credit a match twice');
  await page.keyboard.press('KeyR');
  assert.equal((await inspect()).state, 'VERSUS_COUNTDOWN');
  assert.deepEqual((await inspect()).versus.scores, [0, 0]);
  await advance(4.02);
  await changeSetup();
  await configure({ rounds: '3' });
  await finishRace(1);
  await advance(3.01);
  assert.equal((await inspect()).state, 'VERSUS_COUNTDOWN');
  assert.equal((await inspect()).versus.round, 2);
  assert.deepEqual((await inspect()).versus.scores, [0, 1]);
  await advance(4.01);
  await finishRace(0);
  await advance(7.02);
  assert.equal((await inspect()).versus.round, 3);
  assert.deepEqual((await inspect()).versus.scores, [1, 1]);
  await finishRace(1);
  await advance(3.01);
  assert.equal((await inspect()).state, 'VERSUS_MATCH_RESULT');
  assert.deepEqual((await inspect()).versus.tally, { p1Wins: 1, p2Wins: 1, matches: 2 });
  pass('distance-triggered round result, 3 s transition, complete best-of-1 and best-of-3 scoring, exact-once tally, and R rematch');

  await changeSetup();
  await configure({ mode: 'survival' });
  const survivalDrain = await page.evaluate(() => {
    const before = AR.inspect().players[0].oxygen;
    return before - AR.debug.advance(1).players[0].oxygen;
  });
  assert.ok(Math.abs(survivalDrain - .85 * 1.5) < .02, 'Last Sub Standing drains resting oxygen 1.5 times faster: ' + survivalDrain);
  assert.match(await page.$eval('#v-lives-0', node => node.getAttribute('aria-label')), /3 oxygen lives/);
  for (const lives of [2, 1, 0]) {
    await page.evaluate(() => AR.debug.setOxygen(0, 0)); await advance(.03);
    const exhausted = await inspect(); assert.equal(exhausted.players[0].lives, lives);
    assert.equal(await page.$$eval('#v-lives-0 .v-tank:not(.empty)', nodes => nodes.length), lives);
    if (lives === 2) await screenshot('survival-lives');
    if (lives) { assert.equal(exhausted.state, 'VERSUS_RUNNING'); assert.equal(exhausted.players[0].out, false); await advance(4); assert.equal((await inspect()).players[0].respawn, 0); }
    else assert.equal(exhausted.players[0].out, true);
  }
  assert.equal((await inspect()).state, 'VERSUS_ROUND_RESULT');
  assert.deepEqual((await inspect()).versus.scores, [0, 1]);
  await advance(3.01);
  await changeSetup();
  await configure({ mode: 'pearl' });
  await place(0, { x: 100, pearls: 10 }); await place(1, { x: 700, pearls: 100 });
  await give(0, 'magnet');
  const magnet = await inspect();
  assert.equal(magnet.players[0].pearls, 40);
  assert.equal(magnet.players[1].pearls, 70);
  assert.ok(magnet.players[1].effects.magnet > 0);
  await place(0, { x: 100, oxygen: 0 });
  await advance(.02);
  assert.equal((await inspect()).players[0].out, false);
  assert.equal((await inspect()).state, 'VERSUS_RUNNING', 'one empty oxygen reserve does not end Pearl Rush');
  const stoppedPearls = (await inspect()).players[0].pearls;
  await advance(2);
  assert.equal((await inspect()).players[0].pearls, stoppedPearls);
  await advance(2);
  assert.equal((await inspect()).players[0].respawn, 0);
  assert.equal((await inspect()).players[0].blackouts, 1);
  assert.ok(Math.abs((await inspect()).players[0].oxygen / (await inspect()).players[0].maxOxygen - .6) < .005);
  await advance((await inspect()).versus.remaining + .02);
  assert.equal((await inspect()).state, 'VERSUS_ROUND_RESULT');
  assert.equal((await inspect()).versus.remaining, 0);
  assert.deepEqual((await inspect()).versus.scores, [0, 1]);
  await advance(3.02);
  assert.equal((await inspect()).versus.tally.matches, 4);
  pass('Last Sub Standing three lives, respawns, final elimination, and oxygen drain and full 90 s Pearl Rush, 30% pearl theft, blackout respawn, and timer winner');

  const soloAfter = await page.evaluate(() => { const solo = new AR.Save().data; delete solo.versus; return solo; });
  assert.deepEqual(soloAfter, soloBefore, 'all versus modes preserve solo currency, upgrades, unlocks, bests, and progression');
  await page.click('#versus-result-title');
  assert.equal((await inspect()).state, 'TITLE');
  await page.reload({ waitUntil: 'load' });
  assert.deepEqual(await page.evaluate(() => new AR.Save().data.versus), { p1Wins: 1, p2Wins: 3, matches: 4 });
  await page.click('#enter-versus');
  assert.match(await page.$eval('#versus-tally', node => node.textContent), /4 MATCHES/);
  await page.click('#versus-title');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: 'load' });
  const touchNote = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).some(node => node.textContent.trim() === 'Versus needs a keyboard' && node.getBoundingClientRect().width > 0 && getComputedStyle(node).display !== 'none'));
  assert.equal(touchNote, true, 'touch title shows the keyboard requirement');
  assert.deepEqual(issues, [], 'no application console errors or warnings');
  assert.deepEqual(external, [], 'no external network requests');
  pass('versus save persistence/tally display, untouched solo progress, touch keyboard note, zero console issues, and zero network');
  fs.writeFileSync(path.join(__dirname, 'versus.done'), 'PASS versus Chromium file:// integration; simultaneous keyboard driving for 20 s; measured ' + measured.fps.toFixed(1) + ' rAF fps over ' + (measured.milliseconds / 1000).toFixed(2) + ' s; vehicle/setup fairness; countdown; shared pause/visibility; ground overtaking and above landing; all nine items; torpedo instant crash/explosion; oxygen blackouts and three lives; shield; respawn; best-of-1/3; all three modes; exact-once persistent tally; unchanged solo progress; touch keyboard note; zero application errors/warnings or network. Screenshots: ' + screenshots.join(', ') + '. Visual inspection recorded separately.\n');
  await browser.close(); browser = null;
})().catch(async error => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
