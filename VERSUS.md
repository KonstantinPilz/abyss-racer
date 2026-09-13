# Abyss Racer — round 2: local two-player VERSUS mode

You built this game (see README.md, STATUS.md, docs/). It's live and the single-player mode works well. Now add a **two-players-on-one-keyboard competitive mode**. Feel free to restructure files significantly (e.g. split game.js into solo/versus/shared modules, make the renderer camera-parametric) — but the single-player experience, saves, and existing tests must keep working. No libraries, no build step, no network, plain scripts.

## The mode
**"Versus"** button on the title screen (next to "Let's dive in"). Desktop/keyboard only — on touch devices show a note "Versus needs a keyboard". 

**One shared physics world, split-screen.** Both rovers live in the same terrain and the same simulation, so they can physically bump, ram, and land on each other. Screen is split horizontally: top half follows Player 1, bottom half follows Player 2 (2 px glowing divider). Each half has its own camera (look-ahead, speed zoom) and its own compact HUD (distance, oxygen bar, item slot, pearls, crashes). Refactor render.js so `render(scene, camera, viewportRect)` can be called twice per frame with clipping; ambient particles/fish per viewport are fine to share. Keep 60 fps on a normal laptop: cull off-screen decorations per viewport.

**Controls (fixed, shown on the setup screen and in the HUD):**
- Player 1 (left side of keyboard): A = brake/reverse, D = throttle, W = ballast burst, S = use item. 
- Player 2 (right side): ← brake, → throttle, ↑ ballast, ↓ use item.
- Esc/P pause (either player), R on the results screen = rematch.
Use `event.code` so layouts don't matter. Prevent default on arrows/space so the page never scrolls.

**Rover–rover collision.** Approximate each rover by its two wheel circles plus the dome circle; resolve circle-circle contacts between the two rovers with impulses (with restitution ~0.3 and friction) so ramming from behind shoves the leader, landing on top of the opponent bounces you off them, and a dome-to-wheel hit from above counts as a "hull crushed" crash for the one whose dome got hit if the relative speed exceeds the existing threshold. Stability matters: no tunnelling when both are at 400 px/s, no jitter when they rest against each other.

**Crashing in versus is not the end.** A crashed player respawns after 2.5 s (with a countdown in their viewport) upright at the position of the crash, with 15% oxygen deducted and a 1.5 s bubble shield so the opponent can't spawn-camp. Crash count shows in the HUD and results. Oxygen still matters: if a player's oxygen hits zero they are out for the round (unless in Pearl Rush where they just stop scoring); if both are out, the round ends.

**Match modes (choose on setup):**
1. **Race** — first to the target distance (500 / 1000 / 2000 m, selectable) wins the round. Default.
2. **Last Sub Standing** — no distance target; oxygen drains 1.5× faster and tanks are scarcer; last player with oxygen wins.
3. **Pearl Rush** — 90 s timer; most pearls at the end wins. Pearls are shared: first to grab gets it.
Rounds: best of 3 (selectable 1/3/5). Round-transition overlay (3 s) shows the round score, then "Round N — Dive!" countdown 3-2-1-GO with both rovers frozen.

