'use strict';
const assert = require('node:assert/strict');

// Offline authoritative-host integration. Only presentation is stubbed; all
// controls, fixed steps, reliable events and lossy snapshots are production code.
global.window = global;
const elements = new Map();
global.document = {
  body: { dataset: {} },
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', focus() {} });
    return elements.get(id);
  }
};
for (const name of ['data', 'terrain', 'physics', 'contacts', 'versus', 'online-core', 'online']) require('../docs/' + name + '.js');
for (const name of ['buildUI', 'show', 'hud', 'setupUI', 'resultUI']) AR.Versus.prototype[name] = function () {};
const pass = name => console.log('PASS ' + name);
const sessions = [];

function game() {
  const tally = { p1Wins: 0, p2Wins: 0, matches: 0 };
  const save = { data: { versus: tally, settings: {} }, finishVersus(i) { tally.matches++; tally[i ? 'p2Wins' : 'p1Wins']++; }, save() {} };
  const sounds = [];
  const sound = { unlock() {}, suspend() {}, play(name) { sounds.push(name); }, update() {}, setMuted() {} };
  const v = new AR.Versus(save, sound, {}, () => {});
  v.testSounds = sounds;
  return v;
}

function session(mode = 'race', bestOf = 3, stage = 'reef') {
  const [ht, gt] = AR.LoopbackTransport.pair({ latency: 45, jitter: 20, loss: .2, seed: 37 });
  const host = new AR.Online(game(), { headless: true, now: () => ht.wire.now });
  const guest = new AR.Online(game(), { headless: true, now: () => ht.wire.now });
  const state = { ht, gt, host, guest, guestPhysics: 0 };
  state.pump = seconds => {
    for (let n = 0; n < Math.ceil(seconds * 120); n++) {
      ht.pump(1000 / 120); host.tick(AR.FIXED_DT); guest.tick(AR.FIXED_DT);
    }
  };
  host.attach('host', ht); guest.attach('guest', gt);
  host.state = guest.state = 'CONNECTING'; host.connected(); guest.connected();
  for (const method of ['step', 'collect', 'updateProjectiles', 'endRound']) {
    guest.v[method] = () => { state.guestPhysics++; throw new Error('Guest ran ' + method); };
  }
  state.pump(.5);
  assert.equal(host.state, 'LOBBY'); assert.equal(guest.state, 'LOBBY');
  host.configure('mode', mode); host.configure('bestOf', bestOf); host.configure('stage', stage);
  state.pump(.3);
  assert.deepEqual(guest.v.config, host.v.config);
  // A guest may choose its vehicle, but cannot replace the host's game mode.
  guest.configure('mode', mode === 'arena' ? 'race' : 'arena'); state.pump(.2);
  assert.equal(host.v.config.mode, mode); assert.equal(guest.v.config.mode, mode);
  host.ready(); guest.ready(); state.pump(.3);
  assert.deepEqual(host.v.ready, [true, true]); host.start(); state.pump(4.5);
  assert.equal(host.v.phase, 'RUNNING'); assert.equal(guest.v.phase, 'RUNNING');
  assert.deepEqual(guest.v.matchConfig, host.v.matchConfig);
  sessions.push(state);
  return state;
}

