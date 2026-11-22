// PayMongo for requests: the cdf-paymongo function with nothing real behind it (database calls and PayMongo are
// stand-ins). Covers the /review fixes: two "Pay" taps at once, a PayMongo answer that will never match, an old page
// that PayMongo does not close, the webhook's signature.
// Run: node --experimental-strip-types tests/paymongo-handler.test.mjs
import assert from "node:assert";
import { createHash, createHmac } from "node:crypto";
import { handle, verifySignature } from "../supabase/functions/cdf-paymongo/handler.ts";

const ok = (m) => console.log("ok " + m);
const sha = (v) => createHash("sha256").update(v).digest("hex");
const TOKEN = "t".repeat(43), NOW = Date.UTC(2026, 10, 22, 6);
const ENV = { PAYMONGO_SECRET_KEY: "sk_test_abc", PAYMONGO_WEBHOOK_SECRET: "whsk_test", CDF_APP_URL: "https://app.test", CDF_PAY_ORIGINS: "https://app.test" };

// A tiny world: one open link, PayMongo sessions, and every call recorded
function world({ link = {}, paymongo = {} } = {}) {
  const calls = [], sessions = new Map();
  let n = 0;
  const pay = { id: "11111111-1111-1111-1111-111111111111", status: "open", amount: 1500, checkout_id: null, checkout_url: null, request_status: "in_review", review: false, ...link };
  const rpc = async (name, a) => {
    calls.push([name, a]);
    if (name === "cdf_paylink_view") return { data: a.p_token_hash === sha(TOKEN) ? { ...pay } : null };
    if (name === "cdf_paylink_checkout") {
      if (paymongo.raceWith && !pay.checkout_id) { pay.checkout_id = paymongo.raceWith; pay.checkout_url = "https://pm/" + paymongo.raceWith; }
      if ((pay.checkout_id ?? null) !== (a.p_prev ?? null)) return { data: false };
      Object.assign(pay, { checkout_id: a.p_checkout_id, checkout_url: a.p_url }); return { data: true };
    }
    if (name === "cdf_paylink_issue") return { data: { result: "issue", issue: a.p_issue, recorded: true } };
    if (name === "cdf_paylink_settle") return { data: { result: "paid" } };
    if (name === "cdf_paymongo_event_store") return { data: { done: false } };
    if (name === "cdf_paymongo_event_done") return { data: null };
    if (name === "cdf_paylink_by_id") return { data: { ...pay } };
    return { data: null };
  };
  const fetch = async (url, init) => {
    const path = new URL(url).pathname, method = init.method;
    calls.push(["paymongo", method + " " + path]);
    const reply = (status, data) => new Response(JSON.stringify(status < 300 ? { data } : { errors: [{ detail: "no" }] }), { status });
    if (method === "POST" && path === "/v2/checkout_sessions") {
      const id = "cs_" + ++n; sessions.set(id, { id, attributes: { livemode: false, status: "active", checkout_url: "https://pm/" + id, reference_number: pay.id, payments: [] } });
      return reply(200, sessions.get(id));
    }
    const m = path.match(/^\/v1\/checkout_sessions\/([^/]+)(\/expire)?$/);
    if (m && m[2]) { if (paymongo.expireFails) return reply(500); sessions.get(m[1]) && (sessions.get(m[1]).attributes.status = "expired"); return reply(200, { id: m[1], attributes: { livemode: false } }); }
    if (m) return sessions.has(m[1]) ? reply(200, sessions.get(m[1])) : reply(404);
    return reply(404);
  };
  const deps = { env: (k) => ENV[k], now: () => NOW, randomToken: () => "r".repeat(43), sha256: async (v) => sha(v),
    hmac: async (s, d) => createHmac("sha256", s).update(d).digest("hex"), service: rpc, asUser: () => rpc, fetch };
  return { pay, calls, sessions, deps };
}
const post = (body, headers = {}) => new Request("https://fn.test", { method: "POST", headers: { origin: "https://app.test", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const call = async (w, body, headers) => { const r = await handle(post(body, headers), w.deps); return { status: r.status, body: await r.json() }; };

// ---------- two "Pay" taps at the same moment ----------
{
  const w = world({ paymongo: { raceWith: "cs_other" } });
  const r = await call(w, { action: "pay", token: TOKEN });
  assert.equal(r.status, 200); assert.equal(r.body.url, "https://pm/cs_other", "the page saved by the other tap is used");
  assert.ok(w.calls.some(([n, a]) => n === "paymongo" && a === "POST /v1/checkout_sessions/cs_1/expire"), "the extra page is closed at PayMongo");
  ok("Two Pay taps at once: one PayMongo page is kept, the other is closed there");
}

// ---------- an old page PayMongo does not close: no second page ----------
{
  const w = world({ link: { checkout_id: "cs_old" }, paymongo: { expireFails: true } });
  w.sessions.set("cs_old", { id: "cs_old", attributes: { livemode: false, status: "active", reference_number: w.pay.id, payments: [] } });
  const r = await call(w, { action: "pay", token: TOKEN });
  assert.equal(r.status, 502); assert.equal(r.body.error, "cdf_paymongo_unreachable");
  assert.ok(!w.calls.some(([n, a]) => n === "paymongo" && a === "POST /v2/checkout_sessions"), "no new page while the old one may still be paid");
  ok("If PayMongo does not close the old page, no new one is opened (both could be paid)");
}

// ---------- a link with a payment under review offers no page ----------
{
  const w = world({ link: { review: true } });
  const r = await call(w, { action: "pay", token: TOKEN });
  assert.equal(r.status, 409); assert.equal(r.body.error, "cdf_paylink_review");
  const v = await call(w, { action: "view", token: TOKEN });
  assert.equal(v.body.review, true);
  ok('A link whose payment is being checked says so and opens no PayMongo page');
}

// ---------- the webhook: a PayMongo answer that will never match is recorded, not retried forever ----------
const signed = (event, secret = ENV.PAYMONGO_WEBHOOK_SECRET, t = Math.floor(NOW / 1000)) => {
  const raw = JSON.stringify({ data: event });
  return [raw, { "paymongo-signature": `t=${t},te=${createHmac("sha256", secret).update(t + "." + raw).digest("hex")},li=` }];
};
{
  const w = world();
  const pm = (id, status = "paid") => ({ id, attributes: { status, amount: 150000, currency: "PHP", livemode: false, source: { type: "gcash" }, paid_at: NOW / 1000 } });
  const event = { id: "evt_1", attributes: { type: "checkout_session.payment.paid", livemode: false,
    data: { id: "cs_9", attributes: { reference_number: w.pay.id, livemode: false, payments: [pm("pay_a"), pm("pay_b")] } } } };
  const [raw, headers] = signed(event);
  const r = await call(w, raw, headers);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.result.result, "issue");
  const flagged = w.calls.find(([n]) => n === "cdf_paylink_issue");
  assert.deepEqual(flagged[1], { p_payment: w.pay.id, p_issue: "payment_check_several_payments", p_key: "cs_9" });
  assert.ok(w.calls.some(([n, a]) => n === "cdf_paymongo_event_done" && a.p_error === null), "the event is done, PayMongo does not retry it");
  ok("Webhook: two payments in one session are recorded for the team and answered 200 (no endless retries)");

  const [raw2, bad] = signed(event, "wrong");
  assert.equal((await call(world(), raw2, bad)).status, 401);
  const [raw3, old] = signed(event, ENV.PAYMONGO_WEBHOOK_SECRET, Math.floor(NOW / 1000) - 600);
  assert.equal((await call(world(), raw3, old)).status, 401);
  ok("Webhook: a wrong signature or an old timestamp is refused");
}

// ---------- the admin is told when PayMongo does not close the old page ----------
{
  const w = world({ paymongo: { expireFails: true } });
  w.sessions.set("cs_prev", { id: "cs_prev", attributes: { livemode: false, status: "active", payments: [] } });
  w.deps.asUser = () => async (name) => (name === "cdf_request_paylink_cancel" ? { data: { cancelled: true, previous_checkout: "cs_prev" } } : { data: null });
  const r = await call(w, { action: "cancel", request_id: "22222222-2222-2222-2222-222222222222" }, { authorization: "Bearer x" });
  assert.equal(r.status, 200); assert.equal(r.body.warning, "expire_failed");
  ok("Cancelling a link: if PayMongo does not close its page, the admin gets a warning");
}

assert.equal(await verifySignature("{}", "t=1,te=" + "a".repeat(64), "", NOW, false, async () => "a".repeat(64)), false, "no secret, no pass");
ok("Without a webhook secret nothing is accepted");
console.log("\nAll cdf-paymongo function checks passed");
