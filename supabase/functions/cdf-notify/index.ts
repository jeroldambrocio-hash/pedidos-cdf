// Pedidos CDF email sender.
// 1) Vendor alert: called by the database trigger cdf_orders_notify (migration 005) with a secret kept in Vault.
// 2) Customer email: called from the admin panel (signed-in admin) with the message already written.
// Every attempt is logged in cdf_notifications (migration 006).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.14";

const APP_URL = Deno.env.get("CDF_APP_URL") || "https://pedidos-cdf.netlify.app";
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

// Gmail (app password) if configured, otherwise Resend
async function sendMail(to: string, subject: string, html: string, text: string): Promise<Sent> {
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

const plainHtml = (text: string) =>
  `<!doctype html><html><body style="margin:0;background:#f6f3ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2622">
<div style="max-width:480px;margin:0 auto;padding:28px 18px">
  <p style="margin:0 0 14px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#a0705a">Casa de Flores</p>
  <p style="margin:0;font-size:15px;line-height:1.55;white-space:pre-wrap">${esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#13302a">$1</a>')}</p>
</div></body></html>`;

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

  // ---------- customer email, sent by a signed-in admin from the panel ----------
  if (payload.action === "customer") {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await service.auth.getUser(token);
    const me = u?.user?.email?.toLowerCase();
    const { data: who } = me ? await service.from("cdf_members").select("role").eq("email", me).maybeSingle() : { data: null };
    if (who?.role !== "admin") return json({ error: "unauthorized" }, 401);

    const { data: o } = await service.from("cdf_orders").select("id,customer_email").eq("id", orderId).maybeSingle();
    const to = String(o?.customer_email || "").trim();
    if (!to) return json({ error: "no customer email" }, 400);
    const subject = String(payload.subject || "Casa de Flores").slice(0, 200);
    const text = String(payload.text || "").slice(0, 4000);
    const sent = await sendMail(to, subject, plainHtml(text), text);
    await log({ order_id: orderId, audience: "customer", channel: "email", recipient: to, ok: sent.ok, by_email: me,
      detail: sent.ok ? `${sent.via}: ${String(payload.label || "")}` : `${sent.via}: ${sent.error}` });
    return json(sent, sent.ok ? 200 : 502);
  }

  // ---------- vendor alert, from the database trigger ----------
  const { data: ok } = await service.rpc("cdf_hook_ok", { p_secret: req.headers.get("x-cdf-hook") || "" });
  if (ok !== true) return json({ error: "unauthorized" }, 401);

  const { data: o } = await service.from("cdf_orders").select("*").eq("id", orderId).maybeSingle();
  if (!o?.vendor_email) return json({ skipped: "no vendor" });
  const { data: m } = await service.from("cdf_members").select("email,name").eq("email", o.vendor_email).maybeSingle();
  if (!m) return json({ skipped: "no member" });

  const when = `${fmtDate(o.date)} · ${o.slot}`;
  const rows = [
    ["When", when],
    ["Customer", o.customer_name],
    ["Address", o.address],
    ["Notes", o.notes],
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
  await log({ order_id: o.id, audience: "vendor", channel: "email", recipient: m.email, ok: sent.ok,
    detail: sent.ok ? `${sent.via}: assigned` : `${sent.via}: ${sent.error}` });
  return json(sent, sent.ok ? 200 : 502);
});
