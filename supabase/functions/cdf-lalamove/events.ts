// Phase 5: what Lalamove sends us, kept and worked through reliably, and the proofs of each delivery.
// No Supabase or Deno import here (everything comes in through Deps), so the tests run it under Node
// against the real SQL of migration 20261111130000.
//
// The webhook: the event is stored first (cdf_ll_event_receive) and Lalamove gets its 200 only once it
// is; a database failure answers 500 so Lalamove sends it again (it tries 10 times in 24 h). The work
// happens after the answer, and again every five minutes for whatever failed (cdf_ll_events_claim).
// Whatever an event says, the booking is read back with GET /v3/orders/{id}, so events arriving late,
// twice or out of order can't put an old status back.
//
// Only what Lalamove documents is relied on: event types, stops[].POD { status, image, deliveredAt } in
// the order details, and the metadata we send when booking (cdfOrder). Payload shapes, the webhook
// signature and POP fields are not documented in text, so: every payload is kept as received; the
// signature is checked against the formula Lalamove uses for API calls and only recorded ("observe")
// until real events show it matches — LALAMOVE_WEBHOOK_SIGNATURE=enforce then rejects the rest; and the
// proof links inside events are read where real events put them (eventProofs).

export type Deps = {
  env: "sandbox" | "production";
  key: string;
  secret: string;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
  ll: (method: string, path: string, data?: unknown) => Promise<any>;
  refresh: (orderId: string) => Promise<unknown>;          // reads the booking back and saves it (index.ts)
  fetch: typeof fetch;
  store: (path: string, bytes: Uint8Array, mime: string) => Promise<{ error: any }>;
  sha256: (v: string | Uint8Array) => Promise<string>;
  hmac: (secret: string, text: string) => Promise<string>;
  proofHosts: string[];
  log?: (...a: unknown[]) => void;
};

export const PROOF_MAX_BYTES = 8 * 1024 * 1024;
export const BODY_MAX_BYTES = 512 * 1024;
const LL_ID = /^[0-9]{6,25}$/;

