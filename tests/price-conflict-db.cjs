// Audit F03: the price save is one conditional write (update … where amount = the price the sheet showed).
// Here: the real tables, policies and grants accept exactly that from an admin, the second of two writers
// matches nothing, and the history keeps one change. In-memory database built from every migration.
// Run: NODE_PATH=.test-tools/node_modules node tests/price-conflict-db.cjs
const { PGlite } = require('@electric-sql/pglite');
const assert = require('assert');
const { build, TEAM, claims } = require('./lib/fresh-db.cjs');
(async () => {
  const db = new PGlite(), ok = (m) => console.log('ok ' + m);
  await build((sql) => db.exec(sql)); await db.exec(TEAM);
  const id = 'c0000000-0000-0000-0000-000000000003', bare = 'c0000000-0000-0000-0000-000000000004';
  for (const [i, n] of [[id, '0903'], [bare, '0904']])
    await db.query(`insert into public.cdf_orders(id,num,date,slot,channel,customer_name,vendor_email) values ($1,$2,current_date,'10:00 - 11:00','Web','Ana','flo@t')`, [i, n]);
  await db.query('insert into public.cdf_order_prices(order_id,amount) values ($1,100)', [id]);
  const as = async (who, sql, args) => {
    await db.query("select set_config('request.jwt.claims',$1,false)", [claims(who)]); await db.exec('set role authenticated');
    try { return (await db.query(sql, args)).rows; }
    finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
  };
  const set = (who, to, seen, order = id) => as(who, seen == null
    ? 'update public.cdf_order_prices set amount = $2 where order_id = $1 and amount is null returning order_id'
    : 'update public.cdf_order_prices set amount = $2 where order_id = $1 and amount = $3 returning order_id', seen == null ? [order, to] : [order, to, seen]);
  const price = async (order = id) => Number((await db.query('select amount from public.cdf_order_prices where order_id = $1', [order])).rows[0]?.amount);

  // Both admins opened the order at 100; one sets 200, the other 300
  assert.equal((await set('admin@t', 200, 100)).length, 1);
  assert.equal((await set('admin2@t', 300, 100)).length, 0);
  assert.equal(await price(), 200);
  ok('Two admins who both saw 100: the first save is kept, the second matches nothing (the audit\'s case ended at 300 without a word)');
  assert.equal((await set('admin2@t', 300, 200)).length, 1); assert.equal(await price(), 300);
  ok('Having seen the new price, the second admin can change it');
  const log = (await db.query(`select changes->'amount' a from public.cdf_order_events where order_id = $1 and changes ? 'amount' order by at`, [id]).catch(() =>
    db.query(`select changes->'amount' a from public.cdf_order_events where order_id = $1 and changes ? 'amount'`, [id]))).rows.map((r) => r.a.map(Number));
  assert.deepEqual(log.filter(([from]) => from).sort((a, b) => a[0] - b[0]), [[100, 200], [200, 300]]);
  ok('The price history holds the two changes that happened, not the refused one');

  // An order without a price row: the update matches nothing, the insert makes it once
  assert.equal((await set('admin@t', 500, null, bare)).length, 0);
  await as('admin@t', 'insert into public.cdf_order_prices(order_id, amount) values ($1, 500)', [bare]);
  await assert.rejects(as('admin2@t', 'insert into public.cdf_order_prices(order_id, amount) values ($1, 700)', [bare]), { code: '23505' });
  assert.equal(await price(bare), 500);
  ok('First price of an order set by two admins at once: one row, the first one\'s; the second is refused');

  assert.equal((await set('flo@t', 1, 300)).length, 0); assert.equal(await price(), 300);
  ok('A florist\'s write matches nothing: prices stay admin-only');
  console.log('all price conflict checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
