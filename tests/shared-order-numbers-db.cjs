
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { build, migration, TEAM, claims } = require('./lib/fresh-db.cjs');

async function run() {
  const db = new PGlite();
  const one = async (sql, args) => (await db.query(sql, args)).rows[0];
  const as = async (role, email) => {
    await db.exec('reset role');
    await one("select set_config('request.jwt.claims', $1, false)", [email ? claims(email) : '']);
    if (role) await db.exec('set role ' + role);
  };
  try {
    await build(sql => db.exec(sql), { until: 'cdf_shared_order_numbers' });
    await db.exec(TEAM);
    const { delivery_day: day } = await one("select ((now() at time zone 'Asia/Manila')::date + 1)::text as delivery_day");
    const order = { date: day, slot: '11:00 - 13:00', channel: 'Web' };
    const request = { ...order, buyer_name: 'Buyer', buyer_phone: '+639171234567',
      receiver_name: 'Receiver', receiver_phone: '+639171234568', mode: 'pickup',
      description: 'Red roses', payment_method: 'cash' };
    const create = async (data, key = randomUUID()) =>
      (await one('select public.cdf_create_order($1,$2,null,null) result', [key, data])).result;
    const accept = async (id, key, data) =>
      (await one('select public.cdf_request_accept($1,$2,$3,null,null) result', [id, key, data])).result;
    const auth = async () => as('authenticated', 'admin@t');
    const session = async () => {
      const token = randomUUID();
      await one("insert into public.cdf_upload_sessions(token_hash,ip_hash,expires_at) values ($1,'ip',now() + interval '1 hour')", [token]);
      return token;
    };
    const submit = async (token, data) =>
      (await one("select public.cdf_request_submit($1,'ip',$2) result", [token, data])).result;

    const oldToken = await session();
    const oldData = { ...request, request_key: randomUUID() };
    const legacy = await submit(oldToken, oldData);
    const previousKey = randomUUID();
    const previousData = { ...order, num: '0030' };
    await auth();
    const previous = await create(previousData, previousKey);
    await as();
    await one("insert into public.cdf_order_audit(order_id,order_num,action,by_email) values ($1,'9997','purged','admin@t')", [randomUUID()]);
    await db.exec(migration('cdf_shared_order_numbers'));
    assert.equal((await one('select ref, shared_number from public.cdf_order_requests where id=$1', [legacy.id])).shared_number, false);

    await as('service_role');
    assert.equal((await submit(oldToken, oldData)).shared_number, false);
    await as();
    const token = await session();
    const input = { ...request, request_key: randomUUID() };
    await auth();
    assert.deepEqual((await create(null, null)), { available: true, shared_numbers: true });
    assert.equal((await create(previousData, previousKey)).order.id, previous.order.id);
    const orderKey = randomUUID();
    const manual = await create({ ...order, num: null }, orderKey);
    assert.equal(manual.order.num, '9998');

    await as('service_role');
    const incoming = await submit(token, input);
    assert.equal(incoming.ref, 9999);
    assert.equal(incoming.shared_number, true);
    assert.deepEqual(await submit(token, input), { ...incoming, replayed: true });
    await one("insert into public.cdf_orders(num,date,slot,channel) values ('SH-123',$1,'11:00 - 13:00','Shopify')", [day]);

    await auth();
    assert.equal((await create({ ...order, num: null }, orderKey)).order.num, '9998');
    const later = await create(order);
    assert.equal(later.order.num, '10000');
    const acceptKey = randomUUID();
    const accepted = await accept(incoming.id, acceptKey, { ...order, num: '0011' });
    assert.equal(accepted.order.num, '9999');
    assert.equal(accepted.request.accepted_order_num, '9999');
    assert.equal((await accept(incoming.id, acceptKey, order)).order.id, accepted.order.id);
    await assert.rejects(accept(incoming.id, randomUUID(), order), /cdf_request_taken/);
    await assert.rejects(one('update public.cdf_orders set num = $2 where id = $1', [accepted.order.id, '0031']), /cdf_order_number_immutable/);

    // The direct staff path also works with a stale browser's proposed number.
    const direct = await one("insert into public.cdf_orders(num,date,slot,channel) values ('0031',$1,'11:00 - 13:00','Web') returning num", [day]);
    assert.equal(direct.num, '10001');
    assert.equal((await accept(legacy.id, randomUUID(), order)).order.num, '10002');
    console.log('ok: one sequence, stable acceptance and retries, direct staff inserts, preserved history and Shopify IDs');
  } finally {
    await db.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
