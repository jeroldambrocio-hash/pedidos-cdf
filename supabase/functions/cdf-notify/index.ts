// Pedidos CDF email sender.
// 1) Vendor alert: called by the database trigger cdf_orders_notify (migration 005) with a secret kept in Vault.
// 2) Customer email: called from the panel by the admin with the message already written.
// 3) Automatic customer email when an order goes In transit: called by the trigger cdf_orders_transit (migration 007).
// Every attempt is logged in cdf_notifications (migration 006). Customer emails use the branded template in email.ts.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.14";
import { customerEmail, stepOf } from "./email.ts";
import { formatSlot12 } from "../_shared/time.ts";
import { emailResult } from "./result.ts";

const APP_URL = Deno.env.get("CDF_APP_URL") || "https://casadeflores-store.netlify.app";
const FROM = Deno.env.get("CDF_MAIL_FROM") || "Casa de Flores <onboarding@resend.dev>";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const fmtDate = (d: string) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

type Sent = { ok: true; via: string; id: string } | { ok: false; via: string; error: string };

// The shop's own mailbox over SMTP (Hostinger: smtp.hostinger.com, 465) if configured, then Gmail (app password), then Resend
async function sendMail(to: string, subject: string, html: string, text: string): Promise<Sent> {
  const sUser = Deno.env.get("SMTP_USER"), sPass = Deno.env.get("SMTP_PASS");
  if (sUser && sPass) {
    // Port 465 (SSL): Supabase Edge Functions block outbound 25 and 587
    const port = Number(Deno.env.get("SMTP_PORT") || 465);
    const smtp = nodemailer.createTransport({ host: Deno.env.get("SMTP_HOST") || "smtp.hostinger.com", port, secure: port === 465, auth: { user: sUser, pass: sPass } });
    try {
      const info = await smtp.sendMail({ from: `${Deno.env.get("SMTP_FROM_NAME") || "Casa de Flores"} <${sUser}>`, to, subject, html, text });
      return { ok: true, via: "smtp", id: info.messageId };
    } catch (e) {
      return { ok: false, via: "smtp", error: String((e as Error)?.message || e) };
    }
  }
  const gUser = Deno.env.get("GMAIL_USER"), gPass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (gUser && gPass) {
    // Port 465: Supabase Edge Functions block outbound 25 and 587
    const smtp = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: gUser, pass: gPass.replace(/\s/g, "") } });
    try {
      const info = await smtp.sendMail({ from: `Casa de Flores <${gUser}>`, to, subject, html, text });
      return { ok: true, via: "gmail", id: info.messageId };
    } catch (e) {
      return { ok: false, via: "gmail", error: String((e as Error)?.message || e) };
    }
  }
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, via: "none", error: "no mail provider configured" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  });
  const out = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, via: "resend", id: out.id } : { ok: false, via: "resend", error: out?.message || `HTTP ${r.status}` };
}

