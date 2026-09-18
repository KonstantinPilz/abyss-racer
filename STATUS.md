# Abyss Racer status

## Player suggestions — 3.4.0 complete (2026-09-17)

Interpreted “playable on three phones” as three friends sharing one online room. Rooms now admit a host and two guests, with independent vehicles, readiness, controls, full-screen views, item acknowledgements and reconnect state. All five modes support three racers, pairwise contacts, nearest-rival attacks, three-way scores/results and a separate saved trio rivalry. P3 uses purple artwork and labels. Extra or late guests receive an explanation without disturbing the room; incomplete connections expire and release their seat. Local Versus remains two-player. Snapshot protocol 4 supports three rovers within the existing 1,200-byte bound.

For the hotspot refresh report, brief stalls release held inputs after 400 ms while preserving healthy channels; five seconds of silence pauses play for recovery. Only broken links redial, reconnects retain each guest's seat, duplicate synchronization is harmless, and all missing guests must recover before play resumes. Phone sprite caches retain at most 24 MiB apart from a single oversized current sprite; evicted canvases release their backing memory, hidden pages clear caches, and unchanged viewport sizes avoid reallocations. Desktop caches retain a larger working set for split-screen performance. Short phone lobbies/results fit better and menu overscroll is contained. No new network service, endpoint, dependency or external asset was introduced.

Validation: `node tests/run-all.cjs` passed **all 22 suites serially**, including `docs/selftest.js`, `tests/progression.test.js`, every `tests/*.test.cjs`, and the render benchmark. New tests exercise three production room controllers through a deterministic PeerJS boundary with 20% state loss, independent inputs, admission limits, partial joins, brief/long stalls, repeated single-guest reconnects, manual pause, all five winners/results, save isolation and abandonment. The real two-browser PeerJS broker/reconnect suite also passed with zero console/page errors. Browser tests cover every player seat, actual multitouch/cancellation, HTMLCanvas fallback memory release, orientation changes and no unexpected navigation. All browser suites report zero console errors.

Personally inspected the 19 new phone screenshots covering title, lobby/loadout, racing, recovery and results at **393×428**, **393×455** and **844×390**, with DPR 3. Final retained sprite measurements were about **20.5–20.6 MiB** per phone, below the 24 MiB budget. The CPU-only desktop benchmark measured **7.04 fps** at 1440×900 @2, near the prior 7.30 fps baseline; physical-device performance and a 60 fps hardware target remain unverified. Evidence: `/tmp/abyss-trio-final-all.log`, `/tmp/abyss-phones-suites.json`, `/tmp/abyss-trio-browser.json`, per-suite logs, and `/tmp/abyss-fix2-fps-current.json`. All JS/CJS syntax and diff whitespace checks pass. `docs/config.js` and the noindex tag are unchanged. Player notes: [SUGGESTION_DONE.md](SUGGESTION_DONE.md).

Physical iPhones on the reported hotspot, Safari/Firefox and human audio listening remain unverified; the changes target connection churn, canvas memory pressure and accidental refresh gestures without claiming every Safari reload is resolved. Neither suggestion was skipped. No deployment performed; no work remains in flight.

## Round 5 — 3.3.0 complete (2026-09-16)

Implemented the corrected four-second Jellyfish Net (half torque/top speed, mild drag), the warned and shieldable Geyser item, and five-second Riptide with a persistent banner, wavy edges and purple touch pedals. Added Sunken City (collapsing bridges and currents), Whale Fall (rib ceilings, bone ramps, oxygen plankton and playful fish packs), and Thermal Springs (timed geysers, mud and ballast-assisted bubble elevators), including garage thumbnails and driving notes. Treasure Tug supports local and online play, 20/30/45-second carry targets, carrier slowdown, impact/item/crash drops, pickup lockout, midpoint reset, carry timers, steals and results.

Sharks now approach and telegraph a committed leading lunge, use swept chassis/wheel collisions, retreat for six seconds, and appear in Reef, Wreck and Abyss, with fish packs in Whale Fall. Solo bites cost 20 oxygen with a recoverable shove; Versus bites cause the normal crash/respawn unless shielded. Added the single-run five-encounter Shark attack achievement and garage note. Snapshot protocol 3 carries new effects, terrain clocks/collapses, environmental visuals, chest state, carry scores and shark phases; reliable events and reconnect synchronization restore persistent state. Guest physics remains disabled.

