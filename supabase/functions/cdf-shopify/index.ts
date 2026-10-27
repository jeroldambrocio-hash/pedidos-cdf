// Shopify → Pedidos CDF: the "orders/create" webhook adds the order to the panel, unassigned and Preparing,
// so nobody has to type it from a screenshot. Deploy with --no-verify-jwt (Shopify can't send a Supabase token);
// the request is proven by Shopify's HMAC signature instead (secret SHOPIFY_WEBHOOK_SECRET).
// Delivery date and time come from the order's note attributes when the shop collects them; otherwise the
// order lands on the day it was placed with a 9:00 - 12:00 slot and a note asking the team to check it.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const manilaDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

async function validSignature(raw: string, header: string | null, secret: string) {
  if (!header || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

type Attr = { name: string; value: string };
const attr = (list: Attr[], re: RegExp) => list.find((a) => re.test(a.name))?.value?.trim() || "";
// "2026-11-05", "05/11/2026" or "November 5, 2026" → "2026-11-05"
function toIsoDate(v: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const d = new Date(v);
  return isNaN(+d) ? "" : manilaDay(d);
}
// "10:00 - 12:00", "10am-12pm", "10:00 AM – 12:00 PM" → "10:00 - 12:00"
function toSlot(v: string) {
  const times = [...v.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi)].map((m) => {
    let h = +m[1]; const min = m[2] || "00", ap = (m[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
    return `${h}:${min}`;
  });
  return times.length >= 2 ? `${times[0]} - ${times[1]}` : "";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("x-shopify-hmac-sha256"), Deno.env.get("SHOPIFY_WEBHOOK_SECRET") || ""))) return json({ error: "signature" }, 401);
  if ((req.headers.get("x-shopify-topic") || "orders/create") !== "orders/create") return json({ skipped: "topic" });

  let o: Record<string, any>;
  try { o = JSON.parse(raw); } catch { return json({ error: "body" }, 400); }
  const attrs: Attr[] = o.note_attributes || [];
  const ship = o.shipping_address || {}, cust = o.customer || {};
  const buyer = [cust.first_name, cust.last_name].filter(Boolean).join(" ") || o.billing_address?.name || "";
  const date = toIsoDate(attr(attrs, /deliver.*date|fecha|date/i)) || manilaDay(new Date(o.created_at || Date.now()));
  const slotRaw = attr(attrs, /time|hora|slot|franja/i);
  const slot = toSlot(slotRaw) || "9:00 - 12:00";
  const checkNote = toSlot(slotRaw) && attr(attrs, /deliver.*date|fecha|date/i) ? "" : " · Revisa la fecha y la hora de entrega.";
  const items = (o.line_items || []).map((li: any) => `${li.quantity}× ${li.title}${li.variant_title ? " (" + li.variant_title + ")" : ""}`).join("\n");

  const row = {
    num: "SH-" + (o.order_number ?? o.name ?? o.id),
    date, slot, channel: "Shopify", status: "Preparing", delivery: "-",
    buyer_name: buyer, buyer_phone: cust.phone || o.phone || o.billing_address?.phone || "",
    customer_email: String(o.email || cust.email || "").toLowerCase(),
    customer_name: ship.name || buyer, customer_phone: ship.phone || cust.phone || "",
    address: [ship.address1, ship.address2, ship.city, ship.province].filter(Boolean).join(", "),
    card_message: attr(attrs, /card|tarjeta|message|mensaje/i) || String(o.note || "").trim(),
    notes: `Importado de Shopify ${o.name || ""}${checkNote}${items ? "\n" + items : ""}`.trim(),
  };

  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // Shopify retries webhooks: the order number is unique, so a repeat is simply ignored
  const { error } = await service.from("cdf_orders").upsert(row, { onConflict: "num", ignoreDuplicates: true });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, num: row.num });
});
