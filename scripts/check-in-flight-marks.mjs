// Built UI and PDF.js, deterministic task/PDF fixtures, no model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { readyRequirements } from './required-tools-fixture.mjs';

const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const words = JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'));
const pdf = fs.readFileSync('tests/fixtures/outline.pdf');
const tasks = ['Clarify the introduction', 'Tighten the argument', 'Explain the method', 'Check notation'].map((title, i) => ({
  id: `task-${i}`, projectId: 'paper', name: `task-${i}`, title, instructions: '', agent: 'codex', worktree: '/tmp/paper', threadId: null, turnId: null, model: null,
  status: i % 2 ? 'reviewing' : 'running', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: i % 2 ? { state: 'reviewing', round: 1, counts: { pending: 1 } } : null,
}));
const runtime = { connected: true, authenticated: true, models: [] };
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper', createdAt: 1 }], tasks, requests: [], runtime };
function note(id, wordIndex) {
  const [quote, x, y, height, width] = words[0].words[wordIndex];
  const rect = [x / 612, (y - height) / 792, (x + width) / 612, y / 792];
  return { id, projectId: 'paper', key: 'pdf', page: 0, rect, rects: [rect], quote, comment: 'Clarify this passage.', source: null, createdAt: 1 };
}
const originalMarks = tasks.map((task, i) => ({ note: { ...note(`sent-${i}`, 2 + i * 4), taskId: task.id }, taskId: task.id, title: task.title, status: task.status }));
const draft = note('draft', 15);
const manuscript = { annotations: [draft], inFlightMarks: structuredClone(originalMarks), git: { branch: 'main', files: [] }, build: { status: 'ready', key: 'pdf', current: true } };
let brokenPdf = false;
const pdfRequests = [];
await page.addInitScript(() => { localStorage.setItem('papilot:task', ''); localStorage.setItem('papilot:project', 'paper'); localStorage.setItem('papilot:language', 'en'); });
const handleApi = async route => {
  const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
  if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/updates')) return json({ currentVersion: 'test', phase: 'idle', canUpdate: false });
  if (url.pathname.endsWith('/indirect-changes')) return json({ indirectChanges: false });
  if (url.pathname.endsWith('/note-alternatives')) return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
  if (url.pathname.endsWith('/quick-notes')) return json({ quickNotes: null });
  if (url.pathname.endsWith('/predict')) return json({ ok: true });
  if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/items')) return json({ items: [] });
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  if (url.pathname.endsWith('/git')) return json(manuscript.git);
  if (url.pathname.endsWith('/manuscript')) return json(manuscript);
  if (url.pathname.endsWith('/manuscript/words')) return json(words[Number(url.searchParams.get('page'))]);
  if (url.pathname.endsWith('/manuscript.pdf') || url.pathname.endsWith('/pdf')) {
    if (url.searchParams.get('metadata') === '1') return json({ url: url.pathname + '?round=1&build=fixture' });
    pdfRequests.push(url.searchParams.get('key'));
    if (brokenPdf && url.searchParams.get('key') === 'new') return route.fulfill({ status: 503, json: { error: 'PDF unavailable' } });
    return route.fulfill({ contentType: 'application/pdf', body: pdf });
  }
  throw Error(`Unexpected request: ${url.pathname}`);
};
await page.route('**/api/**', handleApi);
await page.route('**/review/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><main id="paper">Task review</main></body></html>' }));
const tags = page.locator('.manuscript .in-flight-tag');
const mark = id => page.locator(`.manuscript .in-flight-mark[data-note="${id}"]`).first();
const sync = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));
async function manuscriptAgain() {
  // On phones the sidebar is closed after navigation.
  if (!await page.locator('.manuscript-link').isVisible()) await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
  await page.locator('.manuscript-link').click();
  await expect(tags).toHaveCount(manuscript.inFlightMarks.filter(mark => mark.note.key === manuscript.build.key).length);
}
async function opensTask(index) {
  await expect(page.getByRole('heading', { name: tasks[index].title, exact: true })).toBeVisible();
  await expect(page.locator(tasks[index].review?.round ? '.review-frame' : '.task-document-preview')).toBeVisible();
  await manuscriptAgain();
}
try {
  await page.goto(`http://127.0.0.1:${server.server.address().port}`);
  console.log('Checking mark rendering and task navigation');
  await expect(tags).toHaveCount(4);
  await expect(page.locator('.manuscript canvas').first()).toBeVisible();
  await expect(page.locator('.manuscript .note-tag')).toHaveCount(1);
  await expect(tags.nth(0)).toHaveAttribute('aria-label', /Running$/);
  await expect(tags.nth(1)).toHaveAttribute('aria-label', /Ready for review$/);
  assert.equal(await mark('sent-0').evaluate(el => getComputedStyle(el).borderStyle), 'dashed');
  // Keyboard navigation opens the ready task's review instead of a note editor.
  await tags.nth(1).focus(); await page.keyboard.press('Enter'); await opensTask(1);
  // Clicking through the translucent rectangle works without blocking text selection.
  const bounds = await mark('sent-0').boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await opensTask(0);
  // Paused/error states remain discoverable; status updates must not reload PDF.js.
  const canvas = await page.locator('.manuscript canvas').first().elementHandle();
  for (const [status, label] of [['waiting_input', 'Needs your reply'], ['interrupted', 'Paused'], ['failed', 'Needs attention'], ['reviewing', 'Ready for review']]) {
    manuscript.inFlightMarks[0].status = status; tasks[0].status = status; tasks[0].updatedAt++;
    await sync(); await expect(tags.nth(0)).toHaveAttribute('aria-label', new RegExp(label + '$'));
    assert.ok(await canvas.evaluate(el => el.isConnected));
  }
  manuscript.inFlightMarks[0].status = 'running'; tasks[0].status = 'running'; await sync();
  console.log('Checking responsive appearance');
  fs.mkdirSync('test-results/in-flight-marks', { recursive: true });
  for (const width of [1440, 390]) for (const colorScheme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    if (width === 390) await page.getByRole('group', { name: 'Manuscript view' }).getByRole('button', { name: 'PDF', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    await expect(tags).toHaveCount(4);
    await page.keyboard.press('Tab'); await tags.first().focus();
    const label = tags.first().locator('.in-flight-label');
    await expect(label).toBeVisible();
    const box = await label.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width, 'status label fits the viewport');
    await page.screenshot({ path: `test-results/in-flight-marks/${width}-${colorScheme}.png` });
    // A tap-sized target and explicit name remain available on narrow screens.
    const target = await tags.first().boundingBox(); assert.ok(target.width >= 24 && target.height >= 24);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  // Reload retains task associations, while unresolved positions stay off a new PDF.
  await page.reload(); await expect(tags).toHaveCount(4);
  manuscript.build.key = 'new';
  manuscript.inFlightMarks = manuscript.inFlightMarks.map((mark, i) => i === 3 ? mark : { ...mark, note: { ...mark.note, key: 'new' } });
  brokenPdf = true; await sync();
  await expect.poll(() => pdfRequests.includes('new')).toBe(true);
  await expect(tags).toHaveCount(4);
  // Submitting a draft on the retained PDF removes its editable tag immediately.
  manuscript.annotations = [];
  manuscript.inFlightMarks.push({ note: { ...draft, taskId: 'task-1' }, taskId: 'task-1', title: tasks[1].title, status: 'running' });
  await sync(); await expect(tags).toHaveCount(5);
  await expect(page.locator('.manuscript .note-tag[data-note="draft"]')).toHaveCount(0);
  await expect(page.locator('.manuscript .in-flight-tag[data-note="draft"]')).toHaveCount(1);
  // The real next poll reanchors the newly sent mark to the pending build.
  manuscript.inFlightMarks.at(-1).note.key = 'new';
  await sync(); await expect(page.locator('.manuscript .in-flight-tag[data-note="draft"]')).toHaveCount(1);
  // Delivery removes marks even while the old PDF is retained after a load failure.
  manuscript.inFlightMarks = manuscript.inFlightMarks.filter(mark => mark.taskId !== 'task-0');
  await sync(); await expect(tags).toHaveCount(4);
  brokenPdf = false; await page.reload(); await expect(tags).toHaveCount(3);
  manuscript.inFlightMarks = []; await sync(); await expect(tags).toHaveCount(0);
  await expect(page.locator('.manuscript .in-flight-mark')).toHaveCount(0);
  // Actual touch input uses the same passage hit testing and opens Review on phones.
  manuscript.build.key = 'pdf'; manuscript.inFlightMarks = structuredClone(originalMarks);
  const touch = await browser.newPage({ locale: 'en-US', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  touch.on('pageerror', error => errors.push(error.message));
  await touch.addInitScript(() => { localStorage.setItem('papilot:task', ''); localStorage.setItem('papilot:project', 'paper'); localStorage.setItem('papilot:language', 'en'); });
  await touch.route('**/api/**', handleApi);
  await touch.route('**/review/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><main id="paper">Task review</main></body></html>' }));
  await touch.goto(`http://127.0.0.1:${server.server.address().port}`);
  await touch.getByRole('group', { name: 'Manuscript view' }).getByRole('button', { name: 'PDF', exact: true }).click();
  const touchTag = touch.locator('.in-flight-tag[data-note="sent-1"]');
  await touchTag.tap();
  await expect(touch.getByRole('heading', { name: tasks[1].title, exact: true })).toBeVisible();
  await expect(touch.locator('.review-frame')).toBeVisible();
  await touch.close();
  assert.deepEqual(errors, []);
  console.log('In-flight PDF marks: status, navigation, reload, retained PDF, delivery and responsive screenshots passed.');
} finally { await browser.close(); await server.close(); }
