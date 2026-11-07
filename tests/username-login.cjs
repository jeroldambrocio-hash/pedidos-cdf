// Isolated login tests: no network and no real credentials.
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
async function edge({ username = 'ANA', password = 'test-password', member = { email: 'ana@example.com' }, quota = true, quotaError = null, authError = null } = {}) {
  let handler; const calls = [];
  const service = { rpc: async () => ({ data: quota, error: quotaError }), from: () => ({ select: () => ({ eq: (k,v) => { calls.push(['lookup',v]); return { maybeSingle: async () => ({ data: member, error: null }) }; } }) }) };
  const auth = { auth: { signInWithPassword: async input => { calls.push(['auth',input]); return { error: authError, data: { session: { access_token:'access', refresh_token:'refresh' } } }; } } };
  let source = readFileSync(root + '/supabase/functions/cdf-login/index.ts','utf8').replace(/\r\n/g,'\n').replace(/^import .*;\n/gm,'').replace('export async function','async function');
  source = stripTypeScriptTypes(source);
  vm.runInNewContext(source, { createClient: (_,key) => key === 'service' ? service : auth, Deno: { env: { get: k => k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service' : 'anon' }, serve: fn => handler=fn }, Response, TextEncoder, crypto: globalThis.crypto, Uint8Array });
  const response = await handler(new Request('https://test.invalid', { method:'POST', body:JSON.stringify({username,password}) }));
  return { status:response.status, body:await response.json(), calls };
}
async function client(identity, fail = false, throws = false) {
  const calls=[], nodes={ lEmail:{value:identity},lPass:{value:'password'},lErr:{},lBtn:{} };
  let submit;
  const source=readFileSync(root+'/js/main.js','utf8');
  const part=source.slice(source.indexOf('$("loginForm").addEventListener'),source.indexOf('// Local sign-out'));
  vm.runInNewContext(part, { $: id => id === 'loginForm' ? {addEventListener:(_,fn)=>submit=fn} : nodes[id], t:k=>k, sb:{ auth:{ signInWithPassword:async c=>{calls.push(['email',c]);return {error:fail?new Error('invalid'):null};},setSession:async c=>{calls.push(['session',c]);return {error:null};}},functions:{invoke:async(n,c)=>{calls.push([n,c]);if(throws)throw Error('network');return {error:fail?Error('invalid'):null,data:fail?null:{access_token:'access',refresh_token:'refresh'}};}} } });
  await submit({preventDefault(){}}); return {calls,nodes};
}
(async()=>{
  let r=await edge(); assert.equal(r.status,200);assert.equal(r.calls[0][1],'ana');assert.deepEqual(r.body,{access_token:'access',refresh_token:'refresh'});
  r=await edge({member:null});assert.equal(r.status,401);assert.ok(r.calls[1][1].email.endsWith('@invalid.invalid'));assert.equal(JSON.stringify(r.body).includes('email'),false);
  assert.equal((await edge({authError:Error('bad password')})).status,401);
  r=await edge({quota:false});assert.equal(r.status,401);assert.equal(r.calls.length,0);
  assert.equal((await edge({quotaError:Error('database down')})).status,401);
  assert.equal((await edge({username:'bad@user'})).status,401);
  let c=await client(' ANA ');assert.equal(c.calls[0][0],'cdf-login');assert.equal(c.calls[0][1].body.username,'ana');assert.equal(c.calls[1][0],'session');assert.equal(c.nodes.lPass.value,'');
  c=await client(' Ana@Example.com ');assert.equal(c.calls[0][0],'email');assert.equal(c.calls[0][1].email,'ana@example.com');assert.equal(c.calls.length,1);
  for(const args of [['ana',true,false],['ana',false,true],['ana@example.com',true,false]]) {c=await client(...args);assert.equal(c.nodes.lErr.textContent,'badLogin');assert.equal(c.nodes.lBtn.disabled,false);assert.equal(c.nodes.lPass.value,'password');}
  console.log('PASS: username/email login, normalization, session, unknown users, bad password, quota, fail-closed and network recovery');
})().catch(e=>{console.error(e);process.exitCode=1});
