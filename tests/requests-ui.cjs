// Phase 3 in the panel: the Requests tab, reviewing, rejecting and accepting a request into an order.
// Runs against the fake Supabase of ui-smoke.cjs (its request answers mirror the database functions, which
// tests/requests-db.cjs checks for real). Needs Google Chrome.
// Run: NODE_PATH=.test-tools/node_modules node tests/requests-ui.cjs   (screenshots in .impeccable/review/requests-*.png)
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), out = path.join(root, ".impeccable/review");
fs.mkdirSync(out, { recursive: true });
const mockFile = path.join(out, "mock-supabase.js");
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile } });
const mock = fs.readFileSync(mockFile, "utf8");

// Three requests, an order from an earlier one, and that order's photos. Dates are the shop's (Manila).
const seed = () => {
  const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  const R = (ref, extra) => ({ id: "req-" + ref, ref, request_key: "k" + ref, status: "received", lang: "en", buyer_name: "Jose Santos", buyer_phone: "+34612345678",
    receiver_name: "Maria Santos", receiver_phone: "+639171234567", mode: "delivery", date: day(2), slot: "11:00 - 13:00",
    address: "Unit 4B, Tower 2, 123 Katipunan Ave, Loyola Heights, Quezon City", lat: 14.6397, lng: 121.0775, location_source: "search",
    location_confirmed_at: new Date().toISOString(), description: "A dozen red roses, wrapped in kraft paper", special_requests: "No lilies, please",
    card_message: "Happy birthday, Ma!", payment_method: "gcash", created_at: new Date(Date.now() - ref * 60e3).toISOString(), reviewed_by: null,
    reject_reason: null, accepted_order_id: null, accepted_key: null, ...extra });
  window.__requests = [
    R(12),
    R(13, { mode: "pickup", address: "", lat: null, lng: null, location_source: null, location_confirmed_at: null, buyer_name: "Liza Cruz", buyer_phone: "+639181112222",
      receiver_name: "Liza Cruz", receiver_phone: "+639181112222", date: day(1), slot: "15:00 - 17:00", description: "Sunflower bouquet", special_requests: "", card_message: "", payment_method: "cash" }),
    R(9, { status: "rejected", reject_reason: "Out of stock that day", buyer_name: "Old Request", date: day(3) }),
    R(7, { status: "accepted", accepted_order_id: "11111111-1111-1111-1111-111111111111", accepted_key: "x", buyer_name: "Accepted Before" }),
  ];
  window.__requestFiles = [
    { id: "f1", request_id: "req-12", kind: "reference", path: "s/f1.jpg", width: 96, height: 64 },
    { id: "f2", request_id: "req-12", kind: "reference", path: "s/f2.jpg", width: 96, height: 64 },
    { id: "f3", request_id: "req-12", kind: "payment_proof", path: "s/f3.jpg", width: 96, height: 64 },
    { id: "f7", request_id: "req-7", kind: "reference", path: "s/f7.jpg", width: 96, height: 64 },
    { id: "f8", request_id: "req-7", kind: "payment_proof", path: "s/f8.jpg", width: 96, height: 64 },
  ];
  window.__requestEvents = [{ request_id: "req-12", kind: "received", by_email: null, detail: {}, created_at: new Date().toISOString() }];
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
  const shot = (p, n) => p.screenshot({ path: path.join(out, "requests-" + n + ".png") });
  const noOverflow = async (p) => assert(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "horizontal overflow");
  const toRequests = async (p) => { await p.locator("#tabRequests").click(); await p.locator("#requestsView:not([hidden])").waitFor(); };

  try {
    await step("Admins get a Requests tab with the number still to review; florists and drivers do not", async () => {
      const p = await open("admin");
      assert.equal(await p.locator("#tabRequests").isVisible(), true);
      assert.equal(await p.locator("#tabRequestsCount").innerText(), "2");
      assert.equal(await p.locator("#tabRequests").getAttribute("aria-label"), "Requests · 2 to review");
      await p.context().close();
      for (const role of ["vendor", "carrier"]) {
        const q = await open(role);
        assert.equal(await q.locator("#tabRequests").isVisible(), false, role);
        assert(!(await calls(q)).some((c) => c.rpc && /cdf_request/.test(c.rpc)));
        await q.context().close();
      }
    });

    await step("The list: open requests by delivery date, then accepted and rejected ones; new ones stand out", async () => {
      const p = await open("admin");
      await toRequests(p);
      assert.deepEqual(await p.locator(".req-card .req-ref").allInnerTexts(), ["R13", "R12"], "the nearest date first");
      assert.equal(await p.locator(".req-card.is-new").count(), 2);
      assert.match(await p.locator(".req-card").first().innerText(), /Sunflower bouquet/);
      assert.deepEqual(await p.locator("#reqFilter .count").allInnerTexts(), ["2", "1", "1"]);
      await p.locator('#reqFilter [data-f="rejected"]').click();
      assert.deepEqual(await p.locator(".req-card .req-ref").allInnerTexts(), ["R9"]);
      await p.locator('#reqFilter [data-f="accepted"]').click();
      assert.deepEqual(await p.locator(".req-card .req-ref").allInnerTexts(), ["R7"]);
      await p.locator('#reqFilter [data-f="open"]').click();
      await shot(p, "list-desktop");
      await p.context().close();
    });

    await step("Opening one: marked “in review”, everything the customer sent, photos private, the proof marked not verified", async () => {
      const p = await open("admin");
      await toRequests(p);
      await p.locator('.req-card[data-id="req-12"]').click();
      const sheet = p.locator(".req-sheet");
      await sheet.waitFor();
      assert.equal(await p.evaluate(() => window.__requests.find((r) => r.id === "req-12").status), "in_review");
      const text = await sheet.innerText();
      for (const bit of ["Request R12", "In review", "Jose Santos", "Maria Santos", "Unit 4B, Tower 2", "See the point on the map", "confirmed by the customer",
        "A dozen red roses", "No lilies, please", "Happy birthday, Ma!", "GCash", "Customer's reference photos", "Not verified"]) assert(text.includes(bit), bit);
      assert.equal(await sheet.locator('a[href*="query=14.6397,121.0775"]').count(), 1);
      assert.equal(await sheet.locator(".photo-grid .pic").count(), 2);
      assert.equal(await p.locator("#tabRequestsCount").innerText(), "2", "still to review until decided");
      assert.equal(await p.locator('.req-card[data-id="req-12"]').evaluate((e) => e.classList.contains("is-new")), false);
      await shot(p, "detail-desktop");
      await p.context().close();
    });

    await step("A request for a phone and day that already has an order says so (and links to it), without blocking", async () => {
      const p = await open("admin");
      await p.evaluate(() => { const o = window.__orders[1]; o.buyer_phone = "+34612345678"; o.date = window.__requests[0].date; });
      await toRequests(p);
      await p.locator('.req-card[data-id="req-12"]').click();
      const note = p.locator(".req-dupes");
      await note.waitFor();
      const num = await p.evaluate(() => window.__orders[1].num);
      assert.match(await note.innerText(), new RegExp("Same phone and same day as: .*#" + num));
      assert.equal(await p.getByRole("button", { name: "Accept and create order" }).isEnabled(), true);
      await p.context().close();
    });

    await step("Rejecting keeps the reason for the team; it can be reviewed again", async () => {
      const p = await open("admin");
      await toRequests(p);
      await p.locator('.req-card[data-id="req-13"]').click();
      await p.getByRole("button", { name: "Reject", exact: true }).click();
      assert.match(await p.locator(".sheet").innerText(), /gets no automatic message/);
      await p.locator("#req-reason").fill("No sunflowers this week");
      await p.locator(".sheet button[type=submit]").click();
      await p.locator(".toast", { hasText: "R13 rejected" }).waitFor();
      assert.equal(await p.locator("#tabRequestsCount").innerText(), "1");
      assert.deepEqual(await p.locator(".req-card .req-ref").allInnerTexts(), ["R12"]);
      await p.locator('#reqFilter [data-f="rejected"]').click();
      await p.locator('.req-card[data-id="req-13"]').click();
      assert.match(await p.locator(".req-sheet").innerText(), /Rejected: No sunflowers this week/);
      assert.equal(await p.getByRole("button", { name: "Accept and create order" }).count(), 0, "a rejected request cannot be accepted");
      await p.getByRole("button", { name: "Review again" }).click();
      await p.locator(".req-sheet .req-tag.in_review").waitFor();
      assert.equal(await p.locator("#tabRequestsCount").innerText(), "2");
      await p.context().close();
    });

    await step("Accepting: the editor opens filled in from the request; saving creates the order with price and down payment and closes the request", async () => {
      const p = await open("admin");
      await toRequests(p);
      await p.locator('.req-card[data-id="req-12"]').click();
      await p.getByRole("button", { name: "Accept and create order" }).click();
      const ed = p.locator(".new-order-sheet");
      await ed.waitFor();
      assert.equal(await ed.locator("h2").innerText(), "Create order from R12");
      assert.match(await ed.locator(".req-from").innerText(), /Filled in from request R12/);
      const r = await p.evaluate(() => window.__requests.find((x) => x.id === "req-12"));
      assert.equal(await p.locator("#f-date").inputValue(), r.date);
      assert.deepEqual(await p.locator(".slot-pick select").evaluateAll((s) => s.map((x) => x.value)), ["660", "780"]);
      assert.equal(await p.locator("#f-bname").inputValue(), "Jose Santos");
      assert.equal(await p.locator("#f-name").inputValue(), "Maria Santos");
      assert.equal(await p.locator("#f-addr").inputValue(), r.address);
      assert.equal(await p.locator("#f-card").inputValue(), "Happy birthday, Ma!");
      const notes = await p.locator("#f-notes").inputValue();
      assert(notes.includes("A dozen red roses") && notes.includes("Requests: No lilies, please") && notes.includes("From request R12 · preferred payment: GCash"), notes);
      assert.equal(await p.locator(".chan-opt[data-c=Web]").getAttribute("aria-pressed"), "true");
      assert.equal(await p.locator("#f-drop").inputValue(), "14.6397, 121.0775");
      await ed.locator(".req-on-order .photo-grid").waitFor();
      assert.match(await ed.innerText(), /The customer sent a proof of payment/);
      await p.locator("#f-vendor").selectOption("ana@example.com");
      await p.locator("#f-amount").fill("2500");
      await p.locator("#f-down").fill("2000");
      await p.locator("#f-method").selectOption("gcash");
      await shot(p, "accept-desktop");
      await p.evaluate(() => (window.__calls = []));
      await p.locator(".sheet button[type=submit]").click();
      await p.locator(".toast", { hasText: /R12 accepted · order #\d+/ }).waitFor();
      const sent = (await calls(p)).filter((c) => c.rpc === "cdf_request_accept");
      assert.equal(sent.length, 1); assert.equal(sent[0].args.p_id, "req-12");
      assert.equal(sent[0].args.p_price, 2500); assert.equal(sent[0].args.p_payment.amount, 2000); assert.equal(sent[0].args.p_order.channel, "Web");
      assert(!(await calls(p)).some((c) => c.action === "insert" && c.table === "cdf_orders"), "no separate insert");
      const after = await p.evaluate(() => { const r = window.__requests.find((x) => x.id === "req-12"); const o = window.__orders.find((x) => x.id === r.accepted_order_id);
        return { status: r.status, num: o?.num, left: window.__prices.find((x) => x.order_id === o?.id) }; });
      assert.equal(after.status, "accepted"); assert.equal(after.left.amount - after.left.paid, 500);
      assert.equal(await p.locator("#tabRequestsCount").innerText(), "1");
      assert.equal(await p.evaluate(() => localStorage.getItem("cdf-draft")), null, "no draft left for an accepted request");
      // The order now shows where it came from, with the customer's photos
      await p.evaluate(() => { const r = window.__requests.find((x) => x.id === "req-12"); openOrder(S.orders.find((o) => o.id === r.accepted_order_id)); });
      await p.locator(".sheet .req-on-order h3", { hasText: "Customer's photos · R12" }).waitFor();
      assert.equal(await p.locator(".sheet .req-on-order .photo-grid .pic").count(), 2);
      assert.match(await p.locator(".sheet .req-on-order").innerText(), /not verified/);
      await p.context().close();
    });

    await step("A lost answer while accepting: saving again returns the same order, never a second one", async () => {
      const p = await open("admin");
      await toRequests(p);
      await p.locator('.req-card[data-id="req-13"]').click();
      await p.getByRole("button", { name: "Accept and create order" }).click();
      await p.locator(".new-order-sheet").waitFor();
      assert.equal(await p.locator("#f-addr").inputValue(), "Pickup at the shop");
      assert.match(await p.locator("#f-notes").inputValue(), /PICKUP AT THE SHOP/);
      assert.equal(await p.locator("#f-same").isChecked(), true, "buyer and receiver are the same person");
      await p.locator("#f-amount").fill("1500");
      await p.evaluate(() => { window.__acceptLost = true; window.__calls = []; });
      await p.locator(".sheet button[type=submit]").click();
      await p.getByRole("button", { name: "Save anyway" }).click().catch(() => {});
      await p.locator(".sheet .err", { hasText: "Press Save again" }).waitFor();
      await p.locator(".sheet button[type=submit]").click();
      await p.getByRole("button", { name: "Save anyway" }).click().catch(() => {});
      await p.locator(".toast", { hasText: "R13 accepted" }).waitFor();
      const sent = (await calls(p)).filter((c) => c.rpc === "cdf_request_accept");
      assert.equal(sent.length, 2); assert.equal(sent[1].args.p_request, sent[0].args.p_request); assert.equal(sent[1].args.p_order.id, sent[0].args.p_order.id);
      assert.equal(await p.evaluate(() => window.__orders.filter((o) => o.address === "Pickup at the shop").length), 1);
      await p.context().close();
    });

    await step("Another admin accepted it meanwhile: saving says so and creates nothing", async () => {
      const p = await open("admin");
      await toRequests(p);
      await p.locator('.req-card[data-id="req-12"]').click();
      await p.getByRole("button", { name: "Accept and create order" }).click();
      await p.locator(".new-order-sheet").waitFor();
      const before = await p.evaluate(() => window.__orders.length);
      await p.evaluate(() => { window.__acceptTakenBy = "admin2"; });
      await p.locator(".sheet button[type=submit]").click();
      await p.getByRole("button", { name: "Save anyway" }).click().catch(() => {});
      await p.locator(".sheet .err", { hasText: "Someone else on the team already accepted this request." }).waitFor();
      assert.equal(await p.evaluate(() => window.__orders.length), before);
      await p.context().close();
    });

    await step("A new request arriving: a short notice with its reference only, the counter goes up, and it opens from there", async () => {
      const p = await open("admin");
      await p.evaluate(() => {
        const r = { ...window.__requests[0], id: "req-14", ref: 14, request_key: "k14", status: "received", buyer_name: "Ana Reyes", created_at: new Date().toISOString() };
        window.__requests.push(r); window.__realtimeRequest({ eventType: "INSERT", new: r });
      });
      const t = p.locator(".toast", { hasText: "New request · R14" });
      await t.waitFor();
      assert(!/Ana|Reyes|Katipunan/.test(await t.innerText()));
      assert.equal(await p.locator("#tabRequestsCount").innerText(), "3");
      await t.getByRole("button", { name: "View" }).click();
      await p.locator(".req-sheet h2", { hasText: "Request R14" }).waitFor();
      await p.context().close();
    });

    await step("The notice on the phone opens the request directly (?request=…)", async () => {
      const p = await open("admin", { query: "?request=req-13" });
      await p.locator(".req-sheet h2", { hasText: "Request R13" }).waitFor();
      assert.equal(await p.locator("#tabRequests").getAttribute("aria-current"), "page");
      await p.context().close();
    });

    await step("The florist of an order from a request sees the customer's reference photos, not the payment proof", async () => {
      const p = await open("vendor");
      const o = await p.evaluate(() => S.orders.find((x) => x.id === "11111111-1111-1111-1111-111111111111"));
      assert(o, "the florist's own order");
      await p.evaluate((id) => openOrder(S.orders.find((x) => x.id === id)), o.id);
      await p.locator(".sheet .req-on-order h3", { hasText: "Customer's photos · R7" }).waitFor();
      assert.equal(await p.locator(".sheet .req-on-order .photo-grid .pic").count(), 1);
      assert.equal(await p.locator(".sheet .req-proof-on-order").count(), 0);
      await p.context().close();
    });

    await step("Phone: the list, a request and the accept form fit the screen; Spanish works", async () => {
      const p = await open("admin", { width: 390, lang: "es" });
      await p.locator("#navOpen").click();
      await p.locator("#tabRequests").click();
      await p.locator("#requestsView:not([hidden])").waitFor();
      assert.equal(await p.locator("#requestsView h2").innerText(), "Solicitudes");
      await noOverflow(p); await shot(p, "list-mobile");
      await p.locator('.req-card[data-id="req-12"]').click();
      await p.locator(".req-sheet").waitFor();
      assert.match(await p.locator(".req-sheet").innerText(), /Sin verificar/);
      await p.waitForTimeout(700); await noOverflow(p); await shot(p, "detail-mobile");
      await p.getByRole("button", { name: "Aceptar y crear pedido" }).click();
      await p.locator(".new-order-sheet").waitFor();
      assert.equal(await p.locator(".new-order-sheet h2").innerText(), "Crear pedido desde R12");
      await p.waitForTimeout(700); await noOverflow(p); await shot(p, "accept-mobile");
      await p.context().close();
    });

    assert.deepEqual([...new Set(errors)], [], "no page errors");
  } finally {
    await browser.close(); server.close();
  }
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
