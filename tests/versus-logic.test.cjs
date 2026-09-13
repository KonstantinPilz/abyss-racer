'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real controller/physics without loading game.js or a browser.
// Only presentation methods are suppressed; match, pickup, and item logic run.
const elements = new Map();
const context = vm.createContext({
  console,
  document: {
    body: { dataset: {} },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', focus() {} });
      return elements.get(id);
    }
  }
});
vm.runInContext('globalThis.window = globalThis;', context);
for (const file of ['data.js', 'terrain.js', 'physics.js', 'contacts.js', 'versus.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs', file), 'utf8'), context, { filename: file });
}
const AR = context.AR, DT = AR.FIXED_DT;
for (const method of ['buildUI', 'show', 'hud', 'setupUI', 'resultUI']) AR.Versus.prototype[method] = function () {};
const plain = value => JSON.parse(JSON.stringify(value));
function match(mode = 'race') {
  const save = { data: { versus: { p1Wins: 0, p2Wins: 0, matches: 0 } }, finishVersus() { throw new Error('Unexpected match completion in logic fixture'); } };
  const sound = { unlock() {}, suspend() {}, play() {}, update(state) { this.lastState = state; } };
  const v = new AR.Versus(save, sound, {}, () => {});
  Object.assign(v.config, { mode, target: 2000 }); v.active = true; v.startMatch();
  v.terrain.height = () => 400; v.terrain.slope = () => 0;
  v.terrain.ceiling = () => -Infinity; v.terrain.vent = () => 0;
  for (const p of v.players) v.debug().placePlayer(p.index, { x: p.startX });
  v.phase = 'RUNNING';
  return v;
}
function placeProgress(v, index, distance) {
  const p = v.players[index];
  v.debug().placePlayer(index, { x: p.startX + distance * 10 });
}
function near(actual, expected, message, epsilon = 1e-8) {
  assert(Math.abs(actual - expected) < epsilon, message + ': expected ' + expected + ', got ' + actual);
}
let passed = 0;
function test(name, work) { work(); passed++; console.log('PASS ' + name); }

test('Catch-up follows present position and fades from +25% speed/+15% torque at 60 m to zero at 20 m', () => {
  const v = match(), a = v.players[0], b = v.players[1];
  a.distance = 1500; a.maxX = a.startX + 15000;
  for (const [gap, multiplier] of [[100, 1], [60, 1], [40, .5], [20, 0], [19, 0]]) {
    placeProgress(v, 0, 0); placeProgress(v, 1, gap);
    // This test isolates the current from the independently tested slipstream.
    v.debug().placePlayer(0, { x: a.startX, y: -1000 });
    v.step(DT);
    assert.equal(a.catchup, multiplier > 0); assert(!b.catchup);
    near(a.rover.stats.topSpeed, a.base.topSpeed * (1 + .25 * multiplier), 'Catch-up speed');
    near(a.rover.stats.torque, a.base.torque * (1 + .15 * multiplier), 'Catch-up torque');
  }
});

test('Slipstream gives +10% speed only 8–40 m directly behind on the ground', () => {
  const v = match(), p = v.players[0];
  for (const [gap, active] of [[79, false], [80, true], [200, true], [400, true], [401, false], [-200, false]]) {
    v.debug().placePlayer(0, { x: 100 }); v.debug().placePlayer(1, { x: 100 + gap });
    v.step(DT); assert.equal(p.slipstream, active, 'Slipstream at ' + gap + ' px');
    const current = Math.max(0, Math.min(1, ((gap + p.startX - v.players[1].startX) / 10 - 20) / 40));
    near(p.rover.stats.topSpeed, p.base.topSpeed * (1 + .25 * current) * (active ? 1.1 : 1), 'Stacked speed');
  }
  v.debug().placePlayer(0, { x: 100, y: 150 }); v.debug().placePlayer(1, { x: 300 }); v.step(DT);
  assert(!p.slipstream, 'Airborne rover gained slipstream');
});

test('Item weighting follows current progress after a former leader falls behind', () => {
  const v = match(), p = v.players[0];
  p.distance = 1500; p.maxX = p.startX + 15000;
  placeProgress(v, 0, 0); placeProgress(v, 1, 150);
  vm.runInContext('globalThis.originalRandom = Math.random; Math.random = () => 0;', context);
  try {
    assert.equal(v.rollItem(p), 'torpedo', 'Current trailer should use attack table');
    assert.equal(v.rollItem(v.players[1]), 'shield', 'Current leader should use utility table');
  } finally { vm.runInContext('Math.random = originalRandom;', context); }
});

