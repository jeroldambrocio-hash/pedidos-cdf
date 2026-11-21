// PayMongo for requests, against the LOCAL Supabase only (scripts/supabase-local.sh + functions serve).
//   node tests/paymongo-local.mjs            → server checks (link, view, PayMongo TEST page, webhook rules)
//   node tests/paymongo-local.mjs --paid     → after paying the printed TEST page in a browser: settles and checks the order
// Uses the real PayMongo TEST API (never charges). Refuses to run against anything but localhost.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";

const env = (f) => Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.includes("="))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const sb = env(".secrets/local-supabase.env"), fn = env(".secrets/functions.env");
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(sb.API_URL)) throw new Error("local only");
const API = sb.API_URL, F = API + "/functions/v1/cdf-paymongo", ORIGIN = fn.CDF_APP_URL;
const sql = (q) => execFileSync("docker", ["exec", "supabase_db_cdf-paymongo-test", "psql", "-U", "postgres", "-tAc", q], { encoding: "utf8" }).trim();
let ok = 0, bad = 0; const check = (n, c, x = "") => { c ? ok++ : bad++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + x)); };
const call = async (body, headers = {}) => { const r = await fetch(F, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, apikey: sb.ANON_KEY, ...headers }, body: JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => null) }; };
const pw = Object.fromEntries(readFileSync(".secrets/test-accounts.txt", "utf8").split(/\r?\n/).filter((l) => /^\w+\s+\S+\s+\(/.test(l)).map((l) => l.split(/\s+/).slice(0, 2)));
const login = async (u) => (await (await fetch(API + "/auth/v1/token?grant_type=password", { method: "POST", headers: { apikey: sb.ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: u + "@cdf-test.invalid", password: pw[u] }) })).json()).access_token;
const STATE = ".secrets/paymongo-test-state.json";

if (process.argv.includes("--paid")) {
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  const c = await call({ action: "check", token: st.token });
  check("after paying: the link says paid", c.j?.status === "paid", JSON.stringify(c.j));
  const row = sql(`select r.status||'|'||coalesce(o.num,'')||'|'||coalesce(pr.amount::text,'')||'|'||coalesce(pr.paid::text,'') from public.cdf_order_requests r left join public.cdf_orders o on o.id=r.accepted_order_id left join public.cdf_order_prices pr on pr.order_id=o.id where r.id='${st.request}'`);
  const [status, num, price, paid] = row.split("|");
  check("request accepted and order created with the price and the payment", status === "accepted" && num && Number(price) === st.amount && Number(paid) === st.amount, row);
  check("history: pay_link → paid → accepted, as the moderator", sql(`select string_agg(kind||':'||coalesce(by_email,''),',' order by id) from public.cdf_request_events where request_id='${st.request}'`).includes("accepted:moderador@cdf-test.invalid"));
  const again = await call({ action: "check", token: st.token });
  check("checking again changes nothing (one order)", again.j?.status === "paid" && sql(`select count(*) from public.cdf_orders where buyer_name='PayMongo Test ${st.tag}'`) === "1");
  console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
}

// A request as the public form would leave it (pickup, so no map point needed)
const tag = randomUUID().slice(0, 6), date = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
const reqId = sql(`insert into public.cdf_order_requests (request_key,status,lang,buyer_name,buyer_phone,receiver_name,receiver_phone,mode,date,slot,description,payment_method,fingerprint,pickup_branch)
  values ('${randomUUID()}','received','es','PayMongo Test ${tag}','+639170000000','Receptor ${tag}','+639170000001','pickup','${date}','11:00 - 13:00','Ramo de prueba PayMongo','gcash','t','Pasig') returning id`).split("\n")[0];
const mod = await login("moderador"), flo = await login("florista");
const order = { date, slot: "11:00 - 13:00", channel: "Web", buyer_name: "PayMongo Test " + tag, buyer_phone: "+639170000000", customer_name: "Receptor " + tag, customer_phone: "+639170000001", address: "", notes: "TEST", card_message: "", delivery_note: "", pickup: true };

