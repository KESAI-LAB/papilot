import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PaperTools, PAPER_TOOLS, readPaper, searchPaper, annotationRevision } from '../src/server/paper-tools.ts';
import { AgentToolBridge } from '../src/server/agent-tool-bridge.ts';
import { Store } from '../src/server/store.ts';
import type { Manuscripts } from '../src/server/manuscript.ts';
import type { ReviewSnapshot } from '../src/server/ai-review.ts';
import type { Task } from '../src/shared.ts';

const snapshot: ReviewSnapshot = { key: 'pdf-1', lines: [
  { id: 'p1-l1', page: 0, text: 'Our method has a', rect: [0.1, 0.1, 0.8, 0.2] },
  { id: 'p1-l2', page: 0, text: 'strong guarantee.', rect: [0.1, 0.2, 0.8, 0.3] },
  { id: 'p2-l1', page: 1, text: 'Experiments', rect: [0.1, 0.1, 0.8, 0.2] },
] };
function fixture(root = '/unused') {
  const store = new Store(':memory:');
  const task: Task = { id: 'task', projectId: 'paper', name: 'p-task', title: 'Annotate', instructions: 'Add comments.', document: 'main.tex', worktree: '/unused', threadId: null, turnId: null, model: null, status: 'running', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null, review: null };
  store.saveProject({ id: task.projectId, name: 'Paper', path: root, createdAt: 1 }); store.saveTask(task);
  let key = snapshot.key, document = 'main.tex', live = true, sending = false;
  const manuscripts = {
    state: async () => ({ build: { current: true, key } }), documentOf: () => document,
    pdf: () => '/unused.pdf', snapshotPdf: async () => snapshot,
    locate: async () => ({ source: null }),
  };
  const tools = new PaperTools(store, manuscripts as unknown as Manuscripts, () => sending);
  const call = (tool: string, args: object) => tools.call(task, tool, args, () => live) as Promise<any>;
  return { store, task, manuscripts, call, tools, key: (value: string) => { key = value; }, document: (value: string) => { document = value; }, live: (value: boolean) => { live = value; }, sending: (value: boolean) => { sending = value; } };
}
const create = { key: snapshot.key, start: 'p1-l1', end: 'p1-l2', comment: '  Explain the assumption.\nKeep this wording.  ', requestId: 'comment-1' };

test('paper search resolves wrapped text and keeps repeated occurrences independently addressable', () => {
  assert.deepEqual(searchPaper(snapshot, 'A STRONG  guarantee').matches.map(m => [m.start, m.end]), [['p1-l1', 'p1-l2']]);
  assert.equal(searchPaper(snapshot, 'guarantee. Experiments').matches.length, 0, 'Do not cross page boundaries');
  assert.equal(searchPaper(snapshot, 'guarantee', 0, 2).matches.length, 0);
});

test('large PDFs and single enormous lines remain readable through bounded continuations', () => {
  const long = { key: 'long', lines: Array.from({ length: 16000 }, (_, i) => ({ id: `p${i + 1}-l1`, page: i, text: `Repeated passage ${i}. ` + 'content '.repeat(10), rect: [0, 0, 1, 1] as [number, number, number, number] })) };
  let cursor = 0, count = 0;
  do {
    const result = searchPaper(long, 'Repeated', cursor);
    assert.ok(JSON.stringify(result).length < 14000);
    count += result.matches.length;
    if (result.nextCursor === null) break;
    assert.ok(result.nextCursor > cursor); cursor = result.nextCursor;
  } while (true);
  assert.equal(count, 16000);
  const huge = { ...snapshot, lines: [{ ...snapshot.lines[0], text: 'x'.repeat(50000) }] };
  let next: { start?: string; offset?: number } | null = {}, reconstructed = '';
  do {
    const result = readPaper(huge, next.start, next.offset);
    assert.ok(JSON.stringify(result).length < 14000);
    reconstructed += result.lines.map(line => line.text).join(''); next = result.next;
  } while (next);
  assert.equal(reconstructed, huge.lines[0].text);
});

