// Public order tracking for /p/<code>. The photo buckets are private, so this hands out short-lived links
// to the bouquet and delivery photos, and only the fields the tracking page shows.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let code = "";
  try { code = String((await req.json()).code || ""); } catch { /* empty */ }
  if (!/^[a-z0-9]{6,64}$/i.test(code)) return json({ order: null });

  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: o, error } = await service.from("cdf_orders")
    .select("num,date,slot,status,delivery,delivery_note,updated_at,customer_name,card_message,proof_path,bouquet_path")
    .eq("code", code).maybeSingle();
  if (error) return json({ error: "lookup" }, 500);
  if (!o) return json({ order: null });

  const sign = async (path: string | null) => {
    if (!path) return null;
    const { data } = await service.storage.from("cdf-entregas").createSignedUrl(path, 3600);
    return data?.signedUrl || null;
  };
  const { proof_path, bouquet_path, customer_name, ...rest } = o;
  // Recipient's first name only ("For: Maria")
  return json({ order: { ...rest, for_name: customer_name.trim().split(/\s+/)[0] || "", proof_url: await sign(proof_path), bouquet_url: await sign(bouquet_path) } });
});
