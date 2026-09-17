'use strict';
const assert = require('node:assert/strict');
global.window = global;
global.document = { body: { dataset: {} }, getElementById() { return { textContent: '', focus() {} }; } };
for (const name of ['data', 'terrain', 'physics', 'contacts', 'versus', 'save']) require('../docs/' + name + '.js');
for (const name of ['buildUI', 'show', 'hud', 'setupUI', 'resultUI']) AR.Versus.prototype[name] = function () {};
const DT = AR.FIXED_DT;
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS ' + name); };
function game(mode = 'race', stage = 'reef') {
  const v = new AR.Versus({ data: { versus: {} }, finishVersus() {} }, { unlock() {}, suspend() {}, play() {}, update() {} }, {}, () => {});
  v.active = true; Object.assign(v.config, { mode, stage, target: 2000, bestOf: 1 }); v.startMatch(); v.phase = 'RUNNING';
  v.pickups = []; v.generatePickups = () => {}; return v;
}
function flat(v) { v.terrain.height = () => 400; v.terrain.slope = () => 0; v.hazards = null; }
function step(v, seconds) { for (let n = 0; n < Math.round(seconds / DT); n++) v.step(DT); }
function rover(stage = 'reef') { const t = new AR.Terrain(AR.STAGES.find(s => s.id === stage)); return new AR.Rover(t, AR.getStats('rover')); }
function place(r, x, y, vx = 0) { const dx = x - r.x, dy = y - r.y; for (const b of [r, ...r.wheels]) { b.x += dx; b.y += dy; b.vx = vx; b.vy = 0; } r.savePrevious(); }

test('Net halves torque and top speed for exactly four seconds with mild drag', () => {
  const v = game(); flat(v); v.debug().placePlayer(0, { x: 100 }); v.debug().placePlayer(1, { x: -500 }); v.players[1].startX = -500;
  v.debug().giveItem(0, 'net'); v.useItem(0); step(v, DT);
  const p = v.players[1]; assert.equal(p.rover.stats.torque, p.base.torque * .5); assert.equal(p.rover.stats.topSpeed, p.base.topSpeed * .5);
  step(v, 4); assert.equal(p.effects.net, 0); assert.equal(p.rover.stats.topSpeed, p.base.topSpeed);
});

test('Geyser warns for .3 seconds, launches either player, slows them, drops treasure, and shields block', () => {
  for (const victim of [0, 1]) {
    const v = game('treasure'); flat(v); const p = v.players[victim];
    v.debug().placePlayer(victim, { x: 500, vx: 200 }); v.debug().placePlayer(1 - victim, { x: 900 });
    v.chest.carrier = victim; v.debug().giveItem(1 - victim, 'geyser'); v.useItem(1 - victim);
    assert.equal(p.effects.geyserWarning, .3); step(v, .29); assert(!(p.effects.geyser > 0)); step(v, .02);
    assert(p.effects.geyser > 0 && p.rover.vy < -200 && p.rover.vx < 160); assert.equal(v.chest.carrier, -1); assert.equal(v.chest.previous, victim);
    assert(Math.abs(p.rover.omega) < 1); assert(v.totals[1 - victim].itemsLanded === 1);
    v.debug().placePlayer(victim, { x: 500 }); p.effects.shield = 8;
    v.debug().giveItem(1 - victim, 'geyser'); v.useItem(1 - victim); assert(!(p.effects.geyserWarning > 0)); assert.equal(p.effects.shield, 0);
  }
  const r = rover(), a = rover(); r.grounded = true; a.grounded = false;
  AR.launchGeyser(r, 1, .4); AR.launchGeyser(a, .6, -.4);
  assert(Math.abs(a.vy / r.vy - .6) < 1e-10); assert.equal(r.omega, .4); assert.equal(a.omega, -.4);
  let airtime = 0;
  while (!r.grounded && airtime < 5) { r.step({}, DT); airtime += DT; }
  assert(airtime >= 1.5 && airtime <= 2.3, 'Geyser airtime: ' + airtime);
});

test('Riptide reverses actual inputs for five seconds and restores them on expiry', () => {
  const v = game(); flat(v); v.keys.add('ArrowRight'); v.debug().giveItem(0, 'riptide'); v.useItem(0);
  assert.equal(v.players[1].effects.riptide, 5); assert(v.controls(1).brake && !v.controls(1).throttle);
  step(v, 5.01); assert(v.controls(1).throttle && !v.controls(1).brake);
});