check("customer endpoint refuses a made-up link", (await call({ action: "view", token: "x".repeat(43) })).s === 404);
check("a florist cannot make a payment link", (await call({ action: "link", request_id: reqId, key: randomUUID(), order, price: 1500 }, { Authorization: "Bearer " + flo })).s === 403);
check("no session, no link", (await call({ action: "link", request_id: reqId, key: randomUUID(), order, price: 1500 })).s === 401);
const first = await call({ action: "link", request_id: reqId, key: randomUUID(), order, price: 1200 }, { Authorization: "Bearer " + mod });
check("moderator makes a link (₱1,200)", first.s === 200 && /pagar\.html#[A-Za-z0-9_-]{40,}$/.test(first.j?.link || ""), JSON.stringify(first.j));
const key = randomUUID(), link = await call({ action: "link", request_id: reqId, key, order, price: 1500 }, { Authorization: "Bearer " + mod });
check("a new price replaces the link (₱1,500)", link.s === 200 && link.j.amount == 1500);
const oldTok = first.j.link.split("#")[1], token = link.j.link.split("#")[1];
check("the old link now says it was replaced", (await call({ action: "view", token: oldTok })).j?.replaced === true);
const v = await call({ action: "view", token });
check("customer view: amount, reference, date, nothing private", v.s === 200 && v.j.amount == 1500 && /^#\d{4}|^R\d+/.test(v.j.ref) && v.j.date === date && !("token_hash" in v.j) && !("draft" in v.j), JSON.stringify(v.j));
check("request is now in review with the history", sql(`select status from public.cdf_order_requests where id='${reqId}'`) === "in_review" && sql(`select count(*) from public.cdf_request_events where request_id='${reqId}' and kind like 'pay_link%'`) === "3");
check("the old link cannot open a payment page", (await call({ action: "pay", token: oldTok })).s === 409);
const pay = await call({ action: "pay", token });
check("PayMongo TEST page opens for the right amount", pay.s === 200 && /^https:\/\/checkout\.paymongo\.com\//.test(pay.j?.url || ""), JSON.stringify(pay.j));
const pay2 = await call({ action: "pay", token });
check("pressing Pay again reuses the same page (never two)", pay2.j?.url === pay.j?.url);
// Webhook rules (signed like PayMongo): bad signature, other mode, and an unknown session are not applied
const sign = (raw, t = Math.floor(Date.now() / 1000)) => `t=${t},te=${createHmac("sha256", fn.PAYMONGO_WEBHOOK_SECRET).update(t + "." + raw).digest("hex")},li=`;
const evt = (type, data, live = false) => JSON.stringify({ data: { id: "evt_" + randomUUID().replace(/-/g, ""), attributes: { type, livemode: live, data } } });
const post = async (raw, sig) => (await fetch(F, { method: "POST", headers: { "Content-Type": "application/json", "Paymongo-Signature": sig }, body: raw })).status;
let raw = evt("checkout_session.payment.paid", { id: "cs_x", attributes: { reference_number: "nope" } });
check("webhook: wrong signature refused", (await post(raw, sign(raw).replace(/te=./, "te=0"))) === 401);
check("webhook: old signature refused (replay)", (await post(raw, sign(raw, Math.floor(Date.now() / 1000) - 3600))) === 401);
check("webhook: a session that is not a request payment is acknowledged and ignored", (await post(raw, sign(raw))) === 200);
raw = evt("checkout_session.payment.paid", { id: "cs_x", attributes: { reference_number: v.j && sql(`select id from public.cdf_request_payments where status='open' and request_id='${reqId}'`) } }, true);
check("webhook: a LIVE event on a TEST site is ignored", (await post(raw, sign(raw))) === 200 && sql(`select status from public.cdf_request_payments where status<>'cancelled' and request_id='${reqId}'`) === "open");
raw = evt("checkout_session.payment.paid", { id: "cs_fake", attributes: { reference_number: sql(`select id from public.cdf_request_payments where status='open' and request_id='${reqId}'`), livemode: false, payments: [] } });
check("webhook: a 'paid' event without a paid payment does not accept anything", (await post(raw, sign(raw))) === 200 && sql(`select status from public.cdf_order_requests where id='${reqId}'`) === "in_review");
writeFileSync(STATE, JSON.stringify({ token, request: reqId, amount: 1500, tag, url: pay.j?.url }));
console.log(`\n${ok} passed, ${bad} failed`);
console.log("\nTEST page to pay (GCash test → Authorize): " + (pay.j?.url || "—") + "\nThen: node tests/paymongo-local.mjs --paid");
process.exit(bad ? 1 : 0);
