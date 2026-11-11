// Lalamove API v3 helpers with no Supabase or Deno dependency, so they run in Node tests too.
// Docs: https://developers.lalamove.com (signature = HMAC-SHA256 hex of "TIME\r\nMETHOD\r\nPATH\r\n\r\nBODY").

export const BASE = { sandbox: "https://rest.sandbox.lalamove.com", production: "https://rest.lalamove.com" } as const;
export type Env = keyof typeof BASE;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function signature(secret: string, time: string, method: string, path: string, body = "") {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${time}\r\n${method}\r\n${path}\r\n\r\n${body}`)));
}

export async function authHeaders(key: string, secret: string, method: string, path: string, body = "", now = Date.now()) {
  const time = String(now);
  return {
    "Authorization": `hmac ${key}:${time}:${await signature(secret, time, method, path, body)}`,
    "Market": "PH",
    "Request-ID": crypto.randomUUID(),
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

export class LalamoveError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

// One call to the API. Errors come back as { errors: [{ id, message }] }.
export async function call(env: Env, key: string, secret: string, method: string, path: string, data?: unknown, f: typeof fetch = fetch) {
  const body = data === undefined ? "" : JSON.stringify({ data });
  const res = await f(BASE[env] + path, { method, headers: await authHeaders(key, secret, method, path, body), body: body || undefined });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const e = json?.errors?.[0] || {};
    throw new LalamoveError(res.status, e.id || String(res.status), e.message || e.detail || text.slice(0, 200) || res.statusText);
  }
  return json?.data ?? json;
}

// Coordinates pasted by hand: "14.6507, 121.0494", or a Google Maps link (…/@14.65,121.04,17z or ?q=14.65,121.04).
export function parseCoords(input: string): { lat: number; lng: number } | null {
  const s = String(input || "");
  // The place's own pin (!3d…!4d…) first: "@lat,lng" is only where the map was centred
  const m = /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(s)
    || /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/.exec(s)
    || /[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i.exec(s)
    || /\/(?:search|place|dir)\/(-?\d{1,2}\.\d+)(?:,|%2C)\+?\s*(-?\d{1,3}\.\d+)/i.exec(s)
    || /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/.exec(s);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return inPhilippines(lat, lng) ? { lat, lng } : null;
}
// Rough box around the Philippines: catches swapped or foreign coordinates before Lalamove does
export const inPhilippines = (lat: number, lng: number) => lat >= 4 && lat <= 21.5 && lng >= 116 && lng <= 127;

// E.164 as Lalamove wants it; Philippine local formats (0917…, 917…) become +63…
export function e164(raw: string) {
  const s = String(raw || "").trim();
  let d = s.replace(/\D/g, "");
  if (!d) return "";
  if (s.startsWith("+")) return "+" + d;
  if (d.startsWith("00")) return "+" + d.slice(2);
  if (/^09\d{9}$/.test(d)) return "+63" + d.slice(1);
  if (/^9\d{9}$/.test(d)) return "+63" + d;
  return "+" + d;
}
export const validPhone = (p: string) => /^\+[1-9]\d{6,14}$/.test(p);

// Lalamove status → the panel's delivery field. Only moves forward; anything else leaves the order alone.
// ASSIGNING_DRIVER / ON_GOING (rider heading to the shop): no change · PICKED_UP: In transit · COMPLETED: Delivered.
// A rider booked while the order was still "Preparing" (nobody pressed "Mark ready"): once the rider has the
// bouquet it was ready, so the order is marked Ready together with the move.
export function orderUpdateFor(llStatus: string, order: { status: string; delivery: string; cancelled_at?: string | null }) {
  if (order.cancelled_at || (order.status !== "Ready" && order.status !== "Preparing")) return null;
  const ready = order.status === "Preparing" ? { status: "Ready" } : {};
  if (llStatus === "PICKED_UP" && order.delivery === "-") return { ...ready, delivery: "In transit" };
  if (llStatus === "COMPLETED" && (order.delivery === "-" || order.delivery === "In transit")) return { ...ready, delivery: "Delivered" };
  return null;
}

// Pickup time for "deliver within the slot": 45 minutes before the slot starts, in Manila (UTC+8, no DST).
// Returns undefined (= now) when that moment has passed or is less than 15 minutes away.
export function pickupAt(date: string, slot: string, now = Date.now()) {
  const m = /(\d{1,2}):(\d{2})/.exec(slot || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !m) return undefined;
  const t = Date.parse(`${date}T${m[1].padStart(2, "0")}:${m[2]}:00+08:00`) - 45 * 60_000;
  return t - now > 15 * 60_000 ? new Date(t).toISOString() : undefined;
}

export const FINAL = new Set(["COMPLETED", "CANCELED", "REJECTED", "EXPIRED"]);