const rpcData = async (d: Deps, name: string, args: Record<string, unknown>) => {
  const { data, error } = await d.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message || error}`);
  return data;
};

// ---------- receiving ----------

// Lalamove's timestamp in whatever form it comes (seconds, milliseconds, ISO); null when it isn't one
export function eventTime(v: unknown): string | null {
  let t: number;
  if (typeof v === "number" || (typeof v === "string" && /^\d{9,13}$/.test(v))) { t = +v; if (t < 1e12) t *= 1000; }
  else if (typeof v === "string") t = Date.parse(v);
  else return null;
  return Number.isFinite(t) && t > Date.UTC(2020, 0, 1) && t < Date.UTC(2100, 0, 1) ? new Date(t).toISOString() : null;
}

export function orderIdOf(body: any): string | null {
  const id = body?.data?.order?.orderId ?? body?.data?.orderId ?? body?.orderId;
  return id != null && LL_ID.test(String(id)) ? String(id) : null;
}

const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
};

// The API's own formula (HMAC-SHA256 hex of "TIME\r\nPOST\r\nPATH\r\n\r\nBODY") with the paths our URL can
// have; which one matched is noted (as a label: the query holds the token, which never goes in a note).
export async function checkSignature(d: Deps, body: any, url: URL) {
  if (!body?.signature || body?.timestamp == null) return { state: "absent", note: null as string | null };
  if (body.apiKey != null && String(body.apiKey) !== d.key) return { state: "invalid", note: "apiKey" };
  const data = JSON.stringify(body.data ?? {});
  const fn = "/functions/v1/cdf-lalamove";
  const paths: [string, string][] = [["path", url.pathname], ["path+query", url.pathname + url.search], ["fn", fn], ["fn+query", fn + url.search]];
  const sig = String(body.signature).toLowerCase();
  const seen = new Set<string>();
  for (const [label, p] of paths) {
    if (seen.has(p)) continue; seen.add(p);
    if (same(await d.hmac(d.secret, `${body.timestamp}\r\nPOST\r\n${p}\r\n\r\n${data}`), sig)) return { state: "valid", note: label };
  }
  return { state: "invalid", note: "no formula matched" };
}

export type Received = { status: number; body: Record<string, unknown>; eventId?: number; duplicate?: boolean };

// The webhook call, already past the URL token check. Never does the work itself.
export async function receive(d: Deps, raw: string, url: URL, mode: string): Promise<Received> {
  if (raw.length > BODY_MAX_BYTES) return { status: 413, body: { error: "too large" } };
  if (!raw.trim()) return { status: 200, body: { ok: true } };          // Lalamove's connection test
  let body: any = null;
  try { body = JSON.parse(raw); } catch { /* kept below as text */ }
  const payload = body && typeof body === "object" ? body : { _raw: raw.slice(0, 4000) };
  const sig = body ? await checkSignature(d, body, url) : { state: "absent", note: "not json" };
  if (mode === "enforce" && sig.state !== "valid") return { status: 401, body: { error: "signature" } };
  const key = typeof body?.eventId === "string" && body.eventId.length <= 120 ? "ev:" + body.eventId : "sha:" + await d.sha256(raw);
  const type = body ? String(body.eventType || "UNKNOWN").replace(/[^A-Z0-9_]/gi, "").slice(0, 60) || "UNKNOWN" : "INVALID_JSON";
  const { data, error } = await d.rpc("cdf_ll_event_receive", {
    p_env: d.env, p_key: key, p_type: type, p_ll: body ? orderIdOf(body) : null,
    p_at: eventTime(body?.data?.updatedAt) || eventTime(body?.timestamp),
    p_signature: mode === "off" ? "unchecked" : sig.state, p_note: sig.note, p_payload: payload,
  });
  if (error) return { status: 500, body: { error: "not stored" } };         // Lalamove tries again
  return { status: 200, body: { ok: true }, eventId: data.id, duplicate: data.duplicate };
}

// ---------- working ----------

// A proof link as Lalamove sends it, made safe to fetch (diagnosis of 12/11/2026: real links come as
// http://sg-oimg.lalamove.com/… and answer the same over https). https stays as it is (the download still
// checks the host, also after redirects); http is upgraded to https only for the accepted proof hosts and the
// default port; anything else is dropped. Never fetched over plain http.
export function proofUrl(raw: unknown, hosts: string[]): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 2000 || /\s/.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.username || u.password) return null;
  if (u.protocol === "https:") return s;
  if (u.protocol === "http:" && !u.port && hostAllowed(u.hostname, hosts) && /^http:\/\//i.test(s)) return "https://" + s.slice(7);
  return null;
}

const images = (v: unknown): unknown[] => Array.isArray(v) ? v.slice(0, 5) : v == null ? [] : [v];
export type EventProof = { kind: "pod" | "pop"; stop: string; url: string; status: string | null };

// The proofs inside an event, read by where Lalamove puts them (seen in real events, 12/11/2026):
//   data.order.stops[0].POP.imageUrls[]  pickup photos (POP_STATUS_CHANGED)
//   data.order.stops[i].POD.image        delivery photo or signature (POD_STATUS_CHANGED), i ≥ 1
// Each keeps its kind and stop (the same stop key as syncPod). Several pickup photos of one stop are kept
// as stop, stop#2, stop#3… (one row per photo). A POP event without that shape falls back to the older
// guess (an image/photo key), never under a POD key, so a delivery photo is never taken for a pickup one.
export function eventProofs(data: any, hosts: string[], eventType: string): EventProof[] {
  const out: EventProof[] = [];
  const add = (kind: "pod" | "pop", stop: string, raw: unknown[], status: unknown) => {
    let n = 0;
    for (const x of raw) {
      const url = proofUrl(x, hosts);
      if (!url) continue;
      n++;
      out.push({ kind, stop: n === 1 ? stop : `${stop}#${n}`, url, status: typeof status === "string" ? status : null });
    }
  };
  const stops = Array.isArray(data?.order?.stops) ? data.order.stops : null;
  if (stops) {
    stops.forEach((st: any, i: number) => {
      if (!st || typeof st !== "object") return;
      const key = String(st.stopId ?? "#" + i);
      if (st.POP && typeof st.POP === "object") add("pop", key, [...images(st.POP.imageUrls), ...images(st.POP.image)], st.POP.status);
      if (i >= 1 && st.POD && typeof st.POD === "object") add("pod", key, images(st.POD.image), st.POD.status);
    });
  }
  if (!out.some((p) => p.kind === "pop") && eventType === "POP_STATUS_CHANGED") {
    for (const p of popImages(data, hosts)) out.push({ kind: "pop", ...p });
  }
  return out.slice(0, 10);
}

