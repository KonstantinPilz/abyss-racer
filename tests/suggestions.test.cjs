'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const puppeteer = require('/home/ubuntu/projects/mcp-chromium-arm64/node_modules/puppeteer-core');
const executablePath = process.env.ABYSS_CHROME || '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell';
let browser;
(async () => {
 browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
 const page = await browser.newPage(), errors = [], requests = [];
 page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
 page.on('request', r => { if (r.url().startsWith('https:')) requests.push(r.url()); });
 const url = 'file://' + path.resolve(__dirname, '../docs/index.html');
 await page.goto(url); assert.equal(await page.$eval('#title-suggestions', e => e.hidden), false); assert.equal(await page.$('script[src*="peerjs"]'), null);
 console.log('PASS Configured suggestions button is visible, with no requests or console errors');
 await page.evaluateOnNewDocument(() => {
  window.AR = { CONFIG: { suggestionsNtfyTopic: 'abyss-racer-ideas-test0', suggestionsMaxLength: 600 } };
  window.posts = []; window.fetch = async (url, options) => { window.posts.push({ url, method: options.method, headers: options.headers, body: options.body }); return { ok: true, status: 200 }; };
  const original = Date.now; window.elapsed = 0; Date.now = () => original() + window.elapsed;
 });
 await page.reload(); assert.equal(await page.$eval('#title-suggestions', e => e.hidden), false);
 await page.click('#title-suggestions'); assert.equal(await page.evaluate(() => document.activeElement.id), 'suggestions-text');
 await page.type('#suggestions-text', 'More glowing fish, please!'); await page.type('#suggestions-name', 'Diver'); await page.click('#suggestions-submit');
 assert.equal(await page.$eval('#suggestions-status', e => e.textContent), 'Thanks! Sent to the dev agent.');
 const [post] = await page.evaluate(() => posts); assert.equal(post.method, 'POST'); assert.match(post.url, /^https:\/\/ntfy\.sh\/abyss-racer-ideas-[a-z0-9]+$/); assert.equal(post.headers.Title, 'Diver'); assert.match(post.body, /^More glowing fish, please!\n\n\[mode=title; version=3\.0\.0; viewport=\d+x\d+; userAgent=/);
 await page.type('#suggestions-text', 'Another idea'); await page.click('#suggestions-submit'); assert.equal(await page.evaluate(() => posts.length), 1); assert.match(await page.$eval('#suggestions-status', e => e.textContent), /Please wait/);
 await page.click('#dialog-close'); await page.click('#title-suggestions'); await page.type('#suggestions-text', 'Still cooling down'); await page.click('#suggestions-submit'); assert.equal(await page.evaluate(() => posts.length), 1);
 await page.evaluate(() => { elapsed = 20001; }); await page.click('#suggestions-submit'); assert.equal(await page.evaluate(() => posts.length), 2);
 console.log('PASS ntfy POST mapping, opaque success, optional name, context, 20-second rate limit across dialog opens');
 // Dialog keyboard trap includes the new editable controls.
 await page.focus('#suggestions-name'); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'suggestions-submit'); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'dialog-close');
 await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.id), 'title-suggestions');
 assert.deepEqual(errors, []); assert.deepEqual(requests, []);
 console.log('PASS Accessible dialog focus, offline title/solo/local boot, zero console errors and no real suggestion submitted');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => browser?.close());
