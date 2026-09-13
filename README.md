# Abyss Racer

A complete underwater driving game made with plain HTML, CSS, Canvas 2D, and WebAudio. Drive a two-wheeled deep-sea rover across an endless seabed, collect pearls and oxygen, balance floaty jumps, and buy new vehicles, worlds, and upgrades. Local keyboard Versus adds a shared physics world, horizontal split-screen, three match modes, and nine competitive items. **Versus** adds two players on one keyboard, a shared ocean, split-screen cameras, and competitive items.

Open **[docs/index.html](docs/index.html)** directly in a browser. No installation, libraries, network access, server, or build step is required. GitHub Pages can serve the repository's `docs/` folder unchanged.

## Solo controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Throttle / pitch backward in air | Right arrow, D, or W | Hold right pedal |
| Brake, reverse / pitch forward in air | Left arrow, A, or S | Hold left pedal |
| Ballast burst | Space or Up arrow | Hold/tap ⇧ |
| Pause / resume | P or Escape | Pause button |
| Mute / unmute | M | Sound button in menus |

Ease off the gas over crests. Tap brake in the air to lower the nose before landing. Ballast pushes upward, uses 8 oxygen units, and must recharge. Holding its control fires another burst when the cooldown expires.

A hard dome impact against the seabed or ice ceiling immediately ends the run with **Hull crushed**. Gentle dome contact also crushes the hull when the chassis is inverted (its angle wrapped to ±180° exceeds 95° in magnitude) for more than 0.6 seconds of contact within any 1.5-second window. Brief brushes allow flip recovery. **Stranded** ends a run after more than 2.5 continuous seconds with the hull supported, both wheels off the ground, and horizontal speed below 15 px/s (1.5 m/s). An empty oxygen reserve also ends the run. Hidden tabs pause automatically and require Resume when you return.

Mouse, keyboard, and touch work in the menus. Garage tabs support arrow keys and Home/End; dialogs trap keyboard focus and close with Escape. Touch pedals support simultaneous pointers and release on cancellation or focus loss.

## Worlds and progression

1. **Coral Reef:** gentle hills, coral gardens, and surface light.
2. **Kelp Forest:** large swells and tall kelp.
3. **Shipwreck Graveyard:** broken hulls, exposed rocks, and more frequent ramps.
4. **Volcanic Vents:** volcanic ridges and thermal updrafts, with no active vents in the first 220 m (the first begins at 242 m). Base lift is halved; it scales gradually from ×1.0 at 220 m to ×1.5 at 1,500 m. Updrafts accelerate the chassis and both wheels equally, without adding pitch torque. The level-0 Reef Rover's first vent jump lasts 1.39 seconds with the QA driver below.
5. **Ice Shelf:** low-friction ground and a solid ice ceiling.
6. **Abyssal Trench:** steep terrain, anglerfish, and headlight navigation.

The Reef Rover, Crab Crawler, Torpedo Bike, Abyss Truck, and Manta Glider have different masses, wheelbases, tires, torque, buoyancy, oxygen reserves, and handling. Each vehicle owns six independent upgrade tracks: engine, propeller/thrust, suspension, tires, oxygen, and ballast. Each track has 12 purchasable levels with escalating costs.

Pearls are worth 5, golden pearls 100, and treasure chests 75. Oxygen tanks restore 60% of maximum capacity. Pearl arcs appear over actual ramp lips. A completed flip earns 100 pearls; airtime and every 100 m add bonuses. Distance and tricks earn XP. Every level grants 75 pearls, and selected levels unlock headlight colours or propeller trails. Eighteen achievements grant additional pearl rewards.

Run results show distance, run pearls, XP, airtime, personal records, and extra progression rewards. Retry starts the same loadout. **End dive & bank pearls** on the pause screen completes the current run. Closing a tab during a run does not bank that unfinished run.

## Versus

Choose **Versus** beside **Let's dive in** on the title screen. Versus needs a desktop keyboard; touch devices show **“Versus needs a keyboard”**. Each player chooses a vehicle, then both confirm to start. Mouse selection and **Dive together** also work. All five vehicles and all six stages are available regardless of solo unlocks. Every vehicle uses level 5 in all six upgrade tracks; its distinctive weight, handling, and oxygen reserve still apply.

