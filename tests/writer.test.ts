import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decide, resolveInside } from '../src/server/writer/policy.ts';
import { project, simpleMacros } from '../src/server/writer/plain-text.ts';
import { paperMap } from '../src/server/writer/paper-map.ts';
import { writerTools, type ToolHost } from '../src/server/writer/tools.ts';
import { WriterAgent, toolItem } from '../src/server/writer/agent.ts';
import { claudeSubscription, WriterCredentials } from '../src/server/writer/auth.ts';
import { contextBreakdown, COMPACTION_RESERVE } from '../src/server/writer/context.ts';

function paper() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot writer 中文 '));
  fs.mkdirSync(path.join(dir, 'sections'));
  fs.writeFileSync(path.join(dir, 'main.tex'), String.raw`\documentclass{article}
\newcommand{\method}{FlowNet}
\newcommand{\vect}[1]{\mathbf{#1}}
\title{Learning to \emph{Fly}}
\begin{document}
\maketitle
\begin{abstract}
We present \method, a model that learns % a comment
to fly.
\end{abstract}
\section{Introduction}\label{sec:intro}
\method{} is \textbf{fast}. As shown in Section~\ref{sec:method}
and in~\cite{smith2020}, it
generalizes well.
\input{sections/method}
\section{Results}
See Figure~\ref{fig:missing}.
\bibliography{refs}
\end{document}
`);
  fs.writeFileSync(path.join(dir, 'sections', 'method.tex'), String.raw`\section{Method}\label{sec:method}
We train \method\ on birds.
\subsection{Loss}
The loss is small.
\begin{figure}\caption{The architecture of the model.}\label{fig:arch}\end{figure}
`);
  fs.writeFileSync(path.join(dir, 'refs.bib'), '@article{smith2020,\n  title = {Flying},\n  author = {Smith, A.},\n  year = {2020}\n}\n');
  fs.writeFileSync(path.join(dir, 'data.csv'), 'x,y\n1,2\n');
  return dir;
}