// Older guess for a POP event whose shape is unknown: links under a key with "image" or "photo" in its name
// (strings or lists of them), skipping anything under a POD key.
export function popImages(data: unknown, hosts: string[] = []): { stop: string; url: string; status: string | null }[] {
  const out: { stop: string; url: string; status: string | null }[] = [];
  const walk = (v: any, stop: string | null, depth: number) => {
    if (!v || typeof v !== "object" || depth > 6) return;
    const here = typeof v.stopId === "string" || typeof v.stopId === "number" ? String(v.stopId) : stop;
    for (const [k, x] of Object.entries(v)) {
      if (/^pod$/i.test(k)) continue;
      if (/image|photo/i.test(k) && (typeof x === "string" || Array.isArray(x))) {
        let n = 0;
        for (const y of images(x)) {
          const url = proofUrl(y, hosts);
          if (!url) continue;
          n++;
          out.push({ stop: n === 1 ? here || "pickup" : `${here || "pickup"}#${n}`, url, status: typeof v.status === "string" ? v.status : null });
        }
      } else if (x && typeof x === "object") walk(x, here, depth + 1);
    }
  };
  walk(data, null, 0);
  return out.slice(0, 5);
}

// Delivery proofs as GET /v3/orders/{id} gives them: stops[].POD. The first stop is the pickup. Returns
// the ids of proofs to download now.
export async function syncPod(d: Deps, llId: string, order: any): Promise<number[]> {
  const stops = Array.isArray(order?.stops) ? order.stops : [];
  const due: number[] = [];
  for (let i = 1; i < stops.length; i++) {
    const pod = stops[i]?.POD;
    if (!pod || typeof pod !== "object") continue;
    const r = await rpcData(d, "cdf_ll_proof_note", {
      p_ll: llId, p_kind: "pod", p_stop: String(stops[i].stopId ?? "#" + i),
      p_status: typeof pod.status === "string" ? pod.status : null,
      p_at: eventTime(pod.deliveredAt), p_url: proofUrl(Array.isArray(pod.image) ? pod.image[0] : pod.image, d.proofHosts),
    });
    if (r.fetch) due.push(r.id);
  }
  return due;
}

// One event. Returns what became of it (for the tests); the row is finished either way.
export async function processEvent(d: Deps, ev: any): Promise<string> {
  let status = "done", err: string | null = null;
  const due: number[] = [];
  try {
    const id: string | null = ev.ll_order_id;
    if (ev.event_type === "WALLET_BALANCE_CHANGED" || ev.event_type === "INVALID_JSON") status = "ignored";
    else if (!id) status = "ignored";
    else {
      let ship = await rpcData(d, "cdf_ll_shipment", { p_ll: id });
      if (!ship) {
        // Not ours, or a replacement Lalamove made: ask Lalamove which of our orders it carries
        const o = await d.ll("GET", `/v3/orders/${id}`);
        const num = o?.metadata?.cdfOrder, key = o?.metadata?.cdfBooking;
        // A booking whose answer was lost (audit F01): its attempt key ties it to the order that made it
        let linked = typeof key === "string" && /^[0-9a-f-]{36}$/i.test(key) ? await rpcData(d, "cdf_ll_link_attempt", { p_key: key, p_new: id, p_env: d.env }) : null;
        if (!linked && num != null) linked = await rpcData(d, "cdf_ll_link_replacement", { p_num: String(num), p_new: id, p_env: d.env });
        if (!linked) status = "unmatched";
        else ship = await rpcData(d, "cdf_ll_shipment", { p_ll: id });
      }
      if (ship) {
        if (ev.event_type === "ORDER_REPLACED") await rpcData(d, "cdf_ll_replace_noticed", { p_ll: id });
        // Links that came in the event itself are noted first: reading the booking back afterwards may not
        // repeat the picture, and a link already noted is kept (cdf_ll_proof_note)
        if (ev.event_type === "POP_STATUS_CHANGED" || ev.event_type === "POD_STATUS_CHANGED") {
          for (const p of eventProofs(ev.payload?.data, d.proofHosts, ev.event_type)) {
            const r = await rpcData(d, "cdf_ll_proof_note", { p_ll: id, p_kind: p.kind, p_stop: p.stop, p_status: p.status,
              p_at: eventTime(ev.payload?.data?.updatedAt), p_url: p.url });
            if (r.fetch) due.push(r.id);
          }
        }
        if (ship.current) await d.refresh(ship.order_id);       // also syncs the delivery proofs
        else due.push(...await syncPod(d, id, await d.ll("GET", `/v3/orders/${id}`)));   // an older booking
      }
    }
  } catch (e) {
    status = "failed"; err = String((e as Error)?.message || e);
    d.log?.("lalamove event", ev.id, err);
  }
  await rpcData(d, "cdf_ll_event_finish", { p_id: ev.id, p_status: status, p_error: err });
  for (const p of due) await downloadDue(d, p);
  return status;
}

