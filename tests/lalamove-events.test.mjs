// Phase 5: Lalamove webhook, booking history and proofs (events.ts) on the real SQL of migration
// 20261111130000, in an in-memory database. Lalamove, the image hosts and the bucket are stand-ins;
// nothing goes to the network.
// Run: NODE_PATH=.test-tools/node_modules node --experimental-strip-types tests/lalamove-events.test.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { checkSignature, download, eventProofs, eventTime, hostAllowed, popImages, processEvent, proofUrl, receive, sniffImage, work } from "../supabase/functions/cdf-lalamove/events.ts";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const { build, migration, TEAM, claims } = require("./lib/fresh-db.cjs");
const ok = (n) => console.log("ok " + n);
const sha = (v) => createHash("sha256").update(v).digest("hex");

const db = new PGlite();
const root = () => db.exec("reset role");
const one = async (sql, args) => (await db.query(sql, args)).rows[0];
const rows = async (sql, args) => (await db.query(sql, args)).rows;
const ORDER = "c0000000-0000-0000-0000-000000000001", ORDER2 = "c0000000-0000-0000-0000-000000000002";

// ---------- upgrade: the database as production has it, with a booking already made ----------
await build((sql) => db.exec(sql), { until: "cdf_lalamove_events" });
await db.exec(TEAM);
await db.exec(`insert into public.cdf_orders(id,num,date,slot,channel,customer_name,vendor_email)
    values ('${ORDER}','5001',current_date,'10:00 - 12:00','Web','Ana','flo@t'),('${ORDER2}','5002',current_date,'10:00 - 12:00','Web','Ben',null);
  insert into public.cdf_lalamove(order_id, env, ll_order_id, status, booked_at) values ('${ORDER}','production','3626117933572534460','COMPLETED', now() - interval '1 hour');`);
const before = await one("select to_jsonb(l) - 'updated_at' r from public.cdf_lalamove l");
await db.exec(migration("cdf_lalamove_events"));
await db.exec(migration("cdf_lalamove_reconcile_fix"));
await db.exec(migration("cdf_lalamove_proof_links"));
await db.exec(migration("cdf_lalamove_proofs_removed_by"));
assert.deepEqual((await one("select to_jsonb(l) - 'updated_at' r from public.cdf_lalamove l")).r, before.r);
assert.deepEqual(await one("select order_id, env, status from public.cdf_lalamove_shipments where ll_order_id = '3626117933572534460'"),
  { order_id: ORDER, env: "production", status: "COMPLETED" });
ok("The migration applies on top of a real booking: cdf_lalamove is untouched and the booking starts its history");

