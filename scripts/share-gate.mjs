// Test copy only: the door between the public Cloudflare link and the local Supabase (scripts/share-test.sh).
// The local Supabase signs its keys with the CLI's well-known default secret, and its gateway also serves admin
// tools (database meta, GraphQL, auth admin). Through a public link that is too much, so this gate lets through only
// what the app and PayMongo use, and never a service-role (admin) key:
//   /rest/v1  /auth/v1 (not /auth/v1/admin)  /storage/v1  /realtime/v1 (WebSocket)  /functions/v1
//   PORT=54331 node scripts/share-gate.mjs   → forwards to http://127.0.0.1:54321
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { resolve } from "node:path";

const TARGET_PORT = 54321;
const ALLOWED = ["/rest/v1/", "/auth/v1/", "/storage/v1/", "/realtime/v1/", "/functions/v1/"];
const ROLES = new Set(["anon", "authenticated"]);

// The role inside a Supabase key or session token (a JWT), or null if it is not one
function roleOf(token) {
  try {
    const part = String(token).split(".")[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).role ?? null;
  } catch { return null; }
}

// Why a request is refused, or null when it may pass
export function refusal(method, url, headers) {
  let u;
  try { u = new URL(url, "http://gate"); } catch { return "bad url"; }
  const path = decodeURIComponent(u.pathname);
  if (path.includes("..") || path.includes("\\")) return "bad path";
  if (!ALLOWED.some((p) => path.startsWith(p))) return "path not shared";
  if (/^\/auth\/v1\/admin(\/|$)/i.test(path)) return "auth admin";
  const tokens = [headers.apikey, u.searchParams.get("apikey"),
    String(headers.authorization || "").replace(/^Bearer\s+/i, "")].filter(Boolean);
  for (const t of tokens) {
    const role = roleOf(t);
    if (role !== null && !ROLES.has(role)) return `role ${role}`;
    if (role === null && /^sb_secret_/.test(t)) return "secret key";
  }
  return null;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
if (isMain) {
  const port = Number(process.env.PORT || 54331);
  const server = createServer((req, res) => {
    const why = refusal(req.method, req.url, req.headers);
    if (why) { res.writeHead(403, { "Content-Type": "text/plain" }); return res.end("Not shared"); }
    const up = request({ host: "127.0.0.1", port: TARGET_PORT, method: req.method, path: req.url,
      headers: { ...req.headers, host: `127.0.0.1:${TARGET_PORT}` } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end("Local Supabase not reachable"); });
    req.pipe(up);
  });
  // Realtime (live updates) is a WebSocket: check it the same way, then join the two raw connections
  server.on("upgrade", (req, socket, head) => {
    if (refusal(req.method, req.url, req.headers)) { socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    const up = connect(TARGET_PORT, "127.0.0.1", () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        lines.push(`${k}: ${k.toLowerCase() === "host" ? `127.0.0.1:${TARGET_PORT}` : req.rawHeaders[i + 1]}`);
      }
      up.write(lines.join("\r\n") + "\r\n\r\n"); if (head?.length) up.write(head);
      up.pipe(socket); socket.pipe(up);
    });
    up.on("error", () => socket.destroy()); socket.on("error", () => up.destroy());
  });
  server.listen(port, "127.0.0.1", () => console.log(`Share gate on http://127.0.0.1:${port} → local Supabase :${TARGET_PORT}`));
}
