// PayMongo for requests (branch paymongo-solicitudes). One function, four callers:
//   admin  → {action:"link"|"cancel"}   with their Supabase session (the database checks they are an admin)
//   customer → {action:"view"|"pay"|"check", token}   the private link's secret; never a Supabase session
//   PayMongo → the webhook (Paymongo-Signature)       checkout_session.payment.paid accepts the request
// Money is only ever marked paid from PayMongo's own answer (webhook or GET of the session), never from the browser.
// Secrets: PAYMONGO_SECRET_KEY, PAYMONGO_WEBHOOK_SECRET, PAYMONGO_MODE (live | anything else = test),
// CDF_APP_URL (where pagar.html lives), CDF_PAY_ORIGINS (sites allowed to call, comma separated),
// PAYMONGO_METHODS (default gcash,paymaya,card,qrph), CHECKOUT_TTL_MINUTES (default 60).

export type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
export type Deps = {
  env: (k: string) => string | undefined;
  now: () => number;
  randomToken: () => string;
  sha256: (v: string) => Promise<string>;
  hmac: (secret: string, data: string) => Promise<string>;
  service: Rpc;                                  // service role
  asUser: (authorization: string) => Rpc;        // the caller's own session
  fetch: typeof fetch;
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
class Fail extends Error { constructor(public status: number, message: string) { super(message); } }
const METHOD_NAME: Record<string, string> = { gcash: "gcash", paymaya: "maya", card: "card", qrph: "other", dob: "bank", billease: "other" };

export function verifySignature(raw: string, header: string | null, secret: string, nowMs: number, live: boolean, hmac: Deps["hmac"]) {
  const p = Object.fromEntries(String(header || "").split(",").map((s) => s.trim().split("=")));
  const sig = live ? p.li : p.te;
  if (!secret || !/^\d+$/.test(p.t || "") || Math.abs(nowMs / 1000 - Number(p.t)) > 300 || !/^[a-f0-9]{64}$/i.test(sig || "")) return Promise.resolve(false);
  return hmac(secret, p.t + "." + raw).then((expected) => {
    if (expected.length !== sig.length) return false;
    let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.toLowerCase().charCodeAt(i);
    return diff === 0;
  });
}

// The one paid payment of a session, checked against what we expect (amount in centavos, PHP, mode, reference)
export function paidPayment(session: any, payId: string, amountPhp: number, live: boolean) {
  const a = session?.attributes;
  if (!a || a.reference_number !== payId || a.livemode !== live) return { error: "session_mismatch" };
  const paid = (a.payments || []).filter((p: any) => p.attributes?.status === "paid");
  if (!paid.length) return { none: true };
  if (paid.length !== 1) return { error: "several_payments" };
  const p = paid[0].attributes;
  const amount = Math.round(Number(amountPhp) * 100);
  if (p.currency !== "PHP" || p.livemode !== live) return { error: "currency_or_mode" };
  return { id: paid[0].id, amount: p.amount / 100, method: METHOD_NAME[p.source?.type] || p.source?.type || "other",
    paidAt: new Date((p.paid_at || a.updated_at || Date.now() / 1000) * 1000).toISOString(), matches: p.amount === amount };
}

export async function handle(req: Request, d: Deps): Promise<Response> {
  const live = d.env("PAYMONGO_MODE") === "live";
  const key = d.env("PAYMONGO_SECRET_KEY") || "";
  const origins = (d.env("CDF_PAY_ORIGINS") || d.env("CDF_APP_URL") || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  const origin = req.headers.get("origin") || "";
  const cors: Record<string, string> = origins.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" } : {};
  if (req.method === "OPTIONS") return new Response(null, { status: origins.includes(origin) ? 204 : 403, headers: cors });
  if (req.method !== "POST") return json(405, { error: "method" }, cors);

  const raw = await req.text();
  if (raw.length > 200_000) return json(413, { error: "too_large" }, cors);

  // ---------- PayMongo webhook ----------
  if (req.headers.get("paymongo-signature")) {
    if (!(await verifySignature(raw, req.headers.get("paymongo-signature"), d.env("PAYMONGO_WEBHOOK_SECRET") || "", d.now(), live, d.hmac))) return json(401, { error: "signature" });
    let event: any; try { event = JSON.parse(raw).data; } catch { return json(400, { error: "body" }); }
    const type = event?.attributes?.type, id = event?.id;
    if (!/^evt_[A-Za-z0-9]+$/.test(id || "") || !type) return json(400, { error: "event" });
    if (event.attributes.livemode !== live) return json(200, { ignored: "mode" });     // other mode's events: not ours, never retried
    const stored = await d.service("cdf_paymongo_event_store", { p_id: id, p_type: type, p_payload: event });
    if (stored.error) return json(503, { error: "store" });                            // PayMongo retries
    if (stored.data?.done) return json(200, { received: true, duplicate: true });
    try {
      let result: unknown = { ignored: type };
      if (type === "checkout_session.payment.paid") {
        const session = event.attributes.data;
        const view = await d.service("cdf_paylink_by_id", { p_payment: session?.attributes?.reference_number || null });
        // A session from another site/flow using the same PayMongo account: acknowledge, nothing to do here
        if (!view.data) result = { ignored: "not_a_request_payment" };
        else result = await settle(d, view.data, session, live);
      }
      await d.service("cdf_paymongo_event_done", { p_id: id, p_error: null });
      return json(200, { received: true, result });
    } catch (e) {
      await d.service("cdf_paymongo_event_done", { p_id: id, p_error: String((e as Error).message || e).slice(0, 500) });
      return json(503, { error: "retry" });                                            // stays stored, PayMongo retries
    }
  }

  let body: any; try { body = JSON.parse(raw || "{}"); } catch { return json(400, { error: "body" }, cors); }
  try {
    const action = String(body.action || "");
    // ---------- admin ----------
    if (action === "link" || action === "cancel") {
      const auth = req.headers.get("authorization") || "";
      if (!/^Bearer \S+$/.test(auth)) throw new Fail(401, "auth");
      const rpc = d.asUser(auth);
      let res;
      if (action === "link") {
        const price = Number(body.price);
        if (!/^[0-9a-f-]{36}$/.test(String(body.request_id)) || !/^[0-9a-f-]{36}$/.test(String(body.key)) || !body.order || typeof body.order !== "object") throw new Fail(400, "cdf_invalid_payment");
        const token = d.randomToken();
        res = await rpc("cdf_request_paylink", { p_id: body.request_id, p_token: token, p_key: body.key, p_order: body.order, p_price: price });
        if (res.error) throw new Fail(res.error.code === "42501" ? 403 : 409, res.error.message);
        if (res.data?.previous_checkout) await expire(d, key, live, res.data.previous_checkout);
        const app = (d.env("CDF_APP_URL") || "").replace(/\/$/, "");
        return json(200, { link: app + "/pagar.html#" + token, amount: res.data.amount, payment: res.data.payment }, cors);
      }
      res = await rpc("cdf_request_paylink_cancel", { p_id: body.request_id });
      if (res.error) throw new Fail(res.error.code === "42501" ? 403 : 409, res.error.message);
      if (res.data?.previous_checkout) await expire(d, key, live, res.data.previous_checkout);
      return json(200, { cancelled: !!res.data?.cancelled }, cors);
    }
    // ---------- customer (private link) ----------
    if (!["view", "pay", "check"].includes(action)) throw new Fail(400, "action");
    if (!/^[A-Za-z0-9_-]{30,80}$/.test(String(body.token || ""))) throw new Fail(404, "cdf_paylink_gone");
    const v = await d.service("cdf_paylink_view", { p_token_hash: await d.sha256(body.token) });
    if (v.error) throw new Fail(503, "server");
    if (!v.data) throw new Fail(404, "cdf_paylink_gone");
    let view = v.data;
    if (action === "check" && view.status === "open" && view.checkout_id) {
      const s = await getSession(d, key, live, view.checkout_id);
      if (s) await settle(d, view, s, live);
      view = (await d.service("cdf_paylink_view", { p_token_hash: await d.sha256(body.token) })).data;
    }
    if (action === "pay") {
      if (view.status !== "open") throw new Fail(409, view.status === "paid" ? "cdf_paylink_paid" : "cdf_paylink_cancelled");
      if (view.request_status !== "received" && view.request_status !== "in_review") throw new Fail(409, "cdf_paylink_cancelled");
      if (!view.checkout_url) {
        // The previous page ran out: make sure it was not paid in the meantime, then close it at PayMongo
        if (view.checkout_id) {
          const s = await getSession(d, key, live, view.checkout_id);
          if (s) { const r = await settle(d, view, s, live); if (r.result === "paid" || r.result === "already") return json(200, { paid: true }, cors); }
          await expire(d, key, live, view.checkout_id);
        }
        const app = (d.env("CDF_APP_URL") || "").replace(/\/$/, ""), back = app + "/pagar.html#" + body.token;
        const methods = (d.env("PAYMONGO_METHODS") || "gcash,paymaya,card,qrph").split(",").map((s) => s.trim()).filter(Boolean);
        const session = await paymongo(d, key, live, "/v2/checkout_sessions", "POST", {
          line_items: [{ name: "Casa de Flores · " + (view.shared_number ? "#" + String(view.ref).padStart(4, "0") : "R" + view.ref), amount: Math.round(Number(view.amount) * 100), currency: "PHP", quantity: 1 }],
          payment_method_types: methods, reference_number: view.id, send_email_receipt: false, show_description: false, show_line_items: true,
          success_url: back.replace("#", "?back=paid#"), cancel_url: back.replace("#", "?back=cancelled#"),
        });
        const ttl = Math.max(10, Number(d.env("CHECKOUT_TTL_MINUTES") || 60));
        const ok = await d.service("cdf_paylink_checkout", { p_payment: view.id, p_checkout_id: session.id, p_url: session.attributes.checkout_url, p_expires: new Date(d.now() + ttl * 60e3).toISOString() });
        if (ok.error || !ok.data) { await expire(d, key, live, session.id); throw new Fail(409, "cdf_paylink_cancelled"); }
        return json(200, { url: session.attributes.checkout_url }, cors);
      }
      return json(200, { url: view.checkout_url }, cors);
    }
    return json(200, publicView(view), cors);
  } catch (e) {
    const f = e instanceof Fail ? e : new Fail(502, (e as any)?.provider ? "cdf_paymongo_unreachable" : "server");
    if (!(e instanceof Fail)) console.error("cdf-paymongo", e);
    return json(f.status, { error: f.message }, cors);
  }
}

// What the customer's page may see
const publicView = (v: any) => ({ status: v.status, amount: v.amount, paidAt: v.paid_at, method: v.method, ref: v.shared_number ? "#" + String(v.ref).padStart(4, "0") : "R" + v.ref,
  requestStatus: v.request_status, lang: v.lang, date: v.date, slot: v.slot, mode: v.mode, receiver: v.receiver, pickupBranch: v.pickup_branch,
  replaced: !!v.replaced, checkoutOpenUntil: v.checkout_url ? v.checkout_expires_at : null });

async function settle(d: Deps, view: any, session: any, live: boolean) {
  const p = paidPayment(session, view.id, view.amount, live);
  if ("none" in p) return { result: "unpaid" };
  if ("error" in p) throw new Error("payment check: " + p.error);
  const r = await d.service("cdf_paylink_settle", { p_payment: view.id, p_payment_id: p.id, p_amount: p.amount, p_method: p.method, p_paid_at: p.paidAt });
  if (r.error) throw new Error("settle: " + r.error.message);
  return r.data;
}
async function getSession(d: Deps, key: string, live: boolean, id: string) {
  try { return await paymongo(d, key, live, "/v1/checkout_sessions/" + id, "GET"); } catch (e) { if ((e as any).status === 404) return null; throw e; }
}
async function expire(d: Deps, key: string, live: boolean, id: string) {
  try { await paymongo(d, key, live, "/v1/checkout_sessions/" + id + "/expire", "POST"); } catch (e) { console.warn("expire", id, (e as Error).message); }
}
async function paymongo(d: Deps, key: string, live: boolean, path: string, method: string, body?: unknown) {
  if (!(live ? /^sk_live_[A-Za-z0-9]+$/ : /^sk_test_[A-Za-z0-9]+$/).test(key)) throw Object.assign(new Error("PayMongo key missing for this mode"), { provider: true });
  let r: Response, j: any;
  try {
    r = await d.fetch("https://api.paymongo.com" + path, { method, headers: { Authorization: "Basic " + btoa(key + ":"), "Content-Type": "application/json" },
      body: body ? JSON.stringify({ data: { attributes: body } }) : undefined, signal: AbortSignal.timeout(20000) });
    j = await r.json();
  } catch { throw Object.assign(new Error("Could not reach PayMongo"), { provider: true }); }
  if (!r.ok) throw Object.assign(new Error("PayMongo " + r.status + ": " + (j?.errors || []).map((e: any) => e.detail).join("; ")), { provider: true, status: r.status });
  if (j.data?.attributes?.livemode !== live) throw Object.assign(new Error("PayMongo mode mismatch"), { provider: true });
  return j.data;
}
