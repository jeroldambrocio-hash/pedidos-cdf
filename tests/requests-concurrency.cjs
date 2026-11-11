// Phase 3 under real concurrency: copies of one request arriving together, and two admins accepting the
// same request at the same moment. Starts a real, local, throwaway PostgreSQL (embedded-postgres) on
// 127.0.0.1, deleted at the end. It never connects to Supabase.
// Run: NODE_PATH=.test-tools/node_modules node tests/requests-concurrency.cjs
const assert = require('assert'), crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path');
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
    const root = await connect();
    await build((sql) => root.query(sql));
    await root.query(TEAM);
    const one = async (sql, p) => (await root.query(sql, p)).rows[0];
    const count = async (table, where = 'true') => (await one(`select count(*)::int n from ${table} where ${where}`)).n;
    const tomorrow = (await one("select ((now() at time zone 'Asia/Manila')::date + 1)::text d")).d;
    const today = (await one("select (now() at time zone 'Asia/Manila')::date::text d")).d;
    const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
    const newSession = async () => {
      const token = crypto.randomBytes(16).toString('hex');
      const { id } = await one("insert into public.cdf_upload_sessions(token_hash, ip_hash) values ($1, 'ip') returning id", [sha(token)]);
      const f = crypto.randomUUID();
      await root.query("insert into public.cdf_request_files(id, session_id, kind, path, status) values ($1, $2, 'reference', $3, 'ready')", [f, id, `${id}/${f}.jpg`]);
      return { hash: sha(token), id, file: f };
    };
    const request = (s, extra = {}) => ({ request_key: crypto.randomUUID(), lang: 'en', buyer_name: 'Jose Santos', buyer_phone: '+34612345678',
      receiver_name: 'Maria Santos', receiver_phone: '+639171234567', mode: 'pickup', date: tomorrow, slot: '11:00 - 13:00',
      description: 'Roses', payment_method: 'gcash', reference_files: [s.file], payment_proof: null, ...extra });
    // The edge function runs as the service role: here, one plain connection per copy
    const service = async () => connect();
    const submit = (c, s, r) => c.query('select public.cdf_request_submit($1, $2, $3) r', [s.hash, 'ip', JSON.stringify(r)]).then((x) => x.rows[0].r);
    const adminSession = async (email) => { const c = await connect(); await c.query("select set_config('request.jwt.claims',$1,false)", [claims(email)]); await c.query('set role authenticated'); return c; };

    // 1 · Ten copies of one request at once (double taps, retries piling up)
    { const s = await newSession(), r = request(s), conns = await Promise.all(Array.from({ length: 10 }, service));
      const results = await Promise.all(conns.map((c) => submit(c, s, r)));
      assert.equal(new Set(results.map((x) => x.id)).size, 1);
      assert.equal(results.filter((x) => !x.replayed).length, 1);
      assert.equal(await count('public.cdf_order_requests', `request_key = '${r.request_key}'`), 1);
      assert.equal(await count('public.cdf_outbox', `ref_id = '${results[0].id}'`), 1, 'one notice');
      assert.equal(await count('net.calls', `body->>'id' = '${results[0].id}'`), 1); }
    ok('10 simultaneous copies of one request: one request, one notice, every copy gets the same answer');

    // 2 · Two different requests from one session at once: the session carries one request only
    { const s = await newSession(), conns = await Promise.all([service(), service()]);
      const results = await Promise.allSettled(conns.map((c) => submit(c, s, request(s))));
      assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
      assert.match(results.find((x) => x.status === 'rejected').reason.message, /cdf_session_invalid/);
      assert.equal(await count('public.cdf_order_requests', `session_id = '${s.id}'`), 1); }
    ok('Two different requests from one session at once: one is received, the other is told the session is used');

    // 3 · Two admins accept the same request at the same moment, each with their own order
    { const s = await newSession(), { id } = await submit(await service(), s, request(s));
      const a = await adminSession('admin@t'), b = await adminSession('admin2@t'), before = await count('public.cdf_orders');
      const order = (num) => JSON.stringify({ id: crypto.randomUUID(), num, date: tomorrow, slot: '11:00 - 13:00', channel: 'Web', customer_name: 'Maria', address: 'Pickup', buyer_name: 'Jose', buyer_phone: '+34612345678' });
      const pay = JSON.stringify({ amount: 1000, method: 'cash', paid_at: today });
      const results = await Promise.allSettled([
        a.query('select public.cdf_request_accept($1,$2,$3,$4,$5) r', [id, crypto.randomUUID(), order('9001'), 2500, pay]),
        b.query('select public.cdf_request_accept($1,$2,$3,$4,$5) r', [id, crypto.randomUUID(), order('9002'), 2500, pay])]);
      assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
      assert.match(results.find((x) => x.status === 'rejected').reason.message, /cdf_request_taken/);
      assert.equal(await count('public.cdf_orders'), before + 1);
      assert.equal(await count('public.cdf_order_prices', "paid = 1000"), 1);
      const r = await one('select status, accepted_order_id from public.cdf_order_requests where id = $1', [id]);
      assert.equal(r.status, 'accepted');
      assert.equal(await count('public.cdf_orders', `id = '${r.accepted_order_id}'`), 1); }
    ok('Two admins accepting the same request at once: one order with one payment; the other admin is told it was already accepted');

    // 4 · One admin accepts while another rejects
    { const s = await newSession(), { id } = await submit(await service(), s, request(s));
      const a = await adminSession('admin@t'), b = await adminSession('admin2@t'), before = await count('public.cdf_orders');
      const results = await Promise.allSettled([
        a.query('select public.cdf_request_accept($1,$2,$3,$4,$5) r', [id, crypto.randomUUID(), JSON.stringify({ num: '9010', date: tomorrow, slot: '11:00 - 13:00', channel: 'Web', customer_name: 'M', address: 'Pickup', buyer_name: 'J', buyer_phone: '+34612345678' }), null, null]),
        b.query('select public.cdf_request_reject($1, $2) r', [id, 'No stock'])]);
      const status = (await one('select status from public.cdf_order_requests where id = $1', [id])).status;
      assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1, 'exactly one of the two wins');
      assert.equal(await count('public.cdf_orders'), before + (status === 'accepted' ? 1 : 0));
      assert.match(results.find((x) => x.status === 'rejected').reason.message, /cdf_request_closed|cdf_request_taken/); }
    ok('Accepting and rejecting at the same moment: one wins, and an order exists only if it was the acceptance');
  } finally {
    await Promise.all(open.map((c) => c.end().catch(() => {})));
    await server.stop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