**Items (the competitive fun).** Item crates ("?" bubbles in a glowing ring) sit on the track roughly every 120–200 m plus a few floating over ramps. Driving through one gives the player a random item (one slot; picking up a second while holding is ignored). Trailing player (by distance) gets a stronger item table (Mario Kart rubber-banding); leader gets more defensive/utility. Press S / ↓ to use. Items:
- **Ink Cloud** — opponent's viewport fills with spreading black ink for 3.5 s, with a small clear hole around their rover that shrinks. Big visual, drawn in their viewport only.
- **Torpedo** — launches along the seabed toward the opponent (forward or backward automatically, homing lightly, max 12 s life, visible in both viewports with a bubble trail). On hit: strong impulse away + spin; if the opponent is airborne it's usually a crash. Can be blocked by a shield or dodged with a well-timed ballast burst (jump over it).
- **Jellyfish Net** — opponent tangled: throttle ×0.35 and heavy drag for 4 s; jellyfish drawn clinging to their rover.
- **Oxygen Siphon** — steals 25 oxygen from the opponent (visual: a bubble stream flowing from their viewport into yours), capped to what they have.
- **Riptide** — opponent's throttle/brake are swapped for 4 s; their HUD shows "RIPTIDE! controls reversed" and a wavy screen distortion.
- **Bubble Shield** — user is immune to the next item / torpedo for up to 8 s; visible bubble sphere.
- **Turbo Current** — user gets +60% torque and +40% top speed for 3 s with a speed-line effect.
- **Pearl Magnet** (Pearl Rush only; elsewhere replaced by Turbo) — steals 30% of the opponent's round pearls.
- **Anchor Drop** — drops a heavy anchor behind you that stays on the terrain for 15 s; the opponent hitting it gets a hard stop/bounce (like a banana). Two per pickup.
All items need distinct icons in the HUD slot, a sound, a toast in both viewports ("P2 hit P1 with a Torpedo!"), and clear feedback for the victim.

**Fairness:** in versus, all five vehicles are available to both players regardless of single-player unlocks, and every vehicle uses a fixed "tournament tune" (equivalent to level 5 in every upgrade track) so solo progress doesn't decide matches. Each player picks their vehicle on the setup screen (P1 with A/D + S to confirm, P2 with ←/→ + ↓ to confirm, mouse also works). Stage is chosen together (all six available). Same seed for both players (they're in the same world anyway).

**Rubber-banding/slipstream:** a player more than 80 m behind gets +12% top speed ("catch-up current", shown as a small arrow icon) until within 30 m.

**Opponent awareness in each viewport:** if the opponent is off-screen, show an arrow at the viewport edge with the gap in metres ("P2 ▲ 64 m ahead"). If on-screen, draw them normally (they're in the same world) with a small P1/P2 tag above the dome. Rover colours: P1 keeps the vehicle colour with an orange tag; P2 gets a teal/blue recolour of the same vehicle so they're distinguishable at a glance.

**Results.** Round results overlay: winner, distances, crashes, items used, pearls; then next round. Match results screen: big "PLAYER 1 WINS" (or 2), round scores, per-player stats (best distance, items landed, crashes, torpedoes dodged), "Rematch" (R), "Change setup", "Title". Track a persistent versus tally in the save (`versus: { p1Wins, p2Wins, matches }`) shown on the setup screen.

**Audio:** items get distinct synth cues; engine hum should mix both rovers (two oscillators). Keep the autoplay gate.

**Pausing/visibility:** shared pause; tab hidden pauses; same fixed-timestep loop.

## Quality bar
- Zero console errors/warnings. No regressions in solo mode: run the existing tests (`node docs/selftest.js`, `node tests/progression.test.js`, `node tests/edge.test.cjs`, `node tests/browser.test.cjs`) and they must stay green.
- Add `tests/versus.test.cjs` (headless Chromium via the same puppeteer-core path): start a Race match with both players on keyboard, simulate both key sets simultaneously for ~20 s, assert both rovers progress, assert a rover-rover collision at least once in a scripted head-on test (spawn them 40 px apart and drive toward each other — expose enough via `AR.inspect()` e.g. `players[]` with x/y/angle/oxygen/item/crashes and `versus.round/scores/mode`), assert each item can be granted via a debug hook (`AR.debug.giveItem(playerIndex, itemId)` — only when `?debug=1`) and used with a visible effect (state flag) on the other player, assert respawn after a crash within 3 s, assert the round ends when a player hits the target, and assert the match ends and the tally increments. Take screenshots of setup, mid-race, an ink cloud, a torpedo in flight, round results, and match results to `/tmp/abyss-versus-*.png` and *look at them* (you have the images) to check for overlapping HUD text or clipping.
- Keep the physics smooth: fixed step, interpolation for both cameras.
- Update README.md (controls table for versus, modes, items) and STATUS.md. Write VERSUS_DONE.txt at the end with what you built, what you tested, measured fps in headless (rough), and known limitations.

Have fun with it — this should feel like a party game. Thank you!
