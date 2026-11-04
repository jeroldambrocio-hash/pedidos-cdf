// Resolve a CDF username on the server; never expose an email lookup to anonymous clients.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
export async function handleLogin(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    const username = String(body.username || "").trim().toLowerCase(), password = String(body.password || "");
    const denied = () => json({ error: "Invalid credentials" }, 401);
    if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username) || !password || password.length > 4096) return denied();
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    // Shared across all function instances; unknown usernames take the same path and quota.
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(username));
    const key = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const quota = await service.rpc("cdf_login_attempt", { p_key: key });
    if (quota.error || quota.data !== true) return denied();
    const { data: member, error } = await service.from("cdf_members").select("email").eq("username", username).maybeSingle();
    if (error) return denied();
    const auth = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    // The dummy address keeps missing users on the password-authentication path.
    const login = await auth.auth.signInWithPassword({ email: member?.email || "cdf-missing-" + key + "@invalid.invalid", password });
    if (!member || login.error || !login.data.session) return denied();
    return json({ access_token: login.data.session.access_token, refresh_token: login.data.session.refresh_token });
  } catch { return json({ error: "Invalid credentials" }, 401); }
}
Deno.serve(handleLogin);
