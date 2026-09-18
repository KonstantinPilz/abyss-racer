(function (root) {
  'use strict';

  const AR = root.AR = root.AR || {};
  const TAU = Math.PI * 2;
  const glowSprites = new Map();
  const spriteCanvas = () => typeof root.OffscreenCanvas === 'function' ? new root.OffscreenCanvas(1, 1) : document.createElement('canvas');
  const spriteEntries = new Map();
  // Phones retain at most 24 MiB; desktop split-screen needs a larger working
  // set so both cameras can reuse tiles without rebuilding them every frame.
  const coarsePointer = root.matchMedia?.('(pointer: coarse)');
  const cachePixelBudget = () => (root.innerWidth <= 620 || coarsePointer?.matches ? 6 : 24) * 1024 * 1024;
  let cachedPixels = 0;
  const freezeSprite = canvas => {
    if (!canvas.transferToImageBitmap) return canvas;
    const bitmap = canvas.transferToImageBitmap(); canvas.width = canvas.height = 1; return bitmap;
  };
  const releaseSprite = value => {
    const sprite = value.sprite || value, entry = spriteEntries.get(sprite);
    if (entry) { cachedPixels -= entry.pixels; entry.cache.delete(entry.key); spriteEntries.delete(sprite); }
    if (sprite.close) sprite.close(); else sprite.width = sprite.height = 1;
  };
  function cacheSprite(cache, key, value, limit) {
    if (cache.has(key)) releaseSprite(cache.get(key));
    const sprite = value.sprite || value, pixels = sprite.width * sprite.height;
    cache.set(key, value); spriteEntries.set(sprite, { cache, key, pixels }); cachedPixels += pixels;
    if (cache.size > limit) releaseSprite(cache.values().next().value);
    // Release backing stores explicitly: Safari canvas memory need not be
    // reclaimed when a Map entry is deleted. Keep the newest sprite drawable.
    while (cachedPixels > cachePixelBudget() && spriteEntries.size > 1) releaseSprite(spriteEntries.keys().next().value);
  }
  function clearSprites(cache) { for (const value of cache.values()) releaseSprite(value); cache.clear(); }

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
    let sprite = glowSprites.get(color);
    if (!sprite) {
      sprite = spriteCanvas(); sprite.width = sprite.height = 128;
      const paint = sprite.getContext('2d'), gradient = paint.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, color); gradient.addColorStop(1, 'transparent');
      paint.fillStyle = gradient; paint.fillRect(0, 0, 128, 128); sprite = freezeSprite(sprite); glowSprites.set(color, sprite);
    }
    c.save(); c.globalAlpha *= alpha === undefined ? 1 : alpha;
    c.drawImage(sprite, x - r, y - r, r * 2, r * 2); c.restore();
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
      this.lightCanvas = document.createElement('canvas'); this.lightCtx = this.lightCanvas.getContext('2d');
      this.effectCanvas = document.createElement('canvas'); this.effectCtx = this.effectCanvas.getContext('2d');
      this.awarenessCanvas = null; this.awarenessRegions = new Map();
      this.soloCamera = {}; this.chassisCache = new Map();
      this.decorationCache = new Map(); this.groundCache = new Map(); this.backdropCache = new Map(); this.vignetteCache = new Map();
      this.decorationChunks = new Map(); this.spriteCache = new Map(); this.graphics = 'crisp';
      this.width = 1; this.height = 1; this.dpr = 1; this.time = 0;
      this.camX = 0; this.camY = 0; this.zoom = 1; this.lastTerrain = null; this.lastState = '';
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.width = Math.max(1, rect.width || root.innerWidth || 1280);
      this.height = Math.max(1, rect.height || root.innerHeight || 720);
      this.nativeDpr = clamp(root.devicePixelRatio || 1, 1, 2);
      this.dpr = this.graphics === 'performance' ? 1 : this.nativeDpr;
      const width = Math.round(this.width * this.dpr), height = Math.round(this.height * this.dpr);
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.clearCaches(); this.canvas.width = width; this.canvas.height = height;
      }
      if (this.lightCanvas.width !== width || this.lightCanvas.height !== height) { this.lightCanvas.width = width; this.lightCanvas.height = height; }
      if (this.awarenessCanvas) this.resizeAwarenessLayer(rect);
    }

    clearCaches() {
      for (const cache of [this.chassisCache, this.decorationCache, this.groundCache, this.backdropCache, this.vignetteCache, this.decorationChunks, this.spriteCache]) clearSprites(cache);
    }
    cacheUsage() { return { bytes: cachedPixels * 4, budget: cachePixelBudget() * 4, sprites: spriteEntries.size }; }
    setGraphics(value) {
      this.graphics = value === 'performance' ? 'performance' : 'crisp';
      this.resize();
    }

    // Rasterize geometry at the next quarter-zoom bucket, never below its
    // screen density. Only the soft glows use small, intentionally soft sprites.
    rasterScale() { return this.dpr * Math.max(.5, Math.ceil((this.zoom || 1) * 4) / 4); }

    sprite(key, width, height, paint, scale = this.rasterScale()) {
      key += ':' + scale;
      let sprite = this.spriteCache.get(key);
      if (!sprite) {
        sprite = spriteCanvas(); sprite.width = Math.ceil(width * scale); sprite.height = Math.ceil(height * scale);
        const context = sprite.getContext('2d'); context.scale(scale, scale); paint(context);
        sprite = freezeSprite(sprite); cacheSprite(this.spriteCache, key, sprite, 96);
      }
      return sprite;
    }

    resizeAwarenessLayer(rect) {
      const layer = this.awarenessCanvas;
      rect = rect || this.canvas.getBoundingClientRect();
      layer.style.left = rect.left + 'px'; layer.style.top = rect.top + 'px';
      layer.style.width = this.width + 'px'; layer.style.height = this.height + 'px';
      const width = Math.round(this.width * this.nativeDpr), height = Math.round(this.height * this.nativeDpr);
      if (layer.width !== width || layer.height !== height) { layer.width = width; layer.height = height; }
      this.awarenessRegions.clear();
    }

    showAwarenessLayer(visible) {
      if (visible && !this.awarenessCanvas) {
        const layer = this.awarenessCanvas = document.createElement('canvas');
        layer.dataset.versusLabels = ''; layer.setAttribute('aria-hidden', 'true');
        layer.style.cssText = 'position:fixed;pointer-events:none;z-index:1;';
        (this.canvas.parentNode || document.body).appendChild(layer);
        this.awarenessCtx = layer.getContext('2d'); this.resizeAwarenessLayer();
      }
      if (!this.awarenessCanvas) return;
      this.awarenessCanvas.hidden = !visible;
      if (!visible) {
        this.awarenessCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.awarenessCtx.clearRect(0, 0, this.awarenessCanvas.width, this.awarenessCanvas.height);
        this.awarenessRegions.clear();
      }
    }

    updateResolution(versus) {
      if (this.resolutionVersus !== versus) {
        this.resolutionVersus = versus;
        this.showAwarenessLayer(versus);
      }
      const density = this.graphics === 'performance' ? 1 : clamp(root.devicePixelRatio || 1, 1, 2);
      if (this.dpr !== density) this.resize();
    }

    draw(scene, dt, alpha) {
      this.soloCamera.dt = dt; this.soloCamera.alpha = alpha;
      this.render(scene, this.soloCamera, { x: 0, y: 0, width: this.width, height: this.height });
    }

    // Cameras own all follow/interpolation state. Rendering either viewport never
    // advances the simulation, so both halves see exactly the same world step.
    render(scene, camera, viewportRect) {
      if (!scene || !scene.rover || !scene.terrain) return;
      camera = camera || this.soloCamera;
      const rect = viewportRect || { x: 0, y: 0, width: this.width, height: this.height };
      const c = this.ctx, w = rect.width, h = rect.height, dt = camera.dt;
      if (w <= 0 || h <= 0) return;
      this.viewWidth = w; this.viewHeight = h;
      const rover = scene.rover, terrain = scene.terrain, stage = scene.stage || terrain.stage || {};
      const p = stage.palette || {}, id = stage.id || 'reef', versus = !!scene.players;
      this.versusView = versus;
      this.updateResolution(versus, dt, rect);
      const prev = rover.prev || rover, alpha = clamp(camera.alpha === undefined ? 1 : camera.alpha, 0, 1);
      const x = mix(prev.x, rover.x, alpha), y = mix(prev.y, rover.y, alpha);
      const angle = mix(prev.angle, rover.angle, alpha);
      this.time = scene.time === undefined ? this.time + Math.min(dt || 0, .05) : scene.time;
      const running = versus || ['RUNNING', 'PAUSED', 'GAMEOVER'].includes(scene.state);
      const baseZoom = versus ? clamp(Math.min(w / 1060, h / 410), .62, 1.18) : clamp(w / 1060, .78, 1.48);
      const desiredZoom = baseZoom * (running ? 1.07 / (1 + Math.min(Math.abs(rover.vx), 580) / 1500) : 1.7);
      const smoothing = 1 - Math.exp(-clamp(dt === undefined ? 1 / 60 : dt, 0, .05) * 4);
      const resetCamera = camera.lastTerrain !== terrain || !Number.isFinite(camera.camX) || (running && !['RUNNING', 'PAUSED', 'GAMEOVER'].includes(camera.lastState));
      this.zoom = resetCamera ? desiredZoom : mix(camera.zoom, desiredZoom, smoothing);
      const anchor = running ? (w < 640 ? .34 : .31) : (w < 640 ? .65 : .70);
      const targetX = x - (anchor - .5) * w / this.zoom + (running ? clamp(rover.vx * .18, -28, 72) : 0);
      const targetY = y + (running ? clamp(rover.vy * .13, -30, 40) : 0);
      this.camX = resetCamera ? targetX : mix(camera.camX, targetX, smoothing * 1.35);
      this.camY = resetCamera ? targetY : mix(camera.camY, targetY, smoothing);
      this.lastTerrain = terrain; this.lastState = scene.state;
      Object.assign(camera, { camX: this.camX, camY: this.camY, zoom: this.zoom, lastTerrain: terrain, lastState: running ? 'RUNNING' : scene.state });
      const floor = running ? .67 : (w < 640 ? .70 : .64);
      let tx = w * .5 - this.camX * this.zoom, ty = h * floor - this.camY * this.zoom;
      const shake = clamp((scene.player?.effects.geyser > 0 ? .8 : scene.shake || 0) * (versus ? 10 : 1), 0, 10);
      tx += Math.sin(this.time * 113) * shake; ty += Math.cos(this.time * 97) * shake * .6;
      camera.screenX = x * this.zoom + tx; camera.screenY = y * this.zoom + ty;
      camera.tx = tx; camera.ty = ty;
      c.save(); c.setTransform(this.dpr, 0, 0, this.dpr, (rect.x || 0) * this.dpr, (rect.y || 0) * this.dpr);
      c.beginPath(); c.rect(0, 0, w, h); c.clip();
      this.background(c, stage, p);
      c.save(); c.translate(tx, ty); c.scale(this.zoom, this.zoom);
      this.roverX = x;
      const left = -tx / this.zoom - 100, right = (w - tx) / this.zoom + 100;
      const bottom = (h - ty) / this.zoom + 200;
      this.bounds = { left, right, top: -ty / this.zoom - 100, bottom };
      this.decorations(c, terrain, id, left, right, false);
      this.ground(c, terrain, p, left, right, bottom, id);
      if (id === 'ice') this.iceCeiling(c, terrain, left, right, this.bounds.top);
      if (Number.isFinite(scene.targetX) && scene.targetX >= left && scene.targetX <= right) this.finishMarker(c, scene.targetX, terrain.height(scene.targetX));
      this.worldRoutes(c, terrain, scene, left, right);
      this.stageMechanics(c, terrain, scene, left, right);
      this.pickups(c, (scene.pickups || []).filter(q => q.type !== 'crate' || !(scene.crateCooldowns?.get(q.key)?.[scene.player?.index || 0] > scene.time)));
      this.sharks(c, scene.sharks || []);
      this.particles(c, scene.particles || [], false);
      this.projectiles(c, scene.projectiles || [], alpha);
      if (versus) {
        const ordered = [...scene.players].sort((a, b) => a.rover.x - b.rover.x);
        for (const player of ordered) {
          if (!player.rover || !this.inView(player.rover.x, player.rover.y, 110)) continue;
          c.save(); if (player.out || player.respawn > 0 || player.respawnTimer > 0) c.globalAlpha = .32;
          else if (player.rover.ghosting && ordered.some(other => other !== player && other.rover.x >= player.rover.x &&
            Math.abs(player.rover.x - other.rover.x) < (player.rover.stats.wheelbase + other.rover.stats.wheelbase) / 2 + player.rover.stats.radius + other.rover.stats.radius &&
            Math.abs(player.rover.y - other.rover.y) < 80)) c.globalAlpha = .55;
          this.drawVehicle(c, player.rover, alpha, scene.headlight); c.restore();
          this.playerEffects(c, player, alpha, scene.mode);
        }
      } else this.drawVehicle(c, rover, alpha, scene.headlight);
      if (scene.chest) this.treasure(c, scene.chest, scene.players);
      this.decorations(c, terrain, id, left, right, true);
      this.particles(c, scene.particles || [], true);
      this.explosions(c, scene.explosions || []);
      c.restore();
      this.ambient(c, stage);
      if (id === 'abyss' || id === 'wreck' || id === 'volcanic') this.darkness(camera.screenX, camera.screenY, angle, scene.headlight, id);
      c.save(); c.translate(tx, ty); c.scale(this.zoom, this.zoom);
      this.floatingText(c, scene.texts || []); c.restore();
      {
        const key = [w, h, id].join(':');
        let sprite = this.vignetteCache.get(key);
        if (!sprite) {
          sprite = spriteCanvas(); sprite.width = Math.ceil(w / 3); sprite.height = Math.ceil(h / 3);
          const paint = sprite.getContext('2d'); paint.scale(sprite.width / w, sprite.height / h);
          const gradient = paint.createRadialGradient(w * .51, h * .42, h * .25, w * .51, h * .45, Math.max(w, h) * .70);
          gradient.addColorStop(0, 'transparent'); gradient.addColorStop(1, id === 'abyss' ? 'rgba(0,0,9,.6)' : 'rgba(0,13,27,.48)');
          paint.fillStyle = gradient; paint.fillRect(0, 0, w, h); sprite = freezeSprite(sprite); cacheSprite(this.vignetteCache, key, sprite, 8);
        }
        c.drawImage(sprite, 0, 0, w, h);
      }

      if (rover.environment?.plankton) {
        c.fillStyle = 'rgba(103,255,211,.08)'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 75; i++) { const xx = hash(i + 48) * w + Math.sin(this.time + i) * 15, yy = (hash(i + 271) * h - this.time * 14 % h + h) % h; ellipse(c, xx, yy, 1.5 + hash(i) * 2, 1.5 + hash(i) * 2, '#a1ffe1'); }
        c.fillStyle = '#c3ffdf'; c.font = 'bold 12px system-ui'; c.textAlign = 'center'; c.fillText('LIVING STARS · +1 O₂ / SEC', w / 2, h - (versus ? 70 : 35));
      }
      if (rover.sharkBite > 0 || scene.player?.effects.shark > 0) { c.fillStyle = 'rgba(255,42,52,' + Math.min(.42, (rover.sharkBite || scene.player.effects.shark) * .42) + ')'; c.fillRect(0, 0, w, h); }
      if (versus) {
        this.viewportEffects(c, scene.player, camera, rect);
        if (scene.flash > 0) { c.fillStyle = 'rgba(211,255,246,' + Math.min(.55, scene.flash * 2.5) + ')'; c.fillRect(0, 0, w, h); }
      }
      c.restore();
      if (versus) this.renderAwarenessLayer(scene, camera, rect, alpha);
    }

    inView(x, y, margin) {
      const b = this.bounds, m = margin || 0;
      return !b || (x >= b.left - m && x <= b.right + m && y >= b.top - m && y <= b.bottom + m);
    }

    explosions(c, explosions) {
      for (const burst of explosions) {
        if (burst.life <= 0 || !this.inView(burst.x, burst.y, 180)) continue;
        const t = 1 - burst.life / burst.maxLife;
        c.save(); c.translate(burst.x, burst.y); c.globalAlpha = 1 - t;
        glow(c, 0, 0, 35 + t * 110, '#e9fff1', (1 - t) * .9);
        c.strokeStyle = '#d8fff3'; c.lineWidth = 3 * (1 - t) + .5;
        ellipse(c, 0, 0, 15 + t * 125, 15 + t * 95); c.stroke();
        const count = this.graphics === 'performance' ? 14 : 28;
        for (let i = 0; i < count; i++) {
          const angle = i / count * TAU, distance = (30 + hash(i + 7) * 135) * t;
          const x = Math.cos(angle) * distance, y = Math.sin(angle) * distance - t * t * 55;
          const radius = 2 + hash(i + 31) * 6 + t * 3;
          ellipse(c, x, y, radius, radius, 'rgba(171,255,234,.12)'); c.stroke();
        }
        c.restore();
      }
    }

    background(c, stage, p) {
      const w = this.viewWidth || this.width, h = this.viewHeight || this.height, t = this.time, id = stage.id;
      {
        const key = [w, h, id].join(':');
        let sprite = this.backdropCache.get(key);
        if (!sprite) {
          sprite = spriteCanvas(); sprite.width = Math.ceil(w / 3); sprite.height = Math.ceil(h / 3);
          const paint = sprite.getContext('2d'); paint.scale(sprite.width / w, sprite.height / h);
          const bg = paint.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, p.top || '#083e50'); bg.addColorStop(1, p.bottom || '#052c38');
          paint.fillStyle = bg; paint.fillRect(0, 0, w, h);
          glow(paint, w * .56, -h * .10, h * 1.2, id === 'volcanic' ? '#924f3a' : id === 'ice' ? '#94dced' : '#39c8bf', id === 'abyss' ? .08 : .19);
          if (id !== 'abyss' && id !== 'volcanic' && id !== 'wreck') {
            paint.save(); paint.globalCompositeOperation = 'screen';
            for (let i = 0; i < 5; i++) {
              const x = w * (.09 + i * .17);
              const g = paint.createLinearGradient(x, 0, x + h * .28, h);
              g.addColorStop(0, 'rgba(146,245,232,.08)'); g.addColorStop(.65, 'rgba(106,237,221,.025)'); g.addColorStop(1, 'transparent');
              paint.fillStyle = g; paint.beginPath(); paint.moveTo(x, -20); paint.lineTo(x + 28 + hash(i) * 37, -20);
              paint.lineTo(x + h * .58 + 130, h); paint.lineTo(x + h * .43 - 30, h); paint.closePath(); paint.fill();
            }
            paint.restore();
          }
          sprite = freezeSprite(sprite); cacheSprite(this.backdropCache, key, sprite, 8);
        }
        c.drawImage(sprite, 0, 0, w, h);
      }
      // Procedural silhouettes are anchored to the world at different parallax rates.
      for (let layer = 0; layer < (this.versusView ? 2 : 3); layer++) {
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
      const w = this.viewWidth || this.width, h = this.viewHeight || this.height, t = this.time;
      if (stage.id === 'abyss') return;
      c.save();
      for (let school = 0; school < (this.versusView ? 2 : 3); school++) {
        const direction = school % 2 ? -1 : 1;
        const travel = t * (8 + school * 3) * direction - this.camX * (.12 + school * .05);
        const origin = ((school * w * .47 + travel) % (w + 330) + w + 330) % (w + 330) - 150;
        c.fillStyle = stage.id === 'ice' ? '#65a5b5' : school === 1 ? '#65ab9f' : '#377f85'; c.globalAlpha = .42;
        for (let j = 0; j < (this.versusView ? 5 : 7); j++) {
          const x = origin + hash(j + school * 17) * 165;
          const y = h * (.20 + school * .13) + hash(j + 23) * 58 + Math.sin(t * .6 + j) * 7;
          if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
          const size = 2.7 + hash(j + 51) * 2.2;
          c.save(); c.translate(x, y); c.scale(direction, 1);
          ellipse(c, 0, 0, size * 1.7, size, c.fillStyle);
          c.beginPath(); c.moveTo(-size * 1.5, 0); c.lineTo(-size * 3, -size * .9); c.lineTo(-size * 3, size * .9); c.closePath(); c.fill(); c.restore();
        }
      }
      c.restore();
    }

    ground(c, terrain, p, left, right, bottom, id, texturePass) {
      if (!texturePass) { this.versusGround(c, terrain, p, left, right, bottom, id); return; }
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

    decorations(c, terrain, id, left, right, front, texturePass = false) {
      if (!front && !texturePass) { this.cachedDecorations(c, terrain, id, left, right); this.vents(c, terrain, id, left, right); return; }
      const spacing = front ? 178 : 104;
      for (let i = Math.floor(left / spacing) - 1; i < right / spacing + 1; i++) {
        const seed = i + (front ? 702 : 123), n = hash(seed), x = i * spacing + hash(seed + 411) * spacing * .65;
        const y = terrain.height(x) + (front ? 18 : 3), size = 20 + hash(seed + 22) * (front ? 43 : 70);
        if (!texturePass && !this.inView(x, y - size, 180)) continue;
        if (front && (n < .56 || Math.abs(x - this.roverX) < 92)) continue;
        c.save(); c.translate(x, y); c.scale(front ? 1.10 : 1, 1); c.globalAlpha = front ? .93 : .78;
        if (!texturePass) {
          const key = [id, seed, front, this.rasterScale()].join(':');
          let sprite = this.decorationCache.get(key);
          if (!sprite) {
            sprite = spriteCanvas();
            const scale = this.rasterScale(); sprite.width = Math.round(220 * scale); sprite.height = Math.round(300 * scale);
            const paint = sprite.getContext('2d'); paint.setTransform(scale, 0, 0, scale, 110 * scale, 270 * scale);
            this.drawDecoration(paint, id, seed, n, size); sprite = freezeSprite(sprite); cacheSprite(this.decorationCache, key, sprite, 128);
          }
          if (id === 'kelp' || id === 'reef' || id === 'wreck') c.rotate(Math.sin(this.time * .6 + seed) * .015);
          c.drawImage(sprite, -110, -270, 220, 300);
        } else this.drawDecoration(c, id, seed, n, size);
        c.restore();
      }
      if (!front && id === 'wreck') {
        for (let i = Math.floor(left / 1050); i <= right / 1050; i++) {
          const x = i * 1050 + 520; this.wreck(c, x, terrain.height(x) + 13, hash(i + 719));
        }
      }
    }

    vents(c, terrain, id, left, right) {
      if (id === 'volcanic') {
        for (let i = Math.max(0, Math.floor((left - 670) / 960)); i <= (right - 670) / 960; i++) {
          const x = 670 + i * 960, y = terrain.height(x);
          if (!this.inView(x, y - 90, 160)) continue;
          glow(c, x, y - 20, 90, '#fa744a', .20);
          ellipse(c, x, y - 2, 24, 7, '#241f29'); ellipse(c, x, y - 3, 20, 4, '#ec9b57');
          for (let j = 0; j < (this.graphics === 'performance' ? 6 : 14); j++) {
            const rise = ((this.time * (24 + j * 3) + j * 21) % 190);
            c.save(); c.globalAlpha = (1 - rise / 190) * .30;
            ellipse(c, x + Math.sin(rise * .035 + j) * (8 + rise * .07), y - 5 - rise, 2 + rise * .02, 4 + rise * .04, '#ffb46f'); c.restore();
          }
        }
      }
    }

    cachedDecorations(c, terrain, id, left, right) {
      if (this.decorationTerrain !== terrain || this.decorationRevision !== terrain.revision) { this.decorationTerrain = terrain; this.decorationRevision = terrain.revision; clearSprites(this.decorationChunks); }
      const scale = this.rasterScale();
      for (let chunk = Math.floor(left / 512); chunk <= Math.floor(right / 512); chunk++) {
        const key = chunk + ':' + scale;
        let tile = this.decorationChunks.get(key);
        if (!tile) {
          const from = chunk * 512; let low = Infinity, high = -Infinity;
          for (let x = from - 200; x <= from + 712; x += 24) { const y = terrain.height(x); low = Math.min(low, y); high = Math.max(high, y); }
          const canopy = id === 'kelp' ? 230 : id === 'wreck' ? 250 : 145;
          const top = Math.floor(low - canopy), height = Math.ceil(high + 24 - top);
          let sprite = spriteCanvas(); sprite.width = Math.ceil(512 * scale); sprite.height = Math.ceil(height * scale);
          const paint = sprite.getContext('2d'); paint.setTransform(scale, 0, 0, scale, -from * scale, -top * scale);
          this.decorations(paint, terrain, id, from - 200, from + 712, false, true);
          sprite = freezeSprite(sprite); tile = { sprite, x: from, y: top, height }; cacheSprite(this.decorationChunks, key, tile, 24);
        }
        if (tile.y <= this.bounds.bottom && tile.y + tile.height >= this.bounds.top) c.drawImage(tile.sprite, tile.x, tile.y, 512, tile.height);
      }
    }

    drawDecoration(c, id, seed, n, size) {
        if (id === 'city') {
          c.fillStyle = n > .5 ? '#789798' : '#476e75'; c.fillRect(-10, -size * 1.6, 20, size * 1.6);
          c.fillStyle = '#b3beab'; c.fillRect(-16, -size * 1.6, 32, 7); c.fillRect(-16, -7, 32, 7);
          c.strokeStyle = '#c1c9ae'; c.lineWidth = 2; for (let j = -5; j <= 5; j += 5) { c.beginPath(); c.moveTo(j, -size * 1.6 + 12); c.lineTo(j, -12); c.stroke(); }
          this.kelp(c, seed, size * .5, '#358a7e');
        } else if (id === 'whale') {
          c.strokeStyle = '#c4c4ba'; c.lineWidth = 8; c.beginPath(); c.moveTo(-20, 0); c.quadraticCurveTo(-size, -size * 1.5, size * .35, -size * 1.7); c.stroke();
          this.coral(c, seed, size * .45, '#8299b7'); for (let j = 0; j < 4; j++) ellipse(c, j * 8 - 15, -8 - hash(seed + j) * 23, 2, 3, '#95f4d9');
        } else if (id === 'thermal') {
          this.rock(c, seed, size * .6, '#895650');
          c.strokeStyle = '#ffb271'; c.lineWidth = 3; c.beginPath(); c.moveTo(-12, -6); c.lineTo(-2, -13); c.lineTo(3, -5); c.lineTo(16, -12); c.stroke();
        } else if (id === 'kelp') {
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
    }

    versusGround(c, terrain, palette, left, right, bottom, id) {
      // Chunk tiles contain both the fill and the sand edge. The solid extension
      // below each tile is a rectangle, so no terrain path is rebuilt per frame.
      if (this.groundTerrain !== terrain || this.groundRevision !== terrain.revision) { this.groundTerrain = terrain; this.groundRevision = terrain.revision; clearSprites(this.groundCache); }
      const scale = this.rasterScale();
      for (let chunk = Math.floor(left / 512); chunk <= Math.floor(right / 512); chunk++) {
        const key = chunk + ':' + scale;
        let tile = this.groundCache.get(key);
        if (!tile) {
          const from = chunk * 512; let low = Infinity, high = -Infinity;
          for (let x = from - 24; x <= from + 536; x += 8) { const y = terrain.height(x); low = Math.min(low, y); high = Math.max(high, y); }
          const top = Math.floor(low - 20), height = Math.ceil(high + 160 - top);
          let sprite = spriteCanvas(); sprite.width = Math.ceil(514 * scale); sprite.height = Math.ceil(height * scale);
          const paint = sprite.getContext('2d'); paint.setTransform(scale, 0, 0, scale, -(from - 1) * scale, -top * scale);
          this.ground(paint, terrain, palette, from - 24, from + 536, top + height + 1, id, true);
          sprite = freezeSprite(sprite); tile = { sprite, x: from - 1, y: top, height }; cacheSprite(this.groundCache, key, tile, 32);
        }
        if (tile.y > this.bounds.bottom) continue;
        c.fillStyle = palette.ground || '#173b3c';
        if (bottom > tile.y + tile.height - 1) c.fillRect(tile.x, tile.y + tile.height - 1, 514, bottom - tile.y - tile.height + 2);
        if (tile.y + tile.height >= this.bounds.top) c.drawImage(tile.sprite, tile.x, tile.y, 514, tile.height);
      }
      if (id !== 'abyss') {
        c.strokeStyle = id === 'volcanic' ? 'rgba(255,173,95,.07)' : 'rgba(180,255,221,.07)'; c.lineWidth = 1.5;
        for (let i = Math.floor(left / 125); i < right / 125; i++) {
          const x = i * 125; c.beginPath(); c.ellipse(x + Math.sin(this.time * .7 + i) * 13, terrain.height(x) + 18, 24 + Math.sin(this.time + i) * 7, 5, -.12, .2, Math.PI * 1.5); c.stroke();
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

    worldRoutes(c, terrain, scene, left, right) {
      for (const deck of terrain.platformsBetween?.(left, right) || []) {
        const start = Math.max(left, deck.start), end = Math.min(right, deck.end);
        c.save(); c.lineJoin = 'round';
        c.beginPath();
        for (let x = start; x < end; x += 10) x === start ? c.moveTo(x, terrain.platformHeight(x, deck)) : c.lineTo(x, terrain.platformHeight(x, deck));
        c.lineTo(end, terrain.platformHeight(end, deck));
        c.strokeStyle = deck.type === 'deck' ? '#42544f' : '#315e48'; c.lineWidth = 17; c.stroke();
        c.strokeStyle = deck.type === 'deck' ? '#e1b782' : '#b5dda0'; c.lineWidth = 4; c.stroke();
        for (let x = Math.ceil(start / 50) * 50; x < end; x += 50) {
          const y = terrain.platformHeight(x, deck);
          c.strokeStyle = deck.type === 'deck' ? '#826f54' : '#6e9a67'; c.lineWidth = 3;
          c.beginPath(); c.moveTo(x, y + 3); c.lineTo(x + 8, y + 13); c.stroke();
        }
        if (deck.start >= left) {
          c.fillStyle = '#d8efc9'; c.font = 'bold 11px system-ui'; c.fillText('↑ UPPER ROUTE', deck.start + 15, terrain.platformHeight(deck.start, deck) - 17);
        }
        c.restore();
      }
      for (const spring of terrain.hotSpringsBetween?.(left, right) || []) {
        c.save();
        const g = c.createLinearGradient(0, spring.y - 230, 0, spring.y);
        g.addColorStop(0, 'rgba(144,247,187,0)'); g.addColorStop(1, 'rgba(144,247,187,.19)');
        c.fillStyle = g; c.fillRect(spring.x - spring.width, spring.y - 230, spring.width * 2, 230);
        ellipse(c, spring.x, spring.y - 3, 33, 8, '#6fb99a');
        c.strokeStyle = '#bbffe1'; c.lineWidth = 1.5;
        for (let j = 0; j < (this.graphics === 'performance' ? 9 : 18); j++) {
          const rise = (this.time * 65 + j * 19) % 215;
          const x = spring.x + Math.sin(j * 2.7 + rise * .02) * (25 + rise * .19);
          c.globalAlpha = (1 - rise / 215) * .8; ellipse(c, x, spring.y - rise - 8, 3 + j % 4, 3 + j % 4); c.stroke();
        }
        c.globalAlpha = .85; c.fillStyle = '#d5ffe7'; c.font = 'bold 11px system-ui'; c.textAlign = 'center'; c.fillText('↑ HOT SPRING', spring.x, spring.y - 40); c.restore();
      }
      if (scene.players?.some(p => p.effects.gravity > 0) && terrain.stage.id !== 'ice' && !terrain.arena) {
        c.save(); c.strokeStyle = '#d2adff'; c.lineWidth = 5; c.globalAlpha = .75;
        c.beginPath(); for (let x = left; x <= right + 10; x += 10) x === left ? c.moveTo(x, terrain.gravityCeiling(x)) : c.lineTo(x, terrain.gravityCeiling(x)); c.stroke();
        c.strokeStyle = '#f2ddff'; c.lineWidth = 1; c.setLineDash([14, 14]); c.stroke(); c.restore();
      }
      if (terrain.arena) {
        c.save(); c.strokeStyle = '#a7f5df'; c.lineWidth = 6;
        for (const x of [terrain.arena.left, terrain.arena.right]) {
          c.beginPath(); c.moveTo(x, terrain.arena.ceiling); c.lineTo(x, terrain.height(x)); c.stroke();
          for (let y = terrain.arena.ceiling + 20; y < terrain.height(x); y += 36) {
            c.fillStyle = '#497c7b'; c.fillRect(x - 12, y, 24, 10);
          }
        }
        c.setLineDash([12, 12]); c.lineWidth = 2; c.globalAlpha = .6;
        c.beginPath(); c.moveTo(terrain.arena.left, terrain.arena.ceiling); c.lineTo(terrain.arena.right, terrain.arena.ceiling); c.stroke(); c.restore();
      }
    }

    waterColumn(c, x, y, height, power = 1) {
      c.save(); c.globalAlpha = Math.min(1, power); const t = this.time;
      const g = c.createLinearGradient(x - 40, y, x + 40, y); g.addColorStop(0, '#9ce8ee00'); g.addColorStop(.5, '#f4ffffdd'); g.addColorStop(1, '#9ce8ee00');
      c.fillStyle = g; c.beginPath(); c.moveTo(x - 36, y); c.lineTo(x - 18, y - height); c.quadraticCurveTo(x, y - height - 35, x + 18, y - height); c.lineTo(x + 36, y); c.fill();
      c.strokeStyle = '#e6ffff'; c.lineWidth = 2;
      for (let j = 0; j < 34; j++) { const yy = y - ((t * 260 + hash(j + 93) * height) % height), xx = x + Math.sin(j * 2.1 + t * 4) * (8 + hash(j) * 34); ellipse(c, xx, yy, 2 + hash(j + 9) * 6, 2 + hash(j + 9) * 6, '#eaffffb8'); }
      ellipse(c, x, y, 52, 13, '#edffffb0'); c.restore();
    }
    stageMechanics(c, terrain, scene, left, right) {
      const time = terrain.worldTime || 0;
      if (terrain.stage.id === 'city') {
        for (let x = Math.floor(left / 900) * 900; x < right + 900; x += 900) {
          const y = terrain.height(x); c.save(); c.globalAlpha = .45; c.strokeStyle = '#9db8aa'; c.lineWidth = 20;
          c.beginPath(); c.moveTo(x - 105, y + 10); c.lineTo(x - 105, y - 210); c.arc(x, y - 210, 105, Math.PI, 0); c.lineTo(x + 105, y + 10); c.stroke();
          c.strokeStyle = '#c8cead'; c.lineWidth = 3; c.beginPath(); c.arc(x, y - 210, 120, Math.PI, 0); c.stroke(); c.restore();
        }
        for (let id = Math.max(0, Math.floor((left - 1800) / 2600)); id <= Math.floor((right - 1800) / 2600); id++) {
          const start = 1800 + id * 2600, b = terrain.bridgeAt(start + 260), at = terrain.bridges.get(id), age = at === undefined ? 0 : time - at;
          c.save(); c.strokeStyle = age > 0 ? '#ffc679' : '#c5c5a1'; c.lineWidth = 7;
          for (let j = 0; j < 8; j++) {
            const x = start + 105 + j * 39, fall = age >= .6 ? Math.min(150, Math.pow(Math.max(0, age - .6 - j * .035), 2) * 330) : 0;
            if (fall >= 150) continue;
            c.globalAlpha = 1 - fall / 170; c.beginPath(); c.moveTo(x, b.y + fall); c.lineTo(x + 33, b.y + fall); c.stroke();
            c.lineWidth = 2; c.strokeStyle = '#263d48'; c.beginPath(); c.moveTo(x + 8, b.y - 4 + fall); c.lineTo(x + 14, b.y + 5 + fall); c.lineTo(x + 22, b.y - 3 + fall); c.stroke(); c.lineWidth = 7; c.strokeStyle = '#d0c6a2';
          }
          c.globalAlpha = 1; c.font = 'bold 12px system-ui'; c.fillStyle = '#ffe0a7'; c.fillText(age >= .6 ? 'BRIDGE DOWN' : age > 0 ? 'CRUMBLING!' : 'CRACKED BRIDGE', start + 150, b.y - 145); c.restore();
        }
      }
      for (const z of terrain.zonesBetween(left, right)) {
        const x = (z.start + z.end) / 2, y = terrain.height(x); c.save();
        if (z.type === 'current') {
          c.strokeStyle = '#81f2dd'; c.fillStyle = '#aaf2d4'; c.globalAlpha = .55; c.lineWidth = 3;
          for (let xx = z.start + 30; xx < z.end; xx += 90) { const yy = terrain.height(xx) - 83; c.beginPath(); c.moveTo(xx - z.direction * 22, yy); c.lineTo(xx + z.direction * 22, yy); c.lineTo(xx + z.direction * 10, yy - 8); c.moveTo(xx + z.direction * 22, yy); c.lineTo(xx + z.direction * 10, yy + 8); c.stroke(); }
          c.font = 'bold 11px system-ui'; c.fillText(z.direction > 0 ? 'FOLLOWING CURRENT' : 'HEAD CURRENT', z.start + 25, y - 112);
        } else if (z.type === 'ribs') {
          c.strokeStyle = '#c8c6b3'; c.lineWidth = 14; c.beginPath();
          for (let xx = z.start; xx <= z.end; xx += 12) xx === z.start ? c.moveTo(xx, terrain.ceiling(xx) - 10) : c.lineTo(xx, terrain.ceiling(xx) - 10); c.stroke();
          for (let xx = z.start + 40; xx < z.end; xx += 115) {
            const yy = terrain.height(xx), roof = terrain.ceiling(xx); c.strokeStyle = '#9dafa7'; c.lineWidth = 11;
            c.beginPath(); c.moveTo(xx + 50, roof - 8); c.bezierCurveTo(xx - 45, roof - 65, xx - 80, yy - 80, xx - 42, yy + 12); c.stroke();
            ellipse(c, xx + 50, roof - 10, 18, 12, '#dfd9c4');
          }
          // Skull and long jaw make the scale of this animal readable.
          c.save(); c.translate(z.start - 40, terrain.height(z.start) - 45); c.rotate(-.15);
          ellipse(c, 0, 0, 110, 40, '#b9bcad'); ellipse(c, 32, -8, 14, 12, '#263746'); c.strokeStyle = '#e1d8bd'; c.lineWidth = 9; c.beginPath(); c.moveTo(-85, 18); c.lineTo(95, 27); c.stroke(); c.restore();
        } else if (z.type === 'plankton') {
          for (let j = 0; j < 70; j++) { const xx = z.start + hash(j + 8) * (z.end - z.start), yy = terrain.height(xx) - 20 - (hash(j + 60) * 195 + time * 12) % 205; glow(c, xx, yy, 6, '#83ffd2', .3); ellipse(c, xx, yy, 2, 2, '#acffe2'); }
        } else if (z.type === 'mud') {
          c.fillStyle = '#684c56cc'; c.beginPath(); for (let xx = z.start; xx <= z.end; xx += 10) { const yy = terrain.height(xx) - 2; xx === z.start ? c.moveTo(xx, yy) : c.lineTo(xx, yy); } c.lineTo(z.end, y + 35); c.lineTo(z.start, y + 35); c.fill();
          c.fillStyle = '#e6b29a'; c.font = 'bold 11px system-ui'; c.fillText('SLOW MUD', z.start + 20, terrain.height(z.start) - 22);
        } else if (z.type === 'elevator') {
          c.fillStyle = '#ffce8830'; c.fillRect(z.start, y - 310, z.end - z.start, 310); c.strokeStyle = '#ffe4ac80'; c.lineWidth = 1;
          for (let j = 0; j < 36; j++) { const xx = z.start + hash(j + 16) * (z.end - z.start), yy = y - (time * 70 + hash(j) * 310) % 310; ellipse(c, xx, yy, 3 + hash(j + 1) * 6, 3 + hash(j + 1) * 6); c.stroke(); }
          c.font = 'bold 11px system-ui'; c.fillStyle = '#ffe6bd'; c.fillText('↑ BUBBLE LIFT', z.start + 30, y - 325);
        } else if (z.type === 'geyser') {
          const phase = terrain.ventPhase(z), erupting = phase >= 3.45;
          glow(c, x, y, 50 + phase * 10, '#ffbd68', .1 + phase * .15);
          c.strokeStyle = '#ffe6af'; c.lineWidth = 4; c.beginPath(); c.moveTo(x - 35, y - 2); c.lineTo(x - 9, y - 9); c.lineTo(x + 5, y); c.lineTo(x + 35, y - 6); c.stroke();
          if (erupting) this.waterColumn(c, x, y, 330, Math.min(1, (4 - phase) * 3));
          c.font = 'bold 13px system-ui'; c.fillStyle = '#ffe8c6'; c.textAlign = 'center'; c.fillText(erupting ? 'ERUPTING!' : '♨ ' + Math.max(0, 3.45 - phase).toFixed(1) + 's', x + 85, y - 80);
        }
        c.restore();
      }
      if (terrain.stage.id === 'whale') for (const ramp of terrain.rampsBetween(left, right)) {
        c.strokeStyle = '#dbd2b7'; c.lineWidth = 9; c.beginPath(); for (let xx = ramp.x - 175; xx <= ramp.x; xx += 8) xx === ramp.x - 175 ? c.moveTo(xx, terrain.height(xx) - 3) : c.lineTo(xx, terrain.height(xx) - 3); c.stroke();
      }
      if (terrain.stage.id === 'thermal') { c.save(); for (let j = 0; j < 7; j++) glow(c, left + (right - left) * j / 6, terrain.height(left + (right - left) * j / 6) - 110 + Math.sin(time + j) * 30, 230, '#ffc994', .08); c.restore(); }
      for (const p of scene.players || []) {
        if (p.effects.geyserWarning > 0) {
          const r = p.rover, y = terrain.height(r.x); c.save(); c.strokeStyle = '#d2ffff';
          for (let j = 0; j < 15; j++) { const yy = y - (this.time * 120 + j * 7) % 90; ellipse(c, r.x + Math.sin(j * 5) * 35, yy, 3, 3); c.stroke(); }
          c.font = 'bold 15px system-ui'; c.fillStyle = '#e9ffff'; c.textAlign = 'center'; c.fillText('♨ RUMBLE!', r.x, y - 100); c.restore();
        }
        if (p.effects.geyser > 0) this.waterColumn(c, p.geyserX, p.geyserY, Math.max(280, p.geyserY - p.rover.y + 35), p.effects.geyser * 2);
      }
    }
    treasure(c, chest, players) {
      c.save(); const carrier = chest.carrier >= 0 ? players?.[chest.carrier] : null;
      const x = carrier ? carrier.rover.x : chest.x, y = carrier ? carrier.rover.y + 40 : chest.y;
      if (carrier) { c.strokeStyle = '#dfd6ad'; c.lineWidth = 2; c.beginPath(); c.moveTo(x - 20, y - 33); c.lineTo(x - 14, y); c.moveTo(x + 20, y - 33); c.lineTo(x + 14, y); c.stroke(); }
      glow(c, x, y, 48, '#ffd579', .25); c.translate(x, y);
      c.fillStyle = '#9b643e'; c.fillRect(-22, -13, 44, 28); c.fillStyle = '#ffd37c'; c.fillRect(-23, -15, 46, 6); c.fillRect(-23, 9, 46, 5); c.fillRect(-17, -14, 4, 27); c.fillRect(13, -14, 4, 27); c.fillRect(-5, -3, 10, 10);
      c.restore();
    }
    stageThumbnail(canvas, stage) {
      canvas.width = 560; canvas.height = 180; const c = canvas.getContext('2d'); c.clearRect(0, 0, 560, 180);
      const terrain = new AR.Terrain(stage); const x = stage.id === 'city' ? 2060 : stage.id === 'thermal' ? 955 : 1250;
      terrain.worldTime = stage.id === 'thermal' ? 3.6 : 1;
      const floor = terrain.height(x); c.save(); c.translate(280 - x * .48, 165 - floor * .48); c.scale(.48, .48);
      this.stageMechanics(c, terrain, {}, x - 600, x + 600); c.restore();
    }

    sharks(c, sharks) {
      for (const shark of sharks) {
        if (!this.inView(shark.x, shark.y, 220)) continue;
        const warning = shark.phase === 'warning', lunge = shark.phase === 'lunge';
        c.save(); c.translate(shark.x, shark.y);
        if (warning) {
          c.strokeStyle = '#ffbd87'; c.lineWidth = 2; c.globalAlpha = .6 + Math.sin(this.time * 15) * .25;
          c.setLineDash([6, 7]); c.beginPath(); c.moveTo(0, 0); c.lineTo((shark.aimX ?? shark.x + shark.direction * 600) - shark.x, (shark.aimY ?? shark.y) - shark.y); c.stroke(); c.setLineDash([]);
          c.fillStyle = '#ffe5b2'; c.font = 'bold 14px system-ui'; c.textAlign = 'center'; c.fillText(shark.fish ? '! FISH TRAFFIC' : '! SHARK · JUMP / BRAKE', 0, -54); c.globalAlpha = 1;
        }
        c.scale(shark.direction || 1, 1);
        if (shark.fish) {
          for (let j = 0; j < 9; j++) {
            const x = (j % 3) * 22 - 30, y = Math.floor(j / 3) * 15 - 15 + Math.sin(this.time * 8 + j) * 3;
            ellipse(c, x, y, 10, 5, j % 2 ? '#99ead3' : '#eacb8f');
            c.fillStyle = '#72baa9'; c.beginPath(); c.moveTo(x - 7, y); c.lineTo(x - 16, y - 6); c.lineTo(x - 16, y + 6); c.fill(); ellipse(c, x + 5, y - 1, 1.5, 1.5, '#20394a');
          }
          c.restore(); continue;
        }
        c.fillStyle = lunge ? '#7398a6' : '#507b89';
        c.beginPath(); c.moveTo(-36, 0); c.lineTo(-62, -24); c.lineTo(-54, 0); c.lineTo(-62, 24); c.closePath(); c.fill();
        c.beginPath(); c.moveTo(-8, -12); c.lineTo(1, -40); c.lineTo(20, -9); c.closePath(); c.fill();
        ellipse(c, 0, 0, 43, 17, c.fillStyle);
        ellipse(c, 10, 6, 30, 8, '#abc4c6');
        c.fillStyle = '#56828d'; c.beginPath(); c.moveTo(-3, 8); c.lineTo(12, 29); c.lineTo(23, 10); c.fill();
        ellipse(c, 28, -6, 3, 3, warning || lunge ? '#ffd28c' : '#e0f5ed'); ellipse(c, 29, -6, 1.5, 1.5, '#122733');
        c.strokeStyle = '#244956'; c.lineWidth = 2;
        for (let j = 0; j < 3; j++) { c.beginPath(); c.moveTo(14 - j * 5, -5); c.lineTo(12 - j * 5, 5); c.stroke(); }
        c.beginPath(); c.moveTo(30, 6); c.lineTo(42, 2); c.stroke(); c.restore();
      }
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

    pickups(c, pickups, texturePass = false) {
      for (const item of pickups) {
        if (item.collected || (!texturePass && !this.inView(item.x, item.y, 48))) continue;
        if (!texturePass) {
          const sprite = this.sprite('pickup:' + item.type, 112, 112, paint => {
            paint.translate(56, 56); const time = this.time; this.time = 0;
            this.pickups(paint, [{ ...item, x: 0, y: 0 }], true); this.time = time;
          });
          const bob = item.type === 'chest' ? 0 : Math.sin(this.time * 2.7 + item.x * .017) * 3;
          c.save(); c.translate(item.x, item.y + bob);
          if (item.type === 'crate') { const pulse = 1 + Math.sin(this.time * 3 + item.x) * .07; c.scale(pulse, pulse); }
          c.drawImage(sprite, -56, -56, 112, 112); c.restore(); continue;
        }
        const bob = item.type === 'chest' ? 0 : Math.sin(this.time * 2.7 + item.x * .017) * 3;
        c.save(); c.translate(item.x, item.y + bob);
        if (item.type === 'crate') {
          const pulse = 1 + Math.sin(this.time * 3 + item.x) * .07;
          glow(c, 0, 0, 43, '#c69aff', .24);
          c.scale(pulse, pulse); c.lineWidth = 2.2; c.strokeStyle = '#e2b9ff';
          ellipse(c, 0, 0, 23, 23, 'rgba(74,39,110,.60)'); c.stroke();
          c.strokeStyle = '#79f6e6'; c.lineWidth = 1.5;
          c.beginPath(); c.arc(0, 0, 28, this.time * 1.3, this.time * 1.3 + 2.3); c.arc(0, 0, 28, this.time * 1.3 + Math.PI, this.time * 1.3 + Math.PI + 2.3); c.stroke();
          c.fillStyle = '#fff3d8'; c.font = '900 29px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', 0, 1);
          ellipse(c, -11, -12, 3.5, 2, '#efd7ff');
        } else if (item.type === 'oxygen') {
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

    finishMarker(c, x, y) {
      c.save(); c.translate(x, y);
      glow(c, 0, -90, 150, '#ffe3a0', .18);
      c.strokeStyle = '#ffdf94'; c.lineWidth = 4; c.beginPath(); c.moveTo(0, 4); c.lineTo(0, -210); c.stroke();
      c.fillStyle = '#122f3f'; c.fillRect(0, -210, 84, 44);
      for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
        if ((row + col) % 2) continue;
        c.fillStyle = '#fff0c0'; c.fillRect(col * 10.5, -210 + row * 11, 10.5, 11);
      }
      c.font = '800 12px system-ui, sans-serif'; c.fillStyle = '#ffe7ab'; c.fillText('FINISH', 8, -147); c.restore();
    }

    projectiles(c, projectiles, alpha) {
      for (const projectile of projectiles) {
        if (projectile.life <= 0 || !this.inView(projectile.x, projectile.y, 100)) continue;
        const old = projectile.prev || projectile;
        const x = mix(old.x, projectile.x, alpha), y = mix(old.y, projectile.y, alpha);
        const color = projectile.owner === 2 ? '#cfb1ff' : projectile.owner === 1 ? '#7ff8f1' : '#ffd292';
        c.save(); c.translate(x, y);
        if (projectile.type === 'bubble') {
          glow(c, 0, 0, 25, color, .18);
          ellipse(c, 0, 0, 10, 10, 'rgba(130,239,245,.25)');
          c.strokeStyle = color; c.lineWidth = 2; c.stroke();
          ellipse(c, -3, -4, 3, 2, '#f3ffff');
          c.strokeStyle = color; c.lineWidth = 1; c.globalAlpha = .45;
          for (let j = 1; j < 4; j++) { ellipse(c, -j * 12 * (projectile.direction || Math.cos(projectile.angle || 0)), 0, 4 - j * .7, 4 - j * .7); c.stroke(); }
        } else if (projectile.type === 'anchor') {
          glow(c, 0, -12, 30, '#ffaf87', .15);
          c.strokeStyle = '#142c36'; c.lineWidth = 9; c.lineCap = 'round';
          const shape = () => {
            c.beginPath(); c.moveTo(0, -31); c.lineTo(0, -3); c.moveTo(-12, -24); c.lineTo(12, -24);
            c.moveTo(-18, -15); c.quadraticCurveTo(-15, 4, 0, 3); c.quadraticCurveTo(15, 4, 18, -15); c.stroke();
          };
          shape(); c.strokeStyle = '#a2b5be'; c.lineWidth = 4.5; shape();
          c.strokeStyle = color; c.lineWidth = 2.5; ellipse(c, 0, -36, 5, 5); c.stroke();
          c.fillStyle = '#d9e7e2';
          for (const dir of [-1, 1]) { c.beginPath(); c.moveTo(dir * 18, -19); c.lineTo(dir * 24, -9); c.lineTo(dir * 11, -11); c.closePath(); c.fill(); }
        } else {
          const direction = projectile.direction || (projectile.vx < 0 ? -1 : 1);
          if (Number.isFinite(projectile.angle)) c.rotate(projectile.angle); else c.scale(direction, 1);
          c.strokeStyle = 'rgba(182,255,244,.64)'; c.lineWidth = 1;
          for (let j = 0; j < 9; j++) {
            const drift = (this.time * 8 + j * .73) % 9;
            c.globalAlpha = (1 - drift / 9) * .7;
            ellipse(c, -23 - drift * 9, Math.sin(drift * 2 + j) * (2 + drift * .7), 2 + drift * .35, 2 + drift * .35); c.stroke();
          }
          c.globalAlpha = 1; glow(c, -20, 0, 23, '#fff0b4', .4);
          c.fillStyle = '#5d858f'; c.beginPath(); c.moveTo(-20, -4); c.lineTo(-29, -12); c.lineTo(-27, 12); c.lineTo(-20, 4); c.fill();
          const body = this.sprite('torpedo:' + color, 56, 22, paint => {
            paint.translate(28, 11);
            const hull = paint.createLinearGradient(0, -8, 0, 8); hull.addColorStop(0, '#e2f2f0'); hull.addColorStop(.45, '#98bbc0'); hull.addColorStop(1, '#426773');
            ellipse(paint, 0, 0, 25, 8, hull); paint.strokeStyle = '#183943'; paint.lineWidth = 2; paint.stroke();
            ellipse(paint, 18, 0, 7, 7, color); paint.fillStyle = '#254c59'; paint.fillRect(-12, -7, 3, 14);
            ellipse(paint, 4, -2, 3, 2, '#f7ffff');
          });
          c.drawImage(body, -28, -11, 56, 22);
        }
        c.restore();
      }
    }

    playerEffects(c, player, alpha, mode) {
      const effects = player.effects || {}, rover = player.rover, old = rover.prev || rover;
      const x = mix(old.x, rover.x, alpha), y = mix(old.y, rover.y, alpha);
      c.save(); c.translate(x, y);
      if (mode === 'arena') {
        const facing = player.facing || 1;
        c.save(); c.scale(facing, 1);
        c.fillStyle = '#12303b'; roundRect(c, 3, -30, 39, 15, 5); c.fill();
        c.strokeStyle = player.index ? '#83f4ed' : '#ffd292'; c.lineWidth = 2; c.stroke();
        ellipse(c, 12, -19, 10, 9, '#547c85');
        ellipse(c, 39, -23, 4, 7, effects.fireCooldown > .5 ? '#edffff' : '#80c6cd');
        c.restore();
      }
      if (effects.gravity > 0) {
        c.strokeStyle = '#d5b0ff'; c.lineWidth = 2; c.setLineDash([8, 5]);
        ellipse(c, 0, 0, 66, 51); c.stroke(); c.setLineDash([]);
        c.fillStyle = '#eddfff'; c.font = 'bold 20px system-ui'; c.textAlign = 'center'; c.fillText('⇅', 0, 73);
      }
      if (effects.jet > 0) {
        const dir = rover.vx < -5 ? -1 : 1;
        c.save(); c.scale(dir, 1);
        for (let j = 0; j < 4; j++) {
          const tail = 42 + j * 13 + Math.sin(this.time * 30 + j) * 5;
          ellipse(c, -tail, 3 + Math.sin(this.time * 9 + j) * 5, 12 - j * 2, 5 - j * .6, j ? '#65dcee' : '#ecffff');
        }
        c.restore();
      }
      if (effects.shield > 0 || effects.spawnShield > 0 || player.spawnShield > 0) {
        const radius = (rover.stats.wheelbase || 64) * .70 + 20;
        const color = player.index === 1 ? '#9efff5' : '#ffe0a5';
        glow(c, 0, -2, radius + 12, color, .13);
        c.strokeStyle = color; c.lineWidth = 2.5; c.globalAlpha = .6 + Math.sin(this.time * 5) * .18;
        ellipse(c, 0, -2, radius, radius, 'rgba(124,234,243,.065)'); c.stroke();
        c.strokeStyle = '#e7ffff'; c.lineWidth = 4; c.beginPath(); c.arc(0, -2, radius - 6, Math.PI * 1.1, Math.PI * 1.43); c.stroke(); c.globalAlpha = 1;
      }
      if (effects.turbo > 0) {
        const tail = -(rover.stats.wheelbase || 64) * .7;
        for (let i = 0; i < 3; i++) {
          c.strokeStyle = i === 1 ? '#e5ffff' : '#61f7ed'; c.lineWidth = 3 - i * .5;
          c.beginPath(); c.moveTo(tail, i * 7 - 7); c.lineTo(tail - 35 - Math.sin(this.time * 35 + i) * 15, i * 9 - 9); c.stroke();
        }
      }
      if (effects.net > 0) {
        for (let j = 0; j < 3; j++) {
          const xx = (j - 1) * 27, yy = -33 + Math.sin(this.time * 3 + j) * 3;
          glow(c, xx, yy, 20, '#ee9bff', .2);
          c.strokeStyle = '#e6a7fc'; c.lineWidth = 1.3;
          for (let k = 0; k < 4; k++) {
            c.beginPath(); c.moveTo(xx + (k - 1.5) * 5, yy + 3);
            c.bezierCurveTo(xx + (k - 1.5) * 8 + 4, yy + 14, xx + (k - 1.5) * 8 - 8, yy + 26, xx + (k - 1.5) * 7 + Math.sin(this.time * 6 + k) * 4, yy + 38); c.stroke();
          }
          c.fillStyle = 'rgba(222,148,255,.72)'; c.beginPath(); c.ellipse(xx, yy, 14, 11, 0, Math.PI, TAU); c.quadraticCurveTo(xx + 4, yy + 6, xx - 14, yy); c.fill();
          ellipse(c, xx - 4, yy - 5, 3, 1.5, '#f9daff');
        }
      }
      if (effects.blocked > 0 || effects.dodged > 0) {
        const blocked = effects.blocked > 0, remaining = blocked ? effects.blocked : effects.dodged;
        const progress = 1 - clamp(remaining / (blocked ? .8 : 1.3), 0, 1);
        c.globalAlpha = (1 - progress) * .9; c.strokeStyle = blocked ? '#caffff' : '#ffeba5'; c.lineWidth = 2.5;
        const radius = 47 + progress * 47;
        ellipse(c, 0, -5, radius, radius); c.stroke();
        for (let j = 0; j < 7; j++) {
          const angle = j / 7 * TAU + this.time * .6;
          c.beginPath(); c.moveTo(Math.cos(angle) * (radius + 5), Math.sin(angle) * (radius + 5) - 5);
          c.lineTo(Math.cos(angle) * (radius + 13), Math.sin(angle) * (radius + 13) - 5); c.stroke();
        }
      }
      c.restore();
    }

    renderAwarenessLayer(scene, camera, rect, alpha) {
      // Clear only the small label areas that changed. HUD text lives in the DOM.
      const c = this.awarenessCtx, density = this.nativeDpr;
      const key = [rect.x || 0, rect.y || 0, rect.width, rect.height].join(':');
      c.save(); c.setTransform(density, 0, 0, density, (rect.x || 0) * density, (rect.y || 0) * density);
      c.beginPath(); c.rect(0, 0, rect.width, rect.height); c.clip();
      for (const area of this.awarenessRegions.get(key) || []) c.clearRect(area.x - 2, area.y - 2, area.width + 4, area.height + 4);
      this.awarenessRegions.set(key, this.opponentAwareness(c, scene, camera, alpha, rect));
      c.restore();
    }

    opponentAwareness(c, scene, camera, alpha, rect = { x: 0, y: 0 }) {
      const w = this.viewWidth, h = this.viewHeight;
      const areas = [];
      const own = scene.player || scene.players.find(player => player.rover === scene.rover);
      const obstacles = ['v-reversed-', 'v-treasure-'].map(id => document.getElementById(id + own.index)).filter(n => n && !n.hidden).map(n => n.getBoundingClientRect());
      const obscured = (x, y, width, height) => obstacles.some(b => x + width > b.left - rect.x && x < b.right - rect.x && y + height > b.top - rect.y && y < b.bottom - rect.y);
      c.save(); c.font = '800 11px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (const player of scene.players) {
        const rover = player.rover; if (!rover) continue;
        const old = rover.prev || rover, x = mix(old.x, rover.x, alpha) * this.zoom + camera.tx;
        const y = mix(old.y, rover.y, alpha) * this.zoom + camera.ty;
        const color = player.index === 2 ? '#cfb1ff' : player.index === 1 ? '#83f4ed' : '#ffd092';
        if (x >= 35 && x <= w - 35 && y >= 145 && y <= h - 14) {
          let yy = Math.max(153, y - 61 * this.zoom);
          const other = scene.players.find(p => p !== player), otherOld = other.rover.prev || other.rover;
          const otherX = mix(otherOld.x, other.rover.x, alpha) * this.zoom + camera.tx;
          const close = Math.abs(otherX - x) < 44 && Math.abs(other.rover.y - rover.y) * this.zoom < 30;
          const labelX = close ? (x + otherX) / 2 + (player.index ? 22 : -22) : x;
          const label = this.sprite('player-label:' + player.index, 36, 22, paint => {
            paint.fillStyle = '#0a2632'; roundRect(paint, 1, 1, 34, 20, 8); paint.fill();
            paint.strokeStyle = color; paint.lineWidth = 1; paint.stroke(); paint.fillStyle = color; paint.font = '800 11px system-ui, sans-serif'; paint.textAlign = 'center'; paint.textBaseline = 'middle'; paint.fillText('P' + (player.index + 1), 18, 11);
          }, this.nativeDpr);
          while (areas.some(a => Math.abs(a.x + a.width / 2 - labelX) < a.width / 2 + 20 && Math.abs(a.y + a.height / 2 - yy) < a.height / 2 + 13)) yy += 25;
          if (yy > h - 14 || obscured(labelX - 18, yy - 11, 36, 22)) continue;
          c.drawImage(label, Math.round(labelX - 18), Math.round(yy - 11), 36, 22);
          areas.push({ x: labelX - 18, y: yy - 11, width: 36, height: 22 });
        } else if (player !== own && player.rover !== scene.rover) {
          const gap = Math.round(Math.abs(rover.x - scene.rover.x) * .1), ahead = rover.x >= scene.rover.x;
          const vertical = x >= 35 && x <= w - 35;
          const label = 'P' + (player.index + 1) + ' ' + (vertical ? y < 145 ? '▲' : '▼' : ahead ? '▶' : '◀') + ' ' + gap + ' m ' + (ahead ? 'ahead' : 'behind');
          const tw = c.measureText(label).width + 24, xx = vertical ? clamp(x, tw / 2 + 10, w - tw / 2 - 10) : ahead ? w - tw / 2 - 12 : tw / 2 + 12;
          let yy = vertical ? y < 145 ? 155 : h - 44 : clamp(y, 155, h - 46);
          if (scene.players.length > 2) yy = 155 + scene.players.filter(p => p !== own).indexOf(player) * 32;
          if (obscured(xx - tw / 2, yy - 14, tw, 28)) continue;
          c.fillStyle = 'rgba(7,29,42,.91)'; roundRect(c, xx - tw / 2, yy - 14, tw, 28, 12); c.fill();
          c.strokeStyle = color; c.lineWidth = 1; c.stroke(); c.fillStyle = color; c.fillText(label, xx, yy);
          areas.push({ x: xx - tw / 2, y: yy - 14, width: tw, height: 28 });
        }
      }
      c.restore();
      return areas;
    }

    viewportEffects(c, player, camera, rect) {
      if (!player) return;
      const effects = player.effects || {}, w = this.viewWidth, h = this.viewHeight;
      const x = camera.screenX, y = camera.screenY, t = this.time;
      c.save();
      if (effects.riptide > 0) {
        const ew = Math.round(w * this.dpr), eh = Math.round(h * this.dpr);
        if (this.effectCanvas.width !== ew || this.effectCanvas.height !== eh) { this.effectCanvas.width = ew; this.effectCanvas.height = eh; }
        this.effectCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.effectCtx.drawImage(this.canvas, Math.round((rect.x || 0) * this.dpr), Math.round((rect.y || 0) * this.dpr), ew, eh, 0, 0, ew, eh);
        for (let row = 0; row < h; row += 6) {
          const sh = Math.min(6, h - row), wave = Math.sin(row * .042 + t * 8) * 8;
          c.drawImage(this.effectCanvas, 0, row * this.dpr, ew, sh * this.dpr, wave, row, w, sh);
        }
        c.fillStyle = 'rgba(143,72,230,.09)'; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#bda0ff'; c.lineWidth = 4; c.globalAlpha = .65;
        for (const edge of [0, w]) { c.beginPath(); for (let yy = 0; yy <= h; yy += 6) { const xx = edge + Math.sin(yy * .045 + t * 7) * 10 + (edge ? -9 : 9); yy ? c.lineTo(xx, yy) : c.moveTo(xx, yy); } c.stroke(); } c.globalAlpha = 1;
      }
      if (effects.turbo > 0) {
        c.strokeStyle = '#b7fff5'; c.lineWidth = 1.5;
        for (let j = 0; j < 18; j++) {
          const yy = 83 + hash(j + 55) * Math.max(1, h - 110), xx = ((hash(j + 12) * w - t * (550 + j * 17)) % w + w) % w;
          if (Math.abs(yy - y) < 55 && Math.abs(xx - x) < 100) continue;
          c.globalAlpha = .13 + hash(j + 11) * .25; c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx + 24 + hash(j) * 70, yy); c.stroke();
        }
        c.globalAlpha = 1;
      }
      if (effects.siphon > 0 || effects.siphonGain > 0 || effects.magnet > 0 || effects.magnetGain > 0) {
        const pearls = effects.magnet > 0 || effects.magnetGain > 0;
        const gaining = effects.siphonGain > 0 || effects.magnetGain > 0;
        for (let j = 0; j < 22; j++) {
          let q = ((t * .75 + j / 22) % 1); if (!gaining) q = 1 - q;
          const bx = mix(w * .6, x, q) + Math.sin(q * 8 + j) * 24;
          const by = mix(player.index === 1 ? 0 : h, y, q);
          c.globalAlpha = Math.sin(q * Math.PI) * .9; c.strokeStyle = pearls ? '#fff3c4' : '#aaffd8'; c.lineWidth = 1.5;
          ellipse(c, bx, by, 3 + hash(j + 45) * 5, 3 + hash(j + 45) * 5, pearls ? '#eddfb1' : 'rgba(101,255,187,.17)'); c.stroke();
          if (pearls) ellipse(c, bx - 1, by - 2, 1.5, 1, '#ffffff');
        }
        c.globalAlpha = 1;
      }
      if (effects.hit > 0) {
        c.globalAlpha = clamp(effects.hit / .8, 0, 1) * .65;
        c.strokeStyle = '#ff9c7d'; c.lineWidth = 7; c.strokeRect(3, 3, w - 6, h - 6);
        c.fillStyle = 'rgba(255,103,79,.13)'; c.fillRect(0, 0, w, h); c.globalAlpha = 1;
      }
      if (effects.ink > 0) {
        const elapsed = clamp(3.5 - effects.ink, 0, 3.5), spread = clamp(elapsed / .45, .1, 1);
        const hole = mix(105, 25, clamp(elapsed / 3.1, 0, 1));
        const radius = hole + 52;
        const ink = this.sprite('ink-opening', 256, 256, paint => {
          const gradient = paint.createRadialGradient(128, 128, 72, 128, 128, 128);
          gradient.addColorStop(0, 'rgba(1,3,13,0)'); gradient.addColorStop(1, 'rgba(1,2,10,.985)');
          paint.fillStyle = gradient; paint.fillRect(0, 0, 256, 256);
        }, 1);
        c.globalAlpha = spread * Math.min(1, effects.ink / .35); c.fillStyle = 'rgba(1,2,10,.985)';
        const top = clamp(y - radius, 0, h), bottom = clamp(y + radius, 0, h);
        c.fillRect(0, 0, w, top); c.fillRect(0, bottom, w, h - bottom);
        c.fillRect(0, top, Math.max(0, x - radius), bottom - top);
        c.fillRect(x + radius, top, Math.max(0, w - x - radius), bottom - top);
        c.drawImage(ink, x - radius, y - radius, radius * 2, radius * 2);
        c.save(); c.beginPath(); c.rect(0, 0, w, h); c.arc(x, y, hole + 32, 0, TAU, true); c.clip('evenodd');
        for (let j = 0; j < 9; j++) {
          const bx = w * hash(j + 633), by = h * hash(j + 34), radius = 35 + hash(j + 47) * 80;
          ellipse(c, bx + Math.sin(t + j) * 15, by + Math.cos(t * .7 + j) * 18, radius * spread, radius * .7 * spread, 'rgba(8,9,25,.44)');
        }
        c.restore();
      }
      c.restore();
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
      {
        // The pressure hull is rigid. Cache its detailed paint/glass work once
        // per tournament vehicle and colour; suspension and wheels stay live.
        const key = [id, s.color, wb, headlight, this.rasterScale()].join(':');
        let sprite = this.chassisCache.get(key);
        if (!sprite) {
          sprite = spriteCanvas();
          const scale = this.rasterScale();
          sprite.width = 280 * scale; sprite.height = 150 * scale;
          const paint = sprite.getContext('2d'); paint.setTransform(scale, 0, 0, scale, 140 * scale, 80 * scale); paint.lineCap = 'round';
          this.drawChassis(paint, rover, headlight, true); sprite = freezeSprite(sprite); cacheSprite(this.chassisCache, key, sprite, 32);
        }
        c.drawImage(sprite, -140, -80, 280, 150);
        const tail = -wb * .64 - 15, spin = Math.cos(this.time * (10 + Math.abs(rover.vx) * .2));
        c.strokeStyle = '#b4c6b9'; c.lineWidth = 3; c.beginPath(); c.moveTo(tail, 1 - 13 * spin); c.lineTo(tail, 1 + 13 * spin); c.stroke();
      }
      c.restore();
    }

    drawChassis(c, rover, headlight, frozenPropeller) {
      const s = rover.stats, wb = s.wheelbase || 64, id = s.id || 'rover';
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
      const spin = frozenPropeller ? 0 : Math.cos(this.time * (10 + Math.abs(rover.vx) * .2));
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
      const hull = c.createLinearGradient(0, -13, 0, hullHeight * .6); hull.addColorStop(0, color); hull.addColorStop(1, id === 'rover' && color === '#ffb547' ? '#ce7b36' : color);
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
    }


    wheel(c, wheel, id, texturePass = false) {
      if (!texturePass) {
        const size = Math.ceil(wheel.radius + 4) * 2;
        const sprite = this.sprite('wheel:' + id + ':' + wheel.radius, size, size, paint => this.wheel(paint, { ...wheel, x: size / 2, y: size / 2, angle: 0 }, id, true));
        c.save(); c.translate(wheel.x, wheel.y); c.rotate(wheel.angle); c.drawImage(sprite, -size / 2, -size / 2, size, size); c.restore(); return;
      }
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
      let drawn = 0;
      for (const particle of particles) {
        if (particle.life <= 0 || (particle.type === 'sand') === front || !this.inView(particle.x, particle.y, 15)) continue;
        if (++drawn > (this.graphics === 'performance' ? 40 : 100)) break;
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
      const w = this.viewWidth || this.width, h = this.viewHeight || this.height, t = this.time;
      c.save();
      // Fixed-size deterministic particle field: nothing is allocated or retained per bubble.
      for (let i = 0; i < (this.graphics === 'performance' ? 12 : this.versusView ? 24 : 40); i++) {
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
      const c = this.lightCtx, w = this.viewWidth || this.width, h = this.viewHeight || this.height, color = lightColor(headlight);
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, w, h);
      c.fillStyle = stage === 'abyss' ? 'rgba(0,3,13,.965)' : stage === 'wreck' ? 'rgba(0,9,20,.36)' : 'rgba(8,4,16,.23)'; c.fillRect(0, 0, w, h);
      c.save(); c.translate(x, y); c.rotate(angle); c.globalCompositeOperation = 'destination-out';
      const radius = 145 * this.zoom;
      const local = this.sprite('headlight-local', 300, 300, paint => {
        const gradient = paint.createRadialGradient(150, 150, 10, 150, 150, 150);
        gradient.addColorStop(0, 'rgba(0,0,0,.92)'); gradient.addColorStop(.45, 'rgba(0,0,0,.66)'); gradient.addColorStop(1, 'transparent');
        paint.fillStyle = gradient; paint.fillRect(0, 0, 300, 300);
      }, 1);
      c.drawImage(local, -radius, -radius, radius * 2, radius * 2);
      const length = Math.min(700, w * .75);
      const beam = this.sprite('headlight-beam', 790, 450, paint => {
        paint.translate(0, 225); const gradient = paint.createLinearGradient(20, 0, 700, 0);
        gradient.addColorStop(0, 'rgba(0,0,0,.95)'); gradient.addColorStop(.45, 'rgba(0,0,0,.82)'); gradient.addColorStop(1, 'transparent');
        paint.fillStyle = gradient; paint.beginPath(); paint.moveTo(30, -6); paint.lineTo(700, -224); paint.quadraticCurveTo(784, 0, 700, 224); paint.closePath(); paint.fill();
      }, 1);
      c.drawImage(beam, 0, -length * 225 / 700, length * 790 / 700, length * 450 / 700); c.restore();
      this.ctx.drawImage(this.lightCanvas, 0, 0, Math.round(w * this.dpr), Math.round(h * this.dpr), 0, 0, w, h);
      const g = this.ctx; g.save(); g.translate(x, y); g.rotate(angle); g.globalAlpha = stage === 'abyss' ? .065 : .025;
      g.fillStyle = color; g.beginPath(); g.moveTo(33 * this.zoom, -2); g.lineTo(length, -length * .31); g.quadraticCurveTo(length * 1.1, 0, length, length * .31); g.closePath(); g.fill(); g.restore();
    }

    floatingText(c, texts) {
      c.save(); c.font = '700 15px system-ui, -apple-system, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (const text of texts) {
        if (text.life <= 0 || !this.inView(text.x, text.y, 80)) continue;
        c.globalAlpha = clamp(text.life / .35, 0, 1); c.lineWidth = 4; c.strokeStyle = '#12333d'; c.strokeText(text.text, text.x, text.y);
        c.fillStyle = text.color || '#ffe5a0'; c.fillText(text.text, text.x, text.y);
      }
      c.restore();
    }

    thumbnail(canvas, vehicleId) {
      const stats = typeof vehicleId === 'object' ? vehicleId : AR.getStats(vehicleId, {});
      const c = canvas.getContext('2d'), rect = canvas.getBoundingClientRect();
      const w = rect.width || Number(canvas.getAttribute('width')) || 220, h = rect.height || Number(canvas.getAttribute('height')) || 110;
      const dpr = clamp(root.devicePixelRatio || 1, 1, 2); canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
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
