const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table public.cdf_members(email text primary key,name text,role text);");
 await db.exec(fs.readFileSync('supabase/migrations/20261104120449_cdf_username_login.sql','utf8'));
 await db.exec("insert into cdf_members values('a@test.invalid','A','admin','ana'),('b@test.invalid','B','vendor',null)");
 await assert.rejects(db.exec("update cdf_members set username='ana' where email='b@test.invalid'"),/duplicate/);
 await assert.rejects(db.exec("update cdf_members set username='Ana Bad' where email='b@test.invalid'"),/check constraint/);
 await db.exec('set role anon');
 await assert.rejects(db.query('select cdf_login_attempt($1)',['a'.repeat(64)]),/permission denied/);
 await assert.rejects(db.query('select * from cdf_login_attempts'),/permission denied/);
 await db.exec('reset role; set role service_role');
 for(let i=1;i<=11;i++) {const r=await db.query('select cdf_login_attempt($1) as ok',['a'.repeat(64)]);assert.equal(r.rows[0].ok,i<=10);}
 await db.exec("update cdf_login_attempts set window_start=now()-interval '6 minutes'");
 assert.equal((await db.query('select cdf_login_attempt($1) as ok',['a'.repeat(64)])).rows[0].ok,true);
 await db.close();console.log('PASS: unique/valid usernames, nullable legacy accounts, private quotas, ten-attempt limit and expiry');
})().catch(e=>{console.error(e);process.exitCode=1});
