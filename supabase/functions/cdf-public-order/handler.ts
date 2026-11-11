// The public order form's server side, written against a small set of dependencies so it runs the same
// in the edge function (index.ts) and in tests (tests/public-order.test.mjs), with nothing real behind it.
//
// What a visitor can do here, and nothing else:
//   session  pass the anti-abuse check once and get a short-lived token (carries the quotas)
//   search   look an address up (its own endpoint: this function cannot price or book riders)
//   upload   send one photo; it is checked and cleaned here before it is stored, privately
//   remove   take back a photo sent in this session
//   submit   Phase 2: the request is checked in full, then answered "not open yet" (Phase 3 stores it)
// It is off unless the secret PUBLIC_ORDER=on, and answers only the sites listed in PUBLIC_ORDER_ORIGINS.
import { CheckError, checkRequest, cleanImage, IMAGE_MAX_BYTES, inPhilippines } from "./checks.ts";

export type Deps = {
  env: (name: string) => string | undefined;
  now: () => number;
  randomToken: () => string;
  sha256: (text: string | Uint8Array) => Promise<string>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  store: (path: string, bytes: Uint8Array, mime: string) => Promise<{ error: unknown }>;
  unstore: (paths: string[]) => Promise<unknown>;
  fetch: typeof fetch;
};

// Per hour unless said otherwise. Generous on purpose where many customers may share one address
// (an office, a mobile carrier): a shared address alone must not lock everyone out.
const LIMITS = {
  sessionsPerIp: 30, sessionsOverall: 3000, searchesPerSession: 60, searchesPerIp: 400,
  uploadsPerIp: 240, submitsPerSession: 10,
};
const HOUR = 3600;

