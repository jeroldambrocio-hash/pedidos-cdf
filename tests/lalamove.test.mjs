// Lalamove helpers without network or Supabase: node --experimental-strip-types tests/lalamove.test.mjs
import assert from "node:assert";
import { createHmac } from "node:crypto";
import { authHeaders, call, e164, LalamoveError, orderUpdateFor, parseCoords, pickupAt, signature } from "../supabase/functions/cdf-lalamove/lalamove.ts";

const ok = (n) => console.log("ok " + n);

// Signature matches an independent HMAC of "TIME\r\nMETHOD\r\nPATH\r\n\r\nBODY"
const body = JSON.stringify({ data: { serviceType: "MOTORCYCLE" } });
const expect = createHmac("sha256", "sk_test").update(`1700000000000\r\nPOST\r\n/v3/quotations\r\n\r\n${body}`).digest("hex");
assert.equal(await signature("sk_test", "1700000000000", "POST", "/v3/quotations", body), expect);
const getSig = createHmac("sha256", "sk_test").update("1700000000000\r\nGET\r\n/v3/orders/1\r\n\r\n").digest("hex");
assert.equal(await signature("sk_test", "1700000000000", "GET", "/v3/orders/1"), getSig);
ok("signature");

const h = await authHeaders("pk_test", "sk_test", "POST", "/v3/quotations", body, 1700000000000);
assert.equal(h.Authorization, `hmac pk_test:1700000000000:${expect}`);
assert.equal(h.Market, "PH");
assert.match(h["Request-ID"], /^[0-9a-f-]{36}$/);
ok("headers");

// call(): sandbox URL, body wrapped in { data }, errors surfaced
let seen;
const fakeOk = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ data: { quotationId: "q1" } }), { status: 201 }); };
const r = await call("sandbox", "pk", "sk", "POST", "/v3/quotations", { a: 1 }, fakeOk);
assert.equal(r.quotationId, "q1");
assert.equal(seen.url, "https://rest.sandbox.lalamove.com/v3/quotations");
assert.equal(seen.init.body, '{"data":{"a":1}}');
const fakeErr = async () => new Response(JSON.stringify({ errors: [{ id: "ERR_INVALID_FIELD", message: "bad phone" }] }), { status: 422 });
await assert.rejects(call("sandbox", "pk", "sk", "POST", "/v3/orders", {}, fakeErr), (e) => e instanceof LalamoveError && e.code === "ERR_INVALID_FIELD" && e.status === 422);
const fakeDel = async (url, init) => { seen = { url, init }; return new Response(null, { status: 204 }); };
await call("production", "pk", "sk", "DELETE", "/v3/orders/9", undefined, fakeDel);
assert.equal(seen.init.body, undefined);
assert.equal(seen.url, "https://rest.lalamove.com/v3/orders/9");
ok("call");

// Coordinates from pasted text and Google Maps links; outside the Philippines is refused
assert.deepEqual(parseCoords("14.6507, 121.0494"), { lat: 14.6507, lng: 121.0494 });
assert.deepEqual(parseCoords("https://www.google.com/maps/place/SM/@14.6564,121.0300,17z/data"), { lat: 14.6564, lng: 121.03 });
assert.deepEqual(parseCoords("https://maps.google.com/?q=14.676,121.0437"), { lat: 14.676, lng: 121.0437 });
assert.deepEqual(parseCoords("https://www.google.com/maps/place/x/data=!3d14.65!4d121.05"), { lat: 14.65, lng: 121.05 });
assert.equal(parseCoords("41.38, 2.17"), null); // Barcelona
assert.equal(parseCoords("121.04, 14.65"), null); // swapped
assert.equal(parseCoords("Tomas Morato Ave, Quezon City"), null);
ok("coords");

assert.equal(e164("09171234567"), "+639171234567");
assert.equal(e164("9171234567"), "+639171234567");
assert.equal(e164("+63 917 123 4567"), "+639171234567");
assert.equal(e164("0034612345678"), "+34612345678");
assert.equal(e164(""), "");
ok("phones");

// Status sync only moves forward, only Ready orders, never cancelled ones
const ready = { status: "Ready", delivery: "-" };
assert.deepEqual(orderUpdateFor("PICKED_UP", ready), { delivery: "In transit" });
assert.deepEqual(orderUpdateFor("COMPLETED", { status: "Ready", delivery: "In transit" }), { delivery: "Delivered" });
assert.equal(orderUpdateFor("ON_GOING", ready), null);
assert.equal(orderUpdateFor("PICKED_UP", { status: "Preparing", delivery: "-" }), null);
assert.equal(orderUpdateFor("PICKED_UP", { status: "Ready", delivery: "Delivered" }), null);
assert.equal(orderUpdateFor("COMPLETED", { status: "Ready", delivery: "Failed" }), null);
assert.equal(orderUpdateFor("COMPLETED", { ...ready, cancelled_at: "2026-11-08" }), null);
assert.equal(orderUpdateFor("CANCELED", ready), null);
ok("status sync");

// Pickup 45 min before the slot, Manila time; too soon or past → now
const now = Date.parse("2026-11-08T08:00:00+08:00");
assert.equal(pickupAt("2026-11-09", "10:00 - 12:00", now), "2026-11-09T01:15:00.000Z");
assert.equal(pickupAt("2026-11-08", "8:30 - 10:00", now), undefined);
assert.equal(pickupAt("2026-11-07", "10:00 - 12:00", now), undefined);
assert.equal(pickupAt("2026-11-09", "", now), undefined);
ok("pickup time");
