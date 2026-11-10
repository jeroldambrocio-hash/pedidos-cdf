// Notifications that stay on by themselves, and the florist's calendar. Fake Supabase and a fake push service.
// Run: NODE_PATH=.test-tools/node_modules node tests/notif-calendar.cjs
const fs = require("fs"), path = require("path"), http = require("http"), os = require("os"), assert = require("assert");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const mockFile = path.join(os.tmpdir(), "cdf-mock-" + process.pid + ".js");
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile } });
const mock = fs.readFileSync(mockFile, "utf8"); fs.unlinkSync(mockFile);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let name = req.url.split("?")[0]; if (name === "/") name = "/index.html";
  const f = path.resolve(root, "." + decodeURIComponent(name));
  if (!f.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", types[path.extname(f)] || "text/plain");
    res.end(f.endsWith(".html") ? String(b).replace(/ integrity="[^"]+"/g, "") : b);
  });
});
// The browser's push pieces, faked: permission, one subscription per device, new endpoint each time one is made
const fakePush = ([role, opts]) => {
  window.__role = role; Object.assign(window, opts.win || {});
  let sub = null, n = 0;
  const mk = (endpoint) => ({ endpoint: endpoint || "https://push.test/" + ++n, toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "p", auth: "a" } }; }, async unsubscribe() { sub = null; return true; } });
  if (opts.sub) sub = mk(opts.sub);
  let perm = opts.perm;
  Object.defineProperty(Notification, "permission", { get: () => perm });
  Notification.requestPermission = async () => (perm = "granted");
  PushManager.prototype.getSubscription = async () => sub;
  PushManager.prototype.subscribe = async () => (sub = mk());
};
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port, browser = await chromium.launch({ headless: true, channel: "chrome" }), results = [], errors = [];
  async function open(role, opts = {}, width = 1440) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: "en-PH", reducedMotion: "reduce" });
    await context.addInitScript(fakePush, [role, { perm: "granted", ...opts }]);
    const p = await context.newPage(); p.setDefaultTimeout(8000);
    p.on("pageerror", (e) => errors.push(role + ": " + e.message));
    await context.route("**/*", (route) => {
      const u = route.request().url();
      if (u.includes("supabase.min.js")) return route.fulfill({ body: mock, contentType: "text/javascript" });
      if (!u.startsWith("http://127.0.0.1")) return route.fulfill({ body: "", contentType: "text/css" });
      return route.continue();
    });
    await p.goto("http://127.0.0.1:" + port + "/");
    await p.locator("#list").waitFor({ state: "visible" }); await p.waitForTimeout(900);
    return p;
  }
  const step = async (name, fn) => { try { await fn(); results.push("ok   " + name); } catch (e) { results.push("FAIL " + name + " · " + e.message.split("\n")[0]); } };
  const subs = (p) => p.evaluate(() => window.__pushSubs);
  const state = (p) => p.evaluate(() => document.getElementById("notifBtn").dataset.state);

  await step("Already allowed, nothing saved, database without the lang column: turns itself on, no banner", async () => {
    const p = await open("admin", { win: { __noLang: true } });
    const s = await subs(p);
    assert.equal(s.length, 1); assert.equal(s[0].member_email, "admin@example.com"); assert(!("lang" in s[0]));
    assert.equal(await state(p), "on"); assert(await p.locator("#notifBanner").isHidden());
    await p.context().close();
  });
  await step("Database with the lang column: saved with the device language", async () => {
    const p = await open("admin");
    assert.equal((await subs(p))[0].lang, "en"); assert.equal(await state(p), "on");
    await p.context().close();
  });
  await step("Never allowed: asked once; Turn on saves it even without the lang column, and the banner goes", async () => {
    const p = await open("admin", { perm: "default", win: { __noLang: true } });
    const b = p.locator("#notifBanner"); await b.waitFor({ state: "visible" });
    assert.equal((await subs(p)).length, 0);
    await b.locator("button", { hasText: "Turn on" }).click();
    await p.locator(".toast", { hasText: "Notifications are on" }).waitFor();
    assert.equal((await subs(p)).length, 1); assert(await b.isHidden()); assert.equal(await state(p), "on");
    await p.context().close();
  });
  await step("Device still tied to another account: a fresh subscription replaces it", async () => {
    const p = await open("admin", { sub: "https://push.test/old" });
    // the mock starts each page with an empty table: plant the other person's row, then sync again as a new sign-in would
    await p.evaluate(async () => {
      window.__pushSubs = [{ endpoint: "https://push.test/old", member_email: "ana@example.com" }];
      PWA.saved = null;
      await syncPush();
    });
    const s = await subs(p), mine = s.filter((x) => x.member_email === "admin@example.com");
    assert.equal(mine.length, 1); assert.notEqual(mine[0].endpoint, "https://push.test/old"); assert.equal(await state(p), "on");
    await p.context().close();
  });
  await step("Turned off by hand: stays off on the next open (not switched back on behind the person's back)", async () => {
    const p = await open("admin");
    assert.equal(await state(p), "on");
    await p.evaluate(() => disablePush()); await p.waitForTimeout(300);
    assert.equal(await state(p), "off");
    await p.reload(); await p.locator("#list").waitFor({ state: "visible" }); await p.waitForTimeout(900);
    assert.equal((await subs(p)).length, 0); assert.equal(await state(p), "off");
    await p.evaluate(() => enablePush()); await p.waitForTimeout(300);
    assert.equal(await state(p), "on");
    await p.reload(); await p.locator("#list").waitFor({ state: "visible" }); await p.waitForTimeout(900);
    assert.equal(await state(p), "on", "on again by itself after being turned back on");
    await p.context().close();
  });

  const day = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() + n * 864e5));
  await step("Florist: calendar beside her list, only her orders, a later day and a later month open; no office tools", async () => {
    const p = await open("vendor");
    await p.evaluate(async ([d20, d45]) => {
      const base = window.__orders[0];
      window.__orders.push({ ...base, id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", num: "0201", date: d20, customer_name: "Later Lena" },
        { ...base, id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", num: "0202", date: d45, customer_name: "Far Fiona" },
        { ...base, id: "cccccccc-cccc-cccc-cccc-cccccccccccc", num: "0203", date: d20, customer_name: "Not Hers", vendor_email: "other@example.com" });
      await loadOrders();
    }, [day(20), day(45)]);
    assert(await p.locator("#cal").isVisible(), "calendar shown");
    assert(await p.locator("#filters").isHidden() && await p.locator("#newBtn").isHidden() && await p.locator("#adminTools").isHidden() && await p.locator("#viewControls").isHidden());
    assert(await p.locator(".agenda-list").first().isVisible(), "her usual list on today");
    await p.evaluate((d) => selectDay(d), day(20));
    assert.deepEqual(await p.locator(".work .w-name").allInnerTexts(), ["Later Lena"]);
    assert.equal(await p.locator("#cal button.sel").count(), 1);
    await p.evaluate((d) => selectDay(d), day(45)); await p.waitForTimeout(700);
    assert.deepEqual(await p.locator(".work .w-name").allInnerTexts(), ["Far Fiona"], "a day past the first 31 loads");
    await p.evaluate((d) => selectDay(d), day(21));
    assert.match(await p.locator("#list .empty").innerText(), /no orders assigned for this day/i);
    await p.locator("#list .empty button", { hasText: "Back to today" }).click();
    assert(await p.locator(".agenda-list").first().isVisible());
    await p.locator("#nextM").click(); await p.waitForTimeout(500);
    assert.equal(await p.locator("#cal button[title]").count() >= 1, true, "days with her orders are marked");
    await p.screenshot({ path: path.join(root, ".impeccable/review/florist-calendar.png") });
    await p.context().close();
  });
  await step("Florist on a phone: Choose date opens the calendar, picking a day closes it", async () => {
    const p = await open("vendor", {}, 390);
    assert(await p.locator("#calendarToggle").isVisible());
    await p.locator("#calendarToggle").click(); await p.waitForTimeout(500);
    assert(await p.locator("#cal").isVisible());
    await p.locator("#cal button.today").click(); await p.waitForTimeout(500);
    assert.equal(await p.locator("#calendarToggle").getAttribute("aria-expanded"), "false");
    assert(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "no sideways scroll");
    await p.locator("#calendarToggle").click(); await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(root, ".impeccable/review/florist-calendar-phone.png") });
    await p.context().close();
  });
  await step("Admin keeps the office view", async () => {
    const a = await open("admin"); assert(await a.locator("#filters").isVisible() && await a.locator("#newBtn").isVisible()); await a.context().close();
  });
  await step("No uncaught JavaScript errors", async () => assert.deepEqual(errors, []));
  console.log(results.join("\n"));
  await browser.close(); server.close();
  process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
})();