Validation: `node tests/run-all.cjs` passed **all 20 suites serially**, including 33 physics checks, 11 Round 5 mechanic checks, five lossy online sessions, the live PeerJS broker/reconnect suite, and browser coverage. The 40-second level-0 QA driver reaches **859.0 m / 884.8 m / 850.3 m** in City / Whale / Thermal with their mechanics active, without crashes or refills. A scripted 300 px/s rover is bitten in both first encounters; ballast jumps and hard braking dodge. The live broker test reported 241-byte current / 528-byte peak snapshots and zero console/page errors. After a final short-phone results CSS adjustment, the Round 5 browser suite passed again with zero console errors.

Personally inspected all **32 Round 5 screenshots**, covering each new map in solo/local Versus, garage cards, Geyser, Riptide, Treasure Tug HUD/results, online guest effects/maps/results and shark warning at **1280×720** and **844×390 @2**. Corrected overlapping awareness labels, the short-phone results footer and stage annotation placement. Short landscape garage cards use the existing scrolling panel. Completion details and screenshot inventory: [docs/ROUND5_DONE.txt](docs/ROUND5_DONE.txt). Evidence: `/tmp/abyss-phones-suites.json`, `/tmp/abyss-r5-browser.json`, `/tmp/r5-browser-final.log`, and per-suite logs.

Limitations: physical two-phone networks, Safari/Firefox, human audio listening and a 60 fps hardware target remain unverified. CPU-only 1440×900 @2 rendering measured 7.30 fps; the real-frame local driving test measured 25.5 fps. The optional Torpedo Tag bonus was not added. No deployment performed. `docs/config.js` and the noindex tag are unchanged; the pre-existing `.gitignore` modification was left untouched. All JS/CJS syntax checks and diff whitespace checks pass. No work remains in flight.

## Player suggestions — 3.2.0 complete

Implemented all eight requests: ice corridors preserve at least 250 px clearance; item crates refill independently for each diver every 2 seconds; Gravity Flip supplies six seconds of ceiling driving and safe upright recovery; Jet Drive supplies four seconds of directional air thrust; Kelp/Wreck offer one-way upper routes; kelp springs lift rovers; Reef/Abyss sharks warn before nonlethal lunges; gameplay prevents accidental selection while text fields remain editable; Bubble Battle adds a bounded arena with slow mounted cannons, free jumps, three hull hits, a 120-second limit, rounds and results. The new competitive features work locally and through the existing two-phone host. No suggestions skipped. Release is 3.2.0.

Validation: `node tests/run-all.cjs` passed every suite serially: `node docs/selftest.js`, `node tests/progression.test.js`, all 14 `tests/*.test.cjs` files, and the rendering benchmark (17 successful runner entries). This includes 27 physics checks, 13 progression/audio checks, 9 contacts, 23 existing Versus logic checks, 9 new world checks, 11 player controller checks, and the new online/browser feature suites. Packet-loss tests cover independent crate delivery, full-map reconnect, item activation, arena jumps/firing, actual three-hit elimination and exactly-once results without guest physics. The live PeerJS broker/reconnect suite passed with 196-byte average / 492-byte peak snapshots. All browser suites report zero console/page errors; no suggestion was submitted externally.

Personally inspected all twelve `/tmp/abyss-suggestions-*.png` screenshots: arena setup and gameplay, kelp/wreck upper routes, hot spring, ice, gravity, airborne jet, shark warning, and touch arena views at 393×428, 393×445 and 416×720. Controls fit and text fields remain selectable. CPU-only 1440×900 @2 rendering measured 7.28 fps, consistent with the prior hardware limitation; no claim of a 60 fps hardware target or physical Safari/iPhone verification. All JS/CJS syntax and diff whitespace checks pass; docs/config.js is unchanged and noindex remains present. Evidence: `/tmp/abyss-phones-suites.json`, per-suite logs, `/tmp/abyss-phones-browser-results.json`, and the inspected screenshots. Player notes: `SUGGESTION_DONE.md`. No deployment performed; no work remains in flight.

## Player suggestion — 3.1.0

Easier overtakes through stronger crate odds at 20/60 m behind and a held Turbo Current delivery after six continuous seconds at least 60 m behind with an empty slot. Deliveries are at least 12 seconds apart, require both racers to be active, preserve held items, and use existing item controls, physics and online snapshots. All three modes support the delivery in local and online Versus. How to play explains the mechanic; README and the interface contract document its rules.

