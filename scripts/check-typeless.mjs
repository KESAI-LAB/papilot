import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from './playwright.mjs';
import { dragPdfText } from './pdf-selection-fixture.mjs';

// Exercise the built UI with a deterministic desktop bridge; no microphone is used.
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const origin = `http://127.0.0.1:${server.server.address().port}`;
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper' }], tasks: [], requests: [], runtime: { connected: true, authenticated: true, models: [] } };
const git = { branch: 'main', files: [] };
const words = JSON.parse(fs.readFileSync('tests/fixtures/outline-words.json', 'utf8'));
const notes = [], created = [];
let serial = 0;
fs.mkdirSync('test-results', { recursive: true });
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
  if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
  if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
  if (url.pathname === '/api/updates') return json({ currentVersion: snapshot.version, latestVersion: null, phase: 'idle', checkedAt: 1, error: null, canUpdate: true });
  if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname === '/api/quick-notes') return json({ quickNotes: null });
  if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
  if (url.pathname.endsWith('/skills')) return json({ skills: [] });
  if (url.pathname.endsWith('/git')) return json(git);
  if (url.pathname.endsWith('/manuscript')) return json({ git, build: { status: 'ready', key: 'pdf', pages: [[612, 792], [612, 792]] }, annotations: notes });
  if (url.pathname.endsWith('/manuscript.pdf')) {
    return route.fulfill({ contentType: 'application/pdf', body: fs.readFileSync('tests/fixtures/outline.pdf') });
  }
  if (url.pathname.endsWith('/manuscript/words')) return json(words[Number(url.searchParams.get('page'))]);
  if (url.pathname.endsWith('/annotations')) {
    const body = route.request().postDataJSON();
    created.push(body);
    const note = { ...body, quote: body.quote || '', comment: body.comment || '', id: `note-${++serial}`, projectId: 'paper', source: null, createdAt: serial };
    notes.push(note); return json(note);
  }
  if (url.pathname.endsWith('/note-results')) return json({ notes: [] });
  return json({});
});
const rail = () => page.getByRole('toolbar', { name: 'Marking tools' });
const textOnPage = () => page.locator('.page[data-page-number="1"] .textLayer span').filter({ hasText: /\S/ });
async function selectText(index) {
  await dragPdfText(page, textOnPage().nth(index));
  const box = await textOnPage().nth(index).boundingBox();
  return { x: box.x + box.width - 0.5, y: box.y + box.height / 2 };
}
await page.addInitScript(() => {
  localStorage.setItem('papilot:language', 'en');
  localStorage.setItem('papilot:setup-seen', '1');
  window.typelessFixture = { calls: [], status: 'ready', shortcut: 'Fn', delayed: false };
  window.papilotDesktop = {
    platform: 'darwin',
    typelessStatus: async () => ({ status: window.typelessFixture.status, shortcut: window.typelessFixture.shortcut }),
    typelessShortcut: async inputId => {
      const fixture = window.typelessFixture;
      fixture.calls.push({ inputId, focused: document.activeElement?.id === inputId, shortcut: fixture.shortcut });
      if (fixture.delayed) await new Promise(resolve => { fixture.release = resolve; });
      return { status: fixture.status === 'ready' ? 'sent' : fixture.status, shortcut: fixture.shortcut };
    },
  };
});
const card = page.getByRole('dialog', { name: /^PDF note/ }), input = card.getByRole('textbox');
const microphone = card.getByRole('button', { name: 'Toggle dictation' });
const primary = card.locator('.pdf-note-pointer-action button');
const calls = () => page.evaluate(() => window.typelessFixture.calls);
async function expectAtPointer(pointer) {
  await expect(primary).toBeVisible();
  await expect.poll(async () => {
    const box = await primary.boundingBox();
    return box ? Math.hypot(box.x + box.width / 2 - pointer.x, box.y + box.height / 2 - pointer.y) : Infinity;
  }).toBeLessThan(1);
  assert.ok(await primary.evaluate((button, point) => button.contains(document.elementFromPoint(point.x, point.y)), pointer), 'The stationary pointer hits the action');
}
async function clickInPlace(clickCount = 1) {
  await page.mouse.down({ clickCount });
  await page.mouse.up({ clickCount });
}
const openSettings = async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.settings-link').click();
  await page.locator('[data-settings-page="experiments"]').click();
};
try {
  await page.goto(origin);
  await textOnPage().first().waitFor();
  await rail().getByRole('button', { name: 'Note', exact: true }).click();
  await selectText(0);
  await expect(input).toBeFocused();
  await expect(microphone).toHaveCount(0);
  assert.equal((await calls()).length, 0, 'Off by default');
  await input.press('Escape');
  await openSettings();
  const toggle = page.getByRole('switch', { name: 'Typeless voice notes' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.screenshot({ path: 'test-results/typeless-settings-light.png', animations: 'disabled' });
  await page.locator('.settings-dialog .modal-close').click();
  const pointer = await selectText(1);
  await expect.poll(async () => (await calls()).length).toBe(1);
  await expect(input).toBeFocused();
  const micBox = await microphone.boundingBox();
  assert.ok(pointer.x >= micBox.x && pointer.x <= micBox.x + micBox.width && pointer.y >= micBox.y && pointer.y <= micBox.y + micBox.height, 'The microphone must be under the pointer after selection');
  await input.fill('Existing draft. ');
  assert.equal((await calls()).length, 1, 'Typing does not repeat auto-start');

  // Slow delivery: double clicks and leaked Enter/Escape cannot submit or
  // dismiss the editor; the eventual paste remains an ordinary draft edit.
  await page.evaluate(() => { window.typelessFixture.shortcut = 'LeftCtrl+F8'; window.typelessFixture.delayed = true; });
  const retryBox = await microphone.boundingBox();
  await microphone.dblclick();
  await expect.poll(async () => (await calls()).length).toBe(2);
  await expect(microphone).toHaveAttribute('aria-busy', 'true');
  await expect(microphone.locator('.spinner')).toBeVisible();
  assert.deepEqual(await microphone.boundingBox(), retryBox, 'Further dictation keeps the microphone in place while sending');
  await expect(card.locator('.typeless-note-status:not(.sr-only)')).toHaveCount(0);
  await input.press('Enter');
  await input.press('Escape');
  await page.locator('.settings-link').dispatchEvent('click');
  await expect(card).toBeVisible();
  await expect(page.locator('.settings-dialog')).toHaveCount(0);
  assert.equal(created.length, 0, 'Sending a shortcut never submits the draft');
  // Freeze the brief feedback while capturing it, even on a busy test host.
  await page.clock.install({ time: new Date('2026-11-19T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-19T01:00:00Z'));
  await card.screenshot({ path: 'test-results/typeless-note-sending.png', animations: 'disabled' });
  await page.evaluate(() => { window.typelessFixture.release(); window.typelessFixture.delayed = false; });
  await expect(microphone).toBeEnabled();
  await expect(microphone).toHaveAttribute('data-state', 'sent');
  await expect(microphone).not.toHaveAttribute('aria-pressed');
  await expect(card.getByRole('status')).toHaveClass(/sr-only/);
  await card.screenshot({ path: 'test-results/typeless-note-success.png', animations: 'disabled' });
  await page.clock.resume();
  await expect(input).toBeFocused();
  await input.press('End');
  await page.keyboard.insertText('Dictated text.');
  await expect(input).toHaveValue('Existing draft. Dictated text.');
  assert.equal(created.length, 0, 'A delayed transcript does not submit');
  assert.ok((await calls()).every(call => call.focused));
  assert.equal((await calls())[1].shortcut, 'LeftCtrl+F8');
  await expect(microphone).toHaveAttribute('data-state', 'idle');
  await expect(card.getByRole('status')).toBeEmpty();
  await page.screenshot({ path: 'test-results/typeless-note-light.png', animations: 'disabled' });

  await page.evaluate(() => { window.typelessFixture.status = 'permission'; });
  await microphone.click();
  await expect(card.getByRole('status')).toContainText('Accessibility');
  await expect(input).toHaveValue('Existing draft. Dictated text.');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.screenshot({ path: 'test-results/typeless-note-error-dark.png', animations: 'disabled' });
  await page.evaluate(() => { window.typelessFixture.status = 'ready'; });
  await microphone.click();
  await expect(card.getByRole('status')).toContainText('LeftCtrl+F8 sent');
  await expect(card.getByRole('status')).toHaveClass(/sr-only/);
  await expect(card.locator('.typeless-note-status:not(.sr-only)')).toHaveCount(0);
  await expect(microphone).toHaveAttribute('data-state', 'idle');
  await page.screenshot({ path: 'test-results/typeless-note-recovered-dark.png', animations: 'disabled' });
  const beforeClose = (await calls()).length;
  await input.press('Escape');
  await expect(card).toHaveCount(0);
  assert.equal((await calls()).length, beforeClose, 'Dismissal never guesses a stop toggle');

  // The whole mouse-and-voice path uses down/up only after selection: locator
  // clicks would silently move the mouse and hide this regression.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  const beforeFixed = created.length;
  const fixed = await selectText(1);
  await expectAtPointer(fixed);
  await expect.poll(async () => (await calls()).length).toBe(beforeClose + 1);
  await expect(microphone).toBeEnabled();
  await clickInPlace();
  await expect.poll(async () => (await calls()).length).toBe(beforeClose + 2);
  await expect(microphone).toBeEnabled();
  await expect(input).toBeFocused();
  await page.screenshot({ path: 'test-results/typeless-pointer-empty.png', animations: 'disabled' });
  const transcript = 'Explain why this assumption is needed. '.repeat(12);
  await page.keyboard.insertText(transcript);
  await expect(primary).toHaveAccessibleName(/Include note/);
  await expectAtPointer(fixed);
  assert.equal(created.length, beforeFixed, 'Transcription never submits');
  await page.screenshot({ path: 'test-results/typeless-pointer-transcript.png', animations: 'disabled' });
  await clickInPlace(2);
  assert.equal(created.length, beforeFixed, 'A second click from stopping dictation cannot confirm newly arrived text');
  await clickInPlace();
  await expect(card).toHaveCount(0);
  assert.equal(created.length, beforeFixed + 1);
  assert.equal(created.at(-1).comment, transcript.trim());

  // Reverse selection anchors at the actual release, not the text's right edge.
  const word = textOnPage().nth(1);
  await word.hover();
  const wordBox = await word.boundingBox();
  const reverse = { x: wordBox.x + 0.5, y: wordBox.y + wordBox.height / 2 };
  await page.mouse.move(wordBox.x + wordBox.width - 0.5, reverse.y);
  await page.mouse.down();
  await page.mouse.move(reverse.x, reverse.y, { steps: 8 });
  await page.mouse.up();
  await expectAtPointer(reverse);
  await expect(microphone).toBeEnabled();
  await page.keyboard.insertText('Reverse selection note.');
  await expectAtPointer(reverse);
  await input.press('Escape');
  await expect(card).toHaveCount(0);

  for (const [width, height, theme, upper] of [[900, 700, 'dark', false], [700, 500, 'dark', true]]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: theme });
    await rail().getByRole('button', { name: 'Sticky note', exact: true }).click();
    await page.locator('.point-capture').first().hover();
    const paper = await page.locator('.page[data-page-number="1"]').boundingBox();
    const viewport = await page.locator('.pdf-container').boundingBox();
    const corner = { x: Math.min(paper.x + paper.width, viewport.x + viewport.width) - 35, y: upper ? Math.max(paper.y, viewport.y) + 60 : Math.min(paper.y + paper.height, viewport.y + viewport.height) - 35 };
    const beforeOpen = (await calls()).length;
    await page.mouse.click(corner.x, corner.y);
    await expectAtPointer(corner);
    await expect.poll(async () => (await calls()).length).toBe(beforeOpen + 1);
    await expect(microphone).toBeEnabled();
    await page.evaluate(() => { window.typelessFixture.status = 'permission'; });
    await clickInPlace();
    await expect(card.getByRole('status')).toContainText('Accessibility');
    await expectAtPointer(corner);
    await page.evaluate(() => { window.typelessFixture.status = 'ready'; });
    await clickInPlace();
    await expect(microphone).toBeEnabled();
    await page.keyboard.insertText('A note at the viewport edge. '.repeat(8));
    await expectAtPointer(corner);
    await expect.poll(async () => {
      const box = await card.boundingBox(), view = await page.locator('.pdf-container').boundingBox(), body = await card.locator('.pdf-suggestion-body').boundingBox();
      return {
        insideViewport: box.x >= view.x && box.x + box.width <= view.x + view.width + 1 && box.y >= view.y && box.y + box.height <= view.y + view.height + 1,
        actionOutsideEditor: corner.x < box.x || corner.x > box.x + box.width || corner.y < box.y || corner.y > box.y + box.height,
        bodyInsideCard: body.y >= box.y && body.y + body.height <= box.y + box.height + 1,
      };
    }).toEqual({ insideViewport: true, actionOutsideEditor: true, bodyInsideCard: true });
    await page.screenshot({ path: `test-results/typeless-pointer-${width}-${theme}.png`, animations: 'disabled' });
    await clickInPlace();
    await expect(card).toHaveCount(0);
  }

  // A region uses the actual release point, including after scrolling.
  await page.setViewportSize({ width: 1440, height: 900 });
  await rail().getByRole('button', { name: 'Region', exact: true }).click();
  const region = page.locator('.region-capture').first();
  await region.hover();
  const regionBox = await region.boundingBox();
  const regionViewport = await page.locator('.pdf-container').boundingBox();
  const regionEnd = { x: regionBox.x + regionBox.width * 0.55, y: Math.max(regionBox.y, regionViewport.y) + 150 };
  await page.mouse.move(regionEnd.x - 100, regionEnd.y - 60);
  await page.mouse.down();
  await page.mouse.move(regionEnd.x, regionEnd.y, { steps: 8 });
  await page.mouse.up();
  await expectAtPointer(regionEnd);
  await expect(microphone).toBeEnabled();
  await clickInPlace();
  await expect(microphone).toBeEnabled();
  await page.keyboard.insertText('Explain this figure.');
  await expectAtPointer(regionEnd);
  await clickInPlace();
  await expect(card).toHaveCount(0);
  // Mouse entry anchors at the Add note click; keyboard entry has no pointer.
  await rail().getByRole('button', { name: 'Select', exact: true }).click();
  await selectText(1);
  const add = page.getByRole('button', { name: 'Add note', exact: true });
  const addBox = await add.boundingBox();
  const addPoint = { x: addBox.x + addBox.width / 2, y: addBox.y + addBox.height / 2 };
  await page.mouse.click(addPoint.x, addPoint.y);
  await expectAtPointer(addPoint);
  await expect(microphone).toBeEnabled();
  await input.press('Escape');
  await selectText(1);
  await add.focus();
  await page.keyboard.press('Enter');
  await expect(input).toBeFocused();
  await expect(primary).toHaveCount(0);
  await expect(microphone).toBeEnabled();
  await input.press('Escape');

  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  assert.ok(await page.evaluate(() => matchMedia('(pointer: coarse)').matches));
  await page.setViewportSize({ width: 900, height: 700 });
  await rail().getByRole('button', { name: 'Sticky note', exact: true }).click();
  const touchTarget = page.locator('.point-capture').first();
  await touchTarget.hover();
  const touchBox = await touchTarget.boundingBox();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchBox.x + touchBox.width / 2, y: Math.max(touchBox.y, 60) + 60 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(input).toBeFocused();
  await expect(primary).toHaveCount(0);
  await expect(microphone).toBeEnabled();
  await page.screenshot({ path: 'test-results/typeless-touch-controls.png', animations: 'disabled' });
  await input.press('Escape');
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await touch.detach();

  await openSettings();
  await page.evaluate(() => { window.typelessFixture.status = 'shortcut-unavailable'; });
  await page.locator('.typeless-experiment').getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(toggle).toBeEnabled();
  await toggle.uncheck();
  await expect(toggle).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 700 });
  await page.screenshot({ path: 'test-results/typeless-settings-narrow-dark.png', animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log('Typeless opt-in, stationary mouse actions, edge layouts, keyboard/touch controls, focused shortcut delivery, repeated clicks, paste, failure/recovery and no auto-submit verified.');
} catch (error) {
  await page.screenshot({ path: 'test-results/typeless-failure.png', animations: 'disabled' });
  throw error;
} finally {
  await browser.close();
  await server.close();
}
