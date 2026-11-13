const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const s=fs.readFileSync(require('path').join(__dirname,'../js/public-order.js'),'utf8');
const api=s.slice(s.indexOf('  class ApiError'),s.indexOf('  const post ='));
const text=s.slice(s.indexOf('  const errorText ='),s.indexOf('  // ---------- pickup shops'));
async function check(rid,expected){const ctx={fetch:async()=>({ok:false,json:async()=>({error:'server',rid})}),t:k=>k};vm.createContext(ctx);vm.runInContext(api+text+';this.run=async()=>{try{await call("x",{})}catch(e){return errorText(e)}}',ctx);assert.equal(await ctx.run(),expected);}
(async()=>{await check('Abcd_12345','poErrServer (Ref: Abcd_12345)');await check('<script>','poErrServer');console.log('ok server reference reaches the displayed error; malformed references are ignored');})().catch(e=>{console.error(e);process.exit(1)});

