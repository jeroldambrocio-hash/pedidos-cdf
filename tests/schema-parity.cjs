// F09: reconstruct the schema from migrations, then compare the live catalog export with --actual FILE.
// Also proves that changing a function body, either RLS expression, permissiveness or column grants is detected.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {build}=require('./lib/fresh-db.cjs');
const {differences}=require('./lib/schema-parity.cjs');
const SQL=fs.readFileSync(path.join(__dirname,'lib/manifest.sql'),'utf8');
(async()=>{
 const db=new PGlite(); await build(sql=>db.exec(sql));
 const read=async()=>(await db.query(SQL)).rows[0].manifest;
 const baseline=await read();
 const mutation=async(label,sql,part)=>{await db.exec('begin');await db.exec(sql);
   assert(differences(baseline,await read()).some(x=>x.startsWith(part)),label+' went undetected');
   await db.exec('rollback'); console.log('ok detects '+label);};
 await mutation('function body with unchanged signature',`create or replace function public.cdf_is_admin() returns boolean language sql stable security definer set search_path='' as $$select false$$`,'function_definitions');
 await mutation('RLS USING',`alter policy cdf_order_requests_admin_read on public.cdf_order_requests using (false)`,'policy_definitions');
 await mutation('RLS WITH CHECK',`create policy cdf_f09_check on public.cdf_orders for update to authenticated using (true) with check (false)`,'policy_definitions');
 await mutation('restrictive policy',`drop policy cdf_order_requests_admin_read on public.cdf_order_requests; create policy cdf_order_requests_admin_read on public.cdf_order_requests as restrictive for select to authenticated using ((select public.cdf_is_admin()))`,'policy_definitions');
 await mutation('column-only permission',`grant update(customer_name) on public.cdf_orders to anon`,'column_grants');
 await mutation('disabled trigger',`alter table public.cdf_orders disable trigger cdf_orders_push`,'trigger_definitions');
 assert.deepEqual(differences(baseline,await read()),[]);
 const write=process.argv.indexOf('--write-expected');
 if(write>=0) fs.writeFileSync(process.argv[write+1],JSON.stringify(baseline,null,2)+'\n');
 const actual=process.argv.indexOf('--actual');
 if(actual>=0){const found=JSON.parse(fs.readFileSync(process.argv[actual+1],'utf8'));
   const diffs=differences(baseline,found); if(diffs.length)console.error(diffs.join('\n'));
   assert.deepEqual(diffs,[],'live catalog differs from migrations'); console.log('ok live catalog matches all manifest sections');}
 await db.close(); console.log('all F09 checks passed');
})().catch(e=>{console.error(e);process.exit(1)});

