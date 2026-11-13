// Pedidos CDF → Lalamove. Admins find the drop-off point, get a price, book a rider, follow and cancel it;
// Lalamove calls back here (webhook) when the rider is assigned or the order moves.
// Deploy with --no-verify-jwt: the webhook has no Supabase token. Admin calls are checked below instead,
// and the webhook must carry ?token=LALAMOVE_WEBHOOK_TOKEN. Whatever the webhook says, the order is
// read back from Lalamove itself before anything is saved.
//
// Secrets (Edge Functions → Secrets):
//   LALAMOVE_API_KEY, LALAMOVE_API_SECRET   from the Lalamove Partner Portal (sandbox or production pair)
//   LALAMOVE_ENV                            "sandbox" (default) or "production"
//   LALAMOVE_WEBHOOK_TOKEN                  any long random string, also put in the webhook URL
//   LALAMOVE_PICKUP                         optional fallback shop, JSON: {"lat":14.65,"lng":121.04,"address":"…","name":"Casa de Flores","phone":"+63…"}.
//                                           Normally the rider picks up at the assigned florist's shop (cdf_members.pickup_*, migration 031).
//   LALAMOVE_SYNC_ORDERS                    In production the order follows the rider (picked up → In transit,
//                                           completed → Delivered) unless this is "off". Never in sandbox:
//                                           test riders must not change real orders.
//   LALAMOVE_WEBHOOK_SIGNATURE              Phase 5. "observe" (default): each event's signature is checked and
//                                           recorded, nothing is refused. "enforce": events without a valid one
//                                           get 401 (Lalamove sends them again). "off": not checked.
//   LALAMOVE_PROOF_HOSTS                    Phase 5. Hosts proof images may be downloaded from, comma separated
//                                           (subdomains included). Default "lalamove.com".
// Phase 5: the webhook stores each event before answering and the work is done afterwards (events.ts); a
// round every five minutes (pg_cron → x-cdf-hook) retries what failed, reads back running bookings and
// downloads the proofs to the private bucket cdf-lalamove-proofs.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { call, e164, FINAL, inPhilippines, LalamoveError, orderUpdateFor, parseCoords, pickupAt, validPhone, type Env } from "./lalamove.ts";
import { afterRefresh, processEvent, receive, work, type Deps } from "./events.ts";
import { bookRider, CLAIM_ERRORS, resolveBooking, type BookDeps } from "./booking.ts";
import { addPriorityFee } from "./tip.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ENV: Env = Deno.env.get("LALAMOVE_ENV") === "production" ? "production" : "sandbox";
const KEY = Deno.env.get("LALAMOVE_API_KEY") || "", SECRET = Deno.env.get("LALAMOVE_API_SECRET") || "";
const SYNC = ENV === "production" && Deno.env.get("LALAMOVE_SYNC_ORDERS") !== "off";
const ll = (method: string, path: string, data?: unknown) => call(ENV, KEY, SECRET, method, path, data);

type Pickup = { lat: number; lng: number; address: string; name: string; phone: string };
function pickup(): Pickup | null {
  try {
    const p = JSON.parse(Deno.env.get("LALAMOVE_PICKUP") || "null");
    if (!p || !inPhilippines(+p.lat, +p.lng) || !p.address || !validPhone(e164(p.phone))) return null;
    return { lat: +p.lat, lng: +p.lng, address: String(p.address), name: String(p.name || "Casa de Flores"), phone: e164(p.phone) };
  } catch { return null; }
}

// The assigned florist's shop (each florist works from her own); else the fallback secret. Error text when neither.
async function pickupFor(order: any): Promise<Pickup | string> {
  if (order.vendor_email) {
    const { data: m } = await service.from("cdf_members").select("name, phone, pickup_address, pickup_lat, pickup_lng").eq("email", order.vendor_email).maybeSingle();
    if (m?.pickup_address && m.pickup_lat != null && m.pickup_lng != null) {
      const phone = e164(m.phone);
      if (!validPhone(phone)) return `${m.name} no tiene un teléfono válido en su perfil (lo necesita Lalamove para la recogida)`;
      return { lat: +m.pickup_lat, lng: +m.pickup_lng, address: m.pickup_address, name: `Casa de Flores · ${m.name}`, phone };
    }
    if (!pickup()) return `${m?.name || "La florista"} aún no tiene dirección de recogida (Equipo → editar)`;
  }
  return pickup() || "Asigna primero una florista: el rider recoge en su tienda";
}

