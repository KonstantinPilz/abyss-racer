'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Production controller and physics; only DOM presentation is replaced.
const elements = new Map();
const context = vm.createContext({ console, document: {
  body: { dataset: {} },
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', focus() {} });
    return elements.get(id);
  }
} });
vm.runInContext('globalThis.window = globalThis', context);
for (const name of ['data', 'terrain', 'physics', 'contacts', 'versus']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/' + name + '.js'), 'utf8'), context, { filename: name + '.js' });
}
const AR = context.AR, DT = AR.FIXED_DT;
for (const name of ['buildUI', 'show', 'hud', 'setupUI', 'resultUI']) AR.Versus.prototype[name] = function () {};
const plain = value => JSON.parse(JSON.stringify(value));
let count = 0;
function test(name, fn) { fn(); console.log('PASS ' + name); count++; }
function match(mode = 'race', stage = 'reef') {
  const save = { data: { versus: { p1Wins: 0, p2Wins: 0, matches: 0 } }, finishVersus() {} };
  const sound = { unlock() {}, suspend() {}, play() {}, update() {} };
  const v = new AR.Versus(save, sound, {}, () => {});
  Object.assign(v.config, { mode, stage, target: 2000 });
  v.active = true; v.startMatch(); v.phase = 'RUNNING';
  return v;
}
function advance(v, seconds) { for (let i = 0; i < Math.ceil(seconds / DT); i++) v.step(DT); }
function flat(v) {
  v.terrain.height = () => 470; v.terrain.slope = () => 0;
  v.terrain.ceiling = () => v.matchConfig.mode === 'arena' ? 40 : -Infinity;
  v.terrain.vent = () => 0; v.terrain.spring = () => 0;
  v.hazards = null;
}
function place(v, i, x, extra = {}) { assert(v.debug().placePlayer(i, { x, ...extra })); }
function freeze(p) { p.rover.step = function () { this.savePrevious(); }; }

test('Both divers independently collect one crate, refilling in two simulation seconds', () => {
  const v = match(); flat(v);
  for (let i = 0; i < 2; i++) place(v, i, 600);
  const q = { key: '0:crate', type: 'crate', x: 600, y: v.players[0].rover.y, collected: false };
  v.pickups = [q]; v.collect();
  assert(v.players.every(p => p.item && AR.VERSUS_ITEMS[p.item]));
  assert(!q.collected && !v.collected.has(q.key), 'Refill crates remain available to each diver');
  assert.deepEqual(plain(v.crateCooldowns.get(q.key)), [2, 2]);
  for (const p of v.players) p.item = null;
  v.time = 1.999; v.collect(); assert(v.players.every(p => !p.item));
  v.time = 2; v.collect(); assert(v.players.every(p => p.item));
  assert.deepEqual(plain(v.crateCooldowns.get(q.key)), [4, 4]);
});

test('A leader never blocks the rival, held items do not consume refills, and pearls remain shared', () => {
  const v = match(); flat(v); place(v, 0, 600); place(v, 1, 900);
  const q = { key: '0:crate', type: 'crate', x: 600, y: v.players[0].rover.y, collected: false };
  v.pickups = [q]; v.collect(); assert(v.players[0].item); assert(!v.players[1].item);
  place(v, 1, 600); v.collect(); assert(v.players[1].item, 'Trailer can collect immediately after leader');
  const ready = plain(v.crateCooldowns.get(q.key));
  v.time = 3; v.collect(); assert.deepEqual(plain(v.crateCooldowns.get(q.key)), ready);
  const pearl = { key: '0:pearl', type: 'pearl', x: 600, y: q.y, collected: false };
  v.pickups = [pearl]; v.collect(); v.collect();
  assert.equal(v.players.reduce((sum, p) => sum + p.pearls, 0), 5);
  assert(pearl.collected && v.collected.has(pearl.key));
});

test('Crate cooldown survives sector regeneration, freezes on pause, expires, and resets on rematch', () => {
  const v = match(); flat(v);
  const crate = v.pickups.find(q => q.type === 'crate');
  place(v, 0, crate.x, { y: crate.y }); v.collect();
  const ready = v.crateCooldowns.get(crate.key)[0]; assert(ready > 0);
  v.pickups = []; v.generated.clear(); v.generatePickups();
  assert(v.pickups.some(q => q.key === crate.key));
  v.players[0].item = null; v.collect(); assert(!v.players[0].item);
  v.pause(); const frozen = plain(v.inspect()); v.debug().advance(5);
  assert.deepEqual(plain(v.inspect()).versus.crateCooldowns, frozen.versus.crateCooldowns);
  assert.equal(v.time, frozen.versus.time);
  v.resume(); place(v, 0, 0); place(v, 1, -200); advance(v, 2.1);
  assert.equal(v.crateCooldowns.size, 0);
  v.crateCooldowns.set('test', [v.time + 2, 0]); v.startMatch();
  assert.equal(v.crateCooldowns.size, 0);
});

