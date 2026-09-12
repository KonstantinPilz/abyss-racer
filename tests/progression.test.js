'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sources = ['data.js', 'save.js', 'audio.js'].map(file => fs.readFileSync(path.join(__dirname, '..', 'docs', file), 'utf8'));
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { console.error('FAIL ' + name + ': ' + error.stack); process.exitCode = 1; }
}
function environment(initial = {}, blocked = false) {
  const records = new Map(Object.entries(initial));
  let writes = 0;
  const localStorage = {
    getItem(key) { if (blocked) throw new Error('storage disabled'); return records.get(key) || null; },
    setItem(key, value) { if (blocked) throw new Error('quota exceeded'); writes++; records.set(key, value); },
    removeItem(key) { if (blocked) throw new Error('storage disabled'); records.delete(key); }
  };
  const context = vm.createContext({ localStorage, console });
  sources.forEach((source, index) => vm.runInContext(source, context, { filename: ['data.js', 'save.js', 'audio.js'][index] }));
  return { AR: context.AR, context, records, get writes() { return writes; } };
}
const rawSave = object => ({ 'abyss-racer-save': JSON.stringify(object) });

test('fresh save has versioned canonical defaults and isolated vehicle upgrades', () => {
  const env = environment();
  const save = new env.AR.Save();
  assert.equal(save.data.version, 2);
  assert.equal(save.data.pearls, 0);
  assert.equal(save.data.level, 1);
  assert.deepEqual(Array.from(save.data.stages), ['reef']);
  assert.deepEqual(Array.from(save.data.vehicles), ['rover']);
  assert.equal(Object.keys(save.data.upgrades).length, 5);
  assert.equal(Object.keys(save.data.upgrades.rover).length, 6);
  save.data.upgrades.rover.engine = 2;
  assert.equal(save.data.upgrades.crab.engine, 0);
  assert.equal(save.save(), true);
  assert.equal(new env.AR.Save().data.upgrades.rover.engine, 2);
});

test('corrupt JSON, primitives, future schemas, and blocked storage fall back safely', () => {
  for (const text of ['{broken', 'null', '[]', '42', 'true', '"hello"', '{"version":999,"pearls":900}']) {
    const save = new (environment({ 'abyss-racer-save': text }).AR.Save)();
    assert.equal(save.data.pearls, 0);
    assert.equal(save.data.selectedStage, 'reef');
  }
  const env = environment({}, true);
  const save = new env.AR.Save();
  assert.equal(save.save(), false);
  assert.equal(save.storageAvailable, false);
  assert.doesNotThrow(() => save.finishRun({ distance: 120, pearls: 30 }));
  assert.equal(save.data.totalRuns, 1);
  assert.doesNotThrow(() => save.reset());
});

test('malformed fields are clamped and unknown IDs or prototype properties are discarded', () => {
  const input = {
    version: 2, pearls: -20, stages: ['reef', 'reef', 'ice', 'bogus', '__proto__'], vehicles: ['truck', 'truck'],
    selectedStage: 'bogus', selectedVehicle: 'bike', xp: '999999', level: 999,
    totalRuns: -30, totalDistance: 'Infinity', upgrades: { rover: { engine: 10000, oxygen: -3, tires: '4', thrust: 2.9 }, truck: [] },
    bests: { 'reef:rover': 250.5, 'reef:bike': -4, 'bogus:rover': 1000 },
    achievements: ['first-500', 'first-500', 'fake'],
    settings: { muted: 'true', headlight: 'ice', trail: 'plankton' }, totals: { pearls: -30, flips: '10', bursts: 4 }
  };
  const save = new (environment(rawSave(input)).AR.Save)();
  assert.equal(save.data.pearls, 0);
  assert.deepEqual(Array.from(save.data.stages), ['reef', 'ice']);
  assert.deepEqual(Array.from(save.data.vehicles), ['rover', 'truck']);
  assert.equal(save.data.selectedVehicle, 'rover');
  assert.equal(save.data.level, 1);
  assert.equal(save.data.upgrades.rover.engine, 12);
  assert.equal(save.data.upgrades.rover.oxygen, 0);
  assert.equal(save.data.upgrades.rover.tires, 0);
  assert.equal(save.data.upgrades.rover.thrust, 2);
  assert.equal(save.data.bests['reef:rover'], 250.5);
  assert.equal(save.data.bests['reef:bike'], 0);
  assert.equal(save.data.bests['bogus:rover'], undefined);
  assert.equal(save.data.settings.muted, false);
  assert.equal(save.data.settings.headlight, 'aqua');
  assert.equal(save.data.settings.trail, 'bubbles');
  assert.deepEqual(Array.from(save.data.achievements), ['first-500']);
  const malicious = new (environment({ 'abyss-racer-save': '{"version":1,"__proto__":{"pearls":9999},"upgrades":{"__proto__":{"engine":10}}}' }).AR.Save)();
  assert.equal(malicious.data.pearls, 0);
  assert.equal(malicious.data.upgrades.rover.engine, 0);
  assert.equal({}.engine, undefined);
});

