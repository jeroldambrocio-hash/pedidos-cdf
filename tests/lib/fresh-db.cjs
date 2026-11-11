// A throwaway database built from every migration, for tests that need the finished schema.
// Supabase's own schemas (auth, storage, vault, pg_net) are minimal stand-ins, exactly as in
// tests/fresh-install.cjs: pg_net's http_post only records the call, so nothing is ever sent anywhere.
// Works on PGlite (one session) and on a real local PostgreSQL (several sessions, for concurrency tests).
const fs = require('fs'), path = require('path');
const dir = path.resolve(__dirname, '..', '..', 'supabase', 'migrations');

const STANDINS = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create role supabase_admin; create role postgres_role;
  create schema auth; create schema storage; create schema vault; create schema net; create schema extensions;
  grant usage on schema auth, storage to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  -- as Supabase does: new functions are runnable by every API role unless a migration revokes it
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create table auth.users(id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
  create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
  create function auth.role() returns text language sql stable as $$select coalesce(auth.jwt()->>'role','anon')$$;
  create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now());
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
`;

// File name order, except the price migration, which production applied before 037 (see fresh-install.cjs).
function migrationFiles() {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const securePrices = files.splice(files.findIndex((f) => f.startsWith('20261028012537')), 1)[0];
  files.splice(files.findIndex((f) => f.startsWith('037_')), 0, securePrices);
  return files;
}

// exec(sql) runs a script of several statements. `until` stops before the first file whose name contains it.
async function build(exec, { until } = {}) {
  await exec(STANDINS);
  for (const f of migrationFiles()) {
    if (until && f.includes(until)) break;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/create extension if not exists pg_net[^;]*;/gi, '');
    try { await exec(sql); } catch (e) { throw new Error(`migration ${f}: ${e.code || ''} ${e.message}`); }
  }
}
const migration = (part) => fs.readFileSync(path.join(dir, migrationFiles().find((f) => f.includes(part))), 'utf8');

const TEAM = `insert into public.cdf_members(email,name,role) values
  ('admin@t','Admin','admin'),('admin2@t','Admin Two','admin'),('flo@t','Flo','vendor'),('dri@t','Dri','carrier');`;
const SUBS = { 'admin@t': 'a0000000-0000-0000-0000-0000000000a1', 'admin2@t': 'a0000000-0000-0000-0000-0000000000a2',
  'flo@t': 'a0000000-0000-0000-0000-0000000000f1', 'dri@t': 'a0000000-0000-0000-0000-0000000000d1' };
const claims = (email) => JSON.stringify({ email, sub: SUBS[email], role: 'authenticated' });

module.exports = { build, migration, migrationFiles, TEAM, claims };
