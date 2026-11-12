// Audit 12/11, F01 and F02, against the real booking code (cdf-lalamove/booking.ts) and the real SQL of every
// migration in an in-memory database. Lalamove is a stand-in: nothing is booked, nothing leaves this machine.
//   F01 two phones booking at once; Lalamove refusing; no answer; Lalamove accepting but the save failing;
//       an admin resolving (with Lalamove's number, or "nothing booked"); the webhook linking a lost answer;
//       a new price never overwriting a booking.
//   F02 deleting an order with a rider (or an unconfirmed booking) is refused; once finished, it can go.
// Run: NODE_PATH=.test-tools/node_modules node --experimental-strip-types tests/lalamove-booking.test.mjs
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { bookRider, resolveBooking } from "../supabase/functions/cdf-lalamove/booking.ts";
import { LalamoveError } from "../supabase/functions/cdf-lalamove/lalamove.ts";
import { processEvent } from "../supabase/functions/cdf-lalamove/events.ts";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const { build, TEAM, claims } = require("./lib/fresh-db.cjs");
const ok = (n) => console.log("ok " + n);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const db = new PGlite();
await build((sql) => db.exec(sql));
await db.exec(TEAM);
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const rowOf = (id) => one("select * from public.cdf_lalamove where order_id = $1", [id]);

let n = 700;
async function order({ quoted = true } = {}) {
  const id = randomUUID(), num = String(++n).padStart(4, "0");
  await db.query(`insert into public.cdf_orders(id,num,date,slot,channel,customer_name,status) values ($1,$2,current_date,'10:00 - 11:00','Web','Ana','Ready')`, [id, num]);
  if (quoted) await db.query(`insert into public.cdf_lalamove(order_id, env, quotation_id, sender_stop, recipient_stop, quote_total) values ($1,'production','Q-${num}','S1','S2',120)`, [id]);
  return { id, num };
}

// The database as the function sees it (service role), with a way to make one call fail
let failNext = null;
const rpc = async (name, args) => {
  if (failNext === name) { failNext = null; return { data: null, error: { message: "connection reset" } }; }
  const keys = Object.keys(args);
  try { return { data: (await db.query(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]))).rows[0].r, error: null }; }
  catch (e) { return { data: null, error: { message: e.message } }; }
};
// Lalamove stand-in: records each booking request; `answer` decides what it does
const lalamove = { posts: [], orders: new Map(), answer: null, seq: 3626117933500000000n };
const ll = async (method, path, data) => {
  if (method === "POST" && path === "/v3/orders") {
    lalamove.posts.push(data);
    await wait(30); // long enough for a second phone to arrive meanwhile
    if (lalamove.answer) return lalamove.answer(data);
    const id = String(++lalamove.seq);
    lalamove.orders.set(id, { orderId: id, status: "ASSIGNING_DRIVER", shareLink: "https://share/" + id, priceBreakdown: { total: "120" }, metadata: data.metadata });
    return lalamove.orders.get(id);
  }
  if (method === "GET" && path.startsWith("/v3/orders/")) {
    const o = lalamove.orders.get(path.split("/")[3]);
    if (!o) throw new LalamoveError(404, "ERR_ORDER_NOT_FOUND", "not found");
    return o;
  }
  throw new Error("unexpected " + method + " " + path);
};
const logs = [];
const deps = { rpc, ll, newKey: () => randomUUID(), log: (...a) => logs.push(a.join(" ")) };
const request = { quotationId: "Q", sender: {}, recipients: [], isPODEnabled: true };
const book = (o, who = "admin@t") => bookRider(deps, o.id, o.num, who, request);

// ---------- F01 ----------
{ const o = await order();
  const [a, b] = await Promise.all([book(o, "admin@t"), book(o, "flo@t")]);
  assert.equal(lalamove.posts.length, 1, "Lalamove was asked once");
  const answers = [a, b].sort((x, y) => x.status - y.status);
  assert.equal(answers[0].status, 200); assert.equal(answers[1].status, 409);
  assert.match(answers[1].body.error, /Ya se está reservando/);
  const r = await rowOf(o.id);
  assert(r.ll_order_id); assert.equal(r.booking_state, null); assert.equal(r.status, "ASSIGNING_DRIVER");
  assert.equal(lalamove.posts[0].metadata.cdfOrder, o.num); assert.match(lalamove.posts[0].metadata.cdfBooking, /^[0-9a-f-]{36}$/);
  // And once booked, a third try is refused before reaching Lalamove
  assert.equal((await book(o)).status, 409); assert.equal(lalamove.posts.length, 1); }
ok("Two phones book at once: Lalamove is asked once, the other is told a booking is in progress; the booking is saved");