// ---------- proofs ----------

export function hostAllowed(host: string, allowed: string[]) {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || /^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) return false;
  return allowed.some((a) => { const x = a.trim().toLowerCase(); return x && (h === x || h.endsWith("." + x)); });
}

export function sniffImage(b: Uint8Array): { mime: string; ext: string } | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: "image/png", ext: "png" };
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

class Final extends Error {}

async function readCapped(res: Response, max: number) {
  const len = +(res.headers.get("content-length") || 0);
  if (len > max) throw new Final("too_big");
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader(), parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await reader.cancel(); } catch { /* */ } throw new Final("too_big"); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// Download one proof into the private bucket: https only, accepted hosts only (also after redirects),
// at most 8 MiB, and it has to really be a JPEG, PNG or WebP. Kept byte for byte, with its SHA-256.
export async function download(d: Deps, p: { id: number; order_id: string; ll_order_id: string; kind: string; stop_key: string; source_url: string }) {
  try {
    let url = p.source_url, res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      const u = new URL(url);
      if (u.protocol !== "https:") throw new Final("not_https");
      if (!hostAllowed(u.hostname, d.proofHosts)) throw new Final("host_not_allowed:" + u.hostname.slice(0, 80));
      res = await d.fetch(u.toString(), { redirect: "manual", signal: AbortSignal.timeout(15000) });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc) break;
      try { await res.body?.cancel(); } catch { /* */ }
      if (hop === 3) throw new Final("too_many_redirects");
      url = new URL(loc, u).toString();
    }
    if (!res!.ok) {
      try { await res!.body?.cancel(); } catch { /* */ }
      const s = res!.status;
      throw s === 408 || s === 429 || s >= 500 ? new Error("http_" + s) : new Final("http_" + s);
    }
    const bytes = await readCapped(res!, PROOF_MAX_BYTES);
    const kind = sniffImage(bytes);
    if (!kind) throw new Final("not_image");
    const sha = await d.sha256(bytes);
    const path = `${p.order_id}/${p.ll_order_id}/${p.kind}-${p.stop_key.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40)}-${sha.slice(0, 16)}.${kind.ext}`;
    const { error } = await d.store(path, bytes, kind.mime);
    if (error && !/exists|duplicate/i.test(String(error.message || error))) throw new Error("store: " + (error.message || error));
    await rpcData(d, "cdf_ll_proof_stored", { p_id: p.id, p_path: path, p_type: kind.mime, p_bytes: bytes.length, p_sha: sha });
    return "available";
  } catch (e) {
    const final = e instanceof Final;
    const msg = String((e as Error)?.message || e);
    await d.rpc("cdf_ll_proof_failed", { p_id: p.id, p_error: msg, p_final: final });
    return final ? "error" : "retry";
  }
}

async function downloadDue(d: Deps, id?: number) {
  const rows = await rpcData(d, "cdf_ll_proofs_due", { p_limit: id ? 1 : 5, p_id: id ?? null });
  for (const p of rows || []) await download(d, p);
}

// ---------- the five-minute round ----------
export async function work(d: Deps) {
  const out = { events: 0, reconciled: 0, failed: 0 };
  for (const ev of (await rpcData(d, "cdf_ll_events_claim", { p_limit: 20, p_id: null })) || []) {
    out.events++;
    if ((await processEvent(d, ev)) === "failed") out.failed++;
  }
  for (const llId of (await rpcData(d, "cdf_ll_reconcile_due", { p_limit: 10 })) || []) {
    const id = typeof llId === "string" ? llId : llId?.cdf_ll_reconcile_due;
    try {
      const ship = await rpcData(d, "cdf_ll_shipment", { p_ll: id });
      if (ship?.current) { await d.refresh(ship.order_id); out.reconciled++; }
    } catch (e) { out.failed++; d.log?.("lalamove reconcile", id, String((e as Error)?.message || e)); }
  }
  await downloadDue(d);
  if (Math.random() < 0.05) await d.rpc("cdf_ll_events_prune", {});
  return out;
}

// After a booking was read back (index.ts refresh): note its proofs and download the due ones
export async function afterRefresh(d: Deps, llId: string, order: any) {
  for (const id of await syncPod(d, llId, order)) await downloadDue(d, id);
}