| Action | Player 1 · top view | Player 2 · bottom view |
| --- | --- | --- |
| Brake / reverse | A | ← |
| Throttle | D | → |
| Ballast burst | W | ↑ |
| Use held item | S | ↓ |
| Previous / next vehicle in setup | A / D | ← / → |
| Confirm vehicle in setup | S | ↓ |
| Shared pause / resume | P or Escape | P or Escape |
| Rematch from match results | R | R |

Controls use physical `event.code` values, so keyboard layouts do not change the bindings. Gameplay arrows and Space never scroll the page. M toggles sound. Ballast still costs 8 oxygen and respects its cooldown. Pausing, losing focus, or hiding the tab pauses both players and clears held controls.

| Round mode | Rules |
| --- | --- |
| **Race** · default | First to 500, 1,000, or 2,000 m wins. Empty oxygen causes a 4-second blackout, then a respawn at the same position with 60% air; nobody is eliminated. |
| **Last Sub Standing** | Three lives, shown as O₂ tank icons. Oxygen drains 1.5× faster, with tanks at one-third the usual frequency. Empty oxygen costs a life: respawn after 4 seconds with 60% air, or eliminate on the final life. The last player with a life wins; simultaneous final losses compare distance. |
| **Pearl Rush** | Most pearls after 90 seconds wins. Pickups are shared: collecting one removes it for both players. Empty oxygen causes the same 4-second blackout and 60% air respawn. Scoring resumes afterward; the timer continues through blackouts. |

Choose one round, best of 3, or best of 5; the default is best of 3. A dead heat awards neither player a point and adds another round. Each round starts with **Round N — Dive!** and a frozen **3–2–1–GO** countdown. Round results show the winner, score, distances, crashes, blackouts, items used, and pearls for 3 seconds before the next countdown or match results. Match results include best distance, items landed, crashes, blackouts, and torpedoes dodged, with **Rematch**, **Change setup**, and **Title** actions.

Both rovers occupy the same physics world. Grounded side-by-side overlaps ghost through one another so overtaking stays easy; the trailing rover draws at 55% opacity during overlap. Ghosting persists until horizontal separation exceeds 1.2 rover lengths. Landings from above still resolve physically, including driving off a roof and dome crushes. Player 1 has an orange tag and keeps the vehicle colour; Player 2 has a teal tag and recoloured vehicle. The top and bottom views each have their own interpolated camera, speed zoom, HUD, item feedback, and off-screen opponent arrow showing the gap. A 2 px glowing divider separates them. Starting grid positions alternate each round; distance is measured from each player's own start. Crossings within the same fixed step are ordered by crossing fraction; rover contact shoves count toward the finish on that step.

A crash costs 2.5 seconds, then respawns the rover upright at the crash position, deducts 15% of maximum oxygen, and grants a 1.5-second shield against items and opponent contact. A fast wheel landing on the opponent's dome can cause **Hull crushed**. Empty air causes **OUT OF AIR · RESPAWN 4.0 s**, tracked as a separate **blackouts** statistic. Only the final Last Sub Standing life eliminates. A player at least 60 m behind receives a **catch-up current**: +25% top speed and +15% torque, fading linearly to zero by 20 m. Being 8–40 m directly behind the opponent, with both rovers near the ground, grants another +10% top speed and a **SLIPSTREAM** tag. Catch-up and item weighting use current progress, so being knocked backward matters.

### Items

Glowing **?** crates appear approximately every 120–200 m, with extra floating crates over ramps. There is one item slot; a crate is ignored while holding an item. The trailing player's item table favours attacks, while the leader gets more shields, turbo, and anchors. Every item has a distinct slot icon and synth cue, a shared toast, and visual feedback.

