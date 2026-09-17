(function () {
  'use strict';
  const AR = window.AR, $ = id => document.getElementById(id);
  const options = (list, value) => list.map(([id, text]) => '<option value="' + id + '"' + (id === value ? ' selected' : '') + '>' + text + '</option>').join('');
  const button = (id, label, primary = false) => '<button id="' + id + '" class="button ' + (primary ? 'primary' : 'secondary') + '">' + label + '</button>';
  class OnlineUI {
    constructor(net) {
      this.n = net;
      const root = document.createElement('div'); root.id = 'online-root'; root.hidden = true;
      root.innerHTML = '<section id="online-screen" class="online-screen" aria-label="Two phones"><div id="online-content"></div></section><div id="online-quality" role="status" hidden></div><div id="online-rotate" hidden>↻ Rotate for the best view</div><div id="online-pedals" hidden>' + [['brake', '◀', 'BRAKE'], ['burst', '⇧', 'BALLAST'], ['item', '?', 'ITEM'], ['throttle', '▶', 'GAS']].map(([key, icon, label]) => '<button id="online-' + key + '" class="online-pedal ' + key + '" aria-label="' + (key === 'brake' || key === 'throttle' ? 'Hold ' : 'Use ') + label.toLowerCase() + '"><b>' + icon + '</b><span>' + label + '</span></button>').join('') + '</div>';
      document.body.appendChild(root);
      root.querySelectorAll('.online-pedal').forEach(b => {
        const key = b.id.slice(7), pointers = new Set();
        b.addEventListener('pointerdown', e => { e.preventDefault(); net.sound.unlock(); b.setPointerCapture(e.pointerId); pointers.add(e.pointerId); net.control(key, true, e.pointerId); b.classList.add('active'); });
        const release = e => { pointers.delete(e.pointerId); net.control(key, false, e.pointerId); if (!pointers.size) b.classList.remove('active'); };
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => b.addEventListener(type, release));
        b.addEventListener('contextmenu', e => e.preventDefault());
      });
    }
    header(kicker, title) { return '<div class="online-heading"><div><div class="eyebrow">' + kicker + '</div><h2>' + title + '</h2></div>' + button('online-back', '← Title') + '</div>'; }
    share() { return '<aside class="online-share"><span class="tiny-label">YOUR ROOM CODE</span><strong id="online-code"></strong><canvas id="online-qr" role="img" aria-label="Scan to join this room"></canvas>' + button('online-copy', 'Copy link') + '<small>Scan with the other phone’s camera,<br>or enter this code.</small><p id="online-copy-status" role="status"></p></aside>'; }
    render() {
      const n = this.n, v = n.v, s = n.state;
      let html = '';
      if (s === 'ENTRY') html = this.header('TWO DEVICES · ONE OCEAN', 'Bring a rival.') + '<p class="online-intro">Your own screen. Your own ride.<br>Race a friend on another phone or laptop.</p><div class="online-entry-actions">' + button('online-create', 'Create room ↗', true) + button('online-join-screen', 'Join a room') + '</div><p class="online-note">Keep both screens open. Landscape feels best.<br>Internet required · Solo and local Versus work offline.</p>';
      if (s === 'JOIN') html = this.header('MEET BELOW THE SURFACE', 'Join your friend.') + '<label class="online-code-label" for="online-room-input">ENTER THEIR FOUR-CHARACTER CODE</label><input id="online-room-input" aria-describedby="online-error" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="KJ7M" inputmode="text"><p id="online-error" class="online-error" role="status"></p>' + button('online-join', n.code ? 'TAP TO JOIN & DIVE ↗' : 'Join room', true) + '<p class="online-note">The host’s room code is beside their QR code.<br>Your first tap switches on game sound.</p>';
      if (s === 'CONNECTING') html = this.header('FINDING YOUR RIVAL', 'Connecting…') + '<div class="online-wait" aria-hidden="true"><i></i><i></i><i></i></div><p class="online-intro">Opening a route between your devices.</p><p class="online-note">This can take up to 15 seconds.</p>';
      if (s === 'WAITING') html = this.header('YOUR OCEAN IS OPEN', 'Invite a rival.') + '<div class="online-waiting-grid">' + this.share() + '<div><div class="online-wait" aria-hidden="true"><i></i><i></i><i></i></div><h3>Waiting for your friend…</h3><p>Keep this screen open while they scan.<br>You’ll choose your rides together.</p><p class="online-note">Phone ↔ phone or phone ↔ laptop.<br>Both devices need an internet connection.</p></div></div>';
      if (s === 'LOBBY') {
        const c = v.config, own = AR.VEHICLES.find(x => x.id === c.vehicles[n.index]), other = AR.VEHICLES.find(x => x.id === c.vehicles[1 - n.index]);
        html = this.header(n.role === 'host' ? 'YOU HOST · PLAYER 1' : 'YOU JOINED · PLAYER 2', 'Ready for a rivalry?') + '<div class="online-lobby-grid">' + (n.role === 'host' ? this.share() : '') + '<div class="online-loadout"><div class="online-rides"><article class="online-own"><span class="tiny-label">YOUR RIDE · P' + (n.index + 1) + '</span><canvas id="online-vehicle-art"></canvas><label for="online-vehicle">Vehicle</label><select id="online-vehicle">' + options(AR.VEHICLES.map(x => [x.id, x.name]), own.id) + '</select></article><article class="online-rival"><span class="tiny-label">YOUR RIVAL · P' + (2 - n.index) + '</span><h3>' + other.name + '</h3><p id="online-rival-ready"></p><p>All five rides.<br>Equal level-5 upgrades.</p></article></div><div class="online-options">' + [['stage', 'Ocean', AR.STAGES.map(x => [x.id, x.name]), c.stage], ['mode', 'Mode', [['race', 'Race'], ['survival', 'Last Sub Standing'], ['pearl', 'Pearl Rush · 90 s'], ['arena', 'Bubble Battle · 3 hits'], ['treasure', 'Treasure Tug']], c.mode], ['target', 'Distance', [[500, '500 m'], [1000, '1,000 m'], [2000, '2,000 m']], c.target], ['carryTarget', 'Carry to win', [[20, '20 seconds'], [30, '30 seconds'], [45, '45 seconds']], c.carryTarget || 30], ['bestOf', 'Rounds', [[1, 'One round'], [3, 'Best of 3'], [5, 'Best of 5']], c.bestOf]].map(([key, label, list, value]) => '<label>' + label + '<select id="online-option-' + key + '"' + (n.role !== 'host' || (key === 'target' && c.mode !== 'race') || (key === 'carryTarget' && c.mode !== 'treasure') ? ' disabled' : '') + '>' + options(list, value) + '</select></label>').join('') + '</div><p class="online-note">' + (c.mode === 'treasure' ? 'Carry the chest to score. Hits drop it; a 300 m gap returns it between you. ' : '') + (AR.STAGES.find(s => s.id === c.stage).how || '') + ' ' + (n.role === 'host' ? 'Both divers must be ready.' : 'The host chooses the match settings.') + '</p><div class="online-ready-actions">' + button('online-ready', 'READY', true) + (n.role === 'host' ? button('online-start', c.mode === 'arena' ? 'START BATTLE ↗' : c.mode === 'treasure' ? 'START TREASURE TUG ↗' : 'START RACE ↗') : '<span>Waiting for the host to start.</span>') + '</div></div></div>';
      }
      if (s === 'RECONNECTING') html = '<div class="online-reconnecting"><div class="eyebrow">BOTH ROVERS PAUSED</div><h2>Reconnecting…</h2><div class="online-wait" aria-hidden="true"><i></i><i></i><i></i></div><p id="online-reconnect-time"></p><p>Keep this screen open while we restore the race.</p>' + button('online-back', 'Leave match') + '</div>';
      if (s === 'ERROR') html = this.header(n.abandoned ? 'MATCH ABANDONED' : 'NO ROUTE THROUGH', n.abandoned ? 'Connection lost.' : 'Couldn’t connect.') + '<p id="online-error" class="online-error" role="alert"></p><div class="online-entry-actions">' + button('online-retry', 'Try again', true) + button('online-new', 'Create or join another room') + '</div>';
      $('online-content').innerHTML = html;
      const bind = (id, fn) => { if ($(id)) $(id).onclick = fn; };
      bind('online-back', () => n.close()); bind('online-create', () => n.create()); bind('online-join-screen', () => { n.state = 'JOIN'; n.code = ''; this.render(); $('online-room-input').focus(); });
      bind('online-join', () => n.join($('online-room-input').value)); bind('online-ready', () => n.ready()); bind('online-start', () => n.start()); bind('online-retry', () => n.retry()); bind('online-new', () => { n.transport?.close(); n.open(); });
      if ($('online-room-input')) {
        $('online-room-input').value = n.code || '';
        $('online-room-input').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); if (e.target.value.length === 4) n.join(e.target.value); };
        $('online-room-input').onkeydown = e => { if (e.key === 'Enter') n.join(e.target.value); };
      }
      if ($('online-qr')) {
        $('online-code').textContent = n.code;
        const link = 'https://konstantinpilz.github.io/abyss-racer/?join=' + n.code;
        AR.QR.draw($('online-qr'), link);
        bind('online-copy', async () => {
          try { await navigator.clipboard.writeText(link); $('online-copy-status').textContent = 'Link copied!'; }
          catch (_) { const status = $('online-copy-status'); if (status) { status.textContent = link; status.classList.add('selectable'); } }
        });
      }
      if ($('online-vehicle')) {
        const stats = AR.getStats(v.config.vehicles[n.index], Object.fromEntries(AR.UPGRADES.map(u => [u.id, 5]))); if (n.index) stats.color = '#56dce9'; v.renderer.thumbnail($('online-vehicle-art'), stats);
        $('online-vehicle').onchange = e => n.configure('vehicle', e.target.value);
        ['stage', 'mode', 'target', 'bestOf', 'carryTarget'].forEach(key => { $('online-option-' + key).onchange = e => n.configure(key, ['target', 'bestOf', 'carryTarget'].includes(key) ? Number(e.target.value) : e.target.value); });
      }
      this.show(); this.status();
    }
    show() {
      const n = this.n, v = n.v;
      $('online-root').hidden = !n.active;
      if (!n.active) { delete document.body.dataset.online; return; }
      document.body.dataset.online = String(n.index || 0); document.body.dataset.versus = v.phase;
      $('online-screen').dataset.view = n.state;
      $('versus-root').hidden = false; $('versus-setup').hidden = true;
      const match = n.state === 'MATCH', world = match || (n.state === 'RECONNECTING' && v.players.length > 0);
      $('online-screen').hidden = match; $('online-quality').hidden = !['LOBBY', 'MATCH'].includes(n.state);
      $('online-pedals').hidden = !match || !['RUNNING', 'COUNTDOWN'].includes(v.phase); $('online-rotate').hidden = !match;
      $('versus-huds').hidden = !world; $('versus-overlay').hidden = !match || !['COUNTDOWN', 'ROUND_RESULT', 'MATCH_RESULT', 'PAUSED'].includes(v.phase);
      if (match && v.phase === 'COUNTDOWN') this.countKey = null;
      if (match && v.phase === 'PAUSED') {
        $('versus-overlay-content').innerHTML = '<div class="eyebrow">BOTH ROVERS PAUSED</div><h2>Holding depth.</h2><p>Keep both screens open to stay connected.</p><div class="v-result-actions">' + button('online-resume', 'RESUME', true) + button('online-leave', 'Leave match') + '</div>';
        $('online-resume').onclick = () => n.resume(); $('online-leave').onclick = () => n.close();
      }
      if (match && v.phase === 'MATCH_RESULT') {
        for (const id of ['versus-rematch', 'versus-change']) if ($(id)) { $(id).hidden = n.role !== 'host'; $(id).onclick = () => n.returnLobby(); }
        if ($('versus-rematch')) $('versus-rematch').textContent = 'SET UP REMATCH ↻';
      }
      this.status();
    }
    status() {
      const n = this.n, v = n.v;
      if ($('online-error')) $('online-error').textContent = n.error || '';
      if ($('online-quality')) $('online-quality').textContent = (n.role === 'host' ? 'P1 · HOST' : 'P2 · GUEST') + '　● ' + (n.rtt === null ? 'Measuring ping…' : n.rtt + ' ms' + (n.rtt > 250 ? ' · Slow connection' : ''));
      if ($('online-ready')) { $('online-ready').textContent = v.ready[n.index] ? '✓ READY · tap to undo' : 'READY'; $('online-ready').disabled = !n.protocolReady; }
      if ($('online-rival-ready')) $('online-rival-ready').textContent = v.ready[1 - n.index] ? '✓ Ready to dive' : 'Choosing their ride…';
      if ($('online-start')) $('online-start').disabled = !v.ready.every(Boolean) || !n.protocolReady;
      if ($('online-reconnect-time')) $('online-reconnect-time').textContent = 'Trying for ' + Math.max(0, Math.ceil((n.watch.deadline - n.now()) / 1000)) + ' more seconds…';
      if (n.state === 'MATCH' && n.role === 'guest' && v.phase === 'COUNTDOWN') {
        const count = v.phaseTime > 1 ? Math.ceil(v.phaseTime) - 1 : 'GO';
        const key = v.round + ':' + count;
        if (this.countKey !== key) { this.countKey = key; $('versus-overlay-content').innerHTML = '<div class="eyebrow">' + v.stage.name.toUpperCase() + '</div><h2>Round ' + v.round + ' — Dive!</h2><div class="v-countdown">' + count + '</div><p>P1 ' + v.scores[0] + '　—　' + v.scores[1] + ' P2</p>'; }
      }
      const p = v.players[n.index];
      if (p && n.state === 'MATCH') {
        for (const key of ['brake', 'throttle']) {
          const pedal = $('online-' + key), reversed = p.effects.riptide > 0;
          pedal.classList.toggle('reversed', reversed); pedal.querySelector('b').textContent = reversed ? '⇄' : key === 'brake' ? '◀' : '▶';
          pedal.querySelector('span').textContent = key === 'brake' ? 'BRAKE' : 'GAS';
          pedal.setAttribute('aria-label', reversed ? 'Controls reversed: hold ' + (key === 'brake' ? 'gas' : 'brake') : 'Hold ' + (key === 'brake' ? 'brake' : 'gas'));
        }
        const arena = v.matchConfig.mode === 'arena';
        $('online-item').setAttribute('aria-label', arena ? 'Fire bubble cannon' : 'Use item');
        $('online-burst').setAttribute('aria-label', arena ? 'Jump' : 'Use ballast');
        $('online-item').querySelector('b').textContent = arena ? '⊙' : p.item ? AR.VERSUS_ITEMS[p.item].icon : '?';
        $('online-item').querySelector('span').textContent = arena ? (p.effects.fireCooldown > 0 ? p.effects.fireCooldown.toFixed(1) + ' s' : 'FIRE') : p.item ? AR.VERSUS_ITEMS[p.item].name + (p.charges > 1 ? ' ×' + p.charges : '') : 'ITEM';
        $('online-burst').querySelector('span').textContent = arena ? (p.effects.jumpCooldown > 0 ? p.effects.jumpCooldown.toFixed(1) + ' s' : 'JUMP') : p.rover.cooldown > 0 ? p.rover.cooldown.toFixed(1) + ' s' : 'BALLAST';
      }
    }
  }
  AR.OnlineUI = OnlineUI;
})();