test('the policy runs paper edits, asks before other changes and refuses to leave the worktree', () => {
  assert.equal(decide('paper', 'read', 'data.csv').tier, 'safe');
  assert.equal(decide('paper', 'edit', 'sections/intro.tex').tier, 'safe');
  assert.equal(decide('paper', 'create', 'refs.bib').tier, 'safe');
  assert.equal(decide('paper', 'overwrite', 'main.tex').tier, 'ask');
  for (const file of ['data.csv', 'analysis.py', 'paper.sty', 'latexmkrc', 'figure.png']) assert.equal(decide('paper', 'edit', file).tier, 'ask', file);
  assert.equal(decide('paper', 'delete', 'main.tex').tier, 'ask');
  assert.equal(decide('paper', 'move', 'main.tex').tier, 'ask');
  assert.equal(decide('full', 'delete', 'main.tex').tier, 'safe');
  assert.equal(decide('read-only', 'edit', 'main.tex').tier, 'refuse');
  const dir = paper();
  assert.equal(resolveInside(dir, 'sections/method.tex').rel, 'sections/method.tex');
  assert.throws(() => resolveInside(dir, '../outside.tex'), /outside the task worktree/);
  assert.throws(() => resolveInside(dir, '/etc/passwd'), /outside the task worktree/);
  assert.throws(() => resolveInside(dir, '.git/config'), /Git's own folder/);
  fs.symlinkSync(os.tmpdir(), path.join(dir, 'escape'));
  assert.throws(() => resolveInside(dir, 'escape/x.tex'), /outside the task worktree/);
});

test('the reading text sees through macros, line breaks and comments, and remembers source offsets', () => {
  const source = String.raw`We present \method, a model that \emph{learns} % hidden
to~fly \cite{a,b}.`;
  const macros = simpleMacros([String.raw`\newcommand{\method}{FlowNet} \newcommand{\vect}[1]{\mathbf{#1}}`]);
  assert.deepEqual([...macros], [['method', 'FlowNet']]);
  const view = project(source, macros);
  assert.equal(view.text, 'We present FlowNet, a model that learns to fly [cite].');
  const at = view.text.indexOf('to fly');
  assert.equal(source.slice(view.offsets[at], view.offsets[at] + 2), 'to');
});

test('the paper map pins the title and abstract and outlines every part with its files and lines', async () => {
  const dir = paper();
  const map = await paperMap(dir);
  assert.match(map.text, /^Title \(main\.tex:4\): Learning to Fly$/m);
  assert.match(map.text, /Abstract \(main\.tex:7-10\):\nWe present FlowNet, a model that learns to fly\./);
  assert.match(map.text, /^- 1 Introduction — main\.tex:11-14 \(17 words\) \[sec:intro\]$/m);
  assert.match(map.text, /^- 2 Method — sections\/method\.tex:1-5 /m);
  assert.match(map.text, /^ {2}- 2\.1 Loss — sections\/method\.tex:3-5/m);
  assert.match(map.text, /Referenced but never defined: fig:missing \(main\.tex:17\)/);
  assert.match(map.text, /figure fig:arch sections\/method\.tex:5 "The architecture of the model\."/);
  assert.match(map.text, /\\method, \\vect\[1\]/);
});

function host(dir: string, overrides: Partial<ToolHost> = {}): ToolHost & { approvals: string[] } {
  const approvals: string[] = [];
  return {
    approvals, cwd: dir, mode: () => 'paper', approve: async request => { approvals.push(request.title); return true; }, ask: async () => [],
    papilot: async () => ({ success: true, text: '' }), lastBuild: () => null, recordBuild: () => {}, chore: () => null, enterChore: async () => true, exitChore: () => {},
    ...overrides,
  };
}
const call = async (tools: ReturnType<typeof writerTools>, name: string, params: unknown) => {
  const result = await tools.find(tool => tool.name === name)!.execute('id', params as never, undefined, undefined, undefined as never);
  return result.content.map(part => part.type === 'text' ? part.text : '[image]').join('\n');
};

test('the paper tools find text, outline sections and edit LaTeX without asking', async () => {
  const dir = paper(), h = host(dir), tools = writerTools(h);
  assert.deepEqual(tools.map(tool => tool.name).filter(name => ['run_command', 'enter_chore_mode', 'search_text'].includes(name)), ['search_text', 'enter_chore_mode', 'run_command']);
  const found = await call(tools, 'search_text', { query: 'FlowNet is fast' });
  assert.match(found, /^main\.tex:12: ….*FlowNet is fast\./m);
  assert.match(await call(tools, 'search_text', { query: 'section [ref] and in [cite], it generalizes' }), /main\.tex:12-14/);
  assert.match(await call(tools, 'paper_outline', { section: 'sec:method' }), /^- 2 Method — sections\/method\.tex:1-5 .*\n {2}- 2\.1 Loss/);
  assert.match(await call(tools, 'read_file', { section: 'Loss' }), /sections\/method\.tex:3-5/);
  assert.match(await call(tools, 'find_references', { name: 'sec:method' }), /label: sections\/method\.tex:1.*\nreference: main\.tex:12/s);
  const diff = await call(tools, 'edit_file', { path: 'sections/method.tex', edits: [{ old_text: 'The loss is small.', new_text: 'The loss is tiny.' }] });
  assert.match(diff, /-The loss is small\.\n\+The loss is tiny\./);
  assert.deepEqual(h.approvals, []);
  await assert.rejects(call(tools, 'edit_file', { path: 'main.tex', edits: [{ old_text: 'section', new_text: 'x' }] }), /more than once/);
});

test('changing data asks first, a declined change is not made, and commands need chore mode', async () => {
  const dir = paper(), declined = host(dir, { approve: async () => false });
  await assert.rejects(call(writerTools(declined), 'edit_file', { path: 'data.csv', edits: [{ old_text: '1,2', new_text: '1,3' }] }), /declined/);
  assert.equal(fs.readFileSync(path.join(dir, 'data.csv'), 'utf8'), 'x,y\n1,2\n');
  const h = host(dir);
  await call(writerTools(h), 'edit_file', { path: 'data.csv', edits: [{ old_text: '1,2', new_text: '1,3' }] });
  assert.deepEqual(h.approvals, ['Edit data.csv']);
  await assert.rejects(call(writerTools(h), 'run_command', { command: 'echo hi' }), /only in chore mode/);
  const readOnly = writerTools(host(dir, { mode: () => 'read-only' })).map(tool => tool.name);
  assert.ok(readOnly.includes('search_text') && !readOnly.includes('edit_file') && !readOnly.includes('run_command'));
});

test('Claude subscription tokens are refused and credentials stay in Papilot', async () => {
  const { AuthStorage } = await import('@mariozechner/pi-coding-agent');
  const storage = AuthStorage.inMemory();
  const credentials = new WriterCredentials(storage, { ANTHROPIC_API_KEY: 'sk-ant-oat01-abc', OPENAI_API_KEY: 'sk-test' });
  assert.ok(claudeSubscription('sk-ant-oat01-abc'));
  assert.equal(credentials.usable('anthropic'), false);
  assert.throws(() => credentials.setKey('anthropic', 'sk-ant-oat01-xyz'), /subscription token/);
  credentials.setKey('anthropic', 'sk-ant-api03-key');
  assert.equal(credentials.usable('anthropic'), true);
  const status = credentials.status().providers;
  assert.deepEqual(status.filter(p => p.configured).map(p => [p.id, p.source]), [['anthropic', 'stored'], ['openai', 'environment']]);
  assert.deepEqual(status.filter(p => p.kind === 'login').map(p => p.id), ['openai-codex', 'github-copilot']);
});

test('tool calls show as file changes, commands, page views or named tools', () => {
  assert.equal(toolItem('1', 'edit_file', { path: 'a.tex' }).type, 'fileChange');
  assert.equal(toolItem('2', 'run_command', { command: 'make' }).type, 'commandExecution');
  assert.deepEqual(toolItem('3', 'view_pages', { pages: ['3'] }), { id: '3', type: 'dynamicToolCall', tool: 'view_pdf', arguments: { pages: ['3'] }, status: 'inProgress' });
  assert.equal(toolItem('4', 'search_text', { query: 'flow' }).text, 'Search text flow');
});

test('Papilot Writer runs a turn on Pi: map first, approvals through Papilot, chore mode within the turn', { timeout: 30000 }, async () => {
  const dir = paper(), data = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot writer data '));
  const ai = await import('@mariozechner/pi-ai'), { AuthStorage } = await import('@mariozechner/pi-coding-agent');
  const faux = ai.registerFauxProvider({ provider: 'faux', models: [{ id: 'writer', reasoning: false }] });
  const prompts: string[] = [];
  faux.setResponses([
    context => { prompts.push(JSON.stringify(context.messages.at(-1))); return ai.fauxAssistantMessage(ai.fauxToolCall('edit_file', { path: 'sections/method.tex', edits: [{ old_text: 'small', new_text: 'tiny' }] }), { stopReason: 'toolUse' }); },
    ai.fauxAssistantMessage(ai.fauxToolCall('edit_file', { path: 'data.csv', edits: [{ old_text: '1,2', new_text: '1,3' }] }), { stopReason: 'toolUse' }),
    ai.fauxAssistantMessage(ai.fauxToolCall('enter_chore_mode', { chore: 'Count lines', plan: 'wc -l data.csv' }), { stopReason: 'toolUse' }),
    context => { prompts.push(JSON.stringify(context.messages.at(-1))); return ai.fauxAssistantMessage(ai.fauxToolCall('run_command', { command: 'echo chore-done' }), { stopReason: 'toolUse' }); },
    ai.fauxAssistantMessage(ai.fauxToolCall('exit_chore_mode', { summary: 'Counted.' }), { stopReason: 'toolUse' }),
    ai.fauxAssistantMessage('Made the loss tiny.'),
  ]);
  try {
    // Refreshing the registry would drop the faux provider's registration.
    class Writer extends WriterAgent { available() { return [faux.getModel()] as never; } async refreshModels() {} }
    const agent = new Writer({ dir: data, auth: AuthStorage.inMemory({ faux: { type: 'api_key', key: 'test' } }) });
    const notes: any[] = [], requests: any[] = [];
    agent.on('notification', note => notes.push(note));
    agent.on('request', request => { requests.push(request); setImmediate(() => agent.respond(request.id, { decision: 'accept' })); });
    await agent.start();
    const { thread } = await agent.request('thread/start', { cwd: dir, developerInstructions: 'Task instructions.' });
    const done = new Promise<any>(resolve => agent.on('notification', note => { if (note.method === 'turn/completed') resolve(note.params.turn); }));
    await agent.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Make the loss tiny.' }], model: 'faux/writer' });
    const turn = await done;
    assert.equal(turn.status, 'completed', turn.error?.message);
    assert.match(prompts[0], /<paper-map>[\s\S]*Title \(main\.tex:4\): Learning to Fly[\s\S]*Make the loss tiny\./);
    assert.match(prompts[1], /Chore mode is now on for: Count lines/);
    assert.match(fs.readFileSync(path.join(dir, 'sections/method.tex'), 'utf8'), /The loss is tiny\./);
    assert.equal(fs.readFileSync(path.join(dir, 'data.csv'), 'utf8'), 'x,y\n1,3\n');
    assert.deepEqual(requests.map(r => r.method), ['item/fileChange/requestApproval', 'item/commandExecution/requestApproval']);
    assert.match(requests[1].params.reason, /Enter chore mode: Count lines/);
    const completed = notes.filter(n => n.method === 'item/completed').map(n => n.params.item);
    assert.deepEqual(completed.filter(item => item.type === 'fileChange').map(item => item.changes[0].path), ['sections/method.tex', 'data.csv']);
    assert.match(completed.find(item => item.type === 'commandExecution').aggregatedOutput, /chore-done/);
    assert.equal(completed.at(-1).text, 'Made the loss tiny.');
    assert.ok(fs.existsSync(path.join(data, 'sessions', `${thread.id}.jsonl`)), 'the session is kept for resuming');
    agent.close();
  } finally { faux.unregister(); }
});

test('models come from each provider\'s own list, with Pi\'s entries only as templates', async () => {
  const ai = await import('@mariozechner/pi-ai');
  const { listModels, fromList } = await import('../src/server/writer/models.ts');
  const builtins = ai.getModels('openai-codex') as any[];
  const token = ['x', Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1' } })).toString('base64url'), 'y'].join('.');
  let seen: { url: string; headers: any } | null = null;
  const fetcher = async (url: string, init?: RequestInit) => {
    seen = { url, headers: init?.headers };
    return new Response(JSON.stringify({ models: [
      { slug: 'gpt-6-mini', display_name: 'GPT-6 Mini', priority: 2, visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] },
      { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', priority: 1, visibility: 'list', context_window: 400000 },
      { slug: 'internal-eval', priority: 0, visibility: 'hide' },
    ] }));
  };
  const listed = await listModels('openai-codex', token, builtins[0], fetcher, '0.164.0');
  assert.match(seen!.url, /\/codex\/models\?client_version=0\.164\.0$/);
  assert.equal(seen!.headers['chatgpt-account-id'], 'acct-1');
  assert.deepEqual(listed!.map(entry => entry.id), ['gpt-6-astra', 'gpt-6-mini'], 'Hidden models are left out; the backend\'s order is kept');
  const models = fromList(listed!, builtins);
  assert.equal(models[0].name, 'GPT-6-Astra');
  assert.equal(models[0].contextWindow, 400000);
  assert.equal(models[0].api, builtins[0].api, 'Request settings come from a built-in entry');
  assert.equal(models[0].baseUrl, builtins[0].baseUrl);
  assert.deepEqual(models[0].cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 'An unknown model has no made-up prices');
});

test('Papilot Writer lists the provider\'s models and falls back to Pi\'s entries when the list is unavailable', async () => {
  const { AuthStorage } = await import('@mariozechner/pi-coding-agent');
  let online = true;
  const fetcher = async (url: string) => {
    if (!online) throw new Error('offline');
    assert.equal(url, 'https://api.openai.com/v1/models');
    return new Response(JSON.stringify({ data: [{ id: 'gpt-6' }, { id: 'text-embedding-3-large' }, { id: 'gpt-realtime' }, { id: 'gpt-5.4' }] }));
  };
  const listed = new WriterAgent({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'papilot writer models ')), auth: AuthStorage.inMemory({ openai: { type: 'api_key', key: 'sk-test' } }), env: {}, fetch: fetcher });
  await listed.start();
  const data = (await listed.request('model/list')).data, ids = data.map((model: any) => model.model);
  assert.ok(data.every((model: any) => model.source === 'OpenAI' && !model.displayName.includes(' · ')), 'The provider is a group in the picker, not a suffix');
  assert.deepEqual([...ids].sort(), ['openai/gpt-5.4', 'openai/gpt-6']);
  online = false;
  const offline = new WriterAgent({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'papilot writer models ')), auth: AuthStorage.inMemory({ openai: { type: 'api_key', key: 'sk-test' } }), env: {}, fetch: fetcher });
  await offline.start();
  const fallback = (await offline.request('model/list')).data.map((model: any) => model.model);
  assert.ok(fallback.length > 2 && fallback.every((id: string) => id.startsWith('openai/')), 'Pi\'s built-in entries stand in');
});

