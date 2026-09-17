(function (root) {
  'use strict';
  const AR = root.AR = root.AR || {};
  const MOUNT_Y = 8;
  const DOME_Y = -18;
  const DOME_RADIUS = 20;
  const SOLVER_ITERATIONS = 5;
  const INVERTED_COS = Math.cos(95 * Math.PI / 180);
  const clamp = function (value, low, high) { return Math.max(low, Math.min(high, value)); };

  class Rover {
    constructor(terrain, stats) {
      this.terrain = terrain;
      this.stats = stats;
      this.mass = stats.mass;
      this.inverseMass = 1 / this.mass;
      this.inertia = this.mass * (stats.wheelbase * stats.wheelbase + 28 * 28) / 12;
      this.inverseInertia = 1 / this.inertia;
      this.wheelMass = Math.max(2, this.mass * 0.12);
      this.wheelInertia = this.wheelMass * stats.radius * stats.radius * 0.5;
      this.x = 100;
      this.y = terrain.height(this.x) - stats.radius - MOUNT_Y - stats.restLength;
      this.y += this.mass * this.gravity() / (stats.spring * 2);
      this.vx = 0; this.vy = 0; this.angle = 0; this.omega = 0;
      this.wheels = [-1, 1].map((side) => ({
        x: this.x + side * stats.wheelbase / 2,
        y: terrain.height(this.x + side * stats.wheelbase / 2) - stats.radius,
        vx: 0, vy: 0, angle: 0, omega: 0, radius: stats.radius,
        grounded: true, side: side
      }));
      this.maxOxygen = stats.oxygen; this.oxygen = stats.oxygen;
      this.cooldown = 0; this.grounded = true; this.bodyGrounded = false; this.crashed = '';
      this.impact = 0; this.burstFired = false;
      this.sleepTime = 0; this.sleeping = false;
      this.contactTime = 0; this.domeContacts = []; this.strandedTime = 0;
      this.invertedDomeContact = false;
      this.gravityFlipped = false; this.gravityTurn = 0; this.gravityGrace = 0; this.jetThrust = 0;
      this.savePrevious();
    }
    gravity() { return this.terrain.stage.gravity * (1 - this.stats.buoyancy) * (this.gravityFlipped ? -1 : 1); }
    roof(x) {
      return this.gravityFlipped && this.terrain.gravityCeiling ? this.terrain.gravityCeiling(x) : this.terrain.ceiling(x);
    }
    setGravityFlipped(flipped) {
      flipped = !!flipped;
      if (this.gravityFlipped === flipped || this.crashed) return;
      this.gravityFlipped = flipped;
      this.gravityTurn = 0.6; this.gravityGrace = 1.25;
      this.domeContacts = []; this.strandedTime = 0;
      this.sleeping = false; this.sleepTime = 0;
      this.grounded = false; this.bodyGrounded = false;
      this.omega = 0;
      this.vy *= 0.25;
      this.wheels.forEach(function (wheel) { wheel.vy *= 0.25; wheel.grounded = false; });
    }
    turnGravity(dt) {
      if (!this.gravityTurn) return;
      const before = this.angle;
      const target = this.gravityFlipped ? Math.PI : 0;
      let difference = Math.atan2(Math.sin(target - before), Math.cos(target - before));
      if (Math.abs(difference) > 3.13) difference = -Math.PI;
      const rotation = difference * Math.min(1, dt / this.gravityTurn);
      this.angle += rotation;
      const c = Math.cos(rotation), s = Math.sin(rotation);
      for (const wheel of this.wheels) {
        const dx = wheel.x - this.x, dy = wheel.y - this.y;
        wheel.x = this.x + dx * c - dy * s;
        wheel.y = this.y + dx * s + dy * c;
        wheel.vx = this.vx; wheel.vy = this.vy;
        wheel.omega = -this.vx / wheel.radius * (this.gravityFlipped ? 1 : -1);
      }
      // Leave room for the entire turning vehicle near either surface. The
      // displacement is small and interpolated; no collision impulse is added.
      const clearance = Math.hypot(this.stats.wheelbase / 2, this.stats.restLength + MOUNT_Y) + this.stats.radius + 3;
      const roof = this.terrain.gravityCeiling ? this.terrain.gravityCeiling(this.x) : this.terrain.ceiling(this.x);
      const nextY = clamp(this.y, roof + clearance, this.terrain.height(this.x) - clearance);
      const shift = nextY - this.y;
      this.y = nextY;
      this.wheels.forEach(function (wheel) { wheel.y += shift; });
      this.omega = 0;
      this.gravityTurn = Math.max(0, this.gravityTurn - dt);
    }
    savePrevious() {
      this.prev = { x: this.x, y: this.y, angle: this.angle, wheels: this.wheels.map(function (w) { return { x: w.x, y: w.y, angle: w.angle }; }) };
    }
    step(input, dt) {
      this.savePrevious();
      this.impact = 0; this.burstFired = false; this.bodyGrounded = false;
      this.invertedDomeContact = false;
      if (this.crashed) return;
      dt = clamp(Number(dt) || AR.FIXED_DT, 0, 1 / 30);
      input = input || {};
      this.gravityGrace = Math.max(0, this.gravityGrace - dt);
      this.geyserFlight = Math.max(0, (this.geyserFlight || 0) - dt);
      this.naturalGeyser = Math.max(0, (this.naturalGeyser || 0) - dt);
      this.environment = this.terrain.environment ? this.terrain.environment(this) : {};
      if (this.environment.plankton) this.oxygen = Math.min(this.maxOxygen, this.oxygen + dt * (1 + (input.throttle ? 1.02 : .85)));
      this.sharkBite = Math.max(0, (this.sharkBite || 0) - dt);
      this.turnGravity(dt);
      this.cooldown = Math.max(0, this.cooldown - dt);
      this.oxygen = Math.max(0, this.oxygen - dt * (input.throttle ? 1.02 : 0.85));
      if (this.oxygen <= 0) { this.crashed = 'Oxygen depleted'; return; }
      if (input.burst && !this.environment.lift && this.cooldown === 0 && this.oxygen > 8) {
        this.oxygen -= 8;
        const direction = this.gravityFlipped ? -1 : 1;
        this.vy -= this.stats.burst * direction;
        this.wheels.forEach((w) => { w.vy -= this.stats.burst * 0.75 * direction; });
        this.cooldown = this.stats.cooldown; this.burstFired = true;
      }
      if (input.throttle || input.brake || this.burstFired || this.gravityTurn || this.environment.current || this.environment.lift || this.terrain.vent(this.x) > 0) {
        this.sleeping = false; this.sleepTime = 0;
      }
      if (this.sleeping) { this.updateContactTimers(dt); return; }
      // Two normal substeps keep the suspension stiff without explicit-Euler
      // instability. Faster injected test velocities receive additional steps,
      // so no wheel travels farther than approximately 6 px before collision.
      const speed = Math.max(Math.abs(this.vx), Math.abs(this.vy), ...this.wheels.map(function (w) { return Math.hypot(w.vx, w.vy); }));
      const count = Math.min(16, Math.max(2, Math.ceil(dt * speed / 6)));
      const h = dt / count;
      for (let sub = 0; sub < count; sub++) this.substep(input, h);
      this.grounded = this.wheels.some(function (w) { return w.grounded; });
      this.updateContactTimers(dt);
      const quiet = Math.hypot(this.vx, this.vy) < 0.9 && Math.abs(this.omega) < 0.025 && this.wheels.every(function (w) { return w.grounded && Math.hypot(w.vx, w.vy) < 1.2; });
      if (!input.throttle && !input.brake && !this.environment.current && !this.environment.lift && quiet) this.sleepTime += dt;
      else this.sleepTime = 0;
      // Sleeping is only allowed after both contacts are settled. It removes
      // subpixel suspension chatter while retaining rolling on actual slopes.
      if (this.sleepTime > 0.65) {
        this.sleeping = true; this.vx = this.vy = this.omega = 0;
        this.wheels.forEach(function (w) { w.vx = w.vy = w.omega = 0; });
      }
    }
    updateContactTimers(dt) {
      const start = this.contactTime;
      this.contactTime += dt;
      const cutoff = this.contactTime - 1.5;
      // Merge adjacent contact intervals, then clip to the sliding window.
      // Count simulated time once per step, never once per solver iteration.
      if (this.invertedDomeContact) {
        const last = this.domeContacts[this.domeContacts.length - 1];
        if (last && last.end === start) last.end = this.contactTime;
        else this.domeContacts.push({ start: start, end: this.contactTime });
      }
      while (this.domeContacts.length && this.domeContacts[0].end <= cutoff) this.domeContacts.shift();
      if (this.domeContacts.length) this.domeContacts[0].start = Math.max(cutoff, this.domeContacts[0].start);
      const domeTime = this.domeContacts.reduce(function (total, contact) { return total + contact.end - contact.start; }, 0);
      const wedged = this.bodyGrounded && !this.wheels.some(function (w) { return w.grounded; }) && Math.abs(this.vx) < 15;
      this.strandedTime = wedged ? this.strandedTime + dt : 0;
      if (!this.crashed && !this.gravityGrace && domeTime > 0.6 + 1e-9) this.crashed = 'Hull crushed';
      if (!this.crashed && !this.gravityGrace && this.strandedTime > 2.5 + 1e-9) this.crashed = 'Stranded';
    }
    substep(input, dt) {
      const stats = this.stats;
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      const downX = -s, downY = c;
      const gravity = this.gravity();
      const env = this.environment || {};
      const vent = this.terrain.vent(this.x);
      const lift = env.lift ? env.lift * (input.burst ? 2 : 1) : 0;
      const current = env.current || 0;
      const slow = env.mud ? .5 : 1;
      const ventReach = clamp(1 - Math.max(0, this.terrain.height(this.x) - this.y - 70) / 260, 0, 1);
      const speed = Math.hypot(this.vx, this.vy);
      let forceX = this.mass * current - this.mass * this.vx * (0.055 + speed * 0.00014);
      let forceY = this.mass * (gravity - lift - vent * ventReach - this.vy * (stats.id === 'manta' && this.vy > 0 ? 1.35 : (this.geyserFlight > 0 && this.vy < 0 ? 2.2 : 0.43)));
      let torque = -this.omega * this.inertia * (this.grounded ? 1.3 : 0.62);
      const control = (input.throttle ? 1 : 0) - (input.brake ? 1 : 0);
      const orientation = this.gravityFlipped ? -1 : 1;
      const jet = this.jetThrust === true ? 200 : clamp(Number(this.jetThrust) || 0, 0, 360);
      const jetLimit = Math.max(350, stats.topSpeed * 1.4);
      const jetAcceleration = control * jet * clamp(1 - Math.max(0, this.vx * control) / jetLimit, 0, 1);
      forceX += this.mass * jetAcceleration;
      if (this.gravityFlipped && !this.grounded && !this.gravityTurn) {
        const roofSlope = this.terrain.gravityCeiling ? (this.terrain.gravityCeiling(this.x + 4) - this.terrain.gravityCeiling(this.x - 4)) / 8 : 0;
        const error = Math.atan2(Math.sin(Math.PI + Math.atan(roofSlope) - this.angle), Math.cos(Math.PI + Math.atan(roofSlope) - this.angle));
        torque += this.inertia * (error * 16 - this.omega * 6);
      }
      if (control) {
        const airControl = (stats.id === 'bike' ? 5.5 : stats.id === 'truck' ? 3.1 : 4.25) * 0.8;
        if (!this.grounded && !this.gravityTurn) torque -= control * this.inertia * airControl * (this.gravityFlipped ? 0.2 : 1);
        // A small real propeller force also permits recovery on slippery ice.
        forceX += control * this.mass * (12 + (stats.thrustLevel || 0) * 2.3) * c * orientation;
        forceY += control * this.mass * (12 + (stats.thrustLevel || 0) * 2.3) * s * orientation;
      }
      for (const w of this.wheels) {
        const rx = w.x - this.x, ry = w.y - this.y;
        const length = rx * downX + ry * downY - MOUNT_Y;
        const relativeX = w.vx - this.vx + this.omega * ry;
        const relativeY = w.vy - this.vy - this.omega * rx;
        const rate = relativeX * downX + relativeY * downY;
        const springForce = clamp(stats.spring * (stats.restLength - length) - stats.damping * rate, -this.mass * 3500, this.mass * 3500);
        const fx = springForce * downX, fy = springForce * downY;
        w.vx += (fx / this.wheelMass - w.vx * 0.075 + jetAcceleration + current) * dt;
        // Apply the same vent acceleration to the chassis and both wheels so
        // the updraft cannot create differential lift or pitch the suspension.
        w.vy += (fy / this.wheelMass + gravity - lift - vent * ventReach - w.vy * (this.geyserFlight > 0 && w.vy < 0 ? 1.8 : .16)) * dt;
        forceX -= fx; forceY -= fy;
        torque -= rx * fy - ry * fx;
        if (control) {
          const wheelSpeed = w.omega * w.radius * orientation;
          const target = (control > 0 ? stats.topSpeed : -stats.topSpeed * 0.42) * slow;
          let drive = stats.torque * slow * control * clamp(1 - wheelSpeed / target, 0, 1.6);
          // Braking gets immediate grip before engaging reverse.
          if (input.brake && wheelSpeed > 12) drive = -stats.torque * 1.45;
          drive *= orientation;
          w.omega += drive / this.wheelInertia * dt;
          torque -= drive * 0.09;
        }
        w.omega *= Math.exp(-(w.grounded ? 0.2 : 0.055) * dt);
        w.omega = clamp(w.omega, -100, 100);
      }
      this.vx += forceX * this.inverseMass * dt;
      this.vy += forceY * this.inverseMass * dt;
      this.omega = clamp(this.omega + torque * this.inverseInertia * dt, -11, 11);
      this.x += this.vx * dt; this.y += this.vy * dt; this.angle += this.omega * dt;
      this.collisionPrevious = { x: this.x - this.vx * dt, y: this.y - this.vy * dt, angle: this.angle - this.omega * dt };
      for (const w of this.wheels) { w.collisionX = w.x; w.collisionY = w.y; w.x += w.vx * dt; w.y += w.vy * dt; w.angle += w.omega * dt; w.grounded = false; }
      for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration++) {
        for (const w of this.wheels) this.suspensionConstraint(w);
        this.bodyCollisions();
        for (const w of this.wheels) this.wheelCollision(w, dt);
      }
    }
    jointImpulse(w, nx, ny, error, stiffness) {
      const rx = w.x - this.x, ry = w.y - this.y;
      const lever = rx * ny - ry * nx;
      const denominator = 1 / this.wheelMass + this.inverseMass + lever * lever * this.inverseInertia;
      const correction = -error * stiffness / denominator;
      w.x += nx * correction / this.wheelMass; w.y += ny * correction / this.wheelMass;
      this.x -= nx * correction * this.inverseMass; this.y -= ny * correction * this.inverseMass;
      this.angle -= lever * correction * this.inverseInertia;
      const relative = (w.vx - this.vx + this.omega * ry) * nx + (w.vy - this.vy - this.omega * rx) * ny;
      const impulse = -relative / denominator;
      w.vx += nx * impulse / this.wheelMass; w.vy += ny * impulse / this.wheelMass;
      this.vx -= nx * impulse * this.inverseMass; this.vy -= ny * impulse * this.inverseMass;
      this.omega -= lever * impulse * this.inverseInertia;
    }
    suspensionConstraint(w) {
      let c = Math.cos(this.angle), s = Math.sin(this.angle);
      const lateral = (w.x - this.x) * c + (w.y - this.y) * s - w.side * this.stats.wheelbase / 2;
      this.jointImpulse(w, c, s, lateral, 0.9);
      c = Math.cos(this.angle); s = Math.sin(this.angle);
      const length = (w.x - this.x) * -s + (w.y - this.y) * c - MOUNT_Y;
      const low = Math.max(5, this.stats.restLength - this.stats.travel * 0.6);
      const high = this.stats.restLength + this.stats.travel * 0.7;
      if (length < low || length > high) this.jointImpulse(w, -s, c, length - clamp(length, low, high), 0.85);
    }
    wheelCollision(w, dt) {
      this.supportWheel(w, this.terrain.height(w.x), this.terrain.slope(w.x), false);
      if (!this.gravityFlipped && this.terrain.platformsBetween) {
        const previousPlatform = w.platformId;
        w.platformId = null;
        for (const platform of this.terrain.platformsBetween(w.x, w.x)) {
          const height = this.terrain.platformHeight(w.x, platform), slope = this.terrain.platformSlope(w.x, platform);
          const previousHeight = this.terrain.platformHeight(w.collisionX === undefined ? w.x : w.collisionX, platform);
          const previousBottom = (w.collisionY === undefined ? w.y : w.collisionY) + w.radius;
          if (previousPlatform !== platform.id && !(previousBottom <= previousHeight + 0.2 && w.vy - slope * w.vx >= -1)) continue;
          if (this.supportWheel(w, height, slope, false)) w.platformId = platform.id;
        }
      }
      const ceiling = this.roof(w.x);
      if (this.gravityFlipped) {
        const slope = (this.roof(w.x + 4) - this.roof(w.x - 4)) / 8;
        this.supportWheel(w, ceiling, slope, true);
      } else if (w.y - w.radius < ceiling) {
        w.y = ceiling + w.radius;
        if (w.vy < 0) w.vy = 0;
      }
    }
    supportWheel(w, height, slope, ceiling) {
      const scale = Math.sqrt(1 + slope * slope);
      const side = ceiling ? -1 : 1;
      const nx = slope / scale * side, ny = -1 / scale * side;
      const tx = 1 / scale, ty = slope / scale;
      const penetration = w.radius - (height - w.y) / scale * side;
      if (penetration > -0.06) {
        w.grounded = true;
        if (penetration > 0) { w.x += nx * penetration; w.y += ny * penetration; }
        const normalSpeed = w.vx * nx + w.vy * ny;
        const normalImpulse = Math.max(0, -normalSpeed * this.wheelMass);
        if (normalSpeed < 0) {
          this.impact = Math.max(this.impact, -normalSpeed);
          w.vx -= normalSpeed * nx; w.vy -= normalSpeed * ny;
        }
        const tangentSpeed = w.vx * tx + w.vy * ty;
        const slip = tangentSpeed - w.omega * w.radius * side;
        const effectiveMass = 1 / this.wheelMass + w.radius * w.radius / this.wheelInertia;
        const grip = this.stats.grip * this.terrain.stage.friction;
        const friction = clamp(-slip / effectiveMass, -grip * normalImpulse, grip * normalImpulse);
        w.vx += tx * friction / this.wheelMass; w.vy += ty * friction / this.wheelMass;
        w.omega -= friction * w.radius / this.wheelInertia * side;
        // Rolling resistance is proportional to supported load, not frame count.
        const rolling = Math.min(Math.abs(w.omega), normalImpulse * 0.014 * w.radius / this.wheelInertia);
        w.omega -= Math.sign(w.omega) * rolling;
        return true;
      }
      return false;
    }
    bodyContact(localX, localY, radius, dome) {
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      const rx = localX * c - localY * s, ry = localX * s + localY * c;
      const x = this.x + rx, y = this.y + ry;
      const slope = this.terrain.slope(x), scale = Math.sqrt(1 + slope * slope);
      const groundPenetration = radius - (this.terrain.height(x) - y) / scale;
      if (groundPenetration > 0) this.resolveBodyContact(rx, ry, slope / scale, -1 / scale, groundPenetration, dome && c < 0.2);
      if (!this.gravityFlipped && this.terrain.platformsBetween) for (const platform of this.terrain.platformsBetween(x, x)) {
        const platformY = this.terrain.platformHeight(x, platform), platformSlope = this.terrain.platformSlope(x, platform);
        const previous = this.collisionPrevious || this;
        const oldX = previous.x + localX * Math.cos(previous.angle) - localY * Math.sin(previous.angle);
        const oldBottom = previous.y + localX * Math.sin(previous.angle) + localY * Math.cos(previous.angle) + radius;
        const riding = this.wheels.some(function (wheel) { return wheel.platformId === platform.id; });
        const wheelsAbove = this.wheels.every((wheel) => (wheel.collisionY === undefined ? wheel.y : wheel.collisionY) + wheel.radius <= this.terrain.platformHeight(wheel.collisionX === undefined ? wheel.x : wheel.collisionX, platform) + 0.2);
        if ((!riding && !wheelsAbove) || !(oldBottom <= this.terrain.platformHeight(oldX, platform) + 0.2 || (riding && y < platformY))) continue;
        if (!riding && this.vy - platformSlope * this.vx < -1) continue;
        const platformScale = Math.sqrt(1 + platformSlope * platformSlope);
        const penetration = radius - (platformY - y) / platformScale;
        if (penetration > 0) {
          this.resolveBodyContact(rx, ry, platformSlope / platformScale, -1 / platformScale, penetration, dome && c < 0.2);
          if (dome && c < INVERTED_COS) this.invertedDomeContact = true;
        }
      }
      const ceiling = this.roof(x);
      const ceilingPenetration = ceiling - (y - radius);
      if (ceilingPenetration > 0) this.resolveBodyContact(rx, ry, 0, 1, ceilingPenetration, dome && (!this.gravityFlipped || c > -0.2));
      if (dome && c * (this.gravityFlipped ? -1 : 1) < INVERTED_COS && (groundPenetration > 0 || ceilingPenetration > 0)) this.invertedDomeContact = true;
    }
    resolveBodyContact(rx, ry, nx, ny, penetration, vulnerable) {
      // Tire contact and hull contact are separate: an overturned rover can
      // have both wheels in the water while resting firmly on its dome.
      this.bodyGrounded = true;
      const lever = rx * ny - ry * nx;
      const effectiveMass = this.inverseMass + lever * lever * this.inverseInertia;
      const normalSpeed = (this.vx - this.omega * ry) * nx + (this.vy + this.omega * rx) * ny;
      const correction = Math.max(0, penetration - 0.015) * 0.85 / effectiveMass;
      this.x += nx * correction * this.inverseMass; this.y += ny * correction * this.inverseMass;
      this.angle += lever * correction * this.inverseInertia;
      if (normalSpeed < 0) {
        const impulse = -normalSpeed / effectiveMass;
        this.vx += nx * impulse * this.inverseMass; this.vy += ny * impulse * this.inverseMass;
        this.omega += lever * impulse * this.inverseInertia;
        this.impact = Math.max(this.impact, -normalSpeed);
        if (vulnerable && !this.gravityGrace && -normalSpeed > 82) this.crashed = 'Hull crushed';
        const tangentX = -ny, tangentY = nx;
        const tangentSpeed = this.vx * tangentX + this.vy * tangentY;
        const drag = clamp(tangentSpeed * this.mass * 0.12, -impulse * 0.32, impulse * 0.32);
        this.vx -= tangentX * drag * this.inverseMass; this.vy -= tangentY * drag * this.inverseMass;
      }
    }
    bodyCollisions() {
      const halfWidth = this.stats.wheelbase * 0.45;
      this.bodyContact(-halfWidth, 9, 5, false);
      this.bodyContact(halfWidth, 9, 5, false);
      this.bodyContact(-halfWidth, -7, 4, false);
      this.bodyContact(halfWidth, -7, 4, false);
      this.bodyContact(0, DOME_Y, DOME_RADIUS, true);
    }
    snapshot() {
      return { x: this.x, y: this.y, vx: this.vx, vy: this.vy, angle: this.angle, omega: this.omega, oxygen: this.oxygen, grounded: this.grounded, bodyGrounded: this.bodyGrounded, crashed: this.crashed, gravityFlipped: this.gravityFlipped, jetThrust: this.jetThrust };
    }
  }
  AR.Rover = Rover;
})(typeof globalThis !== 'undefined' ? globalThis : this);
