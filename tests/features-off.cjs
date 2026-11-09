// With tracking and drivers switched off in config.js (features), against the fake Supabase of ui-smoke.cjs.
// NODE_PATH=.test-tools/node_modules node tests/features-off.cjs   (needs Google Chrome)
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), out = path.join(root, ".impeccable/review");
fs.mkdirSync(out, { recursive: true });
const mockFile = path.join(out, "mock-supabase.js");
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile } });
const mock = fs.readFileSync(mockFile, "utf8");

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let name = req.url.split("?")[0];
  if (name === "/" || name.startsWith("/p/")) name = name.startsWith("/p/") ? "/seguimiento.html" : "/index.html";
  const f = path.resolve(root, "." + decodeURIComponent(name));
  if (!f.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(f, (e, b) => {
    if (e) return res.writeHead(404).end();
    res.setHeader("Content-Type", types[path.extname(f)] || "text/plain");
    // Force both switches off whatever config.js says today
    if (name === "/config.js") return res.end(String(b) + "\nwindow.CDF_CONFIG.features = { tracking: false, drivers: false };\n");
    res.end(f.endsWith(".html") ? String(b).replace(/ integrity="[^"]+"/g, "") : b);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: "chrome" }), errors = [], trackCalls = [];
  const open = async (role, pathName = "/") => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: "es-ES", reducedMotion: "reduce" });
    await ctx.addInitScript((r) => { window.__role = r; try { localStorage.setItem("cdf-lang", "es"); } catch {} }, role);
    await ctx.route("**/*", (route) => {
      const u = route.request().url();
      if (u.includes("supabase.min.js")) return route.fulfill({ body: mock, contentType: "text/javascript" });
      if (u.includes("/functions/v1/cdf-track")) { trackCalls.push(u); return route.fulfill({ contentType: "application/json", body: '{"order":null}' }); }
      if (!u.startsWith(base)) return route.fulfill({ body: "", contentType: "text/css" });
      return route.continue();
    });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    p.on("pageerror", (e) => errors.push(role + ": " + e.message));
    await p.goto(base + pathName);
    return p;
  };
  try {
    // Admin: no tracking link, messages without it, no Driver field, no Driver role
    const a = await open("admin");
    await a.locator("#list").waitFor({ state: "visible" });
    await a.evaluate(() => openOrder(S.orders.find((o) => o.buyer_phone || o.customer_phone) || S.orders[0]));
    await a.locator(".sheet").waitFor();
    await a.waitForTimeout(500);
    assert.equal(await a.locator("#f-link").count(), 0, "tracking link shown");
    assert.equal(await a.locator("#f-carrier").count(), 0, "driver field shown");
    assert.equal(await a.locator("#linkSection").count(), 0, "customer message section shown");
    assert.equal(await a.locator(".sheet").getByRole("button", { name: "Copiar mensaje" }).count(), 0, "copy message shown");
    assert.equal(await a.locator('.sheet .notify-row').count(), 0, "WhatsApp message shown");
    console.log("ok order: no tracking link and no WhatsApp/copied messages to the customer");
    // The old "note for the customer" is now delivery instructions for the rider
    assert.match(await a.locator(".sheet").innerText(), /Indicaciones de entrega/);
    assert(!(await a.locator(".sheet").innerText()).includes("enlace de seguimiento"), "still mentions the tracking link");
    await a.evaluate(() => closeSheet(true));
    await a.evaluate(() => deliverDialog(S.orders[0]));
    await a.locator(".sheet").waitFor();
    assert(!(await a.locator(".sheet").innerText()).includes("Nota para el cliente"), "Delivered still asks for a customer note");
    await a.evaluate(() => closeSheet(true));
    await a.evaluate(() => missedDialog(S.orders[0]));
    await a.locator(".sheet").waitFor();
    assert.match(await a.locator(".sheet").innerText(), /Indicaciones para el próximo intento/);
    await a.evaluate(() => closeSheet(true));
    await a.evaluate(() => openOrder(S.orders.find((o) => o.buyer_phone || o.customer_phone) || S.orders[0]));
    await a.locator(".sheet").waitFor();
    console.log("ok delivery instructions instead of a customer note (Delivered / Nobody home don't overwrite them)");
    await a.screenshot({ path: path.join(out, "features-off-order.png") });
    assert.equal(await a.locator('#aRole option[value="carrier"]').count(), 0, "can create drivers");
    const roles = await a.evaluate(() => { const m = S.members.find((x) => x.role === "vendor"); editMember(m); return [...document.querySelectorAll("#eRole option")].map((o) => o.value); });
    assert(!roles.includes("carrier"), "driver role offered: " + roles);
    console.log("ok team: no Driver role for new or edited members");
    await a.context().close();

    // A driver account can't get in
    const d = await open("carrier");
    await d.locator("#noaccessTxt").waitFor({ state: "visible" });
    assert.match(await d.locator("#noaccessTxt").innerText(), /repartidor están desactivadas/);
    assert(!(await d.locator("#list").isVisible()));
    await d.screenshot({ path: path.join(out, "features-off-driver.png") });
    console.log("ok driver accounts are stopped at sign-in");
    await d.context().close();

    // Florists still work as before, without customer messages
    const v = await open("vendor");
    await v.locator("#list").waitFor({ state: "visible" });
    await v.evaluate(() => openOrderView(S.orders[0]));
    await v.locator(".sheet").waitFor();
    assert.equal(await v.locator(".sheet .notify-row").count(), 0, "florist can still message the customer");
    console.log("ok florist signs in as usual, no customer messages");
    await v.context().close();

    // Tracking page: says it's unavailable and never asks the server
    const tr = await open("track", "/p/abc123abcd");
    await tr.getByText("Seguimiento no disponible").waitFor().catch(async () => tr.getByText("Tracking unavailable").waitFor());
    await tr.waitForTimeout(800);
    assert.equal(trackCalls.length, 0, "tracking page still calls cdf-track");
    await tr.screenshot({ path: path.join(out, "features-off-tracking.png") });
    console.log("ok tracking page: unavailable, no request");
    await tr.context().close();

    assert.deepEqual(errors, []);
    console.log("ok no page errors");
  } catch (e) { console.error("FAIL", e.message, errors); process.exitCode = 1; }
  finally { await browser.close(); server.close(); }
})();
