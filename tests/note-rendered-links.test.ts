import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PdfDocument, containsCenter, union } from '../engine/src/render/pdf.ts';
import { opcodesWithin } from '../engine/src/core/diff.ts';
import { createServer } from '../engine/src/server.ts';
import { Fixture } from '../engine/tests/ts/helpers.ts';
import { locateMark } from '../src/server/note-location.ts';
import { matchNoteChanges, taskNoteResults, type NoteRound } from '../src/server/note-results.ts';
import type { NoteSummary, Run, Task, TimelineItem } from '../src/shared.ts';
import type { ReviewClient } from '../src/server/review.ts';
import type { Rect } from '../engine/src/types.ts';

const tex = ['latexmk', 'pdflatex', 'synctex'].every(tool =>
  !spawnSync(tool, ['--version'], { stdio: 'ignore' }).error);
const file = 'paper/main.tex';
const cases = [
  ['The baseline', 'The baseline method is fast and reliable.'],
  ['The cited', String.raw`The cited method is fast according to \cite{smith}.`],
  ['The numerical', String.raw`The numerical method is fast for $\alpha > 0$.`],
  ['β', String.raw`\(\beta > 0\) means the method is fast.`],
  ['The linked', String.raw`The linked method is \href{https://example.org/fast}{fast} and reliable.`],
  ['The joint', String.raw`The joint method is fast for A \& B.`],
  ['A fast procedure', String.raw`\section[An unchanged short title]{A fast procedure}`],
  ['A fast comparison', String.raw`\begin{table}[h]
\caption{A fast comparison.}
\end{table}`],
  ['The other', String.raw`The other method cites \cite{smith} and is fast. The estimate is stable.`],
];

async function select(pdf: string, working: string, selected: string, round?: number): Promise<NoteSummary> {
  const document = new PdfDocument(pdf);
  try {
    for (let page = 0; page < document.length; page++) {
      const { bounds, lines } = document.page(page);
      for (const line of lines) {
        const start = line.text.indexOf(selected);
        if (start < 0) continue;
        const stop = selected === 'The other' ? line.text.indexOf(' The estimate') : line.text.length;
        let offset = 0;
        const chars = line.chars.filter(char => {
          const index = offset;
          offset += char.text.length;
          return index >= start && index < stop;
        });
        const quote = chars.map(char => char.text).join('');
        const box = chars.map(char => char.rect).reduce(union);
        const rect: Rect = [
          (box[0] - bounds[0]) / (bounds[2] - bounds[0]),
          (box[1] - bounds[1]) / (bounds[3] - bounds[1]),
          (box[2] - bounds[0]) / (bounds[2] - bounds[0]),
          (box[3] - bounds[1]) / (bounds[3] - bounds[1]),
        ];
        const located = await locateMark(document, { pdf, page, rect, rects: [rect], selected: quote, sourceDir: path.dirname(file), working }, { containsCenter, opcodesWithin });
        const source = located?.source;
        assert.ok(source, quote);
        assert.equal(source.file, file, quote);
        return { where: round ? `Round ${round} · After` : `Page ${page + 1}`, quote, comment: 'Revise.', anchor: { round, sources: [source] } };
      }
    }
    throw new Error(`Missing PDF text: ${selected}`);
  } finally {
    document.close();
  }
}

