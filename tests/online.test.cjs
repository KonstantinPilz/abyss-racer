'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
global.window = global;
const elements = new Map();
global.document = { body: { dataset: {} }, getElementById(id) { if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', focus() {} }); return elements.get(id); } };
for (const name of ['data', 'terrain', 'physics', 'contacts', 'versus', 'online-core', 'qr', 'online']) require('../docs/' + name + '.js');
const { InputSource, InputReceiver, SnapshotBuffer, EventLedger, ConnectionWatch, Codec } = AR.OnlineCore;
const pass = s => console.log('PASS ' + s);
const source = new InputSource(), receiver = new InputReceiver();
source.throttle = true; receiver.receive(source.packet(0), 100);
assert.equal(receiver.held(499).throttle, true); assert.equal(receiver.held(500).throttle, false);
source.release(); receiver.receive(source.packet(2), 510); assert.equal(receiver.held(510).throttle, false);
source.edge('burst'); source.edge('item'); const lost = source.packet(3); source.edge('burst');
receiver.receive(source.packet(4), 520); assert.deepEqual(receiver.edges(), { burst: true, item: true });
assert.equal(receiver.receive(lost, 521), false); assert.deepEqual(receiver.edges(), { burst: true, item: false }); assert.deepEqual(receiver.edges(), { burst: false, item: false });
source.acknowledge(receiver.usedB, receiver.usedI); assert.equal(source.packet(5).burst, false); assert.equal(source.packet(6).item, false);
source.acknowledge(0, 0); source.edge('item'); assert.equal(source.packet(7).item, true);
pass('Input hold/release at 400 ms; lost, reordered and repeated packets preserve each edge once');
const ledger = new EventLedger(), delivered = [];
for (const id of [3, 1, 3, 2, 1, 4, 4]) ledger.receive({ id }, e => delivered.push(e.id));
assert.deepEqual(delivered, [3, 1, 2, 4]); assert.equal(ledger.floor, 4); assert.equal(ledger.seen.size, 0);
pass('Events delivered exactly once despite redundant hints and reordering');
const watch = new ConnectionWatch(0); watch.drop(100); watch.drop(5000); assert.equal(watch.poll(15099), 'reconnecting'); assert.equal(watch.poll(15100), 'abandoned'); assert.equal(watch.recover(15101), false);
const recovered = new ConnectionWatch(0); recovered.drop(100); assert.equal(recovered.recover(14900), true); assert.equal(recovered.poll(20000), 'connected');
pass('Reconnect deadline cannot extend; recovery before 15 seconds clears the deadline');
for (const vector of JSON.parse(fs.readFileSync(__dirname + '/fixtures/qr-vectors.json'))) {
 const qr = AR.QR.encode(vector.text, vector.mask);
 assert.equal(qr.version, vector.version); assert.deepEqual(qr.words, vector.words);
 assert.deepEqual(qr.modules.map(row => row.map(Number).join('')), vector.modules);
 assert.equal(AR.QR.encode(vector.text).size, qr.size);
}
assert.throws(() => AR.QR.encode('a'.repeat(63)));
pass('QR v1–4/M byte data, block interleaving, EC, format, mask and every module match independent python-qrcode vectors');
for (const method of ['buildUI', 'show', 'hud', 'setupUI', 'resultUI']) AR.Versus.prototype[method] = function () {};
function game() {
 const tally = { p1Wins: 0, p2Wins: 0, matches: 0 };
 const save = { data: { versus: tally, settings: {} }, finishVersus(i) { tally.matches++; tally[i ? 'p2Wins' : 'p1Wins']++; }, save() {} };
 const sound = { unlock() {}, suspend() {}, play() {}, update() {}, setMuted() {} };
 return new AR.Versus(save, sound, {}, () => {});
}
const [ht, gt] = AR.LoopbackTransport.pair({ latency: 45, jitter: 20, loss: .2 });
const host = new AR.Online(game(), { headless: true, now: () => ht.wire.now }), guest = new AR.Online(game(), { headless: true, now: () => ht.wire.now });
host.attach('host', ht); guest.attach('guest', gt); host.state = guest.state = 'CONNECTING'; host.connected(); guest.connected();
let guestPhysics = 0; guest.v.step = () => { guestPhysics++; throw new Error('Guest simulated physics'); };
function pump(seconds) { for (let i = 0; i < Math.ceil(seconds * 120); i++) { ht.pump(1000 / 120); host.tick(1 / 120); guest.tick(1 / 120); } }
pump(.5); assert.equal(host.state, 'LOBBY'); assert.equal(guest.state, 'LOBBY'); assert(host.protocolReady && guest.protocolReady);
host.configure('bestOf', 1); pump(.2); guest.configure('vehicle', 'crab'); pump(.2); assert.equal(host.v.config.vehicles[1], 'crab');
host.ready(); guest.ready(); pump(.2); assert.deepEqual(host.v.ready, [true, true]);
host.start(); pump(.5); assert.equal(guest.v.phase, 'COUNTDOWN'); assert.equal(guest.v.terrain.seed, host.v.terrain.seed);
pump(4); assert.equal(host.v.phase, 'RUNNING'); assert.equal(guest.v.phase, 'RUNNING');
const starts = host.v.players.map(p => p.rover.x);
host.control('throttle', true); guest.control('throttle', true);
const beforeRates = { snapshots: host.metrics.snapshots, inputs: guest.source.seq };
pump(3);
const rates = { snapshotsHz: (host.metrics.snapshots - beforeRates.snapshots) / 3, inputHz: (guest.source.seq - beforeRates.inputs) / 3 };
assert(rates.snapshotsHz >= 19.5 && rates.snapshotsHz <= 20.5); assert(rates.inputHz >= 29.5 && rates.inputHz <= 30.5);
assert(host.v.players.every((p, i) => p.rover.x > starts[i] + 40)); assert.equal(guestPhysics, 0);
assert.deepEqual([...guest.v.collected].sort(), [...host.v.collected].sort());
pass('Headless host + render-only guest: mirrored lobby, ready, countdown, two moving rovers and shared pickups under 20% state loss');
const b = new SnapshotBuffer(); const snap = Codec.decode(Codec.encode(host.v, 10, 1000, 1));
for (let i = 0; i < 8; i++) { const s = structuredClone(snap); s.seq += i; s.t += i * 50; s.players.forEach(p => { p.rover.x = i * 10; p.rover.vx = 200; p.rover.wheels.forEach(w => { w.x = i * 10; }); }); b.push(s, s.t + 40 + (i % 2) * 15); }
let last = -Infinity; for (let now = 1000; now < 2000; now += 5) { const x = b.sample(now).players[0].rover.x; assert(x >= last); last = x; }
assert(last <= 100.001); assert.equal(b.push(snap, 2001), false);
pass('100 ms interpolation is monotonic with jitter; extrapolation stops after 150 ms; old poses rejected');
host.control('throttle', false); guest.control('throttle', false);
host.v.debug().placePlayer(0, { x: 100, oxygen: 100 }); host.v.debug().placePlayer(1, { x: 300, oxygen: 100 });
host.v.debug().giveItem(0, 'ink'); host.control('item', true); pump(.4); assert(guest.metrics.hitEvents > 0); const count = guest.metrics.hitEvents;
const hit = host.journal.find(e => e.type === 'hit'); if (hit) { guest.applyEvent(hit); guest.applyEvent(hit); }
assert.equal(guest.metrics.hitEvents, count);
guest.v.generatePickups(); const key = guest.v.pickups[0].key; host.v.collected.add(key); host.snapshot(); pump(.3); assert(guest.v.collected.has(key)); assert(!guest.v.pickups.some(p => p.key === key));
guest.v.generated.clear(); guest.v.generatePickups(); assert(!guest.v.pickups.some(p => p.key === key));
pass('Item-hit effects exactly once and collected pickups stay removed across regeneration');
guest.pause(); pump(.3); assert.equal(host.v.phase, 'PAUSED'); assert.equal(guest.v.phase, 'PAUSED'); const oxygen = host.v.players[0].rover.oxygen; pump(.5); assert.equal(host.v.players[0].rover.oxygen, oxygen); guest.resume(); pump(.2); assert.equal(host.v.phase, 'RUNNING');
ht.drop(); assert.equal(host.state, 'RECONNECTING'); assert.equal(host.v.phase, 'PAUSED'); pump(.8); // loopback reconnect() restores both ends; sync must complete before sim resumes
pump(.5); assert.equal(host.state, 'MATCH'); assert.equal(guest.state, 'MATCH'); assert.equal(host.v.phase, 'RUNNING'); assert.deepEqual([...guest.v.collected].sort(), [...host.v.collected].sort());
pass('Shared pause and reconnect restore paused authoritative world before resuming');
// A delivery must reach the guest through the existing snapshot/event channels,
// and the guest's ordinary item input must consume it exactly once under loss.
const oldHeight = host.v.terrain.height, oldSlope = host.v.terrain.slope, oldGenerate = host.v.generatePickups;
host.v.terrain.height = () => 400; host.v.terrain.slope = () => 0;
host.v.pickups = []; host.v.generatePickups = () => {};
host.control('item', false); guest.control('item', false);
host.v.players.forEach((p, i) => {
 host.v.debug().placePlayer(i, { x: p.startX + (i ? 0 : 800), oxygen: 100 });
 p.item = null; p.charges = 0; p.catchupWait = 0; p.catchupCooldown = 0;
});
pump(5.5); assert.equal(host.v.players[1].item, null);
pump(.8); assert.equal(host.v.players[1].item, 'turbo'); assert.equal(guest.v.players[1].item, 'turbo');
assert.equal(guest.v.players[1].charges, 1); assert.match(guest.v.players[1].toast, /catch-up Turbo Current/);
assert.equal(host.v.players[0].item, null); const usedBefore = host.v.players[1].itemsUsed;
guest.control('item', true); pump(.5);
assert.equal(host.v.players[1].itemsUsed, usedBefore + 1); assert.equal(guest.v.players[1].item, null);
assert(guest.v.players[1].effects.turbo > 0); assert.equal(guestPhysics, 0);
guest.control('item', false);
host.v.terrain.height = oldHeight; host.v.terrain.slope = oldSlope; host.v.generatePickups = oldGenerate;
pass('Automatic catch-up Turbo reaches the guest and fires exactly once through normal controls under 20% loss');
host.v.debug().placePlayer(0, { x: host.v.players[0].startX + 5010, oxygen: 100 }); pump(.3); assert.equal(host.v.phase, 'ROUND_RESULT'); assert.equal(guest.v.phase, 'ROUND_RESULT'); pump(3.5);
assert.equal(host.v.phase, 'MATCH_RESULT'); assert.equal(guest.v.phase, 'MATCH_RESULT'); assert.equal(host.v.save.data.versus.matches, 1); assert.deepEqual(host.v.save.data.versus, guest.v.save.data.versus);
host.publishPhase(); pump(.3); assert.equal(guest.v.save.data.versus.matches, 1);
pass('Authoritative finish, round result, match result and exactly-once tallies on both devices');
host.returnLobby(); pump(.2); host.ready(); guest.ready(); pump(.2); host.start(); pump(4.4); ht.drop(); ht.reconnect = gt.reconnect = () => {}; pump(15.1);
assert.equal(host.state, 'ERROR'); assert.equal(guest.state, 'ERROR'); assert(host.abandoned && guest.abandoned); assert.equal(host.v.save.data.versus.matches, 1); assert.equal(guest.v.save.data.versus.matches, 1);
pass('Unrecovered connection abandons both devices at 15 seconds without saving an unfinished match');
assert(host.metrics.maxBytes < 600); assert.equal(guest.metrics.invalidPackets, 0); assert.equal(host.metrics.invalidPackets, 0);
console.log('METRICS ' + JSON.stringify({ meanSnapshotBytes: Math.round(host.metrics.bytes / host.metrics.snapshots), maxSnapshotBytes: host.metrics.maxBytes, snapshots: host.metrics.snapshots, loopbackRTT: host.metrics.rtts, guestPhysicsSteps: guestPhysics, rates }));
