'use strict';
const assert = require('node:assert/strict');
global.window = global;
global.crypto ||= require('node:crypto').webcrypto;
const elements = new Map();
global.document = { body: { dataset: {} }, getElementById(id) { if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', focus() {} }); return elements.get(id); } };
for (const name of ['data', 'terrain', 'physics', 'contacts', 'save', 'versus', 'online-core', 'online-transport', 'online']) require('../docs/' + name + '.js');
require('./helpers/phone-wire.cjs');
for (const name of ['buildUI', 'show', 'hud', 'setupUI', 'resultUI']) AR.Versus.prototype[name] = function () {};
const pass = s => console.log('PASS ' + s);
(async () => {
  // Ground overtakes keep independent hysteresis for every pair.
  const terrain = new AR.Terrain(AR.STAGES[0]); terrain.height = () => 400; terrain.slope = () => 0;
  const rovers = [0, 1, 2].map(() => new AR.Rover(terrain, AR.getStats('rover', {})));
  for (const r of rovers) { for (let i = 0; i < 400; i++) r.step({}, AR.FIXED_DT); }
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.equal(AR.resolveRoverContacts(rovers[i], rovers[j]).contacts, 0);
  assert(rovers.every(r => r.ghostPeers.size === 2));
  AR.clearRoverGhosting(rovers[2]); assert.equal(rovers[0].ghostPeers.size, 1); assert.equal(rovers[1].ghostPeers.size, 1); assert(!rovers[2].ghosting);
  const saved = new AR.Save(); saved.finishVersus(2, 3);
  assert.deepEqual(saved.data.versus.trio, { wins: [0, 0, 1], matches: 1 });
  for (const i of [-1, 3, '2', null]) assert.equal(saved.finishVersus(i, 3), false);
  pass('Three-way ground overtakes keep pairwise ghosting; third-player wins and invalid tally inputs are isolated');
  const wire = makePhoneWire(); global.Peer = wire.Peer;
  const games = [];
  const make = () => {
    const sound = { unlock() {}, suspend() {}, play() {}, update() {}, setMuted() {} };
    const v = new AR.Versus(new AR.Save(), sound, {}, () => {});
    const n = new AR.Online(v, { headless: true, now: () => wire.now }); games.push(n); return n;
  };
  const host = make(), g1 = make(), g2 = make();
  const pump = seconds => { for (let i = 0; i < Math.ceil(seconds * 120); i++) { wire.pump(1000 / 120); for (const n of games) n.tick(AR.FIXED_DT); } };
  for (const [i, n] of games.slice(0, 2).entries()) { n.connect(i ? 'guest' : 'host', 'TEST'); await Promise.resolve(); n.transport.now = () => wire.now; }
  pump(.6);
  const healthyChannels = host.transport.channels;
  const halfJoined = new Peer('partial-guest'); wire.pump(2);
  const halfChannel = halfJoined.connect('abyss-TEST', { label: 'events', reliable: true, metadata: { protocol: 1, token: 'partial-test' } });
  pump(.2); assert.equal(host.transport.connected, false);
  pump(15.2); assert(halfChannel.closed); assert(host.transport.connected); assert.equal(host.transport.channels, healthyChannels);
  assert.equal(host.state, 'LOBBY'); halfJoined.destroy();
  g2.connect('guest', 'TEST'); await Promise.resolve(); g2.transport.now = () => wire.now;
  pump(1);
  for (const n of games) { assert.equal(n.state, 'LOBBY'); assert.equal(n.metrics.invalidPackets, 0); assert.equal(n.v.config.vehicles.length, 3); }
  assert.equal(g1.index, 1); assert.equal(g2.index, 2); assert(host.allReady());
  g1.configure('vehicle', 'crab'); g2.configure('vehicle', 'manta'); host.configure('bestOf', 1); pump(.3);
  assert.deepEqual(host.v.config.vehicles, ['rover', 'crab', 'manta']);
  host.ready(); g1.ready(); pump(.2); host.start(); assert.equal(host.state, 'LOBBY', 'P3 must ready');
  g2.ready(); pump(.2); host.start(); pump(4.5);
  for (const n of games) assert.equal(n.v.phase, 'RUNNING');
  const starts = host.v.players.map(p => p.rover.x);
  for (const g of [g1, g2]) { g.v.step = () => { throw new Error('Guest stepped physics'); }; g.v.terrain.stepWorld = () => { throw new Error('Guest advanced terrain'); }; }
  games.forEach(n => n.control('throttle', true)); pump(1.8); games.forEach(n => n.control('throttle', false));
  assert(host.v.players.every((p, i) => p.rover.x > starts[i] + 40));
  pass('Three real room controllers admit two guests, mirror independent rides and readiness, and drive all three rovers under 20% loss');
  const fourth = make(); fourth.connect('guest', 'TEST'); await Promise.resolve(); pump(.5); assert.equal(fourth.state, 'ERROR'); assert.match(fourth.error, /started|three divers/);
  games.pop();
  // No player can impersonate the other guest: transport-owned seat determines input.
  host.v.players.forEach((p, i) => host.v.debug().placePlayer(i, { x: 100 + i * 230, oxygen: 100 }));
  host.v.debug().giveItem(1, 'shield'); host.v.debug().giveItem(2, 'jet');
  g1.control('item', true); g2.control('item', true); pump(.3);
  assert(host.v.players[1].effects.shield > 0); assert(host.v.players[2].effects.jet > 0);
  assert.equal(host.v.players[1].itemsUsed, 1); assert.equal(host.v.players[2].itemsUsed, 1);
  assert.equal(g1.source.ackI, 1); assert.equal(g2.source.ackI, 1);
  host.v.debug().giveItem(0, 'riptide'); host.v.debug().placePlayer(2, { x: 160 }); host.v.useItem(0); pump(.2);
  assert(host.v.players[2].effects.riptide > 0); assert(!host.v.players[1].effects.riptide);
  assert(g1.v.players[2].effects.riptide > 0 && g2.v.players[2].effects.riptide > 0);
  pass('Independent edge acknowledgements, nearest-rival targeting and P3 effects reach both guests exactly once');
  // Saturated payload: P3 projectile owner cannot be confused with anchor type.
  host.v.projectiles = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, owner: i % 3, type: ['torpedo', 'anchor', 'bubble'][i % 3], x: 200 + i, y: 200, life: 2, direction: 1 }));
  const bytes = AR.OnlineCore.Codec.encode(host.v, 99, wire.now, host.epoch);
  const decoded = AR.OnlineCore.Codec.decode(bytes);
  assert.equal(decoded.players.length, 3); assert.equal(decoded.scores.length, 3); assert(bytes.byteLength <= 1200);
  assert.deepEqual(decoded.projectiles.map(q => [q.type, q.owner]), host.v.projectiles.map(q => [q.type, q.owner])); host.v.projectiles = [];
  pass('Protocol 4 preserves three poses, scores and all projectile ownership within the 1200-byte bound');
  // Brief hotspot stalls release held controls without tearing down channels.
  g2.control('throttle', true); pump(.1); const dials = wire.dials;
  wire.silent.add(g2.transport.peer.id); pump(3); assert.equal(host.state, 'MATCH'); assert.equal(host.controls(2).throttle, false);
  wire.silent.clear(); g2.control('throttle', false); pump(.4); assert.equal(wire.dials, dials);
  // A longer stall pauses, then syncs through the same working channels.
  wire.silent.add(g2.transport.peer.id); pump(5.5); assert.equal(host.state, 'RECONNECTING'); assert.equal(g1.v.phase, 'PAUSED');
  const frozen = host.v.time; pump(.3); assert.equal(host.v.time, frozen);
  wire.silent.clear(); pump(1.8); for (const n of games) assert.equal(n.state, 'MATCH');
  assert.equal(host.v.phase, 'RUNNING'); assert.equal(wire.dials, dials);
  pass('Hotspot congestion releases input at 400 ms, tolerates short stalls, and restores longer stalls without channel churn or reload');
  // Drop only P3; P2 channels must survive. Repeat to catch stale close handlers.
  for (let j = 0; j < 2; j++) {
    const healthy = host.transport.channels.events;
    g2.transport.channels.state.close(); assert.equal(host.state, 'RECONNECTING');
    pump(1.7); assert.equal(host.state, 'MATCH'); assert.equal(g2.state, 'MATCH'); assert.equal(host.transport.channels.events, healthy);
    assert.deepEqual([...g2.v.collected], [...host.v.collected]);
  }
  host.sendSync(2); // duplicate current recovery ID arriving after resumed play
  const resumedTime = host.v.time; pump(.3);
  assert.equal(g2.state, 'MATCH'); assert.equal(g2.v.phase, 'RUNNING'); assert(host.v.time > resumedTime);
  g2.pause(); pump(.3); assert.equal(host.v.phase, 'PAUSED');
  g2.transport.channels.events.close(); pump(1.7); assert.equal(host.v.phase, 'PAUSED', 'A user pause survives reconnect');
  g1.resume(); pump(.3); assert.equal(host.v.phase, 'RUNNING');
  pass('Repeated P3 reconnections retain its seat, leave P2 channels intact and preserve a deliberate pause');
  // Third racer wins and all devices save a separate trio tally exactly once.
  host.v.debug().placePlayer(2, { x: host.v.players[2].startX + 5010, oxygen: 100 }); pump(.2); assert.equal(host.v.roundWinner, 2); pump(3.5);
  for (const n of games) { assert.equal(n.v.phase, 'MATCH_RESULT'); assert.deepEqual(n.v.save.data.versus.trio, { wins: [0, 0, 1], matches: 1 }); assert.equal(n.v.save.data.versus.matches, 0); }
  host.publishPhase(); pump(.3); assert.equal(g2.v.save.data.versus.trio.matches, 1);
  assert.equal(g2.metrics.invalidPackets, 0); assert.equal(g1.metrics.invalidPackets, 0);
  pass('P3 wins, all three result screens agree, trio tallies save once and two-player rivalry stays unchanged');
  host.returnLobby(); pump(.3); assert.deepEqual(host.v.ready, [false, false, false]);
  // All existing modes accept three racers, including final-life and tie rules.
  for (const mode of ['pearl', 'survival', 'arena', 'treasure']) {
    host.configure('mode', mode); pump(.2); games.forEach(n => n.ready()); pump(.2); host.start(); pump(4.3);
    const v = host.v;
    if (mode === 'pearl') { v.players[2].pearls = 50; v.time = 90; }
    if (mode === 'survival') { v.players[0].lives = 1; v.players[0].rover.oxygen = 0; v.step(AR.FIXED_DT); assert.equal(v.phase, 'RUNNING'); v.players[1].lives = 1; v.players[1].rover.oxygen = 0; }
    if (mode === 'arena') { v.players[0].lives = 1; v.arenaHit(v.players[0], 'Bubble hit'); v.step(AR.FIXED_DT); assert.equal(v.phase, 'RUNNING'); v.players[1].lives = 1; v.arenaHit(v.players[1], 'Bubble hit'); }
    if (mode === 'treasure') { v.players.forEach((p, i) => v.debug().placePlayer(i, { x: 100 + i * 220 })); v.chest.carrier = 2; v.players[2].carryTime = 30; }
    v.step(AR.FIXED_DT); host.publishPhase(); pump(.2); assert.equal(v.roundWinner, 2, mode); assert.equal(g2.v.roundWinner, 2, mode);
    host.returnLobby(); pump(.2);
  }
  pass('Three-player Pearl Rush, Last Sub Standing, Bubble Battle and Treasure Tug all award P3 correctly');
  // Loss of either guest is bounded and never banks an unfinished race.
  host.configure('mode', 'race'); pump(.2); games.forEach(n => n.ready()); pump(.2); host.start(); pump(4.3);
  const tally = structuredClone(host.v.save.data.versus);
  wire.silent.add(g1.transport.peer.id); pump(21);
  assert.equal(host.state, 'ERROR'); assert(host.abandoned); assert.deepEqual(host.v.save.data.versus, tally);
  pass('A missing guest abandons after the bounded recovery window without saving a false result');
  games.forEach(n => n.transport.close());
})().catch(error => { console.error(error); process.exitCode = 1; });
