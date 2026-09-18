# Shared interface

All scripts are strict-mode IIFEs exposing `globalThis.AR` (also accessible as `AR` in a browser). Load order: `data.js`, `terrain.js`, `physics.js`, `contacts.js`, `save.js`, `audio.js`, `render.js`, `versus.js`, `game.js`. Solo/local modes have no external dependencies, fetched assets, build step, or runtime network access. Online alone lazily loads PeerJS; configured suggestions POST to Google Forms. Canvas coordinates increase right/down; 10 world pixels = 1 metre.

Data: AR.STAGES array: objects with id (reef, kelp, wreck, volcanic, ice, abyss, city, whale, thermal), name, cost, description, depth, palette {top,bottom,sand,ground,accent}, gravity, friction and terrain params as needed. AR.VEHICLES array: id (rover, crab, bike, truck, manta), name,cost,description,color, mass,wheelbase,radius,torque,topSpeed,spring,damping,travel,grip,oxygen,buoyancy,burst,cooldown. AR.UPGRADES array: id (engine,thrust,suspension,tires,oxygen,ballast),name,description,baseCost,maxLevel=12. AR.upgradeCost(id,currentLevel). AR.getStats(vehicleId,levels) returns upgraded vehicle config. All levels 0..12.

Terrain: new AR.Terrain(stageObject, seed=stage's fixed seed). .height(x) -> ground y, .slope(x) -> dy/dx, .ceiling(x) -> ceiling y or -Infinity; .maintain(x) prunes cached chunks. .vent(x) -> upward acceleration (volcanic vents and kelp hot springs). Optional .features(start,end) -> decorations {x,y,type,size}. .seed; .stage. At x=100 starter spawn, ground roughly y=400. Start flat for at least 200px. Height infinite / deterministic.

Rover: new AR.Rover(terrain,stats). fields x,y,vx,vy,angle,omega,wheels [x,y,vx,vy,angle,omega,radius,grounded], stats, oxygen,maxOxygen,cooldown,grounded,bodyGrounded,crashed,impact,burstFired, prev {x,y,angle,wheels:[{x,y,angle}]} .step(input,dt) where input {throttle:boolean,brake:boolean,burst:boolean}. Consumes oxygen, burst oxygen cost; .crashed string ('Hull crushed', 'Stranded', or 'Oxygen depleted') or empty. .impact and .burstFired reset each step. No DOM/window accesses. .savePrevious() records interpolation state; .snapshot() returns chassis position/velocity/angle, oxygen, contact flags and crash reason. Game owns score/pickups. Physics tests may refill oxygen and clear crashed to exercise all 60 seconds. AR.FIXED_DT=1/120.

Rover contacts: `AR.resolveRoverContacts(a, b)` runs after both rovers finish the same fixed step and returns `{ contacts, maxSpeed, hullCrushes }`. `contacts` counts unique wheel/dome circle pairs for this call, `maxSpeed` is the largest closing normal speed in px/s, and `hullCrushes` contains rover argument indices (0/1). Each rover has two wheel circles and a radius-20 dome at local `(0, -18)`. Six solver passes share impulses across the chassis/wheels, apply friction 0.32 and impact restitution 0.3 above 24 px/s, and use position-only overlap correction. An upper-wheel hit on a dome above 82 px/s sets that dome's rover to `Hull crushed`. Missing, identical, or crashed rovers are skipped. The versus controller skips contacts during respawn protection; ordinary item shields do not block physical ramming.

Rendering: new AR.Renderer(canvas). .resize() gets window dimensions, DPR backing; .draw(scene,dt,alpha). scene={state,terrain,rover,stage,vehicle,time,pickups,particles,texts,headlight,trail,shake}; title uses real idle rover terrain. pickups {x,y,type:'pearl'|'gold'|'oxygen'|'chest',collected:false}; particles {x,y,vx,vy,life,maxLife,size,color,type}; texts {x,y,text,life,maxLife,color}; default camera handles run; menus title composition rover around 65% viewport width, garage darken CSS. Renderer interpolates body/wheels via prev. .drawVehicle(ctx,rover,alpha) optional. .thumbnail(canvas,vehicleId) to draw centered vehicle for garage cards (may accept stats object instead). Visual quality: code drawn orange-yellow machines, layered teal ocean, corals, sand, fish, bubbles. Distinct stage decoration, dark headlight cone, dynamic zoom/lookahead. Renderer may add visual ambient particles itself but bounded, parent emits gameplay particles.

Viewport rendering: `.render(scene, camera, viewportRect)` clips one viewport, preserving the full-screen `.draw` wrapper. `viewportRect` is `{ x, y, width, height }` in CSS pixels. Each caller-owned camera has `dt` and interpolation `alpha`; rendering updates its follow/zoom fields (`camX`, `camY`, `zoom`, `lastTerrain`, `lastState`) without advancing physics. Versus extends scene with `{ player, players, projectiles, targetX }`; `rover` is the followed player's rover, while `players` holds both controller records. Pickups may also have type `'crate'`; projectiles have type `'torpedo'`, `'anchor'`, or `'bubble'`. Both cameras show the same world and visible opponents, with decoration culling per viewport. Viewport-only effects include ink, riptide waves, turbo lines, and transfer bubbles. Player 1 uses the vehicle's colour and orange tag; Player 2 uses a teal recolour/tag. Top/bottom views have a 2 px divider.

Save: AR.Save class new AR.Save(); .data canonical schema {version:2,pearls:0,stages:['reef'],vehicles:['rover'],selectedStage:'reef',selectedVehicle:'rover',upgrades:{rover:{engine:0,...}},bests:{'reef:rover':number},totalRuns:0,totalDistance:0,xp:0,level:1,achievements:[],totals:{pearls:0,chests:0,golden:0,flips:0,airtime:0,bursts:0,maxFlips:0},settings:{muted:false,headlight:'aqua',trail:'bubbles',graphics:'crisp'},versus:{p1Wins:0,p2Wins:0,matches:0}}. .save(), .reset(), .buyStage(id), .buyVehicle(id), .buyUpgrade(id) use selectedVehicle; returns boolean. .finishRun(summary) -> {xpGained,levelUps,newAchievements,levelBonus,isBest} updates pearls and totals and persists exactly once per call. summary {distance,pearls,flips,maxFlips,airtime,chests,golden,bursts,stageId,vehicleId,trickXP}. .checkAchievements() -> array newly earned definitions. AR.ACHIEVEMENTS >=12 {id,name,description,reward,test(data)}; AR.COSMETICS array {id,name,level,kind:'headlight'|'trail',color?}; AR.xpForLevel(level) cumulative threshold. Safe strict sanitization, corrupt fallback no exceptions.

`.finishVersus(winnerIndex)` accepts only numeric 0 or 1, increments the corresponding win counter and `matches`, persists once, and returns a tally copy; invalid winners return false without writing. It does not alter solo currency, progression, settings, or records. Old saves receive zeroed versus counters during sanitization without a save-version change. The controller guards this call so each completed match counts once. Reset clears solo progress and the tally. The setup screen displays the saved rivalry.

Audio: new AR.Audio(); .unlock() on gesture; .setMuted(boolean); .update({running,throttle,speed,oxygenFraction},dt); .play(name) names click,pickup,gold,oxygen,chest,burst,crash,trick,level. .suspend() silence engine for hidden/pause. No autoplay, no network; bounded nodes.

Versus audio also accepts `.update({ running, players: [{ running, throttle, speed, oxygenFraction }, ...] }, dt)`. Two engine oscillators have independent speed/throttle, mixed gains, and shared mute/pause. `engine` and `engineGain` remain aliases for the first voice for solo compatibility. Item cue names are the item IDs below. Context creation/resume stays behind `.unlock()` on a user gesture; transient voices are capped at 28.

## Versus controller

`new AR.Versus(save, sound, renderer, exit)` creates the setup/HUD/result DOM. `exit` returns control to the title. Public integration uses `.active`, `.open()`, `.close()`, `.keydown(event)`, `.keys`, `.clearKeys()`, `.pause()`, `.resume()`, `.tick(dt)`, `.draw(dt, fallbackScene)`, and `.inspect()`. The game forwards keyboard/visibility events and invokes tick/draw from its existing animation loop. Both rovers share one terrain instance and seed. No second animation loop runs.

`config` defaults to `{ mode: 'race', target: 500, bestOf: 3, carryTarget: 30, stage: 'reef', vehicles: ['rover', 'rover'] }`. Valid modes are `race`, `survival`, `pearl`, `arena`, and `treasure`; targets are 500/1000/2000 metres; bestOf is 1/3/5. All five vehicle IDs and all nine stage IDs are available independently of solo unlocks. Each player gets a fresh `AR.getStats(id, levels)` with all six upgrade levels set to 5. Match config is copied at start, so setup changes cannot alter a running round.

| Input | P1 | P2 |
| --- | --- | --- |
| Brake/reverse | `KeyA` | `ArrowLeft` |
| Throttle | `KeyD` | `ArrowRight` |
| Ballast | `KeyW` | `ArrowUp` |
| Item / setup ready | `KeyS` | `ArrowDown` |
| Setup vehicle previous/next | `KeyA` / `KeyD` | `ArrowLeft` / `ArrowRight` |

`Escape`/`KeyP` shares pause/resume; `KeyR` rematches from match results; `KeyM` toggles mute. Fixed bindings use `event.code`. Gameplay prevents arrow/Space scrolling while setup selects retain native keyboard navigation. Item use ignores repeated keydown events; ballast taps are queued through the next fixed step, and holding ballast respects its cooldown. Mouse controls also support setup. Touch title access is replaced by a keyboard-required note.

Phases are `SETUP`, `COUNTDOWN`, `RUNNING`, `PAUSED`, `ROUND_RESULT`, and `MATCH_RESULT`; `AR.inspect().state` prefixes these with `VERSUS_`. Countdown lasts 4 seconds (3, 2, 1, GO), with frozen simulation. Round results last 3 seconds. The first score reaching `ceil(bestOf / 2)` wins the match; tied rounds award no point and start another round. Results include round distances/crashes/itemsUsed/pearls and match bestDistance/itemsLanded/crashes/torpedoesDodged.

1. `race`: first to target distance wins. If both cross during the same fixed step, compare interpolated crossing fractions; equal crossing fractions tie. Empty oxygen causes a blackout rather than ending the round.
2. `survival`: drain oxygen at 1.5× the ordinary rate and place oxygen tanks in one-third as many sectors. Each player starts with three lives. Empty oxygen costs one life; the final loss eliminates. The last player with a life wins; simultaneous final losses compare distance, tying only if distance is also equal.
3. `pearl`: compare pearls after 90 seconds. Equal pearls tie. Empty oxygen causes a blackout; scoring resumes after respawn.

Distances for scores/results are the greatest progress from each player's own start. Initial grid positions alternate each round. `.currentDistance(player)` uses present position for trailing-item selection and catch-up: linearly fade +25% top speed and +15% torque from full strength at 60 m to zero at 20 m. Grounded trailing rovers 8–40 m behind get +10% slipstream speed. Each player holds one item; crates are ignored while occupied. Shared pearls and oxygen are consumed once; a collected-key ledger prevents respawning them when sectors are pruned and regenerated. Crates use the per-racer two-second cooldown described below.

Ordinary crashes increment the player's crash count, discard their item/effects, freeze them for 2.5 seconds, then respawn upright at the crash X with 15% of maximum oxygen deducted and 1.5 seconds of `spawnShield`. This shield blocks opponent contact and hostile items without being consumed. Oxygen depletion increments `blackouts`, freezes the rover at its position for 4 seconds, and respawns with 60% oxygen and spawn protection. Only the final survival life eliminates. If a crash oxygen deduction reaches zero, a blackout begins exactly once. Shared pause freezes oxygen, effect timers, respawn, countdown, and round transitions. Visibility/focus loss clears input and pauses.

## Versus items and state

`AR.VERSUS_ITEMS` maps item IDs to `{ name, icon, description }`. Controller player records contain `rover`, `base`, `index`, `startX`, `maxX`, `distance`, `pearls`, `crashes`, `itemsUsed`, `item`, `charges`, `respawn`, `out`, `catchup`, `slipstream`, `blackouts`, `lives`, `respawnKind`, `effects`, and toast state. Item/effect durations are seconds of simulation, decremented only while running. Positive effect values identify active feedback.

| ID | Effect / lifetime | Primary state |
| --- | --- | --- |
| `ink` | Opponent ink for 3.5 s | victim `effects.ink` |
| `torpedo` | Seabed projectile toward opponent; light vertical homing; maximum 12 s; instant Torpedoed! crash on unshielded hit | `projectiles[].type === 'torpedo'`; victim `effects.torpedo` on hit |
| `net` | Opponent torque ×0.5, top speed ×0.5 and mild drag (0.08/s) for 4 s | victim `effects.net` |
| `geyser` | 0.3 s warning, then 1.6× level-5 ballast impulse (×0.6 airborne), ±0.4 rad/s pitch, horizontal speed ×0.68; shield blocks | victim `effects.geyserWarning`, `effects.geyser`, `geyserX`, `geyserY` |
| `siphon` | Transfer up to 25 oxygen, bounded by victim reserve and user's tank maximum | victim `effects.siphon`, user `effects.siphonGain` |
| `riptide` | Swap opponent throttle/brake for 5 s | victim `effects.riptide` |
| `shield` | Block one hostile item/projectile, or expire after 8 s | user `effects.shield`; `effects.blocked` on interception |
| `turbo` | Torque ×1.6 and top speed ×1.4 for 3 s | user `effects.turbo` |
| `magnet` | Steal floor(opponent pearls ×0.3), Pearl Rush only; otherwise replace with turbo | victim `effects.magnet`, user `effects.magnetGain` |
| `anchor` | Two charges; each placed anchor lasts 15 s and hard-stops/bounces the opponent | `charges`, `projectiles[].type === 'anchor'`; victim `effects.anchor` on hit |

Each use has a distinct sound cue and toast in both viewports. Successful attacks increment the attacker's match `itemsLanded` and set victim `effects.hit`. Shielded attacks do not count as landed. Torpedoes visibly passing a nearby opponent increment that victim's `torpedoesDodged` and set `effects.dodged`. The leader's item table favours shield/turbo/anchor. The trailing table favours attacks below 20 m, Turbo/torpedo/net from 20 m, and 5/13 Turbo, 3/13 torpedo, 2/13 net, 2/13 riptide and 1/13 geyser at 60 m or more. Ground crates are spaced 120–200 m with additional ramp crates.

Each player has host-owned `catchupWait` and `catchupCooldown` timers, initialized to zero each round. After pickups, crash handling and finish adjudication, an active round accumulates `catchupWait` up to 6 seconds while both racers are active, the slot is empty and the current progress deficit is at least 60 m. Otherwise it resets. At 6 seconds with no remaining cooldown, grant a one-charge held Turbo, reset the wait and set the cooldown to 12 seconds. Cooldown decreases during running simulation, including respawns; pause/countdown/results freeze both timers. Existing item snapshots, toast and sound events synchronize delivery without new protocol fields or guest simulation.

## Inspection and debug hooks

`AR.inspect()` preserves its existing solo fields outside versus. While versus is active it returns `{ state, players, versus }`. Each player entry combines the rover snapshot with index, vehicle, maxOxygen, item, charges, crashes, distance, pearls, effects, respawn, out, catchup, startX, itemsUsed, torque, and topSpeed. `versus` includes phase, round, scores, mode, target, remaining, contacts, time, tally, totals, projectiles, and a rough `fps` counter. Snapshot copies do not mutate live state.

Only a URL with `?debug=1` exposes `AR.debug`:

| Hook | Contract |
| --- | --- |
| `giveItem(playerIndex, itemId)` | Grant a valid item; anchor receives two charges. Magnet becomes turbo outside Pearl Rush. Returns success boolean. |
| `placePlayer(playerIndex, values)` | Set finite `x`, `y`, `vx`, `vy`, `angle`, `oxygen`, and/or `pearls`; synchronize wheels/interpolation; clear crash, respawn, out, and effects. Omitted Y places the rover above terrain. Historical best distance remains unchanged. |
| `crashPlayer(playerIndex)` | Trigger a normal hull-crush respawn during RUNNING; returns success boolean. |
| `setOxygen(playerIndex, value)` | Set finite oxygen, clamped to the tank capacity; next fixed step applies depletion. |
| `fireTorpedo(playerIndex)` | Grant and launch a torpedo through normal item logic while RUNNING. |
| `advance(seconds)` | Run fixed-step controller ticks, including phase transitions, clamped to 0–120 seconds per call; return inspection. Paused state remains frozen. This is simulation advancement, not a rendered-FPS measurement. |

Player indices are 0/P1 and 1/P2. Hooks are for local tests and manual debugging, not regular UI controls.

## Test entry points

`node docs/selftest.js`, `node tests/progression.test.js`, `node tests/edge.test.cjs`, and `node tests/browser.test.cjs` remain the solo regression checks. New checks are `node tests/contacts.test.cjs`, `node tests/versus-save-audio.test.cjs`, `node tests/versus-logic.test.cjs`, and `node tests/versus.test.cjs`. The logic suite runs the real `AR.Versus` controller/physics in a Node VM with a small mock DOM and presentation methods suppressed; it covers current-position catch-up/item selection, finish crossing order, tie replay and mode adjudication, shared pickups/sector regeneration, Pearl Rush depletion, survival drain/scarcity, respawn, and shields. The browser tests use the existing environment's `puppeteer-core` and Chromium binary (override the binary with `ABYSS_CHROME`), file URLs, temporary browser profiles, and a debugging pipe. These are test dependencies only. Versus screenshots are written to `/tmp/abyss-versus-*.png` for direct visual review; final outcomes/FPS belong in the task's validation record.

FIX2 rendering: `.setGraphics('crisp'|'performance')` applies a fixed density (Crisp: clamp DPR to [1,2]; Performance:1). `scene.explosions` contains `{x,y,life,maxLife}`, `scene.shake` is normalized 0..1 in versus, and `scene.flash` is remaining flash seconds. Rover `.ghosting` indicates a hysteretic ground overlap; render the rear rover at .55 only while visually overlapping. Both views display the same explosion, shake, and flash. Chunk caches use terrain identity, chunk, and upward-rounded quarter-zoom buckets. Static HUD DOM and cached name tags avoid unchanged text repaints. `tests/graphics.test.cjs` checks sizes/settings; `tests/render-benchmark.cjs` measures actual frame timestamps.


## Online Versus (round 3)

Static script order after `versus.js`: `online-core.js`, `qr.js`, `online-transport.js`, `online-ui.js`, `online.js`, optional `config.js`, `suggestions.js`, then `game.js`. `AR.VERSION` is `3.4.0`. A comments-only `config.js` keeps the default build self-contained and Suggestions hidden.

`new AR.Online(versus, {headless, now, ui})` decorates the existing versus controller while online is active. UI-free tests suppress only the versus presentation methods, as the existing logic fixture does. `attach('host'|'guest', transport, code)` binds a transport; `connected()` starts its handshake. The guest never calls `Rover.step`, `Versus.step`, pickup collection, projectile simulation, or match adjudication. `Versus.tick(dt, true)` is the host's unmodified fixed-step loop. Optional hooks in versus route online input, UI, phase and effect notifications; disabling `network` restores local mode.

Transport interface: `.on('open'|'close'|'error'|'data', callback)`, `.send(data, 'events'|'state')`, `.reconnect()`, `.close()`, `.connected`. Data callbacks receive `{data, channel}`. `AR.PeerTransport(role, code).start()` lazily injects PeerJS 1.5.4 and uses the public default broker plus specified STUN/TURN. Host IDs are `abyss-CODE`. Two guest seats are reserved by peer ID and token. A seat retains its index across reconnects. Newcomers are rejected after the match starts or when both seats are occupied. Ordered `events` and unordered `state` both serialize binary; PeerJS 1.5.4 does not expose an unreliable retransmit limit. State backpressure is capped and old sequence numbers are discarded.

`AR.LoopbackTransport.pair({latency=40, jitter=10, loss=0, seed=7})` returns two independent endpoints with shared deterministic scheduling. `.pump(ms)` advances network time and dispatches all due messages in order; reliable events are never lost, and state can be dropped/reordered. `.drop()` cuts both ends and discards in-flight packets; `.reconnect()` reopens both. Tests supply `now: () => transport.wire.now` and tick controllers separately. This implements the headless alternative to a two-renderer `?online=loopback` page.

Input packets include `{type:'input', epoch, round, seq, t, throttle, brake, burst, item, b, i}`. `b`/`i` are cumulative burst/item edge counters. They survive lost/reordered updates and quick taps between samples; the host consumes edges once per physics step. Held values expire after 400 ms. Periodic input targets 30 Hz, with immediate reliable packets on control changes/cancellation. Inputs for other epochs/rounds are ignored. Keyboard aliases and touch share the same source.

Snapshots are binary ArrayBuffers, protocol byte 4, at 20 Hz. Codec exports: `AR.OnlineCore.Codec.encode(versus, sequence, timestampMs, epoch, edgeAck, {pickups,events})` and `.decode(buffer)`. Header contains epoch, sequence, time, round, phase/countdown time, match time, scores, input edge acknowledgements and flash/shake. Two or three rover records carry int32 centimetre positions, int16 velocity, uint16 orientation/wheel angles, relative int16 wheel offsets, oxygen/cooldown, respawn kind/crash reason, flags, item/charges, lives/blackouts/crashes/items used/pearls/distance, and 23 quantized effects plus Round 5 state detailed below. Projectile IDs persist within a round. At most 12 projectiles within 2,600 pixels of either rover are included; simulation/projectile lifetime is never capped. Remaining space contains redundant pickup/event hints, trimmed before 590 payload bytes. Full pickup/events travel on the ordered channel, with epoch/round gates. The guest’s event ledger handles out-of-order hints exactly once, and its collected ledger survives sector pruning.

`SnapshotBuffer` keeps a bounded history covering the 100 ms render buffer. Its time cursor never moves backward, old poses are rejected, rover/wheel angles interpolate via shortest arc, projectile IDs match across frames, and extrapolation ends at 150 ms. Crash/respawn/out transitions use the new pose directly. Guest presentation uses the existing renderer at full viewport with camera alpha 1; host uses normal physics interpolation. All HUD/results data originate at the host.

Reliable messages: version handshake, lobby config/revision/readiness, round initialization, phase/totals/results, pause/resume, delta batches, reconnect state/ack, leave, ping/pong and heartbeats. Ping updates every 2 seconds; heartbeats run every 500 ms and five silent seconds trigger recovery. An attempt times out at 15 seconds; reconnection gets a fixed 15-second deadline that repeated failures cannot extend. Recovery retains live data channels and only recreates broken channels, restores the complete paused world and collected IDs, acknowledges it, then resumes only if play was not manually paused. Reconnect does not reload the page, migrate hosts or replay old transient sounds. Abandoned unfinished matches are not tallied. Each completed epoch is saved once on each browser.

Normal inspect extends versus with `state: 'ONLINE_' + phaseOrScreen` and `online: {role,state,code,epoch,rtt,error,abandoned,snapshotBytes,maxSnapshotBytes,metrics,input,pickups,transport}`. Debug mode additionally exposes `AR.debug.online`; other mutation/debug hooks reject guest calls. Host hooks retain their local meanings. Sequence/phase snapshots and application RTT use monotonic milliseconds, not physics ticks.

New suites: `online.test.cjs` (offline/headless deterministic transport, controller integration, QR vectors), `suggestions.test.cjs` (mocked POST, fields/context, focus/cooldown), `online-browser.test.cjs` (real public broker and two independent browser contexts, actual channels, touch/keyboard, item hit, reconnect and tally). `run-all.cjs` runs all regression suites and the render benchmark serially and writes `/tmp/abyss-phones-suites.json`. If online signalling is unreachable, the real-broker suite reports it explicitly; a connected test failure is not a skip.

QR reference vectors in `tests/fixtures/qr-vectors.json` were generated independently with Python `qrcode.QRCode(error_correction=ERROR_CORRECT_M, border=0, mask_pattern=0)` and explicit `QRData(text, mode=MODE_8BIT_BYTE)`. Versions 1–4 compare all data/error-correction codewords and every masked module, including BCH format bits and the fixed dark module. Production mask selection minimizes run/2×2/finder-pattern/balance penalties and adds four quiet modules when drawing.

Suggestion configuration uses `AR.CONFIG.suggestionsFormAction` and `.suggestionsFields.{text,name,context}`; the endpoint must be HTTPS docs.google.com and end in `/formResponse`. Missing/invalid configuration hides the title button. `FormData` POST with `no-cors` includes only trimmed typed text/name and requested mode/version/viewport/user-agent context. The 20-second page-session cooldown persists across dialog opens. Tests mock fetch and never send an external suggestion.


## Player features — 3.2.0

Ice ceilings smoothly follow the seabed with at least 250 px clearance. `Terrain.platformsBetween(start,end)` returns bounded deterministic `{id,start,end,type}` decks in Kelp/Wreck; `platformHeight(x,deck)` and `platformSlope(x,deck)` are the exact rendered/collision surface. Platforms are one-way: jump through from below, land and drive above. `hotSpringsBetween` returns `{x,y,width,strength}` kelp springs whose acceleration is included by `vent(x)`; the volcanic formula is unchanged. `gravityCeiling(x)` returns ice or a current roof 340 px above the floor.

`Rover.setGravityFlipped(bool)` starts a 0.6 s guided turn with a 1.25 s collision grace, signed gravity, ceiling wheel traction, and unchanged world-horizontal pedal directions. Set `jetThrust=240` for the item, or zero to stop it; force applies equally to all bodies and approaches a 1.4× top-speed cap. Grace suppresses rotation impacts, not oxygen depletion. `AR.WorldHazards(terrain).step(rovers,dt)` owns `.sharks` with `{id,homeX,x,y,phase,direction,timer,vx,vy}`. Phases are patrol/warning/lunge/recover. Reef/Wreck/Abyss sharks and Whale Fall fish use the Round 5 warning/lunge/retreat and damage rules below. Only the host/solo steps hazards; guests render snapshots.

Crates are independent of the shared pearl/oxygen ledger and always retain `collected=false`. `Versus.crateCooldowns` is a bounded Map from crate key to `[readyAtP0,readyAtP1]` in simulation seconds. Each racer collects every 2 s with an empty slot, independent of the other. Expired entries are pruned; pause freezes deadlines, regeneration preserves them, and newRound resets. A reliable deduplicated `crate` event carries `{key,index,readyAt}`; reconnect carries the complete map. The renderer hides a crate only while the viewer’s deadline is in the future.

New held items `gravity`/`jet` set user `effects.gravity=6` / `effects.jet=4`; expiration and respawn clear the corresponding physics effect. Existing large-gap item odds and catch-up Turbo delivery remain intact.

Arena mode calls `Terrain.setArena()` (bounds 0–1800, roof y=40, shallow seabed mounds). `player.facing` is +/-1 from last horizontal input. Item fires a 340 px/s straight `bubble`, 4 s lifetime, 0.8 s `effects.fireCooldown`; Ballast becomes a 1 s `effects.jumpCooldown` jump with no oxygen drain. `lives` is remaining hull, starting at 3; bullets and hull crashes cost one, 1.2 s safe respawn follows surviving damage, and 1.5 s spawn shielding blocks repeats. Final hits eliminate; simultaneous final losses tie. At 120 s compare hull, ties replay. Race pickups, sharks, catch-up and slipstream are disabled. Existing local/online inputs, rounds, results, and tally persistence apply.

Protocol v4 preserves facing, gravity/jet/cannon timers, bubble types, and up to four sharks, and adds the Round 5 state below. Old clients fail the existing version handshake and are asked to reload. Browser regression tests use `/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell`; tests never submit suggestions. Gameplay selection prevention covers HUD/body/pedals with the WebKit prefix and selectstart/contextmenu cancellation while inputs, textareas and copyable room information remain selectable.


## Round 5 / 3.3.0 contract (supersedes earlier shark/protocol notes)

New stage IDs are `city`, `whale`, `thermal`, appended to preserve existing stage
indices. Costs are 7400/8600/11000. Each has `how`, palette, seed and terrain tuning.
Garage canvas thumbnails use `Renderer.stageThumbnail(canvas, stage)`.

`Terrain.worldTime`, `bridges: Map<number,number>` (bridge ID → trigger time), and
`revision` are host-owned. `stepWorld(rovers,dt)` runs once before both rovers;
solo runs it before its rover. No rendering method advances this state. A bridge
begins collapse at trigger + .6 s; the permanent 112 px gap has smooth slopes.
Chunk animations fall faster than the rover; the ground collider always exists.
`revision` invalidates cached ground/decorations when collision height changes.
`zonesBetween(start,end)` provides deterministic current/ribs/plankton/geyser/mud/
elevator geometry. `environment(rover)` supplies current acceleration ±48 px/s²,
mud half torque/top-speed, plankton +1 net O₂/s, and lift. Currents and elevators
accelerate chassis and wheels together, prevent sleep, and introduce no pitch
impulse. Ballast doubles elevator lift with no oxygen cost/cooldown. Natural vents
charge until phase 3.45 s of a 4 s cycle; the launch window ends at 3.85 s and the
visible column fades at 4 s. Each rover receives at most one impulse per cycle.

`AR.launchGeyser(rover,strength,spin)` applies a 1.6× level-5 ballast impulse and
sets `geyserFlight=2`; stronger upward drag limits flight to roughly two seconds.
Victim column origin is latched at eruption, and the rumble follows the victim.
Shield is checked on use and again at eruption, permitting a defensive late shield.
Riptide's banner persists for its five-second effect, including paused frames.
Pedals retain layout/labels, gain purple tint/⇄ and an accessible reversed-action
label. The UI never mutates input mapping; only the host's `controls()` swaps it.

`config.carryTarget` accepts 20, 30 or 45 (default 30). `treasure` shares ordinary
items, terrain, oxygen, respawns and rounds. `Versus.chest` is null in other modes,
otherwise `{x,y,vx,vy,carrier,previous,lock,lastTeleport}`. Carrier/previous use -1
for nobody and 0/1 for players. Touch uses swept rover movement within 60 px.
A carried chest follows below the chassis and multiplies top speed by .88.
`dropChest(player)` is idempotent, bounces toward the opponent with 105 px/s and
−100 px/s vertical speed, and locks the previous owner out for one second.
Crash/blackout, torpedo and item/natural geyser drop it. A real contact with closing
speed >70 px/s and the other rover at least 22 px above also drops it. A different
next owner earns a steal. `updateChest(dt)` awards carry time and wins at target;
`endRound` freezes score. At separation >3000 px the chest resets to the midpoint,
at most once/second, with a toast on entering that state. `carryTime` and `steals`
are included in player, round and match statistics.

`WorldHazards(terrain,onBite?)` spawns sharks every ~1700 px after x=2300 in Reef,
Wreck, Abyss, and fish schools in Whale Fall; deeper stages sometimes get a pair.
Phases remain `patrol`, `warning`, `lunge`, `recover` (six seconds). Patrol approaches
at .55× target speed; a .9 s warning commits to the predicted position .5 s beyond
warning expiry. Hard braking therefore changes arrival without moving the warning
line. Lunge speed is max(380,1.5×current target speed), length at least 600 px.
Relative swept box/circle tests cover chassis and both wheels. Solo loses 20 oxygen
and receives a shove/red flash; zero oxygen ends the run. Versus invokes its shield
or ordinary `Shark bite` crash. Fish only shove, without oxygen/crash damage.
Successful survival increments `rover.sharkEncounters`. `finishRun` preserves the
maximum per-run count as `totals.sharkEncounters`; five earns `shark-attack` once.

Binary protocol version is **4**; all peers require matching `AR.VERSION`.
Snapshots include geyser warning/column timers and origins, reversed controls,
environment flags, carry times/steals, chest position/owner/lockout, up to six nearby
bridge trigger times, and up to two nearest sharks per player with committed aim
points and fish flag. The snapshot clock is the stage clock. Buffer limit is 1200
bytes; hints trim around 590 bytes, with reliable delivery retaining all events.
Reliable `collapse` and `chest` events supplement snapshots; full reconnect restores
the entire bridge map, and result phase messages contain exact carry/steal stats.
The guest never invokes `stepWorld`, Rover.step or controller mechanics.

New executable suites: `round5-mechanics.test.cjs`, `round5-online.test.cjs`,
`round5-browser.test.cjs`. The latter captures both required viewport sizes into
`/tmp/abyss-r5-*` and asserts console silence during real guest rendering. Debug-only
`AR.debug.solo.scene()`, `.place(x)`, `.advance(seconds)` support solo QA; competitive
mutation hooks remain blocked on the guest. Run every suite serially via the runner.

## Three-phone rooms and phone stability (3.4.0)

Local Versus stays two-player. Online `config.vehicles`, readiness, scores, totals,
players and cameras have two or three entries. P3 joins automatically before start;
joining clears readiness. All existing modes, pairwise contacts, shared pickups,
per-player crates, item targeting, round ties and results work for either size.
`Versus.rival(p)` chooses the nearest active opponent (ties by index); projectiles
can strike any opponent. Catch-up uses leader progress; slipstream checks both
rivals. Pairwise ghost sets preserve each overlap's hysteresis independently.

Host transport `open`/`close` events supply guest index 1/2; `data` includes
`{data,channel,index}`. `send(data,channel,index)` targets a guest; omitting index
broadcasts. Each seat owns two channels, an input receiver, version handshake,
heartbeat and event ACK. State snapshots are encoded per guest for independent
input acknowledgements. Protocol 4 adds the player count before epoch, variable
scores/poses and two-bit projectile owners (type bits 4/8); up to six sharks fit
within the unchanged 1200-byte maximum. Guests never simulate physics.

`finishVersus(winner,3)` stores a separate optional `versus.trio` tally with three
win counters and match count; default two-player calls/schema are preserved.
All peers save a completed epoch once; abandoned matches do not change tallies.

At 400 ms input expires. Five seconds of silence pauses the whole room, allowing
15 seconds to recover. Live data channels survive heartbeat/signalling gaps;
only actually failed channels redial, preserving other guests. Recovery IDs
make delayed duplicate syncs idempotent. All missing guests must acknowledge
before automatic resume, and an existing manual pause stays paused. No reload,
new service, endpoint, library or external asset was added.

Renderer sprite caches share a 24 MiB retained RGBA budget on phones (coarse
pointer or width at most 620 px), 96 MiB on desktop, apart from a single larger
current sprite. The desktop budget preserves the split-screen tile working set. Eviction closes bitmaps or shrinks HTMLCanvas backing to
1×1; transferred OffscreenCanvas storage is also released. Hidden pages clear
caches, and same-size resizes do not allocate new backing. Crisp density and
fixed physics are unchanged. `Renderer.cacheUsage()` exposes bytes/budget/count
for regression checks. Phone/browser suites and screenshots are described in
README; use Chromium headless shell 1243 at the absolute path above.
