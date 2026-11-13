const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict'),{execFileSync}=require('child_process');
const {chromium}=require('playwright'),root=path.resolve(__dirname,'..');
const mockFile=path.join(root,'.impeccable/review/mock-completed.js');fs.mkdirSync(path.dirname(mockFile),{recursive:true});
execFileSync(process.execPath,[path.join(__dirname,'ui-smoke.cjs')],{env:{...process.env,EXPORT_MOCK:mockFile}});
const mock=fs.readFileSync(mockFile,'utf8'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://x').pathname==='/'?'index.html':new URL(req.url,'http://x').pathname);if(!file.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(file,(e,b)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(file.endsWith('.html')?String(b).replace(/ integrity="[^"]+"/g,''):b);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'chrome'});const errors=[];
try{const ctx=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});await ctx.addInitScript(()=>{window.__role='admin';localStorage.setItem('cdf-lang','en')});
await ctx.route('**/*',r=>r.request().url().includes('supabase.min.js')?r.fulfill({body:mock,contentType:'text/javascript'}):r.request().url().startsWith('http://127.0.0.1')?r.continue():r.fulfill({body:'',contentType:'text/css'}));
const p=await ctx.newPage();p.setDefaultTimeout(8000);p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:'+server.address().port+'/');await p.waitForFunction(()=>S.loaded);
const id=await p.evaluate(()=>S.orders.find(o=>o.num==='0127').id);assert.equal(await p.locator('.entry[data-id="'+id+'"] .when b').innerText(),'11:00 PM');
const times=await p.evaluate(()=>{const slot=slotPicker('08:00 - 20:30');return {from:slot.querySelectorAll('select')[0].selectedOptions[0].textContent,to:slot.querySelectorAll('select')[1].selectedOptions[0].textContent,stored:slot.value(),req:reqWhen({date:S.today,slot:'17:00 - 19:00'}),chat:clock('2026-11-13T12:00:00Z'),spanish:formatDateTime12('2026-11-13T12:30:00Z','es')};});
assert.equal(times.from,'8:00 AM');assert.equal(times.to,'8:30 PM');assert.equal(times.stored,'8:00 - 20:30');assert.match(times.req,/5:00 PM - 7:00 PM/);assert.equal(times.chat,'8:00 PM');assert.match(times.spanish,/8:30 PM$/);console.log('ok timeline, order picker, requests, chat and Spanish timestamps use 12 hours; stored slots stay unchanged');
assert.deepEqual(errors,[]);console.log('ok paid alone is not Completed; unknown total is not assumed paid; staff status needs no money fields; pickups work');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exit(1)});