Validation: `node tests/run-all.cjs` passed all 12 test suites and the rendering benchmark serially using Chromium headless shell 1243. Coverage includes 27 physics checks, 13 progression/audio checks, 9 contact checks and 23 Versus logic checks. New regressions cover gap-dependent item odds, both player indices, all modes, delivery timing/cooldown, held anchor charges, pause, interrupted gaps, respawn, round reset, ordinary Turbo expiry and stacking, and over 10 m of additional gap closure in a three-second driving comparison. A loopback guest receives and uses the delivery exactly once under 20% state loss without simulating physics. The real broker test also delivers Turbo to the guest and activates it with the touch Item pedal at 393×428, then passes reconnect/results/persistence. All browser suites report zero console errors; no suggestion was sent externally.

Personally inspected five help screenshots (desktop, phone, small phone, 393×428 and landscape), the local race screenshot, and both 393×428 phone screenshots showing delivery and Turbo activation. JS/CJS syntax checks and `git diff --check` pass; docs/config.js is unchanged and noindex remains present. Evidence: `/tmp/abyss-phones-suites.json`, `/tmp/abyss-phones-browser-results.json`, `/tmp/abyss-help-*.png`, `/tmp/abyss-phones-catchup-{short-phone,turbo-active}.png`, and `SUGGESTION_DONE.md`. CPU-only 1440×900 @2 rendering measured 7.38 fps, consistent with the existing hardware limitation. Physical Safari/iPhone testing remains unverified. No deployment performed.

## Player suggestion — 3.0.1

Added a short “Play on two phones” tip to How to play explaining room creation, the four-character join code, and the host's stage choice. Browser coverage checks the copy, scrolling, and dialog focus at 1280×720, 390×844, 320×568, and 844×390; all four screenshots have been inspected. The suggestions test now verifies the submitted version against AR.VERSION instead of a fixed release number.

Validation: `node tests/run-all.cjs` passed all 12 test suites and the rendering benchmark serially, including the live PeerJS broker and reconnect checks, with zero browser console or page errors. Changed scripts pass syntax checks and `git diff --check` passes. The noindex tag is present and docs/config.js is unchanged. Evidence: `/tmp/abyss-phones-suites.json`, `/tmp/abyss-help-{desktop,phone,small-phone,landscape}.png`, and `SUGGESTION_DONE.md`. No deployment performed.

Round 3 is complete: online play between two devices, host-authoritative physics, QR rooms, reconnect and configurable Suggestions. All 12 test suites plus the rendering benchmark passed serially; final targeted network checks also pass. Solo and local Versus remain offline-capable. See PHONES_DONE.txt for measurements, screenshots and limitations. No deployment performed.

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

## Versus round 2 — original implementation (historical)

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

## Versus feedback fixes (FIX2) — complete, with performance limitation

1. Ground passes ghost with hysteresis; the rear rover draws at 55% opacity. Above-rover landings and crushes stay physical. Catch-up adds up to 25% speed / 15% torque, fading between 60 and 20 m; grounded slipstream adds 10% within 8–40 m.
2. Torpedoes travel at 959 px/s and instantly cause “Torpedoed!” with the normal 2.5-second respawn, crash/item credit, a bubble explosion, shared flash/shake, and a distinct cue. Shields and an actual keyboard ballast dodge pass regression checks.
3. Race/Pearl Rush empty oxygen causes a 4-second blackout and 60% oxygen respawn. Blackouts are separate results statistics. Survival has three lives, tank HUD icons, and distance adjudication for simultaneous final losses. Crash oxygen penalties, siphon depletion, and same-step oxygen pickup rescue are covered.
4. Crisp uses fixed DPR clamped to [1,2] in both modes. Manual Performance uses 1× and fewer particles; settings.graphics persists via the title help panel and versus setup. No automatic downscaling remains. Terrain/decorations cache by chunk and zoom bucket; rigid art, pickups, labels and gradients use bounded immutable sprite caches with canvas fallback. Per-viewport culling, particle caps, and unchanged-text guards reduce drawing work.

Final validation: physics 27/27; progression/audio 13/13; contacts 9/9 (all 25 vehicle pairs, specified pass, hysteresis, 60 px landing); versus logic 19/19; versus save/audio; full versus Chromium integration; graphics; unchanged solo desktop/mobile integration and edge suites. All pass. JS/CJS syntax and git diff whitespace checks pass. Browser suites have zero application errors/warnings or external requests. The passing final versus suite uses 959 px/s torpedoes and the final immutable renderer caches.