const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function save(orderId: string, patch: Record<string, unknown>) {
  const { data, error } = await service.from("cdf_lalamove").upsert({ order_id: orderId, env: ENV, ...patch }, { onConflict: "order_id" }).select().single();
  if (error) throw new Error(error.message);
  return data;
}
const getRow = async (orderId: string) => (await service.from("cdf_lalamove").select("*").eq("order_id", orderId).maybeSingle()).data;
const getOrder = async (orderId: string) => (await service.from("cdf_orders").select("*").eq("id", orderId).maybeSingle()).data;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const PROOFS = "cdf-lalamove-proofs";
const deps: Deps = {
  env: ENV, key: KEY, secret: SECRET,
  rpc: async (name, args) => { const { data, error } = await service.rpc(name, args); return { data, error }; },
  ll, refresh: (orderId) => refresh(orderId), fetch,
  store: (path, bytes, mime) => service.storage.from(PROOFS).upload(path, bytes, { contentType: mime, upsert: false }),
  sha256: async (v) => hex(await crypto.subtle.digest("SHA-256", (typeof v === "string" ? new TextEncoder().encode(v) : v) as BufferSource)),
  hmac: async (secret, text) => {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text)));
  },
  proofHosts: (Deno.env.get("LALAMOVE_PROOF_HOSTS") || "lalamove.com").split(",").map((h) => h.trim()).filter(Boolean),
  log: (...a) => console.error(...a),
};
// Work that goes on after the answer has been sent
const later = (p: Promise<unknown>) => {
  const run = p.catch((e) => console.error("background", e));
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(run);
};

// Read the delivery back from Lalamove (status, price, rider) and, in production with sync on, move the order.
async function refresh(orderId: string) {
  const row = await getRow(orderId);
  if (!row?.ll_order_id) return row;
  const o = await ll("GET", `/v3/orders/${row.ll_order_id}`);
  const patch: Record<string, unknown> = { status: o.status, share_link: o.shareLink || row.share_link, error: null };
  if (o.priceBreakdown?.total) patch.price_total = +o.priceBreakdown.total;
  if (o.driverId && o.driverId !== "0") {
    patch.driver_id = o.driverId;
    try {
      const d = await ll("GET", `/v3/orders/${row.ll_order_id}/drivers/${o.driverId}`);
      Object.assign(patch, { driver_name: d.name || null, driver_phone: d.phone || null, driver_plate: d.plateNumber || null, driver_photo: d.photo || null });
    } catch { /* rider details only exist close to pickup time */ }
  }
  const saved = await save(orderId, patch);
  if (SYNC && saved.env === "production") {
    const order = await getOrder(orderId);
    const upd = order && orderUpdateFor(o.status, order);
    if (upd) await service.from("cdf_orders").update(upd).eq("id", orderId).eq("delivery", order.delivery);
  }
  // Proofs (Phase 5): noted now, downloaded after the answer. Without the migration yet, nothing changes.
  later(afterRefresh(deps, row.ll_order_id, o));
  return saved;
}

// A short share link (maps.app.goo.gl/…): follow its redirects and read the point from where it lands
async function openShortLink(url: string) {
  let u = url;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(u, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (pedidos-cdf)" } });
    const loc = res.headers.get("location");
    const p = parseCoords(loc || "") || parseCoords(u);
    if (p) return p;
    if (!loc) { const body = await res.text().catch(() => ""); return parseCoords(body.slice(0, 200000)); }
    u = new URL(loc, u).toString();
  }
  return null;
}

// Google's geocoder, used when its key is set (secret GOOGLE_MAPS_KEY): it knows the house numbers, villages and
// buildings of the Philippines that the free map doesn't. null = not available (no key, quota reached, an error):
// the caller then searches the free map as before. The key stays on the server and is never logged.
async function googleGeocode(query: string): Promise<{ label: string; lat: number; lng: number }[] | null> {
  const key = Deno.env.get("GOOGLE_MAPS_KEY");
  if (!key) return null;
  const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  // Only the Philippines; "bounds" only prefers Metro Manila, it doesn't exclude the rest
  Object.entries({ address: query, components: "country:PH", region: "ph", language: "en", bounds: "14.35,120.90|14.80,121.15", key })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const d = await res.json();
  if (d.status === "ZERO_RESULTS") return [];
  if (d.status !== "OK") { console.error("google geocode:", d.status); return null; }
  const seen = new Set<string>();
  return (d.results || [])
    // With nothing found Google answers with the country itself (or a whole region): that is not an address
    .filter((r: any) => r.geometry?.location && !(r.types || []).some((t: string) => t === "country" || t === "administrative_area_level_1"))
    .map((r: any) => ({
      label: String(r.formatted_address || "").replace(/,\s*Philippines$/i, "") || `${r.geometry.location.lat}, ${r.geometry.location.lng}`,
      lat: +(+r.geometry.location.lat).toFixed(6), lng: +(+r.geometry.location.lng).toFixed(6),
    }))
    .filter((r: any) => inPhilippines(r.lat, r.lng) && !seen.has(r.label) && seen.add(r.label))
    .slice(0, 5);
}

