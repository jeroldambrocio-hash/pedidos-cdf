// The map to put the delivery pin by hand (order form, Lalamove block, Team) and the required channel.
// Fake Supabase (ui-smoke.cjs) and a fake cdf-lalamove function; map tiles are not requested. Needs Google Chrome.
// NODE_PATH=.test-tools/node_modules node tests/map-channel.cjs  (screenshots in .impeccable/review/map-*.png)
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
      case "quote": {
        const o = S.orders.find((x) => x.id === body.order_id) || {}, at = body.schedule === "slot" ? "2030-01-01T01:15:00.000Z" : null;
        __ll.row = { order_id: body.order_id, lat: body.lat, lng: body.lng, place: body.place, service: body.service, quotation_id: "q1", quote_total: 112, quote_currency: "PHP", quote_expires: exp(),
          quote_for: { vendor: o.vendor_email || null, pickup: [14.6337, 121.0338], date: o.date, slot: o.slot, wanted: body.schedule, schedule: at } };
        return reply({ row: __ll.row, scheduleAt: at });
      }
      case "book": Object.assign(r, { ll_order_id: "LL1", status: "ASSIGNING_DRIVER", share_link: "https://share.sandbox.lalamove.com/x", price_total: 112 }); return reply({ row: r });
      case "refresh": return reply({ row: r });
      case "cancel": r.status = "CANCELED"; return reply({ row: r });
    }
    return { data: null, error: { message: "unknown" } };
  };
  // The table: reads return the fake row
  const from = sb.from.bind(sb);
  sb.from = (t) => t !== "cdf_lalamove" ? from(t) : (() => {
    const q = { select: () => q, limit: () => q, eq: () => q, in: () => q,
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
  const shot = (p, n) => p.screenshot({ path: path.join(out, "map-" + n + ".png") });
  const results = [];
  const step = async (name, fn) => { try { await fn(); results.push("ok   " + name); } catch (e) { results.push("FAIL " + name + " · " + e.message.split("\n").slice(0, 4).join(" | ")); } };
  const dlg = (p) => p.locator(".map-dialog");
  const mapReady = async (p) => { await dlg(p).waitFor(); await p.locator("#mapPick.leaflet-container").waitFor(); await p.locator(".map-pin").waitFor(); await p.waitForTimeout(500); };
  const pinAt = (p) => p.evaluate(() => document.querySelector(".map-where").textContent);
  const ord = () => S.orders.find((o) => o.status === "Ready" && !o.cancelled_at && o.vendor_email) || S.orders.find((o) => o.vendor_email);
  const withShop = async (f) => {
    const o = (0, eval)("(" + f + ")")(), shop = { pickup_lat: 14.6337, pickup_lng: 121.0338, pickup_address: "12 Tomas Morato Ave, Quezon City" };
    await sb.from("cdf_members").update(shop).eq("email", o.vendor_email); // in the fake database too: opening an order reads the team again
    Object.assign(S.members.find((x) => x.email === o.vendor_email), shop);
    S.cap.pickup = true; S.cap.drop = true;
    return o.id;
  };

  await step("Lalamove block: address not found → pin by hand on the map → saved on the order → price for that point", async () => {
    const p = await open("admin", 1280);
    await p.waitForTimeout(1000); // the first load of the team is over: what is set now stays
    const id = await p.evaluate(withShop, ord.toString());
    await p.evaluate((id) => { const o = S.orders.find((x) => x.id === id), d = (window.__orders || []).find((x) => x.id === id); for (const x of [o, d]) if (x) { x.drop_lat = null; x.drop_lng = null; } openOrder(o); }, id);
    const sec = p.locator("#lalamoveSection");
    await sec.waitFor({ state: "visible" }); await sec.scrollIntoViewIfNeeded();
    await sec.getByRole("button", { name: "Enviar con Lalamove" }).click();
    await sec.locator(".ll-search input").fill("123 nowhere street");
    await sec.getByRole("button", { name: "Marcar en el mapa" }).click();
    await mapReady(p);
    await p.getByText("No lo encuentro. Mueve el mapa").waitFor();
    assert(await p.locator("#mapUse").isDisabled(), "nothing to use until a point is chosen");
    const box = await p.locator("#mapPick").boundingBox();
    await p.mouse.click(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30);
    assert.match(await pinAt(p), /Punto elegido: 14\.\d+, 121\.\d+/);
    const first = await pinAt(p);
    const pin = await p.locator(".map-pin").boundingBox();
    await p.mouse.move(pin.x + pin.width / 2, pin.y + pin.height / 2); await p.mouse.down();
    await p.mouse.move(pin.x - 80, pin.y - 50, { steps: 8 }); await p.mouse.up();
    await p.waitForTimeout(200);
    assert.notEqual(await pinAt(p), first, "dragging the pin moves the point");
    await shot(p, "1-dialog");
    const chosen = (await pinAt(p)).match(/(-?\d+\.\d+), (-?\d+\.\d+)/).slice(1).map(Number);
    await p.locator("#mapUse").click();
    await dlg(p).waitFor({ state: "detached" });
    await sec.getByRole("button", { name: "Ver precio" }).waitFor();
    const o = await p.evaluate((id) => S.orders.find((x) => x.id === id), id);
    assert.equal(+o.drop_lat, chosen[0]); assert.equal(+o.drop_lng, chosen[1]);
    assert.equal(await p.locator("#f-drop").inputValue(), `${chosen[0]}, ${chosen[1]}`);
    assert.equal(await p.evaluate(() => sheet.dirty()), false, "the saved point is not a pending change in the form");
    await sec.getByRole("button", { name: "Ver precio" }).click();
    await sec.locator(".ll-price").waitFor();
    const q = await p.evaluate(() => __ll.calls.find((c) => c.action === "quote"));
    assert.equal(q.lat, chosen[0]); assert.equal(q.lng, chosen[1]); assert.equal(q.place, o.address, "the rider gets the order's written address");
    await p.context().close();
  });

  await step("Lalamove block: adjust the pin of a search result; Cancel and Escape change nothing", async () => {
    const p = await open("admin", 1280);
    await p.waitForTimeout(1000); // the first load of the team is over: what is set now stays
    const id = await p.evaluate(withShop, ord.toString());
    await p.evaluate((id) => { const o = S.orders.find((x) => x.id === id), d = (window.__orders || []).find((x) => x.id === id); for (const x of [o, d]) if (x) { x.drop_lat = null; x.drop_lng = null; } openOrder(o); }, id);
    const sec = p.locator("#lalamoveSection");
    await sec.waitFor({ state: "visible" });
    await sec.getByRole("button", { name: "Enviar con Lalamove" }).click();
    await sec.locator(".ll-search input").fill("Tomas Morato, Quezon City");
    await sec.locator(".ll-search input").press("Enter");
    await sec.locator(".ll-hit").first().click();
    await sec.getByRole("button", { name: "Ajustar el pin en el mapa" }).click();
    await mapReady(p);
    assert.match(await pinAt(p), /14\.6337, 121\.0338/, "opens on the point already chosen");
    assert(await p.locator("#mapUse").isEnabled());
    await p.keyboard.press("Escape");
    await dlg(p).waitFor({ state: "detached" });
    assert.equal(await p.locator(".sheet").count(), 1, "Escape closes the map, not the order");
    await sec.getByRole("button", { name: "Ajustar el pin en el mapa" }).click();
    await mapReady(p);
    await dlg(p).getByRole("button", { name: "Cancelar" }).click();
    await dlg(p).waitFor({ state: "detached" });
    assert.equal(+(await p.evaluate((id) => S.orders.find((x) => x.id === id).drop_lat, id)), 14.6337);
    await p.context().close();
  });

  await step("Florist: an order with a saved point can't be moved from the Lalamove block (the office corrects it)", async () => {
    const p = await open("vendor", 1280);
    const id = await p.evaluate(() => { const o = S.orders.find((x) => x.vendor_email === S.me.email && x.status === "Ready" && !x.cancelled_at) || S.orders.find((x) => x.vendor_email === S.me.email);
      Object.assign(S.me, { pickup_lat: 14.6337, pickup_lng: 121.0338, pickup_address: "12 Tomas Morato Ave, Quezon City" }); S.cap.pickup = true; S.cap.drop = true;
      Object.assign(o, { status: "Ready", delivery: "-", drop_lat: 14.55, drop_lng: 121.02 }); openOrder(o); return o.id; });
    const sec = p.locator("#lalamoveSection");
    await sec.waitFor({ state: "visible" });
    await sec.getByRole("button", { name: "Cambiar dirección" }).click();
    await sec.getByRole("button", { name: "Marcar en el mapa" }).click();
    await mapReady(p);
    const box = await p.locator("#mapPick").boundingBox();
    await p.mouse.click(box.x + box.width / 2 + 90, box.y + box.height / 2 + 60);
    await p.locator("#mapUse").click();
    await p.locator(".toast", { hasText: "lo corrige la oficina" }).waitFor();
    assert.equal(+(await p.evaluate((id) => S.orders.find((x) => x.id === id).drop_lat, id)), 14.55);
    assert.equal(await p.evaluate(() => __ll.calls.filter((c) => c.action === "quote").length), 0);
    await p.context().close();
  });

  await step("New order on a phone: Pick on the map fills the point; the channel is required to save", async () => {
    const p = await open("admin", 390);
    await p.evaluate(() => { localStorage.removeItem("cdf-draft"); S.cap.drop = true; });
    await p.evaluate(() => document.getElementById("newBtn").click());
    await p.locator("#f-addr").fill("123 nowhere street");
    await p.locator("#f-dropmap").click();
    await mapReady(p);
    assert(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "no sideways scroll with the map open");
    const box = await p.locator("#mapPick").boundingBox();
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 20);
    await shot(p, "2-phone");
    const chosen = (await pinAt(p)).match(/(-?\d+\.\d+), (-?\d+\.\d+)/).slice(1).map(Number);
    await p.locator("#mapUse").click();
    await dlg(p).waitFor({ state: "detached" });
    assert.equal(await p.locator("#f-drop").inputValue(), `${chosen[0]}, ${chosen[1]}`);
    await p.locator("#f-num").fill("1901");
    await p.locator(".slot-pick select").nth(0).selectOption("540");
    await p.locator("#f-bname").fill("Buyer test"); await p.locator("#f-bphone").fill("0917 555 0101");
    await p.evaluate(() => { const c = document.getElementById("f-same"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); });
    await p.locator(".sheet button[type=submit]").click();
    await p.locator(".sheet .err", { hasText: "Elige el canal del pedido" }).waitFor();
    assert(await p.locator(".chan-pick.invalid").count(), "the channel picker is marked");
    assert.equal(await p.evaluate(() => S.orders.some((o) => o.num === "1901")), false, "nothing saved without a channel");
    await shot(p, "3-channel");
    await p.locator(".chan-opt[data-c=Instagram]").click();
    assert.equal(await p.locator(".chan-pick.invalid").count(), 0);
    await p.locator(".sheet button[type=submit]").click();
    await p.locator(".dialog").getByRole("button", { name: "Guardar igualmente" }).click();
    await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
    const o = await p.evaluate(() => S.orders.find((x) => x.num === "1901"));
    assert.equal(o.channel, "Instagram"); assert.equal(+o.drop_lat, chosen[0]); assert.equal(+o.drop_lng, chosen[1]);
    await p.context().close();
  });

  await step("Editing an order without a channel also asks for it", async () => {
    const p = await open("admin", 1280);
    await p.evaluate(() => { const o = S.orders.find((x) => !x.cancelled_at && !x.archived_at); o.channel = ""; openOrder(o); });
    await p.locator("#f-addr").fill("Changed address 9");
    await p.locator(".sheet button[type=submit]").click();
    await p.locator(".sheet .err", { hasText: "Elige el canal del pedido" }).waitFor();
    await p.context().close();
  });

  await step("Team: the florist's shop point from the map", async () => {
    const p = await open("admin", 1280);
    const email = await p.evaluate(() => { S.cap.pickup = true; const m = S.members.find((x) => x.role === "vendor"); editMember(m); return m.email; });
    await p.locator("#ePickAddr").fill("12 Tomas Morato Ave, Quezon City");
    await p.locator("#ePickMap").click();
    await mapReady(p);
    assert.match(await pinAt(p), /14\.6337, 121\.0338/, "centred on what the shop address finds");
    await p.locator("#mapUse").click();
    await dlg(p).waitFor({ state: "detached" });
    assert.equal(await p.locator("#ePickPoint").inputValue(), "14.6337, 121.0338");
    await p.locator(".dialog .btn.primary").click();
    await p.locator(".dialog").waitFor({ state: "detached" });
    assert.equal(+(await p.evaluate((e) => S.members.find((m) => m.email === e).pickup_lat, email)), 14.6337);
    await p.context().close();
  });

  await step("No uncaught JavaScript errors", async () => assert.deepEqual(errors, []));
  console.log(results.join("\n"));
  await browser.close(); server.close();
  process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
})();
