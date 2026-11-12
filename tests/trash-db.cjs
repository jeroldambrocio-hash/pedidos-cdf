// Trash, restore and delete for good (migration 20261112170000), on every migration in an in-memory database.
// The R2 → #0007 case is rebuilt here (a request accepted into an order that was then deleted) to check what
// the request says now; #0007 itself is not recreated anywhere.
// Run: NODE_PATH=.test-tools/node_modules node tests/trash-db.cjs
const { PGlite } = require('@electric-sql/pglite');
const assert = require('assert'), crypto = require('crypto');
const { build, migration, TEAM, claims } = require('./lib/fresh-db.cjs');

(async () => {
  const db = new PGlite();
  const ok = (m) => console.log('ok ' + m);
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const count = async (t, w = 'true') => (await one(`select count(*)::int n from ${t} where ${w}`)).n;
  const root = async () => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); };
  const as = async (who, role = 'authenticated') => { await root(); await db.query("select set_config('request.jwt.claims',$1,false)", [who ? claims(who) : '']); await db.exec('set role ' + role); };
  const rpc = async (who, sql, params) => { await as(who); try { return await one(sql, params); } finally { await root(); } };

  // Everything before, with the team, and the R2 → #0007 case as it is in production today
  await build((sql) => db.exec(sql), { until: 'cdf_order_trash' });
  await db.exec(TEAM);
  const day = (await one("select ((now() at time zone 'Asia/Manila')::date + 1)::text d")).d;
  const R2 = crypto.randomUUID(), O7 = crypto.randomUUID();
  await db.query(`insert into public.cdf_order_requests (id, request_key, buyer_name, buyer_phone, receiver_name, receiver_phone, mode, date, slot,
      description, payment_method, fingerprint, status, accepted_key, accepted_order_id)
    values ($1, gen_random_uuid(), 'Kober Mananlo', '+639171234567', 'Kober Mananlo', '+639171234567', 'pickup', $2, '11:00 - 13:00', 'Roses', 'cash', 'x', 'accepted', gen_random_uuid(), null)`, [R2, day]);
  await db.query(`insert into public.cdf_request_events (request_id, kind, by_email, detail) values ($1, 'accepted', 'kober@t', jsonb_build_object('order_id', $2::text, 'num', '0007'))`, [R2, O7]);
  // A pickup request accepted before pickups existed, and its order (marked only in the notes)
  const R3 = crypto.randomUUID(), O8 = crypto.randomUUID(), O9 = crypto.randomUUID();
  await db.query(`insert into public.cdf_orders (id, num, date, slot, channel, customer_name, address, notes) values
    ($1, '0008', $2, '11:00 - 13:00', 'Web', 'Liza', 'Recogida en tienda', 'RECOGIDA EN TIENDA'),
    ($3, '0009', $2, '11:00 - 13:00', 'Web', 'No address', '', '')`, [O8, day, O9]);
  await db.query(`insert into public.cdf_order_requests (id, request_key, buyer_name, buyer_phone, receiver_name, receiver_phone, mode, date, slot,
      description, payment_method, fingerprint, status, accepted_key, accepted_order_id)
    values ($1, gen_random_uuid(), 'Liza Cruz', '+639181112222', 'Liza Cruz', '+639181112222', 'pickup', $2, '11:00 - 13:00', 'Sunflowers', 'cash', 'y', 'accepted', gen_random_uuid(), $3)`, [R3, day, O8]);

  await db.exec(migration('cdf_order_trash'));
  ok('Applies on top of everything before');
  assert.equal((await one('select accepted_order_num n from public.cdf_order_requests where id = $1', [R2])).n, '0007');
  assert.equal((await one('select accepted_order_num n from public.cdf_order_requests where id = $1', [R3])).n, '0008');
  assert.equal((await one('select pickup from public.cdf_orders where id = $1', [O8])).pickup, true);
  assert.equal((await one('select pickup from public.cdf_orders where id = $1', [O9])).pickup, false, 'no address alone does not make a pickup');
  ok('Backfill: requests keep their order number (#0007 from the accept entry); a pickup request\'s order becomes a pickup; a missing address alone does not');

  const r2 = (await rpc('admin@t', 'select public.cdf_request_order($1) r', [R2])).r;
  assert.deepEqual({ state: r2.state, num: r2.num, logged: r2.logged }, { state: 'deleted', num: '0007', logged: false });
  ok('R2 now says: order #0007 deleted (deleted before the log existed, so no who/when)');

  // ---------- owner ----------
  await as('admin@t');
  await assert.rejects(db.query("update public.cdf_members set is_owner = true where email = 'admin@t'"), /cdf_owner_locked/);
  await root(); await db.exec('set role service_role');
  await assert.rejects(db.query("update public.cdf_members set is_owner = true where email = 'admin@t'"), /cdf_owner_locked/);
  await root();
  assert.equal((await rpc('admin@t', 'select public.cdf_is_owner() x')).x, false);
  await db.query("update public.cdf_members set is_owner = true where email = 'admin@t'");   // the database itself (deploy step)
  assert.equal((await rpc('admin@t', 'select public.cdf_is_owner() x')).x, true);
  assert.equal((await rpc('admin2@t', 'select public.cdf_is_owner() x')).x, false);
  ok('The owner flag can\'t be set by an admin or by the team function, only by the database itself; other admins are not owners');

  // ---------- trash ----------
  const OID = crypto.randomUUID(), PROOF = OID + '/proof.jpg';
  await db.query("insert into storage.objects (bucket_id, name) values ('cdf-pagos', $1)", [PROOF]);
  const made = (await rpc('admin2@t', `select public.cdf_create_order($1, $2, 1500, $3) r`, [crypto.randomUUID(),
    { id: OID, num: '0100', date: day, slot: '11:00 - 13:00', channel: 'Web', customer_name: 'Ana', vendor_email: 'flo@t', pickup: true },
    { amount: 500, method: 'gcash', paid_at: (await one("select (now() at time zone 'Asia/Manila')::date::text d")).d, proofs: [PROOF] }])).r;
  const id = made.order.id;
  await as('admin2@t');
  await assert.rejects(db.query('delete from public.cdf_orders where id = $1', [id]), /cdf_delete_use_trash/);
  await assert.rejects(db.query("update public.cdf_orders set deleted_at = now(), deleted_by = 'x', delete_reason = 'xyz' where id = $1", [id]), /cdf_trash_only_by_function/);
  await root();
  ok('A plain DELETE or setting the trash columns by hand is refused (admins included)');
  await assert.rejects(rpc('flo@t', 'select public.cdf_order_trash($1, $2)', [id, 'mistake']), /not allowed/);
  await assert.rejects(rpc('admin2@t', 'select public.cdf_order_trash($1, $2)', [id, 'x']), /cdf_trash_reason/);
  await rpc('admin2@t', 'select public.cdf_order_trash($1, $2)', [id, 'Duplicated by mistake']);
  const t1 = await one('select deleted_at, deleted_by, delete_reason from public.cdf_orders where id = $1', [id]);
  assert(t1.deleted_at); assert.equal(t1.deleted_by, 'admin2@t'); assert.equal(t1.delete_reason, 'Duplicated by mistake');
  assert.equal(await count('public.cdf_order_prices', `order_id = '${id}'`), 1, 'price and payments kept');
  assert.equal((await one('select paid from public.cdf_order_prices where order_id = $1', [id])).paid, '500.00');
  assert.equal((await one("select kind from public.cdf_order_events where order_id = $1 order by id desc limit 1", [id])).kind, 'trashed');
  // Nothing moves a trashed order: florist steps, admin edits
  await assert.rejects(rpc('flo@t', "select public.cdf_progress($1, 'ready')", [id]), /cdf_order_in_trash/);
  await as('admin2@t');
  await assert.rejects(db.query("update public.cdf_orders set notes = 'x' where id = $1", [id]), /cdf_order_in_trash/);
  await root();
  ok('Move to trash: admins only, with a reason; the order, its price and payments stay; history notes it; nothing can change it meanwhile');

  // Restore: the same row, nothing duplicated
  const before = { orders: await count('public.cdf_orders'), prices: await count('public.cdf_order_prices') };
  await rpc('admin@t', 'select public.cdf_order_restore($1)', [id]);
  await rpc('admin@t', 'select public.cdf_order_restore($1)', [id]);   // a second tap does nothing
  assert.equal((await one('select deleted_at from public.cdf_orders where id = $1', [id])).deleted_at, null);
  assert.deepEqual({ orders: await count('public.cdf_orders'), prices: await count('public.cdf_order_prices') }, before);
  assert.equal((await one('select pickup from public.cdf_orders where id = $1', [id])).pickup, true, 'type kept');
  assert.equal((await one('select payment_history from public.cdf_order_prices where order_id = $1', [id])).payment_history.length, 1, 'one payment, not two');
  ok('Restore brings back the same order: no copy of the order or its payments; the type is kept');

  // 30 days: other admins can no longer restore; the owner still can
  await rpc('admin2@t', 'select public.cdf_order_trash($1, $2)', [id, 'Customer will reorder']);
  await db.exec("select set_config('cdf.trash','on',false)");
  await db.query("update public.cdf_orders set deleted_at = now() - interval '31 days' where id = $1", [id]);
  await db.exec("select set_config('cdf.trash','',false)");
  await assert.rejects(rpc('admin2@t', 'select public.cdf_order_restore($1)', [id]), /cdf_restore_expired/);
  ok('Past 30 days, other admins can\'t restore; nothing is deleted automatically');

  // Delete for good: owner only, from the trash only, never with a rider; the log stays with a snapshot
  await assert.rejects(rpc('admin2@t', 'select public.cdf_order_purge($1, $2)', [id, 'Not needed']), /cdf_owner_only/);
  const live = (await rpc('admin2@t', `select public.cdf_create_order($1, $2, null, null) r`, [crypto.randomUUID(), { num: '0101', date: day, slot: '11:00 - 13:00', channel: 'Web' }])).r.order.id;
  await assert.rejects(rpc('admin@t', 'select public.cdf_order_purge($1, $2)', [live, 'Not needed']), /cdf_purge_not_in_trash/);
  // A rider on it: can't be trashed nor deleted
  await db.query(`insert into public.cdf_lalamove (order_id, env, ll_order_id, status) values ($1, 'production', 'LL-77', 'ON_GOING')`, [live]);
  await assert.rejects(rpc('admin@t', 'select public.cdf_order_trash($1, $2)', [live, 'Mistake']), /cdf_order_has_rider/);
  await db.query(`update public.cdf_lalamove set status = 'COMPLETED' where order_id = $1`, [live]);
  await rpc('admin@t', 'select public.cdf_order_trash($1, $2)', [live, 'Mistake']);
  // ... and if the rider were somehow on it while in the trash, deleting for good is still refused by the database
  await db.exec("select set_config('cdf.trash','on',false)"); await db.query(`update public.cdf_lalamove set status = 'ON_GOING' where order_id = $1`, [live]); await db.exec("select set_config('cdf.trash','',false)");
  await assert.rejects(rpc('admin@t', 'select public.cdf_order_purge($1, $2)', [live, 'Not needed']), /cdf_order_has_rider/);
  ok('Delete for good: only the owner, only from the trash; a rider on the order blocks trashing and deleting');

  // Link a request to the trashed order to see its state, then purge
  const R4 = crypto.randomUUID();
  await db.query(`insert into public.cdf_order_requests (id, request_key, buyer_name, buyer_phone, receiver_name, receiver_phone, mode, date, slot,
      description, payment_method, fingerprint, status, accepted_key, accepted_order_id)
    values ($1, gen_random_uuid(), 'Ana', '+639171234567', 'Ana', '+639171234567', 'pickup', $2, '11:00 - 13:00', 'Roses', 'cash', 'z', 'accepted', gen_random_uuid(), $3)`, [R4, day, id]);
  const inTrash = (await rpc('admin@t', 'select public.cdf_request_order($1) r', [R4])).r;
  assert.equal(inTrash.state, 'trash'); assert.equal(inTrash.num, '0100'); assert.equal(inTrash.reason, 'Customer will reorder'); assert.equal(inTrash.by, 'admin2@t');
  ok('A request whose order is in the trash says so, with the number, who, when and why');

  await rpc('admin@t', 'select public.cdf_order_purge($1, $2)', [id, 'Customer cancelled for good']);
  assert.equal(await count('public.cdf_orders', `id = '${id}'`), 0);
  const log = (await db.query('select action, by_email, reason, snapshot from public.cdf_order_audit where order_id = $1 order by id', [id])).rows;
  assert.deepEqual(log.map((l) => [l.action, l.by_email]), [['trashed', 'admin2@t'], ['restored', 'admin@t'], ['trashed', 'admin2@t'], ['purged', 'admin@t']]);
  const snap = log.at(-1).snapshot;
  assert.equal(snap.order.num, '0100'); assert.equal(snap.price.payment_history[0].proofs[0], PROOF);
  assert.equal(await count('storage.objects', `name = '${PROOF}'`), 1, 'the proof file stays in storage'); assert.equal(snap.request.id, R4);
  const gone = (await rpc('admin@t', 'select public.cdf_request_order($1) r', [R4])).r;
  assert.deepEqual({ state: gone.state, num: gone.num, by: gone.by, reason: gone.reason, logged: gone.logged }, { state: 'deleted', num: '0100', by: 'admin@t', reason: 'Customer cancelled for good', logged: true });
  assert.equal((await one('select accepted_order_num n, accepted_order_id i from public.cdf_order_requests where id = $1', [R4])).n, '0100');
  ok('Deleted for good: the log keeps who, when, why and a snapshot (order, payments with proof paths, request) after the rows are gone; the request still names #0100');

  // Who reads the log
  await as('flo@t'); assert.equal((await db.query('select * from public.cdf_order_audit')).rows.length, 0);
  await as(null, 'anon'); await assert.rejects(db.query('select * from public.cdf_order_audit'));
  await root();
  for (const f of ['cdf_order_trash(uuid, text)', 'cdf_order_restore(uuid)', 'cdf_order_purge(uuid, text)', 'cdf_request_order(uuid)', 'cdf_request_counts()', 'cdf_is_owner()'])
    assert.equal((await one(`select has_function_privilege('anon', $1, 'execute') x`, ['public.' + f])).x, false, f);
  ok('The log is for admins only; nothing is open to anonymous visitors');

  // Counts by status and type
  const c = (await rpc('admin@t', 'select public.cdf_request_counts() c')).c;
  assert.equal(c['accepted:pickup'], 3);
  assert.equal((await rpc('flo@t', 'select public.cdf_request_counts() c')).c, null);
  ok('Exact request counts by status and type (admins only)');

  // Pickup/delivery type changes are in the history
  await as('admin@t'); await db.query('update public.cdf_orders set pickup = true where id = $1', [O9]); await root();
  assert.deepEqual((await one("select changes->'pickup' p from public.cdf_order_events where order_id = $1 order by id desc limit 1", [O9])).p, [false, true]);
  ok('A change of type (delivery ↔ pickup) shows in the order\'s history');
  console.log('all trash checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
