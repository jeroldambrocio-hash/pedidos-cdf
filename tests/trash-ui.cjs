// The trash and the Requests tab by type (12/11/2026), in the panel, against the fake Supabase of ui-smoke.cjs
// (whose trash answers mirror the database functions; tests/trash-db.cjs checks those for real).
//   · Move to trash explains cancel / archive / trash, asks why; the order leaves every list; Restore brings
//     back the same order; a rider on it blocks; only the owner gets "Delete for good"; florists see none of it.
//   · Requests: every pending one is loaded (an old one behind 320 newer closed ones too); status and type
//     filters work together with consistent counts; cards say Pickup / Delivery and show what matters for each;
//     an accepted request whose order is in the trash or deleted says so (the R2 → #0007 case).
// Run: NODE_PATH=.test-tools/node_modules node tests/trash-ui.cjs   (screenshots in .impeccable/review/trash-*.png)
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), out = path.join(root, ".impeccable/review");
fs.mkdirSync(out, { recursive: true });
const mockFile = path.join(out, "mock-supabase-trash.js");
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile } });
const mock = fs.readFileSync(mockFile, "utf8");

const seed = () => {
  window.__ana = { branch: "Quezon City", pickup_address: "12 Visayas Ave, Quezon City", pickup_lat: 14.6538, pickup_lng: 121.045 };
  const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  let ref = 0;
  const R = (extra) => ({ id: "req-" + (++ref), ref, request_key: "k" + ref, status: "received", lang: "en", buyer_name: "Jose Santos", buyer_phone: "+34612345678",
    receiver_name: "Maria Santos", receiver_phone: "+639171234567", mode: "delivery", date: day(2), slot: "11:00 - 13:00",
    address: "Unit 4B, 123 Katipunan Ave, Quezon City", lat: 14.64, lng: 121.07, location_source: "search", location_confirmed_at: new Date().toISOString(),
    description: "Roses", special_requests: "", card_message: "", payment_method: "gcash", created_at: new Date(Date.now() - ref * 60e3).toISOString(),
    reviewed_by: null, reject_reason: null, accepted_order_id: null, accepted_key: null, pickup_branch: null, accepted_order_num: null, ...extra });
  const pick = { mode: "pickup", address: "", lat: null, lng: null, location_source: null, location_confirmed_at: null, pickup_branch: "Quezon City", receiver_name: "Liza Cruz" };
  window.__requests = [
    R({}), R({ receiver_name: "Jose Santos" }), R(pick),
    // R2 → #0007: accepted, then its order deleted for good before the trash existed
    R({ ...pick, buyer_name: "Kober Mananlo", receiver_name: "Kober Mananlo", status: "accepted", accepted_key: "x", accepted_order_num: "0007" }),
    R({ status: "rejected", reject_reason: "Out of stock" }),
  ];
  if (window.__many) {
    // An old request still to review, behind 320 newer closed ones: the panel must not lose it
    window.__requests.push(R({ ...pick, buyer_name: "Old Pending", receiver_name: "Old Pending", created_at: new Date(Date.now() - 40 * 864e5).toISOString() }));
    for (let i = 0; i < 320; i++) window.__requests.unshift(R({ status: "rejected", created_at: new Date(Date.now() - i * 1000).toISOString() }));
  }
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
  const open = async (role, { width = 1280, query = "", lang = "en", owner = false, many = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-PH", reducedMotion: "reduce" });
    await ctx.addInitScript(([r, s, l, ow, mn]) => { window.__role = r; window.__owner = ow; window.__many = mn; try { localStorage.setItem("cdf-lang", l); } catch {} (0, eval)("(" + s + ")")(); }, [role, String(seed), lang, owner, many]);
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
  const toRequests = async (p) => { await p.evaluate(() => { closeSheet(true); setTab("requests"); }); await p.locator("#requestsView:not([hidden])").waitFor(); };

  const shot = (p, n) => p.screenshot({ path: path.join(out, "trash-" + n + ".png") });
  const firstOrder = (p) => p.evaluate(() => { const o = S.orders.find((x) => x.date === S.today && !x.cancelled_at && !x.archived_at); return { id: o.id, num: o.num }; });
  const visible = (p, id) => p.evaluate((id) => S.orders.some((o) => o.id === id), id);

  try {
    await step("Move to trash: explains cancel / archive / trash, needs a reason, hides the order; Restore brings back the same one", async () => {
      const p = await open("admin", { width: 390 });
      const o = await firstOrder(p), total = await p.evaluate(() => window.__orders.length);
      await p.evaluate((id) => openOrder(S.orders.find((x) => x.id === id)), o.id);
      await p.locator(".sheet .foot-act", { hasText: "Move to trash" }).click();
      const sheet = p.locator(".sheet", { hasText: "What do you want to do" });
      await sheet.waitFor();
      const text = await sheet.innerText();
      for (const x of [/Cancel order/, /stays on its day as cancelled/, /Archive/, /leaves the day view/, /Move to trash/, /restored for 30 days/]) assert.match(text, x);
      await shot(p, "1-ask");
      await sheet.locator("button[type=submit]").click();
      await sheet.getByText("Write the reason").waitFor();
      await sheet.locator("textarea").fill("Duplicate of another order");
      await sheet.locator("button[type=submit]").click();
      await p.locator(".toast", { hasText: `Order #${o.num} moved to trash` }).waitFor();
      assert.equal(await visible(p, o.id), false);
      assert.equal(await p.locator(`article.order[data-order="${o.id}"]`).count(), 0);
      // The trash: who, when, why, days left
      await p.evaluate(() => openTrash());
      const item = p.locator(`.trash-item[data-id="${o.id}"]`);
      await item.waitFor();
      assert.match(await item.innerText(), /Moved by Jerold/); assert.match(await item.innerText(), /Duplicate of another order/); assert.match(await item.innerText(), /30 days left/);
      assert.equal(await item.getByRole("button", { name: "Delete for good" }).count(), 0, "not the owner");
      assert.match(await p.locator(".trash-sheet").innerText(), /Only the owner can delete them for good/);
      await shot(p, "2-list");
      await item.getByRole("button", { name: "Restore" }).click();
      await p.locator(".toast", { hasText: `Order #${o.num} restored` }).waitFor();
      await p.waitForFunction((id) => S.orders.some((o) => o.id === id), o.id);
      assert.equal(await p.evaluate(() => window.__orders.length), total, "the same order, not a copy");
      await p.context().close();
    });

    await step("A rider on the order: trashing is refused by the server and explained", async () => {
      const p = await open("admin");
      const o = await firstOrder(p);
      await p.evaluate((id) => { window.__orders.find((x) => x.id === id).__rider = true; trashDialog(S.orders.find((x) => x.id === id)); }, o.id);
      await p.locator(".sheet textarea").fill("Wrong order");
      await p.locator(".sheet button[type=submit]").click();
      await p.locator(".sheet .err", { hasText: "active Lalamove rider" }).waitFor();
      assert.equal(await visible(p, o.id), true);
      await p.context().close();
    });

    await step("Owner only: Delete for good (asks why, says what stays); the order's request then says it was deleted", async () => {
      const p = await open("admin", { owner: true });
      const o = await firstOrder(p);
      // This order came from a request
      await p.evaluate((o) => { const r = window.__requests.find((x) => x.ref === 1); Object.assign(r, { status: "accepted", accepted_key: "y", accepted_order_id: o.id, accepted_order_num: o.num }); }, o);
      await p.evaluate((id) => sb.rpc("cdf_order_trash", { p_id: id, p_reason: "Test order" }), o.id);
      await p.evaluate(() => openTrash());
      const item = p.locator(`.trash-item[data-id="${o.id}"]`);
      assert.match(await p.locator(".trash-sheet").innerText(), /As the owner/);
      await item.getByRole("button", { name: "Delete for good" }).click();
      const sheet = p.locator(".sheet", { hasText: "for good" });
      const txt = await sheet.innerText();
      assert.match(txt, /can't be undone/); assert.match(txt, /payment proofs and Lalamove proofs/); assert.match(txt, /Only a record stays/);
      await sheet.locator("textarea").fill("Never needed");
      await sheet.locator("input[inputmode=numeric]").fill("9999");
      await sheet.locator("button[type=submit]").click();
      await sheet.getByText("The number doesn't match").waitFor();
      assert.equal(await p.evaluate((id) => window.__orders.some((x) => x.id === id), o.id), true, "nothing deleted on a wrong number");
      await shot(p, "5-purge");
      await sheet.locator("input[inputmode=numeric]").fill(o.num);
      await sheet.locator("button[type=submit]").click();
      await p.locator(".toast", { hasText: `Order #${o.num} deleted for good` }).waitFor();
      assert(await p.evaluate(() => window.__calls.some((c) => c.function === "cdf-order-purge" && c.args.body.reason === "Never needed")), "through the server function");
      assert.equal(await p.evaluate((id) => window.__orders.some((x) => x.id === id), o.id), false);
      await toRequests(p);
      await p.evaluate(() => loadRequests());   // in the app, Realtime brings the request's change
      await p.locator(".req-filter button[data-f=accepted]").click();
      assert.match(await p.locator('.req-card[data-id="req-1"]').innerText(), new RegExp(`Order #${o.num} deleted`));
      await p.locator('.req-card[data-id="req-1"]').click();
      assert.match(await p.locator(".req-sheet .req-order-note").innerText(), /deleted/);
      assert.match(await p.locator(".req-sheet .req-order-note").innerText(), /Never needed/);
      await p.context().close();
    });

    await step("Florists: no trash, no delete", async () => {
      const p = await open("vendor");
      assert.equal(await p.locator("#trashBtn").count(), 0);
      await p.context().close();
    });

    await step("Requests: status and type filters together, with consistent counts; cards say Pickup / Delivery", async () => {
      const p = await open("admin", { width: 390 });
      await toRequests(p);
      const counts = async (sel) => Object.fromEntries(await p.locator(sel + " button").evaluateAll((bs) => bs.map((b) => [b.dataset.f || b.dataset.k, +b.querySelector(".count").textContent])));
      assert.deepEqual(await counts("#reqFilter"), { open: 3, accepted: 1, rejected: 1 });
      assert.deepEqual(await counts("#reqKind"), { all: 3, pickup: 1, delivery: 2 });
      // Pickup: status counts count pickups only
      await p.locator('#reqKind button[data-k="pickup"]').click();
      assert.deepEqual(await counts("#reqFilter"), { open: 1, accepted: 1, rejected: 0 });
      assert.equal(await p.locator(".req-card").count(), 1);
      const pc = p.locator(".req-card.is-pickup");
      assert.match(await pc.locator(".req-kind").innerText(), /Pickup/);
      assert.match(await pc.innerText(), /Pickup at Quezon City/); assert.match(await pc.innerText(), /Picks up: Liza Cruz/);
      await shot(p, "3-requests-pickup");
      // Then Accepted: still pickups; the R2 → #0007 case
      await p.locator('#reqFilter button[data-f="accepted"]').click();
      assert.deepEqual(await counts("#reqKind"), { all: 1, pickup: 1, delivery: 0 });
      assert.match(await p.locator(".req-card").innerText(), /Order #0007 deleted/);
      await p.locator(".req-card").click();
      assert.match(await p.locator(".req-sheet .req-order-note").innerText(), /Order #0007 deleted/);
      assert.match(await p.locator(".req-sheet .req-order-note").innerText(), /before deletions were logged/);
      await shot(p, "4-r2");
      await p.evaluate(() => closeSheet(true));
      // Delivery: address, slot, buyer → recipient only when different
      await p.locator('#reqFilter button[data-f="open"]').click();
      await p.locator('#reqKind button[data-k="delivery"]').click();
      const cards = p.locator(".req-card.is-delivery");
      assert.equal(await cards.count(), 2);
      const texts = await cards.allInnerTexts();
      assert(texts.every((x) => /Delivery/.test(x) && /Katipunan/.test(x) && /11:00 – 13:00/.test(x)));
      assert(texts.some((x) => /Jose Santos → Maria Santos/.test(x)) && texts.some((x) => /Jose Santos/.test(x) && !/→/.test(x)));
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "fits a phone");
      await p.context().close();
    });

    await step("Every pending request is loaded: one 40 days old behind 320 newer closed ones still shows and counts", async () => {
      const p = await open("admin", { many: true });
      await toRequests(p);
      assert.equal(await p.locator('#reqFilter button[data-f="open"] .count').innerText(), "4");
      assert.equal(await p.locator("#tabRequestsCount").innerText(), "4");
      await p.locator('#reqKind button[data-k="pickup"]').click();
      assert.match(await p.locator("#requestsBody").innerText(), /Old Pending/);
      // Closed ones: the latest, with more on demand; the counter is the full one
      await p.locator('#reqKind button[data-k="all"]').click();
      await p.locator('#reqFilter button[data-f="rejected"]').click();
      assert.equal(await p.locator('#reqFilter button[data-f="rejected"] .count').innerText(), "321");
      assert.equal(await p.locator(".req-card").count(), 300);
      await p.getByRole("button", { name: "Load more" }).click();
      await p.waitForFunction(() => document.querySelectorAll(".req-card").length === 321);
      await p.context().close();
    });

    await step("No page errors", async () => { assert.deepEqual(errors, []); });
  } finally { await browser.close(); server.close(); }
  if (failed) { console.log(failed + " failed"); process.exit(1); }
})();
