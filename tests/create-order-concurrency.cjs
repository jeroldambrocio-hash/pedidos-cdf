// Phase 1 under real concurrency: several sessions calling cdf_create_order at the same moment.
// PGlite has a single session, so this one starts a real, local, throwaway PostgreSQL (embedded-postgres):
// it listens on 127.0.0.1 only, lives in a temp folder and is deleted at the end. It never connects to Supabase.
// Run: npm i --prefix .test-tools embedded-postgres pg
//      NODE_PATH=.test-tools/node_modules node tests/create-order-concurrency.cjs
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
    const admin = await connect();
    console.log((await admin.query('show server_version')).rows[0].server_version.replace(/^/, 'PostgreSQL '));
    await build((sql) => admin.query(sql));
    await admin.query(TEAM);
    const today = (await admin.query("select (now() at time zone 'Asia/Manila')::date::text d")).rows[0].d;
    const count = async (table, where = 'true') => (await admin.query(`select count(*)::int n from ${table} where ${where}`)).rows[0].n;
    const session = async (email = 'admin@t') => {
      const c = await connect();
      await c.query("select set_config('request.jwt.claims',$1,false)", [claims(email)]);
      await c.query('set role authenticated');
      return c;
    };
    let n = 0;
    const orderRow = (extra = {}) => ({ id: crypto.randomUUID(), num: 'K' + (++n), date: today, slot: '10:00 - 12:00', channel: 'Web',
      customer_name: 'Maria', address: 'QC', buyer_name: 'Jose', buyer_phone: '+639181234567', ...extra });
    const payment = { amount: 2000, method: 'gcash', reference: 'R1', paid_at: today, proofs: [] };
    const call = (c, key, order, price = 2500, pay = payment) =>
      c.query('select public.cdf_create_order($1,$2,$3,$4) r', [key, JSON.stringify(order), price, pay && JSON.stringify(pay)]).then((r) => r.rows[0].r);
    const waiting = async (pid) => (await admin.query("select wait_event_type t from pg_stat_activity where pid=$1", [pid])).rows[0].t === 'Lock';
    const until = async (test) => { for (let i = 0; i < 200; i++) { if (await test()) return; await new Promise((r) => setTimeout(r, 25)); } throw new Error('timed out waiting'); };
    const pidOf = async (c) => (await c.query('select pg_backend_pid() p')).rows[0].p;

    // 1 · Twelve sessions send the very same request at once (double tap, retries piling up)
    { const sessions = await Promise.all(Array.from({ length: 12 }, () => session())), key = crypto.randomUUID(), order = orderRow();
      const results = await Promise.all(sessions.map((c) => call(c, key, order)));
      assert.equal(new Set(results.map((r) => r.order.id)).size, 1);
      assert.equal(results.filter((r) => !r.replayed).length, 1);
      assert.equal(await count('public.cdf_orders', `num='${order.num}'`), 1);
      const price = (await admin.query('select paid, payment_history h from public.cdf_order_prices where order_id=$1', [order.id])).rows[0];
      assert.equal(Number(price.paid), 2000); assert.equal(price.h.length, 1);
      assert.equal(await count('public.cdf_order_events', `order_id='${order.id}' and kind='created'`), 1);
      assert(results.every((r) => Number(r.price.paid) === 2000 && r.price.payment_history.length === 1)); }
    ok('12 simultaneous copies of one request: one order, one payment, every caller gets that same order');

    // 2 · The first call has not finished yet (its answer will be lost); the retry waits for it, then returns its result
    { const a = await session(), b = await session(), key = crypto.randomUUID(), order = orderRow();
      const pid = await pidOf(b);
      await a.query('begin'); const first = await call(a, key, order);
      let done = false; const retry = call(b, key, order).then((r) => { done = true; return r; });
      await until(() => waiting(pid));
      assert.equal(done, false);
      await a.query('commit');
      const second = await retry;
      assert.equal(second.replayed, true); assert.equal(second.order.id, first.order.id);
      assert.equal(await count('public.cdf_orders', `num='${order.num}'`), 1); }
    ok('A retry sent while the first attempt is still running waits for it and returns the same order');

    // 3 · The first attempt fails after the retry was already sent: the retry creates the order, once
    { const a = await session(), b = await session(), key = crypto.randomUUID(), order = orderRow();
      const pid = await pidOf(b);
      await a.query('begin'); await call(a, key, order);
      const retry = call(b, key, order);
      await until(() => waiting(pid));
      await a.query('rollback');
      const second = await retry;
      assert.equal(second.replayed, false);
      assert.equal(await count('public.cdf_orders', `num='${order.num}'`), 1);
      assert.equal(await count('public.cdf_order_prices', `order_id='${order.id}' and paid=2000`), 1); }
    ok('If the first attempt is rolled back, the waiting retry creates the order exactly once');

    // 4 · Two admins save different orders with the same number at the same moment
    { const a = await session('admin@t'), b = await session('admin2@t'), before = { prices: await count('public.cdf_order_prices'), keys: await count('public.cdf_operation_keys') };
      const one = orderRow({ num: 'SAME' }), two = orderRow({ num: 'SAME' });
      const results = await Promise.allSettled([call(a, crypto.randomUUID(), one), call(b, crypto.randomUUID(), two)]);
      const won = results.filter((r) => r.status === 'fulfilled'), lost = results.filter((r) => r.status === 'rejected');
      assert.equal(won.length, 1); assert.equal(lost.length, 1); assert.equal(lost[0].reason.code, '23505');
      assert.equal(await count('public.cdf_orders', "num='SAME'"), 1);
      assert.equal(await count('public.cdf_order_prices'), before.prices + 1);
      assert.equal(await count('public.cdf_operation_keys'), before.keys + 1); }
    ok('Two admins using the same order number at once: one order is saved, the other gets "number taken" and leaves no price or payment');

    // 5 · Many different orders at once still add up
    { const sessions = await Promise.all(Array.from({ length: 8 }, () => session())), before = await count('public.cdf_orders');
      const orders = sessions.map(() => orderRow());
      await Promise.all(sessions.map((c, i) => call(c, crypto.randomUUID(), orders[i], 1000 + i, { ...payment, amount: 100 + i })));
      assert.equal(await count('public.cdf_orders'), before + 8);
      const rows = (await admin.query('select amount, paid, jsonb_array_length(payment_history) k from public.cdf_order_prices where order_id = any($1)', [orders.map((o) => o.id)])).rows;
      assert.equal(rows.length, 8); assert(rows.every((r) => r.k === 1 && Number(r.amount) - Number(r.paid) === 900)); }
    ok('8 different orders created in parallel: each has its own price and single payment');

    // The books balance at the end
    { const bad = (await admin.query(`select count(*)::int n from public.cdf_order_prices p where coalesce(p.paid,0) <>
        (select coalesce(sum((e->>'amount')::numeric),0) from jsonb_array_elements(p.payment_history) e) or coalesce(p.paid,0) > p.amount`)).rows[0].n;
      assert.equal(bad, 0);
      assert.equal(await count('public.cdf_operation_keys', 'order_id is null'), 0); }
    ok('Afterwards every paid total equals the sum of its movements, none exceeds its price, and no key is left without its order');
  } finally {
    await Promise.all(open.map((c) => c.end().catch(() => {})));
    await server.stop().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