// ---------- stand-ins ----------
const SETOF = new Set(["cdf_ll_events_claim", "cdf_ll_proofs_due", "cdf_ll_reconcile_due"]);
let dbDown = false;
const rpc = async (name, args) => {
  if (dbDown) return { data: null, error: { message: "connection refused" } };
  const keys = Object.keys(args);
  const vals = keys.map((k) => (args[k] && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
  const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
  try {
    if (SETOF.has(name)) {
      const r = (await db.query(`select * from ${call}`, vals)).rows;
      return { data: name === "cdf_ll_reconcile_due" ? r.map((x) => x.cdf_ll_reconcile_due) : r, error: null };
    }
    return { data: (await db.query(`select ${call} as r`, vals)).rows[0].r, error: null };
  } catch (e) { return { data: null, error: { message: e.message } }; }
};
const lalamove = new Map();                  // GET /v3/orders/{id} answers
const llCalls = [];
const refreshed = [];
let refreshFails = 0;
const stored = new Map();
let web = {};                                // url → () => Response
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 2, 3, 4, 5]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const d = {
  env: "production", key: "pk_prod", secret: "sk_prod", rpc,
  ll: async (method, path) => {
    llCalls.push(method + " " + path);
    const id = path.split("/")[3];
    if (!lalamove.has(id)) throw new Error("404 ERR_ORDER_NOT_FOUND");
    return lalamove.get(id);
  },
  // index.ts refresh: reads the booking back, saves it, then notes its proofs
  refresh: async (orderId) => {
    if (refreshFails > 0) { refreshFails--; throw new Error("Lalamove 503"); }
    refreshed.push(orderId);
    const { ll_order_id } = await one("select ll_order_id from public.cdf_lalamove where order_id = $1", [orderId]);
    const o = lalamove.get(ll_order_id);
    await db.query("update public.cdf_lalamove set status = $2 where order_id = $1", [orderId, o.status]);
    const { afterRefresh } = await import("../supabase/functions/cdf-lalamove/events.ts");
    await afterRefresh(d, ll_order_id, o);
  },
  fetch: async (url) => { const f = web[url]; if (!f) throw new Error("no network in tests: " + url); return f(); },
  store: async (path, bytes, mime) => { stored.set(path, { bytes, mime }); return { error: null }; },
  sha256: async (v) => sha(typeof v === "string" ? v : Buffer.from(v)),
  hmac: async (secret, text) => createHmac("sha256", secret).update(text).digest("hex"),
  proofHosts: ["lalamove.com"],
};
const URL_IN = new URL("https://x.supabase.co/cdf-lalamove?token=secret-token");
const sign = (body, path) => createHmac("sha256", "sk_prod").update(`${body.timestamp}\r\nPOST\r\n${path}\r\n\r\n${JSON.stringify(body.data)}`).digest("hex");
const event = (type, data, extra = {}) => ({ apiKey: "pk_prod", timestamp: 1794363225, eventId: "E-" + Math.random().toString(36).slice(2), eventType: type, eventVersion: "v3", data, ...extra });
const ev = async (id) => one("select * from public.cdf_lalamove_events where id = $1", [id]);
const claim = async (id) => (await rpc("cdf_ll_events_claim", { p_limit: 1, p_id: id })).data[0];

// ---------- receiving ----------
assert.equal(eventTime(1794363225), "2026-11-11T02:13:45.000Z");
assert.equal(eventTime("1794363225000"), "2026-11-11T02:13:45.000Z");
assert.equal(eventTime("2026-11-11T02:44:56.000Z"), "2026-11-11T02:44:56.000Z");
assert.equal(eventTime("soon"), null); assert.equal(eventTime(12), null);
ok("Lalamove's time is read in seconds, milliseconds or ISO; anything else is left empty");

{ const body = event("ORDER_STATUS_CHANGED", { order: { orderId: "3626117933572534460", status: "COMPLETED" }, updatedAt: "2026-11-11T02:44:56.000Z" });
  const raw = JSON.stringify(body);
  const r = await receive(d, raw, URL_IN, "observe");
  assert.equal(r.status, 200); assert.equal(r.duplicate, false);
  const row = await ev(r.eventId);
  assert.equal(row.event_type, "ORDER_STATUS_CHANGED"); assert.equal(row.ll_order_id, "3626117933572534460");
  assert.equal(row.status, "pending"); assert.equal(row.signature, "absent"); assert.deepEqual(row.payload, body);
  assert.equal(new Date(row.event_at).toISOString(), "2026-11-11T02:44:56.000Z");
  const again = await receive(d, raw, URL_IN, "observe");
  assert.equal(again.status, 200); assert.equal(again.duplicate, true); assert.equal(again.eventId, r.eventId);
  assert.equal((await ev(r.eventId)).duplicates, 1);
  assert.equal((await one("select count(*)::int n from public.cdf_lalamove_events")).n, 1);
  ok("An event is stored as received before the 200; the same event again is counted, not stored twice");

  // Same body without an eventId: the hash of the body is the key
  const noId = JSON.stringify({ ...body, eventId: undefined });
  const a = await receive(d, noId, URL_IN, "observe"), b = await receive(d, noId, URL_IN, "observe");
  assert.equal(b.duplicate, true); assert.equal(a.eventId, b.eventId);
  assert.equal((await ev(a.eventId)).event_key, "sha:" + sha(noId));
  ok("Without an eventId, the body's own hash keeps repeats out");

  dbDown = true;
  const down = await receive(d, JSON.stringify(event("DRIVER_ASSIGNED", {})), URL_IN, "observe");
  dbDown = false;
  assert.equal(down.status, 500);
  ok("If the event can't be stored, Lalamove gets a 500 and sends it again (never a 200 for a lost event)");

  assert.deepEqual(await receive(d, "", URL_IN, "observe"), { status: 200, body: { ok: true } });
  const bad = await receive(d, "{not json", URL_IN, "observe");
  assert.equal(bad.status, 200);
  const badRow = await ev(bad.eventId);
  assert.equal(badRow.event_type, "INVALID_JSON"); assert.deepEqual(badRow.payload, { _raw: "{not json" });
  assert.equal((await receive(d, "x".repeat(600 * 1024), URL_IN, "observe")).status, 413);
  ok("Lalamove's empty test call gets its 200; a body that isn't JSON is kept as text; an oversized one is refused");
}

{ // The signature: the API's formula, tried on the paths our URL can have; only recorded unless enforced
  const body = event("ORDER_STATUS_CHANGED", { order: { orderId: "1111111111" } });
  body.signature = sign(body, "/functions/v1/cdf-lalamove");
  assert.deepEqual(await checkSignature(d, body, URL_IN), { state: "valid", note: "fn" });
  body.signature = sign(body, "/cdf-lalamove?token=secret-token");
  assert.deepEqual(await checkSignature(d, body, URL_IN), { state: "valid", note: "path+query" });
  assert.deepEqual(await checkSignature(d, { ...body, apiKey: "pk_other" }, URL_IN), { state: "invalid", note: "apiKey" });
  assert.deepEqual(await checkSignature(d, { ...body, signature: undefined }, URL_IN), { state: "absent", note: null });
  const forged = { ...body, data: { order: { orderId: "1111111111", status: "COMPLETED" } } };
  assert.equal((await checkSignature(d, forged, URL_IN)).state, "invalid");
  assert.equal((await receive(d, JSON.stringify(forged), URL_IN, "enforce")).status, 401);
  const good = await receive(d, JSON.stringify(body), URL_IN, "enforce");
  assert.equal(good.status, 200);
  const row = await ev(good.eventId);
  assert.equal(row.signature, "valid"); assert.equal(row.signature_note, "path+query");
  assert(!JSON.stringify(row.signature_note).includes("secret-token"), "the token never goes in a note");
  ok("Signature: recorded (valid / invalid / absent, and which path matched) and, once enforced, the rest gets 401");
}

// ---------- working ----------
lalamove.set("3626117933572534460", { orderId: "3626117933572534460", status: "COMPLETED", metadata: { cdfOrder: "5001" },
  stops: [{ stopId: "S0" }, { stopId: "S1", POD: { status: "DELIVERED", image: "https://pod.lalamove.com/a.jpg", deliveredAt: "2026-11-11T02:44:30.000Z" } }] });
web["https://pod.lalamove.com/a.jpg"] = () => new Response(JPEG, { headers: { "content-type": "image/jpeg", "content-length": String(JPEG.length) } });

{ await db.exec("delete from public.cdf_lalamove_events");
  const r = await receive(d, JSON.stringify(event("POD_STATUS_CHANGED", { order: { orderId: "3626117933572534460" } })), URL_IN, "observe");
  refreshFails = 1;
  assert.equal(await processEvent(d, await claim(r.eventId)), "failed");
  let row = await ev(r.eventId);
  assert.equal(row.status, "failed"); assert.match(row.last_error, /503/);
  assert(new Date(row.next_attempt_at) > new Date(), "tried again later, not now");
  assert.equal(await claim(r.eventId), undefined, "not due yet");
  await db.exec("update public.cdf_lalamove_events set next_attempt_at = now()");
  const out = await work(d);
  assert.equal(out.events, 1); assert.equal(out.failed, 0);
  row = await ev(r.eventId);
  assert.equal(row.status, "done"); assert.equal(row.attempts, 2);
  assert.deepEqual(refreshed, [ORDER]);
  ok("A read-back from Lalamove that fails is no longer lost: the event is retried later and then done");

  const proof = await one("select * from public.cdf_lalamove_proofs where ll_order_id = '3626117933572534460'");
  assert.equal(proof.kind, "pod"); assert.equal(proof.stop_key, "S1"); assert.equal(proof.provider_status, "DELIVERED");
  assert.equal(proof.state, "available"); assert.equal(proof.sha256, sha(Buffer.from(JPEG)));
  assert.equal(proof.content_type, "image/jpeg"); assert.equal(proof.bytes, JPEG.length);
  assert.equal(new Date(proof.provider_at).toISOString(), "2026-11-11T02:44:30.000Z");
  assert.equal(proof.storage_path, `${ORDER}/3626117933572534460/pod-S1-${proof.sha256.slice(0, 16)}.jpg`);
  assert.deepEqual(stored.get(proof.storage_path).bytes, JPEG);
  ok("The delivery photo (stops[].POD) is downloaded into the private bucket, byte for byte, with its checksum, stop and time");

  // Lalamove gives a new link on every read: a proof already kept is not downloaded again
  lalamove.get("3626117933572534460").stops[1].POD.image = "https://pod.lalamove.com/a.jpg?sig=2";
  let fetched = 0; web["https://pod.lalamove.com/a.jpg?sig=2"] = () => { fetched++; return new Response(JPEG); };
  await d.refresh(ORDER);
  assert.equal(fetched, 0);
  assert.equal((await one("select state, storage_path from public.cdf_lalamove_proofs where id = $1", [proof.id])).storage_path, proof.storage_path);
  ok("A proof already kept is never downloaded again, even when Lalamove's link changes");

  // Twenty more of the same event: nothing new happens
  for (let i = 0; i < 3; i++) await receive(d, JSON.stringify((await ev(r.eventId)).payload), URL_IN, "observe");
  assert.equal((await ev(r.eventId)).duplicates, 3); assert.equal((await work(d)).events, 0);
  ok("Repeats of a handled event are not worked again");
}

{ // Eight failures in a row: dead, kept for someone to look at
  const r = await receive(d, JSON.stringify(event("ORDER_STATUS_CHANGED", { order: { orderId: "3626117933572534460" } })), URL_IN, "observe");
  for (let i = 0; i < 8; i++) {
    refreshFails = 1;
    await db.exec("update public.cdf_lalamove_events set next_attempt_at = now() where status = 'failed'");
    await processEvent(d, await claim(r.eventId));
  }
  const row = await ev(r.eventId);
  assert.equal(row.status, "dead"); assert.equal(row.attempts, 8);
  await db.exec("update public.cdf_lalamove_events set next_attempt_at = now()");
  assert.equal(await claim(r.eventId), undefined);
  ok("After eight failed tries an event is marked dead and left for the office, not retried for ever");
}

{ // Two workers at once never take the same event; a worker that died releases it after two minutes
  const r = await receive(d, JSON.stringify(event("DRIVER_ASSIGNED", { order: { orderId: "3626117933572534460" } })), URL_IN, "observe");
  assert(await claim(r.eventId)); assert.equal(await claim(r.eventId), undefined);
  await db.exec(`update public.cdf_lalamove_events set locked_until = now() - interval '1 second' where id = ${r.eventId}`);
  const again = await claim(r.eventId);
  assert.equal(again.attempts, 2);
  await processEvent(d, again);
  ok("An event is worked by one worker at a time; one left half-done is picked up again later");
}

{ // Wallet events are not ours to act on; events for orders that aren't ours stay as "unmatched"
  const w = await receive(d, JSON.stringify(event("WALLET_BALANCE_CHANGED", { balance: "100" })), URL_IN, "observe");
  assert.equal((await ev(w.eventId)).status, "ignored");
  lalamove.set("9999999999", { orderId: "9999999999", status: "ON_GOING", metadata: {} });
  const u = await receive(d, JSON.stringify(event("ORDER_STATUS_CHANGED", { order: { orderId: "9999999999" } })), URL_IN, "observe");
  assert.equal(await processEvent(d, await claim(u.eventId)), "unmatched");
  assert.equal((await one("select count(*)::int n from public.cdf_lalamove_shipments where ll_order_id = '9999999999'")).n, 0);
  ok("Wallet events are ignored; an order that isn't one of ours is left unmatched, nothing changes");
}

{ // ORDER_REPLACED: Lalamove swaps the booking; the new one carries our order number in its metadata
  await db.exec(`insert into public.cdf_lalamove(order_id, env, ll_order_id, status, booked_at) values ('${ORDER2}','production','4000000001','ON_GOING', now())`);
  lalamove.set("4000000001", { orderId: "4000000001", status: "CANCELED", metadata: { cdfOrder: "5002" }, stops: [] });
  lalamove.set("4000000002", { orderId: "4000000002", status: "ON_GOING", metadata: { cdfOrder: "5002" }, stops: [{}, { stopId: "T1", POD: { status: "PENDING" } }] });
  const rep = await receive(d, JSON.stringify(event("ORDER_REPLACED", { order: { orderId: "4000000001" } })), URL_IN, "observe");
  assert.equal(await processEvent(d, await claim(rep.eventId)), "done");
  assert((await one("select replace_noticed_at from public.cdf_lalamove_shipments where ll_order_id = '4000000001'")).replace_noticed_at);
  const nu = await receive(d, JSON.stringify(event("ORDER_STATUS_CHANGED", { order: { orderId: "4000000002" } })), URL_IN, "observe");
  assert.equal(await processEvent(d, await claim(nu.eventId)), "done");
  assert.equal((await one(`select ll_order_id, status from public.cdf_lalamove where order_id = '${ORDER2}'`)).ll_order_id, "4000000002");
  assert.equal((await one(`select status from public.cdf_lalamove where order_id = '${ORDER2}'`)).status, "ON_GOING");
  assert.deepEqual(await one("select replaced_from, order_id from public.cdf_lalamove_shipments where ll_order_id = '4000000002'"), { replaced_from: "4000000001", order_id: ORDER2 });
  assert.equal((await one("select replaced_by from public.cdf_lalamove_shipments where ll_order_id = '4000000001'")).replaced_by, "4000000002");
  assert.deepEqual(await one("select state, provider_status from public.cdf_lalamove_proofs where ll_order_id = '4000000002'"), { state: "pending", provider_status: "PENDING" });
  // A late event for the old booking doesn't take the order back to it
  const late = await receive(d, JSON.stringify(event("ORDER_STATUS_CHANGED", { order: { orderId: "4000000001", status: "CANCELED" } })), URL_IN, "observe");
  const n = refreshed.length;
  assert.equal(await processEvent(d, await claim(late.eventId)), "done");
  assert.equal(refreshed.length, n, "the order is not read back from the old booking");
  assert.equal((await one(`select ll_order_id from public.cdf_lalamove where order_id = '${ORDER2}'`)).ll_order_id, "4000000002");
  ok("A replaced booking: the new one is found through our own order number, the order follows it, and both stay in the history");
}

{ // Delivery failed, or delivered with no picture: "not provided"; a signature counts as a proof
  await db.exec(`insert into public.cdf_lalamove_shipments(ll_order_id, order_id, env, status) values ('5000000001','${ORDER2}','production','COMPLETED')`);
  lalamove.set("5000000001", { orderId: "5000000001", status: "COMPLETED",
    stops: [{}, { stopId: "A", POD: { status: "FAILED" } }, { stopId: "B", POD: { status: "SIGNED" } }, { stopId: "C", POD: { status: "SIGNED", image: "https://pod.lalamove.com/sig.png" } }] });
  web["https://pod.lalamove.com/sig.png"] = () => new Response(PNG);
  const r = await receive(d, JSON.stringify(event("POD_STATUS_CHANGED", { order: { orderId: "5000000001" } })), URL_IN, "observe");
  await processEvent(d, await claim(r.eventId));
  const by = Object.fromEntries((await rows("select stop_key, state, provider_status, content_type from public.cdf_lalamove_proofs where ll_order_id = '5000000001'")).map((x) => [x.stop_key, x]));
  assert.equal(by.A.state, "not_provided"); assert.equal(by.A.provider_status, "FAILED");
  assert.equal(by.B.state, "not_provided");
  assert.equal(by.C.state, "available"); assert.equal(by.C.content_type, "image/png");
  ok("Failed delivery or no picture: not provided; a signature image is kept like a photo");
}

{ // Links as Lalamove really sends them (diagnosis of 12/11/2026): http, on its own image host
  const H = ["lalamove.com"];
  assert.equal(proofUrl("http://sg-oimg.lalamove.com/a/b.jpg?x=1", H), "https://sg-oimg.lalamove.com/a/b.jpg?x=1");
  assert.equal(proofUrl("https://sg-oimg.lalamove.com/a.jpg", H), "https://sg-oimg.lalamove.com/a.jpg");
  assert.equal(proofUrl("https://elsewhere.example/a.jpg", H), "https://elsewhere.example/a.jpg", "https elsewhere: kept, the download refuses the host");
  for (const bad of ["http://evil.example/a.jpg", "http://sg-oimg.lalamove.com:8080/a.jpg", "http://user:pw@sg-oimg.lalamove.com/a.jpg",
    "http://lalamove.com.evil.io/a.jpg", "javascript:alert(1)", "ftp://sg-oimg.lalamove.com/a.jpg", "http://sg-oimg.lalamove.com/a b.jpg", 42, null])
    assert.equal(proofUrl(bad, H), null, String(bad));
  ok("http links are made https only for Lalamove's image hosts; no other http, port, password or scheme gets through");
}

// The real shapes, anonymised: event 7 (pickup) and event 8 (delivery) of order 0002
const POP_EVENT = { updatedAt: "2026-11-12T03:01:10.000Z", order: { orderId: "3626117933572534460", stops: [
  { stopId: "S0", POP: { status: "PICKED_UP", imageUrls: ["http://sg-oimg.lalamove.com/pop/1.jpg", "http://sg-oimg.lalamove.com/pop/2.jpg"] } },
  { stopId: "S1" }] } };
const POD_EVENT = { updatedAt: "2026-11-12T03:08:28.000Z", order: { orderId: "3626117933572534460", stops: [
  { stopId: "S0" }, { stopId: "S1", POD: { status: "DELIVERED", image: "http://sg-oimg.lalamove.com/pod/1.jpg", deliveredAt: "2026-11-12T03:08:20.000Z" } }] } };
{
  assert.deepEqual(eventProofs(POP_EVENT, ["lalamove.com"], "POP_STATUS_CHANGED"), [
    { kind: "pop", stop: "S0", url: "https://sg-oimg.lalamove.com/pop/1.jpg", status: "PICKED_UP" },
    { kind: "pop", stop: "S0#2", url: "https://sg-oimg.lalamove.com/pop/2.jpg", status: "PICKED_UP" }]);
  assert.deepEqual(eventProofs(POD_EVENT, ["lalamove.com"], "POD_STATUS_CHANGED"),
    [{ kind: "pod", stop: "S1", url: "https://sg-oimg.lalamove.com/pod/1.jpg", status: "DELIVERED" }]);
  const both = { order: { stops: [{ stopId: "S0", POP: { imageUrls: ["https://sg-oimg.lalamove.com/p.jpg"] } },
    { stopId: "S1", POD: { image: "https://sg-oimg.lalamove.com/d.jpg" } }] } };
  assert.deepEqual(eventProofs(both, ["lalamove.com"], "POP_STATUS_CHANGED").map((p) => p.kind + ":" + p.stop + ":" + p.url.slice(-5)), ["pop:S0:p.jpg", "pod:S1:d.jpg"]);
  // An unknown POP shape: the older guess, but never what sits under a POD key
  assert.deepEqual(popImages({ pod: { stopId: "S1", image: "https://pod.lalamove.com/d.jpg" }, stop: { stopId: "S0", status: "PICKED_UP", image: "https://pop.lalamove.com/p.jpg" } }, ["lalamove.com"]),
    [{ stop: "S0", url: "https://pop.lalamove.com/p.jpg", status: "PICKED_UP" }]);
  assert.deepEqual(popImages({ photo: "http://insecure/p.jpg" }), []);
  ok("Pickup photos (POP.imageUrls[], all of them) and the delivery photo (POD.image) are read by kind and stop; a delivery photo is never taken for a pickup one");
}

{ // Order 0002 as it happened: the events carry http links, and reading the booking back says
  // "delivered" without the picture. Before: proof "not provided", link never fetched.
  lalamove.set("3626117933572534460", { orderId: "3626117933572534460", status: "COMPLETED",
    stops: [{ stopId: "S0" }, { stopId: "S1", POD: { status: "DELIVERED", deliveredAt: "2026-11-12T03:08:20.000Z" } }] });
  await db.exec("delete from public.cdf_lalamove_proofs where ll_order_id = '3626117933572534460'");
  // What production has today: the delivery proof noted without a link
  await rpc("cdf_ll_proof_note", { p_ll: "3626117933572534460", p_kind: "pod", p_stop: "S1", p_status: "DELIVERED", p_at: null, p_url: null });
  assert.equal((await one("select state from public.cdf_lalamove_proofs where ll_order_id = '3626117933572534460' and kind = 'pod'")).state, "not_provided");
  const fetched = [];
  for (const u of ["pop/1.jpg", "pop/2.jpg", "pod/1.jpg"]) web["https://sg-oimg.lalamove.com/" + u] = () => { fetched.push(u); return new Response(JPEG); };
  // The same events processed again (as the controlled recovery after deploying would do), twice: idempotent
  for (let round = 0; round < 2; round++) {
    for (const [type, data] of [["POP_STATUS_CHANGED", POP_EVENT], ["POD_STATUS_CHANGED", POD_EVENT]]) {
      const r = await receive(d, JSON.stringify(event(type, data)), URL_IN, "observe");
      assert.equal(await processEvent(d, await claim(r.eventId)), "done");
    }
  }
  const got = await rows("select kind, stop_key, state, content_type from public.cdf_lalamove_proofs where ll_order_id = '3626117933572534460' order by kind, stop_key");
  assert.deepEqual(got.map((x) => `${x.kind}:${x.stop_key}:${x.state}`), ["pod:S1:available", "pop:S0:available", "pop:S0#2:available"]);
  assert.deepEqual(fetched.sort(), ["pod/1.jpg", "pop/1.jpg", "pop/2.jpg"], "each photo downloaded once, over https");
  assert.ok(!Object.keys(web).some((u) => u.startsWith("http:")), "nothing fetched over http");
  ok("Order 0002: the http links in the events are fetched over https and kept, even though reading the booking back has no picture; processing again changes nothing");
}

{ // A link kept from an event is not lost when a later read has none; a new link still replaces a failed one
  const note = (url, status = "DELIVERED") => rpc("cdf_ll_proof_note", { p_ll: "3626117933572534460", p_kind: "pod", p_stop: "S9", p_status: status, p_at: null, p_url: url });
  await note("https://sg-oimg.lalamove.com/pod/9.jpg");
  await note(null);
  assert.deepEqual(await one("select state, source_url from public.cdf_lalamove_proofs where ll_order_id = '3626117933572534460' and stop_key = 'S9'"),
    { state: "pending", source_url: "https://sg-oimg.lalamove.com/pod/9.jpg" });
  ok("A later read without the picture keeps the link that came in the event");
}

{ // Redirects: a normalised link that redirects to plain http or to another host is refused
  web["https://sg-oimg.lalamove.com/r/1.jpg"] = () => new Response(null, { status: 302, headers: { location: "http://sg-oimg.lalamove.com/r/2.jpg" } });
  web["https://sg-oimg.lalamove.com/r/3.jpg"] = () => new Response(null, { status: 302, headers: { location: "https://evil.example/x.jpg" } });
  const errOf = async (stop, url) => {
    const id = (await rpc("cdf_ll_proof_note", { p_ll: "3626117933572534460", p_kind: "pod", p_stop: stop, p_status: "DELIVERED", p_at: null, p_url: proofUrl(url, ["lalamove.com"]) })).data.id;
    await download(d, (await rpc("cdf_ll_proofs_due", { p_limit: 1, p_id: id })).data[0]);
    return (await one("select error from public.cdf_lalamove_proofs where id = $1", [id])).error;
  };
  assert.match(await errOf("X1", "http://sg-oimg.lalamove.com/r/1.jpg"), /not_https/);
  assert.match(await errOf("X2", "http://sg-oimg.lalamove.com/r/3.jpg"), /host_not_allowed:evil.example/);
  ok("After making a link https, every redirect is still checked: no plain http, no other host");
}

// ---------- safe downloads ----------
{ assert(hostAllowed("pod.lalamove.com", ["lalamove.com"])); assert(hostAllowed("lalamove.com", ["lalamove.com"]));
  for (const h of ["evil-lalamove.com", "lalamove.com.evil.io", "127.0.0.1", "localhost", "[::1]", "169.254.169.254"]) assert(!hostAllowed(h, ["lalamove.com"]), h);
  assert.deepEqual(sniffImage(JPEG), { mime: "image/jpeg", ext: "jpg" }); assert.equal(sniffImage(new TextEncoder().encode("<svg>")), null);
  await db.exec(`insert into public.cdf_lalamove_shipments(ll_order_id, order_id, env) values ('6000000001','${ORDER2}','production')`);
  const make = async (stop, url) => (await rpc("cdf_ll_proof_note", { p_ll: "6000000001", p_kind: "pod", p_stop: stop, p_status: "DELIVERED", p_at: null, p_url: url })).data.id;
  const proofOf = (id) => one("select state, error, attempts from public.cdf_lalamove_proofs where id = $1", [id]);
  const tryOne = async (stop, url) => { const id = await make(stop, url); const p = (await rpc("cdf_ll_proofs_due", { p_limit: 1, p_id: id })).data[0]; await download(d, p); return proofOf(id); };

  web["https://cdn.example.com/x.jpg"] = () => { throw new Error("must not be fetched"); };
  assert.deepEqual(await tryOne("h", "https://cdn.example.com/x.jpg"), { state: "error", error: "host_not_allowed:cdn.example.com", attempts: 1 });
  web["https://pod.lalamove.com/r.jpg"] = () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } });
  assert.equal((await tryOne("r", "https://pod.lalamove.com/r.jpg")).error, "host_not_allowed:169.254.169.254");
  web["https://pod.lalamove.com/big.jpg"] = () => new Response(JPEG, { headers: { "content-length": String(9 * 1024 * 1024) } });
  assert.equal((await tryOne("big", "https://pod.lalamove.com/big.jpg")).error, "too_big");
  const huge = new Uint8Array(9 * 1024 * 1024); huge.set(JPEG);
  web["https://pod.lalamove.com/huge.jpg"] = () => new Response(new ReadableStream({ start(c) { c.enqueue(huge); c.close(); } }));
  assert.equal((await tryOne("huge", "https://pod.lalamove.com/huge.jpg")).error, "too_big");
  web["https://pod.lalamove.com/page.jpg"] = () => new Response("<html>login</html>", { headers: { "content-type": "image/jpeg" } });
  assert.equal((await tryOne("html", "https://pod.lalamove.com/page.jpg")).error, "not_image");
  web["https://pod.lalamove.com/gone.jpg"] = () => new Response("", { status: 403 });
  assert.equal((await tryOne("gone", "https://pod.lalamove.com/gone.jpg")).error, "http_403");
  ok("Downloads only over https, from accepted hosts (after redirects too), at most 8 MiB, and only real images");

  let n = 0; web["https://pod.lalamove.com/flaky.jpg"] = () => { n++; return new Response("", { status: 503 }); };
  const id = await make("flaky", "https://pod.lalamove.com/flaky.jpg");
  for (let i = 0; i < 5; i++) {
    await db.query("update public.cdf_lalamove_proofs set next_attempt_at = now() where id = $1", [id]);
    const p = (await rpc("cdf_ll_proofs_due", { p_limit: 1, p_id: id })).data[0];
    if (p) await download(d, p);
  }
  assert.deepEqual(await proofOf(id), { state: "error", error: "http_503", attempts: 5 }); assert.equal(n, 5);
  // A new link after giving up starts again
  web["https://pod.lalamove.com/flaky2.jpg"] = () => new Response(JPEG);
  await make("flaky", "https://pod.lalamove.com/flaky2.jpg");
  const p = (await rpc("cdf_ll_proofs_due", { p_limit: 1, p_id: id })).data[0];
  await download(d, p);
  assert.equal((await proofOf(id)).state, "available");
  ok("A host that is down is tried five times (2, 4, 8, 16 minutes apart), then error; a new link starts again");
}

