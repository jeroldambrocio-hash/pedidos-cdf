import assert from "node:assert/strict";
import { syncDelivery } from "../supabase/functions/cdf-lalamove/sync.ts";

const initial = { id: "test", status: "Ready", delivery: "In transit", updated_at: "v1" };
function backend({ readError = false, writeError = false, conflicts = 0, cancelOnConflict = false } = {}) {
  let row = { ...initial }, writes = 0;
  return {
    get row() { return row; }, get writes() { return writes; },
    from() {
      let patch;
      const q = { select() { return q; }, eq() { return q; },
        update(v) { patch = v; return q; },
        async maybeSingle() { return { data: { ...row }, error: readError ? { message: "denied" } : null }; },
        then(resolve, reject) {
          writes++;
          if (writeError) return Promise.resolve({ error: { code: "23514" }, data: null }).then(resolve, reject);
          if (conflicts-- > 0) {
            row.updated_at = "v" + (writes + 1);
            if (cancelOnConflict) row.cancelled_at = "now";
            return Promise.resolve({ error: null, data: [] }).then(resolve, reject);
          }
          Object.assign(row, patch);
          return Promise.resolve({ error: null, data: [{ id: row.id }] }).then(resolve, reject);
        } };
      return q;
    }
  };
}
let db = backend(); await syncDelivery(db, "test", "COMPLETED"); assert.equal(db.row.delivery, "Delivered");
await assert.rejects(syncDelivery(backend({ writeError: true }), "test", "COMPLETED"), /cdf_sync_write_failed/);
await assert.rejects(syncDelivery(backend({ readError: true }), "test", "COMPLETED"), /cdf_sync_read_failed/);
db = backend({ conflicts: 1 }); await syncDelivery(db, "test", "COMPLETED"); assert.equal(db.writes, 2);
await assert.rejects(syncDelivery(backend({ conflicts: 9 }), "test", "COMPLETED"), /cdf_sync_conflict/);
db = backend({ conflicts: 1, cancelOnConflict: true }); await syncDelivery(db, "test", "COMPLETED");
assert.equal(db.row.delivery, "In transit"); assert.equal(db.writes, 1);
console.log("ok Lalamove sync: success, read/write errors, concurrent edit retry, bounded conflict, concurrent cancellation");