| Item | Effect |
| --- | --- |
| **Ink Cloud** | Covers the opponent's viewport for **3.5 s**, with a shrinking clear hole around their rover. |
| **Torpedo** | Launches forward or backward toward the opponent, follows the seabed with light vertical homing, and expires after **12 s**. An unshielded hit instantly crashes the victim (**Torpedoed!**), counts as an item landed and a crash, and starts the normal 2.5-second respawn. A bubble explosion, flash, shake in both viewports, and distinct sound mark the hit. Speed is 959 px/s, 10% above the fastest level-5 base speed; the temporary Turbo Current lasts 3 seconds. A shield blocks it; a ballast jump can dodge it. |
| **Jellyfish Net** | Reduces drive torque to **35%** and adds heavy drag for **4 s**, with clinging jellyfish. |
| **Oxygen Siphon** | Steals up to **25 oxygen**, capped by the opponent's reserve; the user's tank cannot exceed its maximum. A bubble stream marks the transfer. |
| **Riptide** | Swaps the opponent's throttle and brake for **4 s**, with a HUD warning and wavy view. |
| **Bubble Shield** | Blocks the next hostile item or projectile, or expires after **8 s**. |
| **Turbo Current** | Adds **60% torque** and **40% top speed** for **3 s**, with speed lines. |
| **Pearl Magnet** | In Pearl Rush, steals **30%** of the opponent's round pearls, rounded down. Replaced by Turbo Current in other modes. A blacked-out user cannot use items until respawning. |
| **Anchor Drop** | **Two uses per pickup**. Each drops an anchor behind the rover for **15 s**; an opponent hitting it takes a hard stop and bounce. |

## Architecture

All files are strict-mode plain scripts sharing the `AR` namespace; there are no ES modules or fetched assets.

| File | Responsibility |
| --- | --- |
| `docs/index.html` | Accessible DOM screens, HUD, controls, dialogs, metadata and inline favicon |
| `docs/style.css` | Dark theme, responsive layouts, safe-area spacing and motion preferences |
| `docs/versus.css` | Two-player setup, compact split-screen HUDs, countdowns and round/match overlays |
| `docs/data.js` | Six stage definitions, five vehicles, upgrade prices and derived stats |
| `docs/terrain.js` | Seeded layered noise, ramps, rounded collision rocks, ice ceilings, vents and bounded heightmap chunks |
| `docs/physics.js` | Chassis rigid body, two wheel bodies, spring/damper suspension, constrained travel, torque, friction, drag and contact resolution |
| `docs/contacts.js` | Versus wheel/dome circle contacts, shared impulses, friction, restitution and upper-wheel hull crushes |
| `docs/render.js` | DPR-aware Canvas rendering, independent viewport cameras, interpolation, culled decorations, lighting and solo/versus effects |
| `docs/save.js` | Versioned local save, migration/sanitization, purchases, records, achievements, XP, cosmetics and versus tally |
| `docs/audio.js` | Gesture-unlocked WebAudio, two mixed engine oscillators, item cues, bubbles, pickups, heartbeat, impact and UI synthesis |
| `docs/versus.js` | Setup, shared world, rounds, items, pickups, respawns, HUDs, results and debug inspection |
| `docs/game.js` | Solo state transitions, shared animation-loop integration, input routing, pickups, tricks, economy integration and DOM updates |
| `docs/selftest.js` / `selftest.html` | Shared Node/browser deterministic physics checks |

World coordinates use positive-down Y and 10 pixels per metre. Both modes simulate at **1/120 second**. Frame deltas are capped at 50 ms with a seven-step accumulator cap and previous/current render interpolation. Internal adaptive collision substeps constrain high-speed displacement. Suspension constraints, impulse contacts, zero terrain restitution, drag, and settled-body sleep prevent unstable landings and rest chatter. Versus resolves the two rovers' wheel/dome contacts after both fixed steps, with 0.3 impact restitution, friction, and no restitution at resting speeds. Chassis contact is tracked separately from wheel contact so an overturned solo rover cannot earn airborne rewards while resting on the ground.

`renderer.render(scene, camera, viewportRect)` clips and draws one viewport without advancing physics. Versus calls it twice with independent camera objects; `renderer.draw(scene, dt, alpha)` preserves the full-screen solo interface. Decoration culling and nearby terrain/pickup windows operate around both players.

**Graphics** is available in **Title → How to play** and **Versus setup**. **Crisp (default)** always uses `max(1, min(devicePixelRatio, 2))` backing pixels per CSS pixel in solo and versus. **Performance** explicitly uses 1× and fewer particles. The choice persists in `settings.graphics`; there is no automatic switching. Terrain fill/sand edges and background decorations are cached by chunk and zoom bucket; rigid hulls, wheels, pickups, labels, and gradients use bounded sprite caches. Each viewport culls independently and caps particles. HUD text updates only when its value changes. Short keyboard ballast taps queue until the next fixed step in both modes.

Terrain uses cached 1,024-pixel chunks sampled every 8 pixels; chunks outside the nearby window are pruned and deterministically regenerated if revisited. Physical rocks belong to the heightmap. Foreground/background plants and distant wreck art are decorative. Pickups and effects are pruned, gameplay particles are capped at 240, floating labels at 19, and transient sound voices at 28. Collected pickups never respawn when reversing.

