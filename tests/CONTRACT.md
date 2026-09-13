# Shared interface

All scripts are strict-mode IIFEs exposing `globalThis.AR` (also accessible as `AR` in a browser). Load order: `data.js`, `terrain.js`, `physics.js`, `contacts.js`, `save.js`, `audio.js`, `render.js`, `versus.js`, `game.js`. No external dependencies, fetched assets, build step, or runtime network access. Canvas coordinates increase right/down; 10 world pixels = 1 metre.

Data: AR.STAGES array: objects with id (reef, kelp, wreck, volcanic, ice, abyss), name, cost, description, depth, palette {top,bottom,sand,ground,accent}, gravity, friction and terrain params as needed. AR.VEHICLES array: id (rover, crab, bike, truck, manta), name,cost,description,color, mass,wheelbase,radius,torque,topSpeed,spring,damping,travel,grip,oxygen,buoyancy,burst,cooldown. AR.UPGRADES array: id (engine,thrust,suspension,tires,oxygen,ballast),name,description,baseCost,maxLevel=12. AR.upgradeCost(id,currentLevel). AR.getStats(vehicleId,levels) returns upgraded vehicle config. All levels 0..12.

Terrain: new AR.Terrain(stageObject, seed=stage's fixed seed). .height(x) -> ground y, .slope(x) -> dy/dx, .ceiling(x) -> ceiling y or -Infinity; .maintain(x) prunes cached chunks. .vent(x) -> upward acceleration (0 except volcanic). Optional .features(start,end) -> decorations {x,y,type,size}. .seed; .stage. At x=100 starter spawn, ground roughly y=400. Start flat for at least 200px. Height infinite / deterministic.

Rover: new AR.Rover(terrain,stats). fields x,y,vx,vy,angle,omega,wheels [x,y,vx,vy,angle,omega,radius,grounded], stats, oxygen,maxOxygen,cooldown,grounded,bodyGrounded,crashed,impact,burstFired, prev {x,y,angle,wheels:[{x,y,angle}]} .step(input,dt) where input {throttle:boolean,brake:boolean,burst:boolean}. Consumes oxygen, burst oxygen cost; .crashed string ('Hull crushed', 'Stranded', or 'Oxygen depleted') or empty. .impact and .burstFired reset each step. No DOM/window accesses. .savePrevious() records interpolation state; .snapshot() returns chassis position/velocity/angle, oxygen, contact flags and crash reason. Game owns score/pickups. Physics tests may refill oxygen and clear crashed to exercise all 60 seconds. AR.FIXED_DT=1/120.

Rover contacts: `AR.resolveRoverContacts(a, b)` runs after both rovers finish the same fixed step and returns `{ contacts, maxSpeed, hullCrushes }`. `contacts` counts unique wheel/dome circle pairs for this call, `maxSpeed` is the largest closing normal speed in px/s, and `hullCrushes` contains rover argument indices (0/1). Each rover has two wheel circles and a radius-20 dome at local `(0, -18)`. Six solver passes share impulses across the chassis/wheels, apply friction 0.32 and impact restitution 0.3 above 24 px/s, and use position-only overlap correction. An upper-wheel hit on a dome above 82 px/s sets that dome's rover to `Hull crushed`. Missing, identical, or crashed rovers are skipped. The versus controller skips contacts during respawn protection; ordinary item shields do not block physical ramming.

Rendering: new AR.Renderer(canvas). .resize() gets window dimensions, DPR backing; .draw(scene,dt,alpha). scene={state,terrain,rover,stage,vehicle,time,pickups,particles,texts,headlight,trail,shake}; title uses real idle rover terrain. pickups {x,y,type:'pearl'|'gold'|'oxygen'|'chest',collected:false}; particles {x,y,vx,vy,life,maxLife,size,color,type}; texts {x,y,text,life,maxLife,color}; default camera handles run; menus title composition rover around 65% viewport width, garage darken CSS. Renderer interpolates body/wheels via prev. .drawVehicle(ctx,rover,alpha) optional. .thumbnail(canvas,vehicleId) to draw centered vehicle for garage cards (may accept stats object instead). Visual quality: code drawn orange-yellow machines, layered teal ocean, corals, sand, fish, bubbles. Distinct stage decoration, dark headlight cone, dynamic zoom/lookahead. Renderer may add visual ambient particles itself but bounded, parent emits gameplay particles.

Viewport rendering: `.render(scene, camera, viewportRect)` clips one viewport, preserving the full-screen `.draw` wrapper. `viewportRect` is `{ x, y, width, height }` in CSS pixels. Each caller-owned camera has `dt` and interpolation `alpha`; rendering updates its follow/zoom fields (`camX`, `camY`, `zoom`, `lastTerrain`, `lastState`) without advancing physics. Versus extends scene with `{ player, players, projectiles, targetX }`; `rover` is the followed player's rover, while `players` holds both controller records. Pickups may also have type `'crate'`; projectiles have type `'torpedo'` or `'anchor'`. Both cameras show the same world and visible opponents, with decoration culling per viewport. Viewport-only effects include ink, riptide waves, turbo lines, and transfer bubbles. Player 1 uses the vehicle's colour and orange tag; Player 2 uses a teal recolour/tag. Top/bottom views have a 2 px divider.

Save: AR.Save class new AR.Save(); .data canonical schema {version:2,pearls:0,stages:['reef'],vehicles:['rover'],selectedStage:'reef',selectedVehicle:'rover',upgrades:{rover:{engine:0,...}},bests:{'reef:rover':number},totalRuns:0,totalDistance:0,xp:0,level:1,achievements:[],totals:{pearls:0,chests:0,golden:0,flips:0,airtime:0,bursts:0,maxFlips:0},settings:{muted:false,headlight:'aqua',trail:'bubbles'},versus:{p1Wins:0,p2Wins:0,matches:0}}. .save(), .reset(), .buyStage(id), .buyVehicle(id), .buyUpgrade(id) use selectedVehicle; returns boolean. .finishRun(summary) -> {xpGained,levelUps,newAchievements,levelBonus,isBest} updates pearls and totals and persists exactly once per call. summary {distance,pearls,flips,maxFlips,airtime,chests,golden,bursts,stageId,vehicleId,trickXP}. .checkAchievements() -> array newly earned definitions. AR.ACHIEVEMENTS >=12 {id,name,description,reward,test(data)}; AR.COSMETICS array {id,name,level,kind:'headlight'|'trail',color?}; AR.xpForLevel(level) cumulative threshold. Safe strict sanitization, corrupt fallback no exceptions.

`.finishVersus(winnerIndex)` accepts only numeric 0 or 1, increments the corresponding win counter and `matches`, persists once, and returns a tally copy; invalid winners return false without writing. It does not alter solo currency, progression, settings, or records. Old saves receive zeroed versus counters during sanitization without a save-version change. The controller guards this call so each completed match counts once. Reset clears solo progress and the tally. The setup screen displays the saved rivalry.

Audio: new AR.Audio(); .unlock() on gesture; .setMuted(boolean); .update({running,throttle,speed,oxygenFraction},dt); .play(name) names click,pickup,gold,oxygen,chest,burst,crash,trick,level. .suspend() silence engine for hidden/pause. No autoplay, no network; bounded nodes.

Versus audio also accepts `.update({ running, players: [{ running, throttle, speed, oxygenFraction }, ...] }, dt)`. Two engine oscillators have independent speed/throttle, mixed gains, and shared mute/pause. `engine` and `engineGain` remain aliases for the first voice for solo compatibility. Item cue names are the item IDs below. Context creation/resume stays behind `.unlock()` on a user gesture; transient voices are capped at 28.

## Versus controller

`new AR.Versus(save, sound, renderer, exit)` creates the setup/HUD/result DOM. `exit` returns control to the title. Public integration uses `.active`, `.open()`, `.close()`, `.keydown(event)`, `.keys`, `.clearKeys()`, `.pause()`, `.resume()`, `.tick(dt)`, `.draw(dt, fallbackScene)`, and `.inspect()`. The game forwards keyboard/visibility events and invokes tick/draw from its existing animation loop. Both rovers share one terrain instance and seed. No second animation loop runs.

`config` defaults to `{ mode: 'race', target: 500, bestOf: 3, stage: 'reef', vehicles: ['rover', 'rover'] }`. Valid modes are `race`, `survival`, and `pearl`; targets are 500/1000/2000 metres; bestOf is 1/3/5. All five vehicle IDs and all six stage IDs are available independently of solo unlocks. Each player gets a fresh `AR.getStats(id, levels)` with all six upgrade levels set to 5. Match config is copied at start, so setup changes cannot alter a running round.

| Input | P1 | P2 |
| --- | --- | --- |
| Brake/reverse | `KeyA` | `ArrowLeft` |
| Throttle | `KeyD` | `ArrowRight` |
| Ballast | `KeyW` | `ArrowUp` |
| Item / setup ready | `KeyS` | `ArrowDown` |
| Setup vehicle previous/next | `KeyA` / `KeyD` | `ArrowLeft` / `ArrowRight` |

`Escape`/`KeyP` shares pause/resume; `KeyR` rematches from match results; `KeyM` toggles mute. Fixed bindings use `event.code`. Gameplay prevents arrow/Space scrolling while setup selects retain native keyboard navigation. Item use ignores repeated keydown events; ballast taps are queued through the next fixed step, and holding ballast respects its cooldown. Mouse controls also support setup. Touch title access is replaced by a keyboard-required note.

Phases are `SETUP`, `COUNTDOWN`, `RUNNING`, `PAUSED`, `ROUND_RESULT`, and `MATCH_RESULT`; `AR.inspect().state` prefixes these with `VERSUS_`. Countdown lasts 4 seconds (3, 2, 1, GO), with frozen simulation. Round results last 3 seconds. The first score reaching `ceil(bestOf / 2)` wins the match; tied rounds award no point and start another round. Results include round distances/crashes/itemsUsed/pearls and match bestDistance/itemsLanded/crashes/torpedoesDodged.

1. `race`: first to target distance wins. If both cross during the same fixed step, compare interpolated crossing fractions; equal crossing fractions tie. If both oxygen reserves empty before the target, furthest distance wins; equal distances tie.
2. `survival`: drain oxygen at 1.5× the ordinary rate and place oxygen tanks in one-third as many sectors. One remaining reserve wins; simultaneously empty reserves tie.
3. `pearl`: compare pearls after 90 seconds, or immediately if both reserves are empty. Equal pearls tie. An exhausted player remains able to drive, collide, and use a held item, but cannot collect pickups, gain pearls, or use ballast for the rest of the round.

Distances for scores/results are the greatest progress from each player's own start. Initial grid positions alternate each round. `.currentDistance(player)` uses present position for trailing-item selection and catch-up: activate +12% top speed beyond an 80 m deficit, retain until within 30 m. Each player holds one item; crates are ignored while occupied. Shared pickups are consumed once; a collected-key ledger prevents respawning them when sectors are pruned and regenerated.

Ordinary crashes increment the player's crash count, discard their item/effects, freeze them for 2.5 seconds, then respawn upright at the crash X with 15% of maximum oxygen deducted and 1.5 seconds of `spawnShield`. This shield blocks opponent contact and hostile items without being consumed. Oxygen depletion eliminates a player for the round, except for Pearl Rush's continued-driving rule. Shared pause freezes oxygen, effect timers, respawn, countdown, and round transitions. Visibility/focus loss clears input and pauses.

## Versus items and state

`AR.VERSUS_ITEMS` maps item IDs to `{ name, icon, description }`. Controller player records contain `rover`, `base`, `index`, `startX`, `maxX`, `distance`, `pearls`, `crashes`, `itemsUsed`, `item`, `charges`, `respawn`, `out`, `catchup`, `effects`, and toast state. Item/effect durations are seconds of simulation, decremented only while running. Positive effect values identify active feedback.

| ID | Effect / lifetime | Primary state |
| --- | --- | --- |
| `ink` | Opponent ink for 3.5 s | victim `effects.ink` |
| `torpedo` | Seabed projectile toward opponent; light vertical homing; maximum 12 s; shove/spin on hit | `projectiles[].type === 'torpedo'`; victim `effects.torpedo` on hit |
| `net` | Opponent torque ×0.35 and heavy drag for 4 s | victim `effects.net` |
| `siphon` | Transfer up to 25 oxygen, bounded by victim reserve and user's tank maximum | victim `effects.siphon`, user `effects.siphonGain` |
| `riptide` | Swap opponent throttle/brake for 4 s | victim `effects.riptide` |
| `shield` | Block one hostile item/projectile, or expire after 8 s | user `effects.shield`; `effects.blocked` on interception |
| `turbo` | Torque ×1.6 and top speed ×1.4 for 3 s | user `effects.turbo` |
| `magnet` | Steal floor(opponent pearls ×0.3), Pearl Rush only; otherwise replace with turbo | victim `effects.magnet`, user `effects.magnetGain` |
| `anchor` | Two charges; each placed anchor lasts 15 s and hard-stops/bounces the opponent | `charges`, `projectiles[].type === 'anchor'`; victim `effects.anchor` on hit |

Each use has a distinct sound cue and toast in both viewports. Successful attacks increment the attacker's match `itemsLanded` and set victim `effects.hit`. Shielded attacks do not count as landed. Torpedoes visibly passing a nearby opponent increment that victim's `torpedoesDodged` and set `effects.dodged`. The leader's item table favours shield/turbo/anchor; the trailing table favours attacks. Ground crates are spaced 120–200 m with additional ramp crates.

## Inspection and debug hooks

`AR.inspect()` preserves its existing solo fields outside versus. While versus is active it returns `{ state, players, versus }`. Each player entry combines the rover snapshot with index, vehicle, maxOxygen, item, charges, crashes, distance, pearls, effects, respawn, out, catchup, startX, itemsUsed, torque, and topSpeed. `versus` includes phase, round, scores, mode, target, remaining, contacts, time, tally, totals, projectiles, and a rough `fps` counter. Snapshot copies do not mutate live state.

Only a URL with `?debug=1` exposes `AR.debug`:

| Hook | Contract |
| --- | --- |
| `giveItem(playerIndex, itemId)` | Grant a valid item; anchor receives two charges. Magnet becomes turbo outside Pearl Rush. Returns success boolean. |
| `placePlayer(playerIndex, values)` | Set finite `x`, `y`, `vx`, `vy`, `angle`, `oxygen`, and/or `pearls`; synchronize wheels/interpolation; clear crash, respawn, out, and effects. Omitted Y places the rover above terrain. Historical best distance remains unchanged. |
| `crashPlayer(playerIndex)` | Trigger a normal hull-crush respawn during RUNNING; returns success boolean. |
| `advance(seconds)` | Run fixed-step controller ticks, including phase transitions, clamped to 0–120 seconds per call; return inspection. Paused state remains frozen. This is simulation advancement, not a rendered-FPS measurement. |

Player indices are 0/P1 and 1/P2. Hooks are for local tests and manual debugging, not regular UI controls.

## Test entry points

`node docs/selftest.js`, `node tests/progression.test.js`, `node tests/edge.test.cjs`, and `node tests/browser.test.cjs` remain the solo regression checks. New checks are `node tests/contacts.test.cjs`, `node tests/versus-save-audio.test.cjs`, `node tests/versus-logic.test.cjs`, and `node tests/versus.test.cjs`. The logic suite runs the real `AR.Versus` controller/physics in a Node VM with a small mock DOM and presentation methods suppressed; it covers current-position catch-up/item selection, finish crossing order, tie replay and mode adjudication, shared pickups/sector regeneration, Pearl Rush depletion, survival drain/scarcity, respawn, and shields. The browser tests use the existing environment's `puppeteer-core` and Chromium binary (override the binary with `ABYSS_CHROME`), file URLs, temporary browser profiles, and a debugging pipe. These are test dependencies only. Versus screenshots are written to `/tmp/abyss-versus-*.png` for direct visual review; final outcomes/FPS belong in the task's validation record.
