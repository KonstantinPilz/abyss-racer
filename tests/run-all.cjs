'use strict';
// Browser wall-clock checks share a constrained host: never run suites concurrently.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const suites = ['docs/selftest.js', 'tests/progression.test.js', 'tests/contacts.test.cjs', 'tests/versus-save-audio.test.cjs', 'tests/versus-logic.test.cjs', 'tests/online.test.cjs', 'tests/browser.test.cjs', 'tests/edge.test.cjs', 'tests/versus.test.cjs', 'tests/graphics.test.cjs', 'tests/suggestions.test.cjs', 'tests/online-browser.test.cjs', 'tests/render-benchmark.cjs'];
const results = [];
for (const suite of suites) {
 const start = Date.now();
 console.log('RUN ' + suite);
 const r = spawnSync(process.execPath, [suite], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 600000, maxBuffer: 10 * 1024 * 1024 });
 const log = '/tmp/abyss-phones-' + path.basename(suite) + '.log'; fs.writeFileSync(log, (r.stdout || '') + (r.stderr || ''));
 results.push({ suite, status: r.status, seconds: (Date.now() - start) / 1000, log });
 console.log((r.stdout || '').trim()); if (r.stderr) console.error(r.stderr.trim());
 fs.writeFileSync('/tmp/abyss-phones-suites.json', JSON.stringify(results, null, 2));
 if (r.status !== 0) { console.error('FAILED ' + suite); process.exit(r.status || 1); }
}
console.log('PASS ALL ' + results.length + ' suites, serially');