test('annotation creation preserves original comments, resolves real geometry and survives retries', async () => {
  const f = fixture();
  try {
    const [first, second] = await Promise.all([f.call('annotation_create', create), f.call('annotation_create', create)]);
    assert.equal(first.id, second.id); assert.equal(f.store.annotations('paper').length, 1);
    const note = f.store.annotation('paper', first.id);
    assert.equal(note.comment, create.comment); assert.equal(note.page, 0);
    assert.deepEqual(note.rects, snapshot.lines.slice(0, 2).map(line => line.rect));
    assert.equal(note.document, 'main.tex'); assert.equal(note.aiReview, undefined);
    // JSON object key ordering and a later PDF build do not break retry identity.
    f.key('pdf-2');
    assert.equal((await f.call('annotation_create', Object.fromEntries(Object.entries(create).reverse()))).id, first.id);
    await assert.rejects(f.call('annotation_create', { ...create, comment: 'Different' }), /already used/);
    const other = new PaperTools(f.store, f.manuscripts as unknown as Manuscripts, () => false);
    assert.equal((await other.call(f.task, 'annotation_create', create, () => true) as any).id, first.id);
  } finally { f.store.close(); }
});

test('invalid, stale and cross-page locations save no annotations', async () => {
  const f = fixture();
  try {
    for (const args of [{ ...create, start: 'invented' }, { ...create, end: 'p2-l1' }, { ...create, key: 'old' }, { ...create, projectId: 'elsewhere' }]) await assert.rejects(f.call('annotation_create', args));
    f.document('supplement.tex'); await assert.rejects(f.call('annotation_create', create), /another document/);
    f.document('main.tex'); f.live(false); await assert.rejects(f.call('annotation_create', create), /ended/);
    assert.equal(f.store.annotations('paper').length, 0);
  } finally { f.store.close(); }
});

test('PDF changes or stopped turns during extraction cannot write annotations', async () => {
  for (const cause of ['pdf', 'turn']) {
    const f = fixture();
    try {
      f.manuscripts.snapshotPdf = async () => { if (cause === 'pdf') f.key('new'); else f.live(false); return snapshot; };
      await assert.rejects(f.call('annotation_create', create), /changed|ended/);
      assert.equal(f.store.annotations('paper').length, 0);
    } finally { f.store.close(); }
  }
});

test('updates protect user changes and sent notes; deleted retries do not recreate a note', async () => {
  const f = fixture();
  try {
    const saved = await f.call('annotation_create', create);
    const updated = await f.call('annotation_update', { id: saved.id, revision: saved.revision, comment: 'Revised comment' });
    await assert.rejects(f.call('annotation_update', { id: saved.id, revision: saved.revision, comment: 'Overwrite' }), /changed/);
    f.sending(true); await assert.rejects(f.call('annotation_delete', { id: saved.id, revision: updated.revision }), /not an editable/); f.sending(false);
    await f.call('annotation_delete', { id: saved.id, revision: updated.revision });
    assert.equal((await f.call('annotation_create', create)).deleted, true);
    assert.equal(f.store.annotations('paper').length, 0);
    assert.equal(f.store.annotations('paper', true).length, 1);
    const deleted = (await f.call('annotations_list', { includeDeleted: true })).annotations[0];
    await f.call('annotation_restore', { id: deleted.id, revision: deleted.revision });
    assert.equal(f.store.annotations('paper').length, 1);
  } finally { f.store.close(); }
});

test('list and single-comment reads are bounded without discarding long feedback', async () => {
  const f = fixture();
  try {
    const comment = 'feedback '.repeat(10000), result = await f.call('annotation_create', { ...create, comment });
    assert.ok(JSON.stringify(result).length < 4000);
    const listed = await f.call('annotations_list', {});
    assert.ok(JSON.stringify(listed).length < 14000); assert.equal(listed.annotations[0].truncated, true);
    let offset = 0, read = '';
    do {
      const part = await f.call('annotation_read', { id: result.id, offset, revision: result.revision });
      assert.ok(JSON.stringify(part).length < 14000); read += part.comment;
      if (part.next === null) break;
      offset = part.next.offset;
    } while (true);
    assert.equal(read, comment);
    assert.equal(annotationRevision(f.store.annotation('paper', result.id)), result.revision);
  } finally { f.store.close(); }
});

