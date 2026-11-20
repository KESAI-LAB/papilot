import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import worker from '../site/worker.mjs';
import { chromium, expect } from './playwright.mjs';

const originalFetch = globalThis.fetch, originalCaches = globalThis.caches, originalNow = Date.now;
const stored = new Map();
const cache = {
  match: async request => stored.get(request.url)?.clone(),
  put: async (request, response) => { stored.set(request.url, response.clone()); },
};
let githubCalls = 0, githubResponse = () => new Response(JSON.stringify({ stargazers_count: 12345 }));
let now = Date.now();
Date.now = () => now;
globalThis.caches = { default: cache };
globalThis.fetch = async (_url, options) => { githubCalls++; assert.ok(options.signal instanceof AbortSignal); return githubResponse(); };
const request = (query = '') => new Request('https://papilot.ai/api/github-stars' + query);
async function lookup(query, status = 200) {
  const result = await worker.fetch(request(query), {});
  assert.equal(result.status, status);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  return result.json();
}
try {
  assert.deepEqual(await lookup(), { stars: 12345, refreshAfter: 900 });
  now += 14 * 60 * 1000;
  assert.deepEqual(await lookup('?locale=ja'), { stars: 12345, refreshAfter: 60 });
  assert.equal(githubCalls, 1, 'URL parameters share the cached count');

  now += 60 * 1000;
  let release, started;
  const requested = new Promise(resolve => { started = resolve; });
  githubResponse = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const update = lookup();
  await requested;
  assert.deepEqual(await lookup(), { stars: 12345, refreshAfter: 1 });
  release(new Response(JSON.stringify({ stargazers_count: 12500 })));
  assert.deepEqual(await update, { stars: 12500, refreshAfter: 900 });
  assert.equal(githubCalls, 2, 'An elapsed refresh deadline updates the count');

  now += 15 * 60 * 1000;
  const failures = [
    [() => new Response(null, { status: 429, headers: { 'Retry-After': '180' } }), 180],
    [() => new Response(null, { status: 403, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(Math.floor(now / 1000) + 240) } }), 240],
    [() => new Response('{}'), 60],
    [() => { throw new DOMException('Timed out', 'TimeoutError'); }, 60],
  ];
  for (const [response, seconds] of failures) {
    githubResponse = response;
    const previousCalls = githubCalls;
    assert.deepEqual(await lookup(), { stars: 12500, refreshAfter: seconds });
    assert.deepEqual(await lookup('?locale=de'), { stars: 12500, refreshAfter: seconds });
    assert.equal(githubCalls, previousCalls + 1, 'A failed refresh waits for its retry deadline');
    now += seconds * 1000;
  }
  githubResponse = () => new Response(JSON.stringify({ stargazers_count: 12340 }));
  assert.deepEqual(await lookup(), { stars: 12340, refreshAfter: 900 }, 'Star removals also reach the display after recovery');
  stored.clear();
  githubResponse = () => new Response(null, { status: 503 });
  assert.deepEqual(await lookup('', 503), { stars: null, refreshAfter: 60 });
  const assets = { fetch: request => new Response(request.url) };
  assert.equal(await (await worker.fetch(new Request('https://papilot.ai/'), { ASSETS: assets })).text(), 'https://papilot.ai/');
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  if (originalCaches === undefined) delete globalThis.caches; else globalThis.caches = originalCaches;
}

if (process.env.PAPILOT_SITE_STARS) {
  const languages = JSON.parse(fs.readFileSync('i18n/languages.json', 'utf8'));
  fs.mkdirSync('test-results/site', { recursive: true });
  const server = Fastify();
  await server.register(staticFiles, { root: path.resolve('_site') });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const origin = `http://127.0.0.1:${server.server.address().port}`;
  const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.clock.install();
    const format = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
    const initial = Number(process.env.PAPILOT_SITE_STARS), updated = initial < 100000 ? 125400 : 999;
    const expectedInitial = format.format(initial).toLowerCase(), expectedUpdated = format.format(updated).toLowerCase();
    let response = { status: 200, stars: updated, refreshAfter: 45 }, calls = 0, gate = null;
    await page.route('**/api/github-stars', async route => {
      calls++;
      if (gate) await gate;
      const { status, ...json } = response;
      await route.fulfill({ status, json });
    });
    const headerPositions = async () => page.locator('.topbar :is(.brand,.nav,.topbar-universe,.topbar-demo,.github-link)').evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return [x, y, width, height];
    }));
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      let release;
      gate = new Promise(resolve => { release = resolve; });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.github-count')).toHaveText(expectedInitial);
      await page.evaluate(() => document.fonts.ready);
      const before = await headerPositions();
      gate = null; release();
      await expect(page.locator('.github-count')).toHaveText(expectedUpdated);
      assert.deepEqual(await headerPositions(), before, `${width}px: refreshing does not move the header controls`);
      assert.equal(await page.locator('.github-link').getAttribute('href'), 'https://github.com/PapilotAI/papilot');
      await page.screenshot({ path: `test-results/site/stars-${width}.png`, animations: 'disabled' });
    }

    response = { status: 503, stars: null, refreshAfter: 60 };
    const beforeFailure = calls;
    await page.clock.fastForward(45 * 1000);
    await expect.poll(() => calls).toBe(beforeFailure + 1);
    await expect(page.locator('.github-count')).toHaveText(expectedUpdated);
    response = { status: 200, stars: 13000, refreshAfter: 900 };
    await page.clock.fastForward(60 * 1000);
    await expect(page.locator('.github-count')).toHaveText('13k');
    response = { status: 200, stars: null, refreshAfter: 900 };
    await page.clock.fastForward(15 * 60 * 1000);
    await expect(page.locator('.github-count')).toHaveText('13k');

    for (const locale of Object.keys(languages)) {
      response = { status: 200, stars: 13200, refreshAfter: 900 };
      await page.goto(`${origin}/${locale === 'en' ? '' : `${locale}/`}`);
      await expect(page.locator('.github-count')).toHaveText('13.2k');
      assert.equal(await page.locator('.github-link').getAttribute('href'), 'https://github.com/PapilotAI/papilot');
    }
  } finally {
    await browser.close(); await server.close();
  }
}
console.log('PASS: GitHub stars use a 15-minute cache, refresh without layout shifts, and retain the static count on failures');