export async function handle(req: Request, d: Deps): Promise<Response> {
  const origin = req.headers.get("origin") || "";
  const allowed = (d.env("PUBLIC_ORDER_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const cors: Record<string, string> = allowed.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cdf-session", "Access-Control-Max-Age": "600" }
    : {};
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const no = (error: string, status = 400, field?: string) => json(field ? { error, field } : { error }, status);

  if (req.method === "OPTIONS") return new Response(null, { status: allowed.includes(origin) ? 204 : 403, headers: cors });
  if (req.method !== "POST") return no("method", 405);
  if (d.env("PUBLIC_ORDER") !== "on") return no("off", 503);
  // A browser always says where the page is from; only the listed sites may use this
  if (origin && !allowed.includes(origin)) return no("origin", 403);

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const ipHash = await d.sha256(`${d.env("PUBLIC_ORDER_SALT") || ""}|${ip}`);
  const within = async (bucket: string, limit: number, seconds = HOUR) => {
    const { data, error } = await d.rpc("cdf_rate_hit", { p_bucket: bucket, p_limit: limit, p_window_seconds: seconds });
    if (error) throw new Error("rate");
    return data === true;
  };
  const tokenHash = async () => {
    const token = req.headers.get("x-cdf-session") || "";
    return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? await d.sha256(token) : null;
  };
  const dbError = (e: { message: string } | null) => (e ? (/cdf_session_invalid/.test(e.message) ? no("session", 401) : /cdf_upload_quota/.test(e.message) ? no("quota", 429) : /cdf_invalid_file/.test(e.message) ? no("file", 400) : no("server", 500)) : null);

  try {
    const url = new URL(req.url), type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();

    // ---- upload: the body is the file itself
    if (url.searchParams.get("action") === "upload") {
      const hash = await tokenHash(), kind = url.searchParams.get("kind") || "";
      if (!hash) return no("session", 401);
      if (kind !== "reference" && kind !== "payment_proof") return no("file", 400);
      if (+(req.headers.get("content-length") || 0) > IMAGE_MAX_BYTES) return no("file_too_big", 413);
      if (!(await within("upload-ip:" + ipHash, LIMITS.uploadsPerIp))) return no("slow_down", 429);
      // Read no further than the limit, whatever the declared length says (or does not say)
      const parts: Uint8Array[] = [];
      let size = 0;
      const reader = req.body?.getReader();
      for (; reader;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > IMAGE_MAX_BYTES) { await reader.cancel().catch(() => {}); return no("file_too_big", 413); }
        parts.push(value);
      }
      const raw = new Uint8Array(size);
      parts.reduce((at, p) => (raw.set(p, at), at + p.length), 0);
      let image;
      try { image = cleanImage(raw); }
      catch (e) { return no(e instanceof CheckError ? e.message : "not_an_image", e instanceof CheckError && e.message === "file_too_big" ? 413 : 415); }
      const claim = await d.rpc("cdf_upload_claim", { p_token_hash: hash, p_kind: kind, p_ext: image.ext });
      if (claim.error) return dbError(claim.error)!;
      const { file, path } = claim.data as { file: string; path: string };
      const finish = (status: string) => d.rpc("cdf_upload_finish", { p_token_hash: hash, p_file: file, p_status: status,
        p_mime: image.mime, p_bytes: image.bytes.length, p_width: image.width, p_height: image.height, p_sha256: null });
      const stored = await d.store(path, image.bytes, image.mime);
      if (stored.error) { await finish("rejected"); return no("server", 500); }
      const done = await d.rpc("cdf_upload_finish", { p_token_hash: hash, p_file: file, p_status: "ready", p_mime: image.mime,
        p_bytes: image.bytes.length, p_width: image.width, p_height: image.height, p_sha256: await d.sha256(image.bytes) });
      if (done.error) { await d.unstore([path]); return dbError(done.error)!; }
      // The visitor gets an id to refer to the file by; never where it is stored
      return json({ file, width: image.width, height: image.height, bytes: image.bytes.length });
    }

    if (type !== "application/json") return no("invalid", 415);
    const text = await req.text();
    if (text.length > 20_000) return no("invalid", 413);
    let b: Record<string, unknown>;
    try { b = JSON.parse(text); } catch { return no("invalid"); }
    if (!b || typeof b !== "object" || Array.isArray(b)) return no("invalid");

    // ---- session
    if (b.action === "session") {
      if (Object.keys(b).some((k) => k !== "action" && k !== "captcha")) return no("unknown_field");
      if (!(await within("session-ip:" + ipHash, LIMITS.sessionsPerIp)) || !(await within("session-all", LIMITS.sessionsOverall))) return no("slow_down", 429);
      const secret = d.env("TURNSTILE_SECRET");
      if (secret) {
        if (typeof b.captcha !== "string" || !b.captcha || b.captcha.length > 2048) return no("captcha", 403);
        const form = new URLSearchParams({ secret, response: b.captcha });
        if (ip !== "unknown") form.set("remoteip", ip);
        const check = await d.fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form }).then((r) => r.json()).catch(() => null);
        if (check?.success !== true) return no("captcha", 403);
      } else if (d.env("PUBLIC_ORDER_NO_CAPTCHA") !== "test-only") return no("off", 503); // never open without the check by accident
      const token = d.randomToken();
      const made = await d.rpc("cdf_upload_session_open", { p_token_hash: await d.sha256(token), p_ip_hash: ipHash });
      if (made.error) return no("server", 500);
      return json({ session: token, expires_in: 2 * HOUR });
    }

    const hash = await tokenHash();
    if (!hash) return no("session", 401);

    // ---- search
    if (b.action === "search") {
      if (Object.keys(b).some((k) => k !== "action" && k !== "query")) return no("unknown_field");
      const query = typeof b.query === "string" ? b.query.trim() : "";
      if (query.length < 3 || query.length > 200) return no("invalid", 400, "query");
      const live = await d.rpc("cdf_upload_session_of", { p_token_hash: hash });
      if (live.error) return no("server", 500);
      if (!live.data) return no("session", 401);
      if (!(await within("search:" + hash, LIMITS.searchesPerSession)) || !(await within("search-ip:" + ipHash, LIMITS.searchesPerIp))) return no("slow_down", 429);
      const u = new URL("/api/", d.env("PUBLIC_GEOCODER_URL") || "https://photon.komoot.io");
      Object.entries({ q: query, limit: "6", lat: "14.6", lon: "121.03", bbox: "116,4,127,21.5", lang: "en" }).forEach(([k, v]) => u.searchParams.set(k, v));
      const res = await d.fetch(u, { headers: { "User-Agent": "pedidos-cdf/1.0 (Casa de Flores order form; casadeflores.store)" } }).catch(() => null);
      if (!res?.ok) return no("search_unavailable", 502);
      const seen = new Set<string>();
      // deno-lint-ignore no-explicit-any
      const results = (((await res.json().catch(() => ({}))) as any).features || []).filter((f: any) => (f.properties?.countrycode || "PH") === "PH" && Array.isArray(f.geometry?.coordinates))
        // deno-lint-ignore no-explicit-any
        .map((f: any) => {
          const p = f.properties || {}, [lng, lat] = f.geometry.coordinates;
          const street = [p.housenumber, p.street].filter(Boolean).join(" ");
          const label = [p.name, street, p.district || p.locality, p.city, p.state].filter((x: unknown, i: number, a: unknown[]) => x && a.indexOf(x) === i).join(", ");
          return { label: String(label || `${lat}, ${lng}`).slice(0, 200), lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6) };
        })
        .filter((r: { label: string; lat: number; lng: number }) => Number.isFinite(r.lat) && Number.isFinite(r.lng) && inPhilippines(r.lat, r.lng) && !seen.has(r.label) && seen.add(r.label))
        .slice(0, 5);
      return json({ results });
    }

    // ---- remove
    if (b.action === "remove") {
      if (Object.keys(b).some((k) => k !== "action" && k !== "file") || typeof b.file !== "string") return no("invalid");
      const gone = await d.rpc("cdf_upload_finish", { p_token_hash: hash, p_file: b.file, p_status: "removed",
        p_mime: null, p_bytes: null, p_width: null, p_height: null, p_sha256: null });
      if (gone.error) return dbError(gone.error)!;
      await d.unstore([gone.data as string]);
      return json({ removed: true });
    }

    // ---- submit
    if (b.action === "submit") {
      const { action: _action, ...body } = b;
      let request;
      try { request = checkRequest(body, d.now()); }
      catch (e) { return e instanceof CheckError ? no(e.message, 422, e.field) : no("invalid", 422); }
      if (!(await within("submit:" + hash, LIMITS.submitsPerSession))) return no("slow_down", 429);
      const ready = await d.rpc("cdf_upload_files_ready", { p_token_hash: hash, p_references: request.reference_files, p_proof: request.payment_proof });
      if (ready.error) return no("server", 500);
      if (ready.data !== true) return no("files", 422, "reference_files");
      // Phase 2 stops here on purpose: the request is valid, and nothing is stored or announced yet.
      return no("requests_not_open", 503);
    }
    return no("invalid");
  } catch {
    return no("server", 500); // details stay in the server's log, not in the answer
  }
}