async function geocode(query: string) {
  const direct = parseCoords(query);
  if (direct) return [{ label: `${direct.lat}, ${direct.lng}`, ...direct }];
  if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(query.trim())) {
    const p = await openShortLink(query.trim()).catch(() => null);
    return p ? [{ label: `${p.lat}, ${p.lng}`, ...p }] : [];
  }
  const g = await googleGeocode(query).catch(() => null);
  if (g?.length) return g;
  // OpenStreetMap data through Photon (komoot): limited to the Philippines and nudged towards Metro Manila.
  // (Nominatim refuses requests from Supabase's servers, checked 9/11/2026.)
  const u = new URL("https://photon.komoot.io/api/");
  Object.entries({ q: query, limit: "6", lat: "14.6", lon: "121.03", bbox: "116,4,127,21.5", lang: "en" }).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u, { headers: { "User-Agent": "pedidos-cdf/1.0 (Casa de Flores order panel; casadeflores.store)" } });
  if (!res.ok) throw new Error("Map search unavailable, paste a Google Maps link instead");
  const seen = new Set<string>();
  return ((await res.json()).features || [])
    .filter((f: any) => (f.properties?.countrycode || "PH") === "PH" && f.geometry?.coordinates)
    .map((f: any) => {
      const p = f.properties || {}, [lng, lat] = f.geometry.coordinates;
      const street = [p.housenumber, p.street].filter(Boolean).join(" ");
      const label = [p.name, street, p.district || p.locality, p.city, p.state].filter((x, i, a) => x && a.indexOf(x) === i).join(", ");
      return { label: label || `${lat}, ${lng}`, lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6) };
    })
    .filter((r: any) => inPhilippines(r.lat, r.lng) && !seen.has(r.label) && seen.add(r.label))
    .slice(0, 5);
}

// A rider is only priced or booked for an order that is still to be delivered (not cancelled, archived or done).
// Refresh and cancel stay open for any order, so a rider left on a cancelled order can still be cancelled.
const notBookable = (order: any) =>
  order.pickup ? "El cliente recoge en tienda: este pedido no lleva rider" : order.cancelled_at ? "El pedido está cancelado" : order.archived_at ? "El pedido está archivado" : order.delivery === "Delivered" ? "El pedido ya está entregado" : null;
const near = (a: number, b: number) => Math.abs(+a - +b) <= 0.0002;

