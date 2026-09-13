'use strict';
const assert = require('node:assert/strict');
require('../docs/data.js');
require('../docs/terrain.js');
require('../docs/physics.js');
const AR = globalThis.AR, DT = AR.FIXED_DT;
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function flat(stage = AR.STAGES[0]) {
  const terrain = new AR.Terrain(stage);
  terrain.height = () => 400;
  terrain.slope = () => 0;
  return terrain;
}
function place(rover, x, y, angle = 0, vx = 0, vy = 0) {
  Object.assign(rover, { x, y, angle, vx, vy, omega: 0, sleeping: false, sleepTime: 0, grounded: false, bodyGrounded: false });
  const c = Math.cos(angle), s = Math.sin(angle), down = rover.stats.restLength + 8;
  for (const wheel of rover.wheels) {
    const side = wheel.side * rover.stats.wheelbase / 2;
    Object.assign(wheel, { x: x + side * c - down * s, y: y + side * s + down * c, vx, vy, omega: 0, grounded: false, platformId: null });
  }
  rover.savePrevious();
}
function finite(rover) {
  for (const body of [rover, ...rover.wheels]) for (const key of ['x', 'y', 'vx', 'vy', 'angle', 'omega']) assert(Number.isFinite(body[key]), key + ' became nonfinite');
}

test('Ice corridors stay smooth and wider than every vehicle through late-run terrain', () => {
  const largest = Math.max(...AR.VEHICLES.map(vehicle => Math.hypot(vehicle.wheelbase / 2, vehicle.restLength + 8) + vehicle.radius + 3));
  assert(250 > largest * 2);
  for (const seed of [0, 1, 3361, 76451, -12345]) {
    const terrain = new AR.Terrain(AR.STAGES[4], seed);
    for (let x = -100; x < 200000; x += 31) {
      assert(terrain.height(x) - terrain.ceiling(x) >= 250, 'Blocked corridor at ' + x + ' seed ' + seed);
      assert(Math.abs(terrain.ceiling(x + 0.05) - terrain.ceiling(x - 0.05)) < 0.5, 'Ceiling discontinuity');
      if (x % 31 === 24) terrain.maintain(x);
    }
  }
});

test('Second routes have deterministic accessible ends and spacious middle underpasses', () => {
  for (const id of ['kelp', 'wreck']) {
    const stage = AR.STAGES.find(stage => stage.id === id), a = new AR.Terrain(stage), b = new AR.Terrain(stage);
    const decks = a.platformsBetween(0, 20000);
    assert(decks.length >= 3);
    assert.deepEqual(decks, b.platformsBetween(0, 20000));
    for (const deck of decks) {
      const middle = (deck.start + deck.end) / 2;
      assert.equal(a.height(deck.start) - a.platformHeight(deck.start, deck), 65);
      assert(Math.abs(a.height(middle) - a.platformHeight(middle, deck) - 195) < 1e-9);
      assert.equal(a.platformHeight(deck.start - 1, deck), -Infinity);
      assert(a.platformsBetween(middle, middle).some(candidate => candidate.id === deck.id));
    }
  }
  assert.equal(new AR.Terrain(AR.STAGES[0]).platformsBetween(0, 20000).length, 0);
});

test('A rover can jump through an upper route and land on its wheels', () => {
  const terrain = flat(AR.STAGES[2]), deck = terrain.platformsBetween(0, 6000)[0];
  const x = (deck.start + deck.end) / 2, rover = new AR.Rover(terrain, AR.getStats('rover'));
  place(rover, x, 350, 0, 0, -360);
  let crossed = false, supported = false;
  for (let i = 0; i < 600; i++) {
    rover.step({}, DT); finite(rover);
    assert(!rover.crashed, rover.crashed);
    crossed ||= rover.wheels.every(wheel => wheel.y + wheel.radius < terrain.platformHeight(wheel.x, deck));
    supported ||= crossed && rover.wheels.some(wheel => wheel.platformId === deck.id);
  }
  assert(crossed && supported, 'Jump failed to reach and land on the deck');
  const start = rover.x;
  let contacts = 0;
  for (let i = 0; i < 180; i++) { rover.step({ throttle: true }, DT); if (rover.wheels.some(wheel => wheel.platformId === deck.id)) contacts++; }
  assert(rover.x > start + 60 && contacts > 80 && !rover.crashed, 'Upper route has no driveable traction');
});

