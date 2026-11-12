// Builds a self-contained copy of the panel that runs on made-up data: the tests' fake Supabase replaces
// supabase-js, config.js points nowhere, and every path is relative so the folder works from any address
// (a static host, a sub-folder, a shared preview). Nothing in it can reach the real database.
// Run: node tests/build-demo.cjs [out-folder]   (default .test-tools/demo, ignored by git)
//      node tests/build-demo.cjs [out-folder] --single demo.html   also writes everything into one HTML file
//      that opens with a double click (images inlined; the map picker is left out, it needs map tiles).
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const root = path.resolve(__dirname, ".."), args = process.argv.slice(2), at = args.indexOf("--single");
const single = at >= 0 ? path.resolve(args.splice(at, 2)[1]) : null;
const out = path.resolve(args[0] || path.join(root, ".test-tools", "demo"));

const mockFile = path.join(os.tmpdir(), "pedidos-cdf-demo-mock.js");
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile, NODE_PATH: path.join(root, ".test-tools", "node_modules") }, stdio: "inherit" });

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const relative = (text) => text.replace(/(["'`(])\/(img|js)\//g, "$1$2/").replace(/"\/version\.json/g, '"version.json');
const copy = (from, to = from) => {
  const src = path.join(root, from), dest = path.join(out, to);
  if (fs.statSync(src).isDirectory()) { for (const f of fs.readdirSync(src)) copy(path.join(from, f), path.join(to, f)); return; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (/\.(js|css)$/.test(src) && !/vendor/.test(src)) fs.writeFileSync(dest, relative(fs.readFileSync(src, "utf8")));
  else fs.copyFileSync(src, dest);
};
["styles.css", "i18n.js", "js", "img"].forEach((f) => copy(f));
fs.writeFileSync(path.join(out, "__mock.js"), relative(fs.readFileSync(mockFile, "utf8")));
fs.writeFileSync(path.join(out, "version.json"), '{"v":"demo"}\n');
// Same switches as the published panel, but no project address and no key
const features = /features:\s*(\{[^}]*\})/.exec(fs.readFileSync(path.join(root, "config.js"), "utf8"))?.[1] || "{}";
fs.writeFileSync(path.join(out, "config.js"), `window.CDF_CONFIG = { url: "https://demo.invalid", anonKey: "demo", bucket: "cdf-fotos", vapidPublicKey: "", feedbackTo: "", features: ${features} };\n`);

const setup = `<script>
// Demo: made-up data only. Storage may be unavailable where this is embedded; keep it in memory then.
(() => {
  const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), clear: () => m.clear() }; };
  for (const name of ["localStorage", "sessionStorage"]) {
    try { window[name].setItem("__t", "1"); window[name].removeItem("__t"); }
    catch { try { Object.defineProperty(window, name, { value: memory(), configurable: true }); } catch {} }
  }
  try { if (!localStorage.getItem("cdf-lang")) localStorage.setItem("cdf-lang", "en"); if (!localStorage.getItem("cdf-prices")) localStorage.setItem("cdf-prices", "on"); } catch {}
  try { delete Navigator.prototype.serviceWorker; } catch {}
  window.__role = "admin"; window.__paymentDemo = true; window.__owner = true;
  // Requests from the public form, both types, and one accepted whose order was deleted (like R2 → #0007)
  const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  let ref = 0;
  const R = (x) => ({ id: "req-" + (++ref), ref, request_key: "k" + ref, status: "received", lang: "en", buyer_name: "Jose Santos", buyer_phone: "+34612345678",
    receiver_name: "Maria Santos", receiver_phone: "+639171234567", mode: "delivery", date: day(1), slot: "11:00 - 13:00",
    address: "Unit 4B, Tower 2, 123 Katipunan Ave, Loyola Heights, Quezon City", lat: 14.6397, lng: 121.0775, location_source: "search",
    location_confirmed_at: new Date().toISOString(), description: "A dozen red roses, wrapped in kraft paper", special_requests: "", card_message: "Happy birthday!",
    payment_method: "gcash", created_at: new Date(Date.now() - ref * 37 * 60e3).toISOString(), reviewed_by: null, reject_reason: null,
    accepted_order_id: null, accepted_key: null, pickup_branch: null, accepted_order_num: null, ...x });
  const pick = { mode: "pickup", address: "", lat: null, lng: null, location_source: null, location_confirmed_at: null, pickup_branch: "Quezon City" };
  window.__requests = [R({}), R({ ...pick, buyer_name: "Liza Cruz", receiver_name: "Ana Cruz", slot: "15:00 - 17:00", description: "Sunflower bouquet" }),
    R({ receiver_name: "Jose Santos", date: day(2), address: "45 Ortigas Ave, Pasig" }),
    R({ ...pick, buyer_name: "Kober Mananlo", receiver_name: "Kober Mananlo", status: "accepted", accepted_key: "x", accepted_order_num: "0007" }),
    R({ status: "rejected", reject_reason: "Out of stock that day" })];
  window.__ana = { branch: "Quezon City", pickup_address: "12 Visayas Ave, Quezon City", pickup_lat: 14.6538, pickup_lng: 121.045 };
})();
</script><script src="__mock.js"></script>`;
const banner = `<div role="note" style="position:sticky;top:0;z-index:5;padding:6px 12px;font:500 13px/1.3 system-ui,sans-serif;text-align:center;background:#f5d76e;color:#1a1a1a">DEMO · Papelera y Pickup/Delivery · datos ficticios: nada de lo que hagas aquí llega a Supabase, Lalamove ni a clientes</div>`;
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const cdn = /<script src="https:\/\/cdn\.jsdelivr[^>]*supabase[^>]*><\/script>/;
if (!cdn.test(html)) throw new Error("supabase-js tag not found in index.html");
html = html.replace(cdn, setup)
  .replace(/<link rel="manifest"[^>]*>\n?/, "")
  .replace(/(href|src)="\/(?!\/)/g, '$1="')
  .replace(/<title>[^<]*<\/title>/, "<title>Pedidos CDF · Demo papelera y tipos</title>")
  .replace(/<body([^>]*)>/, `<body$1>${banner}`);
fs.writeFileSync(path.join(out, "index.html"), html);

const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(path.relative(out, p)); } })(out);
const left = files.filter((f) => /\.(js|css|html)$/.test(f) && !/vendor|__mock/.test(f)).filter((f) => /(["'`(])\/(img|js|styles|config|i18n)/.test(fs.readFileSync(path.join(out, f), "utf8")));
if (left.length) throw new Error("absolute paths left in: " + left.join(", "));
console.log(`Demo built: ${out} (${files.length} files)`);

if (single) {
  const mime = { ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
  const images = Object.fromEntries(files.filter((f) => f.startsWith("img" + path.sep) && mime[path.extname(f)] && !/icon-|apple-touch|logo(-dark)?\.png/.test(f))
    .map((f) => [f.split(path.sep).join("/"), `data:${mime[path.extname(f)]};base64,${fs.readFileSync(path.join(out, f)).toString("base64")}`]));
  // Image paths are built at run time (flags, channels, photos), so they are swapped as they are set
  const swap = `<script>(() => {
  const images = ${JSON.stringify(images)}, fix = (v) => images[String(v).replace(/^\\.?\\//, "")] || v;
  const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src"), set = Element.prototype.setAttribute;
  Object.defineProperty(HTMLImageElement.prototype, "src", { get: src.get, set(v) { src.set.call(this, fix(v)); } });
  Element.prototype.setAttribute = function (n, v) { return set.call(this, n, n === "src" && this instanceof HTMLImageElement ? fix(v) : v); };
  const sweep = (node) => node.querySelectorAll?.("img[src^='img/']").forEach((img) => { img.src = img.getAttribute("src"); });
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach(sweep))).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => sweep(document));
})();</script>`;
  const inline = (code) => code.replace(/<\/script/gi, "<\\/script");
  let page = fs.readFileSync(path.join(out, "index.html"), "utf8")
    .replace(/<link rel="stylesheet" href="styles\.css">/, () => `<style>${fs.readFileSync(path.join(out, "styles.css"), "utf8")}</style>`)
    .replace(/<link rel="(icon|apple-touch-icon)"[^>]*>\n?/g, "")
    .replace(/<script src="((?!https?:)[^"]+)"><\/script>/g, (_, f) => `<script>${inline(fs.readFileSync(path.join(out, f), "utf8"))}</script>`)
    .replace(/(<img[^>]*\ssrc=")(img\/[^"]+)"/g, (all, head, f) => (images[f] ? head + images[f] + '"' : all))
    .replace(/<script>\n\/\/ Demo:/, () => swap + "<script>\n// Demo:");
  if (/<script src="(?!https?:)/.test(page) || !page.includes(swap)) throw new Error("single file: something was not inlined");
  fs.writeFileSync(single, page);
  console.log(`Single file: ${single} (${(fs.statSync(single).size / 1048576).toFixed(1)} MB)`);
}
