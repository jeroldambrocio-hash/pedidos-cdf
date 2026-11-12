// Quick pay from an order card (admins) and the What's new list in the account menu.
// NODE_PATH=.test-tools/node_modules node tests/quick-pay-ui.cjs  (screenshots in .impeccable/review/quickpay-*.png)
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), out = path.join(root, ".impeccable/review");
fs.mkdirSync(out, { recursive: true });
const mockFile = path.join(out, "mock-supabase-quickpay.js");
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile } });
const mock = fs.readFileSync(mockFile, "utf8");

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
        return p;
  };
  const shot = async (p, n) => { await p.waitForTimeout(700); return p.screenshot({ path: path.join(out, "quickpay-" + n + ".png") }); };
  try {
    const p = await open("admin", 390);
    const card = p.locator("article.order").filter({ has: p.locator(".tag-btn") }).first();
    await card.waitFor();
    const id = await card.getAttribute("data-order");
    const before = await p.evaluate((id) => __prices.find((x) => x.order_id === id), id);
    const due = before.amount - (before.paid || 0);
    assert(due > 0);
    await shot(p, "1-card");
    // Cancel changes nothing
    await card.locator(".tag-btn").click();
    await p.getByRole("alertdialog").getByRole("button", { name: "Cancelar" }).click();
    assert(!(await p.evaluate(() => (window.__calls || []).some((c) => c.rpc === "cdf_record_payment"))));
    assert.equal(await p.locator("#sheetRoot .sheet").count(), 0, "the order did not open");
    console.log("ok tapping the pending tag asks first; cancel records nothing and does not open the order");
    await card.locator(".tag-btn").click();
    const ask = p.getByRole("alertdialog");
    assert.match(await ask.innerText(), /pagado/);
    await shot(p, "2-ask");
    await ask.getByRole("button", { name: "Marcar pagado" }).click();
    await p.locator(`article.order[data-order="${id}"] .tag.ok`).waitFor();
    const call = await p.evaluate(() => __calls.filter((c) => c.rpc === "cdf_record_payment"));
    assert.equal(call.length, 1); assert.equal(call[0].args.p_amount, due); assert.equal(call[0].args.p_price, before.amount);
    assert.equal(call[0].args.p_seen_price, before.amount); assert.deepEqual(call[0].args.p_proofs, []);
    const after = await p.evaluate((id) => __prices.find((x) => x.order_id === id), id);
    assert.equal(after.paid, after.amount);
    await shot(p, "3-paid");
    console.log("ok confirming records exactly what is left, through cdf_record_payment, and the card shows Paid");

    // Price changed meanwhile: the server refuses, nothing is marked
    const other = p.locator("article.order .tag-btn").first();
    if (await other.count()) {
      const oid = await other.locator("xpath=ancestor::article").getAttribute("data-order");
      await p.evaluate((oid) => { __prices.find((x) => x.order_id === oid).amount = 9999; }, oid);
      await other.click();
      await p.getByRole("alertdialog").getByRole("button", { name: "Marcar pagado" }).click();
      await p.locator(".toast").filter({ hasText: /precio|cambi/i }).first().waitFor();
      assert.equal(await p.evaluate((oid) => __prices.find((x) => x.order_id === oid).paid, oid) || 0, 0);
      console.log("ok a price changed by someone else is refused and nothing is recorded");
    }

    // Florists: no button
    const f = await open("vendor", 390);
    assert.equal(await f.locator(".tag-btn").count(), 0);
    console.log("ok florists get no quick-pay button");

    // What's new
    assert(await p.locator("#accountBtn.has-news").count() || await p.locator("#changelogBtn.has-news").count(), "dot shown before opening");
    await p.evaluate(() => openChangelog());
    const sheet = p.locator("#sheetRoot .changelog");
    await sheet.waitFor();
    assert.match(await sheet.innerText(), /Novedades/);
    assert.match(await sheet.innerText(), /Pago rápido/);
    await shot(p, "4-whatsnew");
    assert.equal(await p.locator("#changelogBtn.has-news, #accountBtn.has-news").count(), 0, "dot gone after opening");
    console.log("ok What's new lists the changes (Spanish) and the dot goes away once opened");
    assert.deepEqual(errors, []); console.log("ok no page errors");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
