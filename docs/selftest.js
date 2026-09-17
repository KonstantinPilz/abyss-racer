(function (root) {
  'use strict';
  const inNode = typeof module !== 'undefined' && !!module.exports;
  if (inNode && (!root.AR || !root.AR.Rover)) {
    require('./data.js'); require('./terrain.js'); require('./physics.js');
  }
  const AR = root.AR;
  const DT = AR.FIXED_DT;
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function finite(rover) {
    for (const key of ['x', 'y', 'vx', 'vy', 'angle', 'omega', 'oxygen', 'cooldown']) assert(Number.isFinite(rover[key]), 'Non-finite chassis ' + key);
    for (const wheel of rover.wheels) for (const key of ['x', 'y', 'vx', 'vy', 'angle', 'omega']) assert(Number.isFinite(wheel[key]), 'Non-finite wheel ' + key);
  }
  function penetration(rover, terrain) {
    let worst = 0;
    for (const wheel of rover.wheels) {
      const slope = terrain.slope(wheel.x);
      worst = Math.max(worst, wheel.radius - (terrain.height(wheel.x) - wheel.y) / Math.sqrt(1 + slope * slope));
      worst = Math.max(worst, terrain.ceiling(wheel.x) - (wheel.y - wheel.radius));
    }
    const c = Math.cos(rover.angle), s = Math.sin(rover.angle);
    const half = rover.stats.wheelbase * 0.45;
    for (const point of [[-half, 9, 5], [half, 9, 5], [-half, -7, 4], [half, -7, 4], [0, -18, 20]]) {
      const x = rover.x + point[0] * c - point[1] * s;
      const y = rover.y + point[0] * s + point[1] * c;
      const slope = terrain.slope(x);
      worst = Math.max(worst, point[2] - (terrain.height(x) - y) / Math.sqrt(1 + slope * slope));
      worst = Math.max(worst, terrain.ceiling(x) - (y - point[2]));
    }
    return worst;
  }
  function flatTerrain() {
    const terrain = new AR.Terrain(AR.STAGES[0]);
    terrain.height = function () { return 400; };
    terrain.slope = function () { return 0; };
    return terrain;
  }
  function place(rover, angle, y) {
    rover.angle = angle; rover.y = y;
    rover.vx = rover.vy = rover.omega = 0;
    rover.sleeping = false; rover.sleepTime = 0;
    rover.grounded = rover.bodyGrounded = false;
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const wheel of rover.wheels) {
      const x = wheel.side * rover.stats.wheelbase / 2, down = rover.stats.restLength + 8;
      wheel.x = rover.x + x * c - down * s; wheel.y = y + x * s + down * c;
      wheel.vx = wheel.vy = wheel.omega = 0; wheel.grounded = false;
    }
  }
  AR.runSelfTests = function (report) {
    const results = [];
    function test(name, work) {
      try { const detail = work(); results.push({ name: name, pass: true, detail: detail || '' }); }
      catch (error) { results.push({ name: name, pass: false, detail: error.message }); }
      const result = results[results.length - 1];
      const line = (result.pass ? 'PASS ' : 'FAIL ') + name + (result.detail ? ' — ' + result.detail : '');
      console.log(line);
      if (report) report(result, line);
    }
    for (const stage of AR.STAGES) {
      test(stage.name + ': 60 seconds of fixed-step physics', function () {
        const terrain = new AR.Terrain(stage), rover = new AR.Rover(terrain, AR.getStats('rover'));
        let maxPenetration = 0, crushes = 0;
        for (let frame = 0; frame < 60 / DT; frame++) {
          // Stress the complete run even after a fatal landing. Production keeps
          // crashes terminal; the harness deliberately clears them each step.
          rover.oxygen = rover.maxOxygen; rover.crashed = '';
          const input = stage.id === 'reef' ? { throttle: true } : {
            throttle: frame % 840 < 680,
            brake: frame % 840 >= 680,
            burst: frame % 1080 === 900
          };
          rover.step(input, DT);
          if (rover.crashed) crushes++;
          finite(rover);
          maxPenetration = Math.max(maxPenetration, penetration(rover, terrain));
          if (frame % 120 === 0) terrain.maintain(rover.x);
        }
        assert(maxPenetration < 3, 'Terrain penetration ' + maxPenetration.toFixed(3) + ' px');
        assert(terrain.chunks.size <= 9, 'Terrain chunks leaked: ' + terrain.chunks.size);
        const distance = Math.max(0, rover.x - 100) / 10;
        if (stage.id === 'reef') assert(distance > 200, 'Full throttle only progressed ' + distance.toFixed(1) + ' m');
        return distance.toFixed(1) + ' m; max penetration ' + maxPenetration.toFixed(3) + ' px; ' + crushes + ' recoverable test impacts';
      });
    }
    test('Flat-ground rest: no vibration over 60 seconds', function () {
      const rover = new AR.Rover(flatTerrain(), AR.getStats('rover'));
      let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
      for (let i = 0; i < 60 / DT; i++) {
        rover.oxygen = rover.maxOxygen; rover.step({}, DT); finite(rover);
        if (i > 5 / DT) { minY = Math.min(minY, rover.y); maxY = Math.max(maxY, rover.y); minX = Math.min(minX, rover.x); maxX = Math.max(maxX, rover.x); }
      }
      assert(maxY - minY < 0.05 && maxX - minX < 0.05, 'Rest drift exceeds 0.05 px');
      assert(rover.sleeping, 'Rover never entered stable sleep');
      return 'settled movement ' + (maxY - minY).toFixed(6) + ' px';
    });
    test('Beginner controls survive a kilometre; full-gas first crash exceeds 200 m', function () {
      const terrain = new AR.Terrain(AR.STAGES[0]);
      const fullGas = new AR.Rover(terrain, AR.getStats('rover'));
      let firstCrashStep = 0, fullGasMaxX = fullGas.x;
      for (; firstCrashStep < 60 / DT && !fullGas.crashed; firstCrashStep++) {
        fullGas.step({ throttle: true }, DT);
        fullGasMaxX = Math.max(fullGasMaxX, fullGas.x);
        finite(fullGas);
      }
      const fullGasDistance = (fullGasMaxX - 100) / 10;
      assert(fullGasDistance > 200, 'First full-gas run ended before 200 m');
      const beginner = new AR.Rover(new AR.Terrain(AR.STAGES[0]), AR.getStats('rover'));
      let beginnerMaxX = beginner.x;
      for (let step = 0; step < 60 / DT; step++) {
        // No oxygen refill and no crash clearing: mimic the tutorial's simple
        // advice to drive on the seabed, then release both pedals over crests.
        beginner.step({ throttle: beginner.grounded || beginner.bodyGrounded }, DT);
        finite(beginner);
        beginnerMaxX = Math.max(beginnerMaxX, beginner.x);
        assert(!beginner.crashed, 'Beginner controller ended at ' + (step * DT).toFixed(2) + ' s: ' + beginner.crashed);
      }
      const beginnerDistance = (beginnerMaxX - 100) / 10;
      assert(beginnerDistance >= 1000, 'Beginner controller reached only ' + beginnerDistance.toFixed(1) + ' m');
      return 'first full-gas end ' + fullGasDistance.toFixed(1) + ' m / ' + (firstCrashStep * DT).toFixed(3) + ' s; beginner ' + beginnerDistance.toFixed(1) + ' m with no refills';
    });
    for (const stage of AR.STAGES) {
      test(stage.name + ': 40-second QA driver, level-0 Reef Rover', function () {
        const terrain = new AR.Terrain(stage), rover = new AR.Rover(terrain, AR.getStats('rover'));
        // Match createScene's 1.5-second settling period before the run begins.
        for (let i = 0; i < 180; i++) rover.step({}, DT);
        rover.oxygen = rover.maxOxygen;
        const startX = rover.x;
        const hazards = stage.id === 'whale' ? new AR.WorldHazards(terrain) : null;
        let maxX = startX, brakeSteps = 0, airTime = 0, touchedVent = false, firstVentAir = 0;
        for (let frame = 0; frame < 40 / DT; frame++) {
          const angle = Math.atan2(Math.sin(rover.angle), Math.cos(rover.angle));
          const airborne = !rover.grounded && !rover.bodyGrounded;
          if (!brakeSteps && airborne && angle < -35 * Math.PI / 180) brakeSteps = 18;
          const brake = brakeSteps > 0;
          if (brakeSteps) brakeSteps--;
          // 0.9 s gas / 0.3 s coast; an 0.15 s brake tap replaces gas and
          // repeats if the nose still needs correction when the tap finishes.
          touchedVent = touchedVent || terrain.vent(rover.x) > 0;
          terrain.stepWorld([rover], DT);
          rover.step({ throttle: frame % 144 < 108 && !brake, brake: brake }, DT);
          if (hazards) hazards.step([rover], DT);
          finite(rover);
          maxX = Math.max(maxX, rover.x);
          if (!rover.grounded && !rover.bodyGrounded) airTime += DT;
          else if (airTime) {
            if (touchedVent && !firstVentAir) firstVentAir = airTime;
            airTime = 0; touchedVent = false;
          }
          assert(!rover.crashed, 'Crashed at ' + ((maxX - startX) / 10).toFixed(1) + ' m / ' + ((frame + 1) * DT).toFixed(3) + ' s: ' + rover.crashed);
          if (frame % 120 === 0) terrain.maintain(rover.x);
        }
        const distance = (maxX - startX) / 10;
        assert(distance > (stage.id === 'volcanic' ? 400 : 250), 'Insufficient progress: ' + distance.toFixed(1) + ' m');
        if (stage.id === 'volcanic') assert(firstVentAir >= 1.2 && firstVentAir <= 1.6, 'First vent airtime ' + firstVentAir.toFixed(3) + ' s');
        return distance.toFixed(1) + ' m; no crash or refills' + (firstVentAir ? '; first vent airtime ' + firstVentAir.toFixed(3) + ' s' : '');
      });
    }
    test('High-speed landings: every stage × vehicle combination', function () {
      let worst = 0;
      for (const stage of AR.STAGES) for (const vehicle of AR.VEHICLES) {
        const terrain = new AR.Terrain(stage), rover = new AR.Rover(terrain, AR.getStats(vehicle.id));
        rover.x = 1700; rover.y = terrain.height(rover.x) - 350; rover.vx = 1600; rover.vy = 1000;
        for (const w of rover.wheels) { w.x = rover.x + w.side * vehicle.wheelbase / 2; w.y = rover.y + vehicle.restLength + 8; w.vx = rover.vx; w.vy = rover.vy; }
        for (let i = 0; i < 5 / DT; i++) {
          rover.crashed = ''; rover.oxygen = rover.maxOxygen;
          rover.step({ throttle: i % 120 < 80, brake: i % 120 >= 80, burst: i % 250 === 0 }, DT);
          finite(rover); worst = Math.max(worst, penetration(rover, terrain));
          assert(Math.abs(rover.vx) < 5000 && Math.abs(rover.vy) < 5000, 'Landing injected energy');
        }
      }
      assert(worst < 3, 'High-speed penetration ' + worst.toFixed(3) + ' px');
      return '45 combinations; 1600 px/s forward + 1000 px/s downward; max penetration ' + worst.toFixed(3) + ' px';
    });
    test('Upgrades materially change acceleration, speed, reserve, and burst', function () {
      const base = AR.getStats('rover'), engine = AR.getStats('rover', { engine: 12 });
      function speed(stats) { const r = new AR.Rover(flatTerrain(), stats); for (let i = 0; i < 3 / DT; i++) r.step({ throttle: true }, DT); return r.vx; }
      const baseSpeed = speed(base), upgradedSpeed = speed(engine);
      assert(upgradedSpeed > baseSpeed * 1.2, 'Engine upgrade has little acceleration effect');
      assert(speed(AR.getStats('rover', { thrust: 12 })) > baseSpeed * 1.1, 'Thrust upgrade has little speed effect');
      const all = AR.getStats('rover', { engine: 12, thrust: 12, suspension: 12, tires: 12, oxygen: 12, ballast: 12 });
      assert(all.grip > base.grip && all.travel > base.travel && all.spring > base.spring && all.damping > base.damping, 'Handling upgrades missing');
      assert(all.oxygen > base.oxygen * 2 && all.burst > base.burst * 1.5 && all.cooldown < base.cooldown * 0.6, 'Resource upgrades missing');
      for (const upgrade of AR.UPGRADES) { assert(upgrade.maxLevel >= 10, 'Fewer than ten levels'); assert(AR.upgradeCost(upgrade.id, 8) > AR.upgradeCost(upgrade.id, 7), 'Costs do not escalate'); }
      return '3 s speed: ' + baseSpeed.toFixed(1) + ' → ' + upgradedSpeed.toFixed(1) + ' px/s';
    });
    test('Ballast consumes oxygen, thrusts upward, and respects cooldown', function () {
      const rover = new AR.Rover(flatTerrain(), AR.getStats('rover'));
      const before = rover.oxygen;
      rover.step({ burst: true }, DT);
      assert(rover.burstFired && rover.vy < -60 && before - rover.oxygen > 8, 'Burst did not apply');
      const after = rover.oxygen;
      rover.step({ burst: true }, DT);
      assert(!rover.burstFired && after - rover.oxygen < 0.1 && rover.cooldown > 0, 'Cooldown did not prevent repeat burst');
    });
    test('Oxygen depletion and upside-down dome collision are terminal', function () {
      const rover = new AR.Rover(flatTerrain(), AR.getStats('rover'));
      rover.oxygen = 0.001; rover.step({}, DT);
      assert(rover.crashed === 'Oxygen depleted', 'Empty tank is not fatal');
      const body = new AR.Rover(flatTerrain(), AR.getStats('rover'));
      body.angle = Math.PI; body.y = 368; body.vy = 180;
      for (const w of body.wheels) { w.x = body.x - w.side * body.stats.wheelbase / 2; w.y = body.y - 32; w.vy = 180; }
      body.step({}, DT);
      assert(body.crashed === 'Hull crushed', 'Dome impact is not fatal');
    });
    test('Overturned hull contact does not masquerade as flight', function () {
      const rover = new AR.Rover(flatTerrain(), AR.getStats('rover'));
      rover.angle = Math.PI; rover.y = 362;
      for (const w of rover.wheels) { w.x = rover.x - w.side * rover.stats.wheelbase / 2; w.y = rover.y - 32; }
      let contacts = 0;
      for (let i = 0; i < 30; i++) {
        rover.step({}, DT);
        assert(!rover.crashed, 'A brief gentle dome brush should allow recovery');
        if (rover.bodyGrounded && !rover.grounded) contacts++;
      }
      assert(contacts > 25, 'Hull contact not reported with wheels above seabed');
      rover.step({ burst: true }, DT);
      assert(!rover.bodyGrounded && !rover.grounded, 'Ballast takeoff should clear all contact flags');
      return 'resting dome detected; takeoff clears body contact';
    });
    test('Gentle inverted dome rest ends within one second at any fixed-step size', function () {
      let latest = 0;
      for (const dt of [DT, 1 / 60, 1 / 30]) for (const angle of [Math.PI, -Math.PI, Math.PI * 3]) {
        const rover = new AR.Rover(flatTerrain(), AR.getStats('rover'));
        place(rover, angle, 362);
        let elapsed = 0, impact = 0;
        while (elapsed < 1 && !rover.crashed) {
          rover.step({}, dt); elapsed += dt; impact = Math.max(impact, rover.impact);
          if (elapsed <= 0.6 + 1e-9) assert(!rover.crashed, 'Dome timer fired before the grace period');
        }
        assert(impact < 82, 'Placement accidentally tested a hard impact');
        assert(rover.crashed === 'Hull crushed' && elapsed <= 1, 'Resting upside down did not end the run');
        latest = Math.max(latest, elapsed);
      }
      return 'latest death ' + latest.toFixed(3) + ' s; ±180° and 540°';
    });
    test('Dome contact accumulates across brushes and expires after 1.5 seconds', function () {
      function segment(rover, steps, contact) {
        for (let i = 0; i < steps && !rover.crashed; i++) {
          place(rover, Math.PI, contact ? 362 : 150);
          rover.step({}, DT);
        }
      }
      const repeated = new AR.Rover(flatTerrain(), AR.getStats('rover'));
      segment(repeated, 36, true); segment(repeated, 36, false); segment(repeated, 36, true);
      assert(!repeated.crashed, 'Exactly 0.6 s contact should still permit recovery');
      segment(repeated, 1, true);
      assert(repeated.crashed === 'Hull crushed', 'Separated brushes did not accumulate');
      const recovered = new AR.Rover(flatTerrain(), AR.getStats('rover'));
      segment(recovered, 36, true); segment(recovered, 181, false); segment(recovered, 48, true);
      assert(!recovered.crashed, 'Expired contact carried into a later landing');
      place(recovered, 0, 350);
      for (let i = 0; i < 240; i++) recovered.step({}, DT);
      assert(!recovered.crashed && recovered.grounded, 'Brief dome contact prevented an upright recovery');
      // A partial interval must be clipped, not discarded wholesale at cutoff.
      const clipped = new AR.Rover(flatTerrain(), AR.getStats('rover'));
      segment(clipped, 60, true); segment(clipped, 114, false); segment(clipped, 60, true);
      assert(!clipped.crashed, 'Sliding-window boundary retained expired contact');
      segment(clipped, 13, true);
      assert(clipped.crashed === 'Hull crushed', 'Sliding window lost recent contact');
    });
    test('Dome timer requires inversion and also detects ceiling contact', function () {
      for (const degrees of [94, 96, -96, 264]) {
        const terrain = flatTerrain(), rover = new AR.Rover(terrain, AR.getStats('rover'));
        const angle = degrees * Math.PI / 180;
        const domeX = 100 + 18 * Math.sin(angle);
        terrain.height = function (x) { return Math.abs(x - domeX) < 2 ? 400 : 600; };
        // Reposition a slow grazing contact to isolate the angular threshold.
        for (let i = 0; i < 80 && !rover.crashed; i++) {
          rover.x = 100;
          place(rover, angle, 400 + 18 * Math.cos(angle) - 19.98);
          rover.step({}, DT);
        }
        assert(degrees === 94 ? !rover.crashed : rover.crashed === 'Hull crushed', 'Incorrect inversion threshold at ' + degrees + '°');
      }
      const terrain = flatTerrain(), rover = new AR.Rover(terrain, AR.getStats('rover'));
      const angle = -3 * Math.PI / 4, domeX = rover.x + 18 * Math.sin(angle);
      terrain.ceiling = function (x) { return Math.abs(x - domeX) < 0.5 ? 200 - 18 * Math.cos(angle) - 19.9 : -Infinity; };
      for (let i = 0; i < 80 && !rover.crashed; i++) { rover.x = 100; place(rover, angle, 200); rover.step({}, DT); }
      assert(rover.crashed === 'Hull crushed', 'Slow inverted ceiling contact did not end the run');
    });
    test('A hull wedged on a narrow ledge ends as Stranded after 2.5 seconds', function () {
      const terrain = flatTerrain();
      terrain.height = function (x) { return Math.abs(x - 100) < 31 ? 400 : 600; };
      const rover = new AR.Rover(terrain, AR.getStats('rover'));
      place(rover, 0, 386);
      for (let i = 0; i < 300; i++) {
        rover.step({}, DT);
        assert(rover.bodyGrounded && !rover.grounded && !rover.crashed, 'Ledge should support only the hull during the grace period');
      }
      rover.step({}, DT);
      assert(rover.crashed === 'Stranded', 'Low-speed hull wedge did not end the run');
      return '2.508 s';
    });
    test('Vents leave the first 220 m clear, scale gradually, and add equal acceleration', function () {
      const terrain = new AR.Terrain(AR.STAGES[3]);
      for (let x = -100; x <= 2300; x++) assert(terrain.vent(x) === 0, 'Early vent at ' + (x - 100) / 10 + ' m');
      let previous = 0;
      for (let x = 2590; x < 19000; x += 960) {
        const lift = terrain.vent(x), scale = 1 + 0.5 * Math.min(1, (x - 2300) / 12800);
        assert(Math.abs(lift - 232.5 * scale) < 1e-9 && lift >= previous, 'Vent strength does not follow distance scaling');
        previous = lift;
      }
      for (const angle of [0, -0.6, 0.6]) {
        const still = flatTerrain(), vent = flatTerrain(); vent.vent = function () { return 232.5; };
        const a = new AR.Rover(still, AR.getStats('rover')), b = new AR.Rover(vent, AR.getStats('rover'));
        place(a, angle, 300); place(b, angle, 300);
        a.substep({}, DT / 2); b.substep({}, DT / 2);
        const lift = b.vy - a.vy;
        assert(lift < 0 && Math.abs(a.angle - b.angle) < 1e-10 && Math.abs(a.omega - b.omega) < 1e-10, 'Vent introduced pitch torque');
        for (let i = 0; i < 2; i++) assert(Math.abs((b.wheels[i].vy - a.wheels[i].vy) - lift) < 1e-10, 'Wheel and chassis vent accelerations differ');
      }
    });
    test('Gentler air control still completes and lands a backflip from a big ramp', function () {
      const terrain = flatTerrain();
      // A long climb with a deep landing zone provides more than 2 s of hang.
      terrain.height = function (x) { return x < 600 ? 400 : x < 1200 ? 400 - (x - 600) * 0.3 : x < 1210 ? 220 : x < 1300 ? 220 + (x - 1210) / 90 * 780 : 1000; };
      terrain.slope = function (x) { return (terrain.height(x + 4) - terrain.height(x - 4)) / 8; };
      const rover = new AR.Rover(terrain, AR.getStats('rover'));
      let startAngle = 0, air = 0, hang = 0, flipped = false, landed = false;
      for (let i = 0; i < 14 / DT; i++) {
        if (rover.grounded || rover.bodyGrounded) {
          if (flipped && air > 2) { hang = air; landed = true; }
          air = 0; startAngle = rover.angle;
        }
        const brake = startAngle - rover.angle > 5 && rover.omega < -0.1;
        rover.step({ throttle: !flipped && !brake, brake: brake }, DT);
        assert(!rover.crashed, 'Backflip recovery crashed: ' + rover.crashed);
        if (!rover.grounded && !rover.bodyGrounded) { air += DT; if (startAngle - rover.angle >= 2 * Math.PI) flipped = true; }
      }
      assert(flipped && landed && rover.grounded, 'Full backflip and upright landing no longer achievable');
      return 'full rotation and safe landing; ' + hang.toFixed(3) + ' s hang';
    });
    test('Terrain is deterministic, seamless, distinct, infinite, and bounded', function () {
      for (const stage of AR.STAGES) {
        const a = new AR.Terrain(stage), b = new AR.Terrain(stage);
        for (let x = -500; x < 80000; x += 479) {
          assert(a.height(x) === b.height(x), 'Seed mismatch');
          assert(Number.isFinite(a.height(x)) && Number.isFinite(a.slope(x)), 'Invalid terrain');
          a.maintain(x); b.maintain(x);
          assert(a.chunks.size <= 9, 'Unbounded chunk cache');
        }
        for (let x = 1024; x < 10000; x += 1024) assert(Math.abs(a.height(x - 0.001) - a.height(x + 0.001)) < 0.02, 'Chunk seam');
        const ramps = a.rampsBetween(860, 10000);
        assert(ramps.length >= 3, 'No usable ramp lips');
        for (const ramp of ramps) {
          assert(ramp.x >= 860 && ramp.x <= 10000 && ramp.y === a.height(ramp.x), 'Invalid ramp lip');
          assert(ramp.height > 30 && a.rampsBetween(ramp.x + 0.01, ramp.x + 1).length === 0, 'Duplicate ramp range');
        }
      }
      assert(new AR.Terrain(AR.STAGES[0]).height(1300) !== new AR.Terrain(AR.STAGES[1]).height(1300), 'Stages identical');
      assert(new AR.Terrain(AR.STAGES[3]).vent(2590) > 230, 'Heat vents missing');
      assert(Number.isFinite(new AR.Terrain(AR.STAGES[4]).ceiling(100)), 'Ice ceiling missing');
      return 'nine seeded stages sampled through 8 km';
    });
    test('Oversized frame input is capped and remains finite', function () {
      const rover = new AR.Rover(flatTerrain(), AR.getStats('rover'));
      for (let i = 0; i < 90; i++) rover.step({ throttle: true }, 8);
      finite(rover);
      assert(rover.x < 1500, 'Frame delta cap failed');
    });
    const passed = results.filter(function (result) { return result.pass; }).length;
    const summary = { passed: passed, failed: results.length - passed, results: results };
    root.__AR_SELFTEST__ = summary;
    console.log((summary.failed ? 'FAIL' : 'PASS') + ' TOTAL: ' + passed + '/' + results.length + ' checks');
    return summary;
  };
  if (inNode) {
    module.exports = AR.runSelfTests;
    if (require.main === module) process.exitCode = AR.runSelfTests().failed ? 1 : 0;
  } else {
    const results = document.getElementById('results');
    const summary = AR.runSelfTests(function (result, line) {
      const entry = document.createElement('li'); entry.className = result.pass ? 'pass' : 'fail'; entry.textContent = line; results.appendChild(entry);
    });
    const heading = document.getElementById('summary');
    heading.textContent = (summary.failed ? 'FAIL' : 'PASS') + ' · ' + summary.passed + '/' + summary.results.length + ' checks passed';
    heading.className = summary.failed ? 'fail' : 'pass';
    document.body.dataset.result = summary.failed ? 'fail' : 'pass';
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
