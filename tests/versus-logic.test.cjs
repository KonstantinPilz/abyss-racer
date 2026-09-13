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

test('Catch-up follows present position, with 80 m / 30 m hysteresis', () => {
  const v = match(), a = v.players[0], b = v.players[1];
  // A historical lead must not grant the current leader a catch-up boost.
  a.distance = 1500; a.maxX = a.startX + 15000;
  placeProgress(v, 0, 0); placeProgress(v, 1, 100);
  v.step(DT);
  assert(a.catchup && !b.catchup, 'Boost went to the historical trailer');
  near(a.rover.stats.topSpeed, a.base.topSpeed * 1.12, 'Catch-up speed multiplier');
  placeProgress(v, 1, 40); v.step(DT);
  assert(a.catchup, 'Boost dropped before the gap reached 30 m');
  placeProgress(v, 1, 29); v.step(DT);
  assert(!a.catchup, 'Boost persisted inside 30 m');
  near(a.rover.stats.topSpeed, a.base.topSpeed, 'Base speed restored');
  placeProgress(v, 1, 79); v.step(DT);
  assert(!a.catchup, 'Boost reactivated below 80 m');
  placeProgress(v, 1, 81); v.step(DT);
  assert(a.catchup, 'Boost failed to activate beyond 80 m');
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
  v.debug().placePlayer(0, { x: line - 70 });
  v.debug().placePlayer(1, { x: line - .1 });
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

test('An exhausted Pearl Rush rover keeps driving but cannot collect or gain points', () => {
  const v = match('pearl'), p = v.players[0];
  v.debug().placePlayer(0, { x: 500, oxygen: 0, pearls: 12 });
  v.debug().placePlayer(1, { x: 3000, pearls: 100 });
  const q = { key: 'test:empty', x: p.rover.x, y: p.rover.y, type: 'pearl', collected: false };
  v.pickups = [q]; const x = p.rover.x;
  v.keys.add('KeyD'); v.keys.add('KeyW');
  for (let i = 0; i < 120; i++) v.step(DT);
  assert(p.rover.x > x + 5, 'Empty Pearl Rush rover stopped driving');
  assert(p.out); assert.equal(p.rover.oxygen, 0); assert.equal(p.pearls, 12);
  assert(!q.collected, 'Empty rover collected a pickup');
  assert.equal(p.rover.cooldown, 0, 'Empty rover fired ballast');
  v.tick(DT);
  assert.equal(v.sound.lastState.players[0].running, true, 'Empty Pearl Rush driver lost engine audio');
  assert.equal(v.sound.lastState.players[0].oxygenFraction, 0);
  p.item = 'magnet'; p.charges = 1; v.useItem(0);
  assert.equal(p.pearls, 12, 'Empty rover gained points from a held magnet');
  assert.equal(v.players[1].pearls, 70, 'Held item stopped working after oxygen depletion');
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
  survival.players[0].rover.oxygen = 0; survival.step(DT);
  assert.equal(survival.roundWinner, 1);
  assert.equal(survival.phase, 'ROUND_RESULT');
});

test('Empty reserves and Pearl Rush timer use the correct score and tie rules', () => {
  for (const tied of [false, true]) {
    const race = match();
    race.players.forEach((p, i) => { p.distance = i && !tied ? 220 : 240; p.rover.oxygen = 0; });
    race.step(DT);
    assert.equal(race.roundWinner, tied ? -1 : 0, 'Race depletion should compare furthest distance');
  }
  const survival = match('survival');
  survival.players.forEach(p => { p.rover.oxygen = 0; }); survival.step(DT);
  assert.equal(survival.roundWinner, -1, 'Simultaneous survival depletion should tie');
  for (const empty of [false, true]) {
    const pearl = match('pearl');
    pearl.players[0].pearls = 20; pearl.players[1].pearls = 45;
    if (empty) pearl.players.forEach(p => { p.rover.oxygen = 0; });
    else pearl.time = 90 - DT;
    pearl.step(DT);
    assert.equal(pearl.roundWinner, 1, 'Pearl round should compare pearls at timer/depletion');
  }
  const pearlTie = match('pearl'); pearlTie.time = 90 - DT; pearlTie.step(DT);
  assert.equal(pearlTie.roundWinner, -1, 'Equal timed pearl scores should tie');
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
  v.debug().placePlayer(1, { x: p.rover.x + 40, y: p.rover.y });
  const contacts = v.contacts; v.step(DT);
  assert.equal(v.contacts, contacts, 'Spawn shield failed to suppress rover contact');
  p.effects.spawnShield = 0; v.step(DT);
  assert(v.contacts > contacts, 'Rover contact did not resume after protection');
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

console.log('PASS TOTAL: ' + passed + '/' + passed + ' versus logic checks');
