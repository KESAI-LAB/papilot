import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repo=process.env.PAPILOT_REPO||process.cwd(),base=process.env.PAPILOT_REPRO_DIR||path.dirname(new URL(import.meta.url).pathname);
process.env.PAPILOT_DATA=path.join(base,'data');
const load=(name:string)=>import(pathToFileURL(path.join(repo,name)).href);
const {default:Fastify}=await load('node_modules/fastify/fastify.js');
const {default:staticFiles}=await load('node_modules/@fastify/static/index.js');
const {chromium}=await load('engine/node_modules/playwright/index.mjs');
const {App,createServer}=await load('engine/src/server.ts');
const {taskNoteResults}=await load('src/server/note-results.ts');
const {rewriteReviewHtml,rewriteReviewJson,annotateReviewState}=await load('src/server/review.ts');
const {readyRequirements}=await load('scripts/required-tools-fixture.mjs');
const evidence=JSON.parse(fs.readFileSync(path.join(base,'results.json'),'utf8'));
const {task,items,runs}=evidence;
const app=new App(path.join(base,'paper')); await app.ready;
const engine=createServer(app); app.url=await engine.listen({host:'127.0.0.1',port:0});
const get=async(route:string)=>{const response=await fetch(app.url+route); if(!response.ok)throw Error(await response.text());return response.json();};
const client={url:app.url,token:app.csrf,get};
const host=Fastify();await host.register(staticFiles,{root:path.join(base,'web')});await host.listen({host:'127.0.0.1',port:0});
const origin=`http://127.0.0.1:${host.server.address().port}`;
const browser=await chromium.launch({channel:process.env.PAPILOT_BROWSER_CHANNEL||'chrome',headless:true});
const page=await browser.newPage({locale:'en-US',colorScheme:'light',viewport:{width:1600,height:1080}});
const errors:string[]=[], unknown:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const snapshot={version:'0.12.0-repro',csrf:'synthetic-workspace',projects:[{id:'paper',name:'Annotation link reproduction',path:path.join(base,'paper')}],tasks:[task],requests:[],runtime:{connected:true,authenticated:true,models:[]}};
await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url()),p=url.pathname;
 if(p.startsWith('/review/'))return route.fallback();
 if(p==='/api/state')return route.fulfill({json:snapshot});
 if(p==='/api/updates')return route.fulfill({json:{currentVersion:snapshot.version,latestVersion:null,phase:'idle',checkedAt:1,error:null,canUpdate:false}});
 if(p==='/api/runtime/requirements')return route.fulfill({json:readyRequirements});
 if(p==='/api/note-alternatives')return route.fulfill({json:{noteAlternatives:false}});
 if(p==='/api/indirect-changes')return route.fulfill({json:{indirectChanges:false}});
 if(p.endsWith('/items'))return route.fulfill({json:{items}});
 if(p.endsWith('/note-results'))return route.fulfill({json:{notes:await taskNoteResults(task,items,runs,client)}});
 if(p.endsWith('/note-options/preview'))return route.fulfill({json:rewriteReviewJson(await get('/api/tasks/note-links/rounds/1'),'/review/paper')});
 if(p.endsWith('/note-options'))return route.fulfill({json:{key:url.searchParams.get('key'),round:1,options:[],locked:'Options are not available for this source range yet.'}});
 if(p.endsWith('/files'))return route.fulfill({json:{document:'main.tex',files:[]}});
 if(p.endsWith('/skills'))return route.fulfill({json:{skills:[]}});
 if(p.endsWith('/git'))return route.fulfill({json:{files:[],branch:'main'}});
 if(p.endsWith('/manuscript'))return route.fulfill({json:{annotations:[],build:{status:'idle'},git:{files:[]}}});
 if(p.endsWith('/events'))return route.fulfill({contentType:'text/event-stream',body:': synthetic workspace\n\n'});
 if(p.endsWith('/pdf')){if(url.searchParams.get('metadata')==='1')return route.fulfill({json:{url:p+'?round=1&build=synthetic'}});return route.fulfill({contentType:'application/pdf',body:fs.readFileSync(path.join(base,'after.pdf'))});}
 unknown.push(p);return route.fulfill({status:404,json:{error:'Unexpected reproduction request '+p}});
});
const prefix='/review/paper';
await page.route('**/review/**',async route=>{
 const url=new URL(route.request().url()),relative=url.pathname.slice(prefix.length);
 if(relative==='/')return route.fulfill({contentType:'text/html',body:rewriteReviewHtml(fs.readFileSync(path.join(base,'engine-web','index.html'),'utf8'),prefix)});
 if(relative.startsWith('/assets/'))return route.fulfill({path:path.join(base,'engine-web',relative),contentType:relative.endsWith('.js')?'text/javascript':relative.endsWith('.css')?'text/css':'application/octet-stream'});
 const request=route.request(),response=await fetch(app.url+relative+url.search,{method:request.method(),...(request.method()==='POST'?{headers:{'content-type':'application/json','x-review-token':app.csrf},body:request.postData()}: {})});
 const type=response.headers.get('content-type')||'application/octet-stream';
 if(type.includes('application/json')){let value=await response.json();if(relative.endsWith('/state'))value=annotateReviewState(value,[task]);return route.fulfill({status:response.status,json:rewriteReviewJson(value,prefix)});}
 return route.fulfill({status:response.status,contentType:type,body:Buffer.from(await response.arrayBuffer())});
});
try{
 await page.goto(origin);
 const viewer=page.frameLocator('.review-frame');
 await viewer.locator('.change[data-stop]').first().waitFor({timeout:30000});
 await viewer.locator('.papilot-note-links button').first().waitFor({timeout:30000});
 await page.locator('[data-note-result="request-1:7"]').waitFor();
 const changes=await viewer.locator('.change[data-stop]').evaluateAll(elements=>elements.map(e=>({stop:e.getAttribute('data-stop'),units:e.getAttribute('data-units'),notes:[...e.querySelectorAll('.papilot-note-links button')].map(b=>b.getAttribute('aria-label')),text:e.textContent?.slice(0,180)})));
 fs.writeFileSync(path.join(base,'browser-changes.json'),JSON.stringify(changes,null,2));
 await page.screenshot({path:path.join(base,'overview.png'),fullPage:true});
 for(const [index,label] of [[2,'citation'],[6,'heading'],[7,'caption']] as const){
   await page.locator(`[data-note-result="request-1:${index}"]`).click();
   const hint=page.locator('#review-panel .review-note-controls').getByText('No linked change',{exact:true});await hint.waitFor();
   const unit=evidence.evidence[index].units[0].id;
   const target=viewer.locator(`.change[data-units~="${unit}"]`).first();await target.scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(base,`${label}-unlinked.png`),fullPage:true});
 }
 await page.locator('[data-note-result="request-1:0"]').click();
 await viewer.locator('[data-papilot-link="target"]').waitFor();
 await page.screenshot({path:path.join(base,'plain-linked.png'),fullPage:true});
 if(errors.length || unknown.length)throw Error(JSON.stringify({errors,unknown}));
 const report={changes,errors,unknown,unlinkedNotes:evidence.results.filter(n=>n.state==='unmatched').map(n=>n.note.id)};
 fs.writeFileSync(path.join(base,'browser.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}catch(error){await page.screenshot({path:path.join(base,'browser-error.png'),fullPage:true});console.log(JSON.stringify({errors,unknown}));throw error;}
finally{await browser.close();await host.close();await engine.close();await app.close();}
