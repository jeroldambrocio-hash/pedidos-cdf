// Web push for the installed app (iPhone 16.4+ from the home screen, Android): chat messages that mention
// someone or happen on their order, private messages, orders handed to (or cancelled for) a florist or a driver,
// and new requests from the public order form (to the admins).
// Called only by database triggers (cdf_push_hook) with the shared x-cdf-hook secret, like cdf-notify.
// Needs the CDF_VAPID_KEYS secret (JSON {publicKey, privateKey} JWKs); without it nothing is sent.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import * as webpush from "jsr:@negrel/webpush@0.5.0";
import { handlePush } from "./handler.ts";

const APP_URL = Deno.env.get("CDF_APP_URL") || "https://casadeflores-store.netlify.app";
const CONTACT = Deno.env.get("CDF_PUSH_CONTACT") || "mailto:jerold.ambrocio@gmail.com";

let appServer: webpush.ApplicationServer | null = null;
async function server() {
  if (appServer) return appServer;
  const raw = Deno.env.get("CDF_VAPID_KEYS");
  if (!raw) return null;
  const vapidKeys = await webpush.importVapidKeys(JSON.parse(raw), { extractable: false });
  appServer = await webpush.ApplicationServer.new({ contactInformation: CONTACT, vapidKeys });
  return appServer;
}
// High urgency: without it iPhones may hold a "normal" push for a while to save battery (seen: ~20 s).
// A notice that is a day old is no longer worth showing, so the push service drops it after 24 h.
const PUSH_OPTS = { urgency: webpush.Urgency.High, ttl: 24 * 3600 };

Deno.serve((req) => handlePush(req, {
  service: createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } }),
  server, pushOpts: PUSH_OPTS, appUrl: APP_URL,
}));
