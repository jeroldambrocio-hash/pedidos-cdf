// Phase 4 in the panel: the nearest shop suggested beside the florist picker, and Team pointing out florists
// left out of it. Fake Supabase of ui-smoke.cjs (its ranking follows the database function, which
// tests/branch-ranking-db.cjs checks for real). Needs Google Chrome.
// Run: NODE_PATH=.test-tools/node_modules node tests/branches-ui.cjs   (screenshots in .impeccable/review/branches-*.png)
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), out = path.join(root, ".impeccable/review");
fs.mkdirSync(out, { recursive: true });
const mockFile = path.join(out, "mock-supabase.js");
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile } });
const mock = fs.readFileSync(mockFile, "utf8");

// Four florists: two shops with a location, one away on the order's date, one with nothing set
const team = () => {
  const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  sessionStorage.setItem("__members", JSON.stringify([
    { email: "admin@example.com", name: "Jerold", role: "admin" },
    { email: "ana@example.com", name: "Ana", role: "vendor", branch: "Quezon City", pickup_address: "12 Tomas Morato Ave", pickup_lat: 14.6337, pickup_lng: 121.0338, away_from: null, away_until: null },
    { email: "jhandee@example.com", name: "Jhandee", role: "vendor", branch: "Parañaque", pickup_address: "BF Homes", pickup_lat: 14.4793, pickup_lng: 121.0198, away_from: null, away_until: null },
    { email: "arjay@example.com", name: "Arjay", role: "vendor", branch: "Pasig", pickup_address: "Kapitolyo", pickup_lat: 14.5764, pickup_lng: 121.0851, away_from: day(2), away_until: day(2) },
    { email: "agnes@example.com", name: "Agnes", role: "vendor", branch: null, pickup_address: null, pickup_lat: null, pickup_lng: null, away_from: null, away_until: null },
    { email: "driver@example.com", name: "Luis", role: "carrier" }]));
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
  let failed = 0;
  const step = async (name, fn) => { try { await fn(); console.log("ok " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n  " + String(e.stack || e).split("\n").slice(0, 5).join("\n  ")); } };
  const open = async (role, { width = 1280, lang = "en" } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-PH", reducedMotion: "reduce" });
    await ctx.addInitScript(([r, s, l]) => { window.__role = r; try { localStorage.setItem("cdf-lang", l); } catch {} (0, eval)("(" + s + ")")(); }, [role, String(team), lang]);
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
  const newOrder = async (p, { date } = {}) => {
    await p.evaluate(() => localStorage.removeItem("cdf-draft"));
    await p.locator("#newBtn").click();
    await p.locator(".new-order-sheet").waitFor();
    if (date) { await p.locator("#f-date").fill(date); await p.locator("#f-date").dispatchEvent("change"); }
    await p.locator(".order-more summary").click();
  };
  const setPoint = async (p, v) => { await p.locator("#f-drop").fill(v); await p.locator("#f-drop").dispatchEvent("change"); };
  const box = (p) => p.locator(".shop-suggest");
  const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  try {
    await step("No delivery point yet: no suggestion; a point in Quezon City suggests the Quezon City shop, with its distance", async () => {
      const p = await open("admin");
      await newOrder(p);
      assert.equal(await box(p).isVisible(), false);
      await setPoint(p, "14.6397, 121.0775"); // Katipunan Ave
      await box(p).waitFor();
      assert.match(await p.locator(".shop-best").innerText(), /^Nearest shop: Quezon City · 4\.8 km · Ana/);
      assert.equal(await p.locator("#f-vendor").inputValue(), "", "nothing is assigned by itself");
      await p.locator(".shop-all summary").click();
      assert.deepEqual(await p.locator(".shop-list li .shop-row-head b").allInnerTexts(), ["Quezon City", "Pasig", "Parañaque"]);
      assert.match(await p.locator(".shop-all").innerText(), /Straight-line distance/);
      assert.match(await p.locator(".shop-left").innerText(), /Agnes \(no shop location, no branch\)/);
      await p.screenshot({ path: path.join(out, "branches-suggest-desktop.png") });
      await p.getByRole("button", { name: "Assign to Ana" }).click();
      assert.equal(await p.locator("#f-vendor").inputValue(), "ana@example.com");
      await p.locator(".shop-chosen").waitFor();
      await p.context().close();
    });

    await step("The admin can pick any florist from the list, or keep choosing in the picker as before", async () => {
      const p = await open("admin");
      await newOrder(p);
      await setPoint(p, "14.6397, 121.0775");
      await box(p).waitFor();
      await p.locator(".shop-all summary").click();
      await p.locator(".shop-florists button", { hasText: "Jhandee" }).click();
      assert.equal(await p.locator("#f-vendor").inputValue(), "jhandee@example.com");
      assert.equal(await p.locator(".shop-florists button.is-chosen").innerText(), "Jhandee");
      assert.equal(await p.getByRole("button", { name: "Assign to Ana" }).isVisible(), true, "the nearest is still offered");
      await p.locator("#f-vendor").selectOption("agnes@example.com");
      assert.equal(await p.locator(".shop-florists button.is-chosen").count(), 0);
      await p.context().close();
    });

    await step("A shop whose florist is away that day goes last and is marked; the date change updates it", async () => {
      const p = await open("admin");
      await newOrder(p, { date: day(2) });
      await setPoint(p, "14.5800, 121.0870"); // next to the Pasig shop
      await box(p).waitFor();
      await p.locator(".shop-best", { hasText: "Quezon City" }).waitFor();
      await p.locator(".shop-all summary").click();
      const rows = await p.locator(".shop-list li").allInnerTexts();
      assert.match(rows.at(-1), /^Pasig[\s\S]*Arjay \(away that day\)/);
      await p.locator("#f-date").fill(day(5)); await p.locator("#f-date").dispatchEvent("change");
      await p.locator(".shop-best", { hasText: "Pasig" }).waitFor();
      await p.context().close();
    });

    await step("Another destination, another answer; an order being edited gets the suggestion too", async () => {
      const p = await open("admin");
      await newOrder(p);
      await setPoint(p, "14.4560, 121.0230"); // Parañaque
      await p.locator(".shop-best", { hasText: "Parañaque" }).waitFor();
      await setPoint(p, "not a point");
      await box(p).waitFor({ state: "hidden" });
      await p.evaluate(() => closeSheet(true));
      await p.evaluate(() => { const o = S.orders[0]; o.drop_lat = 14.6397; o.drop_lng = 121.0775; openOrder(o); });
      await p.locator(".shop-best", { hasText: "Quezon City" }).waitFor();
      await p.context().close();
    });

    await step("Team points out florists who can't be suggested and why", async () => {
      const p = await open("admin");
      await p.locator("#tabTeam").click();
      await p.locator("#teamView:not([hidden])").waitFor();
      const agnes = p.locator(".member", { hasText: "Agnes" });
      assert.match(await agnes.locator(".shop-gap").innerText(), /Not in the nearest-shop suggestion: no shop location, no branch/);
      assert.equal(await p.locator(".member", { hasText: "Ana" }).locator(".shop-gap").count(), 0);
      await p.context().close();
    });

    await step("Florists never see it; on a phone it fits, in Spanish", async () => {
      const f = await open("vendor");
      assert.equal(await f.evaluate(() => S.cap.ranking), false);
      await f.context().close();
      const p = await open("admin", { width: 390, lang: "es" });
      await p.locator("#calendarToggle").click();
      await newOrder(p);
      await setPoint(p, "14.6397, 121.0775");
      await p.locator(".shop-best", { hasText: "Tienda más cercana: Quezon City" }).waitFor();
      await p.locator(".shop-suggest").scrollIntoViewIfNeeded();
      assert(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "horizontal overflow");
      await p.screenshot({ path: path.join(out, "branches-suggest-mobile.png") });
      await p.context().close();
    });

    assert.deepEqual([...new Set(errors)], [], "no page errors");
  } finally {
    await browser.close(); server.close();
  }
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
