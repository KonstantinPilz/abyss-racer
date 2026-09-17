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
  const { host, guest, ht, pump } = session('treasure', 1, 'city'); const v = host.v;
  assert.equal(guest.v.config.carryTarget, 30);
  for (const p of guest.v.players) p.rover.step = () => { throw new Error('Guest simulated rover'); };
  guest.v.terrain.stepWorld = () => { throw new Error('Guest simulated stage'); };
  v.debug().placePlayer(0, { x: 2400 }); v.debug().placePlayer(1, { x: 2060 });
  v.players[1].rover.wheels.forEach(w => { w.y = v.terrain.height(w.x) - w.radius; w.grounded = true; });
  pump(.8); assert(v.terrain.bridges.has(0)); assert(guest.v.terrain.bridges.has(0));
  assert.equal(v.terrain.height(2060), guest.v.terrain.height(2060));
  assert.equal(guest.metrics.events.collapse, 1);
  v.debug().giveItem(0, 'riptide'); v.useItem(0); pump(.2);
  assert(guest.v.players[1].effects.riptide >= 4.7);
  v.debug().giveItem(0, 'geyser'); v.useItem(0); pump(.16);
  assert(guest.v.players[1].effects.geyserWarning > 0); pump(.4);
  assert(guest.v.players[1].effects.geyser > 0); assert(guest.v.players[1].rover.vy < 0);
  assert(Math.abs(v.players[1].geyserX - guest.v.players[1].geyserX) < .1);
  assert(guest.v.testSounds.includes('geyser'));
  pass('Lossy guest receives five-second riptide, geyser warning/column/impulse, sound and collapsing bridge state');
  v.debug().placePlayer(0, { x: 600 }); v.debug().placePlayer(1, { x: 1100 }); v.chest.x = 600; v.chest.y = v.terrain.height(600) - 16; v.chest.carrier = -1;
  pump(.3); assert.equal(guest.v.chest.carrier, 0);
  pump(1); assert(guest.v.players[0].carryTime > 1);
  v.debug().crashPlayer(0); pump(.25); assert.equal(guest.v.chest.carrier, -1); assert.equal(guest.v.chest.previous, 0); assert(guest.v.chest.lock > 0);
  v.debug().placePlayer(1, { x: v.chest.x, y: v.chest.y - 30 }); pump(.3);
  assert.equal(guest.v.chest.carrier, 1); assert.equal(guest.v.players[1].steals, 1);
  v.debug().placePlayer(0, { x: 5000 }); pump(.3);
  assert.equal(guest.v.chest.carrier, -1); assert(Math.abs(guest.v.chest.x - (v.players[0].rover.x + v.players[1].rover.x) / 2) < 10);
  pass('Guest receives chest pickup, timers, steal, lockout and midpoint teleport without simulating physics');
  host.pause(); pump(.3); const time = v.time;
  guest.v.terrain.bridges.clear(); guest.v.chest = null; ht.drop(); pump(1.5);
  assert.equal(v.time, time); assert.equal(guest.v.phase, 'PAUSED'); assert(guest.v.terrain.bridges.has(0)); assert(guest.v.chest);
  assert.equal(v.terrain.height(2060), guest.v.terrain.height(2060)); host.resume(); pump(.2);
  v.debug().placePlayer(0, { x: 600 }); v.debug().placePlayer(1, { x: 1100 });
  v.chest.carrier = 1; v.players[1].carryTime = 29.99; pump(3.6);
  assert.equal(v.phase, 'MATCH_RESULT'); assert.equal(guest.v.phase, 'MATCH_RESULT'); assert.equal(guest.v.totals[1].carryTime, 30);
  assert.equal(guest.v.players[1].steals, 1); assert.equal(guest.v.save.data.versus.p2Wins, 1); assert.equal(guest.v.save.data.versus.matches, 1);
  pass('Reconnect restores complete collapse/chest state; Treasure Tug results and tally are delivered exactly once');
}
for (const stage of ['thermal', 'whale', 'wreck', 'abyss']) {
  const { host, guest, pump } = session('race', 1, stage), v = host.v;
  const x = stage === 'thermal' ? 955 : stage === 'whale' ? 2150 : 2750;
  v.debug().placePlayer(0, { x: x + 300 }); v.debug().placePlayer(1, { x });
  if (stage === 'thermal') { v.time = v.terrain.worldTime = 3.4; pump(.35); assert(guest.v.players[1].effects.geyser > 0); }
  else if (stage === 'whale') { pump(.3); assert(guest.v.players[1].rover.environment.plankton); }
  else { pump(.3); assert(guest.v.hazards.sharks.some(q => q.phase === 'warning')); const shark = guest.v.hazards.sharks.find(q => q.phase === 'warning'); assert(Number.isFinite(shark.aimX + shark.aimY)); }
  assert(Math.abs(guest.v.terrain.worldTime - v.terrain.worldTime) < .3);
}
pass('Natural vent clocks, plankton fields and new-stage shark warning paths arrive on the guest');
for (const state of sessions) {
  assert.equal(state.guestPhysics, 0); assert.equal(state.host.metrics.invalidPackets, 0); assert.equal(state.guest.metrics.invalidPackets, 0);
  assert(state.host.metrics.maxBytes <= 1200);
}
console.log('PASS Round 5 online: ' + sessions.length + ' lossy sessions');