test('tool calls read as sentences and a run of them as a summary of what happened', async () => {
  const { toolSentence, toolSummary, toolIcon } = await import('../src/web/tool-calls.ts');
  const tool = (id: string, name: string, args: Record<string, unknown>) => {
    const item = toolItem(id, name, args) as any;
    return { id, taskId: 't', createdAt: 0, type: 'tool', text: item.text, tool: { kind: item.kind, target: item.target, ...(item.lines ? { lines: item.lines } : {}) } };
  };
  const read = tool('2', 'read_file', { path: 'paper.tex', start_line: 1, end_line: 362 });
  assert.equal(toolSentence(read), 'Read paper.tex, lines 1–362');
  assert.equal(toolIcon(read), 'paper');
  const items = [tool('1', 'list_files', {}), read, tool('3', 'read_file', { path: 'sections/intro.tex' }), tool('4', 'read_file', { path: 'paper.tex', start_line: 363 }),
    tool('5', 'search_text', { query: 'flow' }), tool('6', 'search_source', { pattern: '\\cite' }), { id: '7', taskId: 't', createdAt: 0, type: 'command', text: 'make' }];
  const summary = toolSummary(items, () => []);
  assert.equal(summary.text, 'Listed the files, read 2 files, searched 2 times, ran 1 command');
  assert.equal(summary.icon, 'paper', 'The icon follows what the run did most');
  assert.equal(toolSummary([tool('8', 'read_file', { path: 'macros.tex' })], () => []).text, 'Read macros.tex');
  assert.equal(toolSentence({ id: '9', taskId: 't', createdAt: 0, type: 'tool', text: 'server / tool' }), null, 'Other agents keep their own text');
});

