// Demo: serves the panel with the tests' fake Supabase, so it can be tried in a browser with made-up data
// and nothing reaches the real database. Run: node tests/demo.cjs [port]  →  http://localhost:4324/?role=admin
// Roles: ?role=admin | moderator | vendor | carrier · tracking page: /p/abc123abcd
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const root = path.resolve(__dirname, ".."), port = +process.argv[2] || 4324;
// The fake backend lives in ui-smoke.cjs; ask it to write itself out instead of running the tests
const mockFile = path.join(os.tmpdir(), "pedidos-cdf-demo-mock.js");
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile, NODE_PATH: path.join(root, ".test-tools", "node_modules") }, stdio: "inherit" });
const mock = fs.readFileSync(mockFile, "utf8");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json" };
http.createServer((req, res) => {
  let name = new URL(req.url, "http://x").pathname;
  res.setHeader("Cache-Control", "no-store");
  if (name === "/__mock.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(mock); }
  if (name === "/" || name.startsWith("/p/")) name = name.startsWith("/p/") ? "/seguimiento.html" : "/index.html";
  const f = path.resolve(root, "." + decodeURIComponent(name));
  if (!f.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", types[path.extname(f)] || "text/plain");
    // The real supabase-js is swapped for the fake one; the role comes from ?role=
    if (f.endsWith(".html")) buf = String(buf).replace(/<script src="https:\/\/cdn\.jsdelivr[^>]*supabase[^>]*><\/script>/,
      `<script>window.__role=new URLSearchParams(location.search).get("role")||"admin"</script><script src="/__mock.js"></script>`);
    // The tracking page asks the cdf-track function directly: answer with a made-up order (same as the tests)
    if (f.endsWith("seguimiento.html")) buf = String(buf).replace('<script src="/config.js"></script>', `<script>
const realFetch = window.fetch;
window.fetch = (u, o) => !String(u).includes("/functions/v1/cdf-track") ? realFetch(u, o) : Promise.resolve(new Response(JSON.stringify({ order: {
  num: "0124", date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()), slot: "8:00 - 12:00",
  status: "Ready", delivery: "In transit", delivery_note: "", updated_at: new Date().toISOString(), for_name: "Maria",
  card_message: "Happy birthday, Maria!", bouquet_url: "/img/emblem.webp", proof_url: null } }), { headers: { "Content-Type": "application/json" } }));
</script><script src="/config.js"></script>`);
    res.end(buf);
  });
}).listen(port, "127.0.0.1", () => console.log("Demo: http://localhost:" + port + "/?role=admin"));
