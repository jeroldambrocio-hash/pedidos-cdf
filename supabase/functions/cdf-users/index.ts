// Pedidos CDF: admins add or remove team members (admin / moderator / vendor / carrier) with a password login.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: caller, error: callerErr } = await service.auth.getUser(token);
  if (callerErr || !caller?.user?.email) return json({ error: "Inicia sesión de nuevo" }, 401);
  const { data: me } = await service.from("cdf_members").select("role").eq("email", caller.user.email.toLowerCase()).maybeSingle();
  if (me?.role !== "admin") return json({ error: "Solo un admin puede gestionar usuarios" }, 403);

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Petición no válida" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Email no válido" }, 400);

  if (body.action === "add") {
    const name = String(body.name || "").trim();
    const role = ["admin", "moderator", "vendor", "carrier"].includes(body.role) ? body.role : "vendor";
    const password = String(body.password || "");
    if (!name) return json({ error: "Falta el nombre" }, 400);
    if (password.length < 8) return json({ error: "La contraseña necesita al menos 8 caracteres" }, 400);

    const created = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { cdf: true, name } });
    let existed = false;
    if (created.error) {
      if (!/already|registered|exists/i.test(created.error.message)) return json({ error: created.error.message }, 400);
      existed = true; // account already exists in this project: keep its password, just grant access
    }
    const { error } = await service.from("cdf_members").upsert({ email, name, role });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, existed });
  }

  if (body.action === "remove") {
    if (email === caller.user.email.toLowerCase()) return json({ error: "No puedes quitarte a ti mismo" }, 400);
    const { error } = await service.from("cdf_members").delete().eq("email", email);
    if (error) return json({ error: error.message }, 400);
    // Only delete the login if this app created it; accounts shared with other apps stay.
    const { data: list } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const u = list?.users.find((x) => x.email?.toLowerCase() === email);
    if (u?.user_metadata?.cdf === true) await service.auth.admin.deleteUser(u.id);
    return json({ ok: true });
  }

  return json({ error: "Acción desconocida" }, 400);
});