type Svc = ReturnType<typeof createClient>;
// The branded customer email for an order, worded for the step it is on right now
async function orderEmail(service: Svc, o: Record<string, any>, message?: string) {
  return customerEmail({
    appUrl: APP_URL, num: String(o.num), step: stepOf(o.status, o.delivery),
    // The email goes to the buyer; greet the buyer, or the recipient when they are the same person
    name: o.buyer_name || o.customer_name || "",
    // Tracking is switched off unless the secret CDF_TRACKING=on: the email then has no "View my order" button
    link: Deno.env.get("CDF_TRACKING") === "on" ? `${APP_URL}/p/${o.code}` : "", photoUrl: null /* bouquet photo dropped on 8/11/2026 */, message,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const log = (row: Record<string, unknown>) => service.from("cdf_notifications").insert(row);

  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { /* empty */ }
  const orderId = String(payload.order_id || "");
  if (!orderId) return json({ error: "order_id" }, 400);

  // ---------- customer email, sent from the panel ----------
  if (payload.action === "customer") {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await service.auth.getUser(token);
    const me = u?.user?.email?.toLowerCase();
    const { data: who } = me ? await service.from("cdf_members").select("role").eq("email", me).maybeSingle() : { data: null };
    const { data: o } = await service.from("cdf_orders").select("id,customer_email,num,code,status,delivery,buyer_name,customer_name,bouquet_path").eq("id", orderId).maybeSingle();
    // Free-text email from the shop's address: the admin only. Florists and drivers notify through
    // WhatsApp from their phone, and the automatic In transit email covers the rest.
    const allowed = who?.role === "admin";
    if (!allowed) return json({ error: "unauthorized" }, 403);
    if (!o) return json({ error: "no order" }, 404);

    const to = String(o?.customer_email || "").trim();
    if (!to) return json({ error: "no customer email" }, 400);
    const text = String(payload.text || "").slice(0, 4000);
    const mail = await orderEmail(service, o, text);
    const subject = String(payload.subject || mail.subject).slice(0, 200);
    const sent = await sendMail(to, subject, mail.html, mail.text);
    await log({ order_id: orderId, audience: "customer", channel: "email", recipient: to, ok: sent.ok, by_email: me, subject, message: text,
      detail: sent.ok ? `${sent.via}: ${String(payload.label || "")}` : `${sent.via}: ${sent.error}` });
    return json(sent, sent.ok ? 200 : 502);
  }

  // ---------- from the database triggers: automatic customer email, or vendor alert ----------
  const { data: ok } = await service.rpc("cdf_hook_ok", { p_secret: req.headers.get("x-cdf-hook") || "" });
  if (ok !== true) return json({ error: "unauthorized" }, 401);
  const finish = async (result: Record<string, unknown>) => {
    const answer = await emailResult(service, payload.outbox, result);
    return json(answer.body, answer.status);
  };
  if (payload.outbox) {
    const queued = await service.from("cdf_outbox").select("kind,ref_id,delivered_at").eq("id", Number(payload.outbox)).maybeSingle();
    if (queued.error) return json({ error: "email_queue_lookup_failed" }, 503);
    if (!queued.data || queued.data.kind !== "email" || queued.data.ref_id !== orderId) return json({ error: "email_queue_invalid" }, 400);
    if (queued.data.delivered_at) return json({ skipped: "already delivered" });
  }

  const { data: o, error: orderError } = await service.from("cdf_orders").select("*").eq("id", orderId).maybeSingle();
  if (orderError) return json({ error: "email_order_lookup_failed" }, 503);
  if (!o || o.cancelled_at || o.deleted_at) return finish({ skipped: "order unavailable" });

  if (payload.action === "auto_transit") {
    const to = String(o.customer_email || "").trim();
    if (!to) return finish({ skipped: "no customer email" });
    // Worded from the order's state when the email goes out, so it never says "on its way" before it is
    const { subject, html, text } = await orderEmail(service, o);
    const sent = await sendMail(to, subject, html, text);
    await log({ order_id: o.id, audience: "customer", channel: "email", recipient: to, ok: sent.ok, subject, message: text,
      detail: sent.ok ? `${sent.via}: automatic, In transit` : `${sent.via}: ${sent.error}` });
    return finish(sent);
  }

  if (!o.vendor_email || payload.to && payload.to !== o.vendor_email) return finish({ skipped: "assignment changed" });
  const { data: m, error: memberError } = await service.from("cdf_members").select("email,name").eq("email", o.vendor_email).maybeSingle();
  if (memberError) return json({ error: "email_member_lookup_failed" }, 503);
  if (!m) return finish({ skipped: "no member" });
  // Accounts made with a placeholder address on the shop's domain (no mailbox behind it, 9/11/2026):
  // no email, they see their orders in the app. Giving them their real address turns the alert back on.
  const shopBox = (Deno.env.get("SMTP_USER") || "").toLowerCase();
  if (/@casadeflores\.store$/i.test(m.email) && m.email.toLowerCase() !== shopBox) return finish({ skipped: "placeholder address" });

  const when = `${fmtDate(o.date)} · ${formatSlot12(o.slot)}`;
  const rows = [
    ["When", when],
    ["Customer", o.customer_name],
    ["Address", o.address],
    ["Notes", o.notes],
    ["Card", o.card_message],
  ].filter(([, v]) => v);

  const html = `<!doctype html><html><body style="margin:0;background:#f6f3ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2622">
<div style="max-width:480px;margin:0 auto;padding:28px 18px">
  <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#a0705a">Casa de Flores</p>
  <h1 style="margin:0 0 6px;font-size:22px">New delivery for you, ${esc(m.name)}</h1>
  <p style="margin:0 0 20px;color:#6b625b">Order #${esc(o.num)} has been assigned to you.</p>
  <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden">
    ${rows.map(([k, v]) => `<tr><td style="padding:12px 14px;border-bottom:1px solid #eee;color:#8a8079;font-size:13px;width:90px;vertical-align:top">${k}</td><td style="padding:12px 14px;border-bottom:1px solid #eee;font-size:15px">${esc(v)}</td></tr>`).join("")}
  </table>
  <p style="margin:24px 0"><a href="${APP_URL}" style="display:inline-block;background:#d9734e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Open my orders</a></p>
  <p style="margin:0;font-size:12px;color:#a39a93">You get this email because you're on the Casa de Flores delivery team.</p>
</div></body></html>`;

  const text = [`New delivery for you, ${m.name}`, `Order #${o.num}`, ...rows.map(([k, v]) => `${k}: ${v}`), "", `Open my orders: ${APP_URL}`].join("\n");

  const subject = `New delivery: Order #${o.num} · ${when}`;
  const sent = await sendMail(m.email, subject, html, text);
  await log({ order_id: o.id, audience: "vendor", channel: "email", recipient: m.email, ok: sent.ok, subject, message: text,
    detail: sent.ok ? `${sent.via}: assigned` : `${sent.via}: ${sent.error}` });
  return finish(sent);
});
