'use strict';
const assert = require('node:assert/strict');
require('../docs/data.js');
require('../docs/terrain.js');
require('../docs/physics.js');
require('../docs/contacts.js');
const AR = globalThis.AR;
const dt = AR.FIXED_DT;
const tune = Object.fromEntries(AR.UPGRADES.map(track => [track.id, 5]));
const terrain = { stage: { gravity: 235, friction: 1.05 }, height: () => 400, slope: () => 0, ceiling: () => -Infinity, vent: () => 0 };

function rover(id = 'rover', x = 100) {
  const r = new AR.Rover(terrain, AR.getStats(id, tune));
  translate(r, x - r.x, 0);
  for (let i = 0; i < 240; i++) r.step({}, dt);
  return r;
}
function translate(r, dx, dy) {
  r.x += dx; r.y += dy;
  r.wheels.forEach(w => { w.x += dx; w.y += dy; });
  r.savePrevious();
}
function velocity(r, vx, vy = 0) {
  r.vx = vx; r.vy = vy; r.omega = 0; r.sleeping = false; r.sleepTime = 0;
  r.wheels.forEach(w => { w.vx = vx; w.vy = vy; w.omega = vx / w.radius; });
}
function finite(r) {
  for (const part of [r, ...r.wheels]) for (const key of ['x', 'y', 'vx', 'vy', 'angle', 'omega']) assert(Number.isFinite(part[key]), key + ' became nonfinite');
  assert(Math.hypot(r.vx, r.vy) < 1500, 'Collision injected excessive energy');
}
function step(a, b, inputA = {}, inputB = {}) {
  a.oxygen = a.maxOxygen; b.oxygen = b.maxOxygen;
  a.step(inputA, dt); b.step(inputB, dt);
  const result = AR.resolveRoverContacts(a, b);
  finite(a); finite(b);
  return result;
}
let passes = 0;
function test(name, fn) { const detail = fn(); console.log('PASS ' + name + (detail ? ': ' + detail : '')); passes++; }

test('Opposing grounded rovers pass through safely, every vehicle pairing', () => {
  let count = 0;
  for (const va of AR.VEHICLES) for (const vb of AR.VEHICLES) {
    const a = rover(va.id, 100), b = rover(vb.id, 210);
    velocity(a, 400); velocity(b, -400);
    let ghosts = false;
    for (let i = 0; i < 100; i++) {
      const contact = step(a, b); ghosts ||= a.ghosting;
      assert.equal(contact.contacts, 0, va.id + '/' + vb.id + ' blocked a ground pass');
      assert(!a.crashed && !b.crashed);
    }
    assert(ghosts); assert(a.x > b.x); count++;
  }
  return count + ' vehicle pairs';
});

test('A rover 15 px behind at 380 px/s passes a 200 px/s leader by 60 px within 2 s', () => {
  const leader = rover('rover', 100), trailer = rover('rover', 85);
  velocity(leader, 200); velocity(trailer, 380);
  let bestLead = -15;
  for (let i = 0; i < 2 / dt; i++) {
    const result = step(leader, trailer);
    assert.equal(result.contacts, 0); assert(!leader.crashed && !trailer.crashed);
    bestLead = Math.max(bestLead, trailer.x - leader.x);
  }
  assert(bestLead > 60, 'Trailer only advanced ' + bestLead + ' px ahead');
  return bestLead.toFixed(1) + ' px ahead';
});

test('Ghost contact mode survives jumps mid-overlap and resets beyond 1.2 rover lengths', () => {
  const a = rover(), b = rover('rover', 115);
  assert.equal(AR.resolveRoverContacts(a, b).contacts, 0); assert(a.ghosting && b.ghosting);
  translate(b, 0, -65); velocity(b, 0, 220);
  assert.equal(AR.resolveRoverContacts(a, b).contacts, 0); assert(a.ghosting && b.ghosting);
  translate(b, (a.stats.wheelbase + a.stats.radius * 2) * 1.21, 0);
  AR.resolveRoverContacts(a, b); assert(!a.ghosting && !b.ghosting);
  translate(b, a.x + 15 - b.x, a.y - 60 - b.y); velocity(b, 0, 220);
  assert(AR.resolveRoverContacts(a, b).contacts > 0, 'A later landing remained ghosted after separation');
});