test('a read names the sections it covered and the pages they print on', async () => {
  const { sectionsOf } = await import('../src/server/writer/tools.ts');
  const { toolSentence, toolNote, toolSummary } = await import('../src/web/tool-calls.ts');
  const dir = paper(), outline = (await paperMap(dir)).outline;
  assert.deepEqual(sectionsOf(outline, 'sections/method.tex', 1, 5), { sections: [{ number: '2', title: 'Method' }] }, 'A section read whole is named at its highest level');
  assert.deepEqual(sectionsOf(outline, 'sections/method.tex', 4, 4), { sections: [{ number: '2.1', title: 'Loss' }], partial: true }, 'Part of a section names the innermost one');
  assert.equal(sectionsOf(outline, 'refs.bib', 1, 3), null);
  // The pages come from SyncTeX through Papilot; the read reports both.
  const asked: any[] = [];
  const tools = writerTools(host(dir, { papilot: async (tool, args) => { asked.push([tool, args]); return { success: true, text: '[4,5]' }; } }));
  const read = tools.find(item => item.name === 'read_file')!;
  const result: any = await read.execute('call', { path: 'sections/method.tex', start_line: 3, end_line: 5 }, undefined, undefined, undefined as never);
  assert.equal(asked[0][0], 'source_pages');
  assert.deepEqual(result.details.place, { sections: [{ number: '2.1', title: 'Loss' }], pages: [4, 5] });
  const item = { id: 'r', taskId: 't', createdAt: 0, type: 'tool', text: '', tool: { kind: 'read', target: 'sections/method.tex', lines: '3-5', place: result.details.place } };
  assert.equal(toolSentence(item), 'Read §2.1 Loss');
  assert.equal(toolNote(item), 'pages 4–5 · sections/method.tex, lines 3–5');
  assert.equal(toolSummary([item, { ...item, id: 's', tool: { ...item.tool, target: 'main.tex', place: { sections: [], pages: [2, 2] } } }], () => []).text, 'Read 2 files on pages 2–5');
});

