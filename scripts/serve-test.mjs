// Test copy only: serves this folder like Netlify does, but /config.js points at the Supabase running on THIS PC
// (scripts/supabase-local.sh) instead of production. config.js itself is never changed.
//   node scripts/serve-test.mjs                       → http://localhost:4334
//   CDF_TEST_API=https://xxxx.trycloudflare.com node scripts/serve-test.mjs   (when shared through a tunnel)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve, relative, isAbsolute } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const port = Number(process.env.PORT || 4334);
const env = (() => {
  try {
    return Object.fromEntries(readFileSync(join(root, ".secrets/local-supabase.env"), "utf8").split(/\r?\n/).filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
  } catch { return {}; }   // only the server needs it (checked below); the tests import servable() alone
})();
const api = process.env.CDF_TEST_API || env.API_URL || "";
if (/nskbtxagdkvkxqneoucv/.test(api)) throw new Error("Refusing to point the test copy at production");

// The demo's own Google Maps browser key (Google Cloud → "CDF demo navegador": only localhost:4334/4335 and
// *.trycloudflare.com, Maps JavaScript + Places New), so the live web's key is never opened to tunnels.
// Read on every request: saving the file is enough, no restart. Without it, the real key stays (and Google refuses it here).
function demoMapsKey() {
  try { const k = readFileSync(join(root, ".secrets/demo-maps-key.txt"), "utf8").trim(); return /^AIza[0-9A-Za-z_-]{30,}$/.test(k) ? k : null; } catch { return null; }
}
// The real config, with the test Supabase, Cloudflare's always-pass Turnstile test key and no push key
function testConfig() {
  const real = readFileSync(join(root, "config.js"), "utf8"), mapsKey = demoMapsKey();
  return (mapsKey ? real.replace(/googleMapsKey: "[^"]*"/g, `googleMapsKey: ${JSON.stringify(mapsKey)}`) : real)
    .replace(/url: "https:\/\/[a-z0-9]+\.supabase\.co"/, `url: ${JSON.stringify(api)}`)
    .replace(/anonKey: "[^"]+"/, `anonKey: ${JSON.stringify(env.ANON_KEY)}`)
    .replace(/vapidPublicKey: "[^"]+"/, 'vapidPublicKey: ""')
    .replace(/turnstileSiteKey: "[^"]+"/, 'turnstileSiteKey: "1x00000000000000000000AA"')
    .replace("paymongo: false", "paymongo: true")
    + `\n// TEST COPY: this config was rewritten by scripts/serve-test.mjs → ${api}\nwindow.CDF_CONFIG.testCopy = true;\n`;
}
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2" };
// Never served, whatever the letters' case (Windows ignores it) or the way the path is written: anything under a
// folder or file starting with "." (.secrets, .git, .env…), Windows short names (SECRET~1), the server-side and
// test folders, and any file type the site does not use. This server may be shared through a public tunnel.
const HIDDEN = new Set(["supabase", "scripts", "tests", "node_modules", ".test-tools"]);
export function servable(rootDir, path) {
  const file = resolve(join(rootDir, path));
  const rel = relative(rootDir, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => p.startsWith(".") || p.includes("~") || p.includes(":")) || HIDDEN.has(parts[0].toLowerCase())) return null;
  if (!types[extname(file).toLowerCase()]) return null;
  return file;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  if (!api || !env.ANON_KEY) throw new Error("Start the local Supabase first: bash scripts/supabase-local.sh (.secrets/local-supabase.env is missing)");
  createServer((req, res) => {
    let path;
    try { path = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400); return res.end("Bad request"); }
    if (path === "/config.js") { res.writeHead(200, { "Content-Type": types[".js"], "Cache-Control": "no-store" }); return res.end(testConfig()); }
    if (path === "/") path = "/index.html";
    else if (/^\/p\/[^/]+$/.test(path)) path = "/seguimiento.html";
    const file = servable(root, path);
    if (!file || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": types[extname(file).toLowerCase()], "Cache-Control": "no-cache" });
    res.end(readFileSync(file));
  }).listen(port, () => console.log(`Test copy on http://localhost:${port} → Supabase ${api}`));
}
