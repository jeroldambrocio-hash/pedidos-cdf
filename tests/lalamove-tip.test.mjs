// Priority fee on a booking that is still looking for a rider (cdf-lalamove/tip.ts, the code index.ts runs).
// Lalamove is a stand-in that behaves as its documentation says: the fee sent is the new total, it must be
// higher than the last one, and it is refused once a rider has accepted. Nothing leaves this machine.
// Run: node --experimental-strip-types tests/lalamove-tip.test.mjs
import assert from "node:assert";
import { addPriorityFee, TIP_MAX_ADD } from "../supabase/functions/cdf-lalamove/tip.ts";
import { LalamoveError } from "../supabase/functions/cdf-lalamove/lalamove.ts";
const ok = (m) => console.log("ok " + m);
const later = () => new Promise((r) => setTimeout(r, 5));

function lalamove({ status = "ASSIGNING_DRIVER", base = 112, fee = 0, wallet = 1000, fail = null } = {}) {
  const w = { status, fee, wallet, posts: [], gets: 0, fail };
  const order = () => ({ orderId: "LL1", status: w.status, priceBreakdown: { base: String(base), ...(w.fee ? { priorityFee: String(w.fee) } : {}), total: String(base + w.fee), currency: "PHP" } });
  w.ll = async (method, path, data) => {
    await later();
    if (method === "GET") { w.gets++; if (w.fail === "get") throw new Error("fetch failed"); return order(); }
    assert.equal(path, "/v3/orders/LL1/priority-fee");
    w.posts.push(data.priorityFee);
    if (w.fail === "post") throw new Error("fetch failed");
    const lose = w.fail === "lose"; // Lalamove takes it, but the answer never arrives
    assert.equal(typeof data.priorityFee, "string");
    if (w.status !== "ASSIGNING_DRIVER") throw new LalamoveError(422, "ERR_INVALID_ORDER_STATUS", "Invalid order status");
    if (+data.priorityFee <= w.fee) throw new LalamoveError(422, "ERR_INVALID_TIPS", "Invalid tips");
    if (+data.priorityFee - w.fee > w.wallet) throw new LalamoveError(402, "ERR_INSUFFICIENT_CREDIT", "Insufficient credit");
    w.wallet -= +data.priorityFee - w.fee; w.fee = +data.priorityFee;
    if (lose) throw new Error("connection reset");
    return order();
  };
  return w;
}

{ const w = lalamove();
  let r = await addPriorityFee(w.ll, "LL1", 20, 0);
  assert.equal(r.status, 200); assert.equal(r.body.priority_fee, 20); assert.equal(+r.order.priceBreakdown.total, 132);
  r = await addPriorityFee(w.ll, "LL1", 50, 20);
  assert.equal(r.body.priority_fee, 70); assert.equal(+r.order.priceBreakdown.total, 182);
  r = await addPriorityFee(w.ll, "LL1", "35", 70); // typed by hand
  assert.equal(r.body.priority_fee, 105);
  assert.deepEqual(w.posts, ["20", "70", "105"]); assert.equal(w.wallet, 1000 - 105); }
ok("+20, then +50, then a typed 35: Lalamove is sent the running total (20, 70, 105) and the Wallet pays 105 in all");

{ const w = lalamove();
  const [a, b] = await Promise.all([addPriorityFee(w.ll, "LL1", 20, 0), addPriorityFee(w.ll, "LL1", 20, 0)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(w.fee, 20); assert.equal(w.wallet, 980);
  assert.match((a.status === 409 ? a : b).body.error, /mira el precio/); }
ok("Two phones press +20 at the same moment: 20 is charged once, and the other is told to look at the price");

{ const w = lalamove({ status: "ON_GOING" });
  const r = await addPriorityFee(w.ll, "LL1", 50, 0);
  assert.equal(r.status, 409); assert.match(r.body.error, /rider ya está asignado/); assert.deepEqual(w.posts, []); assert.equal(r.order.status, "ON_GOING"); }
ok("A rider has already accepted: nothing is asked of Lalamove and the panel learns the new status");

for (const bad of [0, -5, 12.5, "abc", "", null, undefined, "1e3", TIP_MAX_ADD + 1, "99999"]) {
  const w = lalamove(), r = await addPriorityFee(w.ll, "LL1", bad);
  assert.equal(r.status, 400, String(bad)); assert.equal(w.gets + w.posts.length, 0, String(bad));
}
assert.equal((await addPriorityFee(lalamove().ll, "LL1", TIP_MAX_ADD, 0)).status, 200);
ok(`Only whole pesos from 1 to ${TIP_MAX_ADD} per press; anything else is refused before Lalamove hears of it`);

{ const w = lalamove({ wallet: 30 });
  const r = await addPriorityFee(w.ll, "LL1", 100, 0);
  assert.equal(r.status, 402); assert.match(r.body.error, /saldo suficiente/); assert.equal(w.fee, 0); }
ok("Not enough in the Wallet: said plainly, nothing added");

{ let w = lalamove({ fail: "get" }), r = await addPriorityFee(w.ll, "LL1", 20, 0);
  assert.equal(r.status, 502); assert.deepEqual(w.posts, []);
  w = lalamove({ fail: "post" }); r = await addPriorityFee(w.ll, "LL1", 20, 0);
  assert.equal(r.status, 502); assert.match(r.body.error, /mira el precio antes de añadir más/); }
ok("Lalamove unreachable: nothing is assumed; after an unclear answer the panel asks to check the price first");

{ const w = lalamove({ fee: 30 });
  const r = await addPriorityFee(w.ll, "LL1", 50);
  assert.equal(r.status, 409); assert.equal(r.body.need_base, true); assert.equal(r.body.priority_fee, 30); assert.deepEqual(w.posts, []); }
ok("Without the fee the person saw, nothing is charged: only the current fee comes back (the panel then asks again with it)");

{ const w = lalamove({ fail: "lose" });
  let r = await addPriorityFee(w.ll, "LL1", 50, 0);
  assert.equal(r.status, 502); assert.equal(w.fee, 50); // Lalamove took it; the answer was lost
  w.fail = null;
  r = await addPriorityFee(w.ll, "LL1", 50, 0); // pressed +50 again, still believing the fee is 0
  assert.equal(r.status, 409); assert.equal(r.body.changed, true); assert.equal(r.body.priority_fee, 50);
  assert.deepEqual(w.posts, ["50"]); assert.equal(w.wallet, 950);
  r = await addPriorityFee(w.ll, "LL1", 50, 50); // seen the real fee, pressed again on purpose
  assert.equal(r.status, 200); assert.equal(r.body.priority_fee, 100); }
ok("+50 taken but its answer lost: pressing +50 again charges nothing and shows ₱50; a deliberate press after that adds 50");