test('scoped local bridge and real CLI support JSON files and revoke credentials at turn end', async () => {
  const bridge = new AgentToolBridge(PAPER_TOOLS), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-tool-test-'));
  let active = true; const calls: unknown[] = [];
  try {
    const file = await bridge.open('task', () => active, async (tool, args) => { calls.push([tool, args]); return { saved: true }; });
    const session = JSON.parse(fs.readFileSync(file, 'utf8'));
    const post = (headers: Record<string, string> = {}) => fetch(session.url, { method: 'POST', headers, body: JSON.stringify({ tool: 'help' }) });
    assert.equal((await post()).status, 403);
    assert.equal((await post({ Authorization: `Bearer ${session.token}`, Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await post({ Authorization: `Bearer ${session.token}` })).status, 200);
    const input = path.join(dir, 'comments.json'); fs.writeFileSync(input, JSON.stringify({ comment: "quotes ' \" 中文 `literal` $(literal)\nsecond line" }));
    const run = await promisify(execFile)(process.execPath, ['bin/paper-tools.mjs', file, 'annotation_create', '@' + input], { cwd: process.cwd() });
    assert.deepEqual(JSON.parse(run.stdout), { saved: true });
    assert.deepEqual(calls, [['annotation_create', JSON.parse(fs.readFileSync(input, 'utf8'))]]);
    active = false; assert.equal((await post({ Authorization: `Bearer ${session.token}` })).status, 403);
    bridge.close(); assert.equal(fs.existsSync(file), false);
  } finally { bridge.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});


test('continuing a read or search requires the original PDF key', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.call('paper_read', { start: 'p1-l1' }), /key/);
    await assert.rejects(f.call('paper_search', { query: 'method', cursor: 1 }), /key/);
    f.key('new-pdf');
    await assert.rejects(f.call('paper_read', { key: 'pdf-1', start: 'p1-l1' }), /changed/);
    await assert.rejects(f.call('paper_search', { key: 'pdf-1', query: 'method', cursor: 1 }), /changed/);
  } finally { f.store.close(); }
});


test('annotation pagination stays complete when earlier notes are deleted', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 40; i++) await f.call('annotation_create', { ...create, requestId: `note-${i}` });
    const first = await f.call('annotations_list', {});
    for (const note of first.annotations) await f.call('annotation_delete', { id: note.id, revision: note.revision });
    const second = await f.call('annotations_list', { cursor: first.nextCursor });
    assert.equal(first.annotations.length + second.annotations.length, 40);
    assert.equal(second.nextCursor, null);
  } finally { f.store.close(); }
});

test('long comments cannot be read across concurrent revisions', async () => {
  const f = fixture();
  try {
    const note = await f.call('annotation_create', { ...create, comment: 'first '.repeat(5000) });
    const first = await f.call('annotation_read', { id: note.id });
    assert.ok(first.next);
    await f.call('annotation_update', { id: note.id, revision: note.revision, comment: 'second '.repeat(5000) });
    await assert.rejects(f.call('annotation_read', first.next), /changed/);
  } finally { f.store.close(); }
});


