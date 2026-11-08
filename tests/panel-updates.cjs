// 8/11/2026 changes, against the fake Supabase of ui-smoke.cjs (no real requests). Needs Google Chrome.
// NODE_PATH=.test-tools/node_modules node tests/panel-updates.cjs   (screenshots in .impeccable/review/panel-*.png)
// - no bouquet photo (editor, florist's Ready step, florist view)
// - internal note between the card message and the reference photo
// - "More details": bouquet price in ₱ (always, for the admin) and several photos
// - office view: Day / 7 days / 30 days / Dates
// - chat: only the team channel
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), out = path.join(root, ".impeccable/review");
fs.mkdirSync(out, { recursive: true });
const mockFile = path.join(out, "mock-supabase.js");
execFileSync(process.execPath, [path.join(__dirname, "ui-smoke.cjs")], { env: { ...process.env, EXPORT_MOCK: mockFile } });
const mock = fs.readFileSync(mockFile, "utf8");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

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
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: "chrome" }), errors = [];
  const open = async (role, width = 1280) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: "es-ES", reducedMotion: "reduce" });
    await ctx.addInitScript((r) => { window.__role = r; try { localStorage.setItem("cdf-lang", "es"); } catch {} }, role);
    await ctx.route("**/*", (route) => {
      const u = route.request().url();
      if (u.includes("supabase.min.js")) return route.fulfill({ body: mock, contentType: "text/javascript" });
      if (!u.startsWith(base)) return route.fulfill({ body: "", contentType: "text/css" });
      return route.continue();
    });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    p.on("pageerror", (e) => errors.push(role + ": " + e.message));
    await p.goto(base + "/");
    await p.locator("#list").waitFor({ state: "visible" });
    await p.waitForTimeout(400);
    return p;
  };
  const step = async (name, fn) => { await fn(); console.log("ok " + name); };
  try {
    const a = await open("admin");

    await step("editor: no bouquet photo; note between card message and reference photo", async () => {
      await a.evaluate(() => openOrder(S.orders.find((o) => o.status === "Preparing") || S.orders[0]));
      const sheet = a.locator(".sheet");
      await sheet.waitFor();
      assert.equal(await sheet.getByText("Foto del ramo", { exact: true }).count(), 0, "bouquet photo still there");
      const order = await a.evaluate(() => {
        const pos = (n) => n ? [...document.querySelectorAll(".sheet .field, .sheet section")].indexOf(n.closest(".field")) : -1;
        return { card: pos(document.getElementById("f-card") || document.querySelector(".sheet textarea[id*=card]")), note: pos(document.getElementById("f-notes") || document.querySelector(".sheet textarea[id*=note]")), photo: pos([...document.querySelectorAll(".sheet .field")].find((f) => /referencia/i.test(f.textContent))) };
      });
      assert(order.card >= 0 && order.note > order.card && order.photo > order.note, "order " + JSON.stringify(order));
      // and the note is not hidden inside "More details"
      assert.equal(await a.locator(".sheet details.hist .details-body").getByText("Nota interna", { exact: true }).count(), 0);
    });

    await step("More details: bouquet price in ₱/PHP and several photos, saved", async () => {
      const sheet = a.locator(".sheet");
      const more = sheet.locator("details.hist").filter({ hasText: "Más detalles" });
      if (!(await more.evaluate((d) => d.open))) await more.locator("summary").click();
      const price = more.locator("#f-amount");
      await price.waitFor();
      assert.match(await more.locator(".peso-input").innerText(), /₱[\s\S]*PHP/);
      await price.fill("2500");
      assert(await more.locator(".photo-add").count(), "no add-photos button");
      await more.locator('.photo-grid + input[type=file]').setInputFiles([{ name: "a.png", mimeType: "image/png", buffer: png }, { name: "b.png", mimeType: "image/png", buffer: png }]);
      await more.locator(".photo-tile").nth(1).waitFor();
      await a.screenshot({ path: path.join(out, "panel-more-details.png") });
      await sheet.locator(".sheet-foot .btn.primary").click();
      await sheet.waitFor({ state: "detached" });
      const calls = await a.evaluate(() => window.__calls);
      const ups = calls.filter((c) => c.upload === "cdf-entregas");
      assert.equal(ups.length, 2, "uploads " + JSON.stringify(ups));
      const saved = await a.evaluate(() => S.orders.find((o) => o.extra_photos?.length));
      assert(saved && saved.extra_photos.length === 2, "extra_photos not saved");
      assert.equal(saved.amount, 2500, "price not saved: " + saved?.amount);
    });

    await step("photos come back and one can be removed", async () => {
      await a.evaluate(() => openOrder(S.orders.find((o) => o.extra_photos?.length)));
      const more = a.locator(".sheet details.hist").filter({ hasText: "Más detalles" });
      assert(await more.evaluate((d) => d.open), "More details should open when there are photos");
      await more.locator(".photo-tile").nth(1).waitFor();
      await more.locator(".photo-x").first().click();
      assert.equal(await more.locator(".photo-tile").count(), 1);
      await a.locator(".sheet .sheet-foot .btn.primary").click();
      await a.locator(".sheet").waitFor({ state: "detached" });
      assert.equal(await a.evaluate(() => S.orders.find((o) => o.extra_photos?.length)?.extra_photos.length), 1);
      assert(await a.evaluate(() => window.__calls.some((c) => c.remove === "cdf-entregas")), "removed file not deleted");
    });

    await step("a price that hadn't loaded is fetched and never wiped by saving", async () => {
      const id = await a.evaluate(() => { const o = S.orders.find((x) => !x.extra_photos?.length); delete o.amount; window.__prices.find((p) => p.order_id === o.id).amount = 1800; return o.id; });
      await a.evaluate((id) => openOrder(S.orders.find((o) => o.id === id)), id);
      const more = a.locator(".sheet details.hist").filter({ hasText: "Más detalles" });
      if (!(await more.evaluate((d) => d.open))) await more.locator("summary").click();
      await a.waitForFunction(() => document.getElementById("f-amount")?.value === "1800");
      await a.locator("#f-notes").fill("Edited note");
      await a.locator(".sheet .sheet-foot .btn.primary").click();
      await a.locator(".sheet").waitFor({ state: "detached" });
      assert.equal(await a.evaluate((id) => window.__prices.find((p) => p.order_id === id).amount, id), 1800);
    });

    await step("office view: Day, 7 days, 30 days, Dates", async () => {
      const seg = a.locator("#periodSeg");
      await seg.waitFor();
      const dayLabel = await a.locator("#dLabel").innerText();
      await seg.getByRole("button", { name: "7 días" }).click();
      await a.waitForTimeout(300);
      const l7 = await a.locator("#dLabel").innerText();
      assert(l7.includes("–") && l7 !== dayLabel, "7-day label " + l7);
      assert.equal(await a.locator("#cal button.in-period").count() >= 1, true);
      const in7 = await a.locator("#list .entry").count();
      await seg.getByRole("button", { name: "30 días" }).click();
      await a.waitForTimeout(300);
      assert(await a.locator("#list .entry").count() >= in7, "30 days shows fewer than 7");
      await seg.getByRole("button", { name: "Fechas" }).click();
      await a.locator("#periodDates").waitFor();
      const today = await a.evaluate(() => S.today);
      await a.locator("#periodFrom").fill(await a.evaluate(() => addDays(S.today, 1)));
      await a.locator("#periodTo").fill(await a.evaluate(() => addDays(S.today, 1)));
      await a.locator("#periodTo").dispatchEvent("change");
      await a.waitForTimeout(300);
      const dates = await a.evaluate(() => [...document.querySelectorAll("#list .entry[data-id]")].map((e) => S.orders.find((o) => o.id === e.dataset.id)?.date));
      assert(dates.every((d) => d === undefined || d === addDaysNode(today, 1) || (d < today)), "outside the dates: " + dates);
      await a.screenshot({ path: path.join(out, "panel-period.png") });
      await a.locator("#todayBtn").click();
      await a.waitForTimeout(300);
      assert.equal(await seg.locator('button[aria-pressed="true"]').innerText(), "Día");
      assert.equal(await a.locator("#dLabel").innerText(), dayLabel);
    });

    await step("chat: only the team channel; nothing about it on orders", async () => {
      assert.equal(await a.locator(".chat-chip").count(), 0, "chat chips on cards");
      await a.evaluate(() => openOrder(S.orders[0]));
      await a.locator(".sheet").waitFor();
      assert.equal(await a.locator(".sheet #chatSection").count(), 0, "order conversation still there");
      await a.evaluate(() => closeSheet(true));
      await a.locator("#tabChat").click();
      await a.locator("#chatList .thread").first().waitFor();
      assert.equal(await a.locator("#chatList .thread").count(), 1, "more than the team thread");
      assert.equal(await a.locator(".chat-direct-picker").count(), 0, "private chats still offered");
      await a.screenshot({ path: path.join(out, "panel-chat.png") });
    });
    await a.context().close();

    await step("florist: Ready needs no photo; no bouquet in the order view", async () => {
      const v = await open("vendor", 390);
      const btn = v.locator(".to-ready").first();
      await btn.waitFor();
      await btn.click();
      await v.waitForTimeout(500);
      assert.equal(await v.locator(".sheet").count(), 0, "a dialog opened");
      assert(await v.evaluate(() => window.__calls.some((c) => c.rpc === "cdf_progress" || c.function === "cdf-notify") || S.orders.some((o) => o.status === "Ready")));
      await v.evaluate(() => openOrderView(S.orders[0]));
      await v.locator(".sheet").waitFor();
      assert.equal(await v.locator(".sheet").getByText("Foto del ramo", { exact: true }).count(), 0);
      await v.context().close();
    });

    assert.deepEqual(errors, []);
    console.log("ok no page errors");
  } catch (e) { console.error("FAIL", e.message, errors); process.exitCode = 1; }
  finally { await browser.close(); server.close(); }
})();
function addDaysNode(s, n) { const [y, m, d] = s.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return x.toISOString().slice(0, 10); }
