// Web push for the installed app (iPhone 16.4+ from the home screen, Android): chat messages that mention
// someone or happen on their order, private messages, and orders handed to (or cancelled for) a florist or a driver.
// Called only by database triggers (cdf_push_hook) with the shared x-cdf-hook secret, like cdf-notify.
// Needs the CDF_VAPID_KEYS secret (JSON {publicKey, privateKey} JWKs); without it nothing is sent.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const APP_URL = Deno.env.get("CDF_APP_URL") || "https://pedidos-cdf.netlify.app";
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
  let to: string[] = [], payload: Record<string, string> = {};

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
    payload = {
      title: nameOf(m.author_email) + (order ? " · #" + order.num : " · #team"),
      body: String(m.body).slice(0, 180),
      url: APP_URL + "/?chat=" + (m.order_id || "team"),
      tag: "chat-" + (m.order_id || "team"),
    };
  } else if (body.kind === "direct") {
    // A private chat: the other person in the thread hears it, the author doesn't
    const { data: m } = await service.from("cdf_direct_messages").select("id,direct_id,author_email,body").eq("id", body.id).maybeSingle();
    if (!m) return json({ sent: 0 });
    const { data: th } = await service.from("cdf_direct_threads").select("member_a,member_b").eq("id", m.direct_id).maybeSingle();
    if (!th) return json({ sent: 0 });
    to = [th.member_a, th.member_b].filter((e) => e && e !== m.author_email);
    payload = { title: nameOf(m.author_email), body: String(m.body).slice(0, 180), url: APP_URL + "/?chat=" + m.direct_id, tag: "chat-" + m.direct_id };
  } else if (body.kind === "assigned" && body.to) {
    const { data: o } = await service.from("cdf_orders").select("id,num,date,slot,customer_name").eq("id", body.id).maybeSingle();
    if (!o) return json({ sent: 0 });
    to = [String(body.to).toLowerCase()];
    payload = { title: "New order #" + o.num, body: [o.customer_name, o.date, o.slot].filter(Boolean).join(" · "), url: APP_URL + "/?order=" + o.id, tag: "order-" + o.id };
  } else if (body.kind === "cancelled" && body.to) {
    // Sent by cdf_push_cancelled to the florist and driver it was assigned to. The reason stays in the app.
    const { data: o } = await service.from("cdf_orders").select("id,num,date,slot,cancelled_at").eq("id", body.id).maybeSingle();
    if (!o || !o.cancelled_at) return json({ sent: 0 });
    to = [String(body.to).toLowerCase()];
    payload = { title: "Order #" + o.num + " cancelled", body: "Don't prepare or deliver it · " + [o.date, o.slot].filter(Boolean).join(" · "), url: APP_URL + "/?order=" + o.id, tag: "order-" + o.id };
  } else return json({ error: "kind" }, 400);

  if (!to.length) return json({ sent: 0 });
  const { data: subs } = await service.from("cdf_push_subs").select("*").in("member_email", to);
  let sent = 0, gone = 0;
  for (const s of subs || []) {
    try {
      await app.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }).pushTextMessage(JSON.stringify(payload), PUSH_OPTS);
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
  return json({ sent, gone });
});
