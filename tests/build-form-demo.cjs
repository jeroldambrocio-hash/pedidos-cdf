// Builds the public order form as one HTML file that opens with a double click, for showing it around
// before it is published. There is no server behind it: a small stand-in inside the page answers the
// session, the address search (two fixed places in Quezon City), the photos and the final "send".
// Nothing typed or attached leaves the browser, and the file has no Supabase address or key.
// Run: node tests/build-form-demo.cjs demo-formulario.html
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, ".."), out = path.resolve(process.argv[2] || path.join(root, ".test-tools", "demo-formulario.html"));
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const uri = (f, mime) => `data:${mime};base64,${fs.readFileSync(path.join(root, f)).toString("base64")}`;
const inline = (code) => code.replace(/<\/script/gi, "<\\/script");

const standIn = `
// Demo only: what the server would answer, decided here in the page.
(() => {
  window.CDF_CONFIG = { url: "https://demo.invalid", anonKey: "", features: { publicOrder: true }, publicOrder: { turnstileSiteKey: "" } };
  const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) }; };
  for (const name of ["localStorage", "sessionStorage"]) { try { window[name].getItem("x"); } catch { try { Object.defineProperty(window, name, { value: memory() }); } catch {} } }
  const places = [
    { label: "Katipunan Avenue, Loyola Heights, Quezon City, Metro Manila", lat: 14.6397, lng: 121.0775 },
    { label: "Tomas Morato Avenue, Quezon City, Metro Manila", lat: 14.6337, lng: 121.0342 },
    { label: "Ayala Avenue, Makati, Metro Manila", lat: 14.5547, lng: 121.0244 }];
  const real = window.fetch.bind(window), wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = async (url, init = {}) => {
    if (!String(url).startsWith("https://demo.invalid/")) return real(url, init);
    await wait(350);
    if (String(url).includes("action=upload")) return json({ file: crypto.randomUUID(), width: 0, height: 0, bytes: init.body?.size || 0 });
    const body = JSON.parse(init.body || "{}");
    if (body.action === "session") return json({ session: "demo-session-demo-session-demo-session-0000", expires_in: 7200 });
    if (body.action === "search") { const q = body.query.toLowerCase(); const hit = places.filter((p) => p.label.toLowerCase().includes(q)); return json({ results: hit.length ? hit : places.slice(0, 2) }); }
    if (body.action === "remove") return json({ removed: true });
    if (body.action === "submit") return json({ received: true });
    return json({ error: "invalid" }, 400);
  };
})();`;
const banner = `<div role="note" style="padding:8px 12px;font:500 13px/1.35 system-ui,sans-serif;text-align:center;background:#f5d76e;color:#1a1a1a">DEMO · Fase 2 (formulario público) · sin servidor: nada de lo que escribas o adjuntes sale de tu navegador. La búsqueda devuelve direcciones de ejemplo.</div>`;

let html = read("pedido.html")
  .replace(/<link rel="stylesheet" href="\/styles\.css">/, () => `<style>${read("styles.css")}\n${read("js/vendor/leaflet.css").replace(/url\([^)]*\)/g, "none")}</style>`)
  .replace(/<link rel="(icon|apple-touch-icon)"[^>]*>\n?/g, "")
  .replace(/src="\/img\/(logo(?:-dark)?\.webp)"/g, (_, f) => `src="${uri("img/" + f, "image/webp")}"`)
  .replace(/<script src="\/config\.js"><\/script>/, () => `<script>${standIn}</script><script>${inline(read("js/vendor/leaflet.js"))}</script>`)
  .replace(/<script src="\/((?:i18n|js\/[a-z-]+)\.js)"><\/script>/g, (_, f) => `<script>${inline(read(f))}</script>`)
  .replace(/<title[^>]*>[^<]*<\/title>/, "<title>Formulario de pedido · Demo Fase 2</title>")
  .replace(/<body([^>]*)>/, (m) => m + banner);
if (/(src|href)="\/(?!\/)/.test(html)) throw new Error("something was not inlined");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Form demo: ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
