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
window.__prices = window.__orders.map(o=>({order_id:o.id,amount:2500}));
window.__calls = []; window.__events = [];
window.__notifications = [{ order_id: "33333333-3333-3333-3333-333333333333", created_at: "2026-10-27T02:15:00Z", channel: "email", audience: "customer", recipient: "buyer@example.com", ok: true, detail: "gmail: automatic, In transit", subject: "Order", message: "On its way." }];
// Members survive a reload (sessionStorage) so profile and availability changes can be checked after F5
const members = JSON.parse(sessionStorage.getItem("__members") || "null") || [{ email: "admin@example.com", name: "Jerold", role: "admin" }, { email: "ana@example.com", name: "Ana", role: "vendor", phone: "", avatar_path: null, away_from: null, away_until: null, away_reason: null, ...(window.__ana || {}) }, { email: "driver@example.com", name: "Luis", role: "carrier" }];
const keepMembers = () => sessionStorage.setItem("__members", JSON.stringify(members));
const awayOnDay = (m, d) => !!(m.away_from && d >= m.away_from && (!m.away_until || d <= m.away_until));
const email = { vendor: "ana@example.com", carrier: "driver@example.com" };
const tables = () => ({ cdf_orders: window.__orders, cdf_members: members, cdf_notifications: window.__notifications, cdf_order_events: window.__events, cdf_order_prices: window.__role === "admin" || !window.__role ? window.__prices : [] });
const like = (v, pat) => String(v || "").toLowerCase().includes(pat.replace(/%/g, "").toLowerCase());
function query(table) {
  let action = "read", row = null, filters = [], lim = null, offset = 0, cols = "*";
  const q = {
    select(c) { if (action === "read") cols = c || "*"; return q; }, order() { return q; }, limit(n) { lim = n; return q; }, range(a,b) { offset=a; lim=b-a+1; return q; },
    eq(k, v) { filters.push((o) => o[k] === v); return q; }, neq(k, v) { filters.push((o) => o[k] !== v); return q; },
    gte(k, v) { filters.push((o) => o[k] >= v); return q; }, lte(k, v) { filters.push((o) => o[k] <= v); return q; }, lt(k, v) { filters.push((o) => o[k] < v); return q; },
    is(k, v) { filters.push((o) => (o[k] ?? null) === v); return q; }, not(k, op, v) { filters.push((o) => (o[k] ?? null) !== v); return q; },
    in(k, v) { filters.push((o) => v.includes(o[k])); return q; },
    or(s) { window.__calls.push({ table, or: s }); const parts = s.split(",").map((p) => p.split(".ilike.")); filters.push((o) => parts.some(([k, pat]) => like(o[k], pat))); return q; },
    upsert(v) { action = "upsert"; row=v; return q; },
    insert(v) { action = "insert"; row = v; return q; }, update(v) { action = "update"; row = v; return q; }, delete() { action = "delete"; return q; },
    maybeSingle() { return q.then((r) => ({ ...r, data: r.data?.[0] || null })); }, single() { return q.then((r) => ({ ...r, data: r.data?.[0] || null })); },
    then(resolve, reject) {
      if (window.__noMigration && action === "read" && (table === "cdf_order_events" || /archived_at|carrier_email/.test(cols) || (table === "cdf_members" && /away_from/.test(cols)))) return Promise.resolve({ data: null, error: { code: "42703", message: "column does not exist" } }).then(resolve, reject);
      if (action === "read" && table === "cdf_orders" && window.__loadError) return Promise.resolve({ error: { message: "offline" }, data: null }).then(resolve, reject);
      let data = tables()[table];
      if (table === "cdf_orders" && window.__role === "vendor") data = data.filter((o) => o.vendor_email === "ana@example.com");
      if (table === "cdf_orders" && window.__role === "carrier") data = data.filter((o) => o.status === "Ready" && o.delivery !== "Delivered");
      data = data.filter((o) => filters.every((f) => f(o)));
      if(action === "upsert" && table === "cdf_order_prices") {
        if(window.__role && window.__role !== "admin")return Promise.resolve({data:null,error:{message:"denied"}}).then(resolve,reject);
        const existing=window.__prices.find(p=>p.order_id===row.order_id);if(existing)Object.assign(existing,row);else window.__prices.push({...row});data=[row];
      }
      if (action !== "read") {
        window.__calls.push({ table, action, row, ids: data.map((o) => o.id) });
        if (action === "insert") { const item = table === "cdf_orders" ? { ...base, ...row, id: "99999999-9999-9999-9999-" + String(Date.now()).slice(-12), code: "newcode1234", updated_at: new Date().toISOString() } : { ...row, ok: true, created_at: new Date().toISOString() }; tables()[table].push(item); data = [item]; }
        if (action === "update") data.forEach((o) => Object.assign(o, row, { updated_at: new Date().toISOString() }));
        if (action === "delete") window.__orders = window.__orders.filter((o) => !data.includes(o));
      }
      if (lim) data = data.slice(offset, offset+lim);
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
  channel: () => ({ on(_a, config, cb) { if(config.table==="cdf_order_prices")window.__realtimePrice=cb;else window.__realtime = cb; return this; }, subscribe() { return this; } }), removeChannel() {},
  functions: { invoke: async (name, args) => { window.__calls.push({ function: name, args }); return { data: { ok: true }, error: null }; } },
  rpc: async (name, args) => {
    window.__calls.push({ rpc: name, args });
    if(name === "cdf_search_orders") {
      const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();const q=norm(args.p_query),digits=q.replace(/\D/g,"").slice(-9);
      return {data:window.__orders.filter(o=>[o.num,o.customer_name,o.buyer_name,o.address,o.customer_email].some(v=>norm(v).includes(q)) || (digits.length>=3 && [o.customer_phone,o.buyer_phone].some(v=>String(v||"").replace(/\D/g,"").includes(digits)))),error:null};
    }
    if(name === "cdf_buyer_history") {
      const digits=p=>String(p||"").replace(/\D/g,"").slice(-9);const os=window.__orders.filter(o=>o.id!==args.p_exclude&&digits(o.buyer_phone||o.customer_phone)===digits(args.p_phone));
      return {data:[{n:os.length,total:window.__role==="admin"?os.reduce((n,o)=>n+(window.__prices.find(p=>p.order_id===o.id)?.amount||0),0):0}],error:null};
    }
    if(name === "cdf_member_stats") {
      const rows=[{email:"ana@example.com",done_week:3,done_month:12,done_total:48,open_now:4},{email:"admin@example.com",done_week:0,done_month:1,done_total:5,open_now:0}];
      return {data:window.__role==="vendor"||window.__role==="admin"||!window.__role?rows:[],error:null};
    }
    const me = email[window.__role] || "admin@example.com";
    if (name === "cdf_save_profile") { const m = members.find((x) => x.email === me); Object.assign(m, { name: args.p_name, phone: args.p_phone, avatar_path: args.p_avatar }); keepMembers(); return { data: { ...m }, error: null }; }
    if (name === "cdf_set_availability") {
      if (me !== args.p_email && window.__role && window.__role !== "admin") return { data: null, error: { message: "not allowed" } };
      if (args.p_until && args.p_from && args.p_until < args.p_from) return { data: null, error: { message: "end before start" } };
      const m = members.find((x) => x.email === args.p_email); Object.assign(m, { away_from: args.p_from, away_until: args.p_from ? args.p_until : null, away_reason: args.p_from ? args.p_reason : null }); keepMembers(); return { data: { ...m }, error: null };
    }
    if (name === "cdf_away_conflicts") return { data: window.__orders.filter((o) => !o.archived_at && o.delivery !== "Delivered" && o.vendor_email).flatMap((o) => { const m = members.find((x) => x.email === o.vendor_email); return m && awayOnDay(m, o.date) ? [{ id: o.id, num: o.num, date: o.date, vendor_email: o.vendor_email, away_from: m.away_from, away_until: m.away_until }] : []; }), error: null };
    const o = window.__orders.find((x) => x.id === args?.p_id); if (!o) return { error: { message: "missing" } };
    if (name === "cdf_progress") { [o.status, o.delivery] = steps[args.p_step]; if (args.p_note) o.delivery_note = args.p_note; if (args.p_set_proof) o.proof_path = args.p_proof; }
    if (name === "cdf_set_bouquet") o.bouquet_path = args.p_path;
    if (name === "cdf_reschedule") Object.assign(o, { date: args.p_date, slot: args.p_slot, delivery_note: args.p_note, status: "Ready", delivery: "-", attempts: o.attempts + 1 });
    o.updated_at = new Date().toISOString();
    return { data: JSON.parse(JSON.stringify(o)), error: null };
  },
}) };
})();`;
// EXPORT_MOCK=file writes the fake Supabase out, to look at the panel with it in a normal browser
if (process.env.EXPORT_MOCK) { fs.writeFileSync(process.env.EXPORT_MOCK, mock); process.exit(0); }

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
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(out, name + ".png"), animations: "disabled", fullPage: (await p.locator(".scrim").count()) === 0 });
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
      assert(await p.locator(".entry").count() >= 4);
      assert.equal(await p.locator(".board").count(), 0);
      assert(await p.locator(".chan img").count() >= 2);
      await capture(p, "desktop");
    });
    await step("Animations full by default even with OS reduce; Settings turns them down and remembers", async () => {
      assert.equal(await p.evaluate(() => document.documentElement.dataset.motion), "full");
      await p.locator("#accountBtn").click(); await p.locator('#account [data-goto="prefs"]').click(); await p.locator("#account [data-motion-set=reduced]").click();
      assert.equal(await p.evaluate(() => [document.documentElement.dataset.motion, localStorage.getItem("cdf-motion")].join()), "reduced,reduced");
      await p.locator("#account [data-motion-set=full]").click(); await p.keyboard.press("Escape");
    });
    await step("Profile menu: four entries, Preferences and My account views, Back, Escape returns focus", async () => {
      await p.locator("#accountBtn").click();
      const main = p.locator('#account .mview[data-view="main"]');
      assert.deepEqual(await main.locator(".mitem").allInnerTexts(), ["Preferences", "My account", "Send a suggestion", "Sign out"]);
      assert.equal(await main.locator(".mhead small").innerText(), "Admin");
      assert.equal(await p.locator("#account .mrow:visible").count(), 0);
      await p.locator('#account [data-goto="prefs"]').click();
      assert.equal(await p.locator("#account .mrow:visible").count(), 4);
      assert.equal(await p.evaluate(() => document.activeElement.classList.contains("mback")), true);
      const row = await p.locator('#account .mview[data-view="prefs"] .mrow').first().evaluate((r) => { const a = r.firstElementChild.getBoundingClientRect(), b = r.lastElementChild.getBoundingClientRect(); return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 4 && b.left > a.right; });
      assert(row, "label and control side by side on desktop");
      await capture(p, "menu-prefs");
      await p.keyboard.press("Enter");
      assert.equal(await p.evaluate(() => document.activeElement.dataset.goto), "prefs");
      await p.keyboard.press("ArrowDown"); await p.keyboard.press("Enter");
      assert(await p.locator("#pwBtn").isVisible()); assert.equal(await p.locator("#menuEmail").innerText(), "admin@example.com");
      assert(!/\bnull\b|undefined/.test(await p.locator("#menuProfile").innerText()), "no stray null in My account");
      await p.keyboard.press("Escape");
      assert.equal(await p.evaluate(() => document.activeElement.id), "accountBtn");
      assert.equal(await p.locator("#account .menu.open").count(), 0);
      await p.keyboard.press("Enter"); await p.waitForTimeout(100);
      assert.equal(await p.evaluate(() => document.activeElement.dataset.goto), "prefs", "reopens on the main list, focus inside");
      await p.keyboard.press("Escape");
    });
    await step("Show prices lives in the orders controls (admin), remembered per browser", async () => {
      assert(await p.locator("#pricesBtn").isVisible());
      assert.equal(await p.locator(".amt").count(), 0);
      await p.locator("#pricesBtn").click(); await p.waitForTimeout(300);
      assert.equal(await p.evaluate(() => localStorage.getItem("cdf-prices")), "on");
      assert.equal(await p.locator("#pricesBtn").getAttribute("aria-pressed"), "true");
      assert(await p.locator(".amt").count() > 0);
      await p.locator("#pricesBtn").click(); await p.waitForTimeout(300);
      assert.equal(await p.evaluate(() => localStorage.getItem("cdf-prices")), null);
    });
    await step("Brand name goes to Orders", async () => {
      await p.locator("#railToggle").click(); await p.locator("#tabTeam").click();
      await p.locator("#brandHome").click();
      assert(await p.locator("#ordersView").isVisible());
      assert.equal(await p.locator("#tabOrders").getAttribute("aria-current"), "page");
      await p.locator("#railToggle").click();
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
      await p.locator(".order", { hasText: "#0126" }).locator(".actions").getByRole("button", { name: "Nobody home" }).click();
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
      await p.locator(".order", { hasText: "#0125" }).locator(".o-name").click();
      await p.evaluate(() => { const o = window.__orders.find((x) => x.num === "0125"); o.notes = "changed by florist"; o.updated_at = "2030-01-01T00:00:00Z"; });
      await p.locator("#f-addr").fill("New address 5");
      await p.locator(".sheet button[type=submit]").click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      const up = (await calls(p)).filter((c) => c.action === "update").pop();
      assert.deepEqual(Object.keys(up.row), ["address"]);
    });
    await step("B1 · A real clash asks before overwriting", async () => {
      await p.locator(".order", { hasText: "#0125" }).locator(".o-name").click();
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
      await p.locator(".order", { hasText: "#0124" }).locator(".o-name").click();
      await p.locator(".hist summary", { hasText: "More details" }).click();
      await p.locator(".sheet input[type=file]").nth(2).setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: png });
      await p.waitForTimeout(400);
      await p.locator(".sheet button[type=submit]").click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      const c = await calls(p), up = c.findIndex((x) => x.action === "update" && "proof_path" in x.row), rm = c.findIndex((x) => x.remove);
      assert(up >= 0 && rm > up, "remove must come after the update");
    });
    await step("Florist on the card: change with undo", async () => {
      await p.locator(".order", { hasText: "#0125" }).locator(".o-vendor select").selectOption("ana@example.com");
      await p.waitForTimeout(200);
      assert((await calls(p)).some((c) => c.action === "update" && c.row.vendor_email === "ana@example.com"));
      assert(await p.locator(".toast").last().innerText().then((s) => s.includes("Undo")));
    });
    await step("At-risk orders are flagged and filterable", async () => {
      assert(await p.locator("#filters .filter", { hasText: "At risk" }).isVisible());
    });
    await step("Server search across dates (phones by their last digits)", async () => {
      await p.locator("#q").fill("9171234567"); await p.waitForTimeout(500);
      assert((await calls(p)).some((c) => c.rpc === "cdf_search_orders" && c.args.p_query === "9171234567"));
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
      await p.locator(".order", { hasText: "#0126" }).locator(".o-name").click();
      assert(await p.locator(".hist summary", { hasText: "Change history" }).isVisible());
      await p.locator(".hist summary", { hasText: "Notification history" }).click();
      assert(await p.locator(".hist", { hasText: "Notification history" }).innerText().then((s) => s.includes("Customer")));
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
      assert(await p.locator(".col").count() >= 30);
      await capture(p, "stats-desktop");
    });
    await step("B6 · Team offers only admin, florist and driver", async () => {
      await p.locator("#tabTeam").click();
      assert.equal(await p.locator("#aRole option").count(), 3);
      await p.locator(".member .done-stats").first().waitFor();
      assert.match(await p.locator(".member .done-stats").first().innerText(), /12\s+this month[\s\S]*48\s+total/);
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
      assert(await q.locator(".entry").count() >= 3);
      assert.equal(await q.locator("#adminTools").getByRole("button", { name: /Archive/ }).count(), 0);
      await q.close();
    });
    await step("Mobile admin: calendar folds, no overflow", async () => {
      const q = await open("admin", { width: 390 });
      await capture(q, "admin-mobile");
      await q.locator("#calendarToggle").click(); await q.locator("#cal").waitFor({ state: "visible" });
      await q.locator("#newBtn").click(); await capture(q, "editor-mobile");
      await q.close();
    });
    await step("Mobile profile menu: views fit the drawer, preferences stack, brand closes the drawer", async () => {
      for (const role of ["admin", "vendor"]) {
        const q = await open(role, { width: 360 });
        assert.equal(await q.locator("#pricesBtn").isVisible(), role === "admin");
        await q.locator("#navOpen").click(); await q.waitForTimeout(300); await q.locator("#accountBtn").click();
        assert.equal(await q.locator('#account .mview[data-view="main"] .mitem:visible').count(), 4);
        await q.locator('#account [data-goto="prefs"]').click(); await q.waitForTimeout(250);
        const fits = await q.locator("#account .menu").evaluate((m) => { const r = m.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0; });
        assert(fits, "menu inside the viewport");
        const stacked = await q.locator('#account .mview[data-view="prefs"] .mrow').nth(1).evaluate((r) => r.lastElementChild.getBoundingClientRect().top > r.firstElementChild.getBoundingClientRect().bottom - 2);
        assert(stacked, "rows stack on narrow screens");
        await capture(q, "menu-prefs-mobile-" + role);
        await q.locator('#account .mview[data-view="prefs"] .mback').click(); await q.locator("#myAccountBtn").click();
        assert(await q.locator("#pwBtn").isVisible());
        await q.keyboard.press("Escape"); assert.equal(await q.evaluate(() => document.activeElement.id), "accountBtn"); await q.locator("#brandHome").click(); await q.waitForTimeout(300);
        assert.equal(await q.locator("#rail.drawer-open").count(), 0);
        await q.locator("#brandHomeMobile").click(); assert(await q.locator("#ordersView").isVisible());
        await q.close();
      }
    });
    await step("Florist: ready with bouquet, then head out asks first (RPCs)", async () => {
      const q = await open("vendor", { width: 390 });
      await q.locator(".work").first().waitFor();
      await q.locator("#summary .done-stats").waitFor();
      assert.match(await q.locator("#summary .done-stats").innerText(), /3\s+7 days/);
      await capture(q, "florist-mobile");
      await q.getByRole("button", { name: "Mark ready" }).first().click();
      await q.locator(".sheet").getByRole("button", { name: "Mark ready", exact: true }).click();
      await q.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      assert((await calls(q)).some((c) => c.rpc === "cdf_progress" && c.args.p_step === "ready"));
      await q.getByRole("button", { name: "Head out", exact: true }).first().click();
      await q.locator(".dialog").getByRole("button", { name: "Yes, on the way" }).click();
      await q.waitForTimeout(300);
      assert((await calls(q)).some((c) => c.rpc === "cdf_progress" && c.args.p_step === "transit"));
      await q.locator("#q").fill("Maria"); assert(await q.locator(".work").count() >= 1);
      await q.locator("#q").fill("zzzz"); assert.equal(await q.locator(".work").count(), 0);
      await q.close();
    });
    await step("Driver: nobody home reschedules, delivered confirms (RPCs)", async () => {
      const q = await open("carrier", { width: 390 });
      await q.locator(".work").first().waitFor(); await capture(q, "driver-mobile");
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
    await step("Integration: one tracking logo in every theme, animated current state, Reduced disables loops", async () => {
      const q=await open("track",{width:390});
      for(const theme of ["dark","light","auto"]){await q.evaluate(v=>{savePref("cdf-theme",v);applyPrefs()},theme);await q.waitForTimeout(250);assert.equal(await q.locator(".logo img:visible").count(),1)}
      for(const [delivery,status,animation] of [["-","Preparing","blade-a"],["-","Ready","bloom"],["In transit","Ready","drive"],["Delivered","Ready","beat"],["Failed","Ready","blink"]]){
       await q.evaluate(([d,s])=>{last.o.delivery=d;last.o.status=s;render()},[delivery,status]);
       // Preparing animates the scissor blades themselves; the other steps animate the whole icon
       assert.equal(await q.locator(status==="Preparing"?".tl li.cur .blade.a":status==="Ready"&&delivery==="-"?".tl li.cur .bouquet":".tl li.cur svg,.tl li.fail svg").evaluate(n=>getComputedStyle(n).animationName),animation);
      }
      await q.evaluate(()=>{savePref("cdf-motion","reduced");applyPrefs()});assert.equal(await q.locator(".tl .fail svg").evaluate(n=>getComputedStyle(n).animationIterationCount),"1");await q.close();
    });
    await step("Integration: Large grows body, buttons, fields and tracking descriptions",async()=>{
      const q=await open("admin");const before=await q.locator(".o-sub").first().evaluate(n=>parseFloat(getComputedStyle(n).fontSize));
      await q.evaluate(()=>{savePref("cdf-size","lg");applyPrefs()});assert((await q.locator(".o-sub").first().evaluate(n=>parseFloat(getComputedStyle(n).fontSize)))>before);
      await q.locator("#newBtn").click();
      const bad=await q.locator(".sheet input:not([type=file]),.sheet textarea,.sheet select").evaluateAll(ns=>ns.filter(n=>n.getClientRects().length&&!n.labels?.length&&!n.hasAttribute("aria-label")&&!n.hasAttribute("aria-labelledby")).length);assert.equal(bad,0);await q.close();
    });
    await step("Integration: mobile password is above the closed drawer",async()=>{
      const q=await open("admin",{width:390});await q.locator("#navOpen").click();await q.locator("#accountBtn").click();await q.locator("#myAccountBtn").click();await q.locator("#pwBtn").click();await q.waitForTimeout(300);
      assert.equal(await q.locator("#rail.drawer-open").count(),0);await q.locator(".sheet input").first().fill("safe-test-password");await q.close();
    });
    await step("Integration: complete statistics, live invalidation, historic customers and weekly buckets",async()=>{
      const q=await open("admin");await q.locator("#tabStats").click();await q.locator("table.top").waitFor();
      assert(await q.getByRole("heading",{name:"Ideas to grow"}).isVisible());assert(await q.getByRole("heading",{name:"Top customers"}).isVisible());
      const before=await q.locator(".kpi b").first().innerText();await q.evaluate(()=>{const row={...window.__orders[0],id:"new-stats",num:"9999"};window.__orders.push(row);window.__realtime({eventType:"INSERT",new:row})});await q.waitForTimeout(500);assert.notEqual(await q.locator(".kpi b").first().innerText(),before);
      await q.locator('#statsPeriod [data-days="90"]').click();await q.waitForTimeout(350);assert(await q.getByRole("heading",{name:"Orders per week"}).isVisible());await q.close();
    });
    await step("Phone country picker: Philippine flag and +63 by default, search, another country is kept", async () => {
      const q = await open("admin");
      await q.locator(".order", { hasText: "#0125" }).getByRole("button", { name: "Details" }).click();
      const pick = q.locator("#f-bphone").locator("xpath=..").locator("button.cc");
      assert.match(await pick.innerText(), /\+63/);
      assert.equal(await pick.locator("img.flag").getAttribute("src"), "/img/flags/ph.svg");
      await pick.click(); await q.locator(".cc-search:visible").fill("spa");
      await q.locator(".cc-opt:visible", { hasText: "+34" }).click();
      assert.equal(await pick.locator("img.flag").getAttribute("src"), "/img/flags/es.svg");
      await q.locator("#f-bphone").fill("691 089 459");
      await q.locator(".sheet").getByRole("button", { name: "Save", exact: true }).click();
      await q.waitForFunction(() => window.__orders.find((o) => o.num === "0125").buyer_phone === "+34691089459");
      await q.close();
    });
    await step("Team: edit a member's name and role; your own role is locked", async () => {
      const q = await open("admin");
      await q.locator("#tabTeam").click();
      await q.getByRole("button", { name: /Edit person: Jerold/ }).click();
      assert(await q.locator("#eRole").isDisabled());
      await q.keyboard.press("Escape");
      await q.getByRole("button", { name: /Edit person: Ana/ }).click();
      await q.locator("#eName").fill("Ana Cruz"); await q.locator("#eRole").selectOption("carrier");
      await q.locator(".dialog").getByRole("button", { name: "Save" }).click();
      await q.locator(".member", { hasText: "Ana Cruz" }).getByText("Driver").waitFor();
      await q.close();
    });
    // ---------- profiles and availability ----------
    const mnl = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(Date.now() + d * 864e5));
    const setDate = (loc, v) => loc.evaluate((x, v) => { x.value = v; x.dispatchEvent(new Event("input", { bubbles: true })); }, v);
    await step("Florist: My account shows the completed total; edits name, phone, photo and a future absence; all of it survives a reload", async () => {
      const q = await open("vendor");
      await q.locator("#accountBtn").click(); await q.locator("#myAccountBtn").click();
      await q.locator("#menuProfile").getByText("48 completed orders").waitFor();
      assert.match(await q.locator("#menuProfile .avail").innerText(), /Available/);
      await q.locator("#editProfileBtn").click();
      await q.locator(".sheet #pName").waitFor();
      assert.equal(await q.locator(".sheet input[type=email]").inputValue(), "ana@example.com");
      assert(await q.locator(".sheet").getByText("48 completed orders").isVisible());
      await q.locator("#pName").fill("Ana Reyes"); await q.locator("#pPhone").fill("917 555 1234");
      await q.locator("#pPhoto").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
      await q.locator(".sheet .avail-pick").selectOption("no");
      await setDate(q.locator(".sheet .absence input[type=date]").first(), mnl(2));
      await setDate(q.locator(".sheet .absence input[type=date]").nth(1), mnl(1));
      await q.locator(".sheet .absence select").selectOption("vacation");
      await q.locator(".sheet").getByRole("button", { name: "Save changes" }).click();
      // The end date can't go before the start (the picker's minimum blocks the save)
      assert(await q.locator(".sheet .absence input[type=date]").nth(1).evaluate((x) => x.validity.rangeUnderflow && x.min === x.form.querySelector(".absence input[type=date]").value));
      await q.waitForTimeout(200); assert.equal(await q.locator(".sheet").count(), 1);
      await setDate(q.locator(".sheet .absence input[type=date]").nth(1), mnl(4));
      assert(await q.locator(".sheet .notice").isHidden(), "no clash: Ana's orders are today");
      await capture(q, "profile-florist");
      await q.locator(".sheet").getByRole("button", { name: "Save changes" }).click();
      await q.locator(".sheet").waitFor({ state: "detached" });
      const c = await calls(q);
      assert(c.some((x) => x.upload === "cdf-avatars" && /^test\/avatar-\d+\.jpg$/.test(x.path)), "photo uploaded to the own folder");
      assert(c.some((x) => x.rpc === "cdf_save_profile" && x.args.p_name === "Ana Reyes" && x.args.p_phone === "+639175551234"));
      await q.reload(); await q.locator("#list").waitFor();
      assert.equal(await q.locator("#userName").innerText(), "Ana Reyes");
      assert(await q.locator("#userAvatar img").count() === 1, "photo shown in the rail");
      await q.locator("#accountBtn").click(); await q.locator("#myAccountBtn").click();
      const badge = q.locator("#menuProfile .avail");
      assert.equal(await badge.getAttribute("class"), "avail upcoming", "a future absence still counts as available until it starts");
      assert.match(await badge.innerText(), /Away from .* – .*Vacation/s);
      await q.keyboard.press("Escape");
      // Starting today: the florist is told about her own pending orders on those days
      await q.locator("#accountBtn").click(); await q.locator("#myAccountBtn").click(); await q.locator("#editProfileBtn").click();
      await setDate(q.locator(".sheet .absence input[type=date]").first(), mnl(0));
      await q.locator(".sheet .notice").getByText(/3 pending order/).waitFor();
      await q.close();
    });
    await step("Admin: banner lists pending orders during an absence; assigning to someone away asks first; Team shows and edits availability", async () => {
      const q = await open("admin", { before: { __ana: { phone: "639171112222", away_from: mnl(0), away_until: null, away_reason: "rest" } } });
      const banner = q.locator("#awayBanner");
      await banner.getByText("Pending orders assigned during an absence: 3").waitFor();
      assert.match(await banner.innerText(), /Ana · away until further notice/);
      await capture(q, "away-banner");
      await banner.getByRole("button", { name: /#0124/ }).click();
      await q.locator(".sheet").waitFor(); await q.keyboard.press("Escape"); await q.locator(".sheet").waitFor({ state: "detached" });
      const pick = q.locator(".entry", { hasText: "Elena Cruz" }).locator(".o-vendor select");
      const opts = await pick.locator("option").allInnerTexts();
      assert.match(opts[opts.length - 1], /Ana — away until further notice/, "away florists listed last and marked");
      await pick.selectOption("ana@example.com");
      await q.getByRole("alertdialog").getByText("Ana isn't available that day").waitFor();
      await q.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
      await q.getByRole("alertdialog").waitFor({ state: "detached" });
      await q.waitForFunction(() => [...document.querySelectorAll(".entry")].find((e) => e.textContent.includes("Elena Cruz")).querySelector(".o-vendor select").value === "");
      assert.equal(await q.evaluate(() => window.__orders.find((o) => o.num === "0125").vendor_email), null);
      await pick.selectOption("ana@example.com");
      await q.getByRole("alertdialog").getByRole("button", { name: "Assign anyway" }).click();
      await q.waitForFunction(() => window.__orders.find((o) => o.num === "0125").vendor_email === "ana@example.com");
      await q.locator("#tabTeam").click();
      const row = q.locator(".member", { hasText: "Ana" });
      assert.match(await row.locator(".avail").innerText(), /Away until further notice\s*· Rest/);
      assert.match(await row.innerText(), /\+639171112222/);
      assert.match(await row.innerText(), /48 total/);
      await capture(q, "team-availability");
      await q.getByRole("button", { name: /Edit person: Ana/ }).click();
      await q.locator(".dialog .avail-pick").selectOption("yes");
      await q.locator(".dialog").getByRole("button", { name: "Save" }).click();
      await row.locator(".avail.available").waitFor();
      await q.locator("#tabOrders").click(); await q.waitForTimeout(300);
      assert(await banner.isHidden(), "no absence, no banner");
      await q.reload(); await q.locator("#list").waitFor(); await q.waitForTimeout(300);
      assert(await banner.isHidden(), "still available after a reload");
      await q.close();
    });
    await step("Profiles on a phone: My account sheet and Team fit 390px", async () => {
      const q = await open("vendor", { width: 390 });
      await q.locator("#navOpen").click(); await q.waitForTimeout(300); await q.locator("#accountBtn").click(); await q.locator("#myAccountBtn").click();
      await q.locator("#editProfileBtn").click(); await q.locator(".sheet .avail-pick").selectOption("no");
      await capture(q, "profile-florist-mobile");
      await q.close();
      const a = await open("admin", { width: 390, before: { __ana: { away_from: mnl(1), away_until: mnl(3) } } });
      await a.evaluate(() => setTab("team")); await capture(a, "team-mobile");
      assert.equal(await a.locator(".member", { hasText: "Ana" }).locator(".avail.upcoming").count(), 1);
      await a.close();
    });
    await step("Without migration 017 the panel still works (no profile parts)", async () => {
      const q = await open("admin", { before: { __noMigration: true } });
      assert(await q.locator("#awayBanner").isHidden());
      await q.locator("#accountBtn").click(); await q.locator("#myAccountBtn").click();
      assert.equal(await q.locator("#editProfileBtn").count(), 0);
      await q.close();
    });
    await step("No uncaught JavaScript errors", async () => { assert.deepEqual(errors, []); });
  } finally { await browser.close(); server.close(); }
  fs.writeFileSync(path.join(out, "verification.json"), JSON.stringify({ results, errors, fixture: "Fake Supabase in the browser; no real requests." }, null, 2));
  console.log(results.join("\n"));
  if (errors.length) console.log("errors:", errors);
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
})().catch((e) => { console.error(e); server.close(); process.exitCode = 1; });
