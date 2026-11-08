// Migration 029 on a temporary PostgreSQL (no production): only admins can read cdf_lalamove, nobody writes
// from the browser, and deleting an order removes its row.
// npm i --prefix .test-tools @electric-sql/pglite@0.5.12 && NODE_PATH=.test-tools/node_modules node tests/lalamove-db.cjs
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs'), path = require('path'), assert = require('assert');
const db = new PGlite();
const ok = (n) => console.log('ok ' + n);
const as = async (email, sql) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ email })}', false);`);
  try { return await db.query(sql); } finally { await db.exec('reset role;'); }
};
(async () => {
  await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
  grant usage on schema auth to authenticated, anon;
  create table public.cdf_members(email text primary key, name text, role text);
  insert into public.cdf_members values ('admin@test','A','admin'),('florist@test','F','vendor'),('driver@test','D','carrier');
  create function public.cdf_my_role() returns text language sql stable security definer set search_path='' as $$select role from public.cdf_members where email=auth.jwt()->>'email'$$;
  create function public.cdf_is_admin() returns boolean language sql stable security definer set search_path='' as $$select coalesce(public.cdf_my_role()='admin',false)$$;
  create function public.cdf_touch() returns trigger language plpgsql set search_path='' as $$begin new.updated_at=now(); return new; end$$;
  create table public.cdf_orders(id uuid primary key, num text);
  insert into public.cdf_orders values ('11111111-1111-1111-1111-111111111111','1'),('22222222-2222-2222-2222-222222222222','2');
  create publication supabase_realtime;
  -- as in Supabase: new tables are open to every API role by default (the migration narrows it)
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/029_cdf_lalamove.sql'), 'utf8'));
  ok('migration applies');

  // The edge function writes with the service role
  await db.exec(`set role service_role;
    insert into public.cdf_lalamove(order_id, lat, lng, place, quotation_id, quote_total) values ('11111111-1111-1111-1111-111111111111', 14.6507, 121.0494, 'QC', 'q1', 120);
    reset role;`);
  const before = (await db.query(`select updated_at from public.cdf_lalamove`)).rows[0].updated_at;
  await db.exec(`select pg_sleep(0.01); update public.cdf_lalamove set status='ASSIGNING_DRIVER'`);
  assert((await db.query(`select updated_at from public.cdf_lalamove`)).rows[0].updated_at > before);
  assert.equal((await db.query(`select env from public.cdf_lalamove`)).rows[0].env, 'sandbox');
  ok('service role writes, sandbox by default, updated_at moves');

  assert.equal((await as('admin@test', 'select * from public.cdf_lalamove')).rows.length, 1);
  assert.equal((await as('florist@test', 'select * from public.cdf_lalamove')).rows.length, 0);
  assert.equal((await as('driver@test', 'select * from public.cdf_lalamove')).rows.length, 0);
  ok('only admins read');

  for (const who of ['admin@test', 'florist@test']) {
    await assert.rejects(as(who, `insert into public.cdf_lalamove(order_id) values ('22222222-2222-2222-2222-222222222222')`));
    await assert.rejects(as(who, `update public.cdf_lalamove set quote_total=1`));
    await assert.rejects(as(who, `delete from public.cdf_lalamove`));
  }
  await db.exec(`set role anon;`);
  await assert.rejects(db.query('select * from public.cdf_lalamove'));
  await db.exec(`reset role;`);
  ok('no writes from the browser, nothing for anon');

  await assert.rejects(db.exec(`update public.cdf_lalamove set env='staging'`));
  await db.exec(`delete from public.cdf_orders where num='1'`);
  assert.equal((await db.query('select count(*)::int n from public.cdf_lalamove')).rows[0].n, 0);
  ok('env checked, row goes with its order');

  const pub = await db.query(`select tablename from pg_publication_tables where pubname='supabase_realtime'`);
  assert(pub.rows.some((r) => r.tablename === 'cdf_lalamove'));
  ok('realtime');
})().catch((e) => { console.error(e); process.exit(1); });
