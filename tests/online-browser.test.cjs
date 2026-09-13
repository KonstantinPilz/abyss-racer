'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('/home/ubuntu/projects/mcp-chromium-arm64/node_modules/puppeteer-core');
const executablePath = process.env.ABYSS_CHROME || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
const delay = ms => new Promise(r => setTimeout(r, ms));
const pass = s => console.log('PASS ' + s);
let browser, server;
const results = { broker: 'not attempted', screenshots: [], issues: [] };
(async () => {
 server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname; const file = path.join(__dirname, '../docs', name === '/' ? 'index.html' : path.basename(name));
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(fs.readFileSync(file));
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
 browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], timeout: 15000 });
 const contexts = await Promise.all([browser.createBrowserContext(), browser.createBrowserContext()]);
 const host = await contexts[0].newPage(), guest = await contexts[1].newPage();
 for (const [i, p] of [host, guest].entries()) {
  p.on('pageerror', e => results.issues.push({ page: i, type: 'pageerror', message: e.message }));
  p.on('console', m => { if (['error', 'warn'].includes(m.type())) results.issues.push({ page: i, type: m.type(), message: m.text() }); });
  p.on('requestfailed', r => { if (r.url().startsWith('https:')) console.log('NETWORK ' + r.url() + ' ' + r.failure()?.errorText); });
  await p.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto(base + '/?debug=1');
 }
 const snap = async (p, name) => { const filename = '/tmp/abyss-phones-' + name + '.png'; await p.screenshot({ path: filename }); results.screenshots.push(filename); };
 const inspect = p => p.evaluate(() => AR.inspect());
 const waitState = (p, state, timeout = 18000) => p.waitForFunction(state => AR.inspect().state === state, { timeout }, state);
 assert.equal(await host.$('script[src*="peerjs"]'), null); assert.equal(await host.$eval('#title-suggestions', e => e.hidden), false);
 await guest.goto(base + '/?debug=1&join=KJ7M');
 assert.equal(await guest.$eval('#online-room-input', e => e.value), 'KJ7M');
 assert.equal(await guest.$('script[src*="peerjs"]'), null);
 assert.equal((await inspect(guest)).state, 'ONLINE_JOIN');
 await guest.click('#online-back');
 await guest.click('#enter-online'); await guest.click('#online-join-screen'); await snap(guest, 'guest-join');
 assert.equal(await guest.$eval('#online-room-input', e => e.maxLength), 4);
 pass('No PeerJS download outside online connect; unconfigured Suggestions hidden; guest join screen');
 await host.click('#enter-online'); await host.click('#online-create');
 try { await waitState(host, 'ONLINE_WAITING'); }
 catch (error) {
  results.broker = 'unreachable'; results.brokerError = (await inspect(host)).online;
  console.log('BROKER UNREACHABLE ' + JSON.stringify(results.brokerError));
  // Render the share UI for visual QA even if this host cannot reach the broker.
  await host.evaluate(() => { const n = AR.debug.online; n.transport?.close(); n.code = 'KJ7M'; n.role = 'host'; n.index = 0; n.state = 'WAITING'; n.ui.render(); });
  await snap(host, 'host-qr');
  return;
 }
 const code = (await inspect(host)).online.code; assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
 await snap(host, 'host-qr');
 await guest.type('#online-room-input', code.toLowerCase(), { delay: 40 });
 await Promise.all([waitState(host, 'ONLINE_LOBBY'), waitState(guest, 'ONLINE_LOBBY')]);
 results.broker = 'connected';
 await host.select('#online-option-bestOf', '1'); await host.select('#online-option-target', '500');
 await guest.select('#online-vehicle', 'crab');
 await guest.waitForFunction(() => AR.debug.online.v.config.vehicles[1] === 'crab');
 assert.equal(await guest.$eval('#online-option-stage', e => e.disabled), true);
 await host.click('#online-ready'); await guest.click('#online-ready'); await host.waitForFunction(() => !document.getElementById('online-start').disabled);
 await snap(host, 'host-lobby-qr'); await host.click('#online-start');
 await Promise.all([waitState(host, 'ONLINE_COUNTDOWN'), waitState(guest, 'ONLINE_COUNTDOWN')]);
 await guest.keyboard.press('KeyP'); await waitState(guest, 'ONLINE_PAUSED');
 await guest.click('#online-resume'); await waitState(guest, 'ONLINE_COUNTDOWN');
 assert(await guest.$('#versus-overlay-content .v-countdown'));
 await Promise.all([waitState(host, 'ONLINE_RUNNING', 15000), waitState(guest, 'ONLINE_RUNNING', 15000)]);
 // Catch any accidental guest simulation, including hidden calls via rendering.
 await guest.evaluate(() => { AR.debug.online.v.step = () => { throw new Error('Guest physics called'); }; AR.Rover.prototype.step = () => { throw new Error('Guest Rover.step called'); }; });
 const starts = (await inspect(host)).players.map(p => p.x);
 const rateStart = await host.evaluate(() => ({ t: performance.now(), snapshots: AR.debug.online.metrics.snapshots }));
 const inputStart = await guest.evaluate(() => ({ t: performance.now(), packets: AR.debug.online.source.seq }));
 await host.keyboard.down('KeyD'); await guest.keyboard.down('ArrowRight'); await delay(2600);
 await host.keyboard.up('KeyD'); await guest.keyboard.up('ArrowRight');
 const moving = await inspect(host); assert(moving.players.every((p, i) => p.x > starts[i] + 40), JSON.stringify(moving));
 results.rates = await host.evaluate(start => ({ snapshotsHz: (AR.debug.online.metrics.snapshots - start.snapshots) * 1000 / (performance.now() - start.t) }), rateStart);
 results.rates.guestInputsHzIncludingEdges = await guest.evaluate(start => (AR.debug.online.source.seq - start.packets) * 1000 / (performance.now() - start.t), inputStart);
 assert.equal((await inspect(guest)).state, 'ONLINE_RUNNING');
 await snap(host, 'host-landscape'); await snap(guest, 'guest-landscape');
 await guest.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await delay(300); await snap(guest, 'guest-portrait');
 assert.equal(await guest.$eval('#online-rotate', e => getComputedStyle(e).display), 'block');
 assert.equal(await guest.$eval('#v-hud-0', e => getComputedStyle(e).display), 'none'); assert.equal(await guest.$eval('#v-hud-1', e => e.getBoundingClientRect().height), 844);
 // Real multi-touch hold / cancel path, both independent pedals.
 const pedals = await guest.evaluate(() => ['online-throttle', 'online-burst'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
 const cdp = await guest.createCDPSession(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pedals.map((p, i) => ({ ...p, id: i + 1 })) }); await delay(160); assert.equal((await inspect(guest)).online.input.throttle, true); await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await delay(100); assert.equal((await inspect(guest)).online.input.throttle, false);
 // Exercise a natural delivery, with real terrain and no crate or debug item grant.
 await guest.setViewport({ width: 393, height: 428, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
 const delivery = await host.evaluate(() => {
  const n = AR.debug.online, v = n.v;
  v.players.forEach((p, i) => {
   AR.debug.placePlayer(i, { x: p.startX + (i ? 100 : 1000), oxygen: 100 });
   p.item = null; p.charges = 0; p.catchupWait = 0; p.catchupCooldown = 0;
  });
  for (let i = 0; i < 732; i++) v.tick(AR.FIXED_DT, true);
  n.snapshot(); return AR.inspect();
 });
 assert.equal(delivery.players[1].item, 'turbo'); assert.equal(delivery.players[1].charges, 1);
 await guest.waitForFunction(() => AR.inspect().players[1].item === 'turbo');
 assert.match(await guest.$eval('#online-item', e => e.textContent), /Turbo Current/);
 const fits = await guest.$eval('#online-item', e => {
  const r = e.getBoundingClientRect();
  return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.width >= 44 && r.height >= 44 && document.documentElement.scrollWidth === innerWidth;
 });
 assert(fits, 'Catch-up item remains tappable at the submitting player’s 393×428 viewport');
 await snap(guest, 'catchup-short-phone');
 await guest.tap('#online-item');
 await guest.waitForFunction(() => AR.inspect().players[1].effects.turbo > 0);
 assert.equal((await inspect(host)).players[1].itemsUsed, delivery.players[1].itemsUsed + 1);
 await snap(guest, 'catchup-turbo-active');
 pass('Trailing phone receives catch-up Turbo through real snapshots and activates it with the touch Item pedal at 393×428');
 // Place both through debug, then launch through the real item path. Packet delivery remains real WebRTC.
 await host.evaluate(() => { AR.debug.placePlayer(0, { x: 100, oxygen: 100 }); AR.debug.placePlayer(1, { x: 330, oxygen: 100 }); AR.debug.fireTorpedo(0); });
 await guest.waitForFunction(() => AR.inspect().online.metrics.hitEvents > 0, { timeout: 5000 });
 assert((await inspect(guest)).online.metrics.events.explosion > 0);
 pass('Actual broker, two channels, mirrored lobby, both ready, full-screen race, keyboard and multi-touch; torpedo hit/explosion delivered');
 await guest.keyboard.press('KeyP'); await waitState(host, 'ONLINE_PAUSED'); await waitState(guest, 'ONLINE_PAUSED'); await guest.click('#online-resume'); await waitState(host, 'ONLINE_RUNNING');
 // Close the real RTC channels and retain Peer identities; actual broker must negotiate fresh channels.
 await host.evaluate(() => AR.debug.online.transport.channels.state.close());
 await host.waitForFunction(() => AR.inspect().online.metrics.recoveries >= 1);
 await Promise.all([waitState(host, 'ONLINE_RUNNING'), waitState(guest, 'ONLINE_RUNNING')]);
 await host.evaluate(() => AR.debug.placePlayer(0, { x: AR.inspect().players[0].startX + 5010, oxygen: 100 }));
 await waitState(guest, 'ONLINE_ROUND_RESULT'); await Promise.all([waitState(host, 'ONLINE_MATCH_RESULT'), waitState(guest, 'ONLINE_MATCH_RESULT')]);
 const h = await inspect(host), g = await inspect(guest);
 assert.equal(h.versus.tally.matches, 1); assert.deepEqual(g.versus.tally, h.versus.tally);
 results.host = h.online; results.guest = g.online; results.tally = h.versus.tally;
 results.wire = await host.evaluate(async () => {
  const reports = await AR.debug.online.transport.channels.state.peerConnection.getStats();
  return [...reports.values()].filter(r => r.type === 'data-channel').map(r => ({ label: r.label, messagesSent: r.messagesSent, bytesSent: r.bytesSent }));
 });
 assert.equal(h.online.metrics.invalidPackets, 0); assert.equal(g.online.metrics.invalidPackets, 0); assert(h.online.maxSnapshotBytes < 600);
 pass('Real channel reconnect, round end, match result and identical persistent tallies on isolated browser contexts');
 assert.deepEqual(results.issues, []);
 pass('Zero console warnings/errors and zero page errors');
})().catch(e => { results.failure = e.stack; console.error(e); process.exitCode = 1; }).finally(async () => {
 fs.writeFileSync('/tmp/abyss-phones-browser-results.json', JSON.stringify(results, null, 2));
 console.log('RESULTS ' + JSON.stringify(results));
 await browser?.close(); server?.close();
});
