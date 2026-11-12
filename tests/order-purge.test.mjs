// cdf-order-purge (12/11/2026): the owner deletes an order for good and every file of it leaves storage.
// Real handler code (supabase/functions/cdf-order-purge/handler.ts) on the real SQL of every migration in an
// in-memory database; storage is a stand-in that can fail. Nothing reaches Supabase.
// Run: NODE_PATH=.test-tools/node_modules node --experimental-strip-types tests/order-purge.test.mjs
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { purge } from "../supabase/functions/cdf-order-purge/handler.ts";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const { build, TEAM, claims } = require("./lib/fresh-db.cjs");
const ok = (n) => console.log("ok " + n);

const db = new PGlite();
await build((sql) => db.exec(sql));
await db.exec(TEAM);
await db.query("update public.cdf_members set is_owner = true where email = 'admin@t'");
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const call = async (name, args) => {
  const keys = Object.keys(args);
  try { return { data: (await db.query(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]))).rows[0].r, error: null }; }
  catch (e) { return { data: null, error: { message: e.message } }; }
};
const as = (who, role = "authenticated") => async (name, args) => {
  await db.query("select set_config('request.jwt.claims',$1,false)", [who ? claims(who) : ""]); await db.exec("set role " + role);
  try { return name === "cdf_storage_deletions_due" ? { data: (await db.query("select * from public.cdf_storage_deletions_due($1)", [args.p_limit])).rows, error: null } : await call(name, args); }
  finally { await db.exec("reset role"); await db.query("select set_config('request.jwt.claims','',false)"); }
};
// Storage stand-in: the files that exist, and a switch to make it fail
const storage = { files: new Set(), down: false, calls: [] };
const deps = (who) => ({ asUser: as(who), rpc: as(null, "service_role"),
  remove: async (bucket, paths) => { storage.calls.push([bucket, paths.length]); if (storage.down) return { error: { message: "storage unavailable" } }; for (const p of paths) storage.files.delete(bucket + "/" + p); return { error: null }; },
  log: () => {} });

// An order with a photo, delivery photos, a saved payment proof, a stray proof in its folder, and a Lalamove proof
async function orderWithFiles(num) {
  const id = randomUUID(), today = (await one("select (now() at time zone 'Asia/Manila')::date::text d")).d;
  const files = { "cdf-fotos": [`${id}/ref.jpg`], "cdf-entregas": [`${id}/proof.jpg`, `${id}/extra1.jpg`], "cdf-pagos": [`${id}/pay1.jpg`, `${id}/stray.jpg`], "cdf-lalamove-proofs": [`${id}/LL1/pod.jpg`] };
  for (const [b, ps] of Object.entries(files)) for (const p of ps) { await db.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [b, p]); storage.files.add(b + "/" + p); }
  // Unrelated files that must stay: another order's, and a request's photo
  await db.query(`insert into public.cdf_orders (id, num, date, slot, channel, customer_name, photo_path, proof_path, extra_photos)
    values ($1, $2, $3, '10:00 - 11:00', 'Web', 'Ana', $4, $5, $6)`, [id, num, today, files["cdf-fotos"][0], files["cdf-entregas"][0], [files["cdf-entregas"][1]]]);
  await as("admin@t")("cdf_record_payment", { p_order: id, p_request: randomUUID(), p_amount: 100, p_proofs: [files["cdf-pagos"][0]], p_price: 500, p_seen_price: null, p_reverses: null, p_reason: null });
  await db.query("insert into public.cdf_lalamove (order_id, env, ll_order_id, status) values ($1, 'production', $2, 'COMPLETED')", [id, "LL-" + num]);
  await db.query("insert into public.cdf_lalamove_proofs (order_id, ll_order_id, kind, stop_key, state, storage_path) values ($1, $2, 'pod', 'S1', 'available', $3)", [id, "LL-" + num, files["cdf-lalamove-proofs"][0]]);
  return { id, files };
}
for (const f of ["cdf-fotos/other-order/x.jpg", "cdf-solicitudes/req/photo.jpg"]) { const [b, ...p] = f.split("/"); await db.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [b, p.join("/")]); storage.files.add(f); }

{ const o = await orderWithFiles("0300");
  assert.equal((await purge(deps("admin2@t"), { order_id: o.id, reason: "x long" })).body.error, "cdf_owner_only");
  assert.equal((await purge(deps("admin@t"), { order_id: o.id, reason: "Not needed" })).body.error, "cdf_purge_not_in_trash");
  await as("admin@t")("cdf_order_trash", { p_id: o.id, p_reason: "Made by mistake" });
  assert.equal((await purge(deps("admin@t"), { order_id: o.id, reason: "" })).body.error, "cdf_trash_reason");
  const r = await purge(deps("admin@t"), { order_id: o.id, reason: "Never needed" });
  assert.equal(r.status, 200); assert.equal(r.body.files.removed, 6); assert.equal(r.body.files.failed, 0);
  assert.equal(await one("select 1 x from public.cdf_orders where id = $1", [o.id]), undefined);
  for (const t of ["cdf_order_prices", "cdf_order_events", "cdf_lalamove", "cdf_lalamove_shipments", "cdf_lalamove_proofs"])
    assert.equal((await one(`select count(*)::int n from public.${t} where order_id = $1`, [o.id])).n, 0, t);
  for (const [b, ps] of Object.entries(o.files)) for (const p of ps) assert(!storage.files.has(b + "/" + p), b + "/" + p + " still there");
  assert(storage.files.has("cdf-fotos/other-order/x.jpg") && storage.files.has("cdf-solicitudes/req/photo.jpg"), "nothing of anyone else's");
  assert.equal((await one("select action from public.cdf_order_audit where order_id = $1 order by id desc limit 1", [o.id])).action, "purged"); }
ok("Owner only, from the trash, with a reason; everything goes: the order, payments, history, Lalamove rows and all its files (also a stray proof in its folder); nothing else; the log stays");

{ const o = await orderWithFiles("0301"); storage.down = true;
  await as("admin@t")("cdf_order_trash", { p_id: o.id, p_reason: "Made by mistake" });
  const r = await purge(deps("admin@t"), { order_id: o.id, reason: "Never needed" });
  assert.equal(r.status, 200); assert.equal(r.body.files.failed, 6);
  assert.equal(await one("select 1 x from public.cdf_orders where id = $1", [o.id]), undefined, "the delete is not undone");
  assert.equal((await one("select count(*)::int n from public.cdf_storage_deletions where order_id = $1 and done_at is null and last_error = 'storage unavailable'", [o.id])).n, 6);
  storage.down = false;
  assert.equal((await purge(deps("admin2@t"), { action: "retry" })).status, 403);
  const again = await purge(deps("admin@t"), { action: "retry" });
  assert.equal(again.body.files.removed, 6);
  for (const [b, ps] of Object.entries(o.files)) for (const p of ps) assert(!storage.files.has(b + "/" + p));
  assert.equal((await one("select count(*)::int n from public.cdf_storage_deletions where done_at is null")).n, 0); }
ok("Storage down: the order is deleted anyway, its files stay queued with the reason, and the owner's retry removes them");

{ for (const role of ["anon", "authenticated"]) for (const f of ["cdf_storage_deletions_due(integer)", "cdf_storage_deletions_result(bigint[], bigint[], text)"])
    assert.equal((await one("select has_function_privilege($1, $2, 'execute') x", [role, "public." + f])).x, false, role + " " + f); }
ok("Only the server works the deletion queue");
console.log("all purge checks passed");