test('v1 migration preserves unlocks, experience, mute, and stage-wide bests', () => {
  const env = environment({ 'abyss-racer': JSON.stringify({ version: 1, coins: 456, unlockedStages: ['reef', 'kelp'], unlockedVehicles: ['rover', 'crab'], experience: 1000, bestDistances: { reef: 620, kelp: 330 }, muted: true }) });
  const save = new env.AR.Save();
  assert.equal(save.data.pearls, 456);
  assert.equal(save.data.level, 3);
  assert.equal(save.data.bests['reef:rover'], 620);
  assert.equal(save.data.bests['kelp:rover'], 330);
  assert.equal(save.data.settings.muted, true);
  assert.equal(save.data.stages.includes('kelp'), true);
  save.save();
  assert.equal(JSON.parse(env.records.get(env.AR.SAVE_KEY)).version, 2);
  save.reset();
  assert.equal(env.records.has('abyss-racer'), false);
  assert.equal(new env.AR.Save().data.pearls, 0);
});

test('reset removes old progress even when writing the new default save fails', () => {
  const env = environment(Object.assign(rawSave({ version: 2, pearls: 900, totalRuns: 12 }), { 'abyss-racer': JSON.stringify({ version: 1, coins: 200 }) }));
  const save = new env.AR.Save();
  assert.equal(save.data.pearls, 900);
  env.context.localStorage.setItem = () => { throw new Error('quota exceeded'); };
  assert.doesNotThrow(() => save.reset());
  assert.equal(save.data.pearls, 0);
  assert.equal(save.storageAvailable, false);
  assert.equal(env.records.has(env.AR.SAVE_KEY), false);
  assert.equal(env.records.has('abyss-racer'), false);
  assert.equal(new env.AR.Save().data.totalRuns, 0);
  assert.equal(new env.AR.Save().data.pearls, 0);
});

test('purchases debit exact costs, reject invalid or repeated unlocks, and select new items', () => {
  const env = environment();
  const save = new env.AR.Save();
  assert.equal(save.buyStage('kelp'), false);
  assert.equal(save.buyVehicle('crab'), false);
  assert.equal(save.buyUpgrade('engine'), false);
  save.data.pearls = 10000;
  assert.equal(save.buyStage('kelp'), true);
  assert.equal(save.data.pearls, 10000 - env.AR.STAGES.find(s => s.id === 'kelp').cost);
  assert.equal(save.data.selectedStage, 'kelp');
  assert.equal(save.buyStage('kelp'), false);
  assert.equal(save.buyStage('__proto__'), false);
  const beforeVehicle = save.data.pearls;
  assert.equal(save.buyVehicle('crab'), true);
  assert.equal(save.data.pearls, beforeVehicle - env.AR.VEHICLES.find(v => v.id === 'crab').cost);
  assert.equal(save.data.selectedVehicle, 'crab');
  assert.equal(save.buyVehicle('crab'), false);
  const beforeUpgrade = save.data.pearls;
  assert.equal(save.buyUpgrade('engine'), true);
  assert.equal(save.data.pearls, beforeUpgrade - env.AR.upgradeCost('engine', 0));
  assert.equal(save.data.upgrades.crab.engine, 1);
  assert.equal(save.data.upgrades.rover.engine, 0);
  assert.equal(save.buyUpgrade('bogus'), false);
});

test('every upgrade reaches level 12 with escalating costs and stops there', () => {
  const env = environment();
  const save = new env.AR.Save();
  save.data.pearls = 1e7;
  for (const upgrade of env.AR.UPGRADES) {
    let previousCost = 0;
    for (let level = 0; level < 12; level++) {
      const cost = env.AR.upgradeCost(upgrade.id, level);
      assert.ok(cost > previousCost);
      const before = save.data.pearls;
      assert.equal(save.buyUpgrade(upgrade.id), true);
      assert.equal(save.data.pearls, before - cost);
      assert.equal(save.data.upgrades.rover[upgrade.id], level + 1);
      previousCost = cost;
    }
    const cappedBalance = save.data.pearls;
    assert.equal(save.buyUpgrade(upgrade.id), false);
    assert.equal(save.data.pearls, cappedBalance);
  }
});