test('Larger gaps favour overtaking items; even starts and leaders retain ordinary crates', () => {
  const v = match();
  const draws = (index, gap) => {
    placeProgress(v, index, 0); placeProgress(v, 1 - index, gap);
    const counts = {};
    vm.runInContext('globalThis.originalRandom = Math.random;', context);
    try {
      for (let i = 0; i < 900; i++) {
        vm.runInContext('Math.random = () => ' + (i + .5) / 900 + ';', context);
        const id = v.rollItem(v.players[index]); counts[id] = (counts[id] || 0) + 1;
        assert(AR.VERSUS_ITEMS[id]);
      }
    } finally { vm.runInContext('Math.random = originalRandom;', context); }
    return counts;
  };
  for (const index of [0, 1]) {
    const even = draws(index, 0), leader = draws(index, -80);
    assert.deepEqual(even, leader, 'Starting-grid offset must not confer stronger items');
    const close = draws(index, 10), medium = draws(index, 20), far = draws(index, 60);
    assert(far.turbo >= 450, 'At least half of far-behind crates give a speed boost');
    assert(far.turbo > medium.turbo && medium.turbo > close.turbo);
    assert.equal((far.turbo || 0) + (far.torpedo || 0) + (far.net || 0), 900);
    assert(!medium.anchor && !medium.shield && !medium.magnet);
    v.matchConfig.mode = 'pearl'; assert(draws(index, 20).magnet > 0);
    v.matchConfig.mode = 'race';
  }
});

function supplyMatch(mode = 'race', trailer = 0) {
  const v = match(mode);
  v.pickups = []; v.generatePickups = () => {};
  placeProgress(v, trailer, 0); placeProgress(v, 1 - trailer, 80);
  return v;
}
function steps(v, count) { for (let i = 0; i < count; i++) v.tick(DT); }

test('An empty-handed trailer receives a usable Turbo after six seconds in every mode', () => {
  for (const mode of ['race', 'survival', 'pearl']) for (const index of [0, 1]) {
    const v = supplyMatch(mode, index), p = v.players[index];
    // Historical distance must not prevent a comeback after being knocked backward.
    p.distance = 200; p.maxX = p.startX + 2000;
    steps(v, 719); assert.equal(p.item, null);
    steps(v, 1); assert.equal(p.item, 'turbo'); assert.equal(p.charges, 1);
    assert.equal(v.players[1 - index].item, null); assert.equal(p.itemsUsed, 0);
    assert.match(p.toast, /catch-up.*Turbo Current/i);
    assert.equal(p.effects.turbo || 0, 0, 'Player chooses when to fire');
    assert(v.useItem(index)); steps(v, 1);
    near(p.rover.stats.topSpeed, p.base.topSpeed * 1.25 * 1.4, 'Existing Turbo and current stack');
    assert.equal(p.itemsUsed, 1);
    steps(v, 360); assert.equal(p.effects.turbo, 0);
    near(p.rover.stats.topSpeed, p.base.topSpeed * 1.25, 'Turbo expires normally');
    steps(v, 1438 - 360); // Total time since delivery stays below the 12-second cooldown.
    assert.equal(p.item, null);
    steps(v, 1); assert.equal(p.item, 'turbo');
  }
});

