import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
const repo=process.env.PAPILOT_REPO||process.cwd(),base=process.env.PAPILOT_REPRO_DIR||path.dirname(new URL(import.meta.url).pathname);process.env.PAPILOT_DATA=path.join(base,'data');
const load=(name:string)=>import(pathToFileURL(path.join(repo,name)).href);
const {App,createServer}=await load('engine/src/server.ts');const {taskNoteResults,matchNoteChanges}=await load('src/server/note-results.ts');
const {PdfDocument,containsCenter,union}=await load('engine/src/render/pdf.ts');const {locateMark}=await load('src/server/note-location.ts');const {opcodesWithin}=await load('engine/src/core/diff.ts');
const evidence=JSON.parse(fs.readFileSync(path.join(base,'results.json'),'utf8'));
const app=new App(path.join(base,'paper'));await app.ready;const server=createServer(app);app.url=await server.listen({host:'127.0.0.1',port:0});
const request=async(route:string,body?:unknown)=>{const r=await fetch(app.url+route,body===undefined?undefined:{method:'POST',headers:{'content-type':'application/json','x-review-token':app.csrf},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;};
try{
 const info=await request('/api/tasks/note-links');
 const pdf=new PdfDocument(evidence.newPdf);const p=pdf.page(0);const line=p.lines.find(l=>l.text.startsWith('The baseline method'))!;
 const rect=line.chars.map(c=>c.rect).reduce(union),b=p.bounds;const normalized=[(rect[0]-b[0])/(b[2]-b[0]),(rect[1]-b[1])/(b[3]-b[1]),(rect[2]-b[0])/(b[2]-b[0]),(rect[3]-b[1])/(b[3]-b[1])];
 const located=await locateMark(pdf,{pdf:evidence.newPdf,page:0,rect:normalized,rects:[normalized],selected:line.text,working:info.worktree},{containsCenter,opcodesWithin});
 const note={id:'plain-followup',where:`Round 1 · Page 1 · main.tex line ${located.source.lines[0]}`,quote:located.quote,comment:'Replace efficient with scalable in this sentence.',anchor:{round:1,sources:[{file:located.source.file,lines:located.source.lines}]},paper:{round:1,page:0,rects:[normalized]}};
 const file=path.join(info.worktree,'main.tex'),text=fs.readFileSync(file,'utf8');if(!text.includes('The baseline method is efficient'))throw Error('First round source is missing');
 fs.writeFileSync(file,text.replace('The baseline method is efficient','The baseline method is scalable'));
 const job=await request('/api/tasks/note-links/publish',{indirect:false});let status;
 for(let i=0;i<240;i++){status=await request('/api/jobs/'+job.job);if(['done','failed'].includes(status.status))break;await new Promise(r=>setTimeout(r,500));}
 if(status.status!=='done')throw Error(JSON.stringify(status));
 const detail=await request('/api/tasks/note-links/rounds/2'),state=await request('/api/tasks/note-links/state?round=2');
 const task={...evidence.task,review:{...evidence.task.review,round:2}};
 const items=[...evidence.items,{id:'request-2',taskId:task.id,type:'user',text:'Further revise the first sentence.',createdAt:3,meta:{notes:[note]}},{id:'response-2',taskId:task.id,type:'assistant',text:'Changed efficient to scalable in the annotated sentence.',createdAt:4}];
 const runs=[...evidence.runs,{id:'request-2',taskId:task.id,status:'completed',reviewRound:2}];
 const results=await taskNoteResults(task,items,runs,{url:app.url,token:app.csrf,get:request});
 const blocks=[...detail.sections.flatMap(s=>s.blocks.filter(b=>b.kind==='change')),...detail.loose];
 const comparison={note,located,baseline:detail.before,round:2,units:detail.units.filter(u=>u.old_start===6).map(u=>({id:u.id,old_text:u.old_text,new_text:u.new_text,old_start:u.old_start,text_ops:u.text_ops})),beforeText:blocks[0].before.flatMap(s=>s.text||[]).map(l=>l.text),afterText:blocks[0].after.flatMap(s=>s.text||[]).map(l=>l.text),result:results.at(-1)};
 fs.writeFileSync(path.join(base,'followup-results.json'),JSON.stringify({task,items,runs,results,comparison},null,2));fs.writeFileSync(path.join(base,'round-2.json'),JSON.stringify(detail,null,2));
 fs.cpSync(path.join(app.state,'rounds','note-links','002'),path.join(base,'rendered-2'),{recursive:true});
 console.log(JSON.stringify(comparison,null,2));pdf.close();
}finally{await server.close();await app.close();}