test('A partial jump through a platform cannot catch its underside on the dome', () => {
  const terrain = flat(AR.STAGES[1]), deck = terrain.platformsBetween(0, 6000)[0];
  const x = (deck.start + deck.end) / 2, top = terrain.platformHeight(x, deck);
  const rover = new AR.Rover(terrain, AR.getStats('truck'));
  place(rover, x, top + 22, 0, 0, -35);
  for (let i = 0; i < 420; i++) { rover.step({}, DT); finite(rover); assert(!rover.crashed, rover.crashed); }
  assert(rover.y > top + 70 && rover.grounded, 'The underside stranded the rover');
});

test('Kelp hot springs lift every body equally; volcanic vent values stay exact', () => {
  const kelp = new AR.Terrain(AR.STAGES[1]);
  assert(kelp.hotSpringsBetween(0, 2300).length === 0);
  const spring = kelp.hotSpringsBetween(2300, 6000)[0];
  assert(spring && kelp.vent(spring.x) === 285);
  assert.equal(kelp.vent(spring.x - spring.width - 1), 0);
  const still = flat(), flowing = flat(); flowing.vent = () => 285;
  const a = new AR.Rover(still, AR.getStats('rover')), b = new AR.Rover(flowing, AR.getStats('rover'));
  place(a, 100, 300, 0.4); place(b, 100, 300, 0.4);
  a.substep({}, DT / 2); b.substep({}, DT / 2);
  const change = b.vy - a.vy;
  assert(change < 0 && Math.abs(a.omega - b.omega) < 1e-10);
  for (let i = 0; i < 2; i++) assert(Math.abs(b.wheels[i].vy - a.wheels[i].vy - change) < 1e-10);
  const volcanic = new AR.Terrain(AR.STAGES[3]);
  for (let x = 0; x <= 2300; x++) assert.equal(volcanic.vent(x), 0);
  for (let x = 2590; x < 20000; x += 960) assert.equal(volcanic.vent(x), 232.5 * (1 + 0.5 * Math.min(1, (x - 2300) / 12800)));
});

test('Gravity reversal drives all five vehicles along the roof and returns them safely', () => {
  for (const vehicle of AR.VEHICLES) {
    const terrain = flat(), rover = new AR.Rover(terrain, AR.getStats(vehicle.id));
    rover.setGravityFlipped(true);
    let roofContacts = 0;
    for (let i = 0; i < 720; i++) {
      rover.step({ throttle: true }, DT); finite(rover);
      if (rover.grounded && rover.y < 180) roofContacts++;
      assert(!rover.crashed, vehicle.id + ': ' + rover.crashed);
    }
    assert(rover.gravity() < 0 && rover.gravityFlipped && roofContacts > 180 && rover.x > 400, vehicle.id + ' did not drive on the roof');
    rover.setGravityFlipped(false);
    for (let i = 0; i < 600; i++) { rover.step({ throttle: rover.grounded }, DT); finite(rover); assert(!rover.crashed, vehicle.id + ': expiry ' + rover.crashed); }
    assert(!rover.gravityFlipped && rover.gravity() > 0 && rover.grounded && Math.cos(rover.angle) > 0.9, vehicle.id + ' did not return upright');
  }
});