// ---------- reconciliation ----------
{ lalamove.set("7000000001", { orderId: "7000000001", status: "PICKED_UP", stops: [] });
  await db.exec(`update public.cdf_lalamove set ll_order_id = '7000000001', status = 'ON_GOING', booked_at = now() where order_id = '${ORDER2}'`);
  await db.exec("update public.cdf_lalamove_shipments set last_checked_at = now()");
  await db.exec("update public.cdf_lalamove_shipments set last_checked_at = null where ll_order_id = '7000000001'");
  const n = refreshed.length;
  const out = await work(d);
  assert.equal(out.reconciled, 1); assert.equal(refreshed.slice(n).join(), ORDER2);
  assert.equal((await one(`select status from public.cdf_lalamove where order_id = '${ORDER2}'`)).status, "PICKED_UP");
  assert.equal((await work(d)).reconciled, 0, "not again within four minutes");
  ok("Running bookings are read back from Lalamove every few minutes even if no webhook comes");
}

{ // Delivered with no photo yet: read back every 30 minutes (no webhook needed) until the photo appears
  await db.exec(`update public.cdf_lalamove set ll_order_id = '7000000002', status = 'COMPLETED', booked_at = now() - interval '2 hours' where order_id = '${ORDER2}'`);
  lalamove.set("7000000002", { orderId: "7000000002", status: "COMPLETED", stops: [{}, { stopId: "Z1", POD: { status: "DELIVERED" } }] });
  await db.exec("update public.cdf_lalamove_shipments set last_checked_at = now() where ll_order_id <> '7000000002'");
  await work(d);
  const proofZ = async () => one("select state from public.cdf_lalamove_proofs where ll_order_id = '7000000002'");
  assert.equal((await proofZ()).state, "not_provided");
  assert.equal((await work(d)).reconciled, 0, "not again within 30 minutes");
  // Lalamove adds the photo later; no webhook comes
  lalamove.get("7000000002").stops[1].POD.image = "https://pod.lalamove.com/late.jpg";
  web["https://pod.lalamove.com/late.jpg"] = () => new Response(JPEG);
  await db.exec("update public.cdf_lalamove_shipments set last_checked_at = now() - interval '31 minutes' where ll_order_id = '7000000002'");
  assert.equal((await work(d)).reconciled, 1);
  assert.equal((await proofZ()).state, "available");
  await db.exec("update public.cdf_lalamove_shipments set last_checked_at = now() - interval '31 minutes' where ll_order_id = '7000000002'");
  assert.equal((await work(d)).reconciled, 0, "a kept photo ends the checks");
  // A failed delivery is not checked again; nor is anything booked more than 3 days ago
  await db.exec(`update public.cdf_lalamove set ll_order_id = '7000000003', status = 'COMPLETED', booked_at = now() - interval '2 hours' where order_id = '${ORDER2}'`);
  lalamove.set("7000000003", { orderId: "7000000003", status: "COMPLETED", stops: [{}, { stopId: "F", POD: { status: "FAILED" } }] });
  await work(d);
  await db.exec("update public.cdf_lalamove_shipments set last_checked_at = now() - interval '31 minutes' where ll_order_id = '7000000003'");
  assert.equal((await work(d)).reconciled, 0);
  await db.exec(`update public.cdf_lalamove_shipments set booked_at = now() - interval '4 days', last_checked_at = null where ll_order_id = '7000000002'`);
  await db.exec(`update public.cdf_lalamove_proofs set state = 'not_provided' where ll_order_id = '7000000002'`);
  assert.equal((await work(d)).reconciled, 0, "the 3-day window closes even though each check moves updated_at");
  ok("Delivered without a photo: re-read every 30 minutes for 3 days, so a photo added later is kept without a webhook; failed deliveries and old ones are left alone");
}

