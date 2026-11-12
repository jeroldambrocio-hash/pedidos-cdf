// cdf-push: a notice from the outbox is confirmed only when it really reached every device (final review,
// 12/11/2026). Nothing is sent anywhere: the push service and the database are stand-ins, except the last
// check, which runs the real migration in an in-memory database.
// Run: NODE_PATH=.test-tools/node_modules node --experimental-strip-types tests/push-send.test.mjs
import assert from "node:assert";
import { createRequire } from "node:module";
import { sendNotice } from "../supabase/functions/cdf-push/send.ts";
const ok = (m) => console.log("ok " + m);
const sub = (n) => ({ endpoint: "https://push.example/" + n, p256dh: "k", auth: "a", lang: "es" });
const status = (code) => Object.assign(new Error("HTTP " + code), { response: { status: code } });

// One stand-in outbox row and push service; `fail` says what each device answers
function world({ fail = {}, subsError = null, sentError = null, doneError = null, loadError = null } = {}) {
  const w = { row: { sent: [], done: false }, pushed: [], forgotten: [], logs: [] };
  w.deps = {
    outbox: 7,
    loadSent: async () => loadError ? { error: loadError } : { data: [...w.row.sent] },
    loadSubs: async () => subsError ? { error: subsError } : { data: [sub(1), sub(2), sub(3)] },
    push: async (s) => { const f = fail[s.endpoint.slice(-1)]; if (f) { if (typeof f === "function") f(); throw f; } w.pushed.push(s.endpoint); },
    markOk: async () => null,
    markSent: async (_id, ep) => { if (sentError) return { error: sentError }; if (!w.row.sent.includes(ep)) w.row.sent.push(ep); return {}; },
    forget: async (s) => { w.forgotten.push(s.endpoint); return {}; },
    done: async () => { if (doneError) return { error: doneError }; w.row.done = true; return {}; },
    log: (...a) => w.logs.push(a.join(" ")),
  };
  return w;
}

{ const w = world({ fail: { 1: status(503), 2: status(503), 3: status(503) } });
  const r = await sendNotice(w.deps);
  assert.deepEqual(r, { sent: 0, gone: 0, failed: 3, pending: true }); assert.equal(w.row.done, false);
  ok("The push service answers 503: the notice stays pending, to be sent again"); }

{ const w = world({ fail: { 1: new TypeError("fetch failed"), 2: new TypeError("fetch failed"), 3: new TypeError("fetch failed") } });
  assert.equal((await sendNotice(w.deps)).pending, true); assert.equal(w.row.done, false);
  ok("A network failure: also pending"); }

{ const w = world({ fail: { 2: status(503) } });
  let r = await sendNotice(w.deps);
  assert.deepEqual(r, { sent: 2, gone: 0, failed: 1, pending: true }); assert.equal(w.row.done, false);
  assert.deepEqual(w.row.sent, [sub(1).endpoint, sub(3).endpoint]);
  // The retry: device 2 is back; 1 and 3 are not sent it twice
  w.deps.push = async (s) => { w.pushed.push(s.endpoint); };
  w.pushed.length = 0;
  r = await sendNotice(w.deps);
  assert.deepEqual(w.pushed, [sub(2).endpoint]); assert.equal(r.pending, false); assert.equal(w.row.done, true);
  ok("Some devices get it and one fails: only the one that failed gets it on the retry, then it is confirmed"); }

{ const w = world({ fail: { 1: status(410), 3: status(404) } });
  const r = await sendNotice(w.deps);
  assert.deepEqual(r, { sent: 1, gone: 2, failed: 0, pending: false }); assert.equal(w.row.done, true);
  assert.deepEqual(w.forgotten, [sub(1).endpoint, sub(3).endpoint]);
  ok("404/410 (app removed or notifications off) forget that device, and are not a reason to retry"); }

{ const w = world({ subsError: { message: "timeout" } });
  assert.equal((await sendNotice(w.deps)).pending, true); assert.equal(w.row.done, false); assert.equal(w.pushed.length, 0);
  const v = world({ loadError: { message: "timeout" } });
  assert.equal((await sendNotice(v.deps)).pending, true); assert.equal(v.row.done, false); assert.equal(v.pushed.length, 0);
  ok("When the devices (or what was already sent) can't be looked up, nothing is confirmed"); }

{ const w = world({ doneError: { message: "timeout" } });
  const r = await sendNotice(w.deps);
  assert.equal(r.pending, true); assert.equal(r.sent, 3); assert.ok(w.logs.some((l) => /confirm failed/.test(l)));
  // The retry finds all three remembered: nothing is sent twice, and it is confirmed this time
  w.deps.done = async () => { w.row.done = true; return {}; }; w.pushed.length = 0;
  assert.equal((await sendNotice(w.deps)).pending, false); assert.equal(w.pushed.length, 0); assert.equal(w.row.done, true);
  ok("If the confirmation itself fails, it is reported as pending and the retry sends nothing twice"); }

{ const w = world(); w.deps.outbox = null;
  const r = await sendNotice(w.deps);
  assert.equal(r.sent, 3); assert.equal(r.pending, false); assert.equal(w.row.done, false); assert.equal(w.row.sent.length, 0);
  ok("A notice not from the outbox (chat, direct trigger) is sent as before and touches no outbox row"); }

// The real migration: cdf_outbox_sent remembers each device once, and only the server can call it
const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const { build } = require("./lib/fresh-db.cjs");
const db = new PGlite();
await build((sql) => db.exec(sql));
const id = (await db.query("insert into public.cdf_outbox(kind, ref_id) values ('request', gen_random_uuid()) returning id")).rows[0].id;
for (const ep of ["a", "b", "a"]) await db.query("select public.cdf_outbox_sent($1, $2)", [id, ep]);
assert.deepEqual((await db.query("select sent_endpoints s from public.cdf_outbox where id = $1", [id])).rows[0].s, ["a", "b"]);
await db.exec("set role authenticated");
await assert.rejects(db.query("select public.cdf_outbox_sent($1, 'x')", [id]), /permission denied/);
ok("The database remembers each device once; a browser cannot call it");
