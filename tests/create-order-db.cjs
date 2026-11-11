// Phase 1: an order, its price and its down payment in one transaction (cdf_create_order).
// Runs on a throwaway in-memory database built from the migrations; it never connects to Supabase.
// Run: NODE_PATH=.test-tools/node_modules node tests/create-order-db.cjs
const { PGlite } = require('@electric-sql/pglite');
const assert = require('assert'), crypto = require('crypto');
const { build, migration, TEAM, claims } = require('./lib/fresh-db.cjs');

(async () => {
  const db = new PGlite();
  const ok = (m) => console.log('ok ' + m);
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const count = async (table, where = 'true') => (await one(`select count(*)::int n from ${table} where ${where}`)).n;
  const root = async () => { await db.exec('reset role'); };
  const as = async (email) => {
    await root();
    await db.query("select set_config('request.jwt.claims',$1,false)", [email ? claims(email) : '']);
    await db.exec('set role ' + (email ? 'authenticated' : 'anon'));
  };

  // The database as production has it today, with data already in it; then this migration on top.
  await build((sql) => db.exec(sql), { until: 'cdf_create_order_with_payment' });
  await db.exec(TEAM);
  await db.exec(`insert into public.cdf_orders(id,num,date,slot,channel,customer_name)
      values ('b0000000-0000-0000-0000-000000000001','OLD1',current_date,'10:00 - 12:00','Web','Before');
    insert into storage.objects(bucket_id,name) values ('cdf-pagos','b0000000-0000-0000-0000-000000000001/old.jpg');`);
  await as('admin@t');
  const oldPayment = { order: 'b0000000-0000-0000-0000-000000000001', id: crypto.randomUUID() };
  await db.query('select public.cdf_record_payment($1,$2,$3,$4,$5,$6,$7,$8)',
    [oldPayment.order, oldPayment.id, 300, [oldPayment.order + '/old.jpg'], 1000, null, null, null]);
  await root();
  const before = await one("select to_jsonb(p) row from public.cdf_order_prices p");
  await db.exec(migration('cdf_create_order_with_payment'));
  assert.deepEqual((await one("select to_jsonb(p) row from public.cdf_order_prices p")).row, before.row);
  assert.equal(await count('public.cdf_orders'), 1);
  ok('The migration applies on top of existing data and changes none of it');
  await assert.rejects(db.exec(migration('cdf_create_order_with_payment')));
  ok('Applying it a second time stops at once instead of half-applying');

  const today = (await one("select (now() at time zone 'Asia/Manila')::date::text d")).d;
  let n = 100;
  const orderRow = (extra = {}) => ({ id: crypto.randomUUID(), num: String(++n), date: today, slot: '10:00 - 12:00', channel: 'Instagram',
    vendor_email: 'flo@t', carrier_email: '', customer_name: 'Maria Santos', address: '12 Mabini St, Quezon City', customer_phone: '+639171234567',
    customer_email: '', buyer_name: 'Jose Santos', buyer_phone: '+639181234567', card_message: 'Happy birthday', delivery_note: '', notes: '',
    drop_lat: 14.676, drop_lng: 121.0437, vehicle: null, ...extra });
  const pay = (extra = {}) => ({ amount: 2000, method: 'gcash', reference: 'GC-778812', paid_at: today, proofs: [], ...extra });
  const create = async ({ key = crypto.randomUUID(), order = orderRow(), price = 2500, payment = null } = {}) =>
    (await one('select public.cdf_create_order($1,$2,$3,$4) r', [key, order, price, payment])).r;
  const snapshot = async () => { await root(); const s = { orders: await count('public.cdf_orders'), prices: await count('public.cdf_order_prices'),
    keys: await count('public.cdf_operation_keys'), events: await count('public.cdf_order_events'), calls: await count('net.calls') }; await as('admin@t'); return s; };
  const untouched = async (was, what) => assert.deepEqual(await snapshot(), was, what + ' must leave nothing behind');

  // Who may call it
  await as(null); await assert.rejects(create(), { code: '42501' });
  await as('flo@t'); await assert.rejects(create(), { code: '42501' });
  await as('dri@t'); await assert.rejects(create(), { code: '42501' });
  for (const who of [null, 'flo@t', 'dri@t']) { await as(who); await assert.rejects(db.query('select public.cdf_create_order(null,null,null,null)'), { code: '42501' }); }
  await root(); assert.equal(await count('public.cdf_orders'), 1);
  ok('A visitor, a florist and a driver cannot create orders through it, nor ask whether it exists');
  await as('admin@t');
  { const was = await snapshot();
    assert.deepEqual((await one('select public.cdf_create_order(null,null,null,null) r')).r, { available: true });
    await untouched(was, 'The availability check'); }
  ok('The panel can ask an admin session whether the function is there; that writes nothing');

  await as('admin@t');
  // No price, no payment
  { const r = await create({ price: null });
    assert.equal(r.price, null); assert.equal(r.order.status, 'Preparing'); assert.equal(r.order.delivery, '-'); assert.equal(r.replayed, false);
    await root(); assert.equal(await count('public.cdf_order_prices', `order_id='${r.order.id}'`), 0); await as('admin@t'); }
  ok('An order without a price is created with no price row');

  // Price, no down payment: no zero movement
  { const r = await create();
    assert.equal(Number(r.price.amount), 2500); assert.equal(r.price.paid, null); assert.deepEqual(r.price.payment_history, []); }
  await assert.rejects(create({ payment: pay({ amount: 0 }) }), /cdf_invalid_payment/);
  ok('No down payment: the price is saved and no zero movement is written');

  // The acceptance case: 2,500 with 2,000 paid leaves 500
  let partial;
  { const order = orderRow(), proof = order.id + '/transfer.jpg';
    await root(); await db.query("insert into storage.objects(bucket_id,name) values ('cdf-pagos',$1)", [proof]); await as('admin@t');
    const was = await snapshot();
    const r = partial = await create({ order, payment: pay({ proofs: [proof] }) });
    assert.equal(Number(r.price.amount), 2500); assert.equal(Number(r.price.paid), 2000);
    assert.equal(Number(r.price.amount) - Number(r.price.paid), 500);
    assert.equal(r.price.payment_history.length, 1);
    const m = r.price.payment_history[0];
    assert.equal(m.kind, 'payment'); assert.equal(m.amount, 2000); assert.equal(m.method, 'gcash'); assert.equal(m.reference, 'GC-778812');
    assert.equal(m.paid_at, today); assert.equal(m.by_email, 'admin@t'); assert(m.created_at); assert.deepEqual(m.proofs, [proof]);
    assert.equal(r.order.vendor_email, 'flo@t'); assert.equal(r.order.carrier_email, null); assert.equal(Number(r.order.drop_lat), 14.676);
    const now = await snapshot();
    assert.equal(now.orders, was.orders + 1); assert.equal(now.prices, was.prices + 1); assert.equal(now.keys, was.keys + 1);
    await root();
    const ev = (await db.query('select kind, by_email, changes from public.cdf_order_events where order_id=$1 order by id', [order.id])).rows;
    assert.equal(ev[0].kind, 'created'); assert(ev.every((e) => e.by_email === 'admin@t'));
    assert(ev.some((e) => e.changes.amount) && ev.some((e) => e.changes.paid), 'price and payment are in the history');
    await as('flo@t');
    assert.equal(await count('public.cdf_orders', `id='${order.id}'`), 1);
    assert.equal(await count('public.cdf_order_prices'), 0);
    assert.equal(await count('public.cdf_order_events', `order_id='${order.id}' and changes ?| array['amount','paid']`), 0);
    await as('admin@t'); }
  ok('₱2,500 with ₱2,000 paid: one order, one payment, ₱500 left; method, reference, date and author kept; the florist sees no money');

  // Full payment
  { const r = await create({ payment: pay({ amount: 2500, method: 'cash', reference: null }) });
    assert.equal(Number(r.price.paid), 2500); assert.equal(r.price.payment_history[0].reference, null); }
  ok('Paid in full: nothing left to pay');

  // Refused on the server, and nothing stays
  { const was = await snapshot();
    await assert.rejects(create({ payment: pay({ amount: 2500.01 }) }), /cdf_payment_above_due/); await untouched(was, 'Overpayment');
    await assert.rejects(create({ payment: pay({ amount: -1 }) }), /cdf_invalid_payment/);
    await assert.rejects(create({ payment: pay({ amount: 10.005 }) }), /cdf_invalid_payment/);
    await assert.rejects(create({ payment: pay({ amount: '2000' }) }), /cdf_invalid_payment/);
    await assert.rejects(create({ price: 2500.001, payment: pay() }), /cdf_invalid_payment/);
    await assert.rejects(create({ price: -5 }), /cdf_invalid_payment/);
    await assert.rejects(create({ price: null, payment: pay() }), /cdf_invalid_payment/);
    await assert.rejects(create({ payment: pay({ method: ' ' }) }), /cdf_invalid_payment/);
    await assert.rejects(create({ payment: pay({ method: 'x'.repeat(41) }) }), /cdf_invalid_payment/);
    await assert.rejects(create({ payment: pay({ reference: 'x'.repeat(121) }) }), /cdf_invalid_payment/);
    await assert.rejects(create({ payment: pay({ paid_at: null }) }), /cdf_invalid_payment/);
    await assert.rejects(create({ payment: pay({ paid_at: '2026-02-31' }) }), /cdf_invalid_payment/);
    await assert.rejects(create({ payment: pay({ paid_at: '2999-01-01' }) }), /cdf_invalid_payment/);
    await assert.rejects(create({ payment: pay({ paid: 9999 }) }), /cdf_invalid_payment/);
    await untouched(was, 'An invalid payment'); }
  ok('Overpayment, negative, bad decimals, missing method or date and future dates are refused, leaving no order behind');

  { const was = await snapshot(), order = orderRow();
    await assert.rejects(create({ order, payment: pay({ proofs: [order.id + '/missing.jpg'] }) }), /cdf_invalid_payment_proofs/);
    await assert.rejects(create({ order, payment: pay({ proofs: [oldPayment.order + '/old.jpg'] }) }), /cdf_invalid_payment_proofs/);
    await untouched(was, 'A proof that was not uploaded for this order'); }
  ok("A proof must be uploaded and belong to this order; another order's file is refused");

  { const was = await snapshot();
    for (const extra of [{ status: 'Ready' }, { delivery: 'Delivered' }, { prepared_by: 'admin@t' }, { amount: 1 }, { code: 'abc' }, { archived_at: today }, { cancelled_at: today }])
      await assert.rejects(create({ order: orderRow(extra) }), /cdf_invalid_order/);
    await assert.rejects(create({ key: null }), /cdf_invalid_order/);
    await untouched(was, 'A forged field'); }
  ok('Status, credit, legacy price and tracking code cannot be set through it');

  // A failure half way (here: the order number is taken) undoes everything; the same key then works
  { const was = await snapshot(), key = crypto.randomUUID(), order = orderRow({ num: 'OLD1' });
    await assert.rejects(create({ key, order, payment: pay() }), { code: '23505' }); await untouched(was, 'A repeated order number');
    await root();
    await db.exec(`create function public.test_boom() returns trigger language plpgsql as $$begin raise exception 'boom'; end$$;
      create trigger test_boom before update on public.cdf_order_prices for each row execute function public.test_boom();`);
    await as('admin@t');
    await assert.rejects(create({ key, order: { ...order, num: '900' }, payment: pay() }), /boom/); await untouched(was, 'A failure while recording the payment');
    await root(); await db.exec('drop trigger test_boom on public.cdf_order_prices; drop function public.test_boom();'); await as('admin@t');
    const r = await create({ key, order: { ...order, num: '900' }, payment: pay() });
    assert.equal(Number(r.price.paid), 2000); assert.equal(r.replayed, false); }
  ok('A failure in the middle rolls back order, price, payment and notices; retrying afterwards creates it once');

  // Repeating the same request returns the first result
  { const key = crypto.randomUUID(), order = orderRow(), payment = pay();
    const first = await create({ key, order, payment }), was = await snapshot();
    const again = await create({ key, order, payment });
    assert.equal(again.replayed, true); assert.deepEqual(again.order, first.order); assert.deepEqual(again.price, first.price);
    await create({ key, order, price: 2500.00, payment });
    await untouched(was, 'A repeated request');
    await assert.rejects(create({ key, order, price: 2600, payment }), /cdf_operation_conflict/);
    await assert.rejects(create({ key, order: { ...order, customer_name: 'Someone Else' }, payment }), /cdf_operation_conflict/);
    await assert.rejects(create({ key, order, payment: pay({ amount: 100 }) }), /cdf_operation_conflict/);
    await untouched(was, 'A reused key');
    await as('admin2@t'); await assert.rejects(create({ key, order, payment }), /cdf_operation_conflict/);
    await as('admin@t'); await untouched(was, "Another admin's key"); }
  ok('The same request again returns the first order (no second order or payment); the same key with different content is a conflict');

  // Deleting the order later does not let an old request bring it back
  { const key = crypto.randomUUID(), order = orderRow(), payment = pay();
    const made = await create({ key, order, payment });
    await db.query('delete from public.cdf_orders where id=$1', [made.order.id]);
    const was = await snapshot();
    await assert.rejects(create({ key, order, payment }), /cdf_operation_gone/);
    await untouched(was, 'Replaying the request of a deleted order'); }
  ok('An order deleted afterwards is not recreated by repeating its old request');

  // The existing rules still govern what happens next
  { const order = partial.order.id, movement = partial.price.payment_history[0].id;
    const record = async (args) => (await one('select public.cdf_record_payment($1,$2,$3,$4,$5,$6,$7,$8) r', args)).r;
    await assert.rejects(record([order, crypto.randomUUID(), 500.01, [], 2500, 2500, null, null]), /cdf_payment_above_due/);
    const more = await record([order, crypto.randomUUID(), 500, [], 2500, 2500, null, null]);
    assert.equal(Number(more.paid), 2500); assert.equal(more.payment_history[1].method, null);
    const fixed = await record([order, crypto.randomUUID(), null, [], null, 2500, movement, 'Wrong amount typed']);
    assert.equal(Number(fixed.paid), 500);
    assert.deepEqual(fixed.payment_history.map((e) => e.amount), [2000, 500, -2000]);
    assert.equal(fixed.payment_history[0].method, 'gcash'); assert.equal(fixed.payment_history[2].method, null);
    await assert.rejects(db.query(`update public.cdf_order_prices set paid=0 where order_id='${order}'`), { code: '42501' });
    await assert.rejects(db.query(`update public.cdf_order_prices set amount=100 where order_id='${order}'`), /cdf_price_below_paid/); }
  ok('Later payments and corrections use the existing flow: the down payment is kept and reversed by a new movement');

  { await root();
    const old = (await one('select payment_history h from public.cdf_order_prices where order_id=$1', [oldPayment.order])).h;
    assert.equal(old.length, 1); assert.equal(old[0].amount, 300); assert(!('method' in old[0])); await as('admin@t'); }
  ok('Movements recorded before this migration keep exactly what they had');

  await assert.rejects(db.query('select * from public.cdf_operation_keys'), { code: '42501' });
  await assert.rejects(db.query("delete from public.cdf_operation_keys"), { code: '42501' });
  ok('Not even an admin session can read or edit the operation keys directly');

  { const total = Number((await one("select total from public.cdf_buyer_history('639181234567', null)")).total);
    await root(); const sum = Number((await one("select coalesce(sum(p.amount),0) s from public.cdf_order_prices p join public.cdf_orders o on o.id=p.order_id where o.buyer_phone='+639181234567'")).s);
    assert.equal(total, sum); }
  ok('A down payment does not add a second sale: buyer totals are still the order prices');

  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });
