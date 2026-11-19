import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectTypeless, typelessShortcuts } from '../desktop/typeless.ts';

test('dictation uses current configured bindings, including multiple keyboards', () => {
  assert.deepEqual(typelessShortcuts({
    featureShortcutBindings: { dictationMode: ['Fn', 'LeftCtrl+F8', 'Fn'], askAnythingMode: ['Fn+Space'] },
    keyboardShortcut: { pushToTalk: 'RightAlt' },
  }), { status: 'detected', bindings: ['Fn', 'LeftCtrl+F8'], source: 'featureShortcutBindings' });
});

test('empty or malformed current bindings never fall back to stale legacy bindings', () => {
  assert.deepEqual(typelessShortcuts({ featureShortcutBindings: { dictationMode: [] }, keyboardShortcut: { pushToTalk: 'Fn' } }), {
    status: 'detected', bindings: [], source: 'featureShortcutBindings',
  });
  for (const current of [null, {}, [], { dictationMode: 'Fn' }, { dictationMode: ['Fn', null] }, { dictationMode: [' '] }]) {
    assert.equal(typelessShortcuts({ featureShortcutBindings: current, keyboardShortcut: { pushToTalk: 'Fn' } }).status, 'unavailable');
  }
});

test('legacy shortcuts are read only when configured; missing settings do not assume Fn', () => {
  assert.deepEqual(typelessShortcuts({ keyboardShortcut: { pushToTalk: 'LeftCtrl+F8', handlesFreeMode: 'Fn+Space' } }), {
    status: 'detected', bindings: ['LeftCtrl+F8'], source: 'keyboardShortcut',
  });
  for (const settings of [undefined, null, [], {}, { keyboardShortcut: {} }, { keyboardShortcut: { pushToTalk: '' } }]) {
    assert.equal(typelessShortcuts(settings).status, 'unavailable');
  }
});

test('the probe validates the app identity, reads only shortcut settings and leaves control unverified', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'papilot-typeless-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const directory = path.join(home, 'Library', 'Application Support', 'Typeless');
  await mkdir(directory, { recursive: true });
  const settings = path.join(directory, 'app-settings.json');
  await writeFile(settings, JSON.stringify({ featureShortcutBindings: { dictationMode: ['Fn'] }, unrelatedPrivateSetting: 'never-return-this' }));
  const visited: string[] = [];
  const options = { platform: 'darwin', home, applications: ['system', 'user'], bundle: async (directory: string) => {
    visited.push(directory);
    return { id: directory.startsWith('system') ? 'another.typeless.app' : 'now.typeless.desktop', version: '2.11.0' };
  } };
  const detected = await inspectTypeless(options);
  assert.deepEqual(visited, [path.join('system', 'Typeless.app'), path.join('user', 'Typeless.app')]);
  assert.deepEqual(detected.installation, { status: 'detected', path: path.join('user', 'Typeless.app'), version: '2.11.0' });
  assert.equal(detected.shortcuts.status, 'detected');
  assert.deepEqual(detected.control, { status: 'unverified', recording: 'unknown' });
  assert.ok(!JSON.stringify(detected).includes('never-return-this'));
  await writeFile(settings, '{');
  assert.deepEqual((await inspectTypeless(options)).shortcuts, { status: 'unavailable', reason: 'invalid' });
  await rm(settings);
  assert.deepEqual((await inspectTypeless(options)).shortcuts, { status: 'unavailable', reason: 'unreadable' });
});

test('an unsupported platform or undetected app does not imply a usable integration', async () => {
  let reads = 0;
  const unsupported = await inspectTypeless({ platform: 'win32', bundle: async () => { reads++; throw new Error('must not inspect a Mac bundle'); } });
  assert.equal(reads, 0);
  assert.equal(unsupported.installation.status, 'unsupported-platform');
  assert.equal(unsupported.control.recording, 'unknown');
  const absent = await inspectTypeless({ platform: 'darwin', applications: [], home: '/not-used' });
  assert.equal(absent.installation.status, 'not-detected');
  assert.equal(absent.shortcuts.status, 'unavailable');
});
