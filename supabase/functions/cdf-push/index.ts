// Web push for the installed app (iPhone 16.4+ from the home screen, Android): chat messages that mention
// someone or happen on their order, private messages, orders handed to (or cancelled for) a florist or a driver,
// and new requests from the public order form (to the admins).
// Called only by database triggers (cdf_push_hook) with the shared x-cdf-hook secret, like cdf-notify.
// Needs the CDF_VAPID_KEYS secret (JSON {publicKey, privateKey} JWKs); without it nothing is sent.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const APP_URL = Deno.env.get("CDF_APP_URL") || "https://casadeflores-store.netlify.app";
const CONTACT = Deno.env.get("CDF_PUSH_CONTACT") || "mailto:jerold.ambrocio@gmail.com";
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

let appServer: webpush.ApplicationServer | null = null;
async function server() {
  if (appServer) return appServer;
  const raw = Deno.env.get("CDF_VAPID_KEYS");
  if (!raw) return null;
  const vapidKeys = await webpush.importVapidKeys(JSON.parse(raw), { extractable: false });
  appServer = await webpush.ApplicationServer.new({ contactInformation: CONTACT, vapidKeys });
  return appServer;
}
// High urgency: without it iPhones may hold a "normal" push for a while to save battery (seen: ~20 s).
// A notice that is a day old is no longer worth showing, so the push service drops it after 24 h.
const PUSH_OPTS = { urgency: webpush.Urgency.High, ttl: 24 * 3600 };
const handle = (name: string) => (name || "").trim().split(/\s+/)[0].toLowerCase();

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: ok } = await service.rpc("cdf_hook_ok", { p_secret: req.headers.get("x-cdf-hook") || "" });
  if (!ok) return json({ error: "forbidden" }, 403);
  const app = await server();
  if (!app) return json({ skipped: "CDF_VAPID_KEYS not set" });

  const body = await req.json().catch(() => ({}));
  const { data: members } = await service.from("cdf_members").select("email,name,username,role");
  const team = members || [];
  const nameOf = (e: string) => team.find((m) => m.email === e)?.name || e;
  // Each device gets the notice in its own language (cdf_push_subs.lang, English when unknown).
  // kind tells the phone how to buzz: "message" for chats, "order" for one handed to you or cancelled.
  const day = (d: string, lang: string) => d ? new Date(d + "T12:00:00Z").toLocaleDateString(lang === "es" ? "es-ES" : "en-PH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "";
  let to: string[] = [], payloadFor: (lang: string) => Record<string, string> = () => ({});

  if (body.kind === "message") {
    const { data: m } = await service.from("cdf_messages").select("*").eq("id", body.id).maybeSingle();
    if (!m) return json({ sent: 0 });
    const { data: order } = m.order_id
      ? await service.from("cdf_orders").select("id,num,vendor_email,carrier_email").eq("id", m.order_id).maybeSingle()
      : { data: null };
    // Mentioned people (by first name or username), plus the florist and driver of that order
    const said = [...String(m.body).matchAll(/@([\p{L}\d._-]+)/gu)].map((x) => x[1].toLowerCase());
    const who = new Set(team.filter((p) => said.includes(handle(p.name)) || (p.username && said.includes(p.username))).map((p) => p.email));
    if (order) for (const e of [order.vendor_email, order.carrier_email]) if (e) who.add(e);
    who.delete(m.author_email);
    to = [...who];
    // Nobody hears about an order they couldn't open
    if (order) to = (await Promise.all(to.map(async (e) => ((await service.rpc("cdf_member_sees", { p_email: e, p_order: order.id })).data ? e : null)))).filter(Boolean) as string[];
    payloadFor = () => ({
      kind: "message",
      title: nameOf(m.author_email) + (order ? " · #" + order.num : " · #team"),
      body: String(m.body).slice(0, 180),
      url: APP_URL + "/?chat=" + (m.order_id || "team"),
      tag: "chat-" + (m.order_id || "team"),
    });
  } else if (body.kind === "direct") {
    // A private chat: the other person in the thread hears it, the author doesn't
    const { data: m } = await service.from("cdf_direct_messages").select("id,direct_id,author_email,body").eq("id", body.id).maybeSingle();
    if (!m) return json({ sent: 0 });
    const { data: th } = await service.from("cdf_direct_threads").select("member_a,member_b").eq("id", m.direct_id).maybeSingle();
    if (!th) return json({ sent: 0 });
    to = [th.member_a, th.member_b].filter((e) => e && e !== m.author_email);
    payloadFor = () => ({ kind: "message", title: nameOf(m.author_email), body: String(m.body).slice(0, 180), url: APP_URL + "/?chat=" + m.direct_id, tag: "chat-" + m.direct_id });
  } else if (body.kind === "assigned" && body.to) {
    const { data: o } = await service.from("cdf_orders").select("id,num,date,slot,customer_name").eq("id", body.id).maybeSingle();
    if (!o) return json({ sent: 0 });
    to = [String(body.to).toLowerCase()];
    payloadFor = (lang) => ({ kind: "order", title: (lang === "es" ? "Nuevo pedido #" : "New order #") + o.num,
      body: [o.customer_name, day(o.date, lang), o.slot].filter(Boolean).join(" · "), url: APP_URL + "/?order=" + o.id, tag: "order-" + o.id });
  } else if (body.kind === "cancelled" && body.to) {
    // Sent by cdf_push_cancelled to the florist and driver it was assigned to. The reason stays in the app.
    const { data: o } = await service.from("cdf_orders").select("id,num,date,slot,cancelled_at").eq("id", body.id).maybeSingle();
    if (!o || !o.cancelled_at) return json({ sent: 0 });
    to = [String(body.to).toLowerCase()];
    payloadFor = (lang) => ({ kind: "order", title: lang === "es" ? "Pedido #" + o.num + " cancelado" : "Order #" + o.num + " cancelled",
      body: (lang === "es" ? "No lo prepares ni lo repartas · " : "Don't prepare or deliver it · ") + [day(o.date, lang), o.slot].filter(Boolean).join(" · "),
      url: APP_URL + "/?order=" + o.id, tag: "order-" + o.id });
  } else if (body.kind === "rider" && body.to) {
    // Lalamove assigned a rider who is heading to the florist's shop (cdf_push_rider, migration 037)
    const { data: o } = await service.from("cdf_orders").select("id,num,slot").eq("id", body.id).maybeSingle();
    const { data: r } = await service.from("cdf_lalamove").select("driver_name,driver_plate").eq("order_id", body.id).maybeSingle();
    if (!o) return json({ sent: 0 });
    to = [String(body.to).toLowerCase()];
    const who = [r?.driver_name, r?.driver_plate].filter(Boolean).join(" · ");
    payloadFor = (lang) => ({ kind: "order", title: (lang === "es" ? "Rider en camino a tu tienda · #" : "Rider on the way to your shop · #") + o.num,
      body: (lang === "es" ? "Ten el ramo listo en la puerta" : "Have the bouquet ready at the door") + (who ? " · " + who : ""),
      url: APP_URL + "/?order=" + o.id, tag: "rider-" + o.id });
  } else if (body.kind === "rider_failed") {
    // The delivery fell through on Lalamove's side: every admin hears it, to book again or take it by hand
    const { data: o } = await service.from("cdf_orders").select("id,num,slot,cancelled_at").eq("id", body.id).maybeSingle();
    if (!o || o.cancelled_at) return json({ sent: 0 });
    to = team.filter((p) => p.role === "admin").map((p) => p.email);
    const why = (lang: string) => ({ CANCELED: lang === "es" ? "cancelado por Lalamove o el rider" : "cancelled by Lalamove or the rider",
      REJECTED: lang === "es" ? "rechazado" : "rejected", EXPIRED: lang === "es" ? "ningún rider lo aceptó" : "no rider took it" } as Record<string, string>)[String(body.status)] || String(body.status);
    payloadFor = (lang) => ({ kind: "order", title: "Lalamove · #" + o.num + " · " + why(lang),
      body: lang === "es" ? "Vuelve a pedir rider o márcalo para llevarlo a mano" : "Book a rider again or take it by hand",
      url: APP_URL + "/?order=" + o.id, tag: "rider-" + o.id });
  } else if (body.kind === "request") {
    // A new request from the public form (migration 20261111110000): every admin hears it. Nothing personal
    // goes in the notice (it may show on a locked screen): only that there is one, and its reference.
    const { data: r } = await service.from("cdf_order_requests").select("id,ref,status").eq("id", body.id).maybeSingle();
    if (!r || !["received", "in_review"].includes(r.status)) { if (body.outbox) await service.rpc("cdf_outbox_done", { p_id: body.outbox }); return json({ sent: 0 }); }
    to = team.filter((p) => p.role === "admin").map((p) => p.email);
    payloadFor = (lang) => ({ kind: "order", title: (lang === "es" ? "Nueva solicitud recibida · R" : "New order request · R") + r.ref,
      body: lang === "es" ? "Ábrela en el panel para revisarla" : "Open it in the panel to review it",
      url: APP_URL + "/?request=" + r.id, tag: "request-" + r.id });
  } else return json({ error: "kind" }, 400);

  // A notice from the outbox is confirmed once this function has done its part, so it is not sent again
  const done = async () => { if (body.outbox) await service.rpc("cdf_outbox_done", { p_id: body.outbox }); };
  if (!to.length) { await done(); return json({ sent: 0 }); }
  const { data: subs } = await service.from("cdf_push_subs").select("*").in("member_email", to);
  let sent = 0, gone = 0;
  for (const s of subs || []) {
    try {
      await app.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }).pushTextMessage(JSON.stringify(payloadFor(s.lang === "es" ? "es" : "en")), PUSH_OPTS);
      sent++;
      await service.from("cdf_push_subs").update({ last_ok_at: new Date().toISOString() }).eq("endpoint", s.endpoint);
    } catch (e) {
      // A phone that uninstalled the app or turned notifications off: forget that device
      const err = e as { isGone?: () => boolean; response?: { status?: number } };
      const status = err.response?.status;
      if ((typeof err.isGone === "function" && err.isGone()) || status === 404 || status === 410) {
        await service.from("cdf_push_subs").delete().eq("endpoint", s.endpoint);
        gone++;
      } else console.error("push failed", status, String(e));
    }
  }
  await done();
  return json({ sent, gone });
});
