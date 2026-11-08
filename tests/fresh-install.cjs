// Builds an empty database from every migration, in the order the Supabase CLI applies them
// (file name order), so a brand-new or recovered environment is proven to come up.
// Supabase's own schemas (auth, storage, vault, pg_net) are minimal stand-ins; pg_net's
// http_post only records the call, so running this never sends traffic anywhere.
// Run: NODE_PATH=.test-tools/node_modules node tests/fresh-install.cjs
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs'), path = require('path'), assert = require('assert');
const dir = path.resolve(__dirname, '..', 'supabase', 'migrations');

(async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create role supabase_admin; create role postgres_role;
    create schema auth; create schema storage; create schema vault; create schema net; create schema extensions;
    grant usage on schema auth, storage to anon, authenticated, service_role;
    -- Supabase grants the API roles table rights by default; RLS and the migrations' revokes do the limiting
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    create table auth.users(id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
    create function auth.role() returns text language sql stable as $$select coalesce(auth.jwt()->>'role','anon')$$;
    create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
    create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, secret text);
    create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(secret text, name text default null, description text default null) returns uuid
      language sql as $$insert into vault.secrets(name, secret) values (name, secret) returning id$$;
    create table net.calls(id bigint generated always as identity, url text, body jsonb, headers jsonb);
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
      returns bigint language sql as $$insert into net.calls(url, body, headers) values (url, body, headers) returning id$$;
    create function extensions.gen_random_bytes(n int) returns bytea language sql volatile
      as $$select decode(string_agg(lpad(to_hex((random()*255)::int),2,'0'),''),'hex') from generate_series(1,n)$$;
    create publication supabase_realtime;
  `);

  // Supabase CLI: files sorted by name; the version is the part before the first "_".
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    // pg_net is provided by the stand-in above; PGlite has no such extension to install.
    const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/create extension if not exists pg_net[^;]*;/gi, '');
    try { await db.exec(sql); }
    catch (e) { console.error(`FAIL ${f}: ${e.code || ''} ${e.message}`); process.exit(1); }
    console.log('ok ' + f);
  }

  // The finished schema has what the app relies on.
  const cols = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='cdf_members'")).rows.map((r) => r.column_name);
  assert(cols.includes('username'), 'cdf_members.username exists');
  const fns = (await db.query("select proname from pg_proc where proname in ('cdf_team_directory','cdf_set_my_username','cdf_member_stats')")).rows.map((r) => r.proname);
  assert.equal(new Set(fns).size, 3, 'chat, username and stats functions exist');
  console.log(`\n${files.length} migrations applied to an empty database\n`);

  // A14 · Cancelled orders, on the schema the migrations just built
  const ok = (m) => console.log('ok ' + m);
  const as = async (e) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ email: e })]); await db.exec('set role authenticated'); };
  const fails = async (sql) => { try { await db.query(sql); return false; } catch (e) { return e.message; } };
  await db.exec(`insert into public.cdf_members(email,name,role) values ('admin@t','Admin','admin'),('flo@t','Flo','vendor'),('dri@t','Dri','carrier');
    insert into public.cdf_orders(id,num,date,slot,channel,customer_name,status,delivery,vendor_email,carrier_email)
      values ('a0000000-0000-0000-0000-000000000001','C1',current_date,'10:00 - 12:00','Web','Ana','Ready','In transit','flo@t','dri@t'),
             ('a0000000-0000-0000-0000-000000000002','C2',current_date,'10:00 - 12:00','Web','Ben','Ready','Delivered','flo@t',null);`);
  const O1 = "'a0000000-0000-0000-0000-000000000001'", O2 = "'a0000000-0000-0000-0000-000000000002'";
  await as('flo@t'); assert(await fails(`select public.cdf_cancel_order(${O1},'x')`)); ok('A florist cannot cancel');
  await as('admin@t'); assert(await fails(`select public.cdf_cancel_order(${O1},'  ')`)); ok('Cancelling needs a reason');
  assert(await fails(`select public.cdf_cancel_order(${O2},'late')`)); ok('A delivered order cannot be cancelled');
  await db.exec('reset role'); const calls0 = (await db.query('select count(*)::int n from net.calls')).rows[0].n;
  await as('admin@t'); await db.query(`select public.cdf_cancel_order(${O1},'Customer called to cancel')`);
  await db.exec('reset role');
  { const r = (await db.query(`select cancelled_by, cancel_reason, status, delivery from public.cdf_orders where id=${O1}`)).rows[0];
    assert.equal(r.cancelled_by, 'admin@t'); assert.equal(r.cancel_reason, 'Customer called to cancel'); assert.equal(r.delivery, 'In transit'); }
  ok('Admin cancels with a reason; the step it was at is kept');
  { const e = (await db.query(`select kind, changes from public.cdf_order_events where order_id=${O1} order by id desc limit 1`)).rows[0];
    assert.equal(e.kind, 'cancelled'); assert.equal(e.changes.cancel_reason[1], 'Customer called to cancel'); }
  ok('History records the cancellation and its reason');
  { const to = (await db.query('select body->>\'to\' t from net.calls order by id offset $1', [calls0])).rows.map((r) => r.t).sort();
    assert.deepEqual(to, ['dri@t', 'flo@t']); }
  ok('The assigned florist and driver get a push (stand-in pg_net, nothing sent)');
  await as('dri@t'); assert.match(await fails(`select public.cdf_progress(${O1},'done')`), /cancelled/); ok('A driver cannot deliver a cancelled order');
  await as('admin@t'); assert.match(await fails(`update public.cdf_orders set delivery='Delivered' where id=${O1}`), /cancelled/); ok('Not even an admin moves its step while cancelled');
  await db.query(`update public.cdf_orders set notes='call first' where id=${O1}`); ok('Its details can still be corrected');
  { const r = (await db.query("select open_now::int n from public.cdf_member_stats() where email='dri@t'")).rows[0]; assert.equal(r.n, 0); }
  ok('A cancelled order is not open work in the team counts');
  await db.query(`select public.cdf_reinstate_order(${O1})`);
  await as('dri@t'); await db.query(`select public.cdf_progress(${O1},'done')`); ok('Reinstated, it moves on from where it was');
  await db.exec('reset role');
  assert.equal((await db.query(`select count(*)::int n from public.cdf_order_events where order_id=${O1} and kind='reinstated'`)).rows[0].n, 1); ok('Reinstating is in the history too');

  // Private messages ask cdf-push to tell the other person (stand-in pg_net, nothing sent)
  { const th = (await db.query("insert into public.cdf_direct_threads(member_a,member_b) values ('admin@t','dri@t') returning id")).rows[0].id;
    const m = (await db.query("insert into public.cdf_direct_messages(direct_id,author_email,body) values ($1,'admin@t','@Dri hola') returning id", [th])).rows[0].id;
    const c = (await db.query("select body from net.calls order by id desc limit 1")).rows[0].body;
    assert.equal(c.kind, 'direct'); assert.equal(c.id, m); }
  ok('A private message asks for a push');
})().catch((e) => { console.error(e); process.exit(1); });
