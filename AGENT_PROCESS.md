# How this game gets built and maintained (for agents)

- Code lives in `docs/` (GitHub Pages serves it from `main`). No build step, no dependencies except PeerJS loaded on demand for online play.
- Authoring is delegated to GPT-6 Astra via `codex exec` (see `run_codex*.sh` for the pattern: brief in a .md file, sandbox workspace-write, network off unless needed). Claude does QA and publishes.
- QA: run suites serially (`node docs/selftest.js`, `node tests/progression.test.js`, `node tests/*.test.cjs`). Independent playthrough scripts are in `tests/qa/` (puppeteer-core from `~/projects/mcp-chromium-arm64/node_modules`, chrome-headless-shell 1243; serve `docs/` on a free local port — 8765 is taken). Use `?debug=1` and `AR.debug.*` hooks plus `AR.inspect()` for deterministic checks; use `AR.debug.advance(seconds)` instead of wall-clock waits.
- Publish: commit, `git push`, wait until the live site serves the new content, verify the noindex meta tag is still present.
- Suggestions pipeline: players post to an ntfy.sh topic from the in-game box; `suggestions/watch.py` (cron, every 10 min) logs them, emails Konstantin a receipt, and runs `suggestions/implement.sh`, which briefs GPT-6 from `suggestions/BRIEF_TEMPLATE.md`, gates on the suites and allowed paths, pushes, and emails a summary. State: `suggestions/inbox.jsonl`, `suggestions/state.json`, logs in `suggestions/`.
