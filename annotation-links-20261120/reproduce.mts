import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const repo = process.env.PAPILOT_REPO || process.cwd();
const base = process.env.PAPILOT_REPRO_DIR || path.dirname(new URL(import.meta.url).pathname);
process.env.PAPILOT_DATA = path.join(base, 'data');
const load = (name: string) => import(pathToFileURL(path.join(repo, name)).href);
const { App, createServer } = await load('engine/src/server.ts');
const { PdfDocument, containsCenter, union } = await load('engine/src/render/pdf.ts');
const { opcodesWithin } = await load('engine/src/core/diff.ts');
const { locateMark } = await load('src/server/note-location.ts');
const { taskNoteResults, matchNoteChanges } = await load('src/server/note-results.ts');
const root = path.join(base, 'paper');
fs.mkdirSync(root, { recursive: true });
const cases = [
  { id: 'plain', title: 'Plain text', source: 'The baseline method is fast and reliable.', prefix: 'The baseline', comment: 'Replace fast with efficient in the baseline sentence.' },
  { id: 'emphasis', title: 'Emphasis', source: String.raw`The formatted method is \emph{fast} and reliable.`, prefix: 'The formatted', comment: 'Replace fast with efficient in the formatted sentence.' },
  { id: 'citation', title: 'Citation', source: String.raw`Our cited method is fast according to \cite{smith}.`, prefix: 'Our cited', comment: 'Replace fast with efficient in the cited sentence.' },
  { id: 'math', title: 'Inline math', source: String.raw`The mathematical method is fast for $\alpha > 0$.`, prefix: 'The mathematical', comment: 'Replace fast with efficient in the sentence with alpha.' },
  { id: 'hyperlink', title: 'Hyperlink', source: String.raw`The linked method is \href{https://example.org}{fast} and reliable.`, prefix: 'The linked', comment: 'Replace fast with efficient in the hyperlink.' },
  { id: 'escape', title: 'Escaped symbol', source: String.raw`The joint method is fast for A \& B.`, prefix: 'The joint', comment: 'Replace fast with efficient in the sentence with an ampersand.' },
  { id: 'heading', title: 'A fast procedure', source: 'This section describes the procedure.', prefix: 'A fast procedure', comment: 'Replace fast with efficient in the section heading.' },
  { id: 'caption', title: 'Table caption', source: String.raw`\begin{table}[h]\centering
\caption{A fast comparison.}
\begin{tabular}{ll}Method & Value \\ Baseline & 1\end{tabular}
\end{table}`, prefix: 'A fast comparison.', comment: 'Replace fast with efficient in the table caption.' },
];
const before = String.raw`\documentclass{article}
\usepackage[margin=1in]{geometry}
\usepackage{hyperref}
\begin{document}
` + cases.map(c => `\\section{${c.title}}\n${c.source}\n`).join('\n') + String.raw`
\begin{thebibliography}{1}
\bibitem{smith} A. Smith. A synthetic reference. 2020.
\end{thebibliography}
\end{document}
`;
const after = before.replaceAll('fast', 'efficient');
fs.writeFileSync(path.join(root, 'main.tex'), before);
fs.writeFileSync(path.join(root, '.gitignore'), '*.aux\n*.log\n*.out\n*.pdf\n*.synctex.gz\n');
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' }).toString().trim();
git('init', '-q'); git('config', 'user.name', 'Reproduction'); git('config', 'user.email', 'repro@localhost'); git('config', 'commit.gpgsign', 'false'); git('add', '.'); git('commit', '-qm', 'Create synthetic annotation cases');
const app = new App(root); await app.ready;
const server = createServer(app); app.url = await server.listen({host: '127.0.0.1', port: 0});
const request = async (route: string, body?: unknown) => {
  const response = await fetch(app.url + route, body === undefined ? undefined : {method: 'POST', headers: {'content-type': 'application/json', 'x-review-token': app.csrf}, body: JSON.stringify(body)});
  const value = await response.json(); if (!response.ok) throw Error(JSON.stringify(value)); return value;
};
const client = {url: app.url, token: app.csrf, get: request, post: request};
try {
  const created = await request('/api/tasks', {name: 'note-links', title: 'Resolve all eight annotations', files: ['main.tex'], deferred: true});
  fs.writeFileSync(path.join(created.worktree, 'main.tex'), after);
  const job = await request('/api/tasks/note-links/publish', {indirect: false});
  console.log(JSON.stringify({phase:'publishing', job:job.job, root}));
  let status;
  for (let attempt=0; attempt<240; attempt++) { status=await request('/api/jobs/'+job.job); if (['done','failed'].includes(status.status)) break; await new Promise(r=>setTimeout(r,500)); }
  fs.writeFileSync(path.join(base, 'publish.json'), JSON.stringify(status,null,2));
  if (status.status !== 'done') throw Error(JSON.stringify(status));
  const detail = await request('/api/tasks/note-links/rounds/1');
  const state = await request('/api/tasks/note-links/state?round=1');
  fs.writeFileSync(path.join(base, 'round.json'), JSON.stringify(detail,null,2));
  fs.writeFileSync(path.join(base, 'state.json'), JSON.stringify(state,null,2));
  const walk = (dir: string): string[] => fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]);
  const cached = walk(path.join(app.state,'cache','builds'));
  const pdfs = cached.filter(p=>p.endsWith('.pdf')&&!p.includes('/passes/'));
  let oldPdf='', newPdf='';
  for(const pdf of pdfs) { const document=new PdfDocument(pdf); const text=Array.from({length:document.length},(_,i)=>document.page(i).lines.map(l=>l.text).join('\n')).join('\n'); if(text.includes('The baseline method is fast')) oldPdf=pdf; if(text.includes('The baseline method is efficient')) newPdf=pdf; document.close(); }
  if(!oldPdf || !newPdf) throw Error('Cannot find before/after PDFs: '+pdfs.join(','));
  const document = new PdfDocument(oldPdf);
  const notes=[]; const evidence=[];
  for(const c of cases) {
    let found;
    for(let i=0;i<document.length;i++) for(const line of document.page(i).lines) if(line.text.includes(c.prefix)) found={page:i,line};
    if(!found) throw Error('Missing PDF text '+c.prefix);
    let chars=found.line.chars;
    if(['heading','caption'].includes(c.id)) { const at=found.line.text.indexOf(c.prefix); let offset=0; chars=chars.filter(char=>{const take=offset>=at;offset+=char.text.length;return take;}); }
    const rect=chars.map(char=>char.rect).reduce(union);
    const bounds=document.page(found.page).bounds; const normalized=[(rect[0]-bounds[0])/(bounds[2]-bounds[0]),(rect[1]-bounds[1])/(bounds[3]-bounds[1]),(rect[2]-bounds[0])/(bounds[2]-bounds[0]),(rect[3]-bounds[1])/(bounds[3]-bounds[1])];
    const quote=chars.map(c=>c.text).join('');
    const located = await locateMark(document, {pdf:oldPdf,page:found.page,rect:normalized,rects:[normalized],selected:quote, working:root}, {containsCenter,opcodesWithin});
    const expectedLine=before.split('\n').findIndex(line=>c.id==='heading'?line.includes('\\section{A fast procedure}'):c.id==='caption'?line.includes('\\caption{A fast comparison.}'):line===c.source)+1;
    const source=located?.source;
    const note={id:c.id,where:`Page ${found.page+1} · ${source?.file || 'main.tex'} line ${source?.lines[0] || expectedLine}`,quote,comment:c.comment,anchor:{sources:source?[{file:source.file,lines:source.lines}]:[{file:'main.tex',lines:[expectedLine,expectedLine]}]},paper:{page:found.page,rects:[normalized]}};
    notes.push(note);
    const links=matchNoteChanges(note,detail,state.decisions);
    const narrow=matchNoteChanges({...note,quote:'fast'},detail,state.decisions);
    evidence.push({id:c.id,quote,source,expectedLine,links,narrowWordLinks:narrow, units:detail.units.filter(u=>u.old_start<=expectedLine&&u.old_end>=expectedLine).map(u=>({id:u.id,kind:u.kind,old_text:u.old_text,new_text:u.new_text,text_ops:u.text_ops,hasContext:!!u.old_context}))});
  }
  const task={id:'note-links-task',projectId:'paper',name:'note-links',title:'Resolve all eight annotations',status:'reviewing',createdAt:1,updatedAt:1,review:{round:1,state:'reviewing',counts:{pending:detail.units.length}}};
  const items=[{id:'request-1',taskId:task.id,type:'user',text:'Replace fast with efficient at each annotated location.',createdAt:1,meta:{notes}},{id:'response-1',taskId:task.id,type:'assistant',text:'Changed each annotated occurrence of fast to efficient.',createdAt:2}];
  const runs=[{id:'request-1',taskId:task.id,reviewRound:1,status:'completed'}];
  const results=await taskNoteResults(task,items,runs,client);
  fs.writeFileSync(path.join(base,'results.json'),JSON.stringify({task,items,runs,results,evidence,oldPdf,newPdf,appState:app.state},null,2));
  fs.copyFileSync(oldPdf,path.join(base,'before.pdf'));fs.copyFileSync(newPdf,path.join(base,'after.pdf'));
  fs.writeFileSync(path.join(base,'before.tex'),before);fs.writeFileSync(path.join(base,'after.tex'),after);
  const roundDir=path.join(app.state,'rounds','note-links','001');fs.cpSync(roundDir,path.join(base,'rendered'),{recursive:true});
  console.log(JSON.stringify(evidence.map(e=>({case:e.id,quote:e.quote,source:e.source?.lines,links:e.links.length,narrow:e.narrowWordLinks.length,units:e.units})),null,2));
  document.close();
} finally { await server.close(); await app.close(); }