test('Crate refill state has a hard bound even when many sectors are visited in one simulation instant', () => {
  const v = match(); flat(v); place(v, 0, 500); place(v, 1, -500);
  for (let n = 0; n < 180; n++) {
    v.players[0].item = null;
    v.pickups = [{ key: n + ':crate', type: 'crate', x: 500, y: v.players[0].rover.y, collected: false }];
    v.collect();
  }
  assert(v.crateCooldowns.size <= 128);
  assert.equal(v.collected.size, 0, 'Refill history never enlarges the shared collectible ledger');
  v.pickups = []; v.time = 3; v.step(DT); assert.equal(v.crateCooldowns.size, 0);
});

test('Jet Drive accelerates both players in midair, follows reverse, expires, and clears on a crash', () => {
  for (const i of [0, 1]) {
    const v = match(); flat(v); place(v, i, 500, { y: -1000 }); place(v, 1 - i, -500);
    const p = v.players[i];
    assert(v.debug().giveItem(i, 'jet')); assert(v.useItem(i)); assert.equal(p.effects.jet, 4);
    v.keys.add(i ? 'ArrowRight' : 'KeyD'); advance(v, .4);
    assert(p.rover.vx > 55, 'Jet creates forward velocity with both wheels airborne');
    assert(p.rover.wheels.every(w => !w.grounded));
    place(v, i, 500, { y: -1000 }); v.keys.clear(); v.keys.add(i ? 'ArrowLeft' : 'KeyA');
    v.debug().giveItem(i, 'jet'); v.useItem(i); advance(v, .4);
    assert(p.rover.vx < -55, 'Jet also works when reversing');
    p.effects.jet = DT / 2; v.step(DT); assert.equal(p.rover.jetThrust, 0);
    v.debug().giveItem(i, 'jet'); v.useItem(i); v.crash(p); advance(v, 2.6);
    assert.equal(p.rover.jetThrust, 0); assert(!p.effects.jet);
  }
});

test('Gravity Flip turns and lifts either rover, freezes on pause, and restores ordinary gravity', () => {
  for (const i of [0, 1]) {
    const v = match(); flat(v); place(v, i, 500); place(v, 1 - i, -500);
    const p = v.players[i], beforeY = p.rover.y;
    v.debug().giveItem(i, 'gravity'); assert(v.useItem(i));
    assert(p.rover.gravityFlipped && p.rover.gravity() < 0);
    advance(v, .8);
    assert(p.rover.y < beforeY - 20); assert(Math.abs(Math.cos(p.rover.angle) + 1) < .2);
    assert(!p.rover.crashed && !p.respawn);
    const effect = p.effects.gravity; v.pause(); v.debug().advance(1);
    assert.equal(p.effects.gravity, effect); v.resume();
    advance(v, 5.3);
    assert(!p.rover.gravityFlipped && p.rover.gravity() > 0);
    assert(!p.rover.crashed && !p.respawn, 'The ceiling exit restores gravity safely');
  }
});

test('Bubble Battle keeps both players bounded, oxygen full, and cannons tied to drive direction', () => {
  const v = match('arena'); assert(v.terrain.arena); assert.equal(v.remaining, 120); assert.equal(v.pickups.length, 0);
  for (const i of [0, 1]) {
    place(v, i, i ? 1790 : 10, { vx: i ? 700 : -700 });
    v.players[i].rover.oxygen = 0;
  }
  v.step(DT);
  for (const p of v.players) {
    assert(p.rover.x > 30 && p.rover.x < 1770); assert.equal(p.lives, 3);
    assert.equal(p.rover.oxygen, p.rover.maxOxygen); assert(!p.catchup && !p.slipstream);
  }
  v.keys.add('KeyD'); v.keys.add('ArrowLeft'); v.step(DT);
  assert.deepEqual(plain(v.players.map(p => p.facing)), [1, -1]);
  assert(v.useItem(0) && v.useItem(1)); assert(!v.useItem(0) && !v.useItem(1));
  assert(v.projectiles.every(q => q.type === 'bubble'));
  const shots = v.projectiles.map(q => ({ x: q.x, y: q.y })); v.updateProjectiles(DT);
  for (let i = 0; i < 2; i++) {
    assert(Math.abs(v.projectiles[i].x - shots[i].x - (i ? -340 : 340) * DT) < 1e-7);
    assert.equal(v.projectiles[i].y, shots[i].y, 'No homing or gravity bends bubble shots');
  }
});

