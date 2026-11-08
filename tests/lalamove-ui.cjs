// Browser check of the Lalamove block in the order editor, against the fake Supabase of ui-smoke.cjs
// and a fake cdf-lalamove function (no real requests). Needs Google Chrome.
// NODE_PATH=.test-tools/node_modules node tests/lalamove-ui.cjs  (screenshots in .impeccable/review/lalamove-*.png)
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), out = path.join(root, ".impeccable/review");
fs.mkdirSync(out, { recursive: true });
const mockFile = path.join(out, "mock-supabase.js");
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile } });
const mock = fs.readFileSync(mockFile, "utf8");

// Fake cdf-lalamove: geocode → quote → book → (webhook) rider assigned → cancel
const fake = () => {
  window.__ll = { row: null, calls: [] };
  const exp = () => new Date(Date.now() + 5 * 60000).toISOString();
  sb.functions.invoke = async (name, { body }) => {
    if (name !== "cdf-lalamove") return { data: { ok: true }, error: null };
    __ll.calls.push(body);
    const r = __ll.row;
    const reply = (data) => ({ data: JSON.parse(JSON.stringify(data)), error: null });
    switch (body.action) {
      case "status": return reply({ env: "sandbox", ready: true, sync: false });
      case "geocode": return reply({ results: body.query.includes("nowhere") ? [] : [{ label: "Tomas Morato Ave, Quezon City, Metro Manila", lat: 14.6337, lng: 121.0338 }] });
      case "quote": __ll.row = { order_id: body.order_id, lat: body.lat, lng: body.lng, place: body.place, service: body.service, quotation_id: "q1", quote_total: 112, quote_currency: "PHP", quote_expires: exp() }; return reply({ row: __ll.row });
      case "book": Object.assign(r, { ll_order_id: "LL1", status: "ASSIGNING_DRIVER", share_link: "https://share.sandbox.lalamove.com/x", price_total: 112 }); return reply({ row: r });
      case "refresh": return reply({ row: r });
      case "cancel": r.status = "CANCELED"; return reply({ row: r });
    }
    return { data: null, error: { message: "unknown" } };
  };
  // The table: reads return the fake row
  const from = sb.from.bind(sb);
  sb.from = (t) => t !== "cdf_lalamove" ? from(t) : (() => {
    const q = { select: () => q, limit: () => q, eq: () => q,
      maybeSingle: async () => ({ data: __ll.row && JSON.parse(JSON.stringify(__ll.row)), error: null }),
      then: (res, rej) => Promise.resolve({ data: __ll.row ? [__ll.row] : [], error: null }).then(res, rej) };
    return q;
  })();
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
  const shot = (p, n) => p.screenshot({ path: path.join(out, "lalamove-" + n + ".png") });
  const noOverflow = async (p) => assert(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "horizontal overflow");
  try {
    // Admin on a phone: the whole flow
    const p = await open("admin", 390);
    // The "Ready" order (0126 is In transit; any order works for the block)
    await p.evaluate(() => openOrder(S.orders.find((o) => o.status === "Ready" && !o.cancelled_at) || S.orders[0]));
    const sec = p.locator("#lalamoveSection");
    await sec.waitFor({ state: "visible" });
    await sec.scrollIntoViewIfNeeded();
    assert.match(await sec.innerText(), /Pruebas \(sandbox\)/i);
    await shot(p, "1-start"); await noOverflow(p);
    console.log("ok block shows for admin, sandbox label");

    await sec.getByRole("button", { name: "Enviar con Lalamove" }).click();
    await sec.locator(".ll-search input").fill("nowhere special");
    await sec.getByRole("button", { name: "Buscar" }).click();
    await sec.getByText("No la encuentro").waitFor();
    await sec.locator(".ll-search input").fill("Tomas Morato, Quezon City");
    await sec.locator(".ll-search input").press("Enter");
    await sec.locator(".ll-hit").first().waitFor();
    await shot(p, "2-search"); await noOverflow(p);
    // Enter in the search box must not submit the order form
    assert.equal(await p.locator(".sheet").count(), 1);
    await sec.locator(".ll-hit").first().click();
    console.log("ok address search, no results, Enter stays in the block");

    await sec.getByRole("button", { name: "Ver precio" }).click();
    await sec.locator(".ll-price").waitFor();
    assert.match(await sec.locator(".ll-price").innerText(), /₱112/);
    const q = await p.evaluate(() => __ll.calls.find((c) => c.action === "quote"));
    assert.equal(q.lat, 14.6337); assert.equal(q.service, "MOTORCYCLE");
    await shot(p, "3-price"); await noOverflow(p);
    console.log("ok price shown, quote sent with the picked point");

    const book = sec.getByRole("button", { name: "Reservar rider" });
    if (await book.count()) {
      await book.click();
      await p.locator("#dialogRoot").getByText("no se cobra nada").waitFor();
      await p.locator("#dialogRoot .btn.primary").click();
      await sec.getByText("Buscando rider").first().waitFor();
      // Webhook → realtime: rider assigned
      await p.evaluate(() => { Object.assign(__ll.row, { status: "ON_GOING", driver_name: "Juan Dela Cruz", driver_plate: "NAB 1234", driver_phone: "+639171112222" }); });
      await sec.getByRole("button", { name: "Actualizar" }).click();
      await sec.getByText("Juan Dela Cruz").waitFor();
      assert(await sec.locator('a[href="tel:+639171112222"]').count());
      await shot(p, "4-rider"); await noOverflow(p);
      console.log("ok booked with sandbox warning, rider shown");

      await sec.getByRole("button", { name: "Cancelar envío" }).click();
      await p.locator("#dialogRoot .btn.danger-solid").click();
      await sec.getByRole("button", { name: "Pedir otro rider" }).waitFor();
      console.log("ok cancel");
    } else {
      assert.match(await sec.innerText(), /teléfono válido/);
      console.log("ok order without phone cannot be booked");
    }
    // The order form was never saved by any of this
    assert(!(await p.evaluate(() => (window.__calls || []).some((c) => c.update || c.insert))), "the order was saved");
    await p.context().close();

    // Florist and driver: no block
    for (const role of ["vendor", "carrier"]) {
      const q2 = await open(role, 390);
      await q2.evaluate(() => S.orders[0] && openOrderView(S.orders[0]));
      await q2.waitForTimeout(800);
      assert.equal(await q2.locator("#lalamoveSection:not([hidden])").count(), 0, role + " sees Lalamove");
      await q2.context().close();
    }
    console.log("ok florist and driver never see it");
    assert.deepEqual(errors, []);
    console.log("ok no page errors");
  } catch (e) { console.error("FAIL", e.message, errors); process.exitCode = 1; }
  finally { await browser.close(); server.close(); }
})();
