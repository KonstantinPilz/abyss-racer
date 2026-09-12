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