test('Sunken City bridges wait .6 seconds, form a climbable gap and never lose the ground collider', () => {
  const r = rover('city'), t = r.terrain, x = 2060;
  place(r, x, t.height(x) - 50); r.wheels.forEach(w => { w.y = t.height(w.x) - w.radius; w.grounded = true; });
  const before = t.height(x); t.stepWorld([r], DT); assert(t.bridges.has(0));
  t.stepWorld([], .59); assert.equal(t.height(x), before);
  t.stepWorld([], .02); assert.equal(t.height(x), before + 112);
  for (let n = 0; n < 300; n++) { r.step({}, DT); for (const w of r.wheels) assert(w.y + w.radius <= t.height(w.x) + 1); }
  assert(r.y > before && !r.crashed && r.grounded);
  const next = rover('city'); next.terrain.bridges = new Map(t.bridges); next.terrain.worldTime = t.worldTime;
  place(next, x, before - 50); for (let n = 0; n < 300; n++) next.step({}, DT);
  assert(next.y > before, 'Second arrival must fall into the existing gap');
});

test('Currents push all bodies without jitter and mud slows only inside its marked zone', () => {
  const r = rover('city'); place(r, 1100, r.terrain.height(1100) - 50);
  for (let n = 0; n < 120; n++) r.step({}, DT);
  assert(r.vx > 5 && !r.sleeping); assert(Math.abs(r.omega) < 1);
  const t = rover('thermal'); place(t, 1500, t.terrain.height(1500) - 50); t.step({}, DT); assert(t.environment.mud);
  place(t, 2100, t.terrain.height(2100) - 50); t.step({}, DT); assert(!t.environment.mud);
});

test('Whale ribs collide, bone ramps rise, and plankton grants a net +1 oxygen per second', () => {
  const r = rover('whale'), t = r.terrain;
  assert(Number.isFinite(t.ceiling(1250))); assert(t.height(1250) - t.ceiling(1250) < 240);
  place(r, 1250, t.ceiling(1250) + 43); r.vy = -20; r.step({}, DT); assert(r.y - 38 >= t.ceiling(r.x) - 2);
  const ramp = t.rampsBetween(900, 3000)[0]; assert(ramp && t.height(ramp.x) < t.height(ramp.x - 180));
  place(r, 2150, t.height(2150) - 65); r.oxygen = 30; const before = r.oxygen;
  r.step({}, DT); assert(r.environment.plankton); assert(Math.abs(r.oxygen - before - DT) < 1e-8);
});

test('Thermal vents erupt on four-second cycles; ballast doubles elevator acceleration without spending oxygen', () => {
  const r = rover('thermal'), t = r.terrain; place(r, 955, t.height(955) - 50); r.grounded = true;
  t.worldTime = 3.43; t.stepWorld([r], .01); assert.equal(r.vy, 0); t.stepWorld([r], .02); assert(r.vy < -290);
  const vy = r.vy; t.stepWorld([r], .01); assert.equal(r.vy, vy, 'One impulse per eruption');
  const a = rover('thermal'), b = rover('thermal'); for (const r of [a, b]) { place(r, 2510, r.terrain.height(2510) - 110); r.oxygen = 40; }
  a.step({}, DT); b.step({ burst: true }, DT); assert(b.vy < a.vy - 1); assert.equal(a.cooldown, b.cooldown); assert.equal(a.oxygen, b.oxygen);
});

