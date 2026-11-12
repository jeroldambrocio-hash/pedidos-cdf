// cdf-push as a whole (handler.ts, the same code index.ts serves): when is a notice from the outbox confirmed?
// The database and the push service are stand-ins; nothing is sent anywhere.
// Run: node --experimental-strip-types tests/push-endpoint.test.mjs
import assert from "node:assert";
import { handlePush } from "../supabase/functions/cdf-push/handler.ts";
const ok = (m) => console.log("ok " + m);
console.error = () => {}; // the function logs failures; they are expected here

// A tiny stand-in for the supabase-js calls the function makes
function db({ fail = {}, members, push }) {
  const calls = [];
  const tables = {
    cdf_members: members ?? [{ email: "admin@t", name: "Admin", role: "admin" }, { email: "flo@t", name: "Flo", role: "vendor" }],
    cdf_order_requests: [{ id: "r1", ref: 12, status: "received" }],
    cdf_outbox: [{ id: 7, sent_endpoints: [] }],
    cdf_push_subs: [{ member_email: "admin@t", endpoint: "https://push.example/1", p256dh: "k", auth: "a", lang: "es" }],
  };
  const q = (table) => {
    const st = { table, filters: [], op: "select" };
    const run = () => {
      calls.push({ table, op: st.op });
      if (fail[table + "." + st.op]) return { data: null, error: { message: "temporary" } };
      let rows = tables[table] || [];
      for (const [k, v, how] of st.filters) rows = rows.filter((r) => how === "in" ? v.includes(r[k]) : r[k] === v);
      return { data: st.single ? rows[0] ?? null : rows, error: null };
    };
    const chain = {
      select() { return chain; }, update() { st.op = "update"; return chain; }, delete() { st.op = "delete"; return chain; },
      eq(k, v) { st.filters.push([k, v]); return chain; }, in(k, v) { st.filters.push([k, v, "in"]); return chain; },
      maybeSingle() { st.single = true; return Promise.resolve(run()); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return chain;
  };
  const service = {
    from: q,
    rpc: async (name, args) => { calls.push({ rpc: name, args }); if (name === "cdf_hook_ok") return { data: true };
      if (fail["rpc." + name]) return { error: { message: "temporary" } }; return { data: null, error: null }; },
  };
  const app = { subscribe: () => ({ pushTextMessage: async () => { if (push) await push(); } }) };
  return { calls, deps: { service, server: async () => app, pushOpts: {} } };
}
const notice = () => new Request("https://x/cdf-push", { method: "POST", headers: { "x-cdf-hook": "s" }, body: JSON.stringify({ kind: "request", id: "r1", outbox: 7 }) });
const confirmed = (calls) => calls.filter((c) => c.rpc === "cdf_outbox_done").length;

{ const w = db({ fail: { "cdf_members.select": true } });
  const res = await handlePush(notice(), w.deps);
  assert.equal(res.status, 503); assert.equal(confirmed(w.calls), 0);
  ok("The team lookup fails for a moment: 503 and the notice stays pending (before: 200, {sent:0}, confirmed)"); }

{ const w = db({ fail: { "cdf_order_requests.select": true } });
  const res = await handlePush(notice(), w.deps);
  assert.equal(res.status, 503); assert.equal(confirmed(w.calls), 0);
  ok("The request lookup fails: pending too"); }

{ const w = db({ push: async () => { throw Object.assign(new Error("503"), { response: { status: 503 } }); } });
  const res = await handlePush(notice(), w.deps);
  assert.equal(res.status, 503); assert.equal(confirmed(w.calls), 0);
  ok("The push service fails: pending"); }

{ const w = db({});
  const res = await handlePush(notice(), w.deps);
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { sent: 1, gone: 0, failed: 0, pending: false });
  assert.equal(confirmed(w.calls), 1); assert.equal(w.calls.filter((c) => c.rpc === "cdf_outbox_sent").length, 1);
  ok("Everything works: sent, the device remembered, confirmed once"); }

{ const w = db({ members: [{ email: "flo@t", name: "Flo", role: "vendor" }] });
  const res = await handlePush(notice(), w.deps);
  assert.equal(res.status, 200); assert.equal(confirmed(w.calls), 1);
  ok("Really no admin (the lookup worked): nobody to tell, confirmed as before"); }

{ const w = db({ fail: { "rpc.cdf_outbox_done": true }, members: [{ email: "flo@t", name: "Flo", role: "vendor" }] });
  const res = await handlePush(notice(), w.deps);
  assert.equal(res.status, 503);
  ok("Nobody to tell but the confirmation fails: reported as pending"); }