test('Arena cannon pause/reload limits projectiles and restart resets ammo, lives, timers, and hazards', () => {
  const v = match('arena'); flat(v); place(v, 0, 350, { y: 180 }); place(v, 1, 1450, { y: 350 });
  v.players.forEach(freeze); assert(v.useItem(0));
  v.pause(); const before = plain(v.inspect()); v.debug().advance(3);
  assert.deepEqual(plain(v.inspect()).versus.projectiles, before.versus.projectiles);
  assert.equal(v.players[0].effects.fireCooldown, before.players[0].effects.fireCooldown);
  assert(!v.useItem(1)); v.resume();
  advance(v, .81); assert(v.useItem(0));
  for (let i = 0; i < 20; i++) { advance(v, .81); v.useItem(0); }
  assert(v.projectiles.length <= 5, 'Lifetime and reload bound each cannon to five live bubbles');
  v.players[0].lives = 1; v.startMatch();
  assert(v.players.every(p => p.lives === 3 && !p.effects.fireCooldown));
  assert.equal(v.time, 0); assert.equal(v.remaining, 120); assert.equal(v.projectiles.length, 0);
  assert(!v.hazards && v.pickups.length === 0);
});

test('Either cannon needs three hits, shields prevent repeat hits, and each nonfatal hit respawns safely', () => {
  for (const attacker of [0, 1]) {
    const v = match('arena'); flat(v); const victim = 1 - attacker;
    for (const lives of [2, 1, 0]) {
      place(v, attacker, 400); place(v, victim, 900); v.players[attacker].facing = 1;
      v.players.forEach(freeze); assert(v.useItem(attacker));
      for (let i = 0; i < 240 && v.players[victim].lives > lives; i++) v.step(DT);
      assert.equal(v.players[victim].lives, lives);
      assert.equal(v.players[attacker].lives, 3);
      if (lives) {
        assert(!v.players[victim].out && v.players[victim].respawn > 0);
        advance(v, 1.21); assert(!v.players[victim].respawn && v.players[victim].effects.spawnShield > 0);
        const p = v.players[victim], shieldLives = p.lives;
        v.projectiles.push({ id: ++v.projectileSeq, type: 'bubble', owner: attacker, x: p.rover.x, y: p.rover.y, direction: 1, life: 4, nearest: 0 });
        v.updateProjectiles(DT); assert.equal(p.lives, shieldLives, 'Spawn shield blocks a camping shot');
      } else assert(v.players[victim].out);
    }
    assert.equal(v.phase, 'ROUND_RESULT'); assert.equal(v.roundWinner, attacker);
    assert.equal(v.totals[attacker].itemsLanded, 3);
    assert.equal(v.players[victim].blackouts, 0);
  }
});

test('A timed ballast jump actually dodges a straight bubble, recharges in one second, and costs no oxygen', () => {
  const v = match('arena'); flat(v); place(v, 0, 400); place(v, 1, 900);
  advance(v, .4); v.players[0].facing = 1; assert(v.useItem(0));
  advance(v, .85); const target = v.players[1], floorY = target.rover.y;
  v.pendingBurst[1] = true; v.step(DT); assert(target.effects.jumpCooldown > .99);
  assert(target.rover.vy < -220); assert.equal(target.rover.oxygen, target.rover.maxOxygen);
  advance(v, .75); assert(target.rover.y < floorY - 70);
  assert.equal(target.lives, 3); assert(v.totals[1].torpedoesDodged > 0);
  advance(v, .3); assert.equal(target.effects.jumpCooldown, 0);
});

test('Arena hull crashes cost one hit; timeout compares hull and equal hull replays without a point', () => {
  const v = match('arena');
  for (const lives of [2, 1, 0]) {
    assert(v.debug().crashPlayer(0)); assert.equal(v.players[0].lives, lives);
    if (lives) advance(v, 1.21);
  }
  v.step(DT); assert.equal(v.roundWinner, 1); assert.equal(v.players[0].crashes, 3);
  for (const [hull, winner] of [[[3, 2], 0], [[1, 3], 1], [[2, 2], -1]]) {
    const round = match('arena'); round.players.forEach((p, i) => { p.lives = hull[i]; freeze(p); });
    round.time = 120 - DT; round.step(DT);
    assert.equal(round.roundWinner, winner); assert.equal(round.remaining, 0);
    if (winner === -1) {
      assert.deepEqual(plain(round.scores), [0, 0]);
      for (let i = 0; i < 361; i++) round.tick(DT);
      assert.equal(round.phase, 'COUNTDOWN'); assert.equal(round.round, 2);
      assert(round.players.every(p => p.lives === 3));
    }
  }
});

console.log(count + ' player feature regressions passed.');
