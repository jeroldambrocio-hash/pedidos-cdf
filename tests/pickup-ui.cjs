// Pickup orders in the panel: the card, its three steps (Ready for pickup → Picked up / Not collected),
// another day for one not collected, the Delivery/Pickup switch in the order form, the florist's card,
// and a pickup request with its chosen shop. Fake Supabase of ui-smoke.cjs; tests/pickup-db.cjs checks
// the database rules for real. Needs Google Chrome.
// Run: NODE_PATH=.test-tools/node_modules node tests/pickup-ui.cjs   (screenshots in .impeccable/review/pickup-*.png)
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), out = path.join(root, ".impeccable/review");
fs.mkdirSync(out, { recursive: true });
const mockFile = path.join(out, "mock-supabase-pickup.js");
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile } });
const mock = fs.readFileSync(mockFile, "utf8");

// Ana's shop (Team → Edit), and one pickup request that chose it
const seed = () => {
  window.__ana = { branch: "Quezon City", pickup_address: "12 Visayas Ave, Quezon City", pickup_lat: 14.6538, pickup_lng: 121.045 };
  const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  window.__requests = [{ id: "req-21", ref: 21, request_key: "k21", status: "received", lang: "en", buyer_name: "Liza Cruz", buyer_phone: "+639181112222",
    receiver_name: "Liza Cruz", receiver_phone: "+639181112222", mode: "pickup", pickup_branch: "Quezon City", date: day(1), slot: "15:00 - 17:00",
    address: "", lat: null, lng: null, location_source: null, location_confirmed_at: null, description: "Sunflower bouquet", special_requests: "", card_message: "",
    payment_method: "cash", created_at: new Date().toISOString(), reviewed_by: null, reject_reason: null, accepted_order_id: null, accepted_key: null }];
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

  // One of today's orders becomes a pickup at Ana's shop, ready
  const makePickup = (p, step = ["Ready", "-"]) => p.evaluate(([st, dl]) => {
    const o = S.orders.find((x) => x.date === S.today && !x.cancelled_at && !x.archived_at);
    for (const x of [o, window.__orders.find((y) => y.id === o.id)]) Object.assign(x, { pickup: true, vendor_email: "ana@example.com", status: st, delivery: dl, address: "" });
    render(); return o.id;
  }, step);
  const card = (p, id) => p.locator(`article.order[data-order="${id}"]`);
  const shot = (p, n) => p.screenshot({ path: path.join(out, "pickup-" + n + ".png") });

  try {
    await step("Card: a Pickup tag, where it is collected, three steps and no On the way", async () => {
      const p = await open("admin");
      const id = await makePickup(p), c = card(p, id);
      await c.waitFor();
      assert.match(await c.locator(".tag.pickup").innerText(), /Pickup/);
      assert.match(await c.locator(".o-addr").innerText(), /Pickup at Quezon City/);
      assert.match(await c.locator(".o-addr").getAttribute("href"), /Visayas/);
      assert.deepEqual(await c.locator(".steps .step .t").allInnerTexts(), ["Preparing", "Ready for pickup", "Collected"]);
      const opts = await c.locator(".badge-sel select option").allInnerTexts();
      assert(!opts.some((x) => /in transit|on the way/i.test(x)), "no In transit: " + opts); assert(opts.includes("Not collected"));
      assert.equal(await c.locator(".actions").getByRole("button", { name: "Collected", exact: true }).count(), 1);
      assert.equal(await c.locator(".actions").getByRole("button", { name: "Not collected" }).count(), 1);
      await c.scrollIntoViewIfNeeded(); await c.screenshot({ path: path.join(out, "pickup-1-card.png") });
      await p.context().close();
    });

    await step("Not collected → another day → Ready for pickup again; Picked up asks first", async () => {
      const p = await open("admin");
      const id = await makePickup(p), c = card(p, id);
      await c.locator(".actions").getByRole("button", { name: "Not collected" }).click();
      await p.getByRole("alertdialog").getByRole("button", { name: "Mark not collected" }).click();
      await c.locator(".badge", { hasText: "Not collected" }).first().waitFor();
      await c.locator(".actions").getByRole("button", { name: "Reschedule" }).click();
      await p.locator(".sheet h2", { hasText: "Another day to pick up" }).waitFor();
      assert.equal(await p.locator(".sheet input[type=file]").count(), 0, "no photo asked for");
      await p.locator(".sheet button[type=submit]").click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      const r = (await calls(p)).find((x) => x.rpc === "cdf_reschedule");
      assert(r && r.args.p_note === null && r.args.p_set_proof === false);
      // Back to ready: Picked up
      const id2 = await makePickup(p), c2 = card(p, id2);
      await c2.locator(".actions").getByRole("button", { name: "Collected", exact: true }).click();
      const ask = p.getByRole("alertdialog");
      assert.match(await ask.innerText(), /been collected/);
      await ask.getByRole("button", { name: "Yes, collected" }).click();
      await c2.locator(".badge", { hasText: "Collected" }).first().waitFor();
      assert.equal(await p.evaluate((id) => window.__orders.find((o) => o.id === id).delivery, id2), "Delivered");
      await p.context().close();
    });

    await step("Order form: Delivery / Pickup; a pickup needs no address and says which shop", async () => {
      const p = await open("admin");
      await p.evaluate(() => localStorage.removeItem("cdf-draft"));
      await p.locator("#newBtn").click();
      await p.locator(".new-order-sheet").waitFor();
      assert.equal(await p.locator('#f-mode [data-pickup="false"]').getAttribute("aria-pressed"), "true");
      await p.locator('#f-mode [data-pickup="true"]').click();
      assert.equal(await p.locator("#f-addr").isVisible(), false);
      assert.match(await p.locator(".pickup-info").innerText(), /Assign a florist/);
      await p.locator("#f-vendor").selectOption("ana@example.com");
      assert.match(await p.locator(".pickup-info").innerText(), /Pickup at Quezon City · 12 Visayas Ave/);
      await shot(p, "2-form");
      await p.locator("#f-num").fill("1201");
      await p.locator(".slot-pick select").nth(0).selectOption("540");
      await p.locator("#f-bname").fill("Buyer test"); await p.locator("#f-bphone").fill("0917 555 0101");
      await p.locator("#f-same").check();
      await p.locator(".chan-opt[data-c=Instagram]").click();
      await p.locator(".sheet button[type=submit]").click();
      await p.getByRole("button", { name: "Save anyway" }).click({ timeout: 1500 }).catch(() => {});
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      const ins = (await calls(p)).find((c) => c.rpc === "cdf_create_order" && c.args.p_order);
      assert.equal(ins.args.p_order.pickup, true); assert.equal(ins.args.p_order.address, ""); assert.equal(ins.args.p_order.drop_lat ?? null, null);
      await p.context().close();
    });

    await step("Florist: her pickup card offers Picked up / Not collected, never Head out or a map to the customer", async () => {
      const p = await open("vendor");
      await p.locator("#list").waitFor();
      const id = await p.evaluate(() => {
        const o = S.orders.find((x) => x.vendor_email === "ana@example.com" && !x.cancelled_at);
        for (const x of [o, window.__orders.find((y) => y.id === o.id)]) Object.assign(x, { pickup: true, status: "Ready", delivery: "-", address: "", date: S.today });
        render(); return o.id;
      });
      const w = p.locator(`article.work[data-id="${id}"]`);
      await w.waitFor();
      assert.equal(await w.getByRole("button", { name: /Head out/ }).count(), 0);
      assert.equal(await w.getByRole("button", { name: "Collected", exact: true }).count(), 1);
      assert.equal(await w.getByRole("button", { name: "Not collected" }).count(), 1);
      assert.match(await w.innerText(), /Pickup at the shop/);
      await w.getByRole("button", { name: "Collected", exact: true }).click();
      await p.getByRole("alertdialog").getByRole("button", { name: "Yes, collected" }).click();
      await p.waitForFunction(() => (window.__calls || []).some((c) => c.rpc === "cdf_progress" && c.args.p_step === "done"));
      await w.screenshot({ path: path.join(out, "pickup-3-florist.png") }).catch(() => {});
      await p.context().close();
    });

    await step("Request: the chosen shop with its address; accepting makes a pickup order for that shop's florist", async () => {
      const p = await open("admin");
      await p.locator("#tabRequests").click(); await p.locator("#requestsView:not([hidden])").waitFor();
      assert.match(await p.locator('.req-card[data-id="req-21"]').innerText(), /Pickup at Quezon City/);
      await p.locator('.req-card[data-id="req-21"]').click();
      const txt = await p.locator(".req-sheet").innerText();
      assert.match(txt, /Quezon City\s*12 Visayas Ave, Quezon City/, JSON.stringify(txt));
      await shot(p, "4-request");
      await p.getByRole("button", { name: "Accept and create order" }).click();
      await p.locator(".new-order-sheet").waitFor();
      assert.equal(await p.locator('#f-mode [data-pickup="true"]').getAttribute("aria-pressed"), "true");
      assert.equal(await p.locator("#f-vendor").inputValue(), "ana@example.com");
      assert.match(await p.locator(".pickup-info").innerText(), /Quezon City/);
      await p.context().close();
    });

    await step("No page errors", async () => { assert.deepEqual(errors, []); });
  } finally { await browser.close(); server.close(); }
  if (failed) { console.log(failed + " failed"); process.exit(1); }
})();