The solo state machine is `TITLE → GARAGE → RUNNING ↔ PAUSED → GAMEOVER`, with retry and garage returns. Versus adds `SETUP → COUNTDOWN → RUNNING → ROUND_RESULT → COUNTDOWN / MATCH_RESULT`, with shared pause and setup/title returns. The animation loop cancels when the tab becomes hidden, clears controls, and resets timing before resuming.

## Saves

Progress is a version-2 JSON object stored under **`abyss-racer-save`** in `localStorage`: pearl balance, unlocks, selected loadout, per-vehicle upgrade levels, stage × vehicle records, lifetime totals, XP, achievements, sound/cosmetic settings, and `versus: { p1Wins, p2Wins, matches }`. Existing saves receive a zeroed versus tally. Completed matches update that tally once; competitive play does not award solo pearls, XP, unlocks, or records. The tally appears on versus setup. Version-1 records and legacy keys migrate safely. Unknown fields and invalid numbers are discarded; corrupt or unsupported saves fall back to defaults. If storage is blocked, gameplay continues with session-only progress and reports that saving is unavailable.

Purchases and completed runs save immediately. **Stats → Reset progress** requires an explicit in-game confirmation. Saves are local to the browser/origin; file URLs and hosted URLs may have separate storage, and private browsing may discard saves.

## Testing

Run the dependency-free tests from the project root:

```sh
node docs/selftest.js
node tests/progression.test.js
node tests/contacts.test.cjs
node tests/versus-save-audio.test.cjs
node tests/versus-logic.test.cjs
```

Or open **[docs/selftest.html](docs/selftest.html)**. It prints individual PASS/FAIL lines both on the page and in the console. The suite exercises about 60 simulated seconds on every stage, finite state, chassis/wheel terrain and ceiling penetration, starter progression, resting stability, all 30 stage × vehicle high-speed landings, upgrade handling, oxygen, bursts, collisions, seeded terrain and chunk pruning. Stress cases deliberately clear fatal crashes/refill oxygen to continue exercising the solver; separate tests preserve normal game-over behavior.

Fix round 1 adds 40-second runs on all six stages using a level-0 Reef Rover: throttle for 0.9 seconds, coast for 0.3 seconds, and replace throttle with a 0.15-second brake tap whenever airborne and pitched backward beyond 35°; repeat the tap if correction is still needed. These runs preserve crashes and oxygen consumption, with no refills. All six survive the full 40 seconds: Reef 977.5 m, Kelp 916.5 m, Wreck 758.8 m, Volcanic 815.9 m, Ice 886.1 m, and Abyss 791.0 m. Additional checks cover slow inverted ground/ceiling contact, the rolling contact window and recovery, the stranded fallback, vent onset/scaling/equal acceleration, and a completed backflip with a safe landing after a 4.24-second ramp jump. Air pitch control is 20% gentler across all vehicles; flip bonuses remain unchanged.

For a plain Chromium headless check:

```sh
chromium --headless=new --no-sandbox --disable-gpu --dump-dom "file://$PWD/docs/selftest.html"
```

`tests/edge.test.cjs` additionally checks controlled visibility events, large timestamp gaps, flip scoring, grounded airtime suppression, natural oxygen/crash endings, a motionless inverted dome rest ending in the real game-over screen after 0.608 simulated seconds, game-over audio silence, and mute persistence. Headless shell keeps tabs visible, so the visibility test explicitly simulates the browser event.

`tests/browser.test.cjs` contains the full desktop/mobile integration smoke test used during development. It uses the environment's existing Puppeteer installation and an existing Chromium binary; those are test tooling only and are **not game dependencies**. Set `ABYSS_CHROME` to choose another installed browser and adjust the Puppeteer require path for a different environment. Tests cover navigation, keyboard driving/ballast/pause, real touch input, purchases, per-vehicle upgrades, reload persistence, reset confirmation, resizing, and application console/network checks. The browser suites use file URLs, an isolated temporary browser profile, and a debugging pipe, requiring no listening port.

Run the browser suites from the project root:

```sh
node tests/edge.test.cjs
node tests/browser.test.cjs
node tests/versus.test.cjs
node tests/graphics.test.cjs
node tests/render-benchmark.cjs after-crisp
```