Both 1440×900 CSS game canvases have exactly 2880×1800 backing at DPR 2. Final solo/versus screenshots personally inspected: sharp text, rover outlines and terrain edges, no clipped HUDs. Additional overtake/explosion/blackout captures inspected; rear opacity is also asserted from the real Canvas context. Survival tank and compact HUD screenshots inspected.

| Same headless workload, requested viewport 1440×900 @2× | Actual backing density | Rendered fps |
| --- | --- | --- |
| Old adaptive renderer | 0.9× at sample end | 11.38 |
| Old renderer forced to Crisp resolution | 2× | 4.33 |
| Final Crisp | 2× | 7.36 |
| Final explicit Performance | 1× | 25.82 |

Equal-resolution improvement: 69.9%. Measurements use actual rAF timestamps after warm-up, with both cameras/HUDs following a repeatable trajectory, on a 4-core ARM Neoverse-N1 server with GPU disabled. **60 fps was not achieved here; a 2019 MacBook Pro is unavailable, so its target frame rate is unverified.** Actual Safari/Firefox and human sound balance remain untested. Benchmark browsers ran serially.

Evidence: `FIX2_DONE.txt`, `/tmp/abyss-fix2-fps-*.json`, `/tmp/abyss-fix2-graphics.json`, `/tmp/abyss-fix2-{solo,versus,overtake,explosion,blackout}.png`, `/tmp/abyss-fix2-gameplay.done`, and the executable suites. README and tests/CONTRACT.md updated. No work remains in flight; no deployment performed.


## Round 3 — two phones and Suggestions complete

Online Versus adds a title entry, four-character rooms, a self-contained QR encoder,
copyable join links, per-device vehicles and readiness, host-selected match settings,
full-screen own HUD/camera, four touch pedals, portrait support and optional wake lock.
PeerJS 1.5.4 loads only on connecting, using the default public broker and the requested
STUN/TURN servers. Two channels separate unordered snapshots/input from reliable events.
The existing 120 Hz Versus loop owns every gameplay decision on the host; the guest
renders interpolated snapshots without stepping physics. Input edges are acknowledged,
held input expires after 400 ms, interpolation buffers 100 ms, and extrapolation ends
at 150 ms. Reconnection restores a paused world before resuming; failure after 15 seconds
abandons the unfinished match. Both browsers save completed tallies exactly once.

Measured loopback: 20.0 snapshots/s, 30.0 inputs/s, 182-byte average / 388-byte peak,
45 ms one-way delay with ±20 ms jitter and 20% state loss; mean echo RTT 95.5 ms.
Actual public PeerJS broker test passed: 184-byte average / 481-byte peak,
20.03 snapshots/s, host mean RTT 34.1 ms, guest mean RTT 32.4 ms.
Both channels reconnected after forced closure; guest received the torpedo hit/explosion;
both isolated browser contexts saved P1 1 / P2 0 / matches 1. Zero page or console errors.
These are data-channel RTTs between two pages on one host, not cross-network phone tests.

Suggestions reads docs/config.js, stays hidden until configured, submits the specified
FormData/no-cors Google Form fields, includes only the requested context, and enforces
a 20-second cooldown. A comments-only config stub is ready for the owner's endpoint.
Mocked submission tests verify field mapping, confirmation, focus and rate limiting.

All nine pre-existing regression suites, three new test suites and the rendering
benchmark passed via node tests/run-all.cjs, run serially. Final focused loopback and
real-broker tests passed after input timing/ACK and countdown UI refinements. One local
blackout assertion now captures setup/advance/state in one browser task to eliminate
an existing wall-clock race without relaxing its threshold. All 34 JS/CJS files parse;
local asset references, noindex metadata and diff whitespace checks pass.

Final host lobby/QR, guest join, both landscape race views (844×390 @2), and guest
portrait race view (390×844 @2) personally inspected. The lobby fits in landscape;
HUDs and pedals are accessible. Physical phones, Safari/Firefox, cross-network TURN,
and hardware frame-rate targets remain unverified. CPU-only 1440×900 @2 benchmark:
7.28 rendered fps. Documentation and executable protocol/QR tests are included.
Evidence: PHONES_DONE.txt and /tmp/abyss-phones-*. No deployment or work left in flight.
