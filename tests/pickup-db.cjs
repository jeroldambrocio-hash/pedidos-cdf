// Pickup orders (migration 20261112150000): the shops offered on the public form, the chosen shop on the
// request, the pickup flag on orders, and the pickup steps (no On the way). Throwaway in-memory database
// built from every migration; never connects to Supabase.
// Run: NODE_PATH=.test-tools/node_modules node tests/pickup-db.cjs
const { PGlite } = require('@electric-sql/pglite');
const assert = require('assert'), crypto = require('crypto');
const { build, migration, TEAM, claims } = require('./lib/fresh-db.cjs');

(async () => {
  const db = new PGlite();
  const ok = (m) => console.log('ok ' + m);
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const count = async (table, where = 'true') => (await one(`select count(*)::int n from ${table} where ${where}`)).n;
  const root = async () => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); };
  const as = async (who) => {
    await root();
    await db.query("select set_config('request.jwt.claims',$1,false)", [who ? claims(who) : '']);
    await db.exec('set role ' + (who ? 'authenticated' : 'anon'));
  };

  // Everything before this migration, with the team, three shops and an order already there
  await build((sql) => db.exec(sql), { until: 'cdf_pickup_orders' });
  await db.exec(TEAM + `
    insert into public.cdf_members(email,name,role,branch,pickup_address,pickup_lat,pickup_lng) values
      ('qc@t','Jhandee','vendor','Quezon City','12 Visayas Ave, Quezon City',14.6538,121.0450),
      ('pas@t','Arjay','vendor','Pasig','8 Ortigas Ave, Pasig',14.5866,121.0614),
      ('par@t','Agnes','vendor','Parañaque','3 Dr A Santos Ave, Parañaque',14.4793,121.0198);
    update public.cdf_members set branch = null where email = 'flo@t';`);
  const tomorrow = (await one("select ((now() at time zone 'Asia/Manila')::date + 1)::text d")).d;
  await db.query(`insert into public.cdf_orders(id,num,date,slot,channel,customer_name,status,delivery)
    values ('b0000000-0000-0000-0000-000000000001','0500',$1,'11:00 - 13:00','Instagram','Ana','Ready','In transit')`, [tomorrow]);
  const before = await count('public.cdf_orders');
  await db.exec(migration('cdf_pickup_orders'));
  assert.equal(await count('public.cdf_orders'), before);
  assert.equal((await one("select pickup from public.cdf_orders where num = '0500'")).pickup, false);
  ok('Applies on top of everything before; existing orders stay deliveries (even one already on the way)');
  await assert.rejects(db.exec(migration('cdf_pickup_orders')));
  ok('A second run stops instead of half-applying');

  // ---------- shops for the form ----------
  await as(null);
  await assert.rejects(one('select public.cdf_pickup_shops(null)'), /permission denied/);
  await as('flo@t');
  await assert.rejects(one('select public.cdf_pickup_shops(null)'), /permission denied/);
  await root(); await db.exec('set role service_role');
  let shops = (await one('select public.cdf_pickup_shops($1::date) s', [tomorrow])).s;
  assert.deepEqual(shops.map((s) => s.branch), ['Parañaque', 'Pasig', 'Quezon City']);
  assert(shops.every((s) => s.available && s.address && typeof s.lat === 'number'));
  assert(!JSON.stringify(shops).includes('@t') && !/Jhandee|Arjay|Agnes/.test(JSON.stringify(shops)), 'no florist names or emails');
  ok('The form\'s server (service role) gets the shops: zone, address and point, nothing about the florists; the browser cannot call it');
  await root();
  await db.query(`update public.cdf_members set away_from = $1, away_until = $1 where email = 'pas@t'`, [tomorrow]);
  await db.exec('set role service_role');
  shops = (await one('select public.cdf_pickup_shops($1::date) s', [tomorrow])).s;
  assert.equal(shops.find((s) => s.branch === 'Pasig').available, false);
  assert.equal((await one('select public.cdf_pickup_shops(null) s')).s.find((s) => s.branch === 'Pasig').available, true);
  ok('A shop whose florist is away that day is listed as not available');

  // ---------- the request names its shop ----------
  await root();
  const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
  const session = async () => {
    const token = crypto.randomBytes(16).toString('hex');
    await one(`insert into public.cdf_upload_sessions(token_hash, ip_hash, expires_at) values ($1, 'iphash', now() + interval '2 hours') returning id`, [sha(token)]);
    return sha(token);
  };
  const base = { lang: 'en', buyer_name: 'Jose Santos', buyer_phone: '+34612345678', receiver_name: 'Maria Santos', receiver_phone: '+639171234567',
    date: tomorrow, slot: '11:00 - 13:00', description: 'A dozen red roses', special_requests: '', card_message: '', payment_method: 'gcash', reference_files: [], payment_proof: null };
  const pickup = (extra = {}) => ({ ...base, request_key: crypto.randomUUID(), mode: 'pickup', pickup_branch: 'Quezon City', ...extra });
  const submit = async (r) => (await one('select public.cdf_request_submit($1, $2, $3) r', [await session(), 'iphash', r])).r;

  const got = await submit(pickup());
  assert.equal((await one('select pickup_branch from public.cdf_order_requests where id = $1', [got.id])).pickup_branch, 'Quezon City');
  ok('A pickup request keeps the shop the customer chose');
  await assert.rejects(submit(pickup({ pickup_branch: 'Makati' })), /cdf_pickup_shop/);
  await assert.rejects(submit(pickup({ pickup_branch: 'Pasig' })), /cdf_pickup_shop/);
  const legacy = await submit(pickup({ pickup_branch: null }));
  assert.equal((await one('select pickup_branch from public.cdf_order_requests where id = $1', [legacy.id])).pickup_branch, null);
  await assert.rejects(submit({ ...base, request_key: crypto.randomUUID(), mode: 'delivery', pickup_branch: 'Pasig', address: '12 Mabini St, Quezon City',
    lat: 14.64, lng: 121.07, location_source: 'search', location_confirmed_at: new Date().toISOString() }), /cdf_invalid_request/);
  const del = await submit({ ...base, request_key: crypto.randomUUID(), mode: 'delivery', address: '12 Mabini St, Quezon City',
    lat: 14.64, lng: 121.07, location_source: 'search', location_confirmed_at: new Date().toISOString() });
  assert.equal((await one('select pickup_branch from public.cdf_order_requests where id = $1', [del.id])).pickup_branch, null);
  ok('Refused: a shop that does not exist, one closed that day, a delivery with one. A pickup without a shop (the form published today) still goes through');

  // ---------- creating and accepting ----------
  await as('admin@t');
  const made = (await one(`select public.cdf_request_accept($1, $2, $3, null, null) r`, [got.id, crypto.randomUUID(),
    { num: '0600', date: tomorrow, slot: '11:00 - 13:00', channel: 'Web', customer_name: 'Maria Santos', vendor_email: 'qc@t', pickup: true }])).r;
  assert.equal(made.order.pickup, true); assert.equal(made.order.address, '');
  ok('Accepting a pickup request creates a pickup order, without an address');
  await assert.rejects(one(`select public.cdf_create_order($1, $2, null, null)`, [crypto.randomUUID(), { num: '0601', date: tomorrow, slot: '11:00 - 13:00', channel: 'Web', pickup: 'yes' }]), /cdf_invalid_order/);
  const plain = (await one(`select public.cdf_create_order($1, $2, null, null) r`, [crypto.randomUUID(), { num: '0602', date: tomorrow, slot: '11:00 - 13:00', channel: 'Web' }])).r;
  assert.equal(plain.order.pickup, false);
  ok('pickup must be true or false; left out, the order is a delivery as before');

  // ---------- steps ----------
  const id = made.order.id;
  const step = async (who, k) => { await as(who); return (await one('select (public.cdf_progress($1, $2)).delivery d', [id, k])).d; };
  await as(null); await root();
  await assert.rejects(step('admin@t', 'transit'), /cdf_pickup_no_transit/);
  await as('admin@t');
  await assert.rejects(db.query(`update public.cdf_orders set status = 'Ready', delivery = 'In transit' where id = $1`, [id]), /cdf_orders_pickup_no_transit/);
  ok('On the way is refused for a pickup, through the steps and by writing the row directly');
  assert.equal(await step('qc@t', 'ready'), '-');
  await assert.rejects(step('qc@t', 'transit'), /cdf_pickup_no_transit/);
  assert.equal(await step('qc@t', 'fail'), 'Failed');
  assert.equal(await step('qc@t', 'done'), 'Delivered');
  ok('The florist: Ready for pickup → Not collected → Picked up (they came later)');
  await root(); await db.query(`update public.cdf_orders set status='Ready', delivery='-' where id = $1`, [id]);
  assert.equal(await step('qc@t', 'done'), 'Delivered');
  await assert.rejects(step('qc@t', 'prep'), /does not follow/);
  ok('Ready for pickup → Picked up directly; going back from Picked up is for the office only');
  await root(); await db.query(`update public.cdf_orders set status='Ready', delivery='-' where id = $1`, [id]);
  await assert.rejects(step('dri@t', 'done'));
  ok('Drivers have nothing to do with a pickup');
  // Deliveries keep their rules
  await root(); await db.query(`update public.cdf_orders set status='Ready', delivery='-', vendor_email='qc@t' where id = $1`, [plain.order.id]);
  await as('qc@t');
  await assert.rejects(one('select public.cdf_progress($1, $2)', [plain.order.id, 'done']), /does not follow/);
  assert.equal((await one('select (public.cdf_progress($1, $2)).delivery d', [plain.order.id, 'transit'])).d, 'In transit');
  ok('A delivery still goes Ready → On the way → Delivered, as before');
  await root();
  console.log('all pickup checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