test('finishing credits run, XP, level bonus, and achievements in one storage write', () => {
  const env = environment();
  const save = new env.AR.Save();
  const result = save.finishRun({ distance: 500, pearls: 250, flips: 1, maxFlips: 1, airtime: 10, chests: 1, golden: 1, bursts: 2, stageId: 'reef', vehicleId: 'rover', trickXP: 100 });
  assert.equal(env.writes, 1);
  assert.equal(result.xpGained, 620);
  assert.equal(result.levelUps, 1);
  assert.equal(result.levelBonus, 75);
  assert.equal(result.isBest, true);
  assert.equal(save.data.totalRuns, 1);
  assert.equal(save.data.totalDistance, 500);
  assert.equal(save.data.totals.pearls, 250);
  assert.equal(save.data.totals.flips, 1);
  assert.equal(save.data.bests['reef:rover'], 500);
  const achievementReward = result.newAchievements.reduce((sum, achievement) => sum + achievement.reward, 0);
  assert.equal(save.data.pearls, 250 + 75 + achievementReward);
  assert.equal(result.newCosmetics[0].id, 'amber');
  const previousBalance = save.data.pearls;
  assert.equal(save.checkAchievements().length, 0);
  assert.equal(save.data.pearls, previousBalance);
  assert.equal(env.writes, 1);
  const reloaded = new env.AR.Save();
  assert.equal(reloaded.data.pearls, previousBalance);
  const second = reloaded.finishRun({ distance: 250, pearls: 100, stageId: 'reef', vehicleId: 'rover', trickXP: 0 });
  assert.equal(second.isBest, false);
  assert.equal(second.newAchievements.length, 0);
  assert.equal(reloaded.data.bests['reef:rover'], 500);
  assert.equal(reloaded.data.totalRuns, 2);
  assert.equal(env.writes, 2);
});

test('stage×vehicle records stay distinct and unlock the ice and triple-flip achievements', () => {
  const env = environment();
  const save = new env.AR.Save();
  save.finishRun({ distance: 1100, stageId: 'ice', vehicleId: 'truck', maxFlips: 3, flips: 3, pearls: 100 });
  save.finishRun({ distance: 400, stageId: 'reef', vehicleId: 'bike', pearls: 30 });
  assert.equal(save.data.bests['ice:truck'], 1100);
  assert.equal(save.data.bests['reef:bike'], 400);
  assert.equal(save.data.bests['reef:rover'], undefined);
  assert.equal(save.data.achievements.includes('ice-cold'), true);
  assert.equal(save.data.achievements.includes('triple-backflip'), true);
  assert.equal(save.data.totals.maxFlips, 3);
  assert.ok(env.AR.ACHIEVEMENTS.length >= 12);
});

test('all achievement predicates work, reward once, and high XP unlocks cosmetic settings', () => {
  const env = environment();
  const save = new env.AR.Save();
  Object.assign(save.data, { totalRuns: 50, totalDistance: 25000, vehicles: env.AR.VEHICLES.map(v => v.id), stages: env.AR.STAGES.map(s => s.id) });
  Object.assign(save.data.bests, { 'reef:rover': 2500, 'ice:rover': 1000, 'abyss:rover': 500 });
  Object.assign(save.data.totals, { pearls: 5000, flips: 3, maxFlips: 3, chests: 10, golden: 5, airtime: 120, bursts: 50 });
  assert.equal(save.checkAchievements().length, env.AR.ACHIEVEMENTS.length);
  assert.equal(save.checkAchievements().length, 0);
  const xp = env.AR.xpForLevel(10);
  const unlocked = new (environment(rawSave({ version: 2, xp, settings: { headlight: 'ice', trail: 'plankton', muted: true } })).AR.Save)();
  assert.equal(unlocked.data.level, 10);
  assert.equal(unlocked.data.settings.headlight, 'ice');
  assert.equal(unlocked.data.settings.trail, 'plankton');
  assert.equal(unlocked.data.settings.muted, true);
  for (let level = 1; level <= 100; level++) {
    const atThreshold = new (environment(rawSave({ version: 2, xp: env.AR.xpForLevel(level) })).AR.Save)();
    assert.equal(atThreshold.data.level, level);
  }
});

test('nonfinite or malformed run summaries cannot poison progression', () => {
  const env = environment();
  const save = new env.AR.Save();
  save.finishRun({ distance: NaN, pearls: Infinity, flips: -10, airtime: 'Infinity', maxFlips: Infinity, trickXP: NaN, stageId: '__proto__', vehicleId: 'constructor' });
  assert.equal(save.data.totalDistance, 0);
  assert.equal(save.data.totals.pearls, 0);
  assert.equal(save.data.xp, 0);
  assert.equal(save.data.totals.flips, 0);
  assert.equal(save.data.totals.maxFlips, 0);
  assert.equal(save.data.bests['reef:rover'], 0);
  assert.doesNotThrow(() => save.finishRun(null));
  assert.equal(JSON.stringify(save.data).includes('null'), false);
});

