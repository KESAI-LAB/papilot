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
    class Writer extends WriterAgent { available() { return [faux.getModel()] as never; } }
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