test('Treasure pickup, crash steal, lockout, teleport and all carry targets produce one round win', () => {
  const v = game('treasure'); flat(v);
  v.debug().placePlayer(0, { x: 600 }); v.debug().placePlayer(1, { x: 1100 }); v.players.forEach(p => { p.startX = p.rover.x; }); v.chest.x = 600; v.chest.y = 384;
  v.updateChest(DT); assert.equal(v.chest.carrier, 0); step(v, DT); assert.equal(v.players[0].rover.stats.topSpeed, v.players[0].base.topSpeed * .88);
  v.debug().crashPlayer(0); assert.equal(v.chest.carrier, -1); assert.equal(v.chest.lock, 1);
  v.debug().placePlayer(0, { x: v.chest.x, y: v.chest.y - 30 }); v.updateChest(.1); assert.equal(v.chest.carrier, -1);
  v.debug().placePlayer(1, { x: v.chest.x, y: v.chest.y - 30 }); v.updateChest(.1); assert.equal(v.chest.carrier, 1); assert.equal(v.players[1].steals, 1);
  v.debug().placePlayer(1, { x: 4500 }); v.updateChest(.1); assert.equal(v.chest.carrier, -1); assert.equal(v.chest.x, (v.players[0].rover.x + 4500) / 2); assert.match(v.players[0].toast, /midpoint/);
  for (const target of [20, 30, 45]) {
    const round = game('treasure'); round.matchConfig.carryTarget = target; round.chest.carrier = 0;
    round.players[0].carryTime = target - DT; round.updateChest(DT);
    assert.equal(round.phase, 'ROUND_RESULT'); assert.equal(round.roundWinner, 0); assert.equal(round.scores[0], 1);
    assert.equal(round.totals[0].carryTime, target); round.endRound(0, 'again'); assert.equal(round.scores[0], 1);
  }
});

test('Sharks bite a 300 px/s driver within two encounters; an actual ballast jump or hard brake dodges', () => {
  function drive(dodge) {
    const r = rover(), t = r.terrain; t.height = () => 400; t.slope = () => 0; place(r, 2350, 349, 300);
    const h = new AR.WorldHazards(t), warnings = new Set(); let bites = 0, stop = 0;
    for (let n = 0; n < 1500; n++) {
      const warning = h.sharks.find(q => q.phase === 'warning' && !warnings.has(q.id));
      if (warning) { warnings.add(warning.id); if (dodge === 'brake') stop = 3; }
      const burst = !!warning && dodge === 'jump';
      const speed = stop > 0 ? 0 : 300; stop -= DT;
      r.vx = speed; r.wheels.forEach(w => { w.vx = speed; w.omega = speed / w.radius; });
      r.step({ burst }, DT); const before = r.oxygen; h.step([r], DT); if (r.oxygen < before - 1) bites++;
      if (warnings.size >= 2 && !h.sharks.some(q => q.phase === 'warning' || q.phase === 'lunge')) break;
    }
    return { bites, warnings: warnings.size, encounters: r.sharkEncounters || 0 };
  }
  const straight = drive('none'), jump = drive('jump'), brake = drive('brake');
  console.log({ straight, jump, brake });
  assert(straight.bites >= 1 && straight.warnings <= 2); assert.equal(jump.bites, 0); assert.equal(brake.bites, 0); assert(jump.encounters > 0);
});

test('Swept shark hit tests include the whole chassis and wheels; versus bites crash, shields intercept, fish only shove', () => {
  const r = rover(), h = new AR.WorldHazards(r.terrain); place(r, 2500, 349); r.savePrevious();
  assert(h.hit({ x: 2600, y: 370 }, 2400, 370, r)); assert(h.hit({ x: r.wheels[1].x, y: 395 }, r.wheels[1].x, 395, r));
  assert(!h.hit({ x: 2600, y: 200 }, 2400, 200, r));
  const v = game(), p = v.players[0]; p.effects.shield = 8; v.sharkHit(p.rover, { direction: 1 }); assert.equal(p.crashes, 0); assert.equal(p.effects.shield, 0);
  v.sharkHit(p.rover, { direction: 1 }); assert.equal(p.crashes, 1); assert.equal(p.crashReason, 'Shark bite'); assert.equal(p.respawn, 2.5);
  const fish = game('race', 'whale'), before = fish.players[0].rover.oxygen; fish.sharkHit(fish.players[0].rover, { direction: 1, fish: true }); assert.equal(fish.players[0].crashes, 0); assert.equal(fish.players[0].rover.oxygen, before);
});

test('Shark attack achievement uses the maximum survived in one run, survives save sanitization, and pays once', () => {
  const save = new AR.Save(); const finish = n => save.finishRun({ stageId: 'reef', vehicleId: 'rover', sharkEncounters: n });
  finish(3); finish(2); assert(!save.data.achievements.includes('shark-attack'));
  const done = finish(5); assert(done.newAchievements.some(a => a.id === 'shark-attack')); assert(save.data.achievements.includes('shark-attack'));
  assert(!finish(5).newAchievements.some(a => a.id === 'shark-attack'));
});
console.log('PASS Round 5 mechanics: ' + passed);