// ---------- who sees what ----------
{ const as = async (email) => { await root(); await db.query("select set_config('request.jwt.claims',$1,false)", [claims(email)]); await db.exec("set role authenticated"); };
  await as("admin@t");
  assert((await rows("select id from public.cdf_lalamove_proofs")).length > 3);
  assert((await rows("select id from public.cdf_lalamove_events")).length > 3);
  await assert.rejects(db.query("select source_url from public.cdf_lalamove_proofs"), /permission denied/);
  // The exact columns the panel asks for (js/lalamove.js): one column it may not read hides the whole block
  const panelCols = /const LL_PROOF_COLS = "([^"]+)"/.exec(readFileSync(new URL("../js/lalamove.js", import.meta.url), "utf8"))[1];
  assert.ok((await rows(`select ${panelCols} from public.cdf_lalamove_proofs`)).length > 3, "admin: the panel's proof list reads");
  await assert.rejects(db.query("update public.cdf_lalamove_proofs set state = 'removed'"), /permission denied/);
  await assert.rejects(db.query("select public.cdf_ll_proof_removed(1, 'x')"), /permission denied/);
  await as("flo@t");
  const mine = await rows("select order_id, state, storage_path from public.cdf_lalamove_proofs");
  assert.equal((await rows(`select ${panelCols} from public.cdf_lalamove_proofs`)).length, mine.length, "florist: the panel's proof list reads");
  assert(mine.length >= 2 && mine.every((p) => p.order_id === ORDER), "the florist sees her own order's proofs only");
  assert.equal((await rows("select id from public.cdf_lalamove_events")).length, 0);
  const path = mine.find((p) => p.state === "available").storage_path;
  assert.equal((await one("select public.cdf_can_read_lalamove_proof($1) r", [path])).r, true);
  const other = (await (async () => { await root(); return one(`select storage_path from public.cdf_lalamove_proofs where order_id = '${ORDER2}' and state = 'available' limit 1`); })()).storage_path;
  await as("flo@t");
  assert.equal((await one("select public.cdf_can_read_lalamove_proof($1) r", [other])).r, false);
  await as("dri@t");
  assert.equal((await rows("select id from public.cdf_lalamove_proofs")).length, 0);
  await root();
  await db.exec(`select set_config('request.jwt.claims','',false); set role anon`);
  await assert.rejects(db.query("select id from public.cdf_lalamove_proofs"), /permission denied/);
  await root();
  ok("Proofs: admins and the order's florist only; events: admins only; the source link and every write stay server-side");
}

{ // Removed by the office: the row stays (who, when), the file link no longer opens
  const p = await one("select id, storage_path from public.cdf_lalamove_proofs where state = 'available' and order_id = $1 limit 1", [ORDER]);
  assert.equal((await rpc("cdf_ll_proof_removed", { p_id: p.id, p_by: "Admin@T" })).data, ORDER);
  const after = await one("select state, storage_path, removed_by from public.cdf_lalamove_proofs where id = $1", [p.id]);
  assert.deepEqual(after, { state: "removed", storage_path: null, removed_by: "admin@t" });
  assert.equal((await one("select public.cdf_can_read_lalamove_proof($1) r", [p.storage_path])).r, false);
  ok("A proof the office removes stays listed as removed, with who and when");
}

{ // Deleting an order takes its history, proofs and their rows with it
  await db.exec(`delete from public.cdf_orders where id = '${ORDER2}'`);
  assert.equal((await one(`select count(*)::int n from public.cdf_lalamove_proofs where order_id = '${ORDER2}'`)).n, 0);
  assert.equal((await one(`select count(*)::int n from public.cdf_lalamove_shipments where order_id = '${ORDER2}'`)).n, 0);
  ok("Deleting an order removes its booking history and proof rows");
}
