import { readyRequirements } from './required-tools-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'mupdf';
import { execFileSync } from 'node:child_process';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, webkit, expect } from './playwright.mjs';

// Floating selection controls must keep the hit area the author aims at,
// including while appearing over a real PDF link to another page.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-pdf-peek-'));
const server = Fastify();
let browser;
try {
  fs.writeFileSync(path.join(fixture, 'main.tex'), String.raw`\documentclass{article}
\usepackage{amsmath}
\usepackage[colorlinks]{hyperref}
\begin{document}
\section{References in place}
Fixture sentence about references: check each target without leaving this line.

Equation~\eqref{eq:energy}, Table~\ref{tab:results}, Figure~\ref{fig:plot}, citation~\cite{reader}.

\href{https://example.com}{External website}
\clearpage
\section{Equation}
\vspace*{3cm}
Energy identity:
\begin{equation}\label{eq:energy}E=mc^2\end{equation}
\clearpage
\section{Table}
\vspace*{3cm}
\begin{table}[h]
\centering
\caption{Measured results}\label{tab:results}
\begin{tabular}{lrr}\hline
Method & Accuracy & Time \\\hline
Alpha & 98.4 & 12 \\
Beta & 96.1 & 18 \\\hline
\end{tabular}
\end{table}
\clearpage
\section{Figure}
\begin{figure}[h]
\centering
\fbox{\rule{0pt}{55pt}\rule{160pt}{0pt}}
\caption{A compact diagram}\label{fig:plot}
\end{figure}
\clearpage
\begin{thebibliography}{42}
\bibitem{reader}Ada Reader. Reading references in context. 2026.
\end{thebibliography}
\end{document}
`);
  for (let pass = 0; pass < 2; pass++) execFileSync('pdflatex', ['-interaction=batchmode', '-halt-on-error', 'main.tex'], { cwd: fixture });
  const pdf = fs.readFileSync(path.join(fixture, 'main.pdf'));
  const brokenSource = new PDFDocument(pdf);
  brokenSource.findPage(0).get('Annots').get(0).put('A', { S: brokenSource.newName('GoTo'), D: brokenSource.newString('missing-destination') });
  const brokenBuffer = brokenSource.saveToBuffer(''), brokenPdf = Buffer.from(brokenBuffer.asUint8Array());
  brokenBuffer.destroy(); brokenSource.destroy();
  fs.mkdirSync('test-results', { recursive: true });
  await server.register(staticFiles, { root: path.resolve('dist') });
  const origin = await server.listen({ host: '127.0.0.1', port: 0 });
  browser = process.env.PAPILOT_PEEK_BROWSER === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
  const errors = [];
  async function open({ broken = false, fallback = false, crop = false, theme = 'light', delayExcerptPage = null, ...options } = {}) {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 }, ...options });
    await page.addInitScript(({ fallback, crop, theme, delayExcerptPage }) => {
      localStorage.setItem('papilot:language', 'en'); localStorage.setItem('papilot:theme', theme);
      if (fallback) Object.defineProperty(HTMLElement.prototype, 'showPopover', { value: undefined });
      if (crop) localStorage.setItem('papilot:pdf-crop:pdf:paper', JSON.stringify([0.12, 0.08, 0.88, 0.92]));
      if (delayExcerptPage !== null) {
        const post = Worker.prototype.postMessage;
        const pending = window.pendingPdfExcerpts = [];
        Worker.prototype.postMessage = function(message, ...options) {
          if (message.action === 'GetTextContent' && message.data.pageIndex === delayExcerptPage - 1) {
            pending.push(() => post.call(this, message, ...options));
          } else post.call(this, message, ...options);
        };
      }
    }, { fallback, crop, theme, delayExcerptPage });
    page.on('pageerror', error => errors.push(error.message));
    const manuscript = { git: { branch: 'main', files: [] }, build: { status: 'ready', key: 'pdf', pages: Array.from({ length: 5 }, () => [612, 792]) }, annotations: [] };
    const state = { version: 'test', projects: [{ id: 'paper', name: 'Paper', path: fixture }], tasks: [], requests: [], runtime: { connected: true, authenticated: true, models: [] } };
    const git = { branch: 'main', files: [] }, notes = [], sourceRequests = [];
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url()), json = value => route.fulfill({ json: value });
      if (url.pathname === '/api/state') return json(state);
      if (url.pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
      if (url.pathname === '/api/runtime/requirements') return json(readyRequirements);
      if (url.pathname === '/api/updates') return json({ currentVersion: 'test', latestVersion: null, phase: 'idle', checkedAt: 1, error: null, canUpdate: false });
      if (url.pathname.endsWith('/files')) return json({ document: null, files: [] });
      if (url.pathname.endsWith('/skills')) return json({ skills: [] });
      if (url.pathname.endsWith('/git')) return json(git);
      if (url.pathname.endsWith('/manuscript')) return json(manuscript);
      if (url.pathname.endsWith('/manuscript.pdf')) return route.fulfill({ contentType: 'application/pdf', body: broken ? brokenPdf : pdf });
      if (url.pathname.endsWith('/manuscript/words')) return route.fulfill({ status: 404, json: { error: 'Use PDF text' } });
      if (url.pathname.endsWith('/manuscript/source/locate')) { sourceRequests.push(route.request().postDataJSON()); return json({ source: null }); }
      if (url.pathname === '/api/quick-notes') return json({ quickNotes: null });
      if (url.pathname === '/api/note-alternatives') return json({ noteAlternatives: true, noteAlternativeRange: 'few' });
      if (url.pathname === '/api/indirect-changes') return json({ indirectChanges: false });
      if (url.pathname.endsWith('/annotations')) {
        const note = { ...route.request().postDataJSON(), id: `note-${notes.length + 1}`, projectId: 'paper', source: null, createdAt: 1 };
        notes.push(note); return json(note);
      }
      throw Error(`Unexpected fixture request ${url.pathname}`);
    });
    await page.goto(origin);
    const text = page.locator('.page[data-page-number="1"] .textLayer span').filter({ hasText: 'Fixture sentence' }).first();
    const link = page.locator('.page[data-page-number="1"] .linkAnnotation a').first();
    await text.waitFor(); await link.waitFor();
    const links = page.locator('.page[data-page-number="1"] .linkAnnotation[data-internal-link] a');
    return { page, links, manuscript, notes, sourceRequests, pageNumber: page.getByRole('textbox', { name: 'Page number', exact: true }), peek: page.locator('.pdf-peek'), text };
  }

  const f = await open();
  try {
    const { page, links, peek, pageNumber } = f;
    const position = () => page.locator('.pdf-container').evaluate(el => [el.scrollTop, el.scrollLeft]);
    const initial = await position();
    // A quick pass over a link never flashes a preview.
    await links.nth(0).hover(); await page.waitForTimeout(150); await page.mouse.move(20, 20);
    await page.waitForTimeout(450); await expect(peek).toBeHidden();
    // Returning during the departure grace must restart the cancelled hover timer.
    await links.nth(0).hover(); await page.waitForTimeout(100);
    await links.nth(0).dispatchEvent('pointerout', { pointerType: 'mouse', relatedTarget: null });
    await links.nth(0).dispatchEvent('pointerover', { pointerType: 'mouse', buttons: 0 });
    await expect(peek.locator('canvas')).toBeVisible();
    await page.mouse.move(20, 20); await expect(peek).toBeHidden();
    for (const [index, expected] of ['Energy identity', 'Measured results', 'compact diagram', 'Ada Reader'].entries()) {
      await links.nth(index).hover();
      await expect(peek.locator('canvas')).toBeVisible();
      await expect(peek.locator('canvas')).toHaveAttribute('aria-label', new RegExp(expected));
      await expect(peek.locator('.pdf-peek-label')).toHaveText(`Page ${index + 2}`);
      await expect(pageNumber).toHaveValue('1'); assert.deepEqual(await position(), initial);
      const pixels = await peek.locator('canvas').evaluate(el => {
        const bytes = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
        let dark = 0; for (let i = 0; i < bytes.length; i += 4) if (bytes[i] < 180 && bytes[i + 3] > 0) dark++;
        return dark;
      });
      assert.ok(pixels > 100, 'the excerpt contains rendered PDF ink');
      await page.screenshot({ path: `test-results/pdf-peek-${index}.png` });
      await page.mouse.move(20, 20); await expect(peek).toBeHidden();
    }
    // The active marking tool must never handle the Alt-click first.
    const rail = page.getByRole('toolbar', { name: 'Marking tools' });
    for (const tool of ['Magic pen', 'Edit source']) {
      await rail.getByRole('button', { name: tool, exact: true }).click();
      await links.nth(0).click({ modifiers: ['Alt'] });
      await expect(peek.locator('canvas')).toBeVisible(); await page.waitForTimeout(350);
      await expect(peek).toBeVisible(); await expect(page.getByRole('menu', { name: 'Quick notes', exact: true })).toHaveCount(0);
      assert.equal(f.notes.length, 0); assert.equal(f.sourceRequests.length, 0);
      await page.keyboard.press('Escape');
    }
    await rail.getByRole('button', { name: 'Magic pen', exact: true }).click();
    await page.locator('.pdf-container').focus(); await page.keyboard.press('1');
    await expect(page.locator('.stamp-lock')).toBeVisible();
    await links.nth(0).click({ modifiers: ['Alt'] });
    await expect(peek.locator('canvas')).toBeVisible(); await page.waitForTimeout(350);
    assert.equal(f.notes.length, 0);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await rail.getByRole('button', { name: 'Select', exact: true }).click();
    // Alt-click cancels PDF.js navigation; Escape dismisses without moving focus.
    await links.nth(1).click({ modifiers: ['Alt'] });
    await expect(peek.locator('canvas')).toBeVisible(); await expect(pageNumber).toHaveValue('1');
    await page.keyboard.press('Escape'); await expect(peek).toBeHidden();
    await links.nth(0).hover(); await expect(peek.locator('canvas')).toBeVisible();
    // Multiple departures along the bridge must not leave old close timers
    // behind when the pointer reaches the preview or another reference.
    await links.nth(0).dispatchEvent('pointerout', { pointerType: 'mouse', relatedTarget: null });
    await f.text.dispatchEvent('pointerout', { pointerType: 'mouse', relatedTarget: null });
    await peek.hover(); await page.waitForTimeout(200); await expect(peek).toBeVisible();
    await page.mouse.move(20, 20); await expect(peek).toBeHidden();
    // A focused link offers the same preview and Enter still follows it.
    await page.keyboard.press('Tab'); await links.nth(0).focus();
    // Native focus scrolling (notably WebKit) must not cancel this pending hint.
    await page.locator('.pdf-container').dispatchEvent('scroll');
    await expect(peek.locator('canvas')).toBeVisible();
    await expect(links.nth(0)).toBeFocused();
    await page.keyboard.press('Escape'); await expect(peek).toBeHidden();
    await links.nth(0).press('Enter'); await expect(pageNumber).toHaveValue('2');
    await pageNumber.fill('1'); await pageNumber.press('Enter');
    await links.nth(3).click(); await expect(pageNumber).toHaveValue('5');
    await expect(peek).toBeHidden();
    await pageNumber.fill('1'); await pageNumber.press('Enter');
    await page.locator('.page[data-page-number="1"] a[href="https://example.com/"]').hover();
    await page.waitForTimeout(500); await expect(peek).toBeHidden();
  } finally { await f.page.close(); }
  for (const options of [
    { theme: 'dark', crop: true },
    { fallback: true, viewport: { width: 900, height: 650 } },
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  ]) {
    const f = await open(options);
    try {
      const { page, links, peek, pageNumber } = f;
      await links.nth(1).click({ modifiers: ['Alt'] });
      await expect(peek.locator('canvas')).toBeVisible();
      await expect(peek.locator('canvas')).toHaveAttribute('aria-label', /Measured results/);
      await expect(pageNumber).toHaveValue('1');
      const rect = await peek.boundingBox(), viewport = page.viewportSize();
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width && rect.y + rect.height <= viewport.height);
      await page.screenshot({ path: `test-results/pdf-peek-${options.theme || (options.fallback ? 'fallback' : 'mobile')}.png` });
      await page.keyboard.press('Escape'); await expect(peek).toBeHidden();
      if (options.hasTouch) {
        await links.nth(0).tap(); await expect(pageNumber).toHaveValue('2');
        await expect(peek).toBeHidden();
        await pageNumber.fill('1'); await pageNumber.press('Enter');
        await links.nth(0).click({ modifiers: ['Alt'] });
        await expect(peek.locator('canvas')).toBeVisible();
        await page.setViewportSize({ width: 450, height: 844 });
        await expect(peek).toHaveCSS('width', '434px');
        await expect(peek.locator('canvas')).toBeVisible();
        await expect.poll(() => peek.locator('canvas').evaluate(el => el.clientWidth)).toBe(432);
        await page.keyboard.press('Escape');
        await expect(peek).toBeHidden();
      } else {
        await links.nth(0).hover(); await expect(peek.locator('canvas')).toBeVisible();
        await page.locator('.pdf-container').evaluate(el => { el.scrollTop += 500; });
        await expect(peek).toBeHidden();
      }
    } finally { await f.page.close(); }
  }
  for (const fallback of [false, true]) {
    const f = await open({ fallback });
    try {
      const { page, links, peek } = f;
      const link = links.nth(0), box = page.locator('.pdf-container'), canvas = peek.locator('canvas');
      const assertPlacement = async (side = 'below') => {
        await expect.poll(async () => {
          const anchor = await link.boundingBox(), popup = await peek.boundingBox();
          if (!anchor || !popup) return null;
          return side === 'below' ? popup.y - anchor.y - anchor.height : anchor.y - popup.y - popup.height;
        }).toBeCloseTo(8, 0);
      };
      await page.keyboard.press('Tab'); await link.focus();
      await expect(canvas).toBeVisible();
      await assertPlacement();
      const beforeBox = await box.boundingBox(), beforeMove = await peek.boundingBox();
      const initialCanvas = await canvas.elementHandle();
      // A stylesheet change can move one link without changing the PDF box
      // or mutating the link. Keep the rendered excerpt through the move.
      const anchorId = await link.getAttribute('data-element-id');
      const movedLink = await page.addStyleTag({ content: `.pdfViewer [data-element-id="${anchorId}"] { transform: translateY(36px); }` });
      await expect.poll(async () => (await peek.boundingBox())?.y).toBeCloseTo(beforeMove.y + 36, 0);
      await assertPlacement();
      assert.deepEqual(await box.boundingBox(), beforeBox);
      assert.equal(await initialCanvas.evaluate(el => el.isConnected && !el.hidden), true);
      await movedLink.evaluate(style => style.remove());
      await assertPlacement();
      // The canvas stays attached while the author scrolls a visible link.
      await box.evaluate(el => { el.scrollTop += 40; });
      await assertPlacement();
      assert.equal(await initialCanvas.evaluate(el => el.isConnected && !el.hidden), true);
      await initialCanvas.dispose();

      // Apply the real pane resize action and PDF zoom without moving keyboard
      // focus away or sending an outside pointer click, which dismisses Peek.
      const beforePane = await link.boundingBox();
      await page.getByRole('separator', { name: 'Resize manuscript panel' }).dispatchEvent('keydown', { key: 'ArrowLeft' });
      await expect.poll(async () => (await box.boundingBox())?.width).toBeLessThan(beforeBox.width);
      await expect.poll(async () => (await link.boundingBox())?.width).toBeLessThan(beforePane.width);
      await assertPlacement();
      await expect(canvas).toBeVisible();
      await expect(link).toBeFocused();
      const beforeZoom = await link.boundingBox();
      await box.dispatchEvent('wheel', { ctrlKey: true, deltaY: -12, clientX: beforeZoom.x - 100, clientY: beforeZoom.y, cancelable: true });
      await expect.poll(async () => (await link.boundingBox())?.width).toBeGreaterThan(beforeZoom.width);
      await assertPlacement();
      await expect(canvas).toBeVisible();
      await expect(link).toBeFocused();

      // Park a still-visible link near the lower right after a viewport resize.
      // Placement must flip vertically and clamp horizontally.
      await page.setViewportSize({ width: 820, height: 640 });
      await box.evaluate(el => { el.scrollTop += 16; });
      const view = await box.boundingBox();
      await link.evaluate((el, view) => {
        const rect = el.getBoundingClientRect();
        el.style.transform = `translate(${view.x + view.width - rect.right - 24}px, ${view.y + view.height - rect.bottom - 12}px)`;
      }, view);
      await assertPlacement('above');
      const beforeResize = await peek.boundingBox();
      assert.ok(beforeResize.x + beforeResize.width <= 820 - 7 && beforeResize.y >= 7);
      await expect(canvas).toBeVisible();
      await page.screenshot({ path: `test-results/pdf-peek-aligned-${fallback ? 'fallback' : 'popover'}.png` });
      await expect.poll(() => canvas.evaluate(el => el.clientHeight)).toBe(beforeResize.height - 30);
      const shortCanvas = await canvas.elementHandle();
      await box.evaluate(el => { el.scrollTop -= 4; });
      await expect.poll(async () => (await peek.boundingBox())?.y).toBeCloseTo(beforeResize.y + 4, 0);
      await assertPlacement('above');
      assert.equal(await shortCanvas.evaluate(el => el.isConnected), true);
      await shortCanvas.dispose();
      await link.evaluate(el => el.remove());
      await expect(peek).toBeHidden();
    } finally { await f.page.close(); }
  }
  const hovered = await open();
  try {
    const { page, links, peek } = hovered;
    const link = links.nth(0);
    await link.hover();
    await expect(peek.locator('canvas')).toBeVisible();
    const top = (await peek.boundingBox()).y;
    await page.mouse.wheel(0, 36);
    await expect.poll(async () => (await peek.boundingBox())?.y).toBeCloseTo(top - 36, 0);
    await page.waitForTimeout(150);
    await expect(peek.locator('canvas')).toBeVisible();
    await page.mouse.move(20, 20);
    await expect(peek).toBeHidden();
    await link.hover();
    await expect(peek.locator('canvas')).toBeVisible();
    await link.evaluate(el => { el.hash = '#another-destination'; });
    await expect(peek).toBeHidden();
    await expect(link).not.toHaveAttribute('aria-describedby');
  } finally { await hovered.page.close(); }
  const delayed = await open({ delayExcerptPage: 5 });
  try {
    await delayed.links.nth(3).click({ modifiers: ['Alt'] });
    await expect(delayed.peek).toContainText('Loading…');
    await expect.poll(() => delayed.page.evaluate(() => window.pendingPdfExcerpts.length)).toBeGreaterThan(0);
    await delayed.page.screenshot({ path: 'test-results/pdf-peek-loading.png' });
    await delayed.page.mouse.move(20, 20); await expect(delayed.peek).toBeHidden();
    await delayed.links.nth(0).click({ modifiers: ['Alt'] });
    await expect(delayed.peek.locator('canvas')).toHaveAttribute('aria-label', /Energy identity/);
    await delayed.page.evaluate(() => { window.pendingPdfExcerpts.splice(0).forEach(release => release()); });
    await expect(delayed.peek.locator('.pdf-peek-label')).toHaveText('Page 2');
    await expect(delayed.pageNumber).toHaveValue('1');
  } finally { await delayed.page.close(); }
  const broken = await open({ broken: true });
  try {
    await broken.links.nth(0).click({ modifiers: ['Alt'] });
    await expect(broken.peek).toContainText('Preview unavailable');
    await expect(broken.pageNumber).toHaveValue('1');
    await broken.page.screenshot({ path: 'test-results/pdf-peek-error.png' });
    await broken.links.nth(1).click({ modifiers: ['Alt'] });
    await expect(broken.peek.locator('canvas')).toHaveAttribute('aria-label', /Measured results/);
    await expect(broken.peek.locator('canvas')).toBeVisible();
    // A new manuscript replaces any in-flight/current peek with its own links.
    broken.manuscript.build.key = 'replacement';
    await broken.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(broken.peek).toBeHidden();
    await broken.links.nth(3).hover();
    await expect(broken.peek.locator('canvas')).toHaveAttribute('aria-label', /Ada Reader/);
  } finally { await broken.page.close(); }
  assert.deepEqual(errors, []);
  console.log('PASS: reference Peek follows movement, zoom, pane resize and scrolling; native, fallback, focus, dismissal and ordinary navigation work.');
} finally {
  await browser?.close(); await server.close(); fs.rmSync(fixture, { recursive: true, force: true });
}