test('Jet thrust works in either air direction independent of chassis angle without pitch impulses', () => {
  for (const angle of [0, Math.PI, 0.7, -1]) for (const control of ['throttle', 'brake']) {
    const terrain = flat(), a = new AR.Rover(terrain, AR.getStats('rover')), b = new AR.Rover(terrain, AR.getStats('rover'));
    place(a, 100, -400, angle); place(b, 100, -400, angle); b.jetThrust = 240;
    a.substep({ [control]: true }, DT / 2); b.substep({ [control]: true }, DT / 2);
    const change = b.vx - a.vx;
    assert(control === 'throttle' ? change > 0 : change < 0);
    assert(Math.abs(a.omega - b.omega) < 1e-10, 'Jet added pitch');
    for (let i = 0; i < 2; i++) assert(Math.abs(b.wheels[i].vx - a.wheels[i].vx - change) < 1e-10);
    place(a, 100, -400, angle, 1000); place(b, 100, -400, angle, 1000);
    a.substep({ throttle: true }, DT / 2); b.substep({ throttle: true }, DT / 2);
    assert(Math.abs(a.vx - b.vx) < 1e-10, 'Jet accelerates beyond its speed cap');
  }
});

test('Sharks telegraph, can be dodged, bite nonlethally and respect victim cooldowns', () => {
  const terrain = flat(), hazards = new AR.WorldHazards(terrain), rover = new AR.Rover(terrain, AR.getStats('rover'));
  place(rover, 2200, 345);
  for (let i = 0; i < 240; i++) hazards.step([rover], DT);
  assert(hazards.sharks.every(shark => shark.phase === 'patrol') && rover.oxygen === rover.maxOxygen);
  place(rover, 2900, 335); hazards.step([rover], DT);
  const shark = hazards.sharks[0]; assert(shark);
  place(rover, shark.x - 120, shark.y); hazards.step([rover], DT);
  assert.equal(shark.phase, 'warning');
  for (let i = 0; i < 100; i++) hazards.step([rover], DT);
  assert.equal(shark.phase, 'warning');
  for (let i = 0; i < 40 && shark.phase !== 'lunge'; i++) hazards.step([rover], DT);
  assert.equal(shark.phase, 'lunge');
  const before = rover.oxygen; place(rover, rover.x, rover.y - 150);
  for (let i = 0; i < 160; i++) hazards.step([rover], DT);
  assert.equal(rover.oxygen, before, 'Ballast-height dodge was hit');
  Object.assign(shark, { phase: 'lunge', timer: 1, x: rover.x - 10, y: rover.y, vx: 235, vy: 0, direction: 1 });
  rover.oxygen = 3; hazards.step([rover], DT);
  assert.equal(rover.oxygen, 1); assert.equal(rover.crashed, ''); assert(rover.vx === 65 && rover.vy === -35);
  const vx = rover.vx;
  Object.assign(shark, { phase: 'lunge', timer: 1, x: rover.x - 10, y: rover.y }); hazards.step([rover], DT);
  assert.equal(rover.vx, vx, 'Cooldown allowed an immediate second bite');
});

test('Arena worlds stay bounded in height and omit race-only obstacles', () => {
  for (const stage of AR.STAGES) {
    const terrain = new AR.Terrain(stage).setArena();
    assert.deepEqual(terrain.arena, { left: 0, right: 1800, ceiling: 40 });
    for (let x = 0; x <= 1800; x += 11) { assert(terrain.height(x) >= 438 && terrain.height(x) <= 470); assert.equal(terrain.ceiling(x), 40); assert.equal(terrain.vent(x), 0); }
    assert.equal(terrain.platformsBetween(0, 10000).length, 0);
    assert.equal(terrain.hotSpringsBetween(0, 10000).length, 0);
    const hazards = new AR.WorldHazards(terrain); hazards.step([new AR.Rover(terrain, AR.getStats('rover'))], DT); assert.equal(hazards.sharks.length, 0);
  }
});
console.log('PASS world features: ' + passed + ' checks');