{ const o = await order(); lalamove.posts = [];
  lalamove.answer = () => { throw new LalamoveError(422, "ERR_INVALID_FIELD", "bad phone"); };
  const r = await book(o);
  assert.equal(r.status, 400); assert.match(r.body.error, /bad phone/);
  const row = await rowOf(o.id);
  assert.equal(row.booking_state, null); assert.equal(row.ll_order_id, null); assert.match(row.error, /bad phone/);
  lalamove.answer = null;
  assert.equal((await book(o)).status, 200); assert.equal(lalamove.posts.length, 2); }
ok("Lalamove says no (4xx): nothing booked, the attempt closes, booking again works");

const uncertainOrder = await order();
{ const o = uncertainOrder; lalamove.posts = [];
  lalamove.answer = () => { throw new TypeError("fetch failed"); };
  const r = await book(o);
  assert.equal(r.status, 502); assert.equal(r.body.uncertain, true);
  assert.equal((await rowOf(o.id)).booking_state, "uncertain");
  lalamove.answer = null;
  const again = await book(o);
  assert.equal(again.status, 409); assert.match(again.body.error, /sin confirmar/);
  assert.equal(lalamove.posts.length, 1, "never booked again by itself");
  await assert.rejects(rpc("cdf_ll_quote_store", { p_order: o.id, p_env: "production", p_quote: { quotation_id: "Q2" } }).then((x) => { if (x.error) throw new Error(x.error.message); }), /cdf_ll_booking_uncertain/); }
ok("No answer from Lalamove: held as uncertain; no new booking and no new price until it is checked");

{ const o = await order(); lalamove.posts = [];
  failNext = "cdf_ll_book_done";
  const r = await book(o);
  assert.equal(r.status, 502); assert.equal(r.body.uncertain, true);
  const llId = r.body.ll_order_id;
  assert(llId); assert.match(r.body.error, new RegExp(`${llId}.*no se pudo guardar`));
  const row = await rowOf(o.id);
  assert.equal(row.booking_state, "uncertain"); assert.equal(row.ll_order_id, null); assert.match(row.error, new RegExp(llId));
  assert(logs.some((l) => l.includes("book_done") && l.includes(llId)), "the cause is logged");
  // The admin links it with the number shown: checked against Lalamove (its metadata names this order)
  const other = await order();
  const wrong = await resolveBooking(deps, other.id, other.num, "admin@t", { booking_state: "uncertain" }, llId);
  assert.equal(wrong.status, 409); assert.match(wrong.body.error, /no es del pedido/);
  assert.equal((await resolveBooking(deps, o.id, o.num, "admin@t", row, "123")).status, 400);
  assert.equal((await resolveBooking(deps, o.id, o.num, "admin@t", row, "3626117933599999999")).status, 400);
  const fixed = await resolveBooking(deps, o.id, o.num, "admin@t", row, llId);
  assert.equal(fixed.status, 200);
  const after = await rowOf(o.id);
  assert.equal(after.ll_order_id, llId); assert.equal(after.booking_state, null); assert.equal(after.share_link, "https://share/" + llId);
  assert.equal((await one("select order_id from public.cdf_lalamove_shipments where ll_order_id = $1", [llId])).order_id, o.id);
  assert.equal(lalamove.posts.length, 1); }
ok("Lalamove accepts but saving fails: the answer gives Lalamove's number, the attempt is held; the admin links it (checked against Lalamove, not another order's)");

{ const o = uncertainOrder, row = await rowOf(o.id);
  const r = await resolveBooking(deps, o.id, o.num, "admin@t", row, null);
  assert.equal(r.status, 200);
  const after = await rowOf(o.id);
  assert.equal(after.booking_state, null); assert.match(after.error, /Sin reserva \(comprobado por admin@t\)/);
  assert.equal((await resolveBooking(deps, o.id, o.num, "admin@t", after, null)).status, 409);
  assert.equal((await book(o)).status, 200); }
ok("The admin checked Lalamove and nothing was booked: released (who said so is kept), and booking works again");

{ const o = await order();
  // The function stopped mid-way three minutes ago: it may have reached Lalamove
  await db.query(`update public.cdf_lalamove set booking_key = $2, booking_state = 'pending', booking_started_at = now() - interval '3 minutes' where order_id = $1`, [o.id, randomUUID()]);
  const r = await book(o);
  assert.equal(r.status, 409); assert.match(r.body.error, /sin confirmar/);
  // The panel shows it as unconfirmed (pending for over two minutes), and the admin can settle it
  const row = await rowOf(o.id);
  const r2 = await resolveBooking(deps, o.id, o.num, "admin@t", row, null);
  assert.equal(r2.status, 200); assert.equal((await rowOf(o.id)).booking_state, null);
  // A fresh pending one (another phone is booking right now) cannot be released
  await db.query(`update public.cdf_lalamove set booking_key = $2, booking_state = 'pending', booking_started_at = now() where order_id = $1`, [o.id, randomUUID()]);
  assert.equal((await resolveBooking(deps, o.id, o.num, "admin@t", await rowOf(o.id), null)).status, 409);
  assert.match((await rpc("cdf_ll_book_resolve", { p_order: o.id, p_by: "x", p_ll: null, p_status: null, p_share: null, p_price: null })).error.message, /cdf_ll_nothing_to_resolve/); }