test('rendered LaTeX annotations and follow-ups link to the exact review changes', { skip: !tex && 'needs TeX and SyncTeX', timeout: 120000 }, async () => {
  const fixture = new Fixture();
  const before = String.raw`\documentclass{article}
\usepackage{hyperref}
\begin{document}
` + cases.map(([, source]) => source).join('\n\n') + String.raw`

\begin{thebibliography}{1}
\bibitem{smith} Smith, An example.
\end{thebibliography}
\end{document}
`;
  // Change only the visible hyperlink label. The target contains the same word.
  const revise = (source: string) => source.replaceAll('fast', 'efficient').replace('example.org/efficient', 'example.org/fast');
  const after = revise(before).replace('stable', 'robust');
  fixture.write(file, before);
  fixture.repo.run(['add', file]);
  fixture.repo.run(['commit', '-qm', 'Rendered notes fixture']);
  const app = fixture.app(), server = createServer(app);
  try {
    await app.ready;
    app.url = await server.listen({ host: '127.0.0.1', port: 0 });
    const client: Pick<ReviewClient, 'url' | 'get'> = { url: app.url, async get<T>(route: string) {
      const response = await fetch(app.url + route);
      assert.equal(response.status, 200, route);
      return await response.json() as T;
    } };
    const work = app.tasks.create('rendered-notes', 'Rendered notes', [], ['paper'], true);
    const publish = async (source: string, number: number) => {
      fixture.write(file, source, work.worktree);
      const job = app.publisher.submit(work.name, undefined, false);
      await app.publisher.join();
      assert.equal(app.publisher.job(job.id).status, 'done');
      return app.review.round(work.name, number);
    };
    const first = await publish(after, 1);
    const pdf = (key: string) => JSON.parse(fs.readFileSync(path.join(app.state, 'cache/builds', key, 'result.json'), 'utf8')).pdf as string;
    const route = `/api/tasks/${work.name}/rounds/`;
    const detail = await client.get<NoteRound>(route + '1');
    assert.ok(detail.units.every(unit => !unit.new_context));
    const baseline = pdf(first.summary.builds![0]);
    for (const [prefix, source] of cases) {
      const note = await select(baseline, fixture.root, prefix);
      const expectedLine = before.slice(0, before.indexOf(source) + (prefix === 'A fast comparison' ? source.indexOf('\n') + 1 : 0)).split('\n').length;
      assert.deepEqual(note.anchor!.sources[0].lines, [expectedLine, expectedLine], prefix);
      const linked = matchNoteChanges(note, detail, {}).flatMap(change => change.units);
      const [changed] = detail.units.filter(unit => linked.includes(unit.id));
      assert.equal(linked.length, 1, prefix);
      assert.match(changed.old_text, /fast/, prefix);
      assert.equal(changed.new_text, revise(changed.old_text), prefix);
    }

    const proposed = pdf(first.summary.builds!.at(-1)!);
    const followUp = await select(proposed, work.worktree, 'The baseline', 1);
    const sameProposal = await select(proposed, work.worktree, 'The linked', 1);
    const acceptedFollowUp = await select(proposed, work.worktree, 'The cited', 1);
    const sibling = detail.units.find(unit => unit.old_text === 'stable');
    const cited = matchNoteChanges(await select(baseline, fixture.root, 'The cited'), detail, {}).flatMap(change => change.units);
    assert.ok(sibling);
    assert.equal(cited.length, 1);
    await app.review.decide(work.name, { round: 1, action: 'accept', changes: [sibling.id, ...cited] });
    const next = after.replace('The baseline method is efficient', 'The baseline method is scalable')
      .replace('The baseline method is efficient', 'The baseline method is robust')
      .replace('The cited method is efficient', 'The cited method is precise');
    await publish(next, 2);
    const task = { id: work.name, name: work.name, status: 'reviewing', review: { round: 2 } } as Task;
    const item = { id: 'follow-up', type: 'user', meta: { notes: [followUp, sameProposal, acceptedFollowUp] } } as TimelineItem;
    const run = { id: item.id, status: 'completed', reviewRound: 2 } as Run;
    const [result, unchanged, acceptedResult] = await taskNoteResults(task, [item], [run], client as ReviewClient);
    const latest = await client.get<NoteRound>(route + '2');
    assert.notEqual(latest.before, detail.before, 'accepting another change in the same file moved the baseline');
    const linked = result.changes.flatMap(change => change.units);
    assert.deepEqual(latest.units.filter(unit => linked.includes(unit.id)).map(unit => [unit.old_text, unit.new_text]), [['fast', 'scalable']]);
    const acceptedLinks = acceptedResult.changes.flatMap(change => change.units);
    assert.deepEqual(latest.units.filter(unit => acceptedLinks.includes(unit.id)).map(unit => [unit.old_text, unit.new_text]), [['efficient', 'precise']]);
    assert.equal(unchanged.state, 'unmatched', 'an unchanged pending proposal is not a response to a new note');
  } finally {
    await server.close();
    await fixture.close();
  }
});
