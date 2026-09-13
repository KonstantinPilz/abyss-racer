# Abyss Racer status

Completed. Play `docs/index.html` directly or serve `docs/` with GitHub Pages. No build step, libraries, network assets, or deployment are required.

1. Physics/data/terrain: complete. Node and Chromium PASS 15/15; six 60-second stage simulations; all 30 vehicle/stage landing combinations; zero settled rest motion; maximum penetration 0.037 px. Full throttle exceeds 200 m before first crash; beginner controls survive 1,599 m in 60 seconds.
2. Rendering: complete. All 30 stage/vehicle combinations checked. Chassis/dome/suspension art aligned to physics; cosmetic lights and paused-frame stability verified; native DPR 3 checked.
3. Save/audio: complete. PASS 13/13 regression suites including migration/corruption, purchases, records, achievements, XP, reset-write failure, autoplay gating, mute, pause and interruption resume.
4. Browser integration: PASS desktop/mobile file:// flows, keyboard driving, ballast, pause/end/retry, purchases/upgrades, reload, reset confirmation, real touch pedal, responsive orientation changes and a 320×568 phone. No application console errors/warnings or external requests.
5. Browser edge tests: PASS controlled visibility hidden/resume, ten-minute timestamp jump clamp, flip scoring, grounded airtime suppression, natural oxygen/hull deaths, game-over engine silence and mute persistence.
6. Visual review: final desktop title/garage/run/summary and portrait/landscape/small-phone screenshots inspected. README.md and DONE.txt complete. Approximately 128 KB of JavaScript including selftest.

Evidence: `tests/physics.done`, `tests/render.done`, `tests/progression.done`, `tests/browser.done`, `tests/edge.done`; executable tests in `docs/selftest.js`, `tests/progression.test.js`, `tests/browser.test.cjs`, `tests/edge.test.cjs`.

Remaining platform checks: actual Firefox/Safari, physical multitouch devices, human audio listening. Headless visibility is simulated explicitly. No work remains in flight; completion monitoring ended after all artifacts passed. No deployment performed.

## Fix round 1

Complete. Gentle inverted dome contact now causes Hull crushed after more than 0.6 cumulative seconds in a rolling 1.5-second window; hard impacts remain immediately fatal. A stationary hull wedge with both wheels unsupported causes Stranded after 2.5 seconds. Brief contact can recover. Vents start after 220 m, use half the original base lift, scale to ×1.5 by 1,500 m, and accelerate chassis/wheels equally. Air control is 20% gentler; full backflips and bonuses remain possible.

Level-0 Reef Rover, 40 simulated seconds with the QA pulse/brake driver, no crashes or refills: Reef **977.5 m**, Kelp **916.5 m**, Wreck **758.8 m**, Volcanic **815.9 m**, Ice **886.1 m**, Abyss **791.0 m**. First volcanic vent airtime: **1.392 s**. Gentle dome-rest death: **0.608 s** at 120 Hz; stranded death: **2.508 s**. Ramp backflip and upright landing: **4.242 s** hang.

Validation: **27/27** shared physics checks in Node and real headless Chromium; **13/13** progression/audio suites; all JS/CJS syntax checks; both browser integration and edge suites pass over port-free file://. No app console errors/warnings or external requests. Existing filenames and all QA fields in AR.inspect are preserved. Details: `FIX1_DONE.txt`. No work remains in flight.

## Versus round 2

Implemented and validated locally. Title/setup provides keyboard-only local Versus, all five vehicles at a fixed level-5 tune, all six stages, Race (500/1000/2000 m), Last Sub Standing, Pearl Rush (90 s), and best-of-1/3/5. One world runs both rovers at 120 Hz; clipped horizontal viewports have independent interpolated cameras and native-resolution HUDs/player tags/gap arrows.

Nine items include distinct icons/audio, attack feedback, shared toasts, torpedo flight/dodge/shield interactions, and two-charge anchors. Shared pickups, current-position catch-up, respawns after 2.5 s with 15% maximum oxygen cost and 1.5 s spawn protection, round transitions, results/rematch, and persistent versus tally are complete. Empty Pearl Rush players retain driving/held-item use and engine audio but stop collecting/scoring. Finish ordering includes shared-contact shoves and crossing fractions. Solo saves, unlocks, progression, and physics remain compatible; short ballast taps now queue to the next fixed step.

Validation on final code:

1. `node docs/selftest.js`: 27/27 PASS.
2. `node tests/progression.test.js`: 13/13 PASS.
3. `node tests/edge.test.cjs`: PASS.
4. `node tests/browser.test.cjs`: PASS unchanged, including mobile/touch.
5. `node tests/contacts.test.cjs`: 7/7 PASS; all 25 vehicle pairs at opposing 400 px/s; no tunnelling; zero settled contact drift.
6. `node tests/versus-logic.test.cjs`: 12/12 PASS, including shared-contact finish crossing, shared pickups, catch-up, timer/depletion/tie rules and spawn shields.
7. `node tests/versus-save-audio.test.cjs`: PASS; tally sanitization/isolation, two engines, autoplay/mute/pause, all nine cues.
8. `node tests/versus.test.cjs`: PASS; both keyboard sets for 20 s (534.1 / 535.4 m), all items, timed ballast torpedo dodge, respawn, rounds/matches, all modes, tally reload, touch note, debug gate, zero app console errors/warnings or external requests.
9. JS/CJS syntax and whitespace checks: PASS. Seven final gameplay/UI screenshots plus native-label/solo-return and existing mobile screenshots personally inspected; no HUD overlap/clipping.

Performance limitation: CPU-only headless Chromium at 1440×900 measured 39.3 fps over the final suite's 5-second sample and 47.4 fps in a separate steady sample. Adaptive ocean rendering reached half density; HUD and awareness labels remain native. This improves the initial ~18 fps, but 60 fps on a normal laptop remains unverified. Firefox/Safari and human audio listening also remain untested. Run wall-clock browser suites serially on this CPU-constrained host; concurrent screenshot delays can move the rover across an oxygen pickup between a test's baseline and ballast assertion.

Evidence: `tests/versus.done`, existing `tests/browser.done` / `tests/edge.done`, executable suites above, `/tmp/abyss-versus-*.png`, and `VERSUS_DONE.txt`. README and interface contract updated. No deployment performed; no work remains in flight.
