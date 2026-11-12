// cdf-order-purge: the owner deletes an order for good, and its files leave storage. The behaviour is in
// handler.ts (tested without Deno); this file plugs in the owner's sign-in, the service role and storage.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { purge } from "./handler.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!, auth = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/.test(auth)) return json({ error: "cdf_owner_only" }, 401);
  const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid" }, 400); }
  const r = await purge({
    asUser: async (name, args) => { const { data, error } = await user.rpc(name, args); return { data, error }; },
    rpc: async (name, args) => { const { data, error } = await service.rpc(name, args); return { data, error }; },
    remove: async (bucket, paths) => { const { error } = await service.storage.from(bucket).remove(paths); return { error }; },
    log: (...a) => console.error(...a),
  }, body);
  return json(r.body, r.status);
});