test('audio is gesture-gated, works without WebAudio, and emits bounded disposable voices', () => {
  const env = environment();
  const unavailable = new env.AR.Audio();
  assert.doesNotThrow(() => { unavailable.play('click'); unavailable.update({ running: true }, 0.016); unavailable.setMuted(true); unavailable.unlock(); unavailable.suspend(); });
  let constructed = 0;
  const nodes = [];
  function parameter() { return { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} }; }
  function node() {
    const value = { frequency: parameter(), gain: parameter(), connect() {}, disconnect() { this.disconnected = true; }, start() {}, stop() {}, onended: null };
    nodes.push(value);
    return value;
  }
  env.context.AudioContext = class {
    constructor() { constructed++; this.state = 'running'; this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
    createGain() { return node(); }
    createBiquadFilter() { return node(); }
    createOscillator() { return node(); }
    createBufferSource() { return node(); }
    createBuffer(channels, length) { return { getChannelData() { return new Float32Array(length); } }; }
  };
  const audio = new env.AR.Audio();
  audio.play('click');
  assert.equal(constructed, 0);
  audio.unlock();
  audio.unlock();
  assert.equal(constructed, 1);
  for (const sound of ['click', 'pickup', 'gold', 'oxygen', 'chest', 'burst', 'crash', 'trick', 'level']) assert.doesNotThrow(() => audio.play(sound));
  for (let i = 0; i < 1000; i++) audio.play('pickup');
  assert.ok(audio.voices.size <= 28);
  assert.doesNotThrow(() => audio.update({ running: true, throttle: true, speed: 400, oxygenFraction: 0.1 }, 0.016));
  for (const voice of Array.from(audio.voices)) voice.onended();
  assert.equal(audio.voices.size, 0);
  audio.setMuted(true);
  audio.play('pickup');
  assert.equal(audio.voices.size, 0);
  assert.doesNotThrow(() => audio.suspend());
});

test('audio resumes browser interruptions and keeps pause, mute, and low-oxygen feedback consistent', () => {
  const env = environment();
  let resumeCalls = 0;
  let stoppedVoices = 0;
  function parameter() {
    return { value: 0, setValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; }, cancelScheduledValues() {} };
  }
  function node() {
    return { frequency: parameter(), gain: parameter(), connect() {}, disconnect() {}, start() {}, stop() { stoppedVoices++; }, onended: null };
  }
  env.context.AudioContext = class {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
    createGain() { return node(); }
    createBiquadFilter() { return node(); }
    createOscillator() { return node(); }
    createBufferSource() { return node(); }
    createBuffer(channels, length) { return { getChannelData() { return new Float32Array(length); } }; }
    resume() { resumeCalls++; this.state = 'running'; return { catch() {} }; }
  };
  const audio = new env.AR.Audio();
  audio.unlock();
  assert.equal(resumeCalls, 1);
  audio.update({ running: true, throttle: false, speed: 0, oxygenFraction: 0.24 }, 0.016);
  assert.ok(audio.engineGain.gain.value > 0);
  assert.equal(audio.voices.size, 2, 'heartbeat must accompany the HUD warning below 25% oxygen');
  const slowFrequency = audio.engine.frequency.value;
  audio.update({ running: true, throttle: true, speed: 450, oxygenFraction: 1 }, 0.016);
  assert.ok(audio.engine.frequency.value > slowFrequency);
  audio.suspend();
  assert.equal(audio.engineGain.gain.value, 0);
  assert.ok(stoppedVoices >= audio.voices.size);
  audio.update({ running: false, throttle: true, speed: 450, oxygenFraction: 0.1 }, 0.016);
  assert.equal(audio.engineGain.gain.value, 0);
  audio.context.state = 'interrupted';
  audio.unlock();
  assert.equal(resumeCalls, 2, 'Safari interrupted contexts should resume on the next gesture');
  audio.update({ running: true, throttle: true, speed: 100, oxygenFraction: 1 }, 0.016);
  assert.ok(audio.engineGain.gain.value > 0);
  audio.setMuted(true);
  assert.equal(audio.master.gain.value, 0);
  audio.setMuted(false);
  assert.ok(audio.master.gain.value > 0);
});

if (!process.exitCode) console.log('\nAll ' + passed + ' progression/audio tests passed.');
