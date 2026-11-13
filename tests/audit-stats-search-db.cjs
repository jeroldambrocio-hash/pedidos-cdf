// Audit 13/11/2026 (migration 20261113120000): a delivered order cannot leave the statistics by being moved back
// and cancelled; "open now" leaves the trash out; the buyer history counts only valid orders and says how many
// were cancelled; a search is not crowded out by the trash.
// Run: NODE_PATH=.test-tools/node_modules node tests/audit-stats-search-db.cjs
const { PGlite } = require('@electric-sql/pglite'), assert = require('assert/strict'), { randomUUID } = require('crypto');
const { build, TEAM, claims } = require('./lib/fresh-db.cjs');
(async () => {
  const db = new PGlite(); await build((s) => db.exec(s)); await db.exec(TEAM);
  const one = async (s, p) => (await db.query(s, p)).rows[0];
  const add = async (num, extra = {}) => {
    const id = randomUUID(), cols = { id, num, date: extra.date || '2026-11-10', slot: '10:00 - 12:00', channel: 'Web', customer_name: 'Test',
      status: 'Ready', delivery: '-', buyer_phone: extra.phone || '', vendor_email: extra.vendor || null };
    const k = Object.keys(cols);
    await db.query(`insert into public.cdf_orders(${k.join(',')}) values (${k.map((_, i) => '$' + (i + 1)).join(',')})`, k.map((c) => cols[c]));
    return id;
  };
  await db.query("select set_config('request.jwt.claims',$1,false)", [claims('admin@t')]);

  // 1. Delivered, moved back, then cancelled: refused
  const d = await add('a1');
  await db.query("update public.cdf_orders set delivery='Delivered' where id=$1", [d]);
  await db.query("update public.cdf_orders set delivery='-' where id=$1", [d]);
  await assert.rejects(db.query("select public.cdf_cancel_order($1,'customer changed mind')", [d]), /cdf_delivered_not_cancellable/);
  assert.equal((await one('select cancelled_at from public.cdf_orders where id=$1', [d])).cancelled_at, null);
  const never = await add('a2');
  await db.query("select public.cdf_cancel_order($1,'customer changed mind')", [never]);
  assert((await one('select cancelled_at from public.cdf_orders where id=$1', [never])).cancelled_at);
  console.log('ok an order delivered once cannot be cancelled after moving it back; one never delivered still can');

  // 2. Open now: the trash is not pending work
  const open = await add('b1', { vendor: 'flo@t' }), trashed = await add('b2', { vendor: 'flo@t' });
  await db.query("select public.cdf_order_trash($1,'wrong order')", [trashed]);
  const st = await one("select open_now from public.cdf_member_stats() where email='flo@t'");
  assert.equal(Number(st.open_now), 1, 'only the order still to do');
  void open;
  console.log('ok a florist\'s open orders leave out the ones in the trash');

  // 3. Buyer history: valid orders counted, cancelled said apart, trash left out
  const phone = '+63 917 123 4567';
  const ok1 = await add('c1', { phone }), ok2 = await add('c2', { phone }), canc = await add('c3', { phone }), tr = await add('c4', { phone });
  await db.query('insert into public.cdf_order_prices(order_id,amount) values ($1,100),($2,200),($3,500),($4,900)', [ok1, ok2, canc, tr]);
  await db.query("select public.cdf_cancel_order($1,'no stock')", [canc]);
  await db.query("select public.cdf_order_trash($1,'duplicate')", [tr]);
  const h = await one('select * from public.cdf_buyer_history($1)', ['09171234567']);
  assert.deepEqual([Number(h.n), Number(h.total), Number(h.cancelled)], [2, 300, 1]);
  console.log('ok buyer history: 2 valid orders worth 300, 1 cancelled apart, the trashed one left out');

  // 4. Search: 250 trashed matches do not push the active one out
  await db.query("update public.cdf_orders set customer_name='Zelda' where num='c1'");
  for (let i = 0; i < 250; i++) {
    const x = await add('z' + i, { date: '2026-12-01' });
    await db.query("update public.cdf_orders set customer_name='Zelda' where id=$1", [x]);
    await db.query("select public.cdf_order_trash($1,'bulk test')", [x]);
  }
  const hits = (await db.query("select num, deleted_at from public.cdf_search_orders('Zelda')")).rows;
  assert(hits.some((r) => r.num === 'c1'), 'the active order is found');
  assert(hits.every((r) => !r.deleted_at), 'no trash in the results');
  console.log('ok a search finds the active order even with 250 trashed matches');

  await db.close(); console.log('all audit checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
