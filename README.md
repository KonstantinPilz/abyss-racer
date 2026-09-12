# Abyss Racer

A complete underwater driving game made with plain HTML, CSS, Canvas 2D, and WebAudio. Drive a two-wheeled deep-sea rover across an endless seabed, collect pearls and oxygen, balance floaty jumps, and buy new vehicles, worlds, and upgrades.

Open **[docs/index.html](docs/index.html)** directly in a browser. No installation, libraries, network access, server, or build step is required. GitHub Pages can serve the repository's `docs/` folder unchanged.

## Controls

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

## Architecture

All files are strict-mode plain scripts sharing the `AR` namespace; there are no ES modules or fetched assets.

| File | Responsibility |
| --- | --- |
| `docs/index.html` | Accessible DOM screens, HUD, controls, dialogs, metadata and inline favicon |
| `docs/style.css` | Dark theme, responsive layouts, safe-area spacing and motion preferences |
| `docs/data.js` | Six stage definitions, five vehicles, upgrade prices and derived stats |
| `docs/terrain.js` | Seeded layered noise, ramps, rounded collision rocks, ice ceilings, vents and bounded heightmap chunks |
| `docs/physics.js` | Chassis rigid body, two wheel bodies, spring/damper suspension, constrained travel, torque, friction, drag and contact resolution |
| `docs/render.js` | DPR-aware Canvas rendering, camera/interpolation, parallax, vehicle art, decorations, lighting and effects |
| `docs/save.js` | Versioned local save, migration/sanitization, purchases, records, achievements, XP and cosmetics |
| `docs/audio.js` | Gesture-unlocked WebAudio engine, bubbles, pickups, heartbeat, impact and UI synthesis |
| `docs/game.js` | Explicit state transitions, fixed-step loop, inputs, pickups, tricks, economy integration and DOM updates |
| `docs/selftest.js` / `selftest.html` | Shared Node/browser deterministic physics checks |

World coordinates use positive-down Y and 10 pixels per metre. The simulation advances at **1/120 second**. Frame deltas are capped at 50 ms with a seven-step accumulator cap and previous/current render interpolation. Internal adaptive collision substeps constrain high-speed displacement. Suspension constraints, impulse contacts, zero restitution, drag, and settled-body sleep prevent unstable landings and rest chatter. Chassis contact is tracked separately from wheel contact so an overturned rover cannot earn airborne rewards while resting on the ground.

Terrain uses cached 1,024-pixel chunks sampled every 8 pixels; chunks outside the nearby window are pruned and deterministically regenerated if revisited. Physical rocks belong to the heightmap. Foreground/background plants and distant wreck art are decorative. Pickups and effects are pruned, gameplay particles are capped at 240, floating labels at 19, and transient sound voices at 28. Collected pickups never respawn when reversing.

The state machine is `TITLE → GARAGE → RUNNING ↔ PAUSED → GAMEOVER`, with retry and garage returns. The animation loop cancels when the tab becomes hidden, clears controls, and resets timing before resuming.

## Saves

Progress is a version-2 JSON object stored under **`abyss-racer-save`** in `localStorage`: pearl balance, unlocks, selected loadout, per-vehicle upgrade levels, stage × vehicle records, lifetime totals, XP, achievements, and sound/cosmetic settings. Version-1 records and legacy keys migrate safely. Unknown fields and invalid numbers are discarded; corrupt or unsupported saves fall back to defaults. If storage is blocked, gameplay continues with session-only progress and reports that saving is unavailable.

Purchases and completed runs save immediately. **Stats → Reset progress** requires an explicit in-game confirmation. Saves are local to the browser/origin; file URLs and hosted URLs may have separate storage, and private browsing may discard saves.

## Testing

Run the dependency-free tests from the project root:

```sh
node docs/selftest.js
node tests/progression.test.js
```

Or open **[docs/selftest.html](docs/selftest.html)**. It prints individual PASS/FAIL lines both on the page and in the console. The suite exercises about 60 simulated seconds on every stage, finite state, chassis/wheel terrain and ceiling penetration, starter progression, resting stability, all 30 stage × vehicle high-speed landings, upgrade handling, oxygen, bursts, collisions, seeded terrain and chunk pruning. Stress cases deliberately clear fatal crashes/refill oxygen to continue exercising the solver; separate tests preserve normal game-over behavior.

Fix round 1 adds 40-second runs on all six stages using a level-0 Reef Rover: throttle for 0.9 seconds, coast for 0.3 seconds, and replace throttle with a 0.15-second brake tap whenever airborne and pitched backward beyond 35°; repeat the tap if correction is still needed. These runs preserve crashes and oxygen consumption, with no refills. All six survive the full 40 seconds: Reef 977.5 m, Kelp 916.5 m, Wreck 758.8 m, Volcanic 815.9 m, Ice 886.1 m, and Abyss 791.0 m. Additional checks cover slow inverted ground/ceiling contact, the rolling contact window and recovery, the stranded fallback, vent onset/scaling/equal acceleration, and a completed backflip with a safe landing after a 4.24-second ramp jump. Air pitch control is 20% gentler across all vehicles; flip bonuses remain unchanged.

For a plain Chromium headless check:

```sh
chromium --headless=new --no-sandbox --disable-gpu --dump-dom "file://$PWD/docs/selftest.html"
```

`tests/edge.test.cjs` additionally checks controlled visibility events, large timestamp gaps, flip scoring, grounded airtime suppression, natural oxygen/crash endings, a motionless inverted dome rest ending in the real game-over screen after 0.608 simulated seconds, game-over audio silence, and mute persistence. Headless shell keeps tabs visible, so the visibility test explicitly simulates the browser event.

`tests/browser.test.cjs` contains the full desktop/mobile integration smoke test used during development. It uses the environment's existing Puppeteer installation and an existing Chromium binary; those are test tooling only and are **not game dependencies**. Set `ABYSS_CHROME` to choose another installed browser and adjust the Puppeteer require path for a different environment. Tests cover navigation, keyboard driving/ballast/pause, real touch input, purchases, per-vehicle upgrades, reload persistence, reset confirmation, resizing, and application console/network checks. Both browser suites use file URLs, an isolated temporary browser profile, and a debugging pipe, requiring no listening port.

Manual checks: drive over a crest and release throttle; land a ballast jump; try ice traction and volcanic updrafts; flip and counter-pitch; collect every pickup type; compare upgraded handling; mute and resume; rotate a phone; background and restore the tab. Inspect low-oxygen pulse/heartbeat and the summary's extra reward line.

Validation completed after fix round 1: 27/27 physics checks in Node and Chromium; 13/13 progression/audio suites; desktop/mobile integration and targeted browser edge checks; syntax checks on every JS/CJS file. Settled motion was 0 pixels, maximum tested collision penetration was 0.017 pixels, and beginner controls travelled 1,599 m in 60 seconds.

Chrome/Chromium desktop and emulated mobile are tested. The implementation uses broadly supported browser APIs and includes Safari's prefixed AudioContext fallback. Firefox, Safari, physical-device multitouch, and audible sound balance still need testing on those actual browsers/devices.

Built by Konstantin's AI agents.
