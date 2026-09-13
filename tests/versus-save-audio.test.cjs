'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function environment(raw) {
  const records = new Map(raw ? [['abyss-racer-save', JSON.stringify(raw)]] : []);
  let writes = 0;
  const context = vm.createContext({
    localStorage: {
      getItem: key => records.get(key) || null,
      setItem(key, value) { writes++; records.set(key, value); },
      removeItem: key => records.delete(key)
    }
  });
  for (const file of ['data.js', 'save.js', 'audio.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs', file), 'utf8'), context, { filename: file });
  }
  return { context, AR: context.AR, get writes() { return writes; } };
}
const plain = value => JSON.parse(JSON.stringify(value));
const old = { version: 2, pearls: 702, totalRuns: 13, totalDistance: 7123, xp: 880, selectedStage: 'reef', selectedVehicle: 'rover', upgrades: { rover: { engine: 9 } }, bests: { 'reef:rover': 920 } };
const env = environment(old);
const save = new env.AR.Save();
assert.deepEqual(plain(save.data.versus), { p1Wins: 0, p2Wins: 0, matches: 0 });
const solo = plain(save.data);
delete solo.versus;
assert.deepEqual(plain(save.finishVersus(0)), { p1Wins: 1, p2Wins: 0, matches: 1 });
assert.deepEqual(plain(save.finishVersus(1)), { p1Wins: 1, p2Wins: 1, matches: 2 });
assert.equal(env.writes, 2, 'each finished match persists with one atomic write');
for (const invalid of [undefined, null, -1, 2, '1', NaN]) assert.equal(save.finishVersus(invalid), false);
assert.equal(env.writes, 2);
const after = plain(save.data);
delete after.versus;
assert.deepEqual(after, solo, 'versus cannot change any solo progress');
assert.deepEqual(plain(new env.AR.Save().data.versus), { p1Wins: 1, p2Wins: 1, matches: 2 });
assert.equal(new env.AR.Save().data.upgrades.rover.engine, 9);
for (const malformed of [null, [], 'bad', 12]) {
  assert.deepEqual(plain(new (environment({ version: 2, versus: malformed }).AR.Save)().data.versus), { p1Wins: 0, p2Wins: 0, matches: 0 });
}
const dirty = new (environment({ version: 2, versus: { p1Wins: -1, p2Wins: '2', matches: 3.9, injected: 700 } }).AR.Save)();
assert.deepEqual(plain(dirty.data.versus), { p1Wins: 0, p2Wins: 0, matches: 3 });
const capped = new (environment({ version: 2, versus: { p1Wins: 1e15, p2Wins: 7.8, matches: 1e15 } }).AR.Save)();
assert.deepEqual(plain(capped.finishVersus(0)), { p1Wins: 1e12, p2Wins: 7, matches: 1e12 });
save.reset();
assert.deepEqual(plain(new env.AR.Save().data.versus), { p1Wins: 0, p2Wins: 0, matches: 0 });
console.log('PASS versus tally migration, sanitization, isolated solo progression, persistence, counter caps, and reset');

let contexts = 0;
const oscillators = [];
function parameter() {
  return { value: 0, setValueAtTime(value) { this.value = value; }, exponentialRampToValueAtTime(value) { this.value = value; }, setTargetAtTime(value) { this.value = value; }, cancelScheduledValues() {} };
}
function node() {
  return { frequency: parameter(), gain: parameter(), connect() {}, disconnect() {}, start() {}, stop() { this.stopped = true; } };
}
env.context.AudioContext = class {
  constructor() { contexts++; this.state = 'running'; this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
  createGain() { return node(); }
  createBiquadFilter() { return node(); }
  createOscillator() { const oscillator = node(); oscillators.push(oscillator); return oscillator; }
  createBufferSource() { return node(); }
  createBuffer(channels, length) { return { getChannelData() { return new Float32Array(length); } }; }
};
const audio = new env.AR.Audio();
audio.play('torpedo');
audio.update({ players: [{ running: true }, { running: true }] }, 1 / 60);
assert.equal(contexts, 0, 'versus cannot bypass the autoplay gesture gate');
audio.unlock();
audio.unlock();
assert.equal(contexts, 1);
assert.equal(oscillators.length, 2, 'both engines are created once');
assert.equal(audio.engine, audio.engines[0]);
assert.equal(audio.engineGain, audio.engineGains[0]);
audio.update({ running: true, players: [
  { running: true, throttle: true, speed: 400, oxygenFraction: 1 },
  { running: true, throttle: false, speed: 80, oxygenFraction: 1 }
] }, 1 / 60);
assert.ok(audio.engineGains.every(gain => gain.gain.value > 0));
assert.ok(audio.engines[0].frequency.value > audio.engines[1].frequency.value);
assert.ok(audio.engineGains[0].gain.value > audio.engineGains[1].gain.value);
audio.update({ running: false, players: [{ running: true }, { running: true }] }, 1 / 60);
assert.ok(audio.engineGains.every(gain => gain.gain.value === 0), 'shared pause silences both engine oscillators');
audio.update({ players: [{ running: false }, { running: true, oxygenFraction: 0.1 }] }, 1 / 60);
assert.equal(audio.engineGains[0].gain.value, 0);
assert.ok(audio.engineGains[1].gain.value > 0);
assert.ok(audio.voices.size >= 2, 'low oxygen on the second player emits heartbeat');
audio.suspend();
assert.ok(audio.engineGains.every(gain => gain.gain.value === 0));
assert.ok(Array.from(audio.voices).every(voice => voice.stopped));
for (const voice of Array.from(audio.voices)) voice.onended();
audio.update({ running: true, throttle: true, speed: 100, oxygenFraction: 1 }, 1 / 60);
assert.ok(audio.engineGain.gain.value > 0);
assert.equal(audio.engineGains[1].gain.value, 0, 'returning to solo silences the unused engine');
console.log('PASS gesture gate, two independent engines, shared pause, second-player heartbeat, suspend, and return to solo');

const cueSignatures = new Set();
const cueAudio = new env.AR.Audio();
cueAudio.unlocked = true;
for (const item of ['ink', 'torpedo', 'net', 'siphon', 'riptide', 'shield', 'turbo', 'magnet', 'anchor']) {
  const notes = [];
  cueAudio.tone = (...args) => notes.push(['tone', ...args]);
  cueAudio.noise = (...args) => notes.push(['noise', ...args]);
  cueAudio.play(item);
  assert.ok(notes.length > 0, item + ' has a synth cue');
  cueSignatures.add(JSON.stringify(notes));
  for (const voice of Array.from(audio.voices)) voice.onended();
  audio.play(item);
  assert.ok(audio.voices.size > 0 && audio.voices.size <= 5, item + ' creates bounded disposable voices');
}
assert.equal(cueSignatures.size, 9, 'every item has a distinct sound');
cueAudio.setMuted(true);
let mutedNotes = 0;
cueAudio.tone = cueAudio.noise = () => mutedNotes++;
cueAudio.play('anchor');
assert.equal(mutedNotes, 0);
console.log('PASS all nine distinct item synth cues, voice bounds, and mute');