test('Catch-up deliveries respect held items, interrupted gaps, pause, respawn and round reset', () => {
  const v = supplyMatch(), p = v.players[0];
  v.debug().giveItem(0, 'anchor'); steps(v, 840);
  assert.equal(p.item, 'anchor'); assert.equal(p.charges, 2);
  v.useItem(0); steps(v, 720); assert.equal(p.item, 'anchor'); assert.equal(p.charges, 1);
  v.useItem(0); steps(v, 600); assert.equal(p.item, null);
  placeProgress(v, 1, 59); steps(v, 1); placeProgress(v, 1, 80);
  steps(v, 600); assert.equal(p.item, null, 'Closing the gap resets the six-second wait');
  v.pause(); const before = [p.catchupWait, p.catchupCooldown, v.time]; steps(v, 1200);
  assert.deepEqual([p.catchupWait, p.catchupCooldown, v.time], before); v.resume();
  steps(v, 119); assert.equal(p.item, null); steps(v, 1); assert.equal(p.item, 'turbo');
  v.round++; v.newRound(); assert(v.players.every(p => p.item === null && p.catchupWait === 0 && p.catchupCooldown === 0));
  for (const index of [0, 1]) {
    const blocked = supplyMatch(); steps(blocked, 600);
    blocked.crash(blocked.players[index]); steps(blocked, 121);
    assert.equal(blocked.players[0].item, null, 'No delivery during either racer’s respawn');
    steps(blocked, 240); assert.equal(blocked.players[0].item, null, 'Respawn resets eligibility');
  }
  const blackout = supplyMatch('survival'); steps(blackout, 600);
  blackout.debug().setOxygen(0, 0); steps(blackout, 121);
  assert.equal(blackout.players[0].item, null); assert(blackout.players[0].respawn > 0);
});

test('Using the delivered Turbo closes more ground smoothly than the catch-up current alone', () => {
  const gapAfter = turbo => {
    const v = supplyMatch(); steps(v, 720);
    if (turbo) assert(v.useItem(0));
    v.keys.add('KeyD'); v.keys.add('ArrowRight'); steps(v, 360);
    for (const p of v.players) {
      assert.equal(p.crashes, 0); assert.equal(p.respawn, 0);
      assert([p.rover.x, p.rover.y, p.rover.vx, p.rover.vy].every(Number.isFinite));
    }
    return v.currentDistance(v.players[1]) - v.currentDistance(v.players[0]);
  };
  assert(gapAfter(true) < gapAfter(false) - 10, 'Turbo should close at least 10 m more in three seconds');
});

function crossingMatch(before, speeds) {
  const v = match(); v.matchConfig.target = 500; v.pickups = [];
  v.players.forEach((p, index) => {
    p.distance = before[index]; p.maxX = p.startX + p.distance * 10;
    v.debug().placePlayer(index, { x: p.maxX, y: -1000 - index * 200 });
    p.rover.step = function () { this.savePrevious(); this.x += speeds[index] * DT; };
  });
  v.step(DT); return v;
}
test('Same-step finish uses crossing fraction instead of greatest overshoot', () => {
  const v = crossingMatch([499.9, 499.99], [300, 100]);
  assert(v.players[0].distance > v.players[1].distance, 'Fixture needs the later finisher to overshoot further');
  assert.equal(v.roundWinner, 1, 'P2 crosses at 1 ms; P1 crosses at 3.33 ms');
  assert.equal(v.phase, 'ROUND_RESULT');
  assert.deepEqual(plain(v.scores), [0, 1]);
});
test('A shared-contact shove across the finish line counts on that same step', () => {
  const v = match(); v.matchConfig.target = 500; v.pickups = [];
  const line = v.players[1].startX + 5000;
  v.debug().placePlayer(1, { x: line - .1 });
  v.debug().placePlayer(0, { x: line + 15, y: v.players[1].rover.y - 60, vy: 220 });
  v.step(DT);
  assert(v.contacts > 0, 'Fixture needs a real rover contact');
  assert(v.players[1].rover.x >= line, 'Contact must push P2 across the line');
  assert.equal(v.roundWinner, 1);
  assert.equal(v.phase, 'ROUND_RESULT');
});
test('An exact finish tie gives no point and schedules another round', () => {
  const v = crossingMatch([499.9, 499.9], [200, 200]);
  assert.equal(v.roundWinner, -1);
  assert.deepEqual(plain(v.scores), [0, 0]);
  for (let i = 0; i < 360; i++) v.tick(DT);
  assert.equal(v.phase, 'COUNTDOWN');
  assert.equal(v.round, 2);
  assert.deepEqual(plain(v.scores), [0, 0]);
});

test('Shared pearls are consumed once, and a held item leaves a crate available', () => {
  const v = match();
  for (const p of v.players) v.debug().placePlayer(p.index, { x: 500, y: 300 });
  const pearl = { key: 'test:pearl', x: 500, y: 300, type: 'pearl', collected: false };
  v.pickups = [pearl]; v.collect(); v.collect();
  assert.equal(v.players.reduce((sum, p) => sum + p.pearls, 0), 5);
  assert(pearl.collected && v.collected.has(pearl.key));
  v.debug().placePlayer(1, { x: 2000, y: 300 });
  const p = v.players[0]; p.item = 'ink'; p.charges = 1;
  const crate = { key: 'test:crate', x: 500, y: 300, type: 'crate', collected: false };
  v.pickups = [crate]; v.collect();
  assert.equal(p.item, 'ink'); assert(!crate.collected && !v.collected.has(crate.key));
  p.item = null; p.charges = 0; v.collect();
  assert(crate.collected && v.collected.has(crate.key));
  assert(AR.VERSUS_ITEMS[p.item]);
});

