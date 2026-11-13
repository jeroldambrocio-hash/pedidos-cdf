// The whole push function, with what it needs passed in (index.ts wires the real ones), so tests run it as is.
import { sendNotice, type Sub } from "./send.ts";
import { formatSlot12 } from "../_shared/time.ts";

export const APP_URL = "https://casadeflores-store.netlify.app";
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const handle = (name: string) => (name || "").trim().split(/\s+/)[0].toLowerCase();

// deno-lint-ignore no-explicit-any
type Any = any;
export type PushDeps = {
  service: Any;                               // supabase-js client with the service role
  server: () => Promise<Any | null>;          // webpush ApplicationServer, null without CDF_VAPID_KEYS
  pushOpts: Record<string, unknown>;
  appUrl?: string;
};

export async function handlePush(req: Request, d: PushDeps): Promise<Response> {
  const service = d.service, PUSH_OPTS = d.pushOpts, APP_URL_ = d.appUrl || APP_URL;

  if (req.method !== "POST") return json({ error: "method" }, 405);
  const { data: ok } = await service.rpc("cdf_hook_ok", { p_secret: req.headers.get("x-cdf-hook") || "" });
  if (!ok) return json({ error: "forbidden" }, 403);
  const app = await d.server();
  if (!app) return json({ skipped: "CDF_VAPID_KEYS not set", pending: true }, 503);

  const body = await req.json().catch(() => ({}));
  // A missing source is obsolete, not a reason to retry forever. A failed lookup is always retried.
  const pending = () => json({ sent: 0, pending: true }, 503);
  const obsolete = async () => {
    if (body.outbox) {
      const { error } = await service.rpc("cdf_outbox_done", { p_id: Number(body.outbox) });
      if (error) return pending();
    }
    return json({ sent: 0 });
  };
  // A failed lookup is not "nobody in the team": the notice stays pending (outbox retry), never confirmed
  const { data: members, error: membersErr } = await service.from("cdf_members").select("email,name,username,role");
  if (membersErr) { console.error("team lookup failed", membersErr.message); return json({ sent: 0, pending: true }, 503); }
  const team = (members || []) as { email: string; name: string; username?: string | null; role: string }[];
  const nameOf = (e: string) => team.find((m) => m.email === e)?.name || e;
  // Each device gets the notice in its own language (cdf_push_subs.lang, English when unknown).
  // kind tells the phone how to buzz: "message" for chats, "order" for one handed to you or cancelled.
  const day = (d: string, lang: string) => d ? new Date(d + "T12:00:00Z").toLocaleDateString(lang === "es" ? "es-ES" : "en-PH", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "";
  let to: string[] = [], payloadFor: (lang: string) => Record<string, string> = () => ({});

  if (body.kind === "message") {
    const { data: m, error: mErr } = await service.from("cdf_messages").select("*").eq("id", body.id).maybeSingle();
    if (mErr) return pending();
    if (!m) return obsolete();
    const { data: order, error: orderErr } = m.order_id
      ? await service.from("cdf_orders").select("id,num,vendor_email,carrier_email").eq("id", m.order_id).maybeSingle()
      : { data: null, error: null };
    if (orderErr) return pending();
    if (m.order_id && !order) return obsolete();
    // Mentioned people (by first name or username), plus the florist and driver of that order
    const said = [...String(m.body).matchAll(/@([\p{L}\d._-]+)/gu)].map((x) => x[1].toLowerCase());
    const who = new Set(team.filter((p) => said.includes(handle(p.name)) || (p.username && said.includes(p.username))).map((p) => p.email));
    if (order) for (const e of [order.vendor_email, order.carrier_email]) if (e) who.add(e);
    who.delete(m.author_email);
    to = [...who];
    // Nobody hears about an order they couldn't open
    if (order) {
      const visible = await Promise.all(to.map(async (e) => {
        const r = await service.rpc("cdf_member_sees", { p_email: e, p_order: order.id });
        return { email: e, ...r };
      }));
      if (visible.some((r) => r.error)) return pending();
      to = visible.filter((r) => r.data).map((r) => r.email);
    }
    payloadFor = () => ({
      kind: "message",
      title: nameOf(m.author_email) + (order ? " · #" + order.num : " · #team"),
      body: String(m.body).slice(0, 180),
      url: APP_URL_ + "/?chat=" + (m.order_id || "team"),
      tag: "chat-" + (m.order_id || "team"),
    });
  } else if (body.kind === "direct") {
    // A private chat: the other person in the thread hears it, the author doesn't
    const { data: m, error: mErr } = await service.from("cdf_direct_messages").select("id,direct_id,author_email,body").eq("id", body.id).maybeSingle();
    if (mErr) return pending();
    if (!m) return obsolete();
    const { data: th, error: thErr } = await service.from("cdf_direct_threads").select("member_a,member_b").eq("id", m.direct_id).maybeSingle();
    if (thErr) return pending();
    if (!th) return obsolete();
    to = [th.member_a, th.member_b].filter((e) => e && e !== m.author_email);
    payloadFor = () => ({ kind: "message", title: nameOf(m.author_email), body: String(m.body).slice(0, 180), url: APP_URL_ + "/?chat=" + m.direct_id, tag: "chat-" + m.direct_id });
  } else if (body.kind === "assigned" && body.to) {
    const { data: o, error: oErr } = await service.from("cdf_orders").select("id,num,date,slot,customer_name,vendor_email,carrier_email,cancelled_at,deleted_at").eq("id", body.id).maybeSingle();
    if (oErr) return pending();
    if (!o || o.cancelled_at || o.deleted_at || ![o.vendor_email, o.carrier_email].includes(String(body.to).toLowerCase())) return obsolete();
    to = [String(body.to).toLowerCase()];
    payloadFor = (lang) => ({ kind: "order", title: (lang === "es" ? "Nuevo pedido #" : "New order #") + o.num,
      body: [o.customer_name, day(o.date, lang), formatSlot12(o.slot)].filter(Boolean).join(" · "), url: APP_URL_ + "/?order=" + o.id, tag: "order-" + o.id });
  } else if (body.kind === "cancelled" && body.to) {
    // Sent by cdf_push_cancelled to the florist and driver it was assigned to. The reason stays in the app.
    const { data: o, error: oErr } = await service.from("cdf_orders").select("id,num,date,slot,cancelled_at,vendor_email,carrier_email,deleted_at").eq("id", body.id).maybeSingle();
    if (oErr) return pending();
    if (!o || !o.cancelled_at || o.deleted_at || ![o.vendor_email, o.carrier_email].includes(String(body.to).toLowerCase())) return obsolete();
    to = [String(body.to).toLowerCase()];
    payloadFor = (lang) => ({ kind: "order", title: lang === "es" ? "Pedido #" + o.num + " cancelado" : "Order #" + o.num + " cancelled",
      body: (lang === "es" ? "No lo prepares ni lo repartas · " : "Don't prepare or deliver it · ") + [day(o.date, lang), formatSlot12(o.slot)].filter(Boolean).join(" · "),
      url: APP_URL_ + "/?order=" + o.id, tag: "order-" + o.id });
  } else if (body.kind === "rider" && body.to) {
    // Lalamove assigned a rider who is heading to the florist's shop (cdf_push_rider, migration 037)
    const { data: o, error: oErr } = await service.from("cdf_orders").select("id,num,slot,vendor_email,cancelled_at,deleted_at").eq("id", body.id).maybeSingle();
    const { data: r, error: rErr } = await service.from("cdf_lalamove").select("driver_name,driver_plate,status").eq("order_id", body.id).maybeSingle();
    if (oErr || rErr) return pending();
    if (!o || !r || o.cancelled_at || o.deleted_at || r.status !== "ON_GOING" || o.vendor_email !== String(body.to).toLowerCase()) return obsolete();
    to = [String(body.to).toLowerCase()];
    const who = [r?.driver_name, r?.driver_plate].filter(Boolean).join(" · ");
    payloadFor = (lang) => ({ kind: "order", title: (lang === "es" ? "Rider en camino a tu tienda · #" : "Rider on the way to your shop · #") + o.num,
      body: (lang === "es" ? "Ten el ramo listo en la puerta" : "Have the bouquet ready at the door") + (who ? " · " + who : ""),
      url: APP_URL_ + "/?order=" + o.id, tag: "rider-" + o.id });
  } else if (body.kind === "rider_failed") {
    // The delivery fell through on Lalamove's side: every admin hears it, to book again or take it by hand
    const { data: o, error: oErr } = await service.from("cdf_orders").select("id,num,slot,cancelled_at,deleted_at").eq("id", body.id).maybeSingle();
    const { data: rider, error: rErr } = await service.from("cdf_lalamove").select("status").eq("order_id", body.id).maybeSingle();
    if (oErr || rErr) return pending();
    if (!o || o.cancelled_at || o.deleted_at || !rider || rider.status !== body.status) return obsolete();
    to = team.filter((p) => p.role === "admin").map((p) => p.email);
    const why = (lang: string) => ({ CANCELED: lang === "es" ? "cancelado por Lalamove o el rider" : "cancelled by Lalamove or the rider",
      REJECTED: lang === "es" ? "rechazado" : "rejected", EXPIRED: lang === "es" ? "ningún rider lo aceptó" : "no rider took it" } as Record<string, string>)[String(body.status)] || String(body.status);
    payloadFor = (lang) => ({ kind: "order", title: "Lalamove · #" + o.num + " · " + why(lang),
      body: lang === "es" ? "Vuelve a pedir rider o márcalo para llevarlo a mano" : "Book a rider again or take it by hand",
      url: APP_URL_ + "/?order=" + o.id, tag: "rider-" + o.id });
  } else if (body.kind === "request") {
    // A new request from the public form (migration 20261111110000): every admin hears it. Nothing personal
    // goes in the notice (it may show on a locked screen): only that there is one, and its reference.
    const { data: r, error: rErr } = await service.from("cdf_order_requests").select("id,ref,status").eq("id", body.id).maybeSingle();
    if (rErr) return json({ sent: 0, pending: true }, 503); // looked up again on the next retry
    if (!r || !["received", "in_review"].includes(r.status)) return obsolete();
    to = team.filter((p) => p.role === "admin").map((p) => p.email);
    payloadFor = (lang) => ({ kind: "order", title: (lang === "es" ? "Nueva solicitud recibida · R" : "New order request · R") + r.ref,
      body: lang === "es" ? "Ábrela en el panel para revisarla" : "Open it in the panel to review it",
      url: APP_URL_ + "/?request=" + r.id, tag: "request-" + r.id });
  } else if (body.kind === "request_expired") {
    // A request nobody accepted or rejected before its delivery day (migration 20261112090000)
    const { data: r, error: rErr } = await service.from("cdf_order_requests").select("id,ref,status").eq("id", body.id).maybeSingle();
    if (rErr) return json({ sent: 0, pending: true }, 503); // looked up again on the next retry
    if (!r || r.status !== "expired") return obsolete();
    to = team.filter((p) => p.role === "admin").map((p) => p.email);
    payloadFor = (lang) => ({ kind: "order", title: (lang === "es" ? "Solicitud caducada sin revisar · R" : "Request expired unreviewed · R") + r.ref,
      body: lang === "es" ? "Pasó su día sin aceptarla ni rechazarla" : "Its day passed before anyone accepted or rejected it",
      url: APP_URL_ + "/?request=" + r.id, tag: "request-" + r.id });
  } else return json({ error: "kind" }, 400);

  // A notice from the outbox is confirmed only when every device got it or no longer exists (send.ts)
  const outbox = body.outbox ? Number(body.outbox) : null;
  if (!to.length) {
    if (outbox) { const { error } = await service.rpc("cdf_outbox_done", { p_id: outbox }); if (error) return json({ sent: 0, pending: true }, 503); }
    return json({ sent: 0 });
  }
  const r = await sendNotice({
    outbox,
    // select("*"): before migration 20261112120000 there is no sent_endpoints column, and nothing was remembered
    loadSent: async (id) => { const { data, error } = await service.from("cdf_outbox").select("*").eq("id", id).maybeSingle(); return { data: data?.sent_endpoints || [], error }; },
    loadSubs: async () => await service.from("cdf_push_subs").select("*").in("member_email", to),
    push: async (s: Sub) => { await app.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }).pushTextMessage(JSON.stringify(payloadFor(s.lang === "es" ? "es" : "en")), PUSH_OPTS); },
    markOk: (s) => service.from("cdf_push_subs").update({ last_ok_at: new Date().toISOString() }).eq("endpoint", s.endpoint),
    markSent: async (id, endpoint) => await service.rpc("cdf_outbox_sent", { p_id: id, p_endpoint: endpoint }),
    forget: async (s) => await service.from("cdf_push_subs").delete().eq("endpoint", s.endpoint),
    done: async (id) => await service.rpc("cdf_outbox_done", { p_id: id }),
  });
  return json(r, r.pending ? 503 : 200);
}