async function quote(orderId: string, b: Record<string, any>) {
  const order = await getOrder(orderId);
  if (!order) return json({ error: "Pedido no encontrado" }, 404);
  const no = notBookable(order);
  if (no) return json({ error: no }, 409);
  const p = await pickupFor(order);
  if (typeof p === "string") return json({ error: p }, 400);
  const lat = +b.lat, lng = +b.lng;
  if (!inPhilippines(lat, lng)) return json({ error: "Ubicación de entrega no válida" }, 400);
  const prev = await getRow(orderId);
  if (prev?.booking_state) return json({ error: CLAIM_ERRORS[prev.booking_state === "pending" ? "cdf_ll_booking_busy" : "cdf_ll_booking_uncertain"][1] }, 409);
  if (prev?.ll_order_id && !FINAL.has(prev.status)) return json({ error: "Este pedido ya tiene un rider reservado" }, 409);
  const serviceType = /^[A-Z0-9_]{2,30}$/.test(b.service || "") ? b.service : "MOTORCYCLE";
  const scheduleAt = b.schedule === "slot" ? pickupAt(order.date, order.slot) : undefined;
  // Lalamove's delivery type (pricingTierCode): "1" Regular, its default, or "2" Priority, which pays the rider
  // more so one is matched sooner. Regular is asked for as before, by leaving the field out.
  const tier = b.tier === "priority" ? "priority" : "regular";
  const q = await ll("POST", "/v3/quotations", {
    ...(scheduleAt ? { scheduleAt } : {}),
    ...(tier === "priority" ? { pricingTierCode: "2" } : {}),
    serviceType, language: "en_PH", specialRequests: [],
    stops: [
      { coordinates: { lat: String(p.lat), lng: String(p.lng) }, address: p.address },
      { coordinates: { lat: String(lat), lng: String(lng) }, address: String(b.place || order.address || "").slice(0, 500) },
    ],
    // "item" is left out on purpose: its weight/category values differ per market and a wrong one rejects the quote
  });
  // Stored through the database, which refuses if a booking was made (or started) meanwhile: a new price
  // replaces only a cancelled or finished delivery, never a running one (audit F01)
  const stored = await service.rpc("cdf_ll_quote_store", { p_order: orderId, p_env: ENV, p_quote: {
    lat, lng, place: b.place || null, service: serviceType,
    quotation_id: q.quotationId, sender_stop: q.stops?.[0]?.stopId, recipient_stop: q.stops?.[1]?.stopId,
    quote_total: +q.priceBreakdown?.total || null, quote_currency: q.priceBreakdown?.currency || "PHP", quote_expires: q.expiresAt || null,
    // What this price was for (migration 038): booking checks the order still matches it
    quote_for: { vendor: order.vendor_email || null, pickup: [p.lat, p.lng], date: order.date, slot: order.slot,
      wanted: b.schedule === "slot" ? "slot" : "now", schedule: scheduleAt || null,
      // What Lalamove says it priced, when it says; else what was asked
      tier: q.pricingTierCode === "2" ? "priority" : q.pricingTierCode === "1" ? "regular" : tier },
  } });
  if (stored.error) {
    const k = Object.keys(CLAIM_ERRORS).find((x) => stored.error!.message.includes(x));
    return json({ error: k ? CLAIM_ERRORS[k][1] : stored.error.message }, k ? CLAIM_ERRORS[k][0] : 500);
  }
  return json({ row: stored.data, scheduleAt: scheduleAt || null });
}

const bookDeps: BookDeps = {
  rpc: async (name, args) => { const { data, error } = await service.rpc(name, args); return { data, error }; },
  ll, newKey: () => crypto.randomUUID(), log: (...a) => console.error(...a),
};

async function book(orderId: string, who: string) {
  const [order, row] = await Promise.all([getOrder(orderId), getRow(orderId)]);
  if (!order || !row?.quotation_id) return json({ error: "Pide primero un precio" }, 400);
  const no = notBookable(order);
  if (no) return json({ error: no }, 409);
  const p = await pickupFor(order);
  if (typeof p === "string") return json({ error: p }, 400);
  // The price must still match the order: same florist and shop, same day and slot, same delivery point
  const f = row.quote_for;
  if (f) {
    if ((f.vendor || null) !== (order.vendor_email || null) || !near(f.pickup?.[0], p.lat) || !near(f.pickup?.[1], p.lng))
      return json({ error: "La florista o su tienda han cambiado desde el precio. Pide un precio nuevo." }, 409);
    if (f.date !== order.date || f.slot !== order.slot) return json({ error: "El día o la franja han cambiado desde el precio. Pide un precio nuevo." }, 409);
  }
  if (order.drop_lat != null && (!near(order.drop_lat, row.lat) || !near(order.drop_lng, row.lng)))
    return json({ error: "La ubicación de entrega del pedido ha cambiado desde el precio. Pide un precio nuevo." }, 409);
  if (row.booking_state) return json({ error: CLAIM_ERRORS[row.booking_state === "pending" ? "cdf_ll_booking_busy" : "cdf_ll_booking_uncertain"][1] }, 409);
  if (row.ll_order_id && !FINAL.has(row.status)) return json({ error: "Este pedido ya tiene un rider reservado" }, 409);
  if (row.quote_expires && Date.parse(row.quote_expires) < Date.now() + 15_000) return json({ error: "El precio ha caducado. Pídelo otra vez." }, 409);
  const phone = e164(order.customer_phone) || e164(order.buyer_phone);
  if (!validPhone(phone)) return json({ error: "El pedido necesita un teléfono válido de quien recibe" }, 400);
  const remarks = [`Order ${order.num}`, order.address, order.delivery_note].filter(Boolean).join(" · ").slice(0, 1000);
  // One attempt at a time per order, held in the database before Lalamove is called (booking.ts)
  const r = await bookRider(bookDeps, orderId, String(order.num), who, {
    quotationId: row.quotation_id,
    sender: { stopId: row.sender_stop, name: p.name, phone: p.phone },
    recipients: [{ stopId: row.recipient_stop, name: String(order.customer_name || order.buyer_name || "Recipient").slice(0, 100), phone, remarks }],
    isPODEnabled: true,
  });
  return json(r.body, r.status);
}

