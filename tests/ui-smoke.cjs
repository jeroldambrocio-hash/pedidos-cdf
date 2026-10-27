// Browser checks of the panel and the tracking page against a fake Supabase (no real requests).
// Run: npm i --prefix .test-tools playwright  →  NODE_PATH=.test-tools/node_modules node tests/ui-smoke.cjs
// Needs Google Chrome. Screenshots go to .impeccable/review/ (ignored by git).
const fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, ".."), out = path.join(root, ".impeccable/review");
fs.mkdirSync(out, { recursive: true });

// ---------- fake Supabase, injected in place of supabase-js ----------
const mock = String.raw`(() => {
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const base = { date: today, slot: "8:00 - 12:00", channel: "Shopify", status: "Preparing", delivery: "-", photo_path: null, bouquet_path: null, proof_path: "old/proof.jpg",
  customer_name: "Maria Santos", customer_phone: "+639171234567", customer_email: "buyer@example.com", buyer_name: "Alex Santos", buyer_phone: "+639179876543",
  card_message: "Happy birthday, Maria!", address: "Salcedo Village, Makati", vendor_email: "ana@example.com", carrier_email: null, notes: "Ring the bell.", delivery_note: "",
  code: "abc123abcd", attempts: 0, missed_on: null, archived_at: null, updated_at: "2026-10-27T02:15:00Z" };
const past = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
window.__orders = [
  { ...base, id: "11111111-1111-1111-1111-111111111111", num: "0124", slot: "23:30 - 23:59" },
  { ...base, id: "22222222-2222-2222-2222-222222222222", num: "0125", customer_name: "Elena Cruz", slot: "10:30 - 11:30", status: "Ready", delivery: "Failed", vendor_email: null, attempts: 1 },
  { ...base, id: "33333333-3333-3333-3333-333333333333", num: "0126", slot: "12:00 - 16:00", status: "Ready", delivery: "In transit", channel: "Instagram" },
  { ...base, id: "44444444-4444-4444-4444-444444444444", num: "0127", slot: "23:00 - 23:59", status: "Ready", customer_name: "Ready Rita", customer_email: "" },
  { ...base, id: "55555555-5555-5555-5555-555555555555", num: "0128", date: past, status: "Ready", delivery: "Delivered", customer_name: "Old Delivered" },
];
window.__calls = []; window.__events = [];
window.__notifications = [{ order_id: "33333333-3333-3333-3333-333333333333", created_at: "2026-10-27T02:15:00Z", channel: "email", audience: "customer", recipient: "buyer@example.com", ok: true, detail: "gmail: automatic, In transit", subject: "Order", message: "On its way." }];
const members = [{ email: "admin@example.com", name: "Jerold", role: "admin" }, { email: "ana@example.com", name: "Ana", role: "vendor" }, { email: "driver@example.com", name: "Luis", role: "carrier" }, { email: "moderator@example.com", name: "Mika", role: "moderator" }];
const email = { vendor: "ana@example.com", carrier: "driver@example.com", moderator: "moderator@example.com" };
const tables = () => ({ cdf_orders: window.__orders, cdf_members: members, cdf_notifications: window.__notifications, cdf_order_events: window.__events });
const like = (v, pat) => String(v || "").toLowerCase().includes(pat.replace(/%/g, "").toLowerCase());
function query(table) {
  let action = "read", row = null, filters = [], lim = null, cols = "*";
  const q = {
    select(c) { if (action === "read") cols = c || "*"; return q; }, order() { return q; }, limit(n) { lim = n; return q; },
    eq(k, v) { filters.push((o) => o[k] === v); return q; }, neq(k, v) { filters.push((o) => o[k] !== v); return q; },
    gte(k, v) { filters.push((o) => o[k] >= v); return q; }, lte(k, v) { filters.push((o) => o[k] <= v); return q; }, lt(k, v) { filters.push((o) => o[k] < v); return q; },
    is(k, v) { filters.push((o) => (o[k] ?? null) === v); return q; }, not(k, op, v) { filters.push((o) => (o[k] ?? null) !== v); return q; },
    in(k, v) { filters.push((o) => v.includes(o[k])); return q; },
    or(s) { window.__calls.push({ table, or: s }); const parts = s.split(",").map((p) => p.split(".ilike.")); filters.push((o) => parts.some(([k, pat]) => like(o[k], pat))); return q; },
    insert(v) { action = "insert"; row = v; return q; }, update(v) { action = "update"; row = v; return q; }, delete() { action = "delete"; return q; },
    maybeSingle() { return q.then((r) => ({ ...r, data: r.data?.[0] || null })); }, single() { return q.then((r) => ({ ...r, data: r.data?.[0] || null })); },
    then(resolve, reject) {
      if (window.__noMigration && action === "read" && (table === "cdf_order_events" || /archived_at|carrier_email/.test(cols))) return Promise.resolve({ data: null, error: { code: "42703", message: "column does not exist" } }).then(resolve, reject);
      if (action === "read" && table === "cdf_orders" && window.__loadError) return Promise.resolve({ error: { message: "offline" }, data: null }).then(resolve, reject);
      let data = tables()[table];
      if (table === "cdf_orders" && window.__role === "vendor") data = data.filter((o) => o.vendor_email === "ana@example.com");
      if (table === "cdf_orders" && window.__role === "carrier") data = data.filter((o) => o.status === "Ready" && o.delivery !== "Delivered");
      data = data.filter((o) => filters.every((f) => f(o)));
      if (action !== "read") {
        window.__calls.push({ table, action, row, ids: data.map((o) => o.id) });
        if (action === "insert") { const item = table === "cdf_orders" ? { ...base, ...row, id: "99999999-9999-9999-9999-" + String(Date.now()).slice(-12), code: "newcode1234", updated_at: new Date().toISOString() } : { ...row, ok: true, created_at: new Date().toISOString() }; tables()[table].push(item); data = [item]; }
        if (action === "update") data.forEach((o) => Object.assign(o, row, { updated_at: new Date().toISOString() }));
        if (action === "delete") window.__orders = window.__orders.filter((o) => !data.includes(o));
      }
      if (lim) data = data.slice(0, lim);
      return Promise.resolve({ data: JSON.parse(JSON.stringify(data)), error: null }).then(resolve, reject);
    },
  };
  return q;
}
const steps = { prep: ["Preparing", "-"], ready: ["Ready", "-"], transit: ["Ready", "In transit"], done: ["Ready", "Delivered"], fail: ["Ready", "Failed"] };
window.supabase = { createClient: () => ({
  from: query,
  auth: { onAuthStateChange(cb) { queueMicrotask(() => cb("INITIAL_SESSION", window.__role === "login" ? null : { user: { id: "test", email: email[window.__role] || "admin@example.com" } })); },
    async signInWithPassword() { return { error: { message: "invalid" } }; }, async signOut() { return { error: null }; } },
  storage: { from: (b) => ({ createSignedUrl: async (p) => ({ data: { signedUrl: "/img/emblem.webp" } }),
    upload: async (p) => { window.__calls.push({ upload: b, path: p }); return { error: null }; },
    remove: async (p) => { window.__calls.push({ remove: b, paths: p }); return { error: null }; } }) },
  channel: () => ({ on(_a, _b, cb) { window.__realtime = cb; return this; }, subscribe() { return this; } }), removeChannel() {},
  functions: { invoke: async (name, args) => { window.__calls.push({ function: name, args }); return { data: { ok: true }, error: null }; } },
  rpc: async (name, args) => {
    window.__calls.push({ rpc: name, args });
    const o = window.__orders.find((x) => x.id === args.p_id); if (!o) return { error: { message: "missing" } };
    if (name === "cdf_progress") { [o.status, o.delivery] = steps[args.p_step]; if (args.p_note) o.delivery_note = args.p_note; if (args.p_set_proof) o.proof_path = args.p_proof; }
    if (name === "cdf_set_bouquet") o.bouquet_path = args.p_path;
    if (name === "cdf_reschedule") Object.assign(o, { date: args.p_date, slot: args.p_slot, delivery_note: args.p_note, status: "Ready", delivery: "-", attempts: o.attempts + 1 });
    o.updated_at = new Date().toISOString();
    return { data: JSON.parse(JSON.stringify(o)), error: null };
  },
}) };
})();`;

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer((req, res) => {
  let name = req.url.split("?")[0];
  if (name === "/" || name.startsWith("/p/")) name = name.startsWith("/p/") ? "/seguimiento.html" : "/index.html";
  const f = path.resolve(root, "." + decodeURIComponent(name));
  if (!f.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", types[path.extname(f)] || "text/plain");
    // The fake supabase-js can't match the real file's integrity hash; drop it only on this test server
    res.end(f.endsWith(".html") ? String(b).replace(/ integrity="[^"]+"/g, "") : b);
  });
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port, browser = await chromium.launch({ headless: true, channel: "chrome" }), errors = [], results = [];
  async function open(role, { width = 1440, before, track } = {}) {
    // reducedMotion "reduce": the panel must keep full animations unless the person turns them down
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: "en-PH", reducedMotion: "reduce", acceptDownloads: true });
    await context.addInitScript(([r, b]) => { window.__role = r; if (b) Object.assign(window, b); }, [role, before || null]);
    const p = await context.newPage();
    p.setDefaultTimeout(8000);
    p.on("pageerror", (e) => errors.push(role + ": " + e.message));
    await context.route("**/*", async (route) => {
      const u = route.request().url();
      if (u.includes("supabase.min.js")) return route.fulfill({ body: mock, contentType: "text/javascript" });
      if (u.includes("/functions/v1/cdf-track")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: track === null ? null : { num: "0124", date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()), slot: "8:00 - 12:00", status: "Ready", delivery: "Failed", delivery_note: "We came at 3 PM.", updated_at: "2026-10-27T02:15:00Z", for_name: "Maria", card_message: "Happy birthday, Maria!", bouquet_url: "/img/emblem.webp", proof_url: "/img/emblem.webp" } }) });
      if (!u.startsWith("http://127.0.0.1")) return route.fulfill({ body: "", contentType: "text/css" });
      return route.continue();
    });
    await p.goto("http://127.0.0.1:" + port + (role === "track" ? "/p/abc123abcd" : "/"));
    if (role !== "track" && role !== "login") await p.locator("#list").waitFor({ state: "visible" });
    await p.waitForTimeout(250);
    return p;
  }
  const calls = (p) => p.evaluate(() => window.__calls);
  async function capture(p, name) {
    await p.screenshot({ path: path.join(out, name + ".png"), fullPage: (await p.locator(".scrim").count()) === 0 });
    assert(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "Horizontal overflow on " + name);
  }
  // A failed step reports the action and what blocked it, then closes any open layer so the next step starts clean
  const step = async (name, fn) => {
    try { await fn(); results.push("ok   " + name); } catch (e) {
      const lines = e.message.split("\n").map((l) => l.trim()).filter((l) => l && !/^-? ?(waiting|attempting|retrying|\d+ ×|wait for|scrolling|done scrolling)/.test(l));
      results.push("FAIL " + name + " · " + lines.slice(0, 4).join(" ⏎ "));
      for (const pg of browser.contexts().flatMap((c) => c.pages())) await pg.evaluate(() => { document.querySelectorAll("#sheetRoot, #dialogRoot").forEach((r) => r.replaceChildren()); if (typeof sheet !== "undefined") sheet = null; document.body.classList.remove("locked"); }).catch(() => {});
    }
  };

  try {
    let p = await open("admin");
    await step("Neutral palette, one stylesheet, timeline (no board), channel logos", async () => {
      assert.equal(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(23, 23, 23)");
      assert.equal(await p.locator("link[rel=stylesheet][href^='/']").count(), 1);
      assert(await p.locator(".timeline-entry").count() >= 4);
      assert.equal(await p.locator(".board").count(), 0);
      assert(await p.locator(".channel-logo img").count() >= 2);
      await capture(p, "desktop");
    });
    await step("Animations full by default even with OS reduce; Settings turns them down and remembers", async () => {
      assert.equal(await p.evaluate(() => document.documentElement.dataset.motion), "full");
      await p.locator("[data-settings]").click(); await p.locator("[data-motion-set=reduced]").click();
      assert.equal(await p.evaluate(() => [document.documentElement.dataset.motion, localStorage.getItem("cdf-motion")].join()), "reduced,reduced");
      await p.locator("[data-motion-set=full]").click(); await p.keyboard.press("Escape");
    });
    await step("B2 · On the way asks first, says who gets the email, and cancel changes nothing", async () => {
      const card = p.locator(".order", { hasText: "#0127" });
      await card.getByRole("button", { name: "Head out" }).click();
      await p.locator(".dialog").waitFor();
      assert(await p.locator(".dialog").innerText().then((s) => s.includes("no email will be sent")));
      await p.locator(".dialog").getByRole("button", { name: "Cancel" }).click();
      assert(!(await calls(p)).some((c) => c.action === "update"));
      await p.locator(".order", { hasText: "#0124" }).getByRole("button", { name: "On the way" }).click();
      assert(await p.locator(".dialog").innerText().then((s) => s.includes("buyer@example.com")));
      await p.locator(".dialog").getByRole("button", { name: "Yes, on the way" }).click();
      await p.waitForTimeout(300);
      assert((await calls(p)).some((c) => c.action === "update" && c.row.delivery === "In transit"));
    });
    await step("B2 · Delivered and Nobody home open their forms instead of changing the status", async () => {
      const before = (await calls(p)).length;
      await p.locator(".order", { hasText: "#0126" }).getByRole("button", { name: "Delivered" }).first().click();
      await p.locator(".sheet h2", { hasText: "Deliver #0126" }).waitFor();
      await p.keyboard.press("Escape"); await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      await p.locator(".order", { hasText: "#0126" }).locator(".order-actions").getByRole("button", { name: "Nobody home" }).click();
      await p.locator(".sheet h2", { hasText: "Nobody home · #0126" }).waitFor();
      await p.keyboard.press("Escape"); await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      assert.equal((await calls(p)).length, before);
    });
    await step("B4 · Unsaved new order: Escape asks, a draft survives, and is offered again", async () => {
      await p.keyboard.press("n");
      await p.locator("#f-bname").fill("Draft Buyer");
      await p.keyboard.press("Escape");
      await p.locator(".dialog", { hasText: "unsaved changes" }).waitFor();
      await p.locator(".dialog").getByRole("button", { name: "Cancel" }).click();
      assert(await p.locator("#f-bname").isVisible());
      await p.waitForTimeout(500);
      assert(await p.evaluate(() => (localStorage.getItem("cdf-draft") || "").includes("Draft Buyer")));
      await p.keyboard.press("Escape"); await p.locator(".dialog").getByRole("button", { name: "Discard" }).click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      await p.locator("#newBtn").click();
      await p.locator(".dialog", { hasText: "unsaved new order" }).getByRole("button", { name: "Bring it back" }).click();
      assert.equal(await p.locator("#f-bname").inputValue(), "Draft Buyer");
      await p.keyboard.press("Escape"); await p.locator(".dialog").getByRole("button", { name: "Discard" }).click();
    });
    await step("Create order: no florist by default, phone normalised, draft cleared", async () => {
      await p.evaluate(() => localStorage.removeItem("cdf-draft"));
      await p.locator("#newBtn").click();
      assert.equal(await p.locator("#f-vendor").inputValue(), "");
      await p.locator("#f-num").fill("1001");
      await p.locator(".slot-pick select").nth(0).selectOption("540");
      await p.locator("#f-bname").fill("Buyer test"); await p.locator("#f-bphone").fill("0917 555 0101");
      await p.locator("#f-same").check();
      await p.locator("#f-addr").fill("Rockwell, Makati");
      await p.locator(".sheet button[type=submit]").click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      const ins = (await calls(p)).find((c) => c.action === "insert");
      assert.equal(ins.row.vendor_email, null); assert.equal(ins.row.buyer_phone, "+639175550101"); assert.equal(ins.row.customer_name, "Buyer test");
    });
    await step("Invalid phone is caught before saving", async () => {
      await p.locator("#newBtn").click();
      await p.locator("#f-num").fill("1002"); await p.locator(".slot-pick select").nth(0).selectOption("600");
      await p.locator("#f-bname").fill("X"); await p.locator("#f-bphone").fill("12"); await p.locator("#f-same").check(); await p.locator("#f-addr").fill("Y");
      await p.locator(".sheet button[type=submit]").click();
      assert(await p.locator(".sheet .err").innerText().then((s) => s.includes("phone")));
      await p.keyboard.press("Escape"); await p.locator(".dialog").getByRole("button", { name: "Discard" }).click();
    });
    await step("B1 · Saving an edit sends only what changed (a status set meanwhile is kept)", async () => {
      await p.locator(".order", { hasText: "#0125" }).locator(".order-open").click();
      await p.evaluate(() => { const o = window.__orders.find((x) => x.num === "0125"); o.notes = "changed by florist"; o.updated_at = "2030-01-01T00:00:00Z"; });
      await p.locator("#f-addr").fill("New address 5");
      await p.locator(".sheet button[type=submit]").click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      const up = (await calls(p)).filter((c) => c.action === "update").pop();
      assert.deepEqual(Object.keys(up.row), ["address"]);
    });
    await step("B1 · A real clash asks before overwriting", async () => {
      await p.locator(".order", { hasText: "#0125" }).locator(".order-open").click();
      await p.evaluate(() => { const o = window.__orders.find((x) => x.num === "0125"); o.address = "Changed elsewhere"; o.updated_at = "2031-01-01T00:00:00Z"; });
      await p.locator("#f-addr").fill("Mine");
      await p.locator(".sheet button[type=submit]").click();
      await p.locator(".dialog", { hasText: "Someone else changed" }).waitFor();
      await p.locator(".dialog").getByRole("button", { name: "Cancel" }).click();
      await p.keyboard.press("Escape"); await p.locator(".dialog").getByRole("button", { name: "Discard" }).click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
    });
    await step("B5 · Replacing a photo deletes the old file only after the order points at the new one", async () => {
      await p.evaluate(() => (window.__calls = []));
      await p.locator(".order", { hasText: "#0124" }).locator(".order-open").click();
      await p.locator(".deliv summary", { hasText: "More details" }).click();
      await p.locator(".sheet input[type=file]").nth(2).setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: png });
      await p.waitForTimeout(400);
      await p.locator(".sheet button[type=submit]").click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      const c = await calls(p), up = c.findIndex((x) => x.action === "update" && "proof_path" in x.row), rm = c.findIndex((x) => x.remove);
      assert(up >= 0 && rm > up, "remove must come after the update");
    });
    await step("Florist on the card: change with undo", async () => {
      await p.locator(".order", { hasText: "#0125" }).locator(".inline-select").selectOption("ana@example.com");
      await p.waitForTimeout(200);
      assert((await calls(p)).some((c) => c.action === "update" && c.row.vendor_email === "ana@example.com"));
      assert(await p.locator(".toast").innerText().then((s) => s.includes("Undo")));
    });
    await step("At-risk orders are flagged and filterable", async () => {
      assert(await p.locator(".stat", { hasText: "At risk" }).isVisible());
    });
    await step("Server search across dates (phones by their last digits)", async () => {
      await p.locator("#q").fill("9171234567"); await p.waitForTimeout(500);
      assert((await calls(p)).some((c) => c.or && c.or.includes("customer_phone.ilike.%171234567%")));
      assert(await p.locator(".order").count() >= 1);
      await p.locator("#clearSearch").click();
    });
    await step("Bulk: select, mark ready", async () => {
      await p.locator("#selectBtn").click();
      await p.locator("#bulk").getByRole("button", { name: "All visible" }).click();
      await p.locator("#bulk").getByRole("button", { name: "Mark ready" }).click();
      await p.waitForTimeout(200);
      assert((await calls(p)).some((c) => c.action === "update" && c.row.status === "Ready" && c.ids.length >= 1));
      await p.locator("#bulk").getByRole("button", { name: "Done" }).click();
    });
    await step("Archive delivered (keeps history), with undo", async () => {
      await p.locator("#adminTools").getByRole("button", { name: /Archive delivered/ }).click();
      await p.locator(".dialog").getByRole("button", { name: "Archive" }).click();
      await p.waitForTimeout(200);
      assert((await calls(p)).some((c) => c.action === "update" && c.row.archived_at));
    });
    await step("CSV export downloads a file", async () => {
      await p.locator("#adminTools").getByRole("button", { name: "Export CSV" }).click();
      const [dl] = await Promise.all([p.waitForEvent("download"), p.locator(".sheet").getByRole("button", { name: "Download" }).click()]);
      assert(dl.suggestedFilename().endsWith(".csv"));
    });
    await step("Change history and notices in the order sheet", async () => {
      await p.locator(".order", { hasText: "#0126" }).locator(".order-open").click();
      assert(await p.locator(".deliv summary", { hasText: "Change history" }).isVisible());
      await p.locator(".deliv summary", { hasText: "Notification history" }).click();
      assert(await p.locator(".hist").first().innerText().then((s) => s.includes("Customer")));
      await capture(p, "editor-desktop");
      await p.keyboard.press("Escape"); await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
    });
    await step("Realtime applies one row without reloading", async () => {
      const reads = (await calls(p)).length;
      await p.evaluate(() => window.__realtime({ eventType: "UPDATE", new: { ...window.__orders.find((o) => o.num === "0126"), customer_name: "Realtime Name" } }));
      await p.waitForTimeout(300);
      assert(await p.locator(".o-name", { hasText: "Realtime Name" }).isVisible());
      assert.equal((await calls(p)).length, reads);
    });
    await step("Statistics tab", async () => {
      await p.locator("#tabStats").click();
      await p.locator(".kpis").waitFor();
      assert.equal(await p.locator(".kpi").count(), 6);
      assert(await p.locator(".vb").count() >= 30);
      await capture(p, "stats-desktop");
    });
    await step("B6 · Team can add a moderator", async () => {
      await p.locator("#tabTeam").click();
      assert.equal(await p.locator("#aRole option").count(), 4);
      assert.equal(await p.locator("#aRole option[value=moderator]").count(), 1);
      await capture(p, "team-desktop");
    });
    await p.close();

    await step("B3 · 'Today' moves on at midnight in Manila", async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-PH" });
      const q = await ctx.newPage();
      await q.clock.install({ time: new Date("2026-10-28T15:59:00Z") }); // 23:59 in Manila
      await ctx.addInitScript(() => { window.__role = "admin"; });
      await ctx.route("**/*", (r) => { const u = r.request().url(); if (u.includes("supabase.min.js")) return r.fulfill({ body: mock, contentType: "text/javascript" }); if (!u.startsWith("http://127.0.0.1")) return r.fulfill({ body: "" }); return r.continue(); });
      await q.goto("http://127.0.0.1:" + port + "/"); await q.locator("#list").waitFor();
      const before = await q.evaluate(() => S.today);
      await q.clock.fastForward("02:00");
      const after = await q.evaluate(() => [S.today, S.sel]);
      assert.equal(before, "2026-10-28"); assert.deepEqual(after, ["2026-10-29", "2026-10-29"]);
      await ctx.close();
    });
    await step("B7 · Load failure shows a retry banner", async () => {
      const q = await open("admin", { before: { __loadError: true } });
      assert(await q.locator("#connection").isVisible());
      assert(await q.locator("#list").getByRole("button", { name: "Try again" }).isVisible());
      await q.close();
    });
    await step("Works before migrations 012/013 (no archive column, no change log)", async () => {
      const q = await open("admin", { before: { __noMigration: true } });
      assert(await q.locator(".timeline-entry").count() >= 3);
      assert.equal(await q.locator("#adminTools").getByRole("button", { name: /Archive/ }).count(), 0);
      await q.close();
    });
    await step("Moderator: orders, no team tab and no delete", async () => {
      const q = await open("moderator");
      assert(!(await q.locator("#tabs").isVisible()));
      await q.locator(".order-open").first().click();
      assert.equal(await q.locator(".sheet").getByRole("button", { name: "Delete", exact: true }).count(), 0);
      await q.close();
    });
    await step("Mobile admin: calendar folds, no overflow", async () => {
      const q = await open("admin", { width: 390 });
      await capture(q, "admin-mobile");
      await q.locator("#calendarToggle").click(); await q.locator("#cal").waitFor({ state: "visible" });
      await q.locator("#newBtn").click(); await capture(q, "editor-mobile");
      await q.close();
    });
    await step("Florist: ready with bouquet, then head out asks first (RPCs)", async () => {
      const q = await open("vendor", { width: 390 });
      await q.locator(".wcard").first().waitFor(); await capture(q, "florist-mobile");
      await q.getByRole("button", { name: "Mark ready" }).first().click();
      await q.locator(".sheet").getByRole("button", { name: "Mark ready", exact: true }).click();
      await q.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      assert((await calls(q)).some((c) => c.rpc === "cdf_progress" && c.args.p_step === "ready"));
      await q.getByRole("button", { name: "Head out", exact: true }).first().click();
      await q.locator(".dialog").getByRole("button", { name: "Yes, on the way" }).click();
      await q.waitForTimeout(300);
      assert((await calls(q)).some((c) => c.rpc === "cdf_progress" && c.args.p_step === "transit"));
      await q.locator("#q").fill("Maria"); assert(await q.locator(".wcard").count() >= 1);
      await q.locator("#q").fill("zzzz"); assert.equal(await q.locator(".wcard").count(), 0);
      await q.close();
    });
    await step("Driver: nobody home reschedules, delivered confirms (RPCs)", async () => {
      const q = await open("carrier", { width: 390 });
      await q.locator(".wcard").first().waitFor(); await capture(q, "driver-mobile");
      await q.getByRole("button", { name: "Nobody home" }).first().click();
      await q.locator(".sheet").getByRole("button", { name: "Reschedule" }).click();
      await q.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      assert((await calls(q)).some((c) => c.rpc === "cdf_reschedule"));
      await q.close();
      const r = await open("carrier", { width: 390 });
      await r.getByRole("button", { name: "Delivered" }).first().click();
      await r.locator(".sheet").getByRole("button", { name: "Confirm delivery" }).click();
      await r.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      assert((await calls(r)).some((c) => c.rpc === "cdf_progress" && c.args.p_step === "done"));
      await r.close();
    });
    await step("Tracking page: steps, photos, translated title; unknown order stops polling", async () => {
      const q = await open("track", { width: 390 });
      await q.locator(".tl").waitFor();
      assert(await q.locator("#card").innerText().then((s) => s.includes("Maria") && s.includes("Happy birthday")));
      assert.equal(await q.title(), "Your order · Casa de Flores");
      await capture(q, "tracking-mobile"); await q.close();
      const n = await open("track", { track: null });
      await n.locator("#card h2", { hasText: "couldn't find" }).waitFor();
      assert(await n.evaluate(() => poll === null));
      await n.close();
    });
    await step("Sign-in screens", async () => {
      const q = await open("login"); await capture(q, "login-desktop"); await q.close();
      const m = await open("login", { width: 390 }); await capture(m, "login-mobile"); await m.close();
    });
    await step("No uncaught JavaScript errors", async () => { assert.deepEqual(errors, []); });
  } finally { await browser.close(); server.close(); }
  fs.writeFileSync(path.join(out, "verification.json"), JSON.stringify({ results, errors, fixture: "Fake Supabase in the browser; no real requests." }, null, 2));
  console.log(results.join("\n"));
  if (errors.length) console.log("errors:", errors);
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
})().catch((e) => { console.error(e); server.close(); process.exitCode = 1; });
