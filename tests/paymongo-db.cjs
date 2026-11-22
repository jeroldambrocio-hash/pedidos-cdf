// PayMongo for requests (branch paymongo-solicitudes): the database side, on a throwaway in-memory database built
// from every migration. It never connects to Supabase or PayMongo; pg_net only records calls.
// Covers the /review fixes (migration 20261122140000): a payment that cannot be applied is never silent, a request
// closed another way cancels its open link, one PayMongo page per link, a link that no longer exists answers "gone".
// Run: NODE_PATH=../pedidos-cdf/.test-tools/node_modules node tests/paymongo-db.cjs
const { PGlite } = require('@electric-sql/pglite');
const assert = require('assert'), crypto = require('crypto');
const { build, TEAM, claims } = require('./lib/fresh-db.cjs');

(async () => {
  const db = new PGlite();
  const ok = (m) => console.log('ok ' + m);
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const root = async () => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); };
  const as = async (who) => { await root(); await db.query("select set_config('request.jwt.claims',$1,false)", [claims(who)]); await db.exec('set role authenticated'); };
  const service = async () => { await root(); await db.exec('set role service_role'); };

  await build((sql) => db.exec(sql));
  await db.exec(TEAM);
  const day = (await one("select ((now() at time zone 'Asia/Manila')::date + 2)::text d")).d;

  const newRequest = async () => {
    const id = crypto.randomUUID();
    await root();
    await db.query(`insert into public.cdf_order_requests (id, request_key, buyer_name, buyer_phone, receiver_name, receiver_phone, mode, date, slot,
        description, payment_method, fingerprint, status, address, lat, lng, location_source, location_confirmed_at)
      values ($1, gen_random_uuid(), 'Ana Cruz', '+639171234567', 'Ana Cruz', '+639171234567', 'delivery', $2, '11:00 - 13:00', 'Roses', 'other', $3, 'received',
        '12 Mabini St, Quezon City', 14.6397, 121.0775, 'pin', now())`, [id, day, crypto.randomUUID()]);
    return id;
  };
  const order = () => ({ id: crypto.randomUUID(), num: null, date: day, slot: '11:00 - 13:00', channel: 'Web', vendor_email: 'flo@t',
    customer_name: 'Ana Cruz', customer_phone: '+639171234567', buyer_name: 'Ana Cruz', buyer_phone: '+639171234567',
    address: '12 Mabini St, Quezon City', drop_lat: 14.6397, drop_lng: 121.0775, card_message: '', notes: 'Roses' });
  const token = () => crypto.randomBytes(32).toString('base64url');
  const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
  const link = async (req, price = 1500) => {
    const t = token();
    await as('admin@t');
    const r = (await one('select public.cdf_request_paylink($1,$2,$3,$4,$5) r', [req, t, crypto.randomUUID(), order(), price])).r;
    await root();
    return { ...r, token: t };
  };
  const settle = async (pay, pid, amount = 1500) => {
    await service();
    try { return (await one("select public.cdf_paylink_settle($1,$2,$3,'gcash',now()) r", [pay, pid, amount])).r; } finally { await root(); }
  };
  const row = (pay) => one('select * from public.cdf_request_payments where id = $1', [pay]);
  const issueEvents = async (req) => (await one("select count(*)::int n from public.cdf_request_events where request_id = $1 and kind = 'pay_issue'", [req])).n;
  const notices = async (req) => (await one("select count(*)::int n from public.cdf_outbox where kind = 'pay_issue' and ref_id = $1", [req])).n;

  // ---------- paid once, then a second payment ----------
  const A = await newRequest(), la = await link(A);
  const paid = await settle(la.payment, 'pay_first');
  assert.equal(paid.result, 'paid', JSON.stringify(paid));
  assert.equal((await one('select status from public.cdf_order_requests where id = $1', [A])).status, 'accepted');
  assert.equal((await settle(la.payment, 'pay_first')).result, 'already');
  ok('A payment accepts the request and creates the order; the same payment again changes nothing');

  const second = await settle(la.payment, 'pay_second');
  assert.equal(second.result, 'issue'); assert.equal(second.issue, 'other_payment');
  let p = await row(la.payment);
  assert.equal(p.status, 'paid'); assert.equal(p.payment_id, 'pay_first');
  assert.match(p.issue, /other_payment · pay_second · 1500/);
  assert.equal(await issueEvents(A), 1); assert.equal(await notices(A), 1);
  assert.equal((await settle(la.payment, 'pay_second')).result, 'issue');
  assert.equal(await issueEvents(A), 1, 'the webhook and the check both arriving record it once');
  ok('A second payment on a paid link is recorded, written in the history and pushed to the admins (once)');

  // ---------- rejected while the link was open ----------
  const B = await newRequest(), lb = await link(B);
  await as('admin@t');
  await one("select public.cdf_request_reject($1, 'No stock') r", [B]);
  await root();
  assert.equal((await row(lb.payment)).status, 'cancelled');
  await service();
  const vb = (await one('select public.cdf_paylink_view($1) v', [sha(lb.token)])).v;
  await root();
  assert.equal(vb.status, 'cancelled');
  const late = await settle(lb.payment, 'pay_late');
  assert.equal(late.issue, 'paid_after_cancel');
  assert.equal(await notices(B), 1);
  ok('Rejecting a request cancels its open link; a payment that still arrives is flagged and pushed');

  // ---------- several issues are kept, and the page stops offering to pay ----------
  const C = await newRequest(), lc = await link(C);
  assert.equal((await settle(lc.payment, 'pay_short', 900)).issue, 'amount_mismatch');
  assert.equal((await settle(lc.payment, 'pay_short2', 800)).issue, 'amount_mismatch');
  p = await row(lc.payment);
  assert.match(p.issue, /pay_short ·/); assert.match(p.issue, /pay_short2 ·/);
  assert.equal(p.status, 'open'); assert.equal(p.checkout_url, null);
  await service();
  const vc = (await one('select public.cdf_paylink_view($1) v', [sha(lc.token)])).v;
  assert.equal(vc.review, true);
  ok('Issues are added, not overwritten; a link with an issue says "review" and offers no PayMongo page');

  // ---------- one PayMongo page per link ----------
  const D = await newRequest(), ld = await link(D);
  await service();
  const checkout = async (prev, id) => (await one("select public.cdf_paylink_checkout($1,$2,$3,'https://pm/'||$3,now()+interval '1 hour') r", [ld.payment, prev, id])).r;
  assert.equal(await checkout(null, 'cs_one'), true);
  assert.equal(await checkout(null, 'cs_two'), false, 'a second page opened at the same moment is refused');
  assert.equal(await checkout('cs_one', 'cs_three'), true, 'replacing the page the caller saw is fine');
  assert.equal((await row(ld.payment)).checkout_id, 'cs_three');
  ok('Only the caller that saw the current PayMongo page can replace it');

  // ---------- permanent problems answer, never fail ----------
  assert.equal((await settle(crypto.randomUUID(), 'pay_x')).result, 'gone');
  await service();
  const iss = (await one("select public.cdf_paylink_issue($1,'payment_check_several_payments','cs_three') r", [ld.payment])).r;
  assert.equal(iss.result, 'issue'); assert.equal(iss.recorded, true);
  assert.equal((await one("select public.cdf_paylink_issue($1,'payment_check_several_payments','cs_three') r", [ld.payment])).r.recorded, false);
  await root();
  assert.equal(await issueEvents(D), 1);
  ok('A link that no longer exists answers "gone"; PayMongo answers that do not match are recorded once');

  // ---------- nobody else can call the server-only functions ----------
  await as('admin@t');
  await assert.rejects(one("select public.cdf_paylink_settle($1,'x',1,'gcash',now())", [ld.payment]), { code: '42501' });
  await assert.rejects(one("select public.cdf_paylink_issue($1,'x','y')", [ld.payment]), { code: '42501' });
  await assert.rejects(one("select public.cdf_paylink_flag($1,'x','y',1)", [ld.payment]), { code: '42501' });
  await root();
  ok('Admins cannot settle or flag payments themselves (service role only)');

  // A new quote cannot replace an unchecked checkout, even through the database RPC.
  const E = await newRequest(), le = await link(E);
  await service();
  assert.equal((await one("select public.cdf_paylink_checkout($1,null,'cs_replace','https://pm/cs_replace',now()+interval '1 hour') r", [le.payment])).r, true);
  await assert.rejects(link(E, 1800), /cdf_paymongo_unreachable/);
  assert.equal((await row(le.payment)).status, 'open');
  await assert.rejects(one("select public.cdf_paylink_confirm_closed($1,'cs_replace')", [le.payment]), { code: '42501' });
  await service();
  assert.equal((await one("select public.cdf_paylink_confirm_closed($1,'cs_wrong') r", [le.payment])).r, false);
  assert.equal((await one("select public.cdf_paylink_confirm_closed($1,'cs_replace') r", [le.payment])).r, true);
  const replacement = await link(E, 1800);
  assert.equal(replacement.amount, 1800);
  assert.equal((await row(le.payment)).status, 'cancelled');
  ok('Replacing a quote requires service confirmation for the current checkout');

  console.log('\nAll PayMongo database checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