{
  const { host, guest, ht, pump } = session();
  const v = host.v;
  // Isolate one naturally shaped pickup site from other generated pickups.
  v.generatePickups = guest.v.generatePickups = () => {};
  v.hazards = guest.v.hazards = null;
  const crate = { key: '0:crate', type: 'crate', x: 500, y: v.terrain.height(500) - 48, collected: false };
  v.pickups = [{ ...crate }]; guest.v.pickups = [{ ...crate }];
  v.rollItem = () => 'jet';
  const place = index => {
    v.debug().placePlayer(index, { x: crate.x, y: crate.y, oxygen: 100 });
    v.debug().placePlayer(1 - index, { x: crate.x + 350, oxygen: 100 });
  };
  place(0); v.collect(); const firstReady = v.crateCooldowns.get(crate.key)[0];
  assert.equal(firstReady, v.time + 2); assert.equal(v.players[0].item, 'jet');
  assert.equal(v.players[1].item, null); pump(.3);
  assert.equal(guest.v.players[0].item, 'jet');
  assert.equal(guest.v.crateCooldowns.get(crate.key)[0], firstReady);
  place(1); v.collect(); pump(.3);
  assert.equal(v.players[1].item, 'jet'); assert.equal(guest.v.players[1].item, 'jet');
  assert(v.time < firstReady, 'Trailing player must collect before the leader refill');
  assert.deepEqual(guest.v.crateCooldowns.get(crate.key), v.crateCooldowns.get(crate.key));
  assert(!v.collected.has(crate.key)); assert(!guest.v.collected.has(crate.key));
  assert(v.pickups.some(q => q.key === crate.key)); assert(guest.v.pickups.some(q => q.key === crate.key));
  const cooldown = [...v.crateCooldowns.get(crate.key)];
  const crateEvents = guest.metrics.events.crate;
  assert.equal(crateEvents, 2, 'Redundant event hints cannot replay crate pickups');
  pass('Host and trailing guest collect the same crate independently within two seconds under 20% state loss');

  host.pause(); pump(.3); const pausedAt = v.time; pump(.5);
  assert.equal(v.time, pausedAt); assert.deepEqual(v.crateCooldowns.get(crate.key), cooldown);
  assert.deepEqual(guest.v.crateCooldowns.get(crate.key), cooldown);
  // Full recovery must restore the ledger even when every previous event is gone.
  guest.v.crateCooldowns.clear(); ht.drop(); pump(1.5);
  assert.equal(host.state, 'MATCH'); assert.equal(guest.state, 'MATCH');
  assert.equal(v.phase, 'PAUSED'); assert.equal(guest.v.phase, 'PAUSED');
  assert.equal(v.time, pausedAt); assert.deepEqual(guest.v.crateCooldowns.get(crate.key), cooldown);
  host.resume(); pump(.2);
  place(0); v.players[0].item = null; v.players[0].charges = 0;
  v.time = firstReady - .01; v.collect(); assert.equal(v.players[0].item, null);
  v.time = firstReady + 1e-8; v.collect(); assert.equal(v.players[0].item, 'jet');
  const refilled = v.crateCooldowns.get(crate.key)[0]; pump(.3);
  assert.equal(guest.v.crateCooldowns.get(crate.key)[0], refilled);
  assert.equal(guest.metrics.events.crate, crateEvents + 1);
  const oldRound = v.round;
  v.endRound(0, 'Crate reset fixture'); pump(3.5);
  assert.equal(v.round, oldRound + 1); assert.equal(guest.v.round, v.round);
  assert.equal(v.crateCooldowns.size, 0); assert.equal(guest.v.crateCooldowns.size, 0);
  guest.receive({ type: 'delta', epoch: host.epoch, round: oldRound, pickups: [], events: [{ id: 100000, type: 'crate', key: crate.key, index: 0, readyAt: 999 }] });
  assert.equal(guest.v.crateCooldowns.size, 0, 'Delayed prior-round events must not cool new crates');
  pass('Crate timers freeze on pause, survive complete reconnect, refill at two seconds and reset between rounds');
}

{
  const { host, guest, pump } = session('race', 1, 'ice');
  const v = host.v;
  v.pickups = []; v.generatePickups = guest.v.generatePickups = () => {};
  v.hazards = guest.v.hazards = null;
  v.debug().placePlayer(0, { x: 100, oxygen: 100 });
  v.debug().placePlayer(1, { x: 550, oxygen: 100 });
  v.debug().giveItem(0, 'gravity'); v.debug().giveItem(1, 'jet');
  host.snapshot(); pump(.3);
  assert.equal(guest.v.players[0].item, 'gravity'); assert.equal(guest.v.players[1].item, 'jet');
  host.control('item', true); guest.control('item', true); pump(.4);
  assert.equal(v.players[0].itemsUsed, 1); assert.equal(v.players[1].itemsUsed, 1);
  assert.equal(guest.v.players[0].itemsUsed, 1); assert.equal(guest.v.players[1].itemsUsed, 1);
  assert(v.players[0].effects.gravity > 5); assert(guest.v.players[0].effects.gravity > 5);
  assert(v.players[1].effects.jet > 3); assert(guest.v.players[1].effects.jet > 3);
  assert.equal(guest.v.players[0].rover.gravityFlipped, true);
  assert.equal(guest.v.players[1].rover.jetThrust, v.players[1].rover.jetThrust);
  assert.equal(guest.v.players[1].rover.jetThrust, 240);
  host.control('item', false); guest.control('item', false);
  pump(.5); assert.equal(v.players[0].itemsUsed, 1); assert.equal(v.players[1].itemsUsed, 1);
  pass('Gravity Flip and Jet Drive slots, activation and effects reach the render-only guest without duplicate use');
}

