// Deleting an order for good (12/11/2026). The owner asks; the database decides and deletes (cdf_order_purge,
// called with the owner's own sign-in, so its rules apply: owner only, from the trash only, no rider, a
// reason), queuing the order's files in the same transaction. Then the files are removed from storage here,
// with the service role, and anything storage could not remove stays queued and is tried again on the next
// call (any purge, or "retry"). Written against a few dependencies so tests run it without Deno.
export type PurgeDeps = {
  // The database as the signed-in owner (rules and errors are the database's)
  asUser: (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;
  // The database as the service (the deletion queue)
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;
  remove: (bucket: string, paths: string[]) => Promise<{ error: { message: string } | null }>;
  log?: (...a: unknown[]) => void;
};
type Answer = { status: number; body: Record<string, unknown> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN: Record<string, [number, string]> = {
  cdf_owner_only: [403, "cdf_owner_only"], cdf_purge_not_in_trash: [409, "cdf_purge_not_in_trash"],
  cdf_order_has_rider: [409, "cdf_order_has_rider"], cdf_trash_reason: [400, "cdf_trash_reason"],
};

// Remove what is queued, a batch at a time. Returns how many went and how many are still waiting.
export async function drain(d: PurgeDeps, rounds = 5) {
  let removed = 0, failed = 0;
  for (let i = 0; i < rounds; i++) {
    const due = await d.rpc("cdf_storage_deletions_due", { p_limit: 200 });
    if (due.error) throw new Error(due.error.message);
    const rows = (due.data || []) as { id: number; bucket: string; path: string }[];
    if (!rows.length) break;
    const byBucket = new Map<string, typeof rows>();
    for (const r of rows) byBucket.set(r.bucket, [...(byBucket.get(r.bucket) || []), r]);
    for (const [bucket, list] of byBucket) {
      const res = await d.remove(bucket, list.map((r) => r.path)).catch((e) => ({ error: { message: String(e?.message || e) } }));
      const ids = list.map((r) => r.id);
      // Storage answers OK for a file that is already gone: either way it is no longer there
      const marked = await d.rpc("cdf_storage_deletions_result", res.error
        ? { p_done: [], p_failed: ids, p_error: res.error.message } : { p_done: ids, p_failed: [], p_error: null });
      if (marked.error) throw new Error(marked.error.message);
      if (res.error) { failed += ids.length; d.log?.("purge storage", bucket, res.error.message); } else removed += ids.length;
    }
    if (rows.length < 200) break;
  }
  return { removed, failed };
}

export async function purge(d: PurgeDeps, body: Record<string, unknown>): Promise<Answer> {
  if (body.action === "retry") {
    const who = await d.asUser("cdf_is_owner", {});
    if (who.error || who.data !== true) return { status: 403, body: { error: "cdf_owner_only" } };
    return { status: 200, body: { files: await drain(d) } };
  }
  const id = String(body.order_id || ""), reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!UUID.test(id)) return { status: 400, body: { error: "invalid" } };
  const done = await d.asUser("cdf_order_purge", { p_id: id, p_reason: reason });
  if (done.error) {
    const k = Object.keys(KNOWN).find((x) => done.error!.message.includes(x));
    return k ? { status: KNOWN[k][0], body: { error: KNOWN[k][1] } } : { status: 500, body: { error: done.error.message } };
  }
  // The order is gone; its files follow. A storage failure doesn't undo the delete: they stay queued.
  let files = { removed: 0, failed: 0 };
  try { files = await drain(d); } catch (e) { d.log?.("purge drain", String((e as Error)?.message || e)); files.failed = -1; }
  return { status: 200, body: { purged: done.data, files } };
}
