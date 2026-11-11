// Phase 5, browser: the proofs under the Lalamove block (pending, available, not provided, error,
// removed), still shown after delivery and after the order is cancelled; viewing through a short-lived
// link; removing (admins only); the replaced-booking notes. Fake Supabase of ui-smoke.cjs, no network.
// NODE_PATH=.test-tools/node_modules node tests/lalamove-proofs-ui.cjs  (screenshots in .impeccable/review/llproofs-*.png)
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), out = path.join(root, ".impeccable/review");
fs.mkdirSync(out, { recursive: true });
const mockFile = path.join(out, "mock-supabase-proofs.js");
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile } });
const mock = fs.readFileSync(mockFile, "utf8");

const fake = () => {
  const o = S.orders.find((x) => x.vendor_email === "ana@example.com") || S.orders[0];
  window.__o = o;
  window.__ll = { calls: [], signed: [],
    row: { order_id: o.id, env: "production", ll_order_id: "3626117933572534460", status: "COMPLETED", price_total: 98, quote_currency: "PHP", driver_name: "Rider R", lat: 14.6, lng: 121.03, place: "Salcedo Village" },
    proofs: [
      { id: 1, order_id: o.id, ll_order_id: "3626117933572534460", kind: "pod", stop_key: "S1", provider_status: "DELIVERED", provider_at: "2026-11-11T02:44:30Z", state: "available", storage_path: o.id + "/3626117933572534460/pod-S1-abc.jpg", error: null, created_at: "2026-11-11T02:45:00Z" },
      { id: 2, order_id: o.id, ll_order_id: "3626117933572534460", kind: "pop", stop_key: "S0", provider_status: null, state: "error", storage_path: null, error: "host_not_allowed:cdn.example.net", created_at: "2026-11-11T02:20:00Z" },
    ],
    ships: [{ ll_order_id: "3626117933572534460", status: "COMPLETED", replaced_from: "3626117933500000000", replaced_by: null, replace_noticed_at: null, created_at: "2026-11-11T02:13:00Z" },
      { ll_order_id: "3626117933500000000", status: "CANCELED", replaced_from: null, replaced_by: "3626117933572534460", replace_noticed_at: "2026-11-11T02:12:00Z", created_at: "2026-11-11T02:00:00Z" }] };
  sb.functions.invoke = async (name, { body }) => {
    __ll.calls.push(body);
    const reply = (data) => ({ data: JSON.parse(JSON.stringify(data)), error: null });
    if (body.action === "status") return reply({ env: "production", ready: true, sync: true });
    if (body.action === "refresh") return reply({ row: __ll.row });
    if (body.action === "proof_remove") { Object.assign(__ll.proofs.find((p) => p.id === body.id), { state: "removed", storage_path: null, removed_by: "admin@example.com" }); return reply({ ok: true }); }
    return { data: null, error: { message: "unknown" } };
  };
  const from = sb.from.bind(sb);
  const table = (rows) => { const q = { select: () => q, limit: () => q, eq: () => q, in: () => q, order: () => q,
    maybeSingle: async () => ({ data: JSON.parse(JSON.stringify(rows()[0] || null)), error: null }),
    then: (res, rej) => Promise.resolve({ data: JSON.parse(JSON.stringify(rows())), error: null }).then(res, rej) }; return q; };
  sb.from = (t) => t === "cdf_lalamove" ? table(() => [__ll.row]) : t === "cdf_lalamove_proofs" ? table(() => __ll.proofs)
    : t === "cdf_lalamove_shipments" ? table(() => __ll.ships) : from(t);
  const bucket = sb.storage.from.bind(sb.storage);
  sb.storage.from = (b) => b !== "cdf-lalamove-proofs" ? bucket(b) : { createSignedUrl: async (p, secs) => { __ll.signed.push({ p, secs }); return { data: { signedUrl: "/img/emblem.webp" }, error: null }; } };
  LL.cap = null;
};

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let name = req.url.split("?")[0];
  if (name === "/") name = "/index.html";
  const f = path.resolve(root, "." + decodeURIComponent(name));
  if (!f.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(f, (e, b) => {
    if (e) return res.writeHead(404).end();
    res.setHeader("Content-Type", types[path.extname(f)] || "text/plain");
    res.end(f.endsWith(".html") ? String(b).replace(/ integrity="[^"]+"/g, "") : b);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ headless: true, channel: "chrome" }), errors = [];
  const open = async (role, width) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: "es-ES", reducedMotion: "reduce" });
    await ctx.addInitScript((r) => { window.__role = r; try { localStorage.setItem("cdf-lang", "es"); } catch {} }, role);
    await ctx.route("**/*", (route) => {
      const u = route.request().url();
      if (u.includes("supabase.min.js")) return route.fulfill({ body: mock, contentType: "text/javascript" });
      if (!u.startsWith("http://127.0.0.1")) return route.fulfill({ body: "", contentType: "text/css" });
      return route.continue();
    });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}/`);
    await p.locator("#list").waitFor({ state: "visible" });
    await p.evaluate(fake);
    return p;
  };
  const shot = (p, n) => p.screenshot({ path: path.join(out, "llproofs-" + n + ".png") });
  const noOverflow = async (p) => assert(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "horizontal overflow");
  try {
    const p = await open("admin", 390);
    await p.evaluate(() => openOrder(__o));
    const box = p.locator("#lalamoveSection .ll-proofs");
    await box.locator(".ll-proof").first().waitFor();
    await box.scrollIntoViewIfNeeded();
    const text = await box.innerText();
    assert.match(text, /Pruebas/);
    assert.match(text, /Prueba de entrega\s*Disponible/);
    assert.match(text, /Prueba de recogida\s*Error\s*Origen no admitido: cdn\.example\.net/);
    assert.match(text, /Lalamove sustituyó este envío por otro/);
    assert.match(text, /Envíos anteriores/);
    await shot(p, "1-delivered"); await noOverflow(p);
    console.log("ok delivered: proof available, pickup proof in error with the reason, replacement noted, history");

    const [tab] = await Promise.all([p.context().waitForEvent("page"), box.getByRole("button", { name: "Ver" }).click()]);
    await tab.waitForURL(/emblem\.webp/);
    const signed = await p.evaluate(() => __ll.signed);
    assert.equal(signed.length, 1); assert.equal(signed[0].secs, 300); assert.match(signed[0].p, /pod-S1-abc\.jpg$/);
    await tab.close();
    console.log("ok view opens a five-minute link to the private copy");

    await box.getByRole("button", { name: "Quitar" }).click();
    await p.getByRole("alertdialog").getByRole("button", { name: "Quitar" }).click();
    await box.getByText("Eliminada").waitFor();
    assert.match(await box.innerText(), /quitada por admin@example\.com/);
    assert.deepEqual(await p.evaluate(() => __ll.calls.find((c) => c.action === "proof_remove")), { action: "proof_remove", id: 1 });
    assert.equal(await box.getByRole("button", { name: "Ver" }).count(), 0);
    console.log("ok admin removes a proof after confirming; it stays listed as removed, by whom");

    // Delivered with nothing from Lalamove yet; then the order cancelled: the block still shows
    await p.evaluate(() => { closeSheet(true); __ll.proofs = []; __ll.ships = []; });
    await p.evaluate(() => openOrder(__o));
    await box.getByText("Lalamove aún no ha enviado la prueba de entrega").waitFor();
    console.log("ok delivered without a proof yet says it is pending from Lalamove");
    await p.evaluate(() => { closeSheet(true); __o.cancelled_at = "2026-11-11T03:00:00Z"; __ll.row.status = "CANCELED";
      __ll.proofs = [{ id: 5, order_id: __o.id, ll_order_id: __ll.row.ll_order_id, kind: "pod", stop_key: "S1", provider_status: "FAILED", state: "not_provided", created_at: "2026-11-11T02:50:00Z" }]; });
    await p.evaluate(() => openOrder(__o));
    await box.locator(".ll-proof").waitFor();
    const sec = await p.locator("#lalamoveSection").innerText();
    assert.match(sec, /El pedido está cancelado/);
    assert.match(sec, /No proporcionada\s*Lalamove marcó la entrega como fallida/);
    await shot(p, "2-cancelled"); await noOverflow(p);
    console.log("ok cancelled order: proofs still visible; a failed delivery says not provided");
    await p.context().close();

    // The florist of the order sees them, without the remove button
    const f = await open("vendor", 390);
    // Her view of a delivered order: only the proofs, if a rider was booked
    await f.evaluate(() => { __o.delivery = "Delivered"; __o.status = "Ready"; openOrder(__o); });
    const fbox = f.locator("#lalamoveSection .ll-proofs");
    await fbox.locator(".ll-proof").first().waitFor();
    assert.equal(await fbox.getByRole("button", { name: "Ver" }).count(), 1);
    assert.equal(await fbox.getByRole("button", { name: "Quitar" }).count(), 0);
    assert.equal(await f.locator("#lalamoveSection").getByRole("button", { name: "Pedir otro rider" }).count(), 0);
    await f.evaluate(() => { closeSheet(true); __ll.row = null; openOrder(__o); });
    await f.waitForTimeout(400);
    assert(await f.evaluate(() => !document.getElementById("lalamoveSection") || document.getElementById("lalamoveSection").hidden));
    console.log("ok florist sees and opens the proof of a delivered order, cannot remove it; no booking = no block");
    await f.context().close();

    // Before the migration: the tables answer with an error and nothing is shown
    const n = await open("admin", 1280);
    await n.evaluate(() => { const from = sb.from; sb.from = (t) => t === "cdf_lalamove_proofs" || t === "cdf_lalamove_shipments"
      ? (() => { const q = { select: () => q, eq: () => q, order: () => q, then: (r) => Promise.resolve({ data: null, error: { message: "relation does not exist" } }).then(r) }; return q; })() : from(t); });
    await n.evaluate(() => openOrder(__o));
    await n.locator("#lalamoveSection .ll-line").waitFor();
    await n.waitForTimeout(300);
    assert.equal(await n.locator("#lalamoveSection .ll-proofs").innerText(), "");
    console.log("ok without the migration the block is exactly as before");
    await n.context().close();

    assert.deepEqual(errors, []);
    console.log("ok no page errors");
  } catch (e) { console.error("FAIL", e.message, errors); process.exitCode = 1; }
  finally { await browser.close(); server.close(); }
})();
