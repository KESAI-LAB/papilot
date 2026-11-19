import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AntigravityAgent, type Turn } from '../src/server/agents.ts';
import { antigravityLimits } from '../src/server/antigravity-usage.ts';
import { accountUsage, Workspace } from '../src/server/workspace.ts';
import { Store } from '../src/server/store.ts';
import type { Codex } from '../src/server/codex.ts';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/antigravity-usage.json', import.meta.url), 'utf8'));
const data = (buckets: any[]) => ({ status: 'SUCCESS', command: { name: 'usage', data: { groups: [{ name: 'Gemini Models', buckets }] } } });

test('native quota windows retain percentages, reset times and model-group scope', () => {
  const usage = accountUsage(antigravityLimits(fixture))!;
  assert.deepEqual(usage.windows, [
    { usedPercent: 25, minutes: 10080, resetsAt: Date.parse('2026-11-25T01:19:38Z'), scope: 'Gemini Models' },
    { usedPercent: 50, minutes: 300, resetsAt: Date.parse('2026-11-19T16:22:36Z'), scope: 'Gemini Models' },
    { usedPercent: 100, minutes: 10080, resetsAt: Date.parse('2026-11-26T11:42:24Z'), scope: 'Claude and GPT models' },
    { usedPercent: 0, minutes: 300, resetsAt: null, scope: 'Claude and GPT models' },
  ]);
  assert.equal(usage.reached, false, 'another model group cannot exhaust Gemini or the account');
  assert.equal(usage.plan, null);
  assert.equal(usage.credits, null);
});

test('partial, disabled and unknown quota fields never fabricate percentages or durations', () => {
  const usage = accountUsage(antigravityLimits(data([
    { id: 'gemini-5h', window: '5h', remaining_fraction: 1, disabled: true },
    { id: 'gemini-weekly', window: 'weekly', remaining_amount: 400 },
    { id: 'future-5h', name: 'Special allowance', window: 'custom', remaining_fraction: 0.5, reset_time: 'invalid' },
    ...[null, '0', NaN, Infinity, -0.1, 1.1].map(remaining_fraction => ({ window: '5h', remaining_fraction })),
    null,
  ])))!;
  assert.deepEqual(usage.windows, [{ usedPercent: 50, minutes: null, resetsAt: null, scope: 'Gemini Models', label: 'Special allowance' }]);
  assert.equal(accountUsage(antigravityLimits(data([{ window: 'weekly' }]))), null);
  assert.equal(accountUsage(antigravityLimits(data([]))), null);
  const weekly = accountUsage(antigravityLimits(data([{ window: 'weekly', remaining_fraction: 0 }])));
  assert.equal(weekly!.windows.length, 1, 'do not invent the missing 5-hour window');
  assert.equal(weekly!.windows[0].usedPercent, 100, 'zero remaining is exhausted');
});

for (const value of [null, {}, { status: 'ERROR', error: 'Login expired' }, { status: 'SUCCESS', response: '50% remaining', usage: { input_tokens: 10 } }, { ...fixture, command: { name: 'model', data: fixture.command.data } }]) {
  test(`unavailable or non-quota output is rejected: ${JSON.stringify(value)}`, () => {
    assert.throws(() => antigravityLimits(value), /structured usage/);
  });
}

class QuotaAgent extends AntigravityAgent {
  finishFixture() { this.finish({ id: 'turn', threadId: 'thread', status: 'inProgress', stop() {} } as Turn, 'completed'); }
}

test('quota reads use the configured CLI, coalesce, expire and refresh after a turn', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  let calls = 0;
  const agent = new QuotaAgent('fixture-agy', '/unused/agy-conversations.json', undefined, undefined, async (binary, args, options) => {
    calls++;
    assert.equal(binary, 'fixture-agy');
    assert.deepEqual(args, ['--print', '/usage', '--output-format', 'json']);
    assert.equal(options.timeout, 20_000);
    assert.ok(options.env.PATH);
    return JSON.stringify(fixture);
  });
  const events: string[] = [];
  agent.on('notification', event => events.push(event.method));
  await Promise.all([agent.request('account/rateLimits/read'), agent.request('account/rateLimits/read')]);
  await agent.request('account/rateLimits/read');
  assert.equal(calls, 1);
  t.mock.timers.tick(30_001);
  await agent.request('account/rateLimits/read');
  assert.equal(calls, 2);
  agent.finishFixture();
  assert.deepEqual(events, ['turn/completed', 'account/rateLimits/updated']);
  await agent.request('account/rateLimits/read');
  assert.equal(calls, 3);
});

test('quota transport/parse failures clear usage without disconnecting or blocking conversations', async () => {
  let failure: string | null = 'timeout';
  const agent = new QuotaAgent('fixture-agy', '/unused/agy-conversations.json', undefined, undefined, async () => {
    if (failure === 'timeout') throw new Error('timed out');
    return failure || JSON.stringify(fixture);
  });
  const store = new Store(':memory:');
  const workspace = new Workspace(store, agent as unknown as Codex, async () => { throw new Error('unused'); }, { antigravity: agent });
  Object.assign(workspace.runtimes.antigravity, { connected: true, authenticated: true, error: null });
  try {
    for (const bad of ['timeout', 'not JSON', '{"status":"ERROR"}']) {
      failure = bad;
      workspace.runtimes.antigravity.usage = accountUsage(antigravityLimits(fixture));
      await workspace.readUsage('antigravity');
      assert.equal(workspace.runtimes.antigravity.usage, null);
      assert.equal(workspace.runtimes.antigravity.connected, true);
      assert.equal(workspace.runtimes.antigravity.error, null);
      assert.ok((await agent.request('thread/start', { cwd: '/tmp' })).thread.id);
    }
    failure = null;
    await workspace.readUsage('antigravity');
    assert.equal(workspace.runtimes.antigravity.usage!.windows.length, 4);
  } finally { workspace.close(); store.close(); }
});

test('a turn finishing during a quota read does not cache its older snapshot', async () => {
  let resolve!: (value: string) => void, calls = 0;
  const agent = new QuotaAgent('fixture-agy', '/unused/agy-conversations.json', undefined, undefined, async () => {
    calls++;
    return calls === 1 ? new Promise<string>(done => { resolve = done; }) : JSON.stringify(fixture);
  });
  const pending = agent.request('account/rateLimits/read');
  agent.finishFixture();
  resolve(JSON.stringify(fixture));
  await pending;
  await agent.request('account/rateLimits/read');
  assert.equal(calls, 2);
});

test('Antigravity becomes ready while its optional quota query is still pending', async () => {
  let resolve!: (value: string) => void;
  const agent = new QuotaAgent('fixture-agy', '/unused/agy-conversations.json', undefined, undefined,
    () => new Promise<string>(done => { resolve = done; }));
  agent.ready = true;
  const store = new Store(':memory:');
  const workspace = new Workspace(store, agent as unknown as Codex, async () => { throw new Error('unused'); }, { antigravity: agent });
  try {
    let connected = false;
    const pending = (workspace as any).connectAgent('antigravity').then(() => { connected = true; });
    await new Promise<void>(done => setImmediate(done));
    assert.equal(connected, true, 'quota latency must not delay agent readiness');
    assert.equal(workspace.runtimes.antigravity.connected, true);
    assert.equal(workspace.runtimes.antigravity.authenticated, true);
    resolve(JSON.stringify(fixture));
    await pending;
    await new Promise<void>(done => setImmediate(done));
    assert.equal(workspace.runtimes.antigravity.usage!.windows.length, 4);
  } finally { workspace.close(); store.close(); }
});
