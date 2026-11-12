// Statistics only for chosen admins, under real concurrency (second review of PR #18): two admins who switch
// each other off at the same moment must not leave nobody with Statistics.
// PGlite has a single session, so this one starts a real, local, throwaway PostgreSQL (embedded-postgres):
// it listens on 127.0.0.1 only, lives in a temp folder and is deleted at the end. It never connects to Supabase.
// Run: NODE_PATH=.test-tools/node_modules node tests/stats-access-concurrency.cjs
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const { Client } = require('pg');
const { build, TEAM, claims } = require('./lib/fresh-db.cjs');

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdf-pg-')), port = 54000 + Math.floor(Math.random() * 900);
  const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'local-test-only', port, persistent: false,
    createPostgresUser: process.getuid?.() === 0, onLog: () => {}, onError: () => {} });
  await server.initialise(); await server.start();
  const open = [];
  const connect = async () => { const c = new Client({ host: '127.0.0.1', port, user: 'postgres', password: 'local-test-only', database: 'postgres' }); await c.connect(); open.push(c); return c; };
  const ok = (m) => console.log('ok ' + m);
  try {
    const db = await connect();
    console.log((await db.query('show server_version')).rows[0].server_version.replace(/^/, 'PostgreSQL '));
    await build((sql) => db.query(sql));
    await db.query(TEAM); // exactly two admins, both with Statistics
    const session = async (email) => {
      const c = await connect();
      if (email) { await c.query("select set_config('request.jwt.claims',$1,false)", [claims(email)]); await c.query('set role authenticated'); }
      return c;
    };
    const pidOf = async (c) => (await c.query('select pg_backend_pid() p')).rows[0].p;
    const waiting = async (pid) => (await db.query('select wait_event_type t from pg_stat_activity where pid=$1', [pid])).rows[0].t === 'Lock';
    const until = async (test) => { for (let i = 0; i < 200; i++) { if (await test()) return; await new Promise((r) => setTimeout(r, 25)); } throw new Error('timed out waiting'); };
    const remaining = async () => (await db.query("select count(*)::int n from public.cdf_members where role='admin' and sees_stats")).rows[0].n;
    const reset = async () => {
      await db.query("insert into public.cdf_members(email,name,role) values ('admin@t','Admin','admin'),('admin2@t','Admin Two','admin') on conflict (email) do update set role = 'admin', sees_stats = true");
      await db.query("update public.cdf_members set sees_stats = false where role = 'admin' and email not in ('admin@t','admin2@t')");
    };

    // Both orders of "A first, B while A is still open"; each is a different kind of change
    const race = async (name, stepA, stepB, expect) => {
      await reset(); assert.equal(await remaining(), 2);
      const [a, b] = await Promise.all([session(stepA.as), session(stepB.as)]);
      const pidB = await pidOf(b);
      await a.query('begin'); await b.query('begin');
      await a.query(stepA.sql);
      const pending = b.query(stepB.sql).then(() => null, (e) => e);
      await until(() => waiting(pidB));           // B really waits for A
      await a.query('commit');
      const err = await pending;
      await b.query(err ? 'rollback' : 'commit');
      assert.ok(err && expect.test(err.message), `${name}: expected ${expect}, got ${err ? err.message : 'success'}`);
      assert.equal(await remaining(), 1);
      ok(name);
    };
    await race('Two admins switch each other off at once: the second is refused and one keeps Statistics',
      { as: 'admin@t', sql: "update public.cdf_members set sees_stats = false where email = 'admin2@t'" },
      { as: 'admin2@t', sql: "update public.cdf_members set sees_stats = false where email = 'admin@t'" }, /cdf_stats_forbidden/);
    await race('Two admins demote each other at once: the second is refused',
      { as: 'admin@t', sql: "update public.cdf_members set role = 'vendor' where email = 'admin2@t'" },
      { as: 'admin2@t', sql: "update public.cdf_members set role = 'vendor' where email = 'admin@t'" }, /cdf_stats_forbidden/);
    await race('Two removals at once through the team function (service identity): the last one stays',
      { sql: "delete from public.cdf_members where email = 'admin2@t'" },
      { sql: "delete from public.cdf_members where email = 'admin@t'" }, /cdf_stats_last/);
  } finally {
    for (const c of open) await c.end().catch(() => {});
    await server.stop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