`tests/contacts.test.cjs` checks all 25 vehicle pairings ghosting on the ground, the specified 380-versus-200 px/s pass within 2 seconds, overlap hysteresis, 60 px landings, dome crushes, and resting stability. `tests/versus-logic.test.cjs` covers catch-up/slipstream, shared pickups and finish ordering, lethal torpedoes with shield/dodge defenses, blackouts in Race/Pearl Rush, three survival lives and simultaneous final-life distance decisions, respawn costs, and shields. `tests/versus-save-audio.test.cjs` covers tally/save isolation and all item/explosion audio cues. `tests/versus.test.cjs` exercises keyboard play, items, modes, respawns, results, and persistence in Chromium. `tests/graphics.test.cjs` verifies backing sizes in both modes at DPR 2, the DPR floor/cap, manual Graphics persistence, and immunity to slow-frame downscaling, and captures `/tmp/abyss-fix2-solo.png` and `/tmp/abyss-fix2-versus.png` at 1440×900 @2×. These additions preserve the solo suites.

`tests/render-benchmark.cjs` measures rendered animation frames over eight seconds after three seconds of warm-up, profiling renderer methods while both cameras follow a repeatable trajectory. Run it alone: concurrent Chromium tests compete for raster time. Its `AR.debug` fixture controls positions; simulation tick counters are never reported as rendered fps. JSON output goes to `/tmp/abyss-fix2-fps-<label>.json`.

For local debugging, open `docs/index.html?debug=1`. `AR.inspect()` remains read-only and includes `players[]` and `versus` during competitive play. Only the debug query exposes `AR.debug.giveItem(playerIndex, itemId)`, `placePlayer(playerIndex, values)`, `crashPlayer(playerIndex)`, `setOxygen(playerIndex, value)`, `fireTorpedo(playerIndex)`, and `advance(seconds)`. Player indices are **0 for P1** and **1 for P2**; item IDs are `ink`, `torpedo`, `net`, `siphon`, `riptide`, `shield`, `turbo`, `magnet`, and `anchor`. `placePlayer` accepts `x`, `y`, `angle`, `vx`, `vy`, `oxygen`, and `pearls`; `advance` runs up to 120 seconds of fixed steps per call. Runtime mode IDs are `race`, `survival`, and `pearl`. See [tests/CONTRACT.md](tests/CONTRACT.md) for the script interfaces.

Manual checks: drive over a crest and release throttle; land a ballast jump; try ice traction and volcanic updrafts; flip and counter-pitch; collect every pickup type; compare upgraded handling; mute and resume; rotate a phone; background and restore the tab. Inspect low-oxygen pulse/heartbeat and the summary's extra reward line.

Validation completed after fix round 1: 27/27 physics checks in Node and Chromium; 13/13 progression/audio suites; desktop/mobile integration and targeted browser edge checks; syntax checks on every JS/CJS file. Settled motion was 0 pixels, maximum tested collision penetration was 0.017 pixels, and beginner controls travelled 1,599 m in 60 seconds.

Versus feedback fixes (FIX2): **all nine regression suites pass**, including 27 physics checks, 13 progression/audio checks, 9 contact checks, 19 versus controller checks, save/audio, full versus integration, graphics, and unchanged solo browser/edge suites. The specified ground pass reached a 302.8 px lead within 2 seconds. Solo and versus both verify **2880×1800 backing at 1440×900 CSS / DPR 2**; their screenshots were personally inspected and are sharp and unclipped. Graphics tests also verify overlap alpha, both modes resisting slow-frame downscaling, reduced Performance particles, and settings persistence. Browser suites report zero application errors/warnings or external requests.

At equal **1440×900 @2×**, the repeatable software Chromium benchmark improved from **4.33 to 7.36 rendered fps**. Manual Performance measured **25.82 fps at 1×**. The old adaptive renderer measured 11.38 fps while dropping to 0.9×; that is not an equal-quality comparison. This ARM64 server did **not** reach 60 fps. A 2019 MacBook Pro is unavailable, so the requested hardware target remains unverified. Raw timings, methodology, screenshots, and limitations are recorded in `FIX2_DONE.txt`.

Chrome/Chromium desktop and emulated mobile are tested. The implementation uses broadly supported browser APIs and includes Safari's prefixed AudioContext fallback. Firefox, Safari, physical-device multitouch, and audible sound balance still need testing on those actual browsers/devices.

Built by Konstantin's AI agents.
