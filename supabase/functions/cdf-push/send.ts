// Sending one notice to the devices of the people who should hear it, and deciding whether a notice from the
// outbox is finished (reviewed 12/11/2026). A notice is confirmed only when every device either got it or no
// longer exists (404/410: that device is forgotten). A temporary failure (503, network, a failed lookup)
// leaves it pending, so cdf_outbox_retry sends it again; the devices that already got it are remembered
// (cdf_outbox.sent_endpoints) and are normally not sent it again. Not "exactly once": if a push succeeds but
// remembering it fails and the notice is retried, that device can get it twice (logged).
export type Sub = { endpoint: string; p256dh: string; auth: string; lang?: string | null };
type Res<T = unknown> = { data?: T | null; error?: unknown };

export type NoticeDeps = {
  outbox?: number | null;                                  // the outbox row, when the notice came from it
  loadSent: (id: number) => Promise<Res<string[]>>;        // devices that already got this notice
  loadSubs: () => Promise<Res<Sub[]>>;
  push: (sub: Sub) => Promise<void>;                       // throws with { response: { status } } or a network error
  markOk: (sub: Sub) => Promise<unknown>;                  // last_ok_at; best effort
  markSent: (id: number, endpoint: string) => Promise<Res>;
  forget: (sub: Sub) => Promise<Res>;
  done: (id: number) => Promise<Res>;
  log?: (...a: unknown[]) => void;
};

export const isGone = (e: unknown) => {
  const err = e as { isGone?: () => boolean; response?: { status?: number } } | null;
  const status = err?.response?.status;
  return (typeof err?.isGone === "function" && err.isGone()) || status === 404 || status === 410;
};

export async function sendNotice(d: NoticeDeps) {
  const log = d.log || console.error;
  let already = new Set<string>();
  if (d.outbox) {
    const prev = await d.loadSent(d.outbox);
    if (prev.error) { log("outbox lookup failed", String((prev.error as Error)?.message ?? prev.error)); return { sent: 0, gone: 0, failed: 0, pending: true }; }
    already = new Set(prev.data || []);
  }
  const subs = await d.loadSubs();
  if (subs.error) { log("device lookup failed", String((subs.error as Error)?.message ?? subs.error)); return { sent: 0, gone: 0, failed: 0, pending: !!d.outbox }; }
  let sent = 0, gone = 0, failed = 0;
  for (const s of subs.data || []) {
    if (already.has(s.endpoint)) continue;
    try {
      await d.push(s);
    } catch (e) {
      if (isGone(e)) {
        const f = await d.forget(s);
        if (f.error) { failed++; log("forget failed", String(f.error)); } else gone++;
      } else { failed++; log("push failed", (e as { response?: { status?: number } })?.response?.status, String(e)); }
      continue;
    }
    sent++;
    await Promise.resolve(d.markOk(s)).catch(() => null);
    if (d.outbox) {
      const m = await d.markSent(d.outbox, s.endpoint);
      if (m.error) log("could not remember the device got it (a retry may repeat it there)", String(m.error));
    }
  }
  if (!d.outbox) return { sent, gone, failed, pending: false };
  if (failed) return { sent, gone, failed, pending: true };
  const ok = await d.done(d.outbox);
  if (ok.error) { log("outbox confirm failed", String(ok.error)); return { sent, gone, failed, pending: true }; }
  return { sent, gone, failed, pending: false };
}