{
  const { host, guest, pump } = session('arena', 1, 'volcanic');
  const v = host.v;
  assert.deepEqual(guest.v.terrain.arena, v.terrain.arena);
  assert.equal(v.remaining > 119, true); assert.equal(guest.v.remaining > 119, true);
  assert.equal(v.hazards, null); assert.equal(guest.v.hazards, null);
  assert.deepEqual(v.players.map(p => p.lives), [3, 3]);
  assert.deepEqual(guest.v.players.map(p => p.facing), v.players.map(p => p.facing));
  assert.equal(v.pickups.length, 0); assert.equal(guest.v.pickups.length, 0);
  const p = v.players[1], startY = p.rover.y;
  assert(AR.roverNearGround(p.rover));
  const jumpsBefore = v.testSounds.filter(s => s === 'burst').length;
  guest.control('burst', true); guest.control('item', true); pump(.3);
  assert(p.rover.y < startY - 25, 'Guest jump must lift the authoritative rover');
  assert(p.effects.jumpCooldown > 0); assert(guest.v.players[1].effects.jumpCooldown > 0);
  assert.equal(p.rover.oxygen, p.rover.maxOxygen);
  assert.equal(p.itemsUsed, 1); assert.equal(guest.v.players[1].itemsUsed, 1);
  const shot = v.projectiles.find(q => q.owner === 1);
  assert(shot); assert.equal(shot.type, 'bubble');
  assert(guest.v.projectiles.some(q => q.type === 'bubble' && q.owner === 1));
  guest.control('burst', false); guest.control('item', false); pump(1.2);
  assert.equal(p.itemsUsed, 1); assert.equal(v.testSounds.filter(s => s === 'burst').length, jumpsBefore + 1);
  assert.equal(host.inputs[1].usedB, 1); assert.equal(host.inputs[1].usedI, 1);
  assert.equal(guest.source.ackB, 1); assert.equal(guest.source.ackI, 1);
  pass('Host arena settings and three hull lives mirror to the guest; lossy jump/fire inputs execute once with free oxygen');

  v.projectiles = [];
  for (let hit = 1; hit <= 3; hit++) {
    // Symmetric points on the arena basin keep the two cannons at equal height.
    v.debug().placePlayer(0, { x: 350, oxygen: 100 });
    v.debug().placePlayer(1, { x: 550, oxygen: 100 });
    v.players[0].facing = 1;
    host.control('item', true); pump(.8); host.control('item', false);
    assert.equal(v.players[1].lives, 3 - hit, 'Actual travelling bubble must remove one hull');
    assert.equal(guest.v.players[1].lives, 3 - hit);
    assert.equal(v.totals[0].itemsLanded, hit);
    if (hit < 3) {
      assert(v.players[1].respawn > 0); assert(guest.v.players[1].respawn > 0);
      assert.equal(guest.v.players[1].rover.crashed, 'Bubble hit');
      pump(3);
      assert.equal(v.players[1].respawn, 0); assert.equal(guest.v.players[1].respawn, 0);
      assert.equal(v.players[1].rover.oxygen, v.players[1].rover.maxOxygen);
    }
  }
  assert(v.players[1].out); assert(guest.v.players[1].out);
  assert.equal(v.phase, 'ROUND_RESULT'); assert.equal(guest.v.phase, 'ROUND_RESULT');
  assert.equal(v.roundWinner, 0); assert.equal(guest.v.roundWinner, 0);
  assert.equal(guest.metrics.hitEvents, 3);
  pump(3.5);
  assert.equal(v.phase, 'MATCH_RESULT'); assert.equal(guest.v.phase, 'MATCH_RESULT');
  assert.deepEqual(v.save.data.versus, { p1Wins: 1, p2Wins: 0, matches: 1 });
  assert.deepEqual(guest.v.save.data.versus, v.save.data.versus);
  host.publishPhase(); pump(.3); assert.equal(guest.v.save.data.versus.matches, 1);
  pass('Three real slow bubble hits replicate damage, protected respawns, elimination and exactly-once arena results');

  // Exercise the largest bounded world state together, rather than separately
  // testing projectiles and sharks with unrealistically empty snapshots.
  v.projectiles = Array.from({ length: 15 }, (_, id) => ({ id: id + 1, type: ['bubble', 'anchor', 'torpedo'][id % 3], owner: id % 2, x: 400 + id * 20, y: 250, direction: id % 2 ? -1 : 1, life: 3 }));
  v.hazards = { sharks: Array.from({ length: 6 }, (_, id) => ({ id: id + 7, x: 420 + id * 30, y: 230, phase: ['patrol', 'warning', 'lunge', 'recover'][id % 4], direction: id % 2 ? -1 : 1, timer: 1.2 })) };
  v.players[0].facing = -1; v.players[0].effects.gravity = 6; v.players[0].effects.jet = 4;
  v.players[0].effects.fireCooldown = .8; v.players[0].effects.jumpCooldown = 1;
  const bytes = AR.OnlineCore.Codec.encode(v, 99999, host.now(), host.epoch, { b: 7, i: 9 }, {
    pickups: Array.from({ length: 30 }, (_, i) => i + ':pearl'),
    events: Array.from({ length: 30 }, (_, i) => ({ id: i + 100, type: 'toast', text: 'A long event to exercise bounded redundant state hints.' }))
  });
  assert(bytes.byteLength < 600); assert.equal(new Uint8Array(bytes)[0], 4);
  const decoded = AR.OnlineCore.Codec.decode(bytes);
  assert.equal(decoded.projectiles.length, 12); assert(decoded.sharks.length >= 2 && decoded.sharks.length <= 4);
  assert.deepEqual(decoded.projectiles.slice(0, 3).map(q => q.type), ['bubble', 'anchor', 'torpedo']);
  assert.deepEqual(decoded.sharks, decoded.sharks.map(d => { const q = v.hazards.sharks.find(q => q.id === d.id); return { ...q, aimX: q.x + q.direction * 600, aimY: q.y, fish: false }; }));
  assert.equal(decoded.players[0].facing, -1);
  assert.equal(decoded.players[0].effects.gravity, 6); assert.equal(decoded.players[0].effects.jet, 4);
  assert.equal(decoded.players[0].effects.fireCooldown, .8); assert.equal(decoded.players[0].effects.jumpCooldown, 1);
  assert.deepEqual(decoded.ack, { b: 7, i: 9 });
  guest.v.hazards = { sharks: [] }; guest.applySnapshot(decoded);
  assert.deepEqual(guest.v.hazards.sharks, decoded.sharks);
  assert.equal(guest.v.players[0].facing, -1); assert.equal(guest.v.players[0].rover.gravityFlipped, true);
  const wrongVersion = bytes.slice(0); new Uint8Array(wrongVersion)[0] = 1;
  assert.throws(() => AR.OnlineCore.Codec.decode(wrongVersion), /version mismatch/);
  pass('Version 4 snapshots keep 12 mixed projectiles, four sharks, facing and every new timer below 600 bytes');
}

for (const { host, guest, guestPhysics } of sessions) {
  assert.equal(guestPhysics, 0); assert.equal(host.metrics.invalidPackets, 0); assert.equal(guest.metrics.invalidPackets, 0);
  assert(host.metrics.maxBytes < 600); assert(guest.metrics.maxBytes < 600);
}
pass('All player-feature online sessions retain host-only simulation and report zero invalid packets');