test('Collected pickups stay gone after old sectors are pruned and regenerated', () => {
  const v = match(), q = v.pickups.find(q => q.type === 'pearl' && q.key.startsWith('0:'));
  assert(q, 'Fixture must include a sector-zero pearl');
  v.debug().placePlayer(0, { x: q.x, y: q.y });
  v.debug().placePlayer(1, { x: 2500 }); v.collect();
  assert(v.collected.has(q.key));
  for (const p of v.players) v.debug().placePlayer(p.index, { x: 20000 + p.index * 200 });
  v.generatePickups();
  assert(!v.generated.has(0), 'Distant sector stayed allocated');
  for (const p of v.players) v.debug().placePlayer(p.index, { x: q.x + p.index * 200 });
  v.generatePickups();
  assert(v.generated.has(0), 'Returning did not regenerate the sector');
  assert(!v.pickups.some(item => item.key === q.key), 'Collected pearl regenerated');
  assert(v.pickups.some(item => item.key.startsWith('0:')), 'Uncollected sector pickups should return');
});

test('Race and Pearl Rush oxygen depletion black out at their position and respawn with 60% air', () => {
  for (const mode of ['race', 'pearl']) {
    const v = match(mode), p = v.players[0];
    v.debug().placePlayer(0, { x: 500, pearls: 12 }); v.debug().placePlayer(1, { x: 3000 });
    assert(v.debug().setOxygen(0, 0)); v.step(DT);
    assert.equal(p.respawn, 4); assert.equal(p.blackouts, 1); assert.equal(p.crashes, 0); assert(!p.out);
    const q = { key: 'test:blackout', x: 500, y: p.rover.y, type: 'pearl', collected: false }; v.pickups = [q];
    v.keys.add('KeyD'); v.keys.add('KeyW');
    for (let i = 0; i < 479; i++) v.step(DT);
    assert(p.respawn > 0); near(p.rover.x, 500, 'Blackout location'); assert(!q.collected); assert.equal(p.pearls, 12);
    v.step(DT); assert.equal(p.respawn, 0); assert.equal(p.blackouts, 1); assert(!p.out);
    near(p.rover.oxygen, p.rover.maxOxygen * .6, 'Refilled oxygen');
    assert.equal(p.rover.crashed, ''); assert.equal(v.phase, 'RUNNING');
    v.endRound(0, 'test'); assert.equal(v.totals[0].blackouts, 1);
  }
});

test('Last Sub Standing drains oxygen at 1.5× and has one-third as many tanks', () => {
  for (const throttle of [false, true]) {
    const normal = match(), survival = match('survival');
    if (throttle) { normal.keys.add('KeyD'); survival.keys.add('KeyD'); }
    const before = normal.players[0].rover.oxygen;
    normal.step(DT); survival.step(DT);
    const ordinaryDrain = before - normal.players[0].rover.oxygen;
    near(before - survival.players[0].rover.oxygen, ordinaryDrain * 1.5, 'Survival drain multiplier');
  }
  const normal = match(), survival = match('survival');
  const tanks = v => v.pickups.filter(q => q.type === 'oxygen').length;
  assert(tanks(survival) > 0);
  assert.equal(tanks(normal), tanks(survival) * 3);
  const p = survival.players[0]; assert.equal(p.lives, 3);
  for (const lives of [2, 1, 0]) {
    survival.debug().setOxygen(0, 0); survival.step(DT);
    assert.equal(p.lives, lives); assert.equal(p.blackouts, 3 - lives);
    if (lives) { assert(!p.out); assert.equal(p.respawn, 4); for (let i = 0; i < 480; i++) survival.step(DT); near(p.rover.oxygen, p.rover.maxOxygen * .6, 'Life refill'); }
  }
  assert(p.out); assert.equal(p.respawn, 0); assert.equal(survival.roundWinner, 1);
  assert.equal(survival.phase, 'ROUND_RESULT');
});

