// Network errors must be recoverable and must never become "not a member" or "feature absent".
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{execFileSync}=require('child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),mockFile=path.join(root,'.impeccable/startup-mock.js');fs.mkdirSync(path.dirname(mockFile),{recursive:true});
execFileSync(process.execPath,[path.join(__dirname,'ui-smoke.cjs')],{env:{...process.env,EXPORT_MOCK:mockFile}});
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});try{
 const ctx=await browser.newContext();await ctx.addInitScript(()=>window.__role='admin');
 await ctx.route('**/*',route=>{const u=route.request().url();if(u.includes('supabase.min.js'))return route.fulfill({body:fs.readFileSync(mockFile,'utf8'),contentType:'text/javascript'});if(u.startsWith('http://127.0.0.1'))return route.continue();return route.fulfill({body:'',contentType:'text/plain'});});
 const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:31415/');await p.waitForFunction(()=>S.loaded);
 await p.evaluate(async()=>{window.__user={id:S.uid,email:S.me.email};window.__from=sb.from.bind(sb);sb.from=table=>table==='cdf_members'?{select(){return this},eq(){return this},maybeSingle:async()=>({data:null,error:{code:'503'}})}:__from(table);await start(__user);});
 assert(await p.locator('#startupError').isVisible());assert(await p.locator('#noaccess').isHidden());
 await p.evaluate(()=>sb.from=__from);await p.locator('#startupRetry').click();await p.waitForFunction(()=>S.loaded&&S.me?.email===__user.email);
 console.log('ok membership 503 shows a retry screen; retry recovers the existing account');
 const preserved=await p.evaluate(async()=>{const before={...S.cap};sb.from=table=>{const q=__from(table);if(table==='cdf_orders'){const select=q.select.bind(q);q.select=(cols,...rest)=>cols==='completed,fulfilled_at'?{limit:async()=>({error:{code:'503'}})}:select(cols,...rest);}return q;};let refused=false;try{await detectSchema()}catch{refused=true}return {refused,before:before.retention,after:S.cap.retention};});
 assert.deepEqual(preserved,{refused:true,before:true,after:true});await p.evaluate(()=>start(__user));assert(await p.locator('#startupError').isVisible());
 await p.evaluate(()=>sb.from=__from);await p.locator('#startupRetry').click();await p.waitForFunction(()=>S.loaded&&S.cap.retention&&S.cap.requests);
 console.log('ok transient schema failure preserves known capabilities; startup retry restores the full workspace');
 const absent=await p.evaluate(async()=>{sb.from=table=>{const q=__from(table);if(table==='cdf_orders'){const select=q.select.bind(q);q.select=(cols,...rest)=>cols==='completed,fulfilled_at'?{limit:async()=>({error:{code:'42703'}})}:select(cols,...rest);}return q;};await detectSchema();const absent=!S.cap.retention;sb.from=__from;await detectSchema();return absent&&S.cap.retention;});assert(absent);
 console.log('ok a genuinely missing optional column remains supported as a legacy schema');
 const ranking=await p.evaluate(()=>__calls.filter(c=>c.rpc==='cdf_branch_ranking').every(c=>c.args.p_lat!=null&&c.args.p_lng!=null));assert(ranking);
 await p.evaluate(async()=>{sb.from=table=>table==='cdf_members'?{select(){return this},eq(){return this},maybeSingle:async()=>({data:null,error:null})}:__from(table);await start(__user)});assert(await p.locator('#noaccess').isVisible());assert(await p.locator('#startupError').isHidden());
 console.log('ok genuine non-members still receive no access; ranking detection uses valid coordinates');assert.deepEqual(errors,[]);
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
