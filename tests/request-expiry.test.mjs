// Requests left unanswered past their day expire (and the admins are told); what was sent is deleted 90
// days after a request is closed, and right away (a day later) when the form was never sent.
// Migration 20261112090000 + cleanup() of cdf-public-order, on an in-memory database.
// NODE_PATH=.test-tools/node_modules node --experimental-strip-types tests/request-expiry.test.mjs
import assert from "node:assert";
import { createRequire } from "node:module";
import { cleanup } from "../supabase/functions/cdf-public-order/handler.ts";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const { build, TEAM } = require("./lib/fresh-db.cjs");
const ok = (n) => console.log("ok " + n);
const db = new PGlite();
await build((sql) => db.exec(sql));
await db.exec(TEAM);
const one = async (q, a) => (await db.query(q, a)).rows[0];
const SETOF = new Set(["cdf_requests_purge_list"]);
const rpc = async (name, args) => {
  const keys = Object.keys(args);
  const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
  try {
    if (SETOF.has(name)) return { data: (await db.query(`select * from ${call}`, keys.map((k) => args[k]))).rows, error: null };
    return { data: (await db.query(`select ${call} as r`, keys.map((k) => args[k]))).rows[0].r, error: null };
  } catch (e) { return { data: null, error: { message: e.message } }; }
};

// A session per request, with one photo each; dates relative to Manila's today
const today = (await one("select ((now() at time zone 'Asia/Manila')::date)::text d")).d;
let n = 0;
async function request(status, dayOffset, closedDaysAgo = 0) {
  n++;
  const s = (await one(`insert into public.cdf_upload_sessions(token_hash, ip_hash, expires_at, submitted_at) values ('t${n}', 'ip', now() - interval '3 days', now()) returning id`)).id;
  const r = (await one(`insert into public.cdf_order_requests(request_key, session_id, status, buyer_name, buyer_phone, receiver_name, receiver_phone, mode, date, slot,
      description, payment_method, fingerprint, accepted_key, updated_at)
    values (gen_random_uuid(), $1, $2, 'Ana', '+639171234567', 'Ben', '+639171234568', 'pickup', (now() at time zone 'Asia/Manila')::date + $3::int, '09:00 - 11:00', 'Roses', 'gcash', 'f',
      case when $2 = 'accepted' then gen_random_uuid() end, now() - make_interval(days => $4)) returning id`, [s, status, dayOffset, closedDaysAgo])).id;
  await db.query(`insert into public.cdf_request_files(session_id, request_id, kind, path, status) values ($1, $2, 'reference', $3, 'ready')`, [s, r, `${s}/p${n}.jpg`]);
  return r;
}
const statusOf = async (id) => (await one("select status from public.cdf_order_requests where id = $1", [id]))?.status;

const late = await request("received", -1), reviewing = await request("in_review", -2), todayOne = await request("received", 0), future = await request("in_review", 3);
const pushes = [];
await db.exec(`create or replace function public.cdf_push_hook(p_body jsonb) returns void language plpgsql as $$ begin
  create temp table if not exists pushed(b jsonb); insert into pushed values (p_body); end $$`);
assert.equal((await one("select public.cdf_requests_expire() r")).r, 2);
assert.equal(await statusOf(late), "expired"); assert.equal(await statusOf(reviewing), "expired");
assert.equal(await statusOf(todayOne), "received"); assert.equal(await statusOf(future), "in_review");
for (const r of (await db.query("select b from pushed")).rows) pushes.push(r.b);
assert.deepEqual(pushes.map((p) => p.kind).sort(), ["request_expired", "request_expired"]);
assert.deepEqual(new Set(pushes.map((p) => p.id)), new Set([late, reviewing]));
assert(!JSON.stringify(pushes).match(/Ana|\+63/), "no personal data in the notice");
assert.equal((await one("select count(*)::int c from public.cdf_request_events where kind = 'expired'")).c, 2);
assert.equal((await one("select public.cdf_requests_expire() r")).r, 0, "only once");
ok(`Requests still open after their day (${today} Manila) expire, once; today's and future ones stay; each admin notice carries no personal data`);

// Deletion: 90 days after closing (rejected/expired), never for accepted, a day after an unsent form
const oldRejected = await request("rejected", -100, 91), oldExpired = await request("expired", -100, 95), recentRejected = await request("rejected", -10, 10);
const accepted = await request("accepted", -200, 200);
const s = (await one(`insert into public.cdf_upload_sessions(token_hash, ip_hash, expires_at) values ('abandoned', 'ip', now() - interval '2 days') returning id`)).id;
await db.query(`insert into public.cdf_request_files(session_id, kind, path, status) values ($1, 'reference', $2, 'ready')`, [s, `${s}/never-sent.jpg`]);
const live = (await one(`insert into public.cdf_upload_sessions(token_hash, ip_hash) values ('live', 'ip') returning id`)).id;
await db.query(`insert into public.cdf_request_files(session_id, kind, path, status) values ($1, 'reference', $2, 'ready')`, [live, `${live}/in-progress.jpg`]);

const removed = [];
let failStorage = true;
const unstore = async (paths) => { if (failStorage) return { error: { message: "down" } }; removed.push(...paths); return { error: null }; };
await assert.rejects(cleanup({ rpc, unstore }), /storage/);
assert.equal(await statusOf(oldRejected), "rejected", "nothing deleted while the files are still there");
failStorage = false;
const out = await cleanup({ rpc, unstore });
assert.deepEqual(out, { files: 3, requests: 2, sessions: 3 });
assert.equal(removed.length, 3); assert(removed.some((p) => p.endsWith("never-sent.jpg")));
assert.equal(await statusOf(oldRejected), undefined); assert.equal(await statusOf(oldExpired), undefined);
assert.equal(await statusOf(recentRejected), "rejected"); assert.equal(await statusOf(accepted), "accepted");
assert.equal(await statusOf(late), "expired", "expired today: kept 90 days");
assert.equal((await one("select count(*)::int c from public.cdf_request_files where path like $1", [`${live}/%`])).c, 1, "a form being filled in is untouched");
assert.deepEqual(await cleanup({ rpc, unstore }), { files: 0, requests: 0, sessions: 0 });
ok("Rejected or expired requests go with their photos after 90 days; accepted ones stay; unsent forms' photos go after a day; storage trouble deletes nothing");

await db.exec("reset role; set role anon");
await assert.rejects(db.query("select public.cdf_requests_purge('{}')"), /permission denied/);
await db.exec("reset role; set role authenticated");
await assert.rejects(db.query("select public.cdf_requests_expire()"), /permission denied/);
ok("None of it can be called from a browser");