test('Simultaneous final survival lives compare distance; Race/Pearl empty air cannot end a round', () => {
  for (const tied of [false, true]) {
    const v = match('survival');
    v.players.forEach((p, i) => { p.lives = 1; p.distance = i && !tied ? 220 : 240; p.rover.oxygen = 0; });
    v.step(DT); assert.equal(v.roundWinner, tied ? -1 : 0);
    assert(v.players.every(p => p.out && p.lives === 0));
  }
  for (const mode of ['race', 'pearl']) {
    const v = match(mode); v.players.forEach(p => { p.rover.oxygen = 0; }); v.step(DT);
    assert.equal(v.phase, 'RUNNING'); assert(v.players.every(p => p.respawn > 0 && !p.out));
  }
  const pearl = match('pearl'); pearl.players[0].pearls = 20; pearl.players[1].pearls = 45; pearl.time = 90 - DT;
  pearl.step(DT); assert.equal(pearl.roundWinner, 1);
  const pearlTie = match('pearl'); pearlTie.time = 90 - DT; pearlTie.step(DT); assert.equal(pearlTie.roundWinner, -1);
});

test('Crash respawns once after 2.5 s, charges oxygen, and protects against attacks/contact', () => {
  const v = match(), p = v.players[0]; p.rover.oxygen = 90;
  const x = p.rover.x, maxOxygen = p.rover.maxOxygen;
  assert(v.debug().crashPlayer(0)); v.crash(p);
  assert.equal(p.crashes, 1); assert.equal(p.respawn, 2.5);
  let elapsed = 0;
  while (p.respawn > 0 && elapsed < 3) { v.step(DT); elapsed += DT; }
  near(elapsed, 2.5, 'Respawn time'); assert.equal(p.respawn, 0);
  near(p.rover.x, x, 'Respawn X'); near(p.rover.angle, 0, 'Respawn orientation');
  near(p.rover.oxygen, 90 - maxOxygen * .15, 'Respawn oxygen penalty');
  near(p.effects.spawnShield, 1.5, 'Respawn shield duration');
  const attacker = v.players[1]; attacker.item = 'ink'; attacker.charges = 1;
  v.useItem(1);
  assert(!(p.effects.ink > 0)); assert(p.effects.blocked > 0);
  near(p.effects.spawnShield, 1.5, 'Spawn shield must not be consumed');
  assert.equal(v.totals[1].itemsLanded, 0);
  v.debug().placePlayer(1, { x: p.rover.x + 15, y: p.rover.y - 60, vy: 220 });
  const contacts = v.contacts; v.step(DT);
  assert.equal(v.contacts, contacts, 'Spawn shield failed to suppress rover contact');
  p.effects.spawnShield = 0; v.step(DT);
  assert(v.contacts > contacts, 'Rover contact did not resume after protection');
});

test('Crash oxygen penalty triggers exactly one blackout and cannot bypass a final survival life', () => {
  for (const mode of ['race', 'survival']) {
    const v = match(mode), p = v.players[0]; p.rover.oxygen = 1;
    if (mode === 'survival') p.lives = 1;
    assert(v.debug().crashPlayer(0));
    for (let i = 0; i < 300; i++) v.step(DT);
    assert.equal(p.crashes, 1); assert.equal(p.blackouts, 1);
    if (mode === 'survival') { assert.equal(p.lives, 0); assert(p.out); assert.equal(v.roundWinner, 1); }
    else { assert(!p.out); assert.equal(p.respawn, 4); for (let i = 0; i < 480; i++) v.step(DT); near(p.rover.oxygen, p.rover.maxOxygen * .6, 'Blackout after crash refill'); assert.equal(p.blackouts, 1); }
  }
});

test('An oxygen pickup on the depletion step rescues the rover without a crash or blackout', () => {
  const v = match(), p = v.players[0]; p.rover.oxygen = .001;
  v.pickups = [{ key: 'test:last-breath', type: 'oxygen', x: p.rover.x, y: p.rover.y, collected: false }];
  v.step(DT);
  near(p.rover.oxygen, p.rover.maxOxygen * .6, 'Last-breath pickup');
  assert.equal(p.rover.crashed, ''); assert.equal(p.crashes, 0); assert.equal(p.blackouts, 0); assert.equal(p.respawn, 0);
  v.step(DT); assert(p.rover.oxygen > 0 && !p.rover.crashed);
});

