// The daily clean-up reserving an old request while an admin reopens it, under real concurrency (final review,
// 12/11/2026). Real, local, throwaway PostgreSQL (embedded-postgres) on 127.0.0.1; never connects to Supabase.
// Run: NODE_PATH=.test-tools/node_modules node tests/request-purge-concurrency.cjs
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
    await build((sql) => db.query(sql)); await db.query(TEAM);
    let n = 0;
    const oldRejected = async () => {
      n++;
      const s = (await db.query(`insert into public.cdf_upload_sessions(token_hash, ip_hash, expires_at, submitted_at) values ('t${n}', 'ip', now() - interval '200 days', now() - interval '200 days') returning id`)).rows[0].id;
      const r = (await db.query(`insert into public.cdf_order_requests(request_key, session_id, status, buyer_name, buyer_phone, receiver_name, receiver_phone, mode, date, slot, description, payment_method, fingerprint, updated_at)
        values (gen_random_uuid(), $1, 'rejected', 'Ana', '+639171234567', 'Ben', '+639171234568', 'pickup', current_date - 120, '09:00 - 11:00', 'Roses', 'gcash', 'f', now() - interval '100 days') returning id`, [s])).rows[0].id;
      await db.query(`insert into public.cdf_request_files(session_id, request_id, kind, path, status) values ($1, $2, 'reference', $3, 'ready')`, [s, r, `${s}/p.jpg`]);
      return r;
    };
    const admin = async () => { const c = await connect(); await c.query("select set_config('request.jwt.claims',$1,false)", [claims('admin@t')]); await c.query('set role authenticated'); return c; };
    const pidOf = async (c) => (await c.query('select pg_backend_pid() p')).rows[0].p;
    const waiting = async (pid) => (await db.query('select wait_event_type t from pg_stat_activity where pid=$1', [pid])).rows[0].t === 'Lock';
    const until = async (test) => { for (let i = 0; i < 200; i++) { if (await test()) return; await new Promise((r) => setTimeout(r, 25)); } throw new Error('timed out waiting'); };
    const state = async (id) => (await db.query("select r.status, r.purge_claimed_at is not null claimed, (select count(*)::int from public.cdf_request_files f where f.request_id = r.id) files from public.cdf_order_requests r where r.id = $1", [id])).rows[0];

    { // The clean-up reserves first (still open); the reopen waits for it, then is refused
      const id = await oldRejected(), clean = await connect(), a = await admin(), pidA = await pidOf(a);
      await clean.query('begin'); const paths = (await clean.query('select * from public.cdf_requests_purge_claim(50)')).rows;
      assert.equal(paths.length, 1);
      const pending = a.query('select public.cdf_request_reopen($1)', [id]).then(() => null, (e) => e);
      await until(() => waiting(pidA));
      await clean.query('commit');
      const err = await pending;
      assert.ok(err && /cdf_request_closed/.test(err.message), String(err && err.message));
      assert.deepEqual(await state(id), { status: 'rejected', claimed: true, files: 1 });
      ok('Clean-up first: the reopen at the same moment waits and is refused; the request stays reserved for deletion');
    }
    { // The reopen first (still open); the reservation waits for it, then leaves that request alone
      const id = await oldRejected(), clean = await connect(), a = await admin(), pidC = await pidOf(clean);
      await a.query('begin'); await a.query('select public.cdf_request_reopen($1)', [id]);
      const pending = clean.query('select * from public.cdf_requests_purge_claim(50)').then((r) => r.rows, (e) => e);
      await until(() => waiting(pidC));
      await a.query('commit');
      const rows = await pending;
      assert.ok(Array.isArray(rows), String(rows && rows.message));
      assert.deepEqual(await state(id), { status: 'in_review', claimed: false, files: 1 });
      ok('Reopen first: the clean-up waits, then leaves the reopened request and its photo alone');
    }
  } finally {
    for (const c of open) await c.end().catch(() => {});
    await server.stop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
