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
      case "quote": {
        const o = S.orders.find((x) => x.id === body.order_id) || {}, at = body.schedule === "slot" ? "2030-01-01T01:15:00.000Z" : null;
        __ll.row = { order_id: body.order_id, lat: body.lat, lng: body.lng, place: body.place, service: body.service, quotation_id: "q1", quote_total: body.tier === "priority" ? 150 : 112, quote_currency: "PHP", quote_expires: exp(),
          quote_for: { vendor: o.vendor_email || null, pickup: [14.6337, 121.0338], date: o.date, slot: o.slot, wanted: body.schedule, schedule: at, tier: body.tier === "priority" ? "priority" : "regular" } };
        return reply({ row: __ll.row, scheduleAt: at });
      }
      case "book":
        // Audit F01: no clear answer from Lalamove → the attempt is held as unconfirmed
        if (__ll.lose) { Object.assign(r, { booking_state: "uncertain", booking_key: "k1", booking_started_at: new Date().toISOString(), error: "Sin respuesta clara de Lalamove: fetch failed" });
          return { data: null, error: { message: "Sin respuesta clara de Lalamove: fetch failed. La reserva queda pendiente de comprobar." } }; }
        Object.assign(r, { ll_order_id: "LL1", status: "ASSIGNING_DRIVER", share_link: "https://share.sandbox.lalamove.com/x", price_total: 112 }); return reply({ row: r });
      case "book_resolve":
        Object.assign(r, { booking_state: null, booking_key: null, error: body.ll_order_id ? null : "Sin reserva (comprobado por admin@example.com)" },
          body.ll_order_id ? { ll_order_id: body.ll_order_id, status: "ASSIGNING_DRIVER" } : {});
        return reply({ row: r });
      // Priority fee: the amount pressed is added to the fee so far; the price follows
      case "priority_fee": r.tip = (r.tip || 0) + body.add; r.price_total = 112 + r.tip; return reply({ row: r, priority_fee: r.tip, added: body.add });
      case "refresh": return reply({ row: r });
      case "cancel": r.status = "CANCELED"; return reply({ row: r });
    }
    return { data: null, error: { message: "unknown" } };
  };
  // The table: reads return the fake row
  const from = sb.from.bind(sb);
  sb.from = (t) => t !== "cdf_lalamove" ? from(t) : (() => {
    const q = { select: () => q, limit: () => q, eq: () => q, in: () => q, order: () => q, range: () => q,
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
    const ord = () => S.orders.find((o) => o.status === "Ready" && !o.cancelled_at && o.vendor_email) || S.orders.find((o) => o.vendor_email);
    // The florist of the order has no shop yet: the block says so and offers nothing
    const florist = await p.evaluate((f) => { const o = (0, eval)("(" + f + ")")(); const m = S.members.find((x) => x.email === o.vendor_email); delete m.pickup_lat; delete m.pickup_address; S.cap.pickup = true; openOrder(o); return m; }, ord.toString());
    const sec = p.locator("#lalamoveSection");
    await sec.waitFor({ state: "visible" });
    await sec.scrollIntoViewIfNeeded();
    assert.match(await sec.innerText(), /Pruebas \(sandbox\)/i);
    assert.match(await sec.innerText(), new RegExp(florist.name + " aún no tiene dirección de recogida"));
    assert.equal(await sec.getByRole("button", { name: "Enviar con Lalamove" }).count(), 0);
    console.log("ok block shows for admin, sandbox label; no shop = no booking");
    await p.evaluate(() => closeSheet(true));

    // Team → edit the florist: shop address + Google Maps link
    await p.evaluate((email) => editMember(S.members.find((m) => m.email === email)), florist.email);
    await p.locator("#ePickAddr").fill("12 Tomas Morato Ave, Quezon City");
    await p.locator("#ePickPoint").fill("https://www.google.com/maps/place/x/@41.38,2.17,17z");
    await p.locator(".dialog .btn.primary").click();
    await p.getByText("No reconozco esa ubicación").waitFor();
    await p.locator("#ePickPoint").fill("https://www.google.com/maps/place/Shop/@14.6337,121.0338,17z/data=x");
    await p.locator(".dialog .btn.primary").click();
    await p.locator(".dialog").waitFor({ state: "detached" });
    const saved = await p.evaluate((email) => S.members.find((m) => m.email === email), florist.email);
    assert.equal(saved.pickup_address, "12 Tomas Morato Ave, Quezon City");
    assert.equal(+saved.pickup_lat, 14.6337); assert.equal(+saved.pickup_lng, 121.0338);
    console.log("ok florist's shop set from a Google Maps link (a point outside the Philippines is refused)");

    await p.evaluate((f) => openOrder((0, eval)("(" + f + ")")()), ord.toString());
    await sec.waitFor({ state: "visible" });
    await sec.scrollIntoViewIfNeeded();
    assert.match(await sec.innerText(), /Recoge en .*Tomas Morato/);
    await shot(p, "1-start"); await noOverflow(p);
    console.log("ok block names the pickup shop");

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

    // Delivery type: Regular unless Priority is chosen; the price and the label follow, and the choice is kept
    const tierSel = sec.locator("select").filter({ has: p.locator('option[value="priority"]') });
    assert.equal(await tierSel.inputValue(), "regular");
    await tierSel.selectOption("priority");
    await sec.getByRole("button", { name: "Ver precio" }).click();
    await sec.locator(".ll-price").waitFor();
    assert.match(await sec.locator(".ll-line").innerText(), /₱150[\s\S]*Priority/);
    assert.equal(await p.evaluate(() => __ll.calls.filter((c) => c.action === "quote").pop().tier), "priority");
    await sec.getByRole("button", { name: "Cambiar dirección" }).click();
    await sec.locator(".ll-search input").fill("Tomas Morato, Quezon City"); await sec.locator(".ll-search input").press("Enter");
    await sec.locator(".ll-hit").first().click();
    assert.equal(await tierSel.inputValue(), "priority", "the last type used for this order is offered again");
    await tierSel.selectOption("regular");
    await sec.getByRole("button", { name: "Ver precio" }).click();
    await sec.locator(".ll-price").waitFor();
    assert.match(await sec.locator(".ll-price").innerText(), /₱112/);
    assert.match(await sec.locator(".ll-line").innerText(), /Regular/);
    const q = await p.evaluate(() => __ll.calls.filter((c) => c.action === "quote").pop());
    assert.equal(q.lat, 14.6337); assert.equal(q.service, "MOTORCYCLE"); assert.equal(q.tier, "regular");
    await shot(p, "3-price"); await noOverflow(p);
    console.log("ok price shown, quote sent with the picked point");

    const book = sec.getByRole("button", { name: "Reservar rider" });
    if (await book.count()) {
      await book.click();
      await p.locator("#dialogRoot").getByText("no se cobra nada").waitFor();
      await p.locator("#dialogRoot .btn.primary").click();
      await sec.getByText("Buscando rider").first().waitFor();
      // Still looking for a rider: a priority fee can be added, by button or typed; each asks first
      const tip = sec.locator(".ll-tip");
      await tip.waitFor();
      await tip.getByRole("button", { name: "+₱20" }).click();
      await p.locator("#dialogRoot").getByText("¿Añadir ₱20 de propina al rider?").waitFor();
      await p.locator("#dialogRoot").getByText("no se cobra nada").waitFor();
      await p.locator("#dialogRoot .btn.primary").click();
      await sec.getByText("ahora ₱20").waitFor();
      assert.match(await sec.locator(".ll-line").innerText(), /₱132/);
      await tip.getByRole("button", { name: "+₱50" }).click();
      await p.locator("#dialogRoot .btn:not(.primary)").first().click(); // changed their mind: nothing is sent
      assert.equal(await p.evaluate(() => __ll.calls.filter((c) => c.action === "priority_fee").length), 1);
      await sec.locator(".ll-tip-own").fill("abc"); await sec.locator(".ll-tip").getByRole("button", { name: "Añadir", exact: true }).click();
      await p.getByText("Escribe un importe en pesos enteros").first().waitFor();
      await sec.locator(".ll-tip-own").fill("35"); await sec.locator(".ll-tip").getByRole("button", { name: "Añadir", exact: true }).click();
      await p.locator("#dialogRoot .btn.primary").click();
      await sec.getByText("ahora ₱55").waitFor();
      assert.deepEqual(await p.evaluate(() => __ll.calls.filter((c) => c.action === "priority_fee").map((c) => c.add)), [20, 35]);
      assert.match(await sec.locator(".ll-line").innerText(), /₱167/);
      assert(await tip.getByRole("button", { name: "+₱100" }).evaluate((x) => x.getBoundingClientRect().height >= 40), "touch-sized");
      await shot(p, "3b-tip"); await noOverflow(p);
      console.log("ok priority fee: +20/+50/+100 or a typed amount, confirmed first, added to the fee so far, price updated");
      // Webhook → realtime: rider assigned
      await p.evaluate(() => { Object.assign(__ll.row, { status: "ON_GOING", driver_name: "Juan Dela Cruz", driver_plate: "NAB 1234", driver_phone: "+639171112222" }); });
      await sec.getByRole("button", { name: "Actualizar" }).click();
      await sec.getByText("Juan Dela Cruz").waitFor();
      assert.equal(await sec.locator(".ll-tip").count(), 0, "no priority fee once a rider has accepted");
      assert(await sec.locator('a[href="tel:+639171112222"]').count());
      await shot(p, "4-rider"); await noOverflow(p);
      console.log("ok booked with sandbox warning, rider shown");

      await sec.getByRole("button", { name: "Cancelar envío" }).click();
      await p.locator("#dialogRoot .btn.danger-solid").click();
      await sec.getByRole("button", { name: "Pedir otro rider" }).waitFor();
      console.log("ok cancel");
    // The customer's point saved with the order: booking goes straight to "Get price"
    await p.evaluate(() => closeSheet(true));
    await p.evaluate((f) => { S.cap.drop = true; const o = (0, eval)("(" + f + ")")(); Object.assign(o, { status: "Ready", delivery: "-" }); openOrder(o); }, ord.toString());
    if (!(await p.locator(".order-more").evaluate(node => node.open))) await p.locator(".order-more > summary").click(); // the pasted-link field is in More details
    await p.locator("#f-drop").waitFor();
    await p.locator("#f-drop").fill("https://www.google.com/maps/place/x/@41.38,2.17,17z");
    await p.locator(".sheet-foot .btn.primary").click();
    await p.getByText("No reconozco esa ubicación").first().waitFor();
    await p.locator("#f-drop").fill("https://www.google.com/maps/place/Home/@14.60,121.00,17z/data=!3d14.6123!4d121.0456");
    await p.getByText("Punto guardado").waitFor();
    await p.locator(".sheet-foot .btn.primary").click();
    await p.locator(".sheet").waitFor({ state: "detached" });
    const savedDrop = await p.evaluate(() => window.__calls.filter((c) => c.action === "update" && c.table === "cdf_orders" && "drop_lat" in (c.row || {})).pop()?.row);
    assert.equal(savedDrop?.drop_lat, 14.6123); assert.equal(savedDrop?.drop_lng, 121.0456);
    await p.evaluate((f) => { const o = (0, eval)("(" + f + ")")(); Object.assign(o, { drop_lat: 14.6123, drop_lng: 121.0456 }); __ll.row = null; }, ord.toString());
    await p.evaluate((f) => openOrder((0, eval)("(" + f + ")")()), ord.toString());
    const sec3 = p.locator("#lalamoveSection");
    await sec3.waitFor({ state: "visible" });
    await sec3.getByRole("button", { name: "Ver precio" }).first().click();
    await sec3.getByRole("button", { name: "Ver precio" }).first().click();
    await sec3.locator(".ll-price").waitFor();
    const q2 = await p.evaluate(() => __ll.calls.filter((c) => c.action === "quote").pop());
    assert.equal(q2.lat, 14.6123); assert.equal(q2.lng, 121.0456);
    console.log("ok customer point saved with the order (bad links refused); booking goes straight to the price");

    // Manual fallback: moves the order to On the way through the usual confirm
    const sec2 = p.locator("#lalamoveSection");
    await p.evaluate(() => closeSheet(true));
    await p.evaluate((f) => { const o = (0, eval)("(" + f + ")")(); Object.assign(o, { status: "Ready", delivery: "-" }); openOrder(o); }, ord.toString());
    await sec2.waitFor({ state: "visible" });
    await sec2.getByRole("button", { name: /sin Lalamove/ }).click();
    await p.locator("#dialogRoot .btn.primary").click();
    await p.locator(".sheet").waitFor({ state: "detached" });
    assert(await p.evaluate(() => window.__calls.some((c) => c.action === "update" && c.row?.delivery === "In transit")), "manual On the way didn't move the order");
    await p.evaluate(() => { const o = S.orders.find((x) => x.delivery === "In transit" && x.status === "Ready"); if (o) o.delivery = "-"; render(); });
    console.log("ok manual On the way without Lalamove");
    // Office card: Head out opens the Lalamove booking too
    await p.evaluate(() => closeSheet(true));
    const n0 = await p.evaluate(() => window.__calls.length);
    await p.locator("#list .order.k-ready").first().getByRole("button", { name: "Salir a repartir" }).click();
    await p.locator("#lalamoveSection").waitFor({ state: "visible" });
    assert(!(await p.evaluate((n) => window.__calls.slice(n).some((c) => c.rpc === "cdf_progress" || (c.action === "update" && c.table === "cdf_orders")), n0)), "office Head out moved the order by hand");
    console.log("ok office: Head out opens the rider booking");
    } else {
      assert.match(await sec.innerText(), /teléfono válido/);
      console.log("ok order without phone cannot be booked");
    }
    // The order form was never saved by any of this
    assert(!(await p.evaluate(() => (window.__calls || []).some((c) => (c.action === "update" || c.action === "insert") && c.table === "cdf_orders" && c.row?.delivery !== "In transit" && !("drop_lat" in (c.row || {}))))), "the Lalamove flow saved the order");
    await p.context().close();

    // Florist: books a rider for her own Ready order, from the card's button; not for orders that aren't Ready
    {
      const v = await open("vendor", 390);
      // As in real life: her shop is in her own profile; the team directory a florist loads has no addresses
      await v.evaluate(() => { S.members.forEach((m) => { delete m.pickup_address; delete m.pickup_lat; delete m.pickup_lng; }); Object.assign(S.me, { pickup_address: "Ana's shop, Quezon City", pickup_lat: 14.65, pickup_lng: 121.03 }); S.cap.pickup = true; renderAgenda?.(); render(); });
      await v.waitForTimeout(400);
      const readyCard = v.locator("article.work.k-ready").first();
      await readyCard.waitFor();
      // No Call / WhatsApp on her cards: the Lalamove rider is the one who contacts the customer
      assert.equal(await v.locator('article.work a[href^="tel:"], article.work a[href*="wa.me"]').count(), 0, "florist still has Call/WhatsApp");
      // "Head out" on her Ready order opens the rider booking instead of moving the order by hand
      const before = await v.evaluate(() => window.__calls.length);
      await readyCard.getByRole("button", { name: "Salir a repartir" }).click();
      const vs = v.locator("#lalamoveSection");
      await vs.waitFor({ state: "visible" });
      assert.match(await vs.innerText(), /Recoge en .*Ana's shop/);
      await vs.getByRole("button", { name: "Enviar con Lalamove" }).click();
      await vs.locator(".ll-search input").fill("14.6337, 121.0338");
      await vs.locator(".ll-search input").press("Enter");
      await vs.locator(".ll-hit").first().click();
      await vs.getByRole("button", { name: "Ver precio" }).click();
      await vs.locator(".ll-price").waitFor();
      assert(await vs.getByRole("button", { name: /marcar «En camino» sin Lalamove/ }).count(), "no manual On-the-way option");
      await v.screenshot({ path: path.join(out, "lalamove-5-florist.png") });
      assert(!(await v.evaluate((n) => window.__calls.slice(n).some((c) => c.rpc === "cdf_progress" || c.action === "update"), before)), "Head out moved the order by hand");
      await noOverflow(v);
      // An order of someone else's: never offered
      assert.equal(await v.evaluate(() => llCanBook({ id: "x", vendor_email: "someone@else" })), false);
      // A rider booked live (production): her card follows the rider, the manual buttons go
      await v.evaluate(() => closeSheet(true));
      const rid = await v.evaluate(() => { const o = S.orders.find((x) => x.status === "Ready" && x.delivery === "-" && x.vendor_email === S.me.email);
        S.ll.set(o.id, { order_id: o.id, ll_order_id: "LL1", status: "ON_GOING", env: "production", share_link: "https://share.lalamove.com/x", driver_name: "Juan Dela Cruz" }); render(); return o.id; });
      const rc = v.locator(`article.work[data-id="${rid}"]`);
      await rc.locator(".w-ride").getByText(/Juan Dela Cruz/).waitFor();
      assert.equal(await rc.getByRole("button", { name: "Salir a repartir" }).count(), 0, "manual Head out still there with a live rider");
      // Sandbox: nothing moves by itself, so the manual step stays
      await v.evaluate((id) => { S.ll.get(id).env = "sandbox"; render(); }, rid);
      assert.equal(await v.locator(`article.work[data-id="${rid}"]`).getByRole("button", { name: "Salir a repartir" }).count(), 1);
      await v.context().close();
    }
    console.log("ok florist: Head out books a rider for her own order (nothing moved by hand; never for others)");

    {
      const q = await open("admin", 390);
      // New order: delivery instructions next to the address, vehicle, the point found from the address, no proof photo
      await q.evaluate(() => openEditor(null));
      const sh = q.locator(".sheet");
      await sh.locator("#f-drop").waitFor({ state: "attached" });
      const pos = await q.evaluate(() => ["f-addr", "f-dnote", "f-vehicle", "f-drop"].map((id) => [...document.querySelectorAll(".sheet .field")].indexOf(document.getElementById(id)?.closest(".field"))));
      assert(pos.every((n, i) => n >= 0 && (!i || n > pos[i - 1])), "field order " + pos);
      assert(!(await q.evaluate(() => document.getElementById("f-dnote").closest("details"))), "instructions still hidden in More details");
      assert.equal(await sh.getByText("Foto de prueba", { exact: true }).count(), 0, "proof photo on a new order");
      // Typing the address and leaving the field finds the point by itself (first result), others one tap away
      await q.locator("#f-addr").fill("Tomas Morato Ave, Quezon City");
      await q.locator("#f-addr").blur();
      await sh.locator(".drop-found").waitFor();
      assert.equal(await q.locator("#f-drop").inputValue(), "14.6337, 121.0338");
      await q.locator("#f-dropfind").click();
      await sh.locator(".ll-results .ll-hit").first().waitFor();
      await sh.locator(".order-more:not([open]) > summary").click();
      await q.locator("#f-vehicle").getByRole("button", { name: "Coche" }).click();
      assert.equal(await q.evaluate(() => document.getElementById("f-vehicle").value), "SEDAN");
      await q.screenshot({ path: path.join(out, "lalamove-6-new-order.png") });
      await q.evaluate(() => closeSheet(true));
      console.log("ok new order: instructions under the address, point found by itself from the address, vehicle buttons, no proof photo");

      // Taking the florist off an upcoming order asks first ("Save anyway"); cancelling keeps it unsaved
      const id = await q.evaluate(() => { const o = S.orders.find((x) => x.vendor_email && isOpen(x) && !x.cancelled_at); o.date = manilaToday(); openOrder(o); return o.id; });
      await sh.locator("#f-vendor").waitFor();
      await q.locator("#f-vendor").selectOption("");
      const n0 = await q.evaluate(() => window.__calls.length);
      await q.evaluate(() => document.querySelector(".sheet").requestSubmit());
      await q.getByText("A este pedido le falta algo para pedir el rider").waitFor();
      assert.match(await q.locator(".dialog").last().innerText(), /sin florista/);
      await q.locator(".dialog").last().getByRole("button", { name: "Cancelar" }).click();
      assert(!(await q.evaluate((n) => window.__calls.slice(n).some((c) => c.action === "update" && c.table === "cdf_orders"), n0)), "saved without asking");
      await q.evaluate(() => closeSheet(true));
      console.log("ok saving without a florist asks first");

      // The office banner: today's order with no florist
      await q.evaluate((id) => { const o = S.orders.find((x) => x.id === id); o.vendor_email = null; o.date = manilaToday(); render(); }, id);
      await q.locator("#gapBanner:not([hidden])").waitFor();
      assert.match(await q.locator("#gapBanner").innerText(), /sin florista asignada/);
      await q.screenshot({ path: path.join(out, "lalamove-7-banner.png") });
      console.log("ok office banner: orders for today/tomorrow that can't get a rider");

      // Lalamove dropped a booking (not us): banner and tag; one we cancelled ourselves: nothing
      await q.evaluate((id) => { S.ll.set(id, { order_id: id, ll_order_id: "LL9", status: "EXPIRED", cancelled_by_us: false }); render(); }, id);
      assert.match(await q.locator("#gapBanner").innerText(), /Lalamove: Caducado/);
      await q.evaluate((id) => { S.ll.get(id).cancelled_by_us = true; S.ll.get(id).status = "CANCELED"; render(); }, id);
      assert.doesNotMatch(await q.locator("#gapBanner").innerText(), /Lalamove/);
      console.log("ok office: told when Lalamove drops a booking, not when we cancel it");

      // Payment: price, paid so far, what's left; saved in the admin-only table; tag on the card
      await q.evaluate((id) => openOrder(S.orders.find((x) => x.id === id)), id);
      await sh.locator("#f-payment").waitFor();
      await q.locator("#f-amount").fill("2500");
      await q.locator("#f-payment").fill("1000");
      await q.getByRole("button", { name: "Aplicar pago" }).click();
      await sh.getByText("Pago aplicado.").waitFor();
      assert.match(await q.locator("#f-payleft").innerText(), /Pendiente: .*1,?500/);
      assert(await q.evaluate(() => window.__calls.some((c) => c.rpc === "cdf_record_payment" && c.args.p_amount === 1000)), "payment not saved");
      await sh.locator(".sheet-head").getByRole("button", { name: "Cerrar" }).click();
      await sh.waitFor({ state: "detached" });
      await q.locator(`[data-order="${id}"] .tag.due`).waitFor();
      assert.match(await q.locator("#gapBanner").innerText(), /pago pendiente|debe/);
      await q.evaluate((id) => { S.orders.find((x) => x.id === id).paid = 2500; render(); }, id);
      await q.locator(`[data-order="${id}"] .tag.ok`).getByText("Pagado").waitFor();
      console.log("ok payment: paid and left to pay, saved apart, tags and banner");

      // One History (changes + emails) instead of two drop-downs
      await q.evaluate((id) => openOrder(S.orders.find((x) => x.id === id)), id);
      await sh.locator("summary", { hasText: "Historial" }).first().waitFor();
      await q.setViewportSize({ width: 390, height: 2600 });
      await q.waitForTimeout(300);
      await q.screenshot({ path: path.join(out, "lalamove-8-editor.png") });
      await q.setViewportSize({ width: 390, height: 900 });
      assert.equal(await sh.locator("details.hist > summary").filter({ hasText: /^Historial de / }).count(), 0, "still two history drop-downs");
      await q.evaluate(() => closeSheet(true));
      console.log("ok one History section");

      // Audit 3: a price made for another florist / day can't be booked; it asks for a new one
      const o3 = await q.evaluate(() => { const o = S.orders.find((x) => x.status === "Ready" && !x.cancelled_at && x.vendor_email);
        __ll.row = { order_id: o.id, lat: 14.6337, lng: 121.0338, place: "x", service: "MOTORCYCLE", quotation_id: "q9", quote_total: 99, quote_currency: "PHP", quote_expires: new Date(Date.now() + 600000).toISOString(),
          quote_for: { vendor: "someone@else", pickup: [14.6, 121], date: o.date, slot: o.slot, wanted: "now", schedule: null } };
        o.drop_lat = null; openOrder(o); return o.id; });
      const sec3 = q.locator("#lalamoveSection");
      await sec3.getByText(/Has cambiado la florista/).waitFor();
      assert.equal(await sec3.getByRole("button", { name: /Reservar/ }).count(), 0, "a stale price can still be booked");
      // same price, matching florist: bookable, and it says when the rider comes
      await q.evaluate((id) => { closeSheet(true); const o = S.orders.find((x) => x.id === id); __ll.row.quote_for.vendor = o.vendor_email; openOrder(o); }, o3);
      await sec3.getByText(/Recogida: ahora/).waitFor();
      await q.evaluate(() => closeSheet(true));
      console.log("ok audit 3/9: stale price refused; pickup time shown");

      // Audit 1: cancelling an order with a rider booked says so and cancels the rider first
      await q.evaluate((id) => { Object.assign(__ll.row, { ll_order_id: "LL7", status: "ON_GOING" }); __ll.calls.length = 0; cancelDialog(S.orders.find((x) => x.id === id)); }, o3);
      await q.getByText(/al cancelar el pedido se cancelará también el rider/).waitFor();
      await q.locator("#f-cancel").fill("Cliente cancela");
      await q.evaluate(() => document.querySelector(".sheet").requestSubmit());
      await q.locator(".sheet").waitFor({ state: "detached" });
      assert(await q.evaluate(() => __ll.calls.some((c) => c.action === "cancel")), "rider not cancelled with the order");
      assert(await q.evaluate(() => window.__calls.some((c) => c.rpc === "cdf_cancel_order" || c.fn === "cdf_cancel_order" || JSON.stringify(c).includes("cdf_cancel_order"))), "order not cancelled");
      console.log("ok audit 1: cancelling the order cancels its rider first");

      // Audit 4: change the address after the point was found: the old point goes and is looked up again
      await q.evaluate(() => openEditor(null));
      await q.locator("#f-addr").fill("Tomas Morato Ave, Quezon City");
      await q.locator("#f-addr").blur();
      await q.locator(".drop-found").waitFor();
      assert.equal(await q.locator("#f-drop").inputValue(), "14.6337, 121.0338");
      await q.locator("#f-addr").fill("Another street 5, Makati");
      assert.equal(await q.locator("#f-drop").inputValue(), "", "old point kept after the address changed");
      await q.evaluate(() => closeSheet(true));
      console.log("ok audit 4: a new address drops the point found for the old one");

      // Audit 2: "Nobody home" with a rider still booked releases that rider before the new day
      const o2 = await q.evaluate(() => { const o = S.orders.find((x) => !x.cancelled_at && x.vendor_email && x.slot);
        __ll.row = { order_id: o.id, ll_order_id: "LL8", status: "PICKED_UP", lat: 14.6, lng: 121 }; __ll.calls.length = 0; missedDialog(o); return o.id; });
      await q.evaluate(() => document.querySelector(".sheet").requestSubmit());
      await q.locator(".sheet").waitFor({ state: "detached" });
      assert(await q.evaluate(() => __ll.calls.some((c) => c.action === "cancel")), "old rider kept after a new date");
      assert(await q.evaluate(() => window.__calls.some((c) => c.rpc === "cdf_reschedule")), "not rescheduled");
      console.log("ok audit 2: a new date releases the rider of the failed attempt");

      // Stats: what riders cost in the period (sandbox says so)
      await q.evaluate(() => setTab("stats"));
      await q.locator(".chart-card").filter({ hasText: "Riders Lalamove" }).waitFor();
      assert.match(await q.locator(".chart-card").filter({ hasText: "Riders Lalamove" }).innerText(), /Modo prueba/);
      console.log("ok stats: Lalamove rider spend for the period");
      await q.context().close();
    }
    {
      // Audit F01: a booking whose answer was lost shows as unconfirmed; the office links it or releases it
      const u = await open("admin", 390);
      const o = await u.evaluate(() => { const o = S.orders.find((x) => x.status === "Ready" && !x.cancelled_at && x.vendor_email);
        __ll.row = { order_id: o.id, lat: 14.6337, lng: 121.0338, place: "x", service: "MOTORCYCLE", quotation_id: "q7", quote_total: 99, quote_currency: "PHP",
          quote_expires: new Date(Date.now() + 600000).toISOString(), quote_for: { vendor: o.vendor_email, pickup: [14.6337, 121.0338], date: o.date, slot: o.slot } };
        __ll.lose = true; S.members.find((m) => m.email === o.vendor_email).pickup_address ||= "12 Tomas Morato Ave"; Object.assign(S.members.find((m) => m.email === o.vendor_email), { pickup_lat: 14.6337, pickup_lng: 121.0338 });
        openOrder(o); return o.id; });
      const s2 = u.locator("#lalamoveSection");
      await s2.getByRole("button", { name: "Reservar rider" }).click();
      await u.getByRole("alertdialog").getByRole("button", { name: "Reservar rider" }).click();
      await s2.locator(".ll-uncertain").waitFor();
      assert.match(await s2.innerText(), /Reserva sin confirmar/);
      assert.equal(await s2.getByRole("button", { name: "Reservar rider" }).count(), 0, "no way to book again from here");
      await s2.scrollIntoViewIfNeeded(); await shot(u, "uncertain");
      await s2.getByRole("button", { name: "Enlazar esa reserva" }).click();
      await u.locator(".toast", { hasText: /Nº de reserva/ }).first().waitFor();
      await s2.locator("input[inputmode=numeric]").fill("3626117933572534460");
      await s2.getByRole("button", { name: "Enlazar esa reserva" }).click();
      await u.locator(".toast", { hasText: "Reserva enlazada" }).waitFor();
      assert.deepEqual(await u.evaluate(() => __ll.calls.filter((c) => c.action === "book_resolve").map((c) => c.ll_order_id)), ["3626117933572534460"]);
      await s2.getByText("Buscando rider").or(s2.locator(".ll-line")).first().waitFor();
      // Released instead: asks first, then booking is possible again
      await u.evaluate((id) => { Object.assign(__ll.row, { ll_order_id: null, status: null, booking_state: "uncertain", booking_key: "k2" }); closeSheet(true); openOrder(S.orders.find((x) => x.id === id)); }, o);
      await s2.locator(".ll-uncertain").waitFor();
      await s2.getByRole("button", { name: "No se reservó nada" }).click();
      assert.match(await u.getByRole("alertdialog").innerText(), /dos riders/);
      await u.getByRole("alertdialog").getByRole("button", { name: "No se reservó nada" }).click();
      await u.locator(".toast", { hasText: "ya puedes pedir precio" }).waitFor();
      await u.context().close();
      // A florist sees it is being checked, with nothing to press
      const f = await open("vendor", 390);
      await f.evaluate((id) => { __ll.row = { order_id: id, quotation_id: "q7", booking_state: "uncertain", booking_key: "k3", error: null }; const o = S.orders.find((x) => x.id === id); if (o) openOrder(o); }, o);
      const s3 = f.locator("#lalamoveSection");
      if (await s3.isVisible().catch(() => false)) {
        await s3.locator(".ll-uncertain").waitFor();
        assert.match(await s3.innerText(), /La oficina está comprobando/);
        assert.equal(await s3.getByRole("button", { name: "No se reservó nada" }).count(), 0);
      }
      await f.context().close();
      console.log("ok audit F01: an unconfirmed booking can't be booked again; the office links it (Lalamove's number) or releases it after confirming");
    }
    assert.deepEqual(errors, []);
    console.log("ok no page errors");
  } catch (e) { console.error("FAIL", e.message, errors); process.exitCode = 1; }
  finally { await browser.close(); server.close(); }
})();