test('A siphon that empties oxygen triggers one blackout on the next fixed step', () => {
  const v = match(), victim = v.players[1]; victim.rover.oxygen = 20;
  v.players[0].item = 'siphon'; v.players[0].charges = 1; assert(v.useItem(0));
  assert.equal(victim.rover.oxygen, 0); v.step(DT);
  assert.equal(victim.blackouts, 1); assert.equal(victim.respawn, 4); assert.equal(victim.crashes, 0);
  for (let i = 0; i < 60; i++) v.step(DT);
  assert.equal(victim.blackouts, 1); assert(!victim.out);
});

test('An ordinary bubble shield blocks exactly one attack', () => {
  const v = match(), defender = v.players[0], attacker = v.players[1];
  defender.item = 'shield'; defender.charges = 1; v.useItem(0);
  near(defender.effects.shield, 8, 'Shield lifetime');
  attacker.item = 'ink'; attacker.charges = 1; v.useItem(1);
  assert.equal(defender.effects.shield, 0); assert(!(defender.effects.ink > 0));
  attacker.item = 'net'; attacker.charges = 1; v.useItem(1);
  near(defender.effects.net, 4, 'Second attack should land');
  assert.equal(v.totals[1].itemsLanded, 1);
});

test('Torpedo instantly crashes, lands one item, explodes, and respawns within 3 s', () => {
  const v = match(), victim = v.players[1];
  v.debug().placePlayer(0, { x: 100 }); v.debug().placePlayer(1, { x: 700 });
  assert(v.debug().fireTorpedo(0)); let n = 0;
  while (!victim.respawn && n++ < 240) v.step(DT);
  assert.equal(victim.rover.crashed, 'Torpedoed!'); assert.equal(victim.crashes, 1);
  assert.equal(victim.respawn, 2.5); assert.equal(v.totals[0].itemsLanded, 1);
  assert.equal(v.explosions.length, 1); assert(v.flash > 0 && v.shake > 0);
  assert.equal(v.projectiles.length, 0);
  for (let i = 0; i < 300; i++) v.step(DT);
  assert.equal(victim.respawn, 0); assert.equal(victim.rover.crashed, ''); assert.equal(victim.crashes, 1);
});

test('Torpedo shield block and airborne dodge survive the faster swept projectile', () => {
  for (const defense of ['shield', 'airborne']) {
    const v = match(), victim = v.players[1];
    v.debug().placePlayer(0, { x: 100 }); v.debug().placePlayer(1, { x: 700, ...(defense === 'airborne' ? { y: 100 } : {}) });
    if (defense === 'shield') victim.effects.shield = 8;
    v.debug().fireTorpedo(0);
    for (let i = 0; i < 110; i++) v.step(DT);
    assert.equal(victim.crashes, 0); assert.equal(victim.respawn, 0); assert.equal(v.totals[0].itemsLanded, 0);
    if (defense === 'shield') { assert.equal(victim.effects.shield, 0); assert(victim.effects.blocked > 0); }
    else { assert.equal(v.totals[1].torpedoesDodged, 1); assert(victim.effects.dodged > 0); }
  }
});

test('Torpedo speed is 10% above the fastest level-5 vehicle and life remains capped at 12 s', () => {
  const v = match();
  for (const vehicle of AR.VEHICLES) {
    const base = AR.getStats(vehicle.id, Object.fromEntries(AR.UPGRADES.map(u => [u.id, 5])));
    assert(v.inspect().versus.torpedoSpeed > base.topSpeed);
  }
  const fastest = Math.max(...AR.VEHICLES.map(vehicle => AR.getStats(vehicle.id, Object.fromEntries(AR.UPGRADES.map(u => [u.id, 5]))).topSpeed));
  assert.equal(v.inspect().versus.torpedoSpeed, Math.ceil(fastest * 1.1));
  v.debug().placePlayer(1, { x: 700, y: -100000 }); v.debug().fireTorpedo(0);
  assert.equal(v.projectiles[0].life, 12);
  for (let i = 0; i < 1441; i++) v.updateProjectiles(DT);
  assert.equal(v.projectiles.length, 0);
});

console.log('PASS TOTAL: ' + passed + '/' + passed + ' versus logic checks');
