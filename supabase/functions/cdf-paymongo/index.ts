// PayMongo for requests: the edge function. The behaviour is in handler.ts; this file plugs in the real things.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handle } from "./handler.ts";

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve((req) => handle(req, {
  env: (k) => Deno.env.get(k),
  now: () => Date.now(),
  randomToken: () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  sha256: async (v) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))),
  hmac: async (secret, data) => {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  },
  service: async (name, args) => { const { data, error } = await service.rpc(name, args); return { data, error }; },
  asUser: (authorization) => {
    const user = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
    return async (name, args) => { const { data, error } = await user.rpc(name, args); return { data, error }; };
  },
  fetch,
}));
