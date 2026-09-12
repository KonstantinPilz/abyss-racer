(function (root) {
  'use strict';

  const AR = root.AR = root.AR || {};
  const TAU = Math.PI * 2;
  const LIGHTS = { aqua: '#7fffe8', coral: '#ffad91', gold: '#ffe28c', violet: '#c2a6ff', pink: '#ff93df', ice: '#c0f5ff' };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return v - Math.floor(v); };
  const lightColor = value => LIGHTS[value] || (typeof value === 'string' && value[0] === '#' ? value : LIGHTS.aqua);

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function ellipse(c, x, y, rx, ry, color) {
    c.beginPath(); c.ellipse(x, y, Math.max(.01, rx), Math.max(.01, ry), 0, 0, TAU);
    if (color) { c.fillStyle = color; c.fill(); }
  }
  function glow(c, x, y, r, color, alpha) {
    c.save(); c.globalAlpha *= alpha === undefined ? 1 : alpha;
    const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, color); g.addColorStop(1, 'transparent');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.restore();
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
      this.lightCanvas = document.createElement('canvas'); this.lightCtx = this.lightCanvas.getContext('2d');
      this.width = 1; this.height = 1; this.dpr = 1; this.time = 0;
      this.camX = 0; this.camY = 0; this.zoom = 1; this.lastTerrain = null; this.lastState = '';
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.width = Math.max(1, rect.width || root.innerWidth || 1280);
      this.height = Math.max(1, rect.height || root.innerHeight || 720);
      this.dpr = Math.max(1, root.devicePixelRatio || 1);
      this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
      this.lightCanvas.width = this.canvas.width; this.lightCanvas.height = this.canvas.height;
    }

    draw(scene, dt, alpha) {
      if (!scene || !scene.rover || !scene.terrain) return;
      const c = this.ctx, w = this.width, h = this.height;
      const rover = scene.rover, terrain = scene.terrain, stage = scene.stage || terrain.stage || {};
      const p = stage.palette || {}, id = stage.id || 'reef';
      const prev = rover.prev || rover; alpha = clamp(alpha === undefined ? 1 : alpha, 0, 1);
      const x = mix(prev.x, rover.x, alpha), y = mix(prev.y, rover.y, alpha);
      const angle = mix(prev.angle, rover.angle, alpha);
      this.time = scene.time === undefined ? this.time + Math.min(dt || 0, .05) : scene.time;
      const running = ['RUNNING', 'PAUSED', 'GAMEOVER'].includes(scene.state);
      const baseZoom = clamp(w / 1060, .78, 1.48);
      const desiredZoom = baseZoom * (running ? 1.07 / (1 + Math.min(Math.abs(rover.vx), 580) / 1500) : 1.7);
      const smoothing = 1 - Math.exp(-clamp(dt === undefined ? 1 / 60 : dt, 0, .05) * 4);
      const resetCamera = this.lastTerrain !== terrain || (running && !['RUNNING', 'PAUSED', 'GAMEOVER'].includes(this.lastState));
      this.zoom = resetCamera ? desiredZoom : mix(this.zoom, desiredZoom, smoothing);
      const anchor = running ? (w < 640 ? .34 : .31) : (w < 640 ? .65 : .70);
      const targetX = x - (anchor - .5) * w / this.zoom + (running ? clamp(rover.vx * .18, -28, 72) : 0);
      const targetY = y + (running ? clamp(rover.vy * .13, -30, 40) : 0);
      if (resetCamera) {
        this.camX = targetX; this.camY = targetY; this.zoom = desiredZoom;
      } else {
        this.camX = mix(this.camX, targetX, smoothing * 1.35); this.camY = mix(this.camY, targetY, smoothing);
      }
      this.lastTerrain = terrain; this.lastState = scene.state;
      const floor = running ? .67 : (w < 640 ? .70 : .64);
      let tx = w * .5 - this.camX * this.zoom, ty = h * floor - this.camY * this.zoom;
      const shake = clamp(scene.shake || 0, 0, 10);
      tx += Math.sin(this.time * 113) * shake; ty += Math.cos(this.time * 97) * shake * .6;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.background(c, stage, p, tx, ty);
      c.save(); c.translate(tx, ty); c.scale(this.zoom, this.zoom);
      this.roverX = x;
      const left = -tx / this.zoom - 100, right = (w - tx) / this.zoom + 100;
      const bottom = (h - ty) / this.zoom + 200;
      this.decorations(c, terrain, id, left, right, false);
      this.ground(c, terrain, p, left, right, bottom, id);
      if (id === 'ice') this.iceCeiling(c, terrain, left, right, -ty / this.zoom - 100);
      this.pickups(c, scene.pickups || []);
      this.particles(c, scene.particles || [], false);
      this.drawVehicle(c, rover, alpha, scene.headlight);
      this.decorations(c, terrain, id, left, right, true);
      this.particles(c, scene.particles || [], true);
      c.restore();
      this.ambient(c, stage);
      if (id === 'abyss' || id === 'wreck' || id === 'volcanic') {
        this.darkness(x * this.zoom + tx, y * this.zoom + ty, angle, scene.headlight, id);
      }
      c.save(); c.translate(tx, ty); c.scale(this.zoom, this.zoom);
      this.floatingText(c, scene.texts || []); c.restore();
      const vignette = c.createRadialGradient(w * .51, h * .42, h * .25, w * .51, h * .45, Math.max(w, h) * .70);
      vignette.addColorStop(0, 'transparent'); vignette.addColorStop(1, id === 'abyss' ? 'rgba(0,0,9,.6)' : 'rgba(0,13,27,.48)');
      c.fillStyle = vignette; c.fillRect(0, 0, w, h);
    }

    background(c, stage, p) {
      const w = this.width, h = this.height, t = this.time, id = stage.id;
      const bg = c.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, p.top || '#083e50'); bg.addColorStop(1, p.bottom || '#052c38');
      c.fillStyle = bg; c.fillRect(0, 0, w, h);
      glow(c, w * .56, -h * .10, h * 1.2, id === 'volcanic' ? '#924f3a' : id === 'ice' ? '#94dced' : '#39c8bf', id === 'abyss' ? .08 : .19);
      if (id !== 'abyss' && id !== 'volcanic' && id !== 'wreck') {
        c.save(); c.globalCompositeOperation = 'screen';
        for (let i = 0; i < 7; i++) {
          const x = w * (.09 + i * .17) + Math.sin(t * .12 + i) * 22;
          const g = c.createLinearGradient(x, 0, x + h * .28, h);
          g.addColorStop(0, 'rgba(146,245,232,.08)'); g.addColorStop(.65, 'rgba(106,237,221,.025)'); g.addColorStop(1, 'transparent');
          c.fillStyle = g; c.beginPath(); c.moveTo(x, -20); c.lineTo(x + 28 + hash(i) * 37, -20);
          c.lineTo(x + h * .58 + 130, h); c.lineTo(x + h * .43 - 30, h); c.closePath(); c.fill();
        }
        c.restore();
      }
      // Procedural silhouettes are anchored to the world at different parallax rates.
      for (let layer = 0; layer < 3; layer++) {
        const spacing = 145 + layer * 55, offset = this.camX * (.055 + layer * .07);
        const start = Math.floor(offset / spacing) - 2;
        c.fillStyle = id === 'volcanic' ? ['#222c39', '#1f2830', '#162b30'][layer] : id === 'ice' ? ['#174659', '#164452', '#103d47'][layer] : ['#0a3a48', '#093a44', '#063b3d'][layer];
        c.globalAlpha = [.33, .46, .56][layer];
        c.beginPath(); c.moveTo(-20, h);
        for (let i = start; i < start + Math.ceil(w / spacing) + 5; i++) {
          const sx = i * spacing - offset, sy = h * (.51 + layer * .11) - hash(i + layer * 83) * h * .19;
          c.lineTo(sx, sy + 85); c.bezierCurveTo(sx + 18, sy + 80, sx + 10, sy + 14, sx + 48, sy);
          c.bezierCurveTo(sx + 73, sy - 12, sx + 90, sy + 33, sx + 98, sy + 46);
          c.lineTo(sx + spacing, sy + 100);
        }
        c.lineTo(w + 40, h); c.closePath(); c.fill(); c.globalAlpha = 1;
      }
      if (id === 'kelp') {
        for (let i = -2; i < Math.ceil(w / 115) + 2; i++) {
          const x = i * 115 - (this.camX * .23 % 115);
          c.save(); c.translate(x, h * 1.05); c.globalAlpha = .13;
          this.kelp(c, i + Math.floor(this.camX * .23 / 115), h * (.35 + hash(i) * .5), '#57a888'); c.restore();
        }
      }
      this.fish(c, stage);
      if (id === 'abyss') {
        for (let i = 0; i < 8; i++) {
          const x = ((hash(i + 21) * w * 1.4 - this.camX * .08 + t * (i % 2 ? 5 : -4)) % (w * 1.4) + w * 1.4) % (w * 1.4) - w * .2;
          const y = h * (.2 + hash(i + 63) * .4);
          glow(c, x + 15, y - 11, 15, '#b5eed7', .22); ellipse(c, x + 15, y - 11, 2, 2, '#cfedb6');
          c.strokeStyle = '#326160'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 2, y - 24, x + 15, y - 11); c.stroke();
          ellipse(c, x, y + 1, 15, 7, '#071e28'); ellipse(c, x + 8, y - 1, 1.5, 1.5, '#c8dea7');
        }
      }
    }

    fish(c, stage) {
      const w = this.width, h = this.height, t = this.time;
      if (stage.id === 'abyss') return;
      c.save();
      for (let school = 0; school < 3; school++) {
        const direction = school % 2 ? -1 : 1;
        const travel = t * (8 + school * 3) * direction - this.camX * (.12 + school * .05);
        const origin = ((school * w * .47 + travel) % (w + 330) + w + 330) % (w + 330) - 150;
        c.fillStyle = stage.id === 'ice' ? '#65a5b5' : school === 1 ? '#65ab9f' : '#377f85'; c.globalAlpha = .42;
        for (let j = 0; j < 7; j++) {
          const x = origin + hash(j + school * 17) * 165;
          const y = h * (.20 + school * .13) + hash(j + 23) * 58 + Math.sin(t * .6 + j) * 7;
          const size = 2.7 + hash(j + 51) * 2.2;
          c.save(); c.translate(x, y); c.scale(direction, 1);
          ellipse(c, 0, 0, size * 1.7, size, c.fillStyle);
          c.beginPath(); c.moveTo(-size * 1.5, 0); c.lineTo(-size * 3, -size * .9); c.lineTo(-size * 3, size * .9); c.closePath(); c.fill(); c.restore();
        }
      }
      c.restore();
    }

    ground(c, terrain, p, left, right, bottom, id) {
      const points = [];
      for (let x = Math.floor(left / 12) * 12; x <= right + 12; x += 12) points.push([x, terrain.height(x)]);
      const path = () => {
        c.beginPath(); points.forEach((a, i) => i ? c.lineTo(a[0], a[1]) : c.moveTo(a[0], a[1]));
        c.lineTo(right + 24, bottom); c.lineTo(left - 24, bottom); c.closePath();
      };
      path(); c.fillStyle = p.ground || '#173b3c'; c.fill();
      c.save(); path(); c.clip();
      // The translucent sand bank and caustics follow the actual collision surface.
      c.beginPath(); points.forEach((a, i) => i ? c.lineTo(a[0], a[1] + 21) : c.moveTo(a[0], a[1] + 21));
      c.strokeStyle = p.sand || '#799e80'; c.lineWidth = 53; c.globalAlpha = .10; c.stroke(); c.globalAlpha = 1;
      for (let i = Math.floor(left / 30); i < right / 30; i++) {
        const x = i * 30 + hash(i + 612) * 25, y = terrain.height(x);
        const depth = hash(i + 718) * 125;
        ellipse(c, x, y + depth + 7, 1 + hash(i + 2) * 3, .6 + hash(i + 21), 'rgba(170,214,174,.12)');
        if (i % 3 === 0 && id !== 'abyss') {
          c.strokeStyle = id === 'volcanic' ? 'rgba(255,173,95,.10)' : 'rgba(180,255,221,.105)'; c.lineWidth = 1.5;
          c.beginPath(); c.ellipse(x + Math.sin(this.time * .7 + i) * 13, y + 16, 24 + Math.sin(this.time + i) * 7, 5, -.12, .2, Math.PI * 1.5); c.stroke();
        }
      }
      c.restore();
      c.beginPath(); points.forEach((a, i) => i ? c.lineTo(a[0], a[1]) : c.moveTo(a[0], a[1]));
      c.strokeStyle = p.sand || '#83bbaa'; c.lineWidth = id === 'ice' ? 8 : 6; c.lineJoin = 'round'; c.stroke();
      c.strokeStyle = id === 'volcanic' ? 'rgba(255,157,102,.5)' : 'rgba(198,255,215,.33)'; c.lineWidth = 1.4; c.stroke();
      // Sparse embedded stones give the sand edge texture without changing physics.
      for (let i = Math.floor(left / 61); i < right / 61; i++) {
        const x = i * 61 + hash(i + 92) * 35, y = terrain.height(x);
        ellipse(c, x, y + 4, 2 + hash(i + 23) * 5, 1.5 + hash(i + 61) * 2, id === 'ice' ? '#70a7ad' : '#3f726b');
      }
    }

    decorations(c, terrain, id, left, right, front) {
      const spacing = front ? 178 : 104;
      for (let i = Math.floor(left / spacing) - 1; i < right / spacing + 1; i++) {
        const seed = i + (front ? 702 : 123), n = hash(seed), x = i * spacing + hash(seed + 411) * spacing * .65;
        const y = terrain.height(x) + (front ? 18 : 3), size = 20 + hash(seed + 22) * (front ? 43 : 70);
        if (front && (n < .56 || Math.abs(x - this.roverX) < 92)) continue;
        c.save(); c.translate(x, y); c.scale(front ? 1.10 : 1, 1); c.globalAlpha = front ? .93 : .78;
        if (id === 'kelp') {
          this.kelp(c, seed, size * 2.2, n > .55 ? '#558f51' : '#267468');
          if (n > .75) this.coral(c, seed + 7, size * .55, '#bf9770');
        } else if (id === 'volcanic') {
          this.rock(c, seed, size * .70, '#3b3d45');
          if (n > .6) {
            c.fillStyle = '#262d35'; c.fillRect(-10, -size, 21, size); ellipse(c, 0, -size, 11, 4, '#c37245');
            glow(c, 0, -size, 35, '#ff8d43', .27);
          }
        } else if (id === 'ice') {
          this.rock(c, seed, size * .6, n > .5 ? '#548c9b' : '#2b6b7e');
          if (n > .6) { c.fillStyle = '#86c1c3'; c.beginPath(); c.moveTo(-8, 0); c.lineTo(-5, -size * .7); c.lineTo(1, -size); c.lineTo(9, 0); c.fill(); }
        } else if (id === 'abyss') {
          this.rock(c, seed, size, '#203546');
          if (n > .65) this.coral(c, seed, size * .6, '#3a6276');
          for (let j = 0; j < 3; j++) { const xx = j * 11 - 12, yy = -7 - hash(j + seed) * 10; glow(c, xx, yy, 11, '#77e7d9', .22); ellipse(c, xx, yy, 2, 1.5, '#92d6c3'); }
        } else if (id === 'wreck') {
          this.kelp(c, seed, size * .8, '#3b766d');
          if (n > .6) this.coral(c, seed, size * .6, '#ad7884');
          if (n < .22) {
            c.rotate((n - .11) * 2); c.fillStyle = '#4d514d'; c.fillRect(-22, -10, 50, 9);
            c.strokeStyle = '#7b7665'; c.lineWidth = 2; c.strokeRect(-21, -10, 48, 8);
            c.strokeStyle = '#55635b'; c.beginPath(); c.arc(0, -17, 14, Math.PI, TAU); c.stroke();
          }
        } else {
          if (n < .28) this.kelp(c, seed, size * 1.15, '#3b9d84');
          else if (n < .8) this.coral(c, seed, size, n > .56 ? '#d88882' : '#dfad72');
          else this.rock(c, seed, size * .6, '#397c78');
        }
        c.restore();
      }
      if (!front && id === 'wreck') {
        for (let i = Math.floor(left / 1050); i <= right / 1050; i++) {
          const x = i * 1050 + 520; this.wreck(c, x, terrain.height(x) + 13, hash(i + 719));
        }
      }
      if (!front && id === 'volcanic') {
        for (let i = Math.max(0, Math.floor((left - 670) / 960)); i <= (right - 670) / 960; i++) {
          const x = 670 + i * 960, y = terrain.height(x);
          glow(c, x, y - 20, 90, '#fa744a', .20);
          ellipse(c, x, y - 2, 24, 7, '#241f29'); ellipse(c, x, y - 3, 20, 4, '#ec9b57');
          for (let j = 0; j < 14; j++) {
            const rise = ((this.time * (24 + j * 3) + j * 21) % 190);
            c.save(); c.globalAlpha = (1 - rise / 190) * .30;
            ellipse(c, x + Math.sin(rise * .035 + j) * (8 + rise * .07), y - 5 - rise, 2 + rise * .02, 4 + rise * .04, '#ffb46f'); c.restore();
          }
        }
      }
    }

    coral(c, seed, height, color) {
      c.save(); c.strokeStyle = color; c.lineCap = 'round'; c.lineJoin = 'round';
      const sway = Math.sin(this.time * .6 + seed) * 2;
      for (let j = 0; j < 6; j++) {
        const xx = (j - 2.5) * height * .11;
        const yy = -height * (.36 + hash(seed + j * 3) * .64);
        c.lineWidth = 4 + height * .025;
        c.beginPath(); c.moveTo(0, 1); c.bezierCurveTo(xx * .3, -height * .3, xx + sway, yy * .6, xx + sway, yy); c.stroke();
        for (let k = 0; k < 3; k++) {
          const fy = yy * (.4 + k * .2), dir = j % 2 ? 1 : -1;
          c.lineWidth = 3 + height * .015;
          c.beginPath(); c.moveTo(xx * .75 + sway, fy); c.quadraticCurveTo(xx + dir * height * .15, fy + 1, xx + dir * height * .17, fy - height * .12); c.stroke();
        }
      }
      c.globalAlpha *= .4; c.strokeStyle = '#ffe0b3'; c.lineWidth = 1.3; c.beginPath(); c.moveTo(-1, -2); c.quadraticCurveTo(-2, -height * .35, sway, -height * .8); c.stroke(); c.restore();
    }

    kelp(c, seed, height, color) {
      c.save(); c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 2.5;
      for (let stem = 0; stem < 3; stem++) {
        const bx = (stem - 1) * 8, hh = height * (.63 + hash(seed + stem + 65) * .38);
        const wave = Math.sin(this.time * .6 + seed + stem) * 10;
        c.beginPath(); c.moveTo(bx, 0); c.bezierCurveTo(bx - 10, -hh * .3, bx + wave, -hh * .75, bx + wave + 3, -hh); c.stroke();
        for (let leaf = 1; leaf < 8; leaf++) {
          const yy = -hh * leaf / 8, xx = bx + wave * leaf / 8, dir = leaf % 2 ? 1 : -1;
          c.beginPath(); c.moveTo(xx, yy); c.bezierCurveTo(xx + dir * 24, yy - 4, xx + dir * 30, yy - 24, xx + dir * 25, yy - 29);
          c.quadraticCurveTo(xx + dir * 7, yy - 24, xx, yy); c.fill();
        }
      }
      c.restore();
    }

    rock(c, seed, size, color) {
      c.fillStyle = color; c.beginPath(); c.moveTo(-size * .65, 2); c.lineTo(-size * .53, -size * .43);
      c.lineTo(-size * .20, -size * (.55 + hash(seed) * .25)); c.lineTo(size * .33, -size * .61);
      c.lineTo(size * .57, -size * .24); c.lineTo(size * .72, 3); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(164,216,182,.13)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-size * .51, -size * .42); c.lineTo(-size * .19, -size * (.55 + hash(seed) * .25)); c.lineTo(size * .32, -size * .60); c.stroke();
    }

    wreck(c, x, y, seed) {
      c.save(); c.translate(x, y); c.rotate(-.13 + seed * .26); c.globalAlpha = .59;
      c.fillStyle = '#25464b'; c.strokeStyle = '#59766b'; c.lineWidth = 4;
      c.beginPath(); c.moveTo(-140, -68); c.lineTo(-105, -17); c.quadraticCurveTo(0, 25, 118, -17); c.lineTo(155, -72);
      c.lineTo(90, -59); c.lineTo(60, -84); c.lineTo(40, -48); c.lineTo(-6, -52); c.lineTo(-36, -76); c.lineTo(-55, -51); c.closePath(); c.fill(); c.stroke();
      for (let i = -2; i < 3; i++) { c.beginPath(); c.moveTo(i * 40, -48); c.lineTo(i * 32, -3); c.stroke(); }
      c.lineWidth = 7; c.beginPath(); c.moveTo(-35, -44); c.lineTo(-55, -212); c.stroke();
      c.lineWidth = 4; c.beginPath(); c.moveTo(-100, -138); c.lineTo(4, -156); c.stroke();
      c.strokeStyle = 'rgba(137,158,119,.42)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(-55, -207); c.lineTo(-129, -62); c.moveTo(-55, -207); c.lineTo(132, -63); c.stroke();
      c.restore();
    }

    iceCeiling(c, terrain, left, right, top) {
      if (!Number.isFinite(terrain.ceiling((left + right) / 2))) return;
      c.beginPath(); c.moveTo(left, top);
      for (let x = left; x <= right + 15; x += 15) c.lineTo(x, terrain.ceiling(x));
      c.lineTo(right + 20, top); c.closePath(); c.fillStyle = '#25677f'; c.fill();
      c.beginPath(); for (let x = left; x <= right + 15; x += 15) x === left ? c.moveTo(x, terrain.ceiling(x)) : c.lineTo(x, terrain.ceiling(x));
      c.strokeStyle = '#95d9df'; c.lineWidth = 5; c.stroke();
      for (let i = Math.floor(left / 74); i < right / 74; i++) {
        const x = i * 74, y = terrain.ceiling(x) - 3;
        c.fillStyle = 'rgba(109,181,194,.7)'; c.beginPath(); c.moveTo(x - 12, y - 28); c.lineTo(x + 6, y + 2); c.lineTo(x + 18, y - 28); c.closePath(); c.fill();
      }
    }

    pickups(c, pickups) {
      for (const item of pickups) {
        if (item.collected || Math.abs(item.x - this.camX) > this.width / this.zoom) continue;
        const bob = item.type === 'chest' ? 0 : Math.sin(this.time * 2.7 + item.x * .017) * 3;
        c.save(); c.translate(item.x, item.y + bob);
        if (item.type === 'oxygen') {
          glow(c, 0, 0, 28, '#76fddd', .12);
          c.fillStyle = '#122f38'; roundRect(c, -10, -17, 20, 33, 7); c.fill();
          const g = c.createLinearGradient(-9, 0, 9, 0); g.addColorStop(0, '#64cbbb'); g.addColorStop(.4, '#c1fae5'); g.addColorStop(1, '#31877e');
          c.fillStyle = g; roundRect(c, -8, -14, 16, 28, 5); c.fill(); c.fillStyle = '#263e43'; c.fillRect(-4, -21, 8, 7);
          c.fillStyle = '#144b4f'; c.font = 'bold 10px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('O₂', 0, 4);
          c.fillStyle = '#e4ffec'; c.fillRect(-6, -8, 2, 8);
        } else if (item.type === 'chest') {
          glow(c, 0, -8, 40, '#ffdc92', .10);
          c.fillStyle = '#233838'; roundRect(c, -21, -23, 42, 29, 5); c.fill();
          c.fillStyle = '#a36742'; roundRect(c, -19, -21, 38, 25, 4); c.fill();
          c.fillStyle = '#c08a51'; roundRect(c, -19, -23, 38, 13, 4); c.fill();
          c.fillStyle = '#edbd72'; c.fillRect(-15, -22, 4, 26); c.fillRect(11, -22, 4, 26); c.fillRect(-19, -11, 38, 3);
          c.fillStyle = '#ffe29b'; roundRect(c, -4, -12, 8, 10, 2); c.fill(); c.fillStyle = '#68482c'; c.fillRect(-1, -9, 2, 4);
          c.fillStyle = '#fff0b7'; c.globalAlpha = .6 + Math.sin(this.time * 4) * .3;
          c.fillRect(23, -28, 2, 9); c.fillRect(20, -25, 8, 2);
        } else {
          const gold = item.type === 'gold', radius = gold ? 10 : 6;
          glow(c, 0, 0, radius * 3, gold ? '#ffcf6e' : '#d2fff1', gold ? .25 : .13);
          const g = c.createRadialGradient(-radius * .3, -radius * .35, .5, 0, 0, radius);
          g.addColorStop(0, gold ? '#fff6bd' : '#fffef0'); g.addColorStop(.45, gold ? '#ffdb70' : '#d7ecde'); g.addColorStop(1, gold ? '#bd843d' : '#6faaaa');
          ellipse(c, 0, 0, radius, radius, g); ellipse(c, -radius * .28, -radius * .35, radius * .22, radius * .15, '#ffffff');
          if (gold) { c.strokeStyle = '#ffe59b'; c.lineWidth = 1; c.globalAlpha = .5; c.beginPath(); c.arc(0, 0, 14, this.time, this.time + 1); c.arc(0, 0, 14, this.time + Math.PI, this.time + Math.PI + 1); c.stroke(); }
        }
        c.restore();
      }
    }

    drawVehicle(c, rover, alpha, headlight) {
      const s = rover.stats, prev = rover.prev || rover;
      const x = mix(prev.x, rover.x, alpha), y = mix(prev.y, rover.y, alpha), angle = mix(prev.angle, rover.angle, alpha);
      const wb = s.wheelbase || 64, radius = s.radius || 18, id = s.id || 'rover';
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const wheels = rover.wheels.map((wheel, i) => {
        const old = prev.wheels && prev.wheels[i] || wheel;
        return { x: mix(old.x, wheel.x, alpha), y: mix(old.y, wheel.y, alpha), angle: mix(old.angle, wheel.angle, alpha), radius: wheel.radius || radius };
      });
      // Mounts rotate with the chassis; the wheel positions come straight from suspension physics.
      c.save(); c.lineCap = 'round';
      wheels.forEach((wheel, i) => {
        const localX = (i ? 1 : -1) * wb / 2, localY = 8;
        const ax = x + cos * localX - sin * localY, ay = y + sin * localX + cos * localY;
        c.strokeStyle = '#102d37'; c.lineWidth = 8; c.beginPath(); c.moveTo(ax, ay); c.lineTo(wheel.x, wheel.y); c.stroke();
        c.strokeStyle = '#a8bfc0'; c.lineWidth = 3; c.beginPath(); c.moveTo(ax, ay); c.lineTo(wheel.x, wheel.y); c.stroke();
        const dx = wheel.x - ax, dy = wheel.y - ay, len = Math.hypot(dx, dy) || 1;
        c.strokeStyle = '#e4b56c'; c.lineWidth = 2; c.beginPath(); c.moveTo(ax, ay);
        for (let j = 1; j < 8; j++) { const q = j / 8, side = (j % 2 ? 1 : -1) * 3; c.lineTo(ax + dx * q - dy / len * side, ay + dy * q + dx / len * side); }
        c.lineTo(wheel.x, wheel.y); c.stroke();
      });
      wheels.forEach(wheel => this.wheel(c, wheel, id));
      c.translate(x, y); c.rotate(angle);
      if (id === 'manta') {
        c.fillStyle = '#477f94'; c.strokeStyle = '#a1cfce'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(-wb * .57, 8); c.quadraticCurveTo(-wb * .3, -43, wb * .12, -14); c.lineTo(wb * .73, 5); c.quadraticCurveTo(wb * .2, 0, -wb * .57, 8); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(-wb * .7, 4); c.lineTo(-wb * 1.03, -10); c.lineTo(-wb * .87, 16); c.closePath(); c.fill();
      }
      // Caged propeller, with a subtle motion blur at speed.
      const tail = -wb * .64 - 10;
      c.fillStyle = '#1f444b'; roundRect(c, tail - 10, -7, 19, 17, 4); c.fill();
      c.strokeStyle = '#8bafab'; c.lineWidth = 2; c.strokeRect(tail - 9, -9, 11, 20);
      c.strokeStyle = '#b4c6b9'; c.lineWidth = 3; c.beginPath();
      const spin = Math.cos(this.time * (10 + Math.abs(rover.vx) * .2));
      c.moveTo(tail - 5, 1 - 13 * spin); c.lineTo(tail - 5, 1 + 13 * spin); c.stroke();
      const hullWidth = wb * (id === 'bike' ? 1.05 : 1.25), hullHeight = id === 'truck' ? 33 : id === 'bike' ? 22 : 28;
      // Glass dome with a seated pilot, drawn behind the pressure hull.
      // Every vehicle uses the same collision dome: center (0, -18), outer radius 20.
      const domeX = 0, domeY = -18, domeR = 18.5;
      c.fillStyle = '#163d4c'; c.strokeStyle = '#153b43'; c.lineWidth = 3;
      c.beginPath(); c.arc(domeX, domeY, domeR, 0, TAU); c.closePath(); c.fill(); c.stroke();
      const glass = c.createLinearGradient(0, -40, 0, -5); glass.addColorStop(0, '#74bdbf'); glass.addColorStop(1, '#225564');
      c.fillStyle = glass; c.fill();
      c.fillStyle = '#e7aa79'; ellipse(c, domeX + 2, -23, 6, 7, '#e7aa79');
      c.fillStyle = '#304653'; c.beginPath(); c.arc(domeX + 2, -25, 6.5, Math.PI * .9, TAU * .96); c.fill();
      c.fillStyle = '#f3c78d'; roundRect(c, domeX - 5, -18, 14, 13, 5); c.fill();
      c.fillStyle = '#1b3844'; roundRect(c, domeX + 1, -25, 8, 4, 2); c.fill();
      c.strokeStyle = '#f4ca91'; c.lineWidth = 3; c.beginPath(); c.moveTo(domeX + 5, -12); c.lineTo(domeX + 14, -15); c.stroke();
      c.strokeStyle = '#b9eee3'; c.lineWidth = 2.5; c.globalAlpha = .66;
      c.beginPath(); c.arc(domeX, domeY, domeR - 4, Math.PI * 1.12, Math.PI * 1.54); c.stroke(); c.globalAlpha = 1;
      c.strokeStyle = '#1d3e43'; c.lineWidth = 3; c.beginPath(); c.moveTo(domeX - domeR, -8); c.lineTo(domeX + domeR, -8); c.stroke();
      const color = s.color || '#eda650';
      const hull = c.createLinearGradient(0, -13, 0, hullHeight * .6); hull.addColorStop(0, color); hull.addColorStop(1, id === 'rover' ? '#ce7b36' : color);
      c.fillStyle = hull; c.strokeStyle = '#193c43'; c.lineWidth = 3;
      roundRect(c, -hullWidth / 2, -10, hullWidth, hullHeight, id === 'bike' ? 10 : 13); c.fill(); c.stroke();
      c.fillStyle = 'rgba(255,239,172,.35)'; roundRect(c, -hullWidth * .42, -8, hullWidth * .73, 4, 2); c.fill();
      c.fillStyle = '#324f52'; roundRect(c, -hullWidth * .20, 0, hullWidth * .43, 12, 3); c.fill();
      for (let i = 0; i < 4; i++) { c.fillStyle = '#71908c'; roundRect(c, -hullWidth * .15 + i * 6, 3, 3, 5, 1); c.fill(); }
      c.strokeStyle = '#183d46'; c.lineWidth = 4; c.beginPath(); c.moveTo(hullWidth * .39, hullHeight - 6); c.lineTo(hullWidth * .59, hullHeight - 10); c.lineTo(hullWidth * .61, 5); c.stroke();
      c.fillStyle = '#28464b'; roundRect(c, hullWidth * .43, -8, 10, 12, 4); c.fill();
      const lamp = lightColor(headlight);
      ellipse(c, hullWidth * .51, -2, 4, 4.5, lamp); glow(c, hullWidth * .55, -2, 29, lamp, .24);
      for (const xx of [-hullWidth * .38, hullWidth * .36]) { ellipse(c, xx, 7, 2.4, 2.4, '#efd39a'); ellipse(c, xx, 7, 1, 1, '#786644'); }
      if (id === 'truck') {
        c.fillStyle = '#536a70'; roundRect(c, -wb * .48, -33, 27, 26, 8); c.fill();
        c.strokeStyle = '#b3c8ac'; c.lineWidth = 3; c.beginPath(); c.moveTo(-wb * .4, -32); c.lineTo(-wb * .4, -9); c.moveTo(-wb * .23, -32); c.lineTo(-wb * .23, -9); c.stroke();
      } else if (id === 'crab') {
        c.strokeStyle = '#d78064'; c.lineWidth = 6;
        for (const side of [-1, 1]) { c.beginPath(); c.moveTo(side * wb * .48, -1); c.lineTo(side * wb * .70, -14); c.lineTo(side * wb * .84, -7); c.stroke(); c.lineWidth = 3; c.beginPath(); c.moveTo(side * wb * .84, -7); c.lineTo(side * wb * .93, -18); c.moveTo(side * wb * .84, -7); c.lineTo(side * wb * .98, -4); c.stroke(); }
      } else if (id === 'bike') {
        c.fillStyle = '#cfebe2'; c.beginPath(); c.moveTo(-wb * .51, -7); c.lineTo(-wb * .76, -27); c.lineTo(-wb * .71, 0); c.closePath(); c.fill();
      }
      // Radio aerial and running light add a small recognisable silhouette.
      c.strokeStyle = '#234951'; c.lineWidth = 2; c.beginPath(); c.moveTo(-hullWidth * .3, -10); c.lineTo(-hullWidth * .34, -36); c.stroke();
      ellipse(c, -hullWidth * .34, -36, 2.5, 2.5, '#ffcf84');
      c.restore();
    }

    wheel(c, wheel, id) {
      c.save(); c.translate(wheel.x, wheel.y); c.rotate(wheel.angle);
      const r = wheel.radius;
      ellipse(c, 0, 0, r + 1, r + 1, '#14333c'); ellipse(c, 0, 0, r - 2, r - 2, '#29464c');
      c.strokeStyle = '#647b76'; c.lineWidth = 2;
      for (let j = 0; j < 12; j++) {
        const a = j / 12 * TAU;
        c.beginPath(); c.moveTo(Math.cos(a) * (r - 3), Math.sin(a) * (r - 3)); c.lineTo(Math.cos(a + .055) * (r + .3), Math.sin(a + .055) * (r + .3)); c.stroke();
      }
      ellipse(c, 0, 0, r * .61, r * .61, '#83948a'); ellipse(c, 0, 0, r * .45, r * .45, '#28454c');
      c.strokeStyle = id === 'crab' ? '#e4a887' : '#b4bd9e'; c.lineWidth = 3;
      for (let j = 0; j < 5; j++) { const a = j / 5 * TAU; c.beginPath(); c.moveTo(Math.cos(a) * 3, Math.sin(a) * 3); c.lineTo(Math.cos(a) * r * .47, Math.sin(a) * r * .47); c.stroke(); }
      ellipse(c, 0, 0, 4, 4, '#d8c898'); ellipse(c, -1, -1, 1.5, 1.5, '#f1e2b7'); c.restore();
    }

    particles(c, particles, front) {
      for (const particle of particles) {
        if (particle.life <= 0 || (particle.type === 'sand') === front) continue;
        const alpha = clamp(particle.life / (particle.maxLife || 1), 0, 1);
        c.save(); c.globalAlpha = alpha;
        if (particle.type === 'bubble' || particle.type === 'bubbles') {
          c.strokeStyle = particle.color || '#a7e3d5'; c.lineWidth = .8;
          ellipse(c, particle.x, particle.y, particle.size || 3, particle.size || 3); c.stroke();
          ellipse(c, particle.x - (particle.size || 3) * .3, particle.y - (particle.size || 3) * .3, .7, .7, '#dcfff2');
        } else {
          ellipse(c, particle.x, particle.y, particle.size || 2, (particle.size || 2) * .75, particle.color || '#e3dfb3');
        }
        c.restore();
      }
    }

    ambient(c, stage) {
      const w = this.width, h = this.height, t = this.time;
      c.save();
      // Fixed-size deterministic particle field: nothing is allocated or retained per bubble.
      for (let i = 0; i < 55; i++) {
        const factor = .04 + hash(i + 629) * .10;
        const x = ((hash(i + 33) * w - this.camX * factor + Math.sin(t * .13 + i) * 15) % w + w) % w;
        const y = ((hash(i + 73) * h - t * (3 + hash(i) * 10)) % h + h) % h;
        const r = .5 + hash(i + 126) * 2;
        c.globalAlpha = stage.id === 'abyss' ? .08 : .08 + hash(i + 216) * .15;
        if (i % 4 === 0) { c.strokeStyle = '#c1f1e4'; c.lineWidth = .7; ellipse(c, x, y, r + 1, r + 1); c.stroke(); }
        else ellipse(c, x, y, r, r, '#b5e5d5');
      }
      c.restore();
    }

    darkness(x, y, angle, headlight, stage) {
      const c = this.lightCtx, w = this.width, h = this.height, color = lightColor(headlight);
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, w, h);
      c.fillStyle = stage === 'abyss' ? 'rgba(0,3,13,.965)' : stage === 'wreck' ? 'rgba(0,9,20,.36)' : 'rgba(8,4,16,.23)'; c.fillRect(0, 0, w, h);
      c.save(); c.translate(x, y); c.rotate(angle); c.globalCompositeOperation = 'destination-out';
      const radius = 145 * this.zoom;
      const local = c.createRadialGradient(0, 0, 10, 0, 0, radius); local.addColorStop(0, 'rgba(0,0,0,.92)'); local.addColorStop(.45, 'rgba(0,0,0,.66)'); local.addColorStop(1, 'transparent');
      c.fillStyle = local; c.fillRect(-radius, -radius, radius * 2, radius * 2);
      const length = Math.min(700, w * .75), beam = c.createLinearGradient(20, 0, length, 0);
      beam.addColorStop(0, 'rgba(0,0,0,.95)'); beam.addColorStop(.45, 'rgba(0,0,0,.82)'); beam.addColorStop(1, 'transparent');
      c.fillStyle = beam; c.beginPath(); c.moveTo(30 * this.zoom, -6); c.lineTo(length, -length * .32); c.quadraticCurveTo(length * 1.12, 0, length, length * .32); c.closePath(); c.fill(); c.restore();
      this.ctx.drawImage(this.lightCanvas, 0, 0, w, h);
      const g = this.ctx; g.save(); g.translate(x, y); g.rotate(angle); g.globalAlpha = stage === 'abyss' ? .065 : .025;
      g.fillStyle = color; g.beginPath(); g.moveTo(33 * this.zoom, -2); g.lineTo(length, -length * .31); g.quadraticCurveTo(length * 1.1, 0, length, length * .31); g.closePath(); g.fill(); g.restore();
    }

    floatingText(c, texts) {
      c.save(); c.font = '700 15px system-ui, -apple-system, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (const text of texts) {
        if (text.life <= 0) continue;
        c.globalAlpha = clamp(text.life / .35, 0, 1); c.lineWidth = 4; c.strokeStyle = '#12333d'; c.strokeText(text.text, text.x, text.y);
        c.fillStyle = text.color || '#ffe5a0'; c.fillText(text.text, text.x, text.y);
      }
      c.restore();
    }

    thumbnail(canvas, vehicleId) {
      const stats = typeof vehicleId === 'object' ? vehicleId : AR.getStats(vehicleId, {});
      const c = canvas.getContext('2d'), rect = canvas.getBoundingClientRect();
      const w = rect.width || Number(canvas.getAttribute('width')) || 220, h = rect.height || Number(canvas.getAttribute('height')) || 110;
      const dpr = Math.max(1, root.devicePixelRatio || 1); canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
      glow(c, w * .5, h * .55, w * .45, stats.color || '#eba64b', .10);
      const radius = stats.radius || 18;
      const wheelY = 8 + (stats.restLength || 24);
      const bottom = wheelY + radius + 6, scale = Math.min(w / 180, (h - 10) / (bottom + 43));
      c.save(); c.translate(w * .5, h * .5 - (bottom - 43) * scale * .5); c.scale(scale, scale);
      ellipse(c, 0, wheelY + radius, stats.wheelbase * .72, 6, 'rgba(0,8,16,.3)');
      const rover = { x: 0, y: 0, angle: -.05, vx: 0, stats, wheels: [-1, 1].map(side => ({ x: side * stats.wheelbase / 2, y: wheelY, angle: .3, radius })) };
      this.drawVehicle(c, rover, 1); c.restore();
    }
  }

  AR.Renderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : window);