ok("An attempt left pending by a function that stopped counts as uncertain after two minutes (blocks booking, can be settled); a fresh one can't be released");

{ const o = await order(); lalamove.posts = [];
  // The answer is lost on the way back (no answer here), but Lalamove made the booking and its webhook arrives
  lalamove.answer = (data) => { const id = String(++lalamove.seq); lalamove.orders.set(id, { orderId: id, status: "ASSIGNING_DRIVER", metadata: data.metadata }); throw new TypeError("network lost"); };
  await book(o); lalamove.answer = null;
  const llId = [...lalamove.orders.keys()].at(-1);
  assert.equal((await rowOf(o.id)).booking_state, "uncertain");
  let refreshed = null;
  const evDeps = { env: "production", rpc, ll, refresh: async (id) => { refreshed = id; }, log: () => {}, proofHosts: [] };
  const ev = (await one(`select public.cdf_ll_event_receive('production', $1, 'ORDER_STATUS_CHANGED', $2, now(), 'valid', null, '{"data":{}}'::jsonb) r`, ["k-" + llId, llId])).r;
  const claimed = (await db.query("select * from public.cdf_ll_events_claim(1, $1)", [ev.id])).rows;
  assert.equal(await processEvent(evDeps, claimed[0]), "done");
  const row = await rowOf(o.id);
  assert.equal(row.ll_order_id, llId); assert.equal(row.booking_state, null); assert.equal(refreshed, o.id); }
ok("The webhook of a booking whose answer was lost links it to its order by the attempt's key");

{ const o = await order(); await book(o);
  const busy = await rpc("cdf_ll_quote_store", { p_order: o.id, p_env: "production", p_quote: { quotation_id: "Q9" } });
  assert.match(busy.error.message, /cdf_ll_already_booked/);
  assert((await rowOf(o.id)).ll_order_id, "the booking is still there");
  await db.query("update public.cdf_lalamove set status = 'CANCELED' where order_id = $1", [o.id]);
  const fresh = await rpc("cdf_ll_quote_store", { p_order: o.id, p_env: "production", p_quote: { quotation_id: "Q9", lat: 14.6, lng: 121.03, quote_total: 99 } });
  assert.equal(fresh.error, null); assert.equal(fresh.data.ll_order_id, null); assert.equal(fresh.data.quotation_id, "Q9"); }
ok("A new price never overwrites a running booking; after it is cancelled, it replaces it as before");

{ const keys = ["cdf_ll_book_claim(uuid, uuid, text)", "cdf_ll_book_done(uuid, uuid, text, text, text, numeric)", "cdf_ll_book_failed(uuid, uuid, boolean, text)",
    "cdf_ll_book_resolve(uuid, text, text, text, text, numeric)", "cdf_ll_link_attempt(uuid, text, text)", "cdf_ll_quote_store(uuid, text, jsonb)"];
  for (const k of keys) for (const role of ["anon", "authenticated"])
    assert.equal((await one(`select has_function_privilege($1, $2, 'execute') x`, [role, "public." + k])).x, false, role + " " + k); }
ok("Only the server can run the booking functions (not the browser, signed in or not)");

// ---------- F02 ----------
const asAdmin = async (sql, params) => {
  await db.query("select set_config('request.jwt.claims',$1,false)", [claims("admin@t")]); await db.exec("set role authenticated");
  try { return await db.query(sql, params); } finally { await db.exec("reset role"); }
};
{ const o = await order(); await book(o);
  await assert.rejects(asAdmin("delete from public.cdf_orders where id = $1", [o.id]), /cdf_order_has_rider/);
  assert(await one("select 1 x from public.cdf_orders where id = $1", [o.id]));
  assert(await rowOf(o.id), "the booking and its history stay");
  await db.query("update public.cdf_lalamove set status = 'CANCELED' where order_id = $1", [o.id]);
  await asAdmin("delete from public.cdf_orders where id = $1", [o.id]);
  assert.equal(await one("select 1 x from public.cdf_orders where id = $1", [o.id]), undefined); }
ok("Deleting an order with a running rider is refused (booking and history kept); once cancelled, it can be deleted");

{ const o = await order(); lalamove.answer = () => { throw new TypeError("fetch failed"); }; await book(o); lalamove.answer = null;
  await assert.rejects(asAdmin("delete from public.cdf_orders where id = $1", [o.id]), /cdf_order_has_rider/);
  const plain = await order({ quoted: false });
  await asAdmin("delete from public.cdf_orders where id = $1", [plain.id]);
  const quotedOnly = await order();
  await asAdmin("delete from public.cdf_orders where id = $1", [quotedOnly.id]); }
ok("An unconfirmed booking also blocks deleting; orders without a rider (or only priced) delete as before");

console.log("all booking checks passed");
