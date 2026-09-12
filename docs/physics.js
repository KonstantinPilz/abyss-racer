(function (root) {
  'use strict';
  const AR = root.AR = root.AR || {};
  const MOUNT_Y = 8;
  const DOME_Y = -18;
  const DOME_RADIUS = 20;
  const SOLVER_ITERATIONS = 5;
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
      this.savePrevious();
    }
    gravity() { return this.terrain.stage.gravity * (1 - this.stats.buoyancy); }
    savePrevious() {
      this.prev = { x: this.x, y: this.y, angle: this.angle, wheels: this.wheels.map(function (w) { return { x: w.x, y: w.y, angle: w.angle }; }) };
    }
    step(input, dt) {
      this.savePrevious();
      this.impact = 0; this.burstFired = false; this.bodyGrounded = false;
      if (this.crashed) return;
      dt = clamp(Number(dt) || AR.FIXED_DT, 0, 1 / 30);
      input = input || {};
      this.cooldown = Math.max(0, this.cooldown - dt);
      this.oxygen = Math.max(0, this.oxygen - dt * (input.throttle ? 1.02 : 0.85));
      if (this.oxygen <= 0) { this.crashed = 'Oxygen depleted'; return; }
      if (input.burst && this.cooldown === 0 && this.oxygen > 8) {
        this.oxygen -= 8;
        this.vy -= this.stats.burst;
        this.wheels.forEach((w) => { w.vy -= this.stats.burst * 0.75; });
        this.cooldown = this.stats.cooldown; this.burstFired = true;
      }
      if (input.throttle || input.brake || this.burstFired || this.terrain.vent(this.x) > 0) {
        this.sleeping = false; this.sleepTime = 0;
      }
      if (this.sleeping) return;
      // Two normal substeps keep the suspension stiff without explicit-Euler
      // instability. Faster injected test velocities receive additional steps,
      // so no wheel travels farther than approximately 6 px before collision.
      const speed = Math.max(Math.abs(this.vx), Math.abs(this.vy), ...this.wheels.map(function (w) { return Math.hypot(w.vx, w.vy); }));
      const count = Math.min(16, Math.max(2, Math.ceil(dt * speed / 6)));
      const h = dt / count;
      for (let sub = 0; sub < count; sub++) this.substep(input, h);
      this.grounded = this.wheels.some(function (w) { return w.grounded; });
      const quiet = Math.hypot(this.vx, this.vy) < 0.9 && Math.abs(this.omega) < 0.025 && this.wheels.every(function (w) { return w.grounded && Math.hypot(w.vx, w.vy) < 1.2; });
      if (!input.throttle && !input.brake && quiet) this.sleepTime += dt;
      else this.sleepTime = 0;
      // Sleeping is only allowed after both contacts are settled. It removes
      // subpixel suspension chatter while retaining rolling on actual slopes.
      if (this.sleepTime > 0.65) {
        this.sleeping = true; this.vx = this.vy = this.omega = 0;
        this.wheels.forEach(function (w) { w.vx = w.vy = w.omega = 0; });
      }
    }
    substep(input, dt) {
      const stats = this.stats;
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      const downX = -s, downY = c;
      const gravity = this.gravity();
      const vent = this.terrain.vent(this.x);
      const ventReach = clamp(1 - Math.max(0, this.terrain.height(this.x) - this.y - 70) / 260, 0, 1);
      const speed = Math.hypot(this.vx, this.vy);
      let forceX = -this.mass * this.vx * (0.055 + speed * 0.00014);
      let forceY = this.mass * (gravity - vent * ventReach - this.vy * (stats.id === 'manta' && this.vy > 0 ? 1.35 : 0.43));
      let torque = -this.omega * this.inertia * (this.grounded ? 1.3 : 0.62);
      const control = (input.throttle ? 1 : 0) - (input.brake ? 1 : 0);
      if (control) {
        const airControl = stats.id === 'bike' ? 5.5 : stats.id === 'truck' ? 3.1 : 4.25;
        if (!this.grounded) torque -= control * this.inertia * airControl;
        // A small real propeller force also permits recovery on slippery ice.
        forceX += control * this.mass * (12 + (stats.thrustLevel || 0) * 2.3) * c;
        forceY += control * this.mass * (12 + (stats.thrustLevel || 0) * 2.3) * s;
      }
      for (const w of this.wheels) {
        const rx = w.x - this.x, ry = w.y - this.y;
        const length = rx * downX + ry * downY - MOUNT_Y;
        const relativeX = w.vx - this.vx + this.omega * ry;
        const relativeY = w.vy - this.vy - this.omega * rx;
        const rate = relativeX * downX + relativeY * downY;
        const springForce = clamp(stats.spring * (stats.restLength - length) - stats.damping * rate, -this.mass * 3500, this.mass * 3500);
        const fx = springForce * downX, fy = springForce * downY;
        w.vx += (fx / this.wheelMass - w.vx * 0.075) * dt;
        w.vy += (fy / this.wheelMass + gravity - vent * ventReach * 0.65 - w.vy * 0.16) * dt;
        forceX -= fx; forceY -= fy;
        torque -= rx * fy - ry * fx;
        if (control) {
          const wheelSpeed = w.omega * w.radius;
          const target = control > 0 ? stats.topSpeed : -stats.topSpeed * 0.42;
          let drive = stats.torque * control * clamp(1 - wheelSpeed / target, 0, 1.6);
          // Braking gets immediate grip before engaging reverse.
          if (input.brake && wheelSpeed > 12) drive = -stats.torque * 1.45;
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
      for (const w of this.wheels) { w.x += w.vx * dt; w.y += w.vy * dt; w.angle += w.omega * dt; w.grounded = false; }
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
      const slope = this.terrain.slope(w.x);
      const scale = Math.sqrt(1 + slope * slope);
      const nx = slope / scale, ny = -1 / scale;
      const tx = 1 / scale, ty = slope / scale;
      const penetration = w.radius - (this.terrain.height(w.x) - w.y) / scale;
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
        const slip = tangentSpeed - w.omega * w.radius;
        const effectiveMass = 1 / this.wheelMass + w.radius * w.radius / this.wheelInertia;
        const grip = this.stats.grip * this.terrain.stage.friction;
        const friction = clamp(-slip / effectiveMass, -grip * normalImpulse, grip * normalImpulse);
        w.vx += tx * friction / this.wheelMass; w.vy += ty * friction / this.wheelMass;
        w.omega -= friction * w.radius / this.wheelInertia;
        // Rolling resistance is proportional to supported load, not frame count.
        const rolling = Math.min(Math.abs(w.omega), normalImpulse * 0.014 * w.radius / this.wheelInertia);
        w.omega -= Math.sign(w.omega) * rolling;
      }
      const ceiling = this.terrain.ceiling(w.x);
      if (w.y - w.radius < ceiling) {
        w.y = ceiling + w.radius;
        if (w.vy < 0) w.vy = 0;
      }
    }
    bodyContact(localX, localY, radius, dome) {
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      const rx = localX * c - localY * s, ry = localX * s + localY * c;
      const x = this.x + rx, y = this.y + ry;
      const slope = this.terrain.slope(x), scale = Math.sqrt(1 + slope * slope);
      const groundPenetration = radius - (this.terrain.height(x) - y) / scale;
      if (groundPenetration > 0) this.resolveBodyContact(rx, ry, slope / scale, -1 / scale, groundPenetration, dome && c < 0.2);
      const ceiling = this.terrain.ceiling(x);
      const ceilingPenetration = ceiling - (y - radius);
      if (ceilingPenetration > 0) this.resolveBodyContact(rx, ry, 0, 1, ceilingPenetration, dome);
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
        if (vulnerable && -normalSpeed > 82) this.crashed = 'Hull crushed';
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
      return { x: this.x, y: this.y, vx: this.vx, vy: this.vy, angle: this.angle, omega: this.omega, oxygen: this.oxygen, grounded: this.grounded, bodyGrounded: this.bodyGrounded, crashed: this.crashed };
    }
  }
  AR.Rover = Rover;
})(typeof globalThis !== 'undefined' ? globalThis : this);
