import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { App } from '../engine/src/server.ts';
import { loadProject, settingsFile } from '../engine/src/core/config.ts';

function createPaper(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'main.tex'), '\\documentclass{article}\n\\begin{document}\nAn example.\n\\end{document}\n');
  git('add', 'main.tex');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'Add paper');
  return fs.realpathSync(dir);
}

test('task worktrees default to a stable per-repository folder under the home directory', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-home-worktrees-'));
  const original = process.env.PAPILOT_WORKTREES;
  delete process.env.PAPILOT_WORKTREES;
  try {
    const first = createPaper(path.join(base, 'first', 'thesis'));
    const second = createPaper(path.join(base, 'second', 'thesis'));
    const a = loadProject(first).worktrees, b = loadProject(second).worktrees;
    assert.equal(path.dirname(a), path.join(os.homedir(), '.papilot', 'worktrees'));
    assert.equal(path.dirname(b), path.dirname(a));
    assert.match(path.basename(a), /^thesis-[a-f0-9]{16}$/);
    assert.notEqual(a, b);
    assert.equal(loadProject(first + path.sep + '.').worktrees, a);
    assert.equal(fs.existsSync(a), false, 'reading settings does not create a worktree directory');
  } finally {
    if (original !== undefined) process.env.PAPILOT_WORKTREES = original;
    fs.rmSync(base, { force: true, recursive: true });
  }
});

test('an implicit home directory inside the paper uses a sibling and keeps an accessible name', t => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-home-paper-')));
  const original = process.env.PAPILOT_WORKTREES;
  delete process.env.PAPILOT_WORKTREES;
  try {
    const root = createPaper(path.join(base, '研'.repeat(80)));
    const home = t.mock.method(os, 'homedir', () => root);
    const fallback = loadProject(root).worktrees;
    assert.equal(path.dirname(fallback), base);
    assert.ok(Buffer.byteLength(path.basename(fallback)) <= 255);
    assert.match(path.basename(fallback), /^研+-[a-f0-9]{16}-tasks$/u);

    const defaultHome = path.join(base, 'home'), inside = path.join(root, 'inside');
    fs.mkdirSync(path.join(defaultHome, '.papilot'), { recursive: true });
    fs.mkdirSync(inside);
    fs.symlinkSync(inside, path.join(defaultHome, '.papilot', 'worktrees'), process.platform === 'win32' ? 'junction' : 'dir');
    home.mock.mockImplementation(() => defaultHome);
    assert.equal(loadProject(root).worktrees, fallback);
    process.env.PAPILOT_WORKTREES = path.join(defaultHome, '.papilot', 'worktrees');
    assert.throws(() => loadProject(root), /outside the repository/);
  } finally {
    if (original === undefined) delete process.env.PAPILOT_WORKTREES;
    else process.env.PAPILOT_WORKTREES = original;
    fs.rmSync(base, { force: true, recursive: true });
  }
});

test('new task worktrees use the new default while earlier paths and explicit overrides still work', async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-worktree-paths-')));
  const original = process.env.PAPILOT_WORKTREES;
  process.env.PAPILOT_WORKTREES = path.join(base, 'isolated-worktrees');
  const root = createPaper(path.join(base, 'thesis'));
  const legacy = path.join(base, 'thesis-tasks');
  const settings = settingsFile(root);
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ worktrees: '../thesis-tasks' }));
  let app = new App(root);
  try {
    await app.ready;
    const existing = app.tasks.create('existing', 'Existing task', [], ['main.tex'], true);
    assert.equal(existing.worktree, path.join(legacy, 'existing'));
    assert.ok(fs.existsSync(path.join(existing.worktree, 'main.tex')));
    await app.close();
    fs.unlinkSync(settings);

    app = new App(root);
    await app.ready;
    assert.equal(app.tasks.get('existing').worktree, existing.worktree);
    assert.equal(app.tasks.create('existing', 'Resume task', [], ['main.tex'], true).worktree, existing.worktree);
    const newer = await app.tasks.createAsync('newer', 'New task', [], ['main.tex'], true);
    assert.equal(newer.worktree, path.join(loadProject(root).worktrees, 'newer'));
    assert.equal(path.dirname(path.dirname(newer.worktree)), process.env.PAPILOT_WORKTREES);
    assert.ok(fs.existsSync(path.join(newer.worktree, 'main.tex')));
    assert.ok(fs.existsSync(path.join(existing.worktree, 'main.tex')));
  } finally {
    await app.close();
    if (original === undefined) delete process.env.PAPILOT_WORKTREES;
    else process.env.PAPILOT_WORKTREES = original;
    fs.rmSync(base, { recursive: true, force: true });
  }
});