// An admin settles a booking left uncertain: Lalamove's number for it, or "nothing was booked"
async function resolve(orderId: string, who: string, llOrderId: string | null) {
  const [order, row] = await Promise.all([getOrder(orderId), getRow(orderId)]);
  if (!order) return json({ error: "Pedido no encontrado" }, 404);
  const r = await resolveBooking(bookDeps, orderId, String(order.num), who, row, llOrderId);
  if (r.status === 200 && llOrderId) { try { return json({ row: await refresh(orderId) }); } catch { /* the link is saved; the details come with the next round */ } }
  return json(r.body, r.status);
}

async function cancel(orderId: string) {
  const row = await getRow(orderId);
  if (!row?.ll_order_id) return json({ error: "No hay ningún envío reservado" }, 400);
  await ll("DELETE", `/v3/orders/${row.ll_order_id}`);
  // Marked as ours so the office isn't alerted as if the rider or Lalamove had dropped it (migration 037)
  return json({ row: await save(orderId, { status: "CANCELED", error: null, cancelled_by_us: true }) });
}

// Extra pay for the rider while none has accepted (tip.ts). The new price is stored from Lalamove's own answer.
async function tip(orderId: string, add: unknown, base?: unknown) {
  const row = await getRow(orderId);
  if (!row?.ll_order_id) return json({ error: "No hay ningún envío reservado" }, 400);
  const r = await addPriorityFee(ll, row.ll_order_id, add, base);
  const o = r.order, patch: Record<string, unknown> = {};
  if (o?.status) patch.status = o.status;
  if (o?.priceBreakdown?.total) patch.price_total = +o.priceBreakdown.total;
  let saved = row;
  if (Object.keys(patch).length) { try { saved = await save(orderId, patch); } catch { /* the next refresh brings it */ } }
  return json({ ...r.body, row: saved }, r.status);
}

