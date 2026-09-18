(function (root) {
  'use strict';
  const AR = root.AR = root.AR || {};
  const DOME_RADIUS = 20, DOME_Y = -18;
  const clamp = function (v, low, high) { return Math.max(low, Math.min(high, v)); };
  const roverLength = r => r.stats.wheelbase + r.stats.radius * 2;
  const roverHeight = r => 38 + r.stats.restLength + 8 + r.stats.radius;
  // A tiny suspension hop should not turn a ground pass into a collision.
  AR.roverNearGround = r => !r.crashed && r.vy > -80 && r.wheels.some(w =>
    Math.abs(r.terrain.height(w.x) - w.y - w.radius) < 12);
  function clearPair(a, b) {
    a.ghostPeers?.delete(b); b.ghostPeers?.delete(a);
    a.ghosting = !!a.ghostPeers?.size; b.ghosting = !!b.ghostPeers?.size;
  }
  AR.clearRoverGhosting = r => {
    for (const other of r.ghostPeers || []) clearPair(r, other);
    r.ghosting = false;
  };

  function circle(rover, index) {
    if (index < 2) return rover.wheels[index];
    return {
      x: rover.x - DOME_Y * Math.sin(rover.angle),
      y: rover.y + DOME_Y * Math.cos(rover.angle), radius: DOME_RADIUS, dome: true
    };
  }
  function massProperties(rover) {
    const mass = rover.mass + rover.wheelMass * rover.wheels.length;
    let x = rover.x * rover.mass, y = rover.y * rover.mass;
    for (const wheel of rover.wheels) { x += wheel.x * rover.wheelMass; y += wheel.y * rover.wheelMass; }
    x /= mass; y /= mass;
    let inertia = rover.inertia + rover.mass * ((rover.x - x) ** 2 + (rover.y - y) ** 2);
    for (const wheel of rover.wheels) inertia += rover.wheelMass * ((wheel.x - x) ** 2 + (wheel.y - y) ** 2);
    return { x: x, y: y, inverseMass: 1 / mass, inverseInertia: 1 / inertia };
  }
  function translate(rover, dx, dy) {
    rover.x += dx; rover.y += dy;
    for (const wheel of rover.wheels) { wheel.x += dx; wheel.y += dy; }
  }
  function wake(rover) { rover.sleeping = false; rover.sleepTime = 0; }
  function velocityAt(rover, x, y) {
    return { x: rover.vx - rover.omega * (y - rover.y), y: rover.vy + rover.omega * (x - rover.x) };
  }
  function impulse(rover, body, x, y, jx, jy) {
    const spin = ((x - body.x) * jy - (y - body.y) * jx) * body.inverseInertia;
    const dvx = jx * body.inverseMass, dvy = jy * body.inverseMass;
    // Share impulses across the suspended assembly. Injecting a large impulse
    // into a light wheel alone makes the suspension ring and destabilizes
    // resting opponents. This preserves total linear/angular momentum while
    // the existing suspension remains free to move during the next step.
    rover.vx += dvx - spin * (rover.y - body.y);
    rover.vy += dvy + spin * (rover.x - body.x);
    rover.omega += spin;
    for (const wheel of rover.wheels) {
      wheel.vx += dvx - spin * (wheel.y - body.y);
      wheel.vy += dvy + spin * (wheel.x - body.x);
    }
    wake(rover);
  }
  function inverseEffectiveMass(body, x, y, nx, ny) {
    const lever = (x - body.x) * ny - (y - body.y) * nx;
    return body.inverseMass + lever * lever * body.inverseInertia;
  }

  // Both rovers must finish the same fixed step before this call. At 120 Hz,
  // opposing 400 px/s rovers close by 6.67 px, well under the smallest wheel's
  // 26 px diameter. Six inexpensive 3-by-3 passes handle simultaneous contacts.
  // Return unique circle contacts rather than counting solver iterations.
  AR.resolveRoverContacts = function (a, b) {
    const result = { contacts: 0, maxSpeed: 0, hullCrushes: [] };
    if (!a || !b || a === b || a.crashed || b.crashed) return result;
    const separation = Math.abs(a.x - b.x), length = Math.max(roverLength(a), roverLength(b));
    if (a.ghostPeers?.has(b)) {
      if (separation <= length * 1.2) return result;
      clearPair(a, b);
    }
    if (separation < length && Math.abs(a.y - b.y) < Math.min(roverHeight(a), roverHeight(b)) * .6 &&
        AR.roverNearGround(a) && AR.roverNearGround(b)) {
      (a.ghostPeers ||= new Set()).add(b); (b.ghostPeers ||= new Set()).add(a);
      a.ghosting = b.ghosting = true;
      return result;
    }
    const reach = a.stats.wheelbase + b.stats.wheelbase + a.stats.radius + b.stats.radius + 100;
    if (Math.abs(a.x - b.x) > reach || Math.abs(a.y - b.y) > reach) return result;
    let touched = 0;
    for (let iteration = 0; iteration < 6; iteration++) {
      for (let ai = 0; ai < 3; ai++) for (let bi = 0; bi < 3; bi++) {
        const ca = circle(a, ai), cb = circle(b, bi);
        const dx = cb.x - ca.x, dy = cb.y - ca.y;
        const distance = Math.hypot(dx, dy), radius = ca.radius + cb.radius;
        if (distance > radius + 0.06) continue;
        const bit = 1 << (ai * 3 + bi), fresh = !(touched & bit);
        if (fresh) { touched |= bit; result.contacts++; }
        // Coincident test spawns still get a deterministic separating normal.
        const nx = distance > 0.0001 ? dx / distance : (a.x <= b.x ? 1 : -1);
        const ny = distance > 0.0001 ? dy / distance : 0;
        const x = (ca.x + nx * ca.radius + cb.x - nx * cb.radius) / 2;
        const y = (ca.y + ny * ca.radius + cb.y - ny * cb.radius) / 2;
        const ma = massProperties(a), mb = massProperties(b);
        const av = velocityAt(a, x, y), bv = velocityAt(b, x, y);
        const speed = (bv.x - av.x) * nx + (bv.y - av.y) * ny;
        result.maxSpeed = Math.max(result.maxSpeed, -speed);
        if (fresh && speed < -82) {
          // Canvas y points down. A wheel above a dome must approach its upper
          // hemisphere; side swipes and gentle stacked resting are harmless.
          if (ca.dome && !cb.dome && ny < -0.35 && !a.crashed) {
            a.crashed = 'Hull crushed'; result.hullCrushes.push(0);
          }
          if (cb.dome && !ca.dome && ny > 0.35 && !b.crashed) {
            b.crashed = 'Hull crushed'; result.hullCrushes.push(1);
          }
        }
        if (speed < -0.001) {
          const denominator = inverseEffectiveMass(ma, x, y, nx, ny) + inverseEffectiveMass(mb, x, y, nx, ny);
          // Suppress restitution at resting speeds to avoid perpetual chatter.
          const restitution = fresh && speed < -24 ? 0.3 : 0;
          const normal = -(1 + restitution) * speed / denominator;
          impulse(a, ma, x, y, -nx * normal, -ny * normal);
          impulse(b, mb, x, y, nx * normal, ny * normal);
          const tx = -ny, ty = nx;
          const afterA = velocityAt(a, x, y), afterB = velocityAt(b, x, y);
          const slip = (afterB.x - afterA.x) * tx + (afterB.y - afterA.y) * ty;
          const tangentMass = inverseEffectiveMass(ma, x, y, tx, ty) + inverseEffectiveMass(mb, x, y, tx, ty);
          const friction = clamp(-slip / tangentMass, -normal * 0.32, normal * 0.32);
          impulse(a, ma, x, y, -tx * friction, -ty * friction);
          impulse(b, mb, x, y, tx * friction, ty * friction);
          a.impact = Math.max(a.impact, -speed); b.impact = Math.max(b.impact, -speed);
        }
        // Position-only projection does not inject bounce energy. Translate
        // wheels with their hull to leave each suspension joint coherent.
        const penetration = Math.max(0, radius - distance - 0.04);
        if (penetration > 0) {
          const correction = Math.min(12, penetration * 0.85) / (ma.inverseMass + mb.inverseMass);
          translate(a, -nx * correction * ma.inverseMass, -ny * correction * ma.inverseMass);
          translate(b, nx * correction * mb.inverseMass, ny * correction * mb.inverseMass);
          if (penetration > 0.12) { wake(a); wake(b); }
        }
      }
    }
    return result;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