test('A rover dropped 60 px above another still resolves a landing', () => {
  const lower = rover(), upper = rover(); translate(upper, 0, -60);
  let contacts = 0;
  for (let i = 0; i < 120 && !contacts; i++) contacts += step(lower, upper).contacts;
  assert(contacts > 0, 'Above landing was incorrectly ghosted');
  assert(!upper.ghosting && !lower.ghosting);
});

test('A wheel falling onto the dome crushes the lower hull above 82 px/s', () => {
  const lower = rover(), upper = rover();
  const dome = { x: lower.x + 18 * Math.sin(lower.angle), y: lower.y - 18 * Math.cos(lower.angle) };
  translate(upper, dome.x - upper.wheels[0].x, dome.y - 20 - upper.wheels[0].radius + 2 - upper.wheels[0].y);
  velocity(upper, 0, 220); velocity(lower, 0, 0);
  const result = AR.resolveRoverContacts(lower, upper);
  assert(result.contacts > 0);
  assert.equal(lower.crashed, 'Hull crushed');
  assert(result.hullCrushes.includes(0));
  assert(upper.vy < 220, 'Landing rover did not bounce/decelerate');
  assert(!upper.crashed, 'Landing wheel crushed its own dome');
});

test('Gentle landing and side dome contact do not crush a hull', () => {
  const lower = rover(), upper = rover();
  translate(upper, lower.x - upper.wheels[0].x, lower.y - 18 - 20 - upper.wheels[0].radius + 1 - upper.wheels[0].y);
  velocity(upper, 0, 35);
  AR.resolveRoverContacts(lower, upper);
  assert(!lower.crashed && !upper.crashed, 'Gentle landing was fatal');
  const a = rover(), b = rover('rover', 139);
  velocity(a, 400); velocity(b, -400);
  AR.resolveRoverContacts(a, b);
  assert(!a.crashed && !b.crashed, 'Horizontal dome contact was fatal');
});

test('Resting touching rovers remain quiet for 20 seconds, every vehicle', () => {
  let worst = 0;
  for (const vehicle of AR.VEHICLES) {
    const a = rover(vehicle.id), b = rover(vehicle.id);
    const separation = a.wheels[1].x - a.x + b.x - b.wheels[0].x + a.stats.radius + b.stats.radius - 0.25;
    translate(b, separation, 0);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 20 / dt; i++) {
      step(a, b);
      assert(!a.crashed && !b.crashed, vehicle.id + ' crashed at rest');
      if (i > 5 / dt) {
        minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x);
        minY = Math.min(minY, a.y); maxY = Math.max(maxY, a.y);
      }
    }
    const drift = Math.max(maxX - minX, maxY - minY); worst = Math.max(worst, drift);
    assert(drift < 0.1, vehicle.id + ' resting contact drifted ' + drift + ' px');
  }
  return 'worst settled drift ' + worst.toFixed(6) + ' px';
});

test('Deep scripted 40 px ground overlap stays finite and ghosts', () => {
  const a = rover('rover', 100), b = rover('rover', 140);
  velocity(a, 100); velocity(b, -100);
  let contacts = 0;
  for (let i = 0; i < 120; i++) contacts += step(a, b, { throttle: true }, { brake: true }).contacts;
  assert.equal(contacts, 0);
});

test('Crashed rovers are omitted from contacts', () => {
  const a = rover(), b = rover(); a.crashed = 'Hull crushed';
  const x = b.x;
  assert.equal(AR.resolveRoverContacts(a, b).contacts, 0);
  assert.equal(b.x, x);
});
console.log('PASS TOTAL: ' + passes + '/' + passes + ' contacts checks');
