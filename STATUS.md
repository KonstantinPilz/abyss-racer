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
