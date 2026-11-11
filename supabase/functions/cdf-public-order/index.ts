// Public order form: the edge function. All the behaviour is in handler.ts (tested without Deno); this
// file only plugs in the real things: the service-role client, the private bucket and the clock.
// Secrets: PUBLIC_ORDER=on (off otherwise), PUBLIC_ORDER_ORIGINS (sites allowed to call, comma separated),
// TURNSTILE_SECRET (anti-abuse check), PUBLIC_ORDER_SALT (to hash addresses), PUBLIC_GEOCODER_URL (optional).
// Address search: GOOGLE_MAPS_KEY (the same one cdf-lalamove uses) up to PUBLIC_GOOGLE_DAILY searches a day
// (150 if unset, 0 to never use Google); beyond that, or without the key, the free map search.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { handle } from "./handler.ts";

const BUCKET = "cdf-solicitudes";
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");

Deno.serve((req) => {
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  return handle(req, {
    env: (name) => Deno.env.get(name),
    now: () => Date.now(),
    randomToken: () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    sha256: async (v) => hex(await crypto.subtle.digest("SHA-256", typeof v === "string" ? new TextEncoder().encode(v) : v)),
    rpc: async (name, args) => { const { data, error } = await service.rpc(name, args); return { data, error }; },
    store: (path, bytes, mime) => service.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false }),
    unstore: (paths) => service.storage.from(BUCKET).remove(paths),
    fetch,
  });
});
