// Audit F10: an answer for the previous account must never land in the next one's lists (shared phone).
// An admin's loads are held on their way back; the admin signs out (or another account signs straight in)
// and a florist signs in; then the admin's answers arrive. Against the fake Supabase of ui-smoke.cjs.
// Run: NODE_PATH=.test-tools/node_modules node tests/session-switch-ui.cjs
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), out = path.join(root, ".impeccable/review");
fs.mkdirSync(out, { recursive: true });
const mockFile = path.join(out, "mock-supabase-session.js");
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile } });
const mock = fs.readFileSync(mockFile, "utf8");
const seed = () => {
  const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  window.__requests = [{ id: "req-1", ref: 1, request_key: "k1", status: "received", lang: "en", buyer_name: "Admin Only", buyer_phone: "+34612345678",
    receiver_name: "Admin Only", receiver_phone: "+639171234567", mode: "delivery", date: day(1), slot: "11:00 - 13:00", address: "Somewhere 123, QC", lat: 14.6, lng: 121,
    location_source: "search", location_confirmed_at: new Date().toISOString(), description: "x", special_requests: "", card_message: "", payment_method: "gcash",
    created_at: new Date().toISOString(), reviewed_by: null, reject_reason: null, accepted_order_id: null, accepted_key: null }];
  window.__requestFiles = []; window.__requestEvents = [];
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
  const open = async (role, { width = 1280, query = "", lang = "en" } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-PH", reducedMotion: "reduce" });
    await ctx.addInitScript(([r, s, l]) => { window.__role = r; try { localStorage.setItem("cdf-lang", l); } catch {} (0, eval)("(" + s + ")")(); }, [role, String(seed), lang]);
    await ctx.route("**/*", (route) => {
      const u = route.request().url();
      if (u.includes("supabase.min.js")) return route.fulfill({ body: mock, contentType: "text/javascript" });
      if (!u.startsWith("http://127.0.0.1")) return route.fulfill({ body: "", contentType: "text/css" });
      return route.continue();
    });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}/${query}`);
    await p.locator("#list").waitFor({ state: "visible" }).catch(() => {});
    return p;
  };
  const calls = (p) => p.evaluate(() => window.__calls || []);
  const noOverflow = async (p) => assert(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "horizontal overflow");
  const toRequests = async (p) => { await p.locator("#tabRequests").click(); await p.locator("#requestsView:not([hidden])").waitFor(); };

  const HELD = ["cdf_orders", "cdf_order_requests", "cdf_order_prices", "cdf_messages", "cdf_members", "cdf_lalamove"];
  const scenario = async (name, { signOutFirst }) => step(name, async () => {
    const p = await open("admin");
    await p.waitForFunction(() => S.loaded && S.me?.role === "admin");
    const notAna = await p.evaluate(() => S.orders.filter((o) => o.vendor_email !== "ana@example.com").length);
    assert(notAna > 0, "the admin sees orders that are not Ana's");
    // The admin's next loads are held on their way back
    await p.evaluate((tables) => { window.__hold = { active: true, tables, waiting: [] }; loadOrders(); loadRequests(); loadChat(); loadMembers(); }, HELD);
    await p.waitForFunction(() => window.__hold.waiting.length >= 4);
    // Sign out (or not), then Ana, a florist, signs in; her own loads go through normally
    await p.evaluate((signOutFirst) => {
      window.__hold.active = false;
      if (signOutFirst) window.__authCb("SIGNED_OUT", null);
      window.__role = "vendor";
      window.__authCb("SIGNED_IN", { user: { id: "ana-id", email: "ana@example.com" } });
    }, signOutFirst);
    await p.waitForFunction(() => S.me?.email === "ana@example.com" && S.loaded);
    // Now the admin's answers arrive
    await p.evaluate(() => window.__hold.waiting.forEach((go) => go()));
    await p.waitForTimeout(400);
    const state = await p.evaluate(() => ({ me: S.me?.email, role: document.body.dataset.role,
      others: S.orders.filter((o) => o.vendor_email !== "ana@example.com").map((o) => o.num),
      priced: S.orders.filter((o) => o.amount != null).length, requests: RQ.list.length, reqTab: !$("tabRequests").hidden,
      staffMembers: S.members.filter((m) => "pickup_address" in m && m.email !== "ana@example.com" && m.role === "admin" && "sees_stats" in m).length }));
    assert.equal(state.me, "ana@example.com"); assert.equal(state.role, "vendor");
    assert.deepEqual(state.others, [], "no order of someone else's");
    assert.equal(state.priced, 0, "no prices");
    assert.equal(state.requests, 0, "no requests"); assert.equal(state.reqTab, false);
    assert.equal(state.staffMembers, 0, "not the admin's full team table");
    const listed = await p.locator("#list").innerText();
    assert(!/Admin Only/.test(listed));
    await p.context().close();
  });
  try {
    await scenario("Admin's late answers after signing out and a florist signing in are dropped (orders, prices, requests, chat, team)", { signOutFirst: true });
    await scenario("The same when another account signs straight in, without signing out first", { signOutFirst: false });
    await step("No page errors", async () => { assert.deepEqual(errors, []); });
  } finally { await browser.close(); server.close(); }
  if (failed) { console.log(failed + " failed"); process.exit(1); }
})();
