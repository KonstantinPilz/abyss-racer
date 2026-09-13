(function () {
  'use strict';
  const AR = window.AR;
  const STEP = AR.FIXED_DT;
  const TAU = Math.PI * 2;
  const MAX_PARTICLES = 240;
  const STATES = Object.freeze({ TITLE: 'TITLE', GARAGE: 'GARAGE', RUNNING: 'RUNNING', PAUSED: 'PAUSED', GAMEOVER: 'GAMEOVER' });
  const TRANSITIONS = { TITLE: ['GARAGE'], GARAGE: ['TITLE', 'RUNNING'], RUNNING: ['PAUSED', 'GAMEOVER'], PAUSED: ['RUNNING', 'GAMEOVER'], GAMEOVER: ['RUNNING', 'GARAGE'] };
  const $ = id => document.getElementById(id);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const writeText = (node, value) => { if (node.textContent !== String(value)) node.textContent = value; };
  const format = value => Math.floor(value).toLocaleString('en-US');
  const stageById = id => AR.STAGES.find(stage => stage.id === id) || AR.STAGES[0];
  const vehicleById = id => AR.VEHICLES.find(vehicle => vehicle.id === id) || AR.VEHICLES[0];
  const save = new AR.Save();
  const sound = new AR.Audio();
  const renderer = new AR.Renderer($('ocean'));
  renderer.setGraphics(save.data.settings.graphics);
  const keys = new Set();
  let pendingBurst = false;
  const pointers = { throttle: new Set(), brake: new Set(), burst: new Set() };
  let state = STATES.TITLE;
  let tab = 'vehicles';
  let run = null;
  let accumulator = 0;
  let previousFrame = 0;
  let frameRequest = 0;
  let hudElapsed = 0;
  let particleClock = 0;
  let dialogFocus = null;
  let scene;

  const versus = new AR.Versus(save, sound, renderer, () => {
    delete document.body.dataset.versus;
    scene = createScene('reef', 'rover');
    refreshWallet();
    $('enter-versus').focus({ preventScroll: true });
  });
  const online = new AR.Online(versus);
  $('enter-online').addEventListener('click', () => online.open());
  $('enter-versus').addEventListener('click', () => versus.open());
  const touchDevice = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  $('enter-versus').hidden = touchDevice;
  $('versus-keyboard-note').hidden = !touchDevice;
  if (new URLSearchParams(window.location.search).get('debug') === '1') {
    const debug = versus.debug();
    AR.debug = Object.fromEntries(Object.entries(debug).map(([name, fn]) => [name, (...args) => online.active && online.role === 'guest' ? false : fn(...args)]));
    AR.debug.online = online;
  }

  function createScene(stageId, vehicleId) {
    const stage = stageById(stageId);
    const stats = AR.getStats(vehicleId, save.data.upgrades[vehicleId]);
    const terrain = new AR.Terrain(stage, stage.seed);
    const rover = new AR.Rover(terrain, stats);
    // Let suspension settle for the menu without spending the player's oxygen.
    for (let i = 0; i < 180; i++) rover.step({}, STEP);
    rover.oxygen = rover.maxOxygen;
    rover.crashed = '';
    return { state, terrain, rover, stage, vehicle: stats, time: 0, pickups: [], particles: [], texts: [], headlight: '#90fff1', trail: 'bubbles', shake: 0 };
  }

  function setState(next) {
    if (state !== next && !TRANSITIONS[state].includes(next)) throw new Error('Invalid state transition: ' + state + ' → ' + next);
    state = next;
    scene.state = state;
    document.body.dataset.state = state;
    for (const [id, active] of [['title-screen', state === STATES.TITLE], ['garage-screen', state === STATES.GARAGE], ['hud', state === STATES.RUNNING || state === STATES.PAUSED], ['pause-screen', state === STATES.PAUSED], ['gameover-screen', state === STATES.GAMEOVER]]) $(id).hidden = !active;
    clearInput();
    accumulator = 0;
    previousFrame = 0;
    if (state !== STATES.RUNNING) sound.suspend();
    refreshWallet();
    const focus = { TITLE: 'enter-garage', GARAGE: 'start-run', PAUSED: 'resume-run', GAMEOVER: 'retry' }[state];
    if (focus) $(focus).focus({ preventScroll: true });
  }

  function refreshWallet() {
    $('wallet').textContent = format(save.data.pearls);
    $('title-best').innerHTML = format(Math.max(0, ...Object.values(save.data.bests))) + ' <small>m</small>';
    $('mute-button').textContent = save.data.settings.muted ? '♪̸' : '♫';
    $('mute-button').setAttribute('aria-label', save.data.settings.muted ? 'Unmute sound' : 'Mute sound');
    $('mute-button').setAttribute('aria-pressed', String(save.data.settings.muted));
  }

  function toast(text, special = false) {
    const node = document.createElement('div');
    node.className = 'toast' + (special ? ' special' : '');
    node.textContent = text;
    const stack = $('toast-stack');
    while (stack.children.length >= 3) stack.firstElementChild.remove();
    stack.appendChild(node);
    window.setTimeout(() => node.remove(), 3300);
  }

  function openGarage() {
    if (state === STATES.RUNNING || state === STATES.PAUSED) return;
    scene = createScene(save.data.selectedStage, save.data.selectedVehicle);
    setState(STATES.GARAGE);
    renderGarage();
  }

  function costButton(action, id, cost, owned, selected) {
    if (selected) return '<button class="small-button equipped" disabled>✓ Equipped</button>';
    return '<button class="small-button" data-action="' + action + '" data-id="' + id + '"' + (!owned && cost > save.data.pearls ? ' disabled' : '') + '>' + (owned ? 'Select ride' : '● ' + format(cost) + ' · Unlock') + '</button>';
  }

  function statBar(label, fraction) {
    return '<span class="mini-stat">' + label + '<i><b style="width:' + clamp(fraction * 100, 8, 100) + '%"></b></i></span>';
  }

  function renderGarage() {
    const data = save.data;
    const vehicle = vehicleById(data.selectedVehicle);
    const stage = stageById(data.selectedStage);
    const stats = AR.getStats(vehicle.id, data.upgrades[vehicle.id]);
    const currentXP = data.xp - AR.xpForLevel(data.level);
    const nextXP = AR.xpForLevel(data.level + 1) - AR.xpForLevel(data.level);
    $('level-label').textContent = 'DIVER LEVEL ' + data.level;
    $('level-fill').style.width = (currentXP / nextXP * 100) + '%';
    $('level-progress').textContent = format(currentXP) + ' / ' + format(nextXP) + ' XP';
    $('selected-loadout').innerHTML = vehicle.name + ' <span>/</span> ' + stage.name;
    $('loadout-best').textContent = 'BEST ' + format(data.bests[stage.id + ':' + vehicle.id] || 0) + ' m · READY TO EXPLORE';
    document.querySelectorAll('[data-tab]').forEach(button => {
      button.setAttribute('aria-selected', String(button.dataset.tab === tab));
      button.tabIndex = button.dataset.tab === tab ? 0 : -1;
    });
    $('garage-content').setAttribute('aria-labelledby', 'tab-' + tab);
    let content = '';
    if (tab === 'vehicles') {
      content = '<p class="section-description">Find your sea legs. Every ride has its own feel, and its own upgrades.</p><div class="card-grid vehicle-grid">' + AR.VEHICLES.map((item, index) => {
        const owned = data.vehicles.includes(item.id);
        const selected = item.id === vehicle.id;
        const levels = data.upgrades[item.id] || {};
        const itemStats = AR.getStats(item.id, levels);
        return '<article class="item-card' + (selected ? ' selected' : '') + '"><div class="card-kicker"><span>0' + (index + 1) + ' / ' + (owned ? 'IN YOUR FLEET' : 'UNDISCOVERED') + '</span><span>' + (selected ? 'ACTIVE' : '') + '</span></div><canvas class="vehicle-art" data-vehicle="' + item.id + '" aria-label="' + item.name + '"></canvas><h3>' + item.name + '</h3><p>' + item.description + '</p><div class="stat-bars">' + statBar('SPEED', itemStats.topSpeed / 800) + statBar('GRIP', itemStats.grip / 2) + statBar('OXYGEN', itemStats.oxygen / 150) + statBar('BUOYANCY', itemStats.buoyancy) + '</div><div class="card-bottom"><span class="card-stat">' + format(itemStats.oxygen) + ' O₂ reserve</span>' + costButton('vehicle', item.id, item.cost, owned, selected) + '</div></article>';
      }).join('') + '</div>';
    } else if (tab === 'upgrades') {
      const icons = { engine: '⚙', thrust: '✣', suspension: '↕', tires: '◉', oxygen: 'O₂', ballast: '⇧' };
      content = '<p class="section-description">Fine-tune your <b>' + vehicle.name + '</b>. Upgrades stay with this vehicle. Each system has 12 levels.</p><div class="card-grid">' + AR.UPGRADES.map(item => {
        const level = data.upgrades[vehicle.id][item.id] || 0;
        const cost = AR.upgradeCost(item.id, level);
        const values = { engine: Math.round((stats.torque / vehicle.torque - 1) * 100) + '% extra torque', thrust: Math.round(stats.topSpeed * .36) + ' km/h drive limit', suspension: Math.round(stats.travel) + ' px suspension travel', tires: stats.grip.toFixed(2) + '× grip', oxygen: Math.round(stats.oxygen) + ' O₂ reserve', ballast: stats.cooldown.toFixed(1) + ' s recharge' };
        return '<article class="item-card"><span class="upgrade-icon">' + icons[item.id] + '</span><div class="card-kicker"><span>SYSTEM UPGRADE</span><span class="upgrade-level">LV ' + level + ' / 12</span></div><h3>' + item.name + '</h3><p>' + item.description + '</p><div class="upgrade-track" role="meter" aria-label="' + item.name + ' level" aria-valuenow="' + level + '" aria-valuemin="0" aria-valuemax="12">' + Array.from({ length: 12 }, (_, i) => '<i class="' + (i < level ? 'filled' : '') + '"></i>').join('') + '</div><div class="card-bottom"><span class="card-stat">' + values[item.id] + '</span><button class="small-button" data-action="upgrade" data-id="' + item.id + '"' + (level >= 12 || data.pearls < cost ? ' disabled' : '') + '>' + (level >= 12 ? 'MAX LEVEL' : '● ' + format(cost) + ' · Upgrade') + '</button></div></article>';
      }).join('') + '</div>';
    } else if (tab === 'stages') {
      content = '<p class="section-description">Follow the light, or leave it behind. Each ocean has new terrain, currents, and secrets.</p><div class="card-grid">' + AR.STAGES.map((item, index) => {
        const selected = stage.id === item.id;
        const owned = data.stages.includes(item.id);
        const best = Math.max(0, ...Object.entries(data.bests).filter(([key]) => key.startsWith(item.id + ':')).map(([, value]) => value));
        return '<article class="item-card stage-card' + (selected ? ' selected' : '') + '"><div class="stage-art" style="--stage-top:' + item.palette.top + ';--stage-bottom:' + item.palette.bottom + ';--stage-sand:' + item.palette.sand + '"><span class="stage-number">SECTOR 0' + (index + 1) + '</span></div><div class="card-kicker"><span>' + format(item.depth) + ' m BELOW THE SURFACE</span></div><h3>' + item.name + '</h3><p>' + item.description + '</p><div class="card-bottom"><span class="card-stat">BEST ' + format(best) + ' m</span>' + costButton('stage', item.id, item.cost, owned, selected).replace('Select ride', 'Explore here') + '</div></article>';
      }).join('') + '</div>';
    } else if (tab === 'achievements') {
      content = '<p class="section-description">Small victories from a big ocean. ' + data.achievements.length + ' of ' + AR.ACHIEVEMENTS.length + ' discoveries made. Rewards arrive after your dive.</p><div class="card-grid">' + AR.ACHIEVEMENTS.map(item => '<article class="item-card achievement-card' + (data.achievements.includes(item.id) ? ' earned' : '') + '"><span class="medal">' + (data.achievements.includes(item.id) ? '✦' : '◇') + '</span><div><h3>' + item.name + '</h3><p>' + item.description + '</p><small>' + (data.achievements.includes(item.id) ? 'DISCOVERED' : '● ' + format(item.reward) + ' PEARL REWARD') + '</small></div></article>').join('') + '</div>';
    } else {
      const tiles = [['TOTAL DIVES', format(data.totalRuns)], ['DISTANCE TRAVELLED', (data.totalDistance / 1000).toFixed(1) + ' km'], ['PEARLS COLLECTED', format(data.totals.pearls)], ['FLIPS COMPLETED', format(data.totals.flips)], ['TIME IN THE WATER', format(data.totals.airtime) + ' s airborne'], ['CHESTS OPENED', format(data.totals.chests)], ['GOLDEN PEARLS', format(data.totals.golden)], ['BALLAST BURSTS', format(data.totals.bursts)]];
      content = '<p class="section-description">Your story so far. Progress saves automatically on this device after each dive and purchase.</p>' + (!save.storageAvailable ? '<p class="storage-note">Saving is unavailable in this browser. Progress will last for this session only.</p>' : '') + '<div class="stat-grid">' + tiles.map(([label, value]) => '<div class="stat-tile"><span>' + label + '</span><b>' + value + '</b></div>').join('') + '</div><div class="stats-bottom">' + ['headlight', 'trail'].map(kind => '<label>' + (kind === 'headlight' ? 'Headlight colour' : 'Propeller trail') + '<select data-cosmetic="' + kind + '">' + AR.COSMETICS.filter(item => item.kind === kind).map(item => '<option value="' + item.id + '"' + (data.settings[kind] === item.id ? ' selected' : '') + (item.level > data.level ? ' disabled' : '') + '>' + item.name + (item.level > data.level ? ' · Level ' + item.level : '') + '</option>').join('') + '</select></label>').join('') + '<button class="danger-button" data-action="reset">Reset progress</button></div><div class="table-wrap"><table class="bests-table"><caption class="section-description">Best distance by stage and vehicle (m)</caption><thead><tr><th>Stage</th>' + AR.VEHICLES.map(item => '<th>' + item.name + '</th>').join('') + '</tr></thead><tbody>' + AR.STAGES.map(item => '<tr><th>' + item.name + '</th>' + AR.VEHICLES.map(ride => '<td>' + format(data.bests[item.id + ':' + ride.id] || 0) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    }
    $('garage-content').innerHTML = content;
    refreshWallet();
    drawThumbnails();
  }

  function drawThumbnails() {
    document.querySelectorAll('canvas[data-vehicle]').forEach(canvas => renderer.thumbnail(canvas, canvas.dataset.vehicle));
  }

  function startRun() {
    closeDialog();
    scene = createScene(save.data.selectedStage, save.data.selectedVehicle);
    run = { distance: 0, pearls: 0, flips: 0, maxFlips: 0, airtime: 0, chests: 0, golden: 0, bursts: 0, trickXP: 0, stageId: scene.stage.id, vehicleId: scene.vehicle.id, maxX: scene.rover.x, startX: scene.rover.x, milestone: 0, nextPickup: 350, wasGrounded: true, nextRampScan: 240, airDuration: 0, rotation: 0, frontFlips: 0, backFlips: 0, lastAngle: scene.rover.angle, finished: false };
    scene.pickups = [];
    generatePickups();
    setState(STATES.RUNNING);
    sound.unlock();
    updateHUD();
    toast('Ease off the gas over crests. Collect O₂ to keep exploring.');
  }

  function randomAt(index) {
    const value = Math.sin(index * 127.1 + scene.stage.seed * 311.7) * 43758.5453;
    return value - Math.floor(value);
  }

  function generatePickups() {
    while (run.nextPickup < run.maxX + 2900) {
      const x = run.nextPickup;
      const index = Math.round((x - 350) / 150);
      let type = 'pearl';
      if (index % 10 === 6) type = 'oxygen';
      else if (index % 23 === 16) type = 'chest';
      else if (randomAt(index + 77) > .96) type = 'gold';
      scene.pickups.push({ x, y: scene.terrain.height(x) - (type === 'chest' ? 16 : 44), type, collected: false });
      run.nextPickup += 150;
    }
    const rampEnd = run.maxX + 2900;
    // Generate each arc once, at a real ramp lip; no respawns when reversing.
    for (const ramp of scene.terrain.rampsBetween(run.nextRampScan, rampEnd)) {
      for (let j = 0; j < 6; j++) {
        const px = ramp.x - 32 + j * 32;
        const py = Math.min(ramp.y, scene.terrain.height(px)) - 53 - Math.sin(j / 5 * Math.PI) * 62;
        scene.pickups.push({ x: px, y: py, type: 'pearl', collected: false });
      }
    }
    run.nextRampScan = Math.max(run.nextRampScan, rampEnd + .001);
    scene.pickups = scene.pickups.filter(item => !item.collected && item.x > run.maxX - 1700);
  }

  function emit(x, y, count, color, type = 'spark') {
    for (let i = 0; i < count && scene.particles.length < MAX_PARTICLES; i++) {
      const life = .55 + Math.random() * .7;
      scene.particles.push({ x, y, vx: (Math.random() - .5) * 100, vy: -20 - Math.random() * 75, life, maxLife: life, size: 2 + Math.random() * 3, color, type });
    }
  }

  function floating(x, y, text, color = '#e0f6d9') {
    if (scene.texts.length > 18) scene.texts.shift();
    scene.texts.push({ x, y, text, life: 1.7, maxLife: 1.7, color });
  }

  function addPearls(value, x, y, label) {
    run.pearls += value;
    floating(x, y, label || '+' + value);
  }

  function segmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }

  function collectPickups() {
    const rover = scene.rover;
    const previous = rover.prev || rover;
    for (const item of scene.pickups) {
      if (item.collected || Math.abs(item.x - rover.x) > 120) continue;
      if (segmentDistance(item.x, item.y, previous.x, previous.y, rover.x, rover.y) > (item.type === 'chest' ? 57 : 48)) continue;
      item.collected = true;
      let color = '#ecf6d6';
      if (item.type === 'oxygen') {
        rover.oxygen = Math.min(rover.maxOxygen, rover.oxygen + rover.maxOxygen * .6);
        floating(item.x, item.y - 20, '+60% O₂', '#8af2df');
        color = '#8af2df';
      } else if (item.type === 'gold') {
        addPearls(100, item.x, item.y, '+100');
        run.golden++;
        color = '#ffc56d';
        toast('Golden pearl! +100', true);
      } else if (item.type === 'chest') {
        addPearls(75, item.x, item.y, '+75');
        run.chests++;
        color = '#ffc56d';
        toast('Sunken treasure! +75', true);
      } else addPearls(5, item.x, item.y, '+5');
      emit(item.x, item.y, item.type === 'pearl' ? 6 : 18, color);
      sound.play(item.type === 'pearl' ? 'pickup' : item.type);
    }
  }

  function detectTricks(dt) {
    const rover = scene.rover;
    let delta = rover.angle - run.lastAngle;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    run.lastAngle = rover.angle;
    const supported = rover.grounded || rover.bodyGrounded;
    if (!supported) {
      if (run.wasGrounded) { run.airDuration = 0; run.rotation = 0; run.frontFlips = 0; run.backFlips = 0; }
      run.airDuration += dt;
      run.airtime += dt;
      run.rotation += delta;
      const fronts = Math.floor(Math.max(0, run.rotation) / TAU);
      const backs = Math.floor(Math.max(0, -run.rotation) / TAU);
      if (fronts > run.frontFlips || backs > run.backFlips) {
        const back = backs > run.backFlips;
        const count = (fronts - run.frontFlips) + (backs - run.backFlips);
        run.frontFlips = Math.max(run.frontFlips, fronts);
        run.backFlips = Math.max(run.backFlips, backs);
        run.flips += Math.max(1, count);
        run.maxFlips = Math.max(run.maxFlips, run.backFlips);
        run.trickXP += 50 * Math.max(1, count);
        addPearls(100 * Math.max(1, count), rover.x, rover.y - 60);
        toast((back ? 'Backflip!' : 'Frontflip!') + ' +100', true);
        sound.play('trick');
      }
    } else if (!run.wasGrounded && run.airDuration > .8) {
      const bonus = Math.floor(run.airDuration * 8);
      addPearls(bonus, rover.x, rover.y - 60, 'AIR TIME +' + bonus);
      run.trickXP += Math.floor(run.airDuration * 4);
      if (run.airDuration > 2.5) toast(run.airDuration.toFixed(1) + ' s of weightlessness! +' + bonus, true);
      run.airDuration = 0;
    }
    run.wasGrounded = supported;
  }

  function input() {
    return {
      throttle: pointers.throttle.size > 0 || ['ArrowRight', 'KeyD', 'KeyW'].some(key => keys.has(key)),
      brake: pointers.brake.size > 0 || ['ArrowLeft', 'KeyA', 'KeyS'].some(key => keys.has(key)),
      burst: pendingBurst || pointers.burst.size > 0 || keys.has('Space') || keys.has('ArrowUp')
    };
  }

  function step(dt) {
    const controls = input();
    const rover = scene.rover;
    rover.step(controls, dt);
    pendingBurst = false;
    run.maxX = Math.max(run.maxX, rover.x);
    run.distance = (run.maxX - run.startX) * .1;
    generatePickups();
    collectPickups();
    detectTricks(dt);
    const milestone = Math.floor(run.distance / 100);
    if (milestone > run.milestone) {
      addPearls(25 * (milestone - run.milestone), rover.x, rover.y - 65);
      toast(format(milestone * 100) + ' m explored · +25 pearls');
      run.milestone = milestone;
    }
    if (rover.burstFired) {
      run.bursts++;
      emit(rover.x, rover.y + 18, 25, '#96ecdf', 'bubble');
      sound.play('burst');
    }
    if (rover.impact > 65) {
      scene.shake = Math.max(scene.shake, Math.min(12, rover.impact / 30));
      emit(rover.x, rover.y + 30, 16, scene.stage.palette.sand, 'sand');
      if (rover.impact > 180) sound.play('crash');
    }
    particleClock += dt;
    if (particleClock > .06) {
      particleClock = 0;
      if (controls.throttle) {
        const cos = Math.cos(rover.angle), sin = Math.sin(rover.angle);
        emit(rover.x - cos * 39, rover.y - sin * 39, 2, scene.trail === 'sparkles' ? '#ffd895' : scene.trail === 'plankton' ? '#9efbcc' : '#a5dddd', scene.trail === 'bubbles' ? 'bubble' : 'spark');
      }
      if (rover.grounded && Math.abs(rover.vx) > 75) for (const wheel of rover.wheels) if (wheel.grounded) emit(wheel.x, wheel.y + wheel.radius - 2, 1, scene.stage.palette.sand, 'sand');
    }
    scene.terrain.maintain(rover.x);
    // A refill collected on this same step can rescue the last breath.
    if (rover.crashed === 'Oxygen depleted' && rover.oxygen > 0) rover.crashed = '';
    if (rover.crashed) finishRun(rover.crashed);
    hudElapsed += dt;
    if (hudElapsed > .08) { updateHUD(); hudElapsed = 0; }
  }

  function updateEffects(dt) {
    scene.shake = Math.max(0, scene.shake - dt * 12);
    for (const p of scene.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-dt * 1.4);
      p.vy += (p.type === 'bubble' ? -25 : 35) * dt;
    }
    scene.particles = scene.particles.filter(p => p.life > 0);
    for (const item of scene.texts) { item.life -= dt; item.y -= dt * 25; }
    scene.texts = scene.texts.filter(item => item.life > 0);
  }

  function updateHUD() {
    if (!run) return;
    const rover = scene.rover;
    const fraction = clamp(rover.oxygen / rover.maxOxygen, 0, 1);
    const distanceHTML = format(run.distance) + '<small> m</small>';
    if ($('distance').innerHTML !== distanceHTML) $('distance').innerHTML = distanceHTML;
    writeText($('run-stage'), scene.stage.name.toUpperCase());
    writeText($('run-pearls'), format(run.pearls));
    writeText($('oxygen-value'), Math.ceil(fraction * 100) + '%');
    $('oxygen-fill').style.width = (fraction * 100) + '%';
    $('oxygen-panel').classList.toggle('low', fraction < .25);
    writeText($('oxygen-warning'), fraction < .25 ? 'OXYGEN LOW. FIND A TANK!' : 'BREATHE EASY. KEEP EXPLORING.');
    writeText($('depth'), format(Math.max(0, scene.stage.depth + (rover.y - 350) * .1)) + ' m');
    writeText($('speed'), Math.round(Math.hypot(rover.vx, rover.vy) * .36) + ' km/h');
    const ballast = rover.cooldown > 0 ? rover.cooldown.toFixed(1) + 's' : rover.oxygen <= 8 ? 'LOW O₂' : 'READY';
    writeText($('ballast-status'), ballast);
    writeText($('touch-ballast-label'), ballast === 'READY' ? 'BALLAST' : ballast);
  }

  function finishRun(reason) {
    if (!run || run.finished) return;
    run.finished = true;
    run.distance = Math.floor(run.distance);
    const result = save.finishRun(run);
    setState(STATES.GAMEOVER);
    $('result-reason').textContent = reason.toUpperCase();
    $('result-distance').innerHTML = format(run.distance) + ' <small>m</small>';
    $('result-location').textContent = scene.stage.name + ' · ' + scene.vehicle.name;
    $('new-best').hidden = !result.isBest;
    $('result-pearls').textContent = '+' + format(run.pearls);
    $('result-xp').textContent = '+' + format(result.xpGained) + ' XP';
    $('result-air').textContent = run.airtime.toFixed(1) + ' s';
    const achievementBonus = (result.newAchievements || []).reduce((sum, item) => sum + item.reward, 0);
    const rewards = [];
    if (result.levelUps) rewards.push('Level ' + save.data.level + ' reached · +' + result.levelBonus + ' pearls');
    if (result.newAchievements.length) rewards.push(result.newAchievements.length + ' achievement' + (result.newAchievements.length > 1 ? 's' : '') + ' · +' + achievementBonus + ' pearls');
    if (result.newCosmetics && result.newCosmetics.length) rewards.push('Unlocked: ' + result.newCosmetics.map(item => item.name).join(', '));
    $('result-rewards').textContent = rewards.join(' / ');
    sound.play(result.levelUps ? 'level' : reason === 'Hull crushed' ? 'crash' : 'click');
    if (!save.storageAvailable) toast('Saving unavailable. Your progress is kept for this session.');
  }

  function clearInput() {
    keys.clear();
    pendingBurst = false;
    versus.clearKeys();
    Object.values(pointers).forEach(set => set.clear());
    document.querySelectorAll('.pedal').forEach(button => button.classList.remove('active'));
  }

  function pause() { if (versus.active) { versus.pause(); return; } if (state === STATES.RUNNING) setState(STATES.PAUSED); }
  function resume() { if (state === STATES.PAUSED) { sound.unlock(); setState(STATES.RUNNING); } }
  function toggleMute() { save.data.settings.muted = !save.data.settings.muted; sound.setMuted(save.data.settings.muted); save.save(); refreshWallet(); }

  function openDialog(content) {
    if (state === STATES.RUNNING) pause();
    dialogFocus = document.activeElement;
    $('dialog-content').innerHTML = content;
    $('dialog-overlay').hidden = false;
    $('screens').setAttribute('aria-hidden', 'true');
    $('dialog-close').focus();
  }
  function closeDialog() {
    if ($('dialog-overlay').hidden) return;
    $('dialog-overlay').hidden = true;
    $('screens').removeAttribute('aria-hidden');
    if (dialogFocus && document.contains(dialogFocus)) dialogFocus.focus({ preventScroll: true });
  }
  function howToPlay() {
    openDialog('<div class="eyebrow">YOUR FIRST EXPEDITION</div><h2 id="dialog-heading">Get your sea legs.</h2><label class="graphics-setting">Graphics<select id="graphics-setting"><option value="crisp">Crisp (default)</option><option value="performance">Performance</option></select></label><p>Roll over the seabed, collect pearls, and keep your oxygen topped up. Distance is your score.</p><p id="help-online" class="help-tip"><b>Play on two phones:</b> Create a room and share its four-character code for your friend to join. The host picks the stage.</p><div class="control-list"><div class="control-row"><span>Throttle / pitch backward in air</span><kbd>→ / D / W</kbd></div><div class="control-row"><span>Brake, reverse / pitch forward</span><kbd>← / A / S</kbd></div><div class="control-row"><span>Ballast burst · upward thrust</span><kbd>SPACE / ↑</kbd></div><div class="control-row"><span>Pause / mute</span><kbd>P / ESC &nbsp; · &nbsp; M</kbd></div></div><div class="help-pickups"><span><b>● Pearls</b> · 5 each<br><b>● Golden pearls</b> · 100</span><span><b>O₂ tanks</b> · refill 60%<br><b>Treasure chests</b> · 75</span></div><p class="help-tip">On a phone, hold the big pedals with both thumbs. Tap ⇧ to rise. Ballast uses 8 O₂ from your reserve, so save a breath for the next tank.</p><p>Ease off the gas over crests. Tap brake in the air to bring the nose down. Finish flips for +100 pearls. Balance your rover before landing: a hard impact on the pilot’s dome ends the dive. Upgrades and new worlds await in the garage.</p>');
    $('graphics-setting').value = save.data.settings.graphics;
    $('graphics-setting').onchange = e => { save.data.settings.graphics = e.target.value; save.save(); renderer.setGraphics(e.target.value); };
  }

  $('enter-garage').addEventListener('click', openGarage);
  $('brand').addEventListener('click', () => { if (state === STATES.GARAGE) { scene = createScene('reef', 'rover'); setState(STATES.TITLE); } });
  $('start-run').addEventListener('click', startRun);
  $('retry').addEventListener('click', startRun);
  $('back-garage').addEventListener('click', openGarage);
  $('pause-button').addEventListener('click', pause);
  $('resume-run').addEventListener('click', resume);
  $('end-run').addEventListener('click', () => finishRun('Dive complete'));
  $('mute-button').addEventListener('click', toggleMute);
  $('help-button').addEventListener('click', howToPlay);
  $('title-help').addEventListener('click', howToPlay);
  $('dialog-close').addEventListener('click', closeDialog);
  $('dialog-overlay').addEventListener('click', event => { if (event.target === $('dialog-overlay')) closeDialog(); });
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('click', () => { tab = button.dataset.tab; renderGarage(); $('garage-content').scrollTop = 0; });
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.code)) return;
      event.preventDefault();
      const tabs = Array.from(document.querySelectorAll('[data-tab]'));
      const index = tabs.indexOf(button);
      const next = event.code === 'Home' ? 0 : event.code === 'End' ? tabs.length - 1 : (index + (event.code === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click(); tabs[next].focus();
    });
  });
  $('garage-content').addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'reset') {
      openDialog('<div class="eyebrow">A FRESH START</div><h2 id="dialog-heading">Reset your progress?</h2><p>This erases pearls, upgrades, unlocked worlds, records, and achievements from this browser.</p><div class="confirm-actions"><button class="button secondary" id="cancel-reset">KEEP PROGRESS</button><button class="button primary" id="confirm-reset">RESET EVERYTHING</button></div>');
      $('cancel-reset').addEventListener('click', closeDialog);
      $('confirm-reset').addEventListener('click', () => { save.reset(); renderer.setGraphics(save.data.settings.graphics); sound.setMuted(save.data.settings.muted); closeDialog(); scene = createScene('reef', 'rover'); scene.state = state; renderGarage(); toast('A fresh ocean awaits. Progress reset.'); });
      return;
    }
    let changed = false;
    if (action === 'vehicle') {
      changed = save.data.vehicles.includes(id) || save.buyVehicle(id);
      if (changed) save.data.selectedVehicle = id;
    } else if (action === 'stage') {
      changed = save.data.stages.includes(id) || save.buyStage(id);
      if (changed) save.data.selectedStage = id;
    } else if (action === 'upgrade') changed = save.buyUpgrade(id);
    if (changed) {
      save.save();
      scene = createScene(save.data.selectedStage, save.data.selectedVehicle);
      scene.state = state;
      sound.play('pickup');
      renderGarage();
      if (action === 'upgrade') toast(AR.UPGRADES.find(item => item.id === id).name + ' upgraded to level ' + save.data.upgrades[save.data.selectedVehicle][id]);
    }
  });
  $('garage-content').addEventListener('change', event => {
    const kind = event.target.dataset.cosmetic;
    if (!kind) return;
    const item = AR.COSMETICS.find(entry => entry.kind === kind && entry.id === event.target.value && entry.level <= save.data.level);
    if (item) { save.data.settings[kind] = item.id; save.save(); toast(item.name + ' equipped'); }
  });

  for (const [id, control] of [['pedal-gas', 'throttle'], ['pedal-brake', 'brake'], ['pedal-ballast', 'burst']]) {
    const button = $(id);
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      if (state !== STATES.RUNNING) return;
      sound.unlock();
      button.setPointerCapture(event.pointerId);
      pointers[control].add(event.pointerId);
      if (control === 'burst') pendingBurst = true;
      button.classList.add('active');
    });
    const release = event => { pointers[control].delete(event.pointerId); if (!pointers[control].size) button.classList.remove('active'); };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', event => event.preventDefault());
  }
  document.addEventListener('pointerdown', () => sound.unlock(), { passive: true });
  document.addEventListener('click', event => { if (event.target.closest('button') && !event.target.closest('.pedal')) sound.play('click'); });
  window.addEventListener('keydown', event => {
    if (versus.active) { versus.keydown(event); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(event.code) && !event.target.matches('select,input,textarea')) event.preventDefault();
    if (!$('dialog-overlay').hidden) {
      if (event.code === 'Escape') { event.preventDefault(); closeDialog(); }
      if (event.code === 'Tab') {
        const nodes = Array.from($('dialog-overlay').querySelectorAll('button, select, input, textarea, [tabindex="0"]')).filter(node => !node.disabled);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (event.target.matches('select,input,textarea')) return;
    sound.unlock();
    if (event.code === 'KeyM' && !event.repeat) { toggleMute(); return; }
    if (['KeyP', 'Escape'].includes(event.code) && !event.repeat) { event.preventDefault(); if (state === STATES.RUNNING) pause(); else if (state === STATES.PAUSED) resume(); return; }
    if (state !== STATES.RUNNING) return;
    if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) { event.preventDefault(); keys.add(event.code); if (['Space', 'ArrowUp'].includes(event.code) && !event.repeat) pendingBurst = true; }
  });
  window.addEventListener('keyup', event => { keys.delete(event.code); versus.keys.delete(event.code); if (online.active) online.keyup(event); });
  window.addEventListener('blur', () => { clearInput(); pause(); });
  document.addEventListener('visibilitychange', () => {
    clearInput();
    if (document.hidden) { pause(); sound.suspend(); cancelAnimationFrame(frameRequest); frameRequest = 0; }
    else { accumulator = 0; previousFrame = 0; if (!frameRequest) frameRequest = requestAnimationFrame(frame); }
  });
  window.addEventListener('pagehide', () => { clearInput(); sound.suspend(); });
  let resizePending = false;
  window.addEventListener('resize', () => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => { resizePending = false; renderer.resize(); if (state === STATES.GARAGE) drawThumbnails(); });
  });

  function frame(timestamp) {
    frameRequest = 0;
    if (document.hidden) return;
    const dt = previousFrame ? Math.min(.05, Math.max(0, (timestamp - previousFrame) / 1000)) : 0;
    previousFrame = timestamp;
    if (versus.active) {
      versus.tick(dt);
      versus.draw(dt, scene);
      frameRequest = requestAnimationFrame(frame);
      return;
    }
    if (state === STATES.RUNNING) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= STEP && steps < 7 && state === STATES.RUNNING) { step(STEP); accumulator = Math.max(0, accumulator - STEP); steps++; }
      if (steps === 7) accumulator %= STEP;
      updateEffects(dt);
      sound.update({ running: state === STATES.RUNNING, throttle: state === STATES.RUNNING && input().throttle, speed: Math.abs(scene.rover.vx), oxygenFraction: scene.rover.oxygen / scene.rover.maxOxygen }, dt);
    }
    if (state !== STATES.PAUSED && state !== STATES.GAMEOVER) scene.time += dt;
    const cosmetic = AR.COSMETICS.find(item => item.kind === 'headlight' && item.id === save.data.settings.headlight);
    scene.headlight = cosmetic ? cosmetic.color : '#90fff1';
    scene.trail = save.data.settings.trail;
    renderer.draw(scene, state === STATES.PAUSED ? 0 : dt, state === STATES.RUNNING ? clamp(accumulator / STEP, 0, 1) : 1);
    frameRequest = requestAnimationFrame(frame);
  }

  AR.initSuggestions({ openDialog, context: () => online.active ? 'online-' + online.role : versus.active ? 'local-versus' : state.toLowerCase() });
  scene = createScene('reef', 'rover');
  document.body.dataset.state = state;
  renderer.resize();
  sound.setMuted(save.data.settings.muted);
  refreshWallet();
  frameRequest = requestAnimationFrame(frame);
  const joinCode = new URLSearchParams(window.location.search).get('join');
  if (joinCode && /^[A-Za-z2-9]{4}$/.test(joinCode)) online.open(joinCode.toUpperCase());
  // Read-only inspection hook for browser smoke tests and troubleshooting.
  AR.inspect = () => versus.active ? { ...versus.inspect(), ...(online.active ? { state: 'ONLINE_' + (online.state === 'MATCH' ? versus.phase : online.state), online: online.inspect() } : {}) } : ({ state, angle: scene.rover.angle, omega: scene.rover.omega, vx: scene.rover.vx, vy: scene.rover.vy, grounded: scene.rover.grounded, bodyGrounded: scene.rover.bodyGrounded, sleeping: !!scene.rover.sleeping, terrainY: scene.terrain ? scene.terrain.height(scene.rover.x) : null, stage: scene.stage.id, vehicle: scene.vehicle.id, distance: run ? run.distance : 0, flips: run ? run.flips : 0, airtime: run ? run.airtime : 0, oxygen: scene.rover.oxygen, x: scene.rover.x, y: scene.rover.y, particles: scene.particles.length, pickups: scene.pickups.length, pearls: save.data.pearls, totalRuns: save.data.totalRuns });
})();
