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
  console.log(`\n${files.length} migrations applied to an empty database`);
})().catch((e) => { console.error(e); process.exit(1); });
