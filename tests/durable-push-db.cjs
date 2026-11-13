// F08: actual migrations in a disposable DB; pg_net only records calls and sends nothing.
const assert=require('assert/strict'),{PGlite}=require('@electric-sql/pglite');
const {build,TEAM}=require('./lib/fresh-db.cjs');
(async()=>{
 const db=new PGlite(); await build(sql=>db.exec(sql));await db.exec(TEAM);
 const one=async(sql,params)=>(await db.query(sql,params)).rows[0];
 const hook=async(kind,extra={})=>db.query("select public.cdf_push_hook($1)",[{kind,id:'a0000000-0000-0000-0000-000000000001',...extra}]);
 for(const kind of ['message','direct','assigned','cancelled','rider','rider_failed']) await hook(kind,{to:'flo@t',status:'EXPIRED'});
 const rows=(await db.query('select * from public.cdf_outbox order by id')).rows;
 assert.equal(rows.length,6);assert(rows.every(r=>r.attempts===1&&r.payload.kind===r.kind));
 const calls=(await db.query('select body from net.calls')).rows.map(r=>r.body);
 for(const row of rows) assert(calls.some(b=>Number(b.outbox)===row.id&&b.kind===row.kind&&b.to==='flo@t'));
 console.log('ok every push kind queues before dispatch, with routing preserved and one outbox id');
 const id=rows[0].id;
 await db.query("update public.cdf_outbox set attempts=5,next_attempt_at=now()-interval '1 minute' where id=$1",[id]);
 await db.exec('select public.cdf_outbox_retry()');
 assert.equal((await one('select attempts from public.cdf_outbox where id=$1',[id])).attempts,6);
 assert.equal((await one('select public.cdf_outbox_retry() as n')).n,0);
 await db.query("update public.cdf_outbox set attempts=500,next_attempt_at=now()-interval '1 minute' where id=$1",[id]);
 await db.exec('select public.cdf_outbox_retry()');
 const later=await one('select attempts,extract(epoch from next_attempt_at-last_attempt_at) as wait from public.cdf_outbox where id=$1',[id]);
 assert.equal(later.attempts,501);assert.equal(Number(later.wait),3600);
 console.log('ok retries continue past five and five hundred attempts, with one-hour maximum backoff and no immediate retry');
 await db.query('select public.cdf_outbox_done($1)',[id]);
 await db.query("update public.cdf_outbox set next_attempt_at=now()-interval '1 minute' where id=$1",[id]);
 await db.exec('select public.cdf_outbox_retry()');
 assert.equal((await one('select attempts from public.cdf_outbox where id=$1',[id])).attempts,501);
 console.log('ok acknowledged notices never retry');
 // A synchronous enqueue failure must not erase the original event or fail its transaction.
 await db.exec("create or replace function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds int default 5000) returns bigint language plpgsql as $$begin raise exception 'network unavailable';end$$");
 await hook('direct'); const failed=await one('select * from public.cdf_outbox order by id desc limit 1');
 assert.equal(failed.attempts,1);assert.match(failed.last_error,/^dispatch_failed:/);assert.equal(failed.delivered_at,null);
 console.log('ok pg_net dispatch failure leaves a durable pending event without rolling back the business operation');
 for(const role of ['anon','authenticated']) {
  await db.exec('set role '+role);
  await assert.rejects(db.query('select public.cdf_push_hook($1)',[{kind:'direct',id:'a0000000-0000-0000-0000-000000000001'}]),/permission denied/);
  await assert.rejects(db.query('select * from public.cdf_outbox'),/permission denied/);
  await db.exec('reset role');
 }
 console.log('ok browsers cannot forge, read or send outbox events');
 await db.close();console.log('all durable push checks passed');
})().catch(e=>{console.error(e);process.exit(1)});