async function webhook(req: Request) {
  const token = Deno.env.get("LALAMOVE_WEBHOOK_TOKEN") || "";
  if (!token || new URL(req.url).searchParams.get("token") !== token) return json({ error: "token" }, 401);
  // ?check=1: are the keys right? A read-only call (the cities list); nothing is created or charged
  if (new URL(req.url).searchParams.get("check") === "1") {
    if (!KEY || !SECRET) return json({ ok: false, env: ENV, error: "missing keys" });
    try {
      const cities = await ll("GET", "/v3/cities");
      return json({ ok: true, env: ENV, keyKind: KEY.slice(0, 7), fallbackPickup: !!pickup(), cities: (cities || []).map((c: any) => ({ code: c.locode, name: c.name, services: (c.services || []).map((s: any) => s.key) })) });
    } catch (e) {
      return json({ ok: false, env: ENV, keyKind: KEY.slice(0, 7), error: e instanceof LalamoveError ? `${e.status} ${e.code}: ${e.message}` : String(e) });
    }
  }
  // ?register=1: tell Lalamove to send status changes here (the same URL, with the token)
  if (new URL(req.url).searchParams.get("register") === "1") {
    if (!KEY || !SECRET) return json({ ok: false, error: "missing keys" });
    const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1/cdf-lalamove?token=${encodeURIComponent(token)}`;
    try { await ll("PATCH", "/v3/webhook", { url: base }); return json({ ok: true, env: ENV }); }
    catch (e) { return json({ ok: false, env: ENV, error: e instanceof LalamoveError ? `${e.status} ${e.code}: ${e.message}` : String(e) }); }
  }
  // Stored first, answered next, worked on after the answer (and retried every five minutes if it fails)
  const raw = await req.text();
  const mode = (Deno.env.get("LALAMOVE_WEBHOOK_SIGNATURE") || "observe").toLowerCase();
  const r = await receive(deps, raw, new URL(req.url), mode);
  if (r.eventId) {
    later((async () => {
      if (!r.duplicate) {
        const { data } = await service.rpc("cdf_ll_events_claim", { p_limit: 1, p_id: r.eventId });
        for (const ev of data || []) await processEvent(deps, ev);
      }
      // Production has no pg_cron (checked 11/11/2026): each webhook call also does the round, so what
      // failed earlier is retried as long as Lalamove keeps calling
      await work(deps);
    })());
  }
  return json(r.body, r.status);
}

// An office member takes a proof out: the file goes, the row stays as "removed" (who and when)
async function removeProof(id: number, email: string) {
  const { data: p } = await service.from("cdf_lalamove_proofs").select("id, storage_path, state").eq("id", id).maybeSingle();
  if (!p) return json({ error: "Prueba no encontrada" }, 404);
  if (p.storage_path) {
    const { error } = await service.storage.from(PROOFS).remove([p.storage_path]);
    if (error) return json({ error: error.message }, 502);
  }
  const { error } = await service.rpc("cdf_ll_proof_removed", { p_id: id, p_by: email });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (new URL(req.url).searchParams.has("token")) return webhook(req);
  // The five-minute round (pg_cron → cdf_lalamove_work_hook), proven by the shared hook secret
  if (req.headers.get("x-cdf-hook")) {
    const { data: okHook } = await service.rpc("cdf_hook_ok", { p_secret: req.headers.get("x-cdf-hook") || "" });
    if (!okHook) return json({ error: "hook" }, 401);
    if (!KEY || !SECRET) return json({ ok: false, error: "missing keys" });
    return json({ ok: true, ...(await work(deps)) });
  }

  const tokenJwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: caller } = await service.auth.getUser(tokenJwt);
  if (!caller?.user?.email) return json({ error: "Inicia sesión de nuevo" }, 401);
  const email = caller.user.email.toLowerCase();
  const { data: me } = await service.from("cdf_members").select("role").eq("email", email).maybeSingle();
  // Admins for any order; a florist only for the orders assigned to her (checked below, per order)
  if (me?.role !== "admin" && me?.role !== "vendor") return json({ error: "No tienes acceso a Lalamove" }, 403);

  let b: Record<string, any>;
  try { b = await req.json(); } catch { return json({ error: "Petición no válida" }, 400); }
  if (b.action === "status") return json({ env: ENV, ready: !!(KEY && SECRET), sync: SYNC });
  if (!KEY || !SECRET) return json({ error: "Faltan las claves de Lalamove (LALAMOVE_API_KEY / LALAMOVE_API_SECRET)" }, 500);

  if (b.action === "proof_remove") {
    if (me.role !== "admin") return json({ error: "Solo la oficina puede quitar una prueba" }, 403);
    if (!Number.isInteger(+b.id) || +b.id < 1) return json({ error: "Prueba no válida" }, 400);
    return await removeProof(+b.id, email);
  }

  const orderId = String(b.order_id || "");
  try {
    if (b.action === "geocode") return json({ results: await geocode(String(b.query || "").slice(0, 300)) });
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "Pedido no válido" }, 400);
    if (me.role === "vendor") {
      const { data: mine } = await service.from("cdf_orders").select("vendor_email").eq("id", orderId).maybeSingle();
      if (mine?.vendor_email?.toLowerCase() !== email) return json({ error: "Este pedido no es tuyo" }, 403);
    }
    if (b.action === "quote") return await quote(orderId, b);
    if (b.action === "book") return await book(orderId, email);
    if (b.action === "book_resolve") {
      if (me.role !== "admin") return json({ error: "Solo la oficina puede resolver una reserva sin confirmar" }, 403);
      return await resolve(orderId, email, b.ll_order_id ? String(b.ll_order_id).trim() : null);
    }
    if (b.action === "refresh") return json({ row: await refresh(orderId) });
    if (b.action === "cancel") return await cancel(orderId);
    if (b.action === "priority_fee") return await tip(orderId, b.add, b.base);
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    const msg = e instanceof LalamoveError
      ? (e.code === "ERR_CANCELLATION_FORBIDDEN" ? "Lalamove ya no deja cancelarlo (el rider lleva más de 5 minutos asignado)" : `Lalamove: ${e.message} (${e.code})`)
      : String((e as Error)?.message || e);
    if (orderId && b.action !== "geocode") { try { await save(orderId, { error: msg }); } catch { /* keep the original error */ } }
    return json({ error: msg }, e instanceof LalamoveError && e.status < 500 ? 400 : 502);
  }
});