test('deleted notes follow renamed roots while existing other roots stay isolated', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-notes-rename-'));
  const f = fixture(root);
  try {
    const source = String.raw`\documentclass{article}
\begin{document}Paper.\end{document}`;
    fs.writeFileSync(path.join(root, 'main.tex'), source);
    fs.writeFileSync(path.join(root, 'supplement.tex'), source);
    const created = await f.call('annotation_create', create);
    await f.call('annotation_delete', { id: created.id, revision: created.revision });
    const original = f.store.annotation('paper', created.id);
    f.store.saveAnnotation({ ...original, id: 'supplement-note', document: 'supplement.tex' });
    fs.renameSync(path.join(root, 'main.tex'), path.join(root, 'thesis.tex'));
    f.task.document = 'thesis.tex'; f.store.saveTask(f.task); f.document('thesis.tex');
    const listed = await f.call('annotations_list', { includeDeleted: true });
    assert.deepEqual(listed.annotations.map((note: any) => note.id), [created.id]);
    const deleted = listed.annotations[0];
    assert.equal((await f.call('annotation_read', { id: deleted.id })).comment, create.comment);
    const restored = await f.call('annotation_restore', { id: deleted.id, revision: deleted.revision });
    assert.equal(restored.deleted, false);
    const updated = await f.call('annotation_update', { id: restored.id, revision: restored.revision, comment: 'Restored feedback.' });
    await f.call('annotation_delete', { id: updated.id, revision: updated.revision });
    const elsewhere = f.store.annotation('paper', 'supplement-note');
    await assert.rejects(f.call('annotation_read', { id: elsewhere.id }), /another document/);
    await assert.rejects(f.call('annotation_restore', { id: elsewhere.id, revision: annotationRevision(elsewhere) }), /not an editable/);
    assert.ok(f.store.annotation('paper', elsewhere.id).deletedAt);
  } finally { f.store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('persisted sent-note ownership blocks update, delete and restore', async () => {
  const f = fixture();
  try {
    const saved = await f.call('annotation_create', create);
    const note = f.store.saveAnnotation({ ...f.store.annotation('paper', saved.id), taskId: 'editing-task' });
    for (const tool of ['annotation_update', 'annotation_delete', 'annotation_restore']) {
      await assert.rejects(f.call(tool, { id: note.id, revision: annotationRevision(note), ...(tool === 'annotation_update' ? { comment: 'Replacement' } : {}) }), /not an editable/);
    }
    assert.equal(f.store.annotation('paper', note.id).comment, create.comment);
  } finally { f.store.close(); }
});


test('page-scoped continuations keep both character and line-count reads on that page', () => {
  for (const lines of [
    [{ ...snapshot.lines[0], text: 'x'.repeat(15000) }],
    Array.from({ length: 90 }, (_, i) => ({ ...snapshot.lines[0], id: `p1-l${i + 1}`, text: `Line ${i}` })),
  ]) {
    const paper = { ...snapshot, lines: [...lines, snapshot.lines[2]] };
    let next: { start?: string; offset?: number; page?: number } | null = { page: 1 }, text = '';
    do {
      const part = readPaper(paper, next.start, next.offset, next.page);
      assert.ok(part.lines.every(line => line.page === 1));
      text += part.lines.map(line => line.text).join(''); next = part.next;
      if (next) assert.equal(next.page, 1);
    } while (next);
    assert.equal(text, lines.map(line => line.text).join(''));
  }
});

test('annotation reads retain deletion/replacement semantics and protect changes to mark kind', async () => {
  const f = fixture();
  try {
    const created = await f.call('annotation_create', create);
    const note = f.store.saveAnnotation({ ...f.store.annotation('paper', created.id), kind: 'delete', comment: '' });
    const list = await f.call('annotations_list', {});
    assert.equal(list.annotations[0].kind, 'delete'); assert.equal(list.annotations[0].comment, '');
    const replacement = await f.call('annotation_update', { id: note.id, revision: annotationRevision(note), comment: 'Replacement text.' });
    const read = await f.call('annotation_read', { id: note.id });
    assert.equal(read.kind, 'delete'); assert.equal(read.comment, 'Replacement text.');
    const deletion = await f.call('annotation_update', { id: note.id, revision: replacement.revision, comment: '' });
    assert.equal(deletion.kind, 'delete'); assert.equal(deletion.comment, '');
    f.store.saveAnnotation({ ...f.store.annotation('paper', note.id), kind: 'point', stamp: 'Check' });
    await assert.rejects(f.call('annotation_update', { id: note.id, revision: deletion.revision, comment: 'Different meaning.' }), /changed/);
    const current = await f.call('annotation_read', { id: note.id });
    assert.equal(current.kind, 'point'); assert.equal(current.stamp, 'Check');
  } finally { f.store.close(); }
});
