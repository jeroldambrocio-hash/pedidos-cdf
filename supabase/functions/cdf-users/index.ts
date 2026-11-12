// Pedidos CDF: admins add or remove team members (admin / florist (vendor) / driver (carrier)) with a password login.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handleUsers } from "./handler.ts";

Deno.serve((req) => handleUsers(req, {
  service: createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } }),
  env: (name) => Deno.env.get(name),
}));