test('The context breakdown names what fills the window and adds up to what the provider counted', () => {
  const map = '<paper-map>' + 'x'.repeat(4000) + '</paper-map>';
  const session = {
    systemPrompt: 's'.repeat(8000),
    getActiveToolNames: () => ['read_file'],
    getAllTools: () => [{ name: 'read_file', description: 'd'.repeat(400), parameters: {} }, { name: 'unused', description: 'u'.repeat(9000), parameters: {} }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: map + 'Tighten the abstract.' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'r'.repeat(400) }, { type: 'toolCall', name: 'read_file', arguments: { path: 'main.tex' } }] },
      { role: 'toolResult', content: [{ type: 'text', text: 't'.repeat(2000) }, { type: 'image' }] },
      { role: 'compactionSummary', summary: 'm'.repeat(800) },
    ],
  } as any;
  const parts = contextBreakdown(session, 10000, 200000);
  const of = (id: string) => parts.find(part => part.id === id)?.tokens || 0;
  assert.deepEqual(parts.map(part => part.id), ['system', 'tools', 'map', 'messages', 'replies', 'toolCalls', 'toolResults', 'summaries', 'reserve', 'free']);
  assert.equal(parts.filter(part => part.id !== 'reserve' && part.id !== 'free').reduce((sum, part) => sum + part.tokens, 0), 10000, 'The used parts add up to the reported total');
  assert.equal(of('reserve'), COMPACTION_RESERVE);
  assert.equal(of('free'), 200000 - 10000 - COMPACTION_RESERVE);
  assert.ok(of('system') > of('map') && of('map') > of('messages'), 'The paper map is told apart from what the author wrote');
  assert.ok(of('tools') < of('replies') * 2, 'Inactive tools are not counted');
  // Near the limit, the reserve is only what is left.
  const full = contextBreakdown(session, 195000, 200000);
  assert.equal(full.find(part => part.id === 'reserve')?.tokens, 5000);
  assert.equal(full.find(part => part.id === 'free')?.tokens, 0);
});
