// Phase 3: requests from the public form, reviewed and accepted in the panel. Runs on a throwaway in-memory
// database built from every migration; it never connects to Supabase. pg_net's http_post is a stand-in that
// only records the call, so "a notice was sent" here means "the database asked for it to be sent".
// Run: NODE_PATH=.test-tools/node_modules node tests/requests-db.cjs
const { PGlite } = require('@electric-sql/pglite');
const assert = require('assert'), crypto = require('crypto');
const { build, migration, TEAM, claims } = require('./lib/fresh-db.cjs');

(async () => {
  const db = new PGlite();
  const ok = (m) => console.log('ok ' + m);
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  const count = async (table, where = 'true') => (await one(`select count(*)::int n from ${table} where ${where}`)).n;
  const root = async () => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); };
  const FLO2 = { email: 'flo2@t', sub: 'a0000000-0000-0000-0000-0000000000f2' };
  const as = async (who) => {
    await root();
    const c = who === FLO2.email ? JSON.stringify({ email: FLO2.email, sub: FLO2.sub, role: 'authenticated' }) : who ? claims(who) : '';
    await db.query("select set_config('request.jwt.claims',$1,false)", [c]);
    await db.exec('set role ' + (who ? 'authenticated' : 'anon'));
  };

  // The database as Phases 1 and 2 leave it, with an order already in it; then this migration
  await build((sql) => db.exec(sql), { until: 'cdf_order_requests' });
  await db.exec(TEAM + `insert into public.cdf_members(email,name,role) values ('${FLO2.email}','Flo Two','vendor');`);
  const today = (await one("select (now() at time zone 'Asia/Manila')::date::text d")).d;
  const inDays = async (n) => (await one(`select ((now() at time zone 'Asia/Manila')::date + ${n})::text d`)).d;
  const tomorrow = await inDays(1);
  await db.query(`insert into public.cdf_orders(id,num,date,slot,channel,customer_name,customer_phone,buyer_phone)
    values ('b0000000-0000-0000-0000-000000000001','0500',$1,'11:00 - 13:00','Instagram','Ana','+639170000001','+34612345678')`, [tomorrow]);
  const before = await count('public.cdf_orders');
  await db.exec(migration('cdf_order_requests'));
  assert.equal(await count('public.cdf_orders'), before);
  ok('The migration applies on top of Phases 1 and 2 and leaves existing orders alone');
  await assert.rejects(db.exec(migration('cdf_order_requests')));
  ok('Applying it a second time stops instead of half-applying');

  // ---------- receiving (what the public function does, as the service role) ----------
  const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
  const session = async ({ files = { reference: 2, payment_proof: 1 }, expired = false } = {}) => {
    const token = crypto.randomBytes(16).toString('hex');
    const { id } = await one(`insert into public.cdf_upload_sessions(token_hash, ip_hash, expires_at) values ($1, 'iphash', now() + interval '${expired ? '-1 minute' : '2 hours'}') returning id`, [sha(token)]);
    const made = { reference: [], payment_proof: [] };
    for (const [kind, n] of Object.entries(files)) for (let i = 0; i < n; i++) {
      const f = crypto.randomUUID();
      await db.query(`insert into public.cdf_request_files(id, session_id, kind, path, status, mime, width, height) values ($1,$2,$3,$4,'ready','image/jpeg',96,64)`, [f, id, kind, `${id}/${f}.jpg`]);
      made[kind].push(f);
    }
    return { token, hash: sha(token), id, files: made };
  };
  const request = (s, extra = {}) => ({ request_key: crypto.randomUUID(), lang: 'en', buyer_name: 'Jose Santos', buyer_phone: '+34612345678',
    receiver_name: 'Maria Santos', receiver_phone: '+639171234567', mode: 'delivery', date: tomorrow, slot: '11:00 - 13:00',
    address: '12 Mabini St, Brgy. Loyola Heights, Quezon City', lat: 14.6397, lng: 121.0775, location_source: 'search',
    location_confirmed_at: new Date().toISOString(), description: 'A dozen red roses', special_requests: 'No lilies', card_message: 'Happy birthday',
    payment_method: 'gcash', reference_files: s.files.reference, payment_proof: s.files.payment_proof[0] || null, ...extra });
  const submit = async (s, r) => (await one('select public.cdf_request_submit($1, $2, $3) r', [s.hash, 'iphash', r])).r;

  await root();
  const s1 = await session(), r1 = request(s1);
  const first = await submit(s1, r1);
  assert.equal(first.replayed, false); assert.equal(typeof first.ref, 'number');
  const req1 = await one('select * from public.cdf_order_requests where id = $1', [first.id]);
  assert.equal(req1.status, 'received'); assert.equal(req1.buyer_phone, '+34612345678'); assert.equal(Number(req1.lat), 14.6397);
  assert.equal(await count('public.cdf_request_files', `request_id = '${first.id}'`), 3);
  assert((await one('select submitted_at from public.cdf_upload_sessions where id = $1', [s1.id])).submitted_at);
  assert.deepEqual((await rows('select kind, by_email from public.cdf_request_events where request_id = $1', [first.id])), [{ kind: 'received', by_email: null }]);
  const notice = (await rows('select url, body from net.calls order by id')).at(-1);
  assert(notice.url.endsWith('/functions/v1/cdf-push'));
  assert.deepEqual(Object.keys(notice.body).sort(), ['id', 'kind', 'outbox']); assert.equal(notice.body.kind, 'request'); assert.equal(notice.body.id, first.id);
  assert(!/Jose|Maria|Mabini|\+34|\+63|roses/.test(JSON.stringify(notice.body)), 'nothing personal in the notice');
  assert.equal(await count('public.cdf_orders'), before, 'a request is not an order');
  assert.equal(await count('public.cdf_order_prices'), 0);
  ok('A request is stored with its files, the session closed, its history started and one notice queued; no order, no sale, nothing personal in the notice');

  { const calls = await count('net.calls'), again = await submit(s1, r1);
    assert.deepEqual(again, { id: first.id, ref: first.ref, replayed: true });
    assert.equal(await count('public.cdf_order_requests'), 1); assert.equal(await count('net.calls'), calls);
    await assert.rejects(submit(s1, { ...r1, description: 'Something else' }), /cdf_operation_conflict/);
    const s2 = await session({ files: {} });
    await assert.rejects(submit(s2, { ...r1, reference_files: [], payment_proof: null }), /cdf_operation_conflict/);
    assert.equal(await count('public.cdf_order_requests'), 1); }
  ok('The same request again returns the first one (no second request or notice); the same key with other content, or from another session, is refused');

  { const s3 = await session(), other = await session(), was = await count('public.cdf_order_requests');
    await assert.rejects(submit(s3, request(s3, { reference_files: other.files.reference })), /cdf_request_files/);
    await assert.rejects(submit(s3, request(s3, { reference_files: [s3.files.payment_proof[0]], payment_proof: null })), /cdf_request_files/);
    await assert.rejects(submit(s3, request(s3, { reference_files: s1.files.reference })), /cdf_request_files/);
    await assert.rejects(submit(s3, request(s3, { date: await inDays(-1) })), /cdf_invalid_request/);
    await assert.rejects(submit(s3, request(s3, { date: await inDays(91) })), /cdf_invalid_request/);
    await assert.rejects(submit(s3, request(s3, { lat: 40.4, lng: -3.7 })), /cdf_order_requests_place/);
    await assert.rejects(submit(s3, request(s3, { buyer_phone: '612345678' })), /cdf_order_requests_buyer_phone_check/);
    await assert.rejects(submit(s3, request(s3, { mode: 'pickup' })), /cdf_order_requests_place/);
    const expired = await session({ expired: true });
    await assert.rejects(submit(expired, request(expired)), /cdf_session_invalid/);
    assert.equal(await count('public.cdf_order_requests'), was);
    assert.equal(await count('public.cdf_request_files', `session_id = '${s3.id}' and request_id is null`), 3, 'nothing was attached');
    const pickup = await submit(s3, request(s3, { mode: 'pickup', address: '', lat: null, lng: null, location_source: null, location_confirmed_at: null }));
    assert.equal((await one('select mode, lat from public.cdf_order_requests where id = $1', [pickup.id])).lat, null); }
  ok("Another session's photos, a proof passed off as a reference, an attached file, past or far dates, a point abroad, a bad phone and an expired session are refused; pickup needs no point");

  // ---------- who can see and do what ----------
  for (const who of [null, 'flo@t', 'dri@t']) {
    await as(who);
    for (const t of ['cdf_order_requests', 'cdf_request_events', 'cdf_outbox']) {
      const r = await db.query(`select count(*)::int n from public.${t}`).then((x) => x.rows[0].n, (e) => e.code);
      assert(r === 0 || r === '42501', `${who}: ${t} → ${r}`);
    }
    const files = await db.query('select count(*)::int n from public.cdf_request_files').then((x) => x.rows[0].n, (e) => e.code);
    assert(files === 0 || files === '42501');
    for (const sql of [`select public.cdf_request_open('${first.id}')`, `select public.cdf_request_reject('${first.id}', 'x')`,
      `select public.cdf_request_similar('${first.id}')`, "select public.cdf_outbox_retry()", "select public.cdf_outbox_done(1)",
      `select public.cdf_request_submit('x','y','{}')`]) await assert.rejects(db.query(sql), { code: '42501' }, `${who}: ${sql}`);
  }
  await as('admin@t');
  assert.equal(await count('public.cdf_order_requests'), 2);
  assert.equal(await count('public.cdf_request_files'), 6, 'admins see the files of the two requests, never stray uploads');
  for (const sql of [`update public.cdf_order_requests set status = 'accepted'`, `delete from public.cdf_order_requests`,
    `insert into public.cdf_order_requests(request_key) values (gen_random_uuid())`, `update public.cdf_request_files set status = 'removed'`,
    "select * from public.cdf_outbox", "select public.cdf_outbox_retry()", `select public.cdf_request_submit('x','y','{}')`])
    await assert.rejects(db.query(sql), { code: '42501' }, sql);
  ok('Visitors, florists and drivers see no requests; admins read them but change them only through the review functions, and cannot send requests or notices themselves');

  // ---------- reviewing ----------
  const opened = (await one('select public.cdf_request_open($1) r', [first.id])).r;
  assert.equal(opened.status, 'in_review'); assert.equal(opened.reviewed_by, 'admin@t');
  await as('admin2@t');
  assert.equal((await one('select public.cdf_request_open($1) r', [first.id])).r.reviewed_by, 'admin@t', 'opening it again changes nothing');
  assert.equal(await count('public.cdf_request_events', `request_id = '${first.id}' and kind = 'opened'`), 1);
  await assert.rejects(db.query('select public.cdf_request_open($1)', [crypto.randomUUID()]), /cdf_request_gone/);
  ok('Opening a request marks it “in review” and records who has it, once');

  { const sim = (await one('select public.cdf_request_similar($1) r', [first.id])).r;
    assert.deepEqual(sim.orders.map((o) => o.num), ['0500']);
    await root(); const s4 = await session({ files: {} });
    const twin = await submit(s4, request(s4, { reference_files: [], payment_proof: null, buyer_phone: '+639171234567', receiver_phone: '+639189999999' }));
    await as('admin2@t');
    const ids = (await one('select public.cdf_request_similar($1) r', [first.id])).r.requests.map((r) => r.id);
    assert(ids.includes(twin.id), 'a request whose buyer is this one\'s receiver'); assert.equal(ids.length, 2, 'and the pickup sent by the same buyer'); }
  ok('Requests and orders for the same phone on the same day are pointed out (never blocked)');

  const price = 2500, down = { amount: 2000, method: 'gcash', reference: 'GC-1', paid_at: today, proofs: [] };
  const orderFrom = (extra = {}) => ({ id: crypto.randomUUID(), num: '0600', date: tomorrow, slot: '11:00 - 13:00', channel: 'Web', vendor_email: 'flo@t',
    customer_name: 'Maria Santos', customer_phone: '+639171234567', buyer_name: 'Jose Santos', buyer_phone: '+34612345678',
    address: '12 Mabini St, Brgy. Loyola Heights, Quezon City', drop_lat: 14.6397, drop_lng: 121.0775, card_message: 'Happy birthday', notes: 'A dozen red roses', ...extra });
  const accept = async (id, key, order, p = price, pay = down) => (await one('select public.cdf_request_accept($1,$2,$3,$4,$5) r', [id, key, order, p, pay])).r;

  await as('flo@t');
  await assert.rejects(accept(first.id, crypto.randomUUID(), orderFrom()), { code: '42501' });
  await as('admin@t');
  // A failure inside (the order number is taken) leaves the request as it was and no order behind
  { const was = await count('public.cdf_orders');
    await assert.rejects(accept(first.id, crypto.randomUUID(), orderFrom({ num: '0500' })), { code: '23505' });
    assert.equal(await count('public.cdf_orders'), was);
    assert.equal((await one('select status from public.cdf_order_requests where id = $1', [first.id])).status, 'in_review'); }
  ok('A florist cannot accept; a failure while creating the order leaves the request in review and no order');

  const key = crypto.randomUUID(), order = orderFrom();
  const made = await accept(first.id, key, order);
  assert.equal(made.replayed, false); assert.equal(made.order.num, '0600'); assert.equal(made.order.status, 'Preparing');
  assert.equal(Number(made.price.amount) - Number(made.price.paid), 500);
  assert.equal(made.request.status, 'accepted'); assert.equal(made.request.accepted_order_id, made.order.id);
  assert.equal((await one("select detail->>'num' n from public.cdf_request_events where request_id = $1 and kind = 'accepted'", [first.id])).n, '0600');
  ok('Accepting creates the order with its price and down payment (₱2,500 − ₱2,000 = ₱500) and closes the request, in one step');

  { const was = await count('public.cdf_orders');
    const again = await accept(first.id, key, order);
    assert.equal(again.replayed, true); assert.equal(again.order.id, made.order.id);
    await assert.rejects(accept(first.id, key, { ...order, num: '0601' }), /cdf_operation_conflict/);
    await as('admin2@t');
    await assert.rejects(accept(first.id, crypto.randomUUID(), orderFrom({ num: '0602' })), /cdf_request_taken/);
    await assert.rejects(db.query('select public.cdf_request_reject($1, $2)', [first.id, 'late']), /cdf_request_closed/);
    await as('admin@t');
    assert.equal(await count('public.cdf_orders'), was); }
  ok('Accepting again after a lost answer returns the same order; another admin accepting or rejecting afterwards is refused');

  // Reject, reject again, cannot accept; reopen and accept
  { const second = (await rows("select id from public.cdf_order_requests where status = 'received' order by ref limit 1"))[0].id;
    const rej = (await one('select public.cdf_request_reject($1, $2) r', [second, 'Out of stock that day'])).r;
    assert.equal(rej.status, 'rejected'); assert.equal(rej.reject_reason, 'Out of stock that day');
    assert.equal((await one('select public.cdf_request_reject($1, $2) r', [second, 'again'])).r.reject_reason, 'Out of stock that day');
    await assert.rejects(accept(second, crypto.randomUUID(), orderFrom({ num: '0610' })), /cdf_request_closed/);
    await assert.rejects(db.query('select public.cdf_request_reject($1, $2)', [second, 'x'.repeat(501)]), /cdf_invalid_request/);
    const back = (await one('select public.cdf_request_reopen($1) r', [second])).r;
    assert.equal(back.status, 'in_review'); assert.equal(back.reject_reason, null);
    await assert.rejects(db.query('select public.cdf_request_reopen($1)', [first.id]), /cdf_request_closed/);
    assert.equal((await accept(second, crypto.randomUUID(), orderFrom({ num: '0611', id: crypto.randomUUID() }), 1800, null)).request.status, 'accepted');
    assert.deepEqual((await rows('select kind from public.cdf_request_events where request_id = $1 order by id', [second])).map((e) => e.kind), ['received', 'rejected', 'reopened', 'accepted']); }
  ok('Rejecting keeps the reason, is not repeated, and blocks accepting; a rejection can be undone, an acceptance cannot');

  // ---------- photos from the order ----------
  { const refs = (rows) => rows.map((r) => r.kind).join(',');
    await as('admin@t');
    const adminSees = await rows('select * from public.cdf_order_references($1)', [made.order.id]);
    assert.equal(refs(adminSees), 'reference,reference,payment_proof'); assert.equal(Number(adminSees[0].request_ref), first.ref);
    const proofPath = adminSees[2].path, refPath = adminSees[0].path;
    assert.equal((await one('select public.cdf_can_read_request_file($1) v', [proofPath])).v, true);
    await as('flo@t'); // the order's florist
    assert.equal(refs(await rows('select * from public.cdf_order_references($1)', [made.order.id])), 'reference,reference');
    assert.equal((await one('select public.cdf_can_read_request_file($1) v', [refPath])).v, true);
    assert.equal((await one('select public.cdf_can_read_request_file($1) v', [proofPath])).v, false, 'never the payment proof');
    await as(FLO2.email); // another florist
    assert.equal((await rows('select * from public.cdf_order_references($1)', [made.order.id])).length, 0);
    assert.equal((await one('select public.cdf_can_read_request_file($1) v', [refPath])).v, false);
    await as('dri@t');
    assert.equal((await one('select public.cdf_can_read_request_file($1) v', [refPath])).v, false);
    await as(null);
    await assert.rejects(db.query('select * from public.cdf_order_references($1)', [made.order.id]), { code: '42501' });
    await root();
    const stray = (await one("select path from public.cdf_request_files where request_id is null limit 1")).path;
    await as('admin@t');
    assert.equal((await one('select public.cdf_can_read_request_file($1) v', [stray])).v, false, 'not even admins read a file that was never sent'); }
  ok("The order's florist sees the customer's reference photos (not the payment proof); other florists, drivers and visitors see nothing");

  // ---------- notices that did not get through ----------
  { await root();
    const pending = await one('select id, attempts from public.cdf_outbox where ref_id = $1', [first.id]);
    assert.equal(pending.attempts, 1);
    assert.equal((await one('select public.cdf_outbox_retry() n')).n, 0, 'not before two minutes');
    await db.exec("update public.cdf_outbox set last_attempt_at = now() - interval '3 minutes'");
    const calls = await count('net.calls');
    const resent = (await one('select public.cdf_outbox_retry() n')).n;
    assert(resent >= 1); assert.equal(await count('net.calls'), calls + resent);
    await db.query('select public.cdf_outbox_done($1)', [pending.id]);
    for (let i = 0; i < 6; i++) { await db.exec("update public.cdf_outbox set last_attempt_at = now() - interval '3 minutes'"); await db.query('select public.cdf_outbox_retry()'); }
    assert.equal((await one('select attempts, delivered_at is not null d from public.cdf_outbox where id = $1', [pending.id])).d, true);
    assert((await rows('select attempts from public.cdf_outbox where delivered_at is null')).every((r) => r.attempts === 5), 'five tries at most'); }
  ok('A notice not confirmed after two minutes is sent again, five times at most; a confirmed one never again');

  // ---------- requests are not sales ----------
  { await as('admin@t');
    const buyer = Number((await one("select total from public.cdf_buyer_history('34612345678', null)")).total);
    await root();
    const sum = Number((await one("select coalesce(sum(p.amount),0) s from public.cdf_order_prices p join public.cdf_orders o on o.id = p.order_id where o.buyer_phone = '+34612345678'")).s);
    assert.equal(buyer, sum); }
  ok('Only accepted requests count, as the orders they became');

  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });
