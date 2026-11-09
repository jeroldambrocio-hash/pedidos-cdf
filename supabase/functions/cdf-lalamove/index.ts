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
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { call, e164, FINAL, inPhilippines, LalamoveError, orderUpdateFor, parseCoords, pickupAt, validPhone, type Env } from "./lalamove.ts";

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
  return saved;
}

async function geocode(query: string) {
  const direct = parseCoords(query);
  if (direct) return [{ label: `${direct.lat}, ${direct.lng}`, ...direct }];
  // OpenStreetMap search, limited to the Philippines and nudged towards Metro Manila
  const u = new URL("https://nominatim.openstreetmap.org/search");
  Object.entries({ q: query, format: "jsonv2", countrycodes: "ph", limit: "5", viewbox: "120.90,14.80,121.15,14.35", "accept-language": "en" }).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u, { headers: { "User-Agent": "pedidos-cdf/1.0 (Casa de Flores order panel; casadeflores.store)" } });
  if (!res.ok) throw new Error("Map search unavailable, paste a Google Maps link instead");
  return (await res.json()).map((r: any) => ({ label: r.display_name, lat: +(+r.lat).toFixed(6), lng: +(+r.lon).toFixed(6) }));
}

async function quote(orderId: string, b: Record<string, any>) {
  const order = await getOrder(orderId);
  if (!order) return json({ error: "Pedido no encontrado" }, 404);
  const p = await pickupFor(order);
  if (typeof p === "string") return json({ error: p }, 400);
  const lat = +b.lat, lng = +b.lng;
  if (!inPhilippines(lat, lng)) return json({ error: "Ubicación de entrega no válida" }, 400);
  const prev = await getRow(orderId);
  if (prev?.ll_order_id && !FINAL.has(prev.status)) return json({ error: "Este pedido ya tiene un rider reservado" }, 409);
  const serviceType = /^[A-Z0-9_]{2,30}$/.test(b.service || "") ? b.service : "MOTORCYCLE";
  const scheduleAt = b.schedule === "slot" ? pickupAt(order.date, order.slot) : undefined;
  const q = await ll("POST", "/v3/quotations", {
    ...(scheduleAt ? { scheduleAt } : {}),
    serviceType, language: "en_PH", specialRequests: [],
    stops: [
      { coordinates: { lat: String(p.lat), lng: String(p.lng) }, address: p.address },
      { coordinates: { lat: String(lat), lng: String(lng) }, address: String(b.place || order.address || "").slice(0, 500) },
    ],
    // "item" is left out on purpose: its weight/category values differ per market and a wrong one rejects the quote
  });
  const row = await save(orderId, {
    lat, lng, place: b.place || null, service: serviceType,
    quotation_id: q.quotationId, sender_stop: q.stops?.[0]?.stopId, recipient_stop: q.stops?.[1]?.stopId,
    quote_total: +q.priceBreakdown?.total || null, quote_currency: q.priceBreakdown?.currency || "PHP", quote_expires: q.expiresAt || null,
    // a fresh quote replaces a cancelled or finished delivery
    ll_order_id: null, status: null, share_link: null, price_total: null,
    driver_id: null, driver_name: null, driver_phone: null, driver_plate: null, driver_photo: null, booked_at: null, error: null,
  });
  return json({ row, scheduleAt: scheduleAt || null });
}

async function book(orderId: string) {
  const [order, row] = await Promise.all([getOrder(orderId), getRow(orderId)]);
  if (!order || !row?.quotation_id) return json({ error: "Pide primero un precio" }, 400);
  const p = await pickupFor(order);
  if (typeof p === "string") return json({ error: p }, 400);
  if (row.ll_order_id && !FINAL.has(row.status)) return json({ error: "Este pedido ya tiene un rider reservado" }, 409);
  if (row.quote_expires && Date.parse(row.quote_expires) < Date.now() + 15_000) return json({ error: "El precio ha caducado. Pídelo otra vez." }, 409);
  const phone = e164(order.customer_phone) || e164(order.buyer_phone);
  if (!validPhone(phone)) return json({ error: "El pedido necesita un teléfono válido de quien recibe" }, 400);
  const remarks = [`Order ${order.num}`, order.address, order.delivery_note].filter(Boolean).join(" · ").slice(0, 1000);
  const o = await ll("POST", "/v3/orders", {
    quotationId: row.quotation_id,
    sender: { stopId: row.sender_stop, name: p.name, phone: p.phone },
    recipients: [{ stopId: row.recipient_stop, name: String(order.customer_name || order.buyer_name || "Recipient").slice(0, 100), phone, remarks }],
    isPODEnabled: true,
    metadata: { cdfOrder: String(order.num) },
  });
  const saved = await save(orderId, {
    ll_order_id: o.orderId, status: o.status || "ASSIGNING_DRIVER", share_link: o.shareLink || null,
    price_total: +o.priceBreakdown?.total || row.quote_total, booked_at: new Date().toISOString(), error: null,
  });
  return json({ row: saved });
}

async function cancel(orderId: string) {
  const row = await getRow(orderId);
  if (!row?.ll_order_id) return json({ error: "No hay ningún envío reservado" }, 400);
  await ll("DELETE", `/v3/orders/${row.ll_order_id}`);
  return json({ row: await save(orderId, { status: "CANCELED", error: null }) });
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
  let body: any = {};
  try { body = await req.json(); } catch { /* Lalamove's test ping can be empty */ }
  const id = body?.data?.order?.orderId || body?.data?.orderId || body?.orderId;
  if (id) {
    const { data: row } = await service.from("cdf_lalamove").select("order_id").eq("ll_order_id", String(id)).maybeSingle();
    if (row) { try { await refresh(row.order_id); } catch (e) { console.error("refresh", id, e); } }
  }
  return json({ ok: true }); // Lalamove only needs a 200
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (new URL(req.url).searchParams.has("token")) return webhook(req);

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

  const orderId = String(b.order_id || "");
  try {
    if (b.action === "geocode") return json({ results: await geocode(String(b.query || "").slice(0, 300)) });
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "Pedido no válido" }, 400);
    if (me.role === "vendor") {
      const { data: mine } = await service.from("cdf_orders").select("vendor_email").eq("id", orderId).maybeSingle();
      if (mine?.vendor_email?.toLowerCase() !== email) return json({ error: "Este pedido no es tuyo" }, 403);
    }
    if (b.action === "quote") return await quote(orderId, b);
    if (b.action === "book") return await book(orderId);
    if (b.action === "refresh") return json({ row: await refresh(orderId) });
    if (b.action === "cancel") return await cancel(orderId);
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    const msg = e instanceof LalamoveError
      ? (e.code === "ERR_CANCELLATION_FORBIDDEN" ? "Lalamove ya no deja cancelarlo (el rider lleva más de 5 minutos asignado)" : `Lalamove: ${e.message} (${e.code})`)
      : String((e as Error)?.message || e);
    if (orderId && b.action !== "geocode") { try { await save(orderId, { error: msg }); } catch { /* keep the original error */ } }
    return json({ error: msg }, e instanceof LalamoveError && e.status < 500 ? 400 : 502);
  }
});
