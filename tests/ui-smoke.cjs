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
// Team chat (preview): messages per order (order_id) or for #equipo (order_id null), and how far each person has read.
// Kept in sessionStorage so a reload keeps the conversation.
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
window.__messages = JSON.parse(sessionStorage.getItem("__messages") || "null") || [
  { id: "m1", order_id: null, author_email: "driver@example.com", body: "Buenos días equipo! Hoy salgo a las 9 con la furgoneta 🚐", created_at: ago(150) },
  { id: "m2", order_id: null, author_email: "ana@example.com", body: "Nos quedan pocas cintas rojas, ¿alguien puede traer más de la tienda?", created_at: ago(70) },
  { id: "m3", order_id: "33333333-3333-3333-3333-333333333333", author_email: "ana@example.com", body: "La compradora pidió que la tarjeta no lleve su nombre, es sorpresa 🤫", created_at: ago(55) },
  { id: "m4", order_id: "33333333-3333-3333-3333-333333333333", author_email: "driver@example.com", body: "@Jerold ya estoy en Salcedo, el portero dice que suba al 12B. ¿Lo dejo en la puerta si no abren?", created_at: ago(8) },
  { id: "m5", order_id: "22222222-2222-2222-2222-222222222222", author_email: "driver@example.com", body: "No había nadie. Dejé una nota en recepción con nuestro número.", created_at: ago(200) },
];
window.__reads = JSON.parse(sessionStorage.getItem("__reads") || "null") || [
  { member_email: "admin@example.com", thread: "team", last_read_at: ago(100) },
  { member_email: "admin@example.com", thread: "22222222-2222-2222-2222-222222222222", last_read_at: ago(190) },
];
window.__reactions = JSON.parse(sessionStorage.getItem("__reactions") || "null") || [
  { message_id: "m2", member_email: "driver@example.com", emoji: "👍", created_at: ago(60) },
  { message_id: "m3", member_email: "admin@example.com", emoji: "✅", created_at: ago(50) },
  { message_id: "m3", member_email: "driver@example.com", emoji: "✅", created_at: ago(40) },
];
const keepChat = () => { sessionStorage.setItem("__reactions", JSON.stringify(window.__reactions)); sessionStorage.setItem("__messages", JSON.stringify(window.__messages)); sessionStorage.setItem("__reads", JSON.stringify(window.__reads)); };
window.__pushSubs = [];
const tables = () => ({ cdf_message_reactions: window.__reactions, cdf_push_subs: window.__pushSubs, cdf_messages: window.__messages, cdf_message_reads: window.__reads, cdf_orders: window.__orders, cdf_members: members, cdf_notifications: window.__notifications, cdf_order_events: window.__events, cdf_order_prices: window.__role === "admin" || !window.__role ? window.__prices : [] });
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
      if (table === "cdf_messages" && (window.__role === "vendor" || window.__role === "carrier")) { const seen = new Set(window.__orders.filter((o) => window.__role === "vendor" ? o.vendor_email === "ana@example.com" : o.status === "Ready" && o.delivery !== "Delivered").map((o) => o.id)); data = data.filter((m) => !m.order_id || seen.has(m.order_id)); }
      if (table === "cdf_message_reactions" && (window.__role === "vendor" || window.__role === "carrier")) { const ok = new Set(tables().cdf_messages.filter((m) => !m.order_id || window.__orders.some((o) => o.id === m.order_id && (window.__role === "vendor" ? o.vendor_email === "ana@example.com" : o.status === "Ready" && o.delivery !== "Delivered"))).map((m) => m.id)); data = data.filter((r) => ok.has(r.message_id)); }
      if ((window.__noChat && /^cdf_message/.test(table)) || (window.__noReactions && table === "cdf_message_reactions")) return Promise.resolve({ data: null, error: { code: "42P01", message: "relation does not exist" } }).then(resolve, reject);
      data = data.filter((o) => filters.every((f) => f(o)));
      if (action === "upsert" && table === "cdf_push_subs") { const r = window.__pushSubs.find((x) => x.endpoint === row.endpoint); if (r) Object.assign(r, row); else window.__pushSubs.push({ ...row }); data = [row]; }
      if (action === "upsert" && table === "cdf_message_reads") { const r = window.__reads.find((x) => x.member_email === row.member_email && x.thread === row.thread); if (r) Object.assign(r, row); else window.__reads.push({ ...row }); keepChat(); data = [row]; }
      if(action === "upsert" && table === "cdf_order_prices") {
        if(window.__role && window.__role !== "admin")return Promise.resolve({data:null,error:{message:"denied"}}).then(resolve,reject);
        const existing=window.__prices.find(p=>p.order_id===row.order_id);if(existing)Object.assign(existing,row);else window.__prices.push({...row});data=[row];
      }
      if (action !== "read") {
        window.__calls.push({ table, action, row, ids: data.map((o) => o.id) });
        if (action === "insert" && table === "cdf_messages") { const item = { ...row, id: "m" + Date.now(), created_at: new Date().toISOString() }; window.__messages.push(item); keepChat(); data = [item]; window.__chatReply && window.__chatReply(item); }
        else if (action === "insert") { const item = table === "cdf_orders" ? { ...base, ...row, id: "99999999-9999-9999-9999-" + String(Date.now()).slice(-12), code: "newcode1234", updated_at: new Date().toISOString() } : { ...row, ok: true, created_at: new Date().toISOString() }; tables()[table].push(item); data = [item]; }
        if (action === "update") data.forEach((o) => Object.assign(o, row, { updated_at: new Date().toISOString() }));
        if (action === "insert" && table === "cdf_message_reactions") keepChat();
        if (action === "delete" && table === "cdf_message_reactions") { window.__reactions = window.__reactions.filter((o) => !data.includes(o)); keepChat(); }
        else if (action === "delete" && table === "cdf_push_subs") window.__pushSubs = window.__pushSubs.filter((o) => !data.includes(o));
        else if (action === "delete") window.__orders = window.__orders.filter((o) => !data.includes(o));
      }
      if (lim) data = data.slice(offset, offset+lim);
      return Promise.resolve({ data: JSON.parse(JSON.stringify(data)), error: null }).then(resolve, reject);
    },
  };
  return q;
}
window.__chatReply = (m) => {
  if (window.__noAutoReply) return;
  const who = [["@ana", "ana@example.com", "👍 Visto, me encargo"], ["@luis", "driver@example.com", "Ok, en 10 minutos estoy ahí"], ["@jerold", "admin@example.com", "Perfecto, gracias"]].find(([k, e]) => m.body.toLowerCase().includes(k) && e !== m.author_email);
  if (!who) return;
  setTimeout(() => window.__typingCb && window.__typingCb({ payload: { thread: m.order_id || "team", email: who[1] } }), 700);
  setTimeout(() => { const r = { id: "m" + Date.now(), order_id: m.order_id, author_email: who[1], body: who[2], created_at: new Date().toISOString() }; window.__messages.push(r); keepChat(); window.__realtimeMsg && window.__realtimeMsg({ eventType: "INSERT", new: r }); }, 2600);
};
const steps = { prep: ["Preparing", "-"], ready: ["Ready", "-"], transit: ["Ready", "In transit"], done: ["Ready", "Delivered"], fail: ["Ready", "Failed"] };
window.supabase = { createClient: () => ({
  from: query,
  auth: { onAuthStateChange(cb) { queueMicrotask(() => { const session = window.__role === "login" ? null : { user: { id: "test", email: email[window.__role] || "admin@example.com" } }; cb("INITIAL_SESSION", session); if (window.__recovery && session) cb("PASSWORD_RECOVERY", session); }); },
    async signInWithPassword() { return { error: { message: "invalid" } }; }, async signOut() { return { error: null }; },
    async resetPasswordForEmail(mail, opts) { (window.__calls ||= []).push({ reset: mail, redirectTo: opts?.redirectTo }); return { error: null }; },
    async updateUser(u) { (window.__calls ||= []).push({ updateUser: !!u.password }); return { error: null }; } },
  storage: { from: (b) => ({ createSignedUrl: async (p) => ({ data: { signedUrl: "/img/emblem.webp" } }),
    upload: async (p) => { window.__calls.push({ upload: b, path: p }); return { error: null }; },
    remove: async (p) => { window.__calls.push({ remove: b, paths: p }); return { error: null }; } }) },
  channel: () => ({ on(_a, config, cb) { if(config.table==="cdf_order_prices")window.__realtimePrice=cb;else if(config.table==="cdf_messages")window.__realtimeMsg=cb;else if(config.table==="cdf_message_reactions")window.__realtimeReact=cb;else if(_a==="broadcast")window.__typingCb=cb;else window.__realtime = cb; return this; }, subscribe() { return this; }, send(m) { (window.__calls ||= []).push({ broadcast: m.event, payload: m.payload }); return Promise.resolve("ok"); } }), removeChannel() {},
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
    if (name === "cdf_team_directory") return { data: members.map(({ email, name, role, avatar_path, username }) => ({ email, name, role, avatar_path: avatar_path || null, username: username || null })), error: null };
    const me = email[window.__role] || "admin@example.com";
    if (name === "cdf_set_my_username") { if (args.p_username === "taken") return { data: null, error: { code: "23505", message: "duplicate" } }; const m = members.find((x) => x.email === me); m.username = args.p_username; keepMembers(); return { data: { ...m }, error: null }; }
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

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".webmanifest": "application/manifest+json" };
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
    await p.waitForTimeout(600);
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
      await p.waitForTimeout(500); assert.equal(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(23, 23, 23)");
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
      assert.deepEqual(await main.locator(".mitem").allInnerTexts(), ["Preferences", "My account", "Send a suggestion", "Install the app", "Sign out"]);
      assert.equal(await main.locator(".mhead small").innerText(), "Admin");
      assert.equal(await p.locator("#account .mrow:visible").count(), 0);
      await p.locator('#account [data-goto="prefs"]').click();
      assert.equal(await p.locator("#account .mrow:visible").count(), 5);
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
      await p.locator("#pricesBtn").click(); await p.waitForTimeout(650);
      assert.equal(await p.evaluate(() => localStorage.getItem("cdf-prices")), "on");
      assert.equal(await p.locator("#pricesBtn").getAttribute("aria-pressed"), "true");
      assert(await p.locator(".amt").count() > 0);
      await p.locator("#pricesBtn").click(); await p.waitForTimeout(650);
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
      await p.waitForTimeout(650);
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
      await p.waitForTimeout(600);
      assert((await calls(p)).some((c) => c.action === "update" && c.row.vendor_email === "ana@example.com"));
      assert(await p.locator(".toast").last().innerText().then((s) => s.includes("Undo")));
    });
    await step("At-risk orders are flagged and filterable", async () => {
      // Deterministic at any hour: an undelivered order from yesterday is always "late"
      await p.evaluate(() => { const row = { ...window.__orders[0], id: "risk-late", num: "0777", date: addDays(S.today, -1), status: "Ready", delivery: "-" }; window.__orders.push(row); window.__realtime({ eventType: "INSERT", new: row }); });
      await p.locator("#filters .filter", { hasText: "At risk" }).waitFor();
      await p.evaluate(() => { window.__orders = window.__orders.filter((o) => o.id !== "risk-late"); window.__realtime({ eventType: "DELETE", old: { id: "risk-late" } }); });
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
      await p.waitForTimeout(600);
      assert((await calls(p)).some((c) => c.action === "update" && c.row.status === "Ready" && c.ids.length >= 1));
      await p.locator("#bulk").getByRole("button", { name: "Done" }).click();
    });
    await step("Archive delivered (keeps history), with undo", async () => {
      await p.locator("#adminTools").getByRole("button", { name: /Archive delivered/ }).click();
      await p.locator(".dialog").getByRole("button", { name: "Archive" }).click();
      await p.waitForTimeout(600);
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
      const orderReads = (c) => c.filter((x) => x.rpc !== "cdf_away_conflicts"), reads = orderReads(await calls(p)).length;
      await p.evaluate(() => window.__realtime({ eventType: "UPDATE", new: { ...window.__orders.find((o) => o.num === "0126"), customer_name: "Realtime Name" } }));
      await p.waitForTimeout(650);
      assert(await p.locator(".o-name", { hasText: "Realtime Name" }).isVisible());
      { const c = orderReads(await calls(p)); assert.equal(c.length, reads, JSON.stringify(c.slice(reads))); }
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
        await q.locator("#navOpen").click(); await q.waitForTimeout(650); await q.locator("#accountBtn").click();
        assert.equal(await q.locator('#account .mview[data-view="main"] .mitem:visible').count(), 5);
        await q.locator('#account [data-goto="prefs"]').click(); await q.waitForTimeout(600);
        const fits = await q.locator("#account .menu").evaluate((m) => { const r = m.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0; });
        assert(fits, "menu inside the viewport");
        const stacked = await q.locator('#account .mview[data-view="prefs"] .mrow').nth(1).evaluate((r) => r.lastElementChild.getBoundingClientRect().top > r.firstElementChild.getBoundingClientRect().bottom - 2);
        assert(stacked, "rows stack on narrow screens");
        await capture(q, "menu-prefs-mobile-" + role);
        await q.locator('#account .mview[data-view="prefs"] .mback').click(); await q.locator("#myAccountBtn").click();
        assert(await q.locator("#pwBtn").isVisible());
        await q.keyboard.press("Escape"); assert.equal(await q.evaluate(() => document.activeElement.id), "accountBtn"); await q.locator("#brandHome").click(); await q.waitForTimeout(650);
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
      await q.waitForTimeout(650);
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
    await step("Step buttons take their next state's colour on hover", async () => {
      const q = await open("vendor");await q.locator("#list .work").first().waitFor();
      for (const [cls, rgb] of [["to-ready","rgb(141, 183, 201)"],["to-transit","rgb(169, 159, 230)"],["to-done","rgb(101, 189, 145)"],["to-fail","rgb(224, 123, 123)"]]) {
        const b=q.locator(".btn."+cls).first();await b.scrollIntoViewIfNeeded();await b.hover();await q.waitForTimeout(700);
        assert.equal(await b.evaluate(n=>getComputedStyle(n).backgroundColor),rgb,cls);
      }
      await q.close();
    });
    await step("Chat: unread counts, #team, mentions answered live, order conversation, florist sees only her threads", async () => {
      const q = await open("admin");await q.locator("#list").waitFor();await q.locator("#tabChat .rail-count:visible").waitFor();
      assert.equal(await q.locator("#tabChat .rail-count").innerText(), "3");
      assert.equal(await q.locator(".chat-chip.unread").count(), 1);
      await q.locator("#tabChat").click();await q.locator(".thread").first().waitFor();
      assert.deepEqual(await q.locator(".thread b").allInnerTexts(), ["#team", "#0126 · Maria Santos", "#0125 · Elena Cruz"]);
      const input = q.locator(".chat-pane .chat-input");
      await input.click();await input.pressSequentially("Hola @A");
      await q.locator(".mention-opt", { hasText: "Ana" }).waitFor();await input.press("Enter");
      await input.pressSequentially("check the ribbons for #Ri");
      assert.match(await q.locator(".mention-opt").first().innerText(), /#0127/, "a name that starts with it comes first");
      await input.press("Enter");await input.press("Enter");
      await q.locator(".chat-pane .cmsg", { hasText: "check the ribbons" }).waitFor();
      assert.equal(await q.locator(".chat-pane .cmsg .order-ref", { hasText: "#0127" }).count(), 1, "#number becomes a link");
      assert.equal(await q.locator(".chat-pane .cmsg .mention", { hasText: "@Ana" }).count(), 1);
      assert(await q.evaluate(() => window.__calls.some((c) => c.table === "cdf_messages" && c.action === "insert" && c.row.order_id === null)));
      await q.locator(".chat-pane .cmsg", { hasText: "Visto, me encargo" }).waitFor({ timeout: 6000 });
      await q.locator(".chat-pane .order-ref", { hasText: "#0127" }).click();await q.locator(".sheet h2", { hasText: "0127" }).waitFor();
      await q.keyboard.press("Escape");await q.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      await q.locator(".thread", { hasText: "#0126" }).click();await q.waitForTimeout(500);
      assert.equal(await q.locator("#tabChat .rail-count").isVisible(), false, "all read");
      await q.locator("#tabOrders").click();await q.locator(".chat-chip[data-chat]").first().click();
      await q.locator(".sheet #chatSection .cmsg").first().waitFor();await q.close();
      const v = await open("vendor");await v.locator("#tabChat:visible").waitFor();await v.locator("#tabChat").click();await v.locator(".thread").first().waitFor();
      assert.deepEqual(await v.locator(".thread b").allInnerTexts(), ["#team", "#0126 · Maria Santos"]);await v.close();
      const n = await open("admin", { before: { __noChat: true } });await n.locator("#list").waitFor();await n.waitForTimeout(400);
      assert.equal(await n.locator("#tabChat").isHidden(), true, "no chat tables: no chat, nothing breaks");await n.close();
    });
    await step("Chat v2: bubbles, New line, reactions, emoji panel, typing, list search and filter", async () => {
      const q = await open("admin");await q.locator("#list").waitFor();await q.locator("#tabChat").click();
      await q.locator(".chat-pane .chat-new").waitFor();
      assert.equal(await q.locator(".chat-pane .react", { hasText: "👍" }).count(), 1, "seeded reaction");
      const ana = q.locator(".chat-pane .cmsg:not(.mine)").last();await ana.hover();
      await ana.locator(".tool-e", { hasText: "🎉" }).click();
      await ana.locator(".react.mine", { hasText: "🎉" }).waitFor();
      assert(await q.evaluate(() => window.__calls.some((c) => c.table === "cdf_message_reactions" && c.action === "insert" && c.row.emoji === "🎉")));
      await ana.locator(".react.mine", { hasText: "🎉" }).click();await q.waitForTimeout(400);
      assert.equal(await ana.locator(".react", { hasText: "🎉" }).count(), 0, "a second tap removes it");
      await q.locator(".chat-pane .chat-emoji").click();await q.locator(".emoji-pop .emoji-search").fill("flower");
      assert(await q.locator(".emoji-pop .emoji-btn").count() >= 10, "searching a category name lists the category");
      await q.locator(".emoji-pop .emoji-btn", { hasText: "🌷" }).click();
      assert.equal(await q.locator(".chat-pane .chat-input").inputValue(), "🌷");
      await q.evaluate(() => window.__typingCb({ payload: { thread: "team", email: "driver@example.com" } }));
      await q.locator(".chat-pane .chat-typing.on", { hasText: "Luis is typing" }).waitFor();
      await q.locator(".chat-search").fill("salcedo");
      assert.deepEqual(await q.locator(".thread b").allInnerTexts(), ["#0126 · Maria Santos"]);
      await q.locator(".chat-search").fill("");await q.locator(".chat-filter button", { hasText: "Unread" }).click();
      assert(await q.locator(".thread").count() >= 1);await q.close();
      const n = await open("admin", { before: { __noReactions: true } });await n.locator("#list").waitFor();await n.locator("#tabChat").click();
      await n.locator(".chat-pane .cmsg").first().waitFor();
      assert.equal(await n.locator(".chat-pane .tool-e").count(), 0, "no reactions table: no reaction buttons");await n.close();
    });
    await step("Installable app: manifest and icons, service worker, install entry, notifications row, notification links", async () => {
      const q = await open("admin");await q.locator("#list").waitFor();
      const man = await q.evaluate(async () => { const href = document.querySelector("link[rel=manifest]").href; const m = await (await fetch(href)).json(); const ok = await Promise.all(m.icons.map(async (i) => (await fetch(i.src)).ok)); return { name: m.short_name, display: m.display, icons: m.icons.length, ok: ok.every(Boolean), maskable: m.icons.some((i) => i.purpose === "maskable") }; });
      assert.deepEqual(man, { name: "Pedidos", display: "standalone", icons: 3, ok: true, maskable: true });
      assert.equal(await q.locator('link[rel="apple-touch-icon"]').getAttribute("href"), "/img/apple-touch-icon.png");
      assert.equal(await q.evaluate(async () => !!(await navigator.serviceWorker.ready).active), true, "service worker active");
      await q.locator("#accountBtn").click();assert(await q.locator("#installBtn").isVisible(), "install entry in the account menu");
      await q.locator("#installBtn").click();await q.locator(".sheet .install-steps li").first().waitFor();
      assert.equal(await q.locator(".sheet .install-steps li").count(), 3);await q.keyboard.press("Escape");await q.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      await q.locator("#accountBtn").click();await q.locator('#account [data-goto="prefs"]').click();
      assert(await q.locator("#notifBtn").isVisible());assert.notEqual(await q.locator("#notifState").innerText(), "");await q.keyboard.press("Escape");
      await q.evaluate(() => openDeepLink(new URLSearchParams("chat=team")));await q.locator("#chatView:visible .thread.on", { hasText: "#team" }).waitFor();
      await q.evaluate(() => openDeepLink(new URLSearchParams("order=33333333-3333-3333-3333-333333333333")));await q.locator(".sheet h2", { hasText: "0126" }).waitFor();
      await q.close();
    });
    await step("New version: notice, then reloads by itself once no sheet is open", async () => {
      const q = await open("admin");let v="a";
      await q.route("**/version.json*",(r)=>r.fulfill({contentType:"application/json",body:JSON.stringify({v})}));
      await q.evaluate(()=>checkVersion());await q.locator("#list").waitFor();
      await q.locator("#newBtn").click();await q.locator(".sheet").waitFor();
      v="b";await q.evaluate(()=>{window.__samePage=1;return checkVersion()});
      await q.locator(".toast",{hasText:"new version"}).waitFor();
      await q.waitForTimeout(4500);assert.equal(await q.evaluate(()=>window.__samePage),1,"no reload while the sheet is open");
      const nav=q.waitForEvent("framenavigated");await q.evaluate(()=>closeSheet(true));await nav;await q.close();
    });
    await step("By channel: logos rest grey and take the picker's chosen look on hover", async () => {
      const q = await open("admin");await q.locator("#tabStats").click();await q.locator(".hbar .chan-logo").first().waitFor();
      const row=q.locator(".hbar",{hasText:"Shopify"}).first(),logo=row.locator(".chan-logo");
      assert.notEqual(await logo.evaluate(n=>getComputedStyle(n).backgroundColor),"rgb(35, 141, 97)");
      await row.hover();await q.waitForTimeout(700);
      assert.equal(await logo.evaluate(n=>getComputedStyle(n).backgroundColor),"rgb(35, 141, 97)");
      assert.match(await logo.locator("img").evaluate(n=>getComputedStyle(n).filter),/invert\(1\)/);await q.close();
    });
    await step("Forgotten password: email link request, then a new password on return", async () => {
      const q = await open("login");
      await q.locator("#lEmail").fill("ana.alias");await q.locator("#forgotBtn").click();
      const mail=q.locator(".sheet input[type=email]");assert.equal(await mail.inputValue(),"");
      await mail.fill("nope@x");await q.locator(".sheet button[type=submit]").click();assert.match(await q.locator(".sheet .err").innerText(),/valid email/);
      await mail.fill("Ana@Example.com");await q.locator(".sheet button[type=submit]").click();await q.waitForTimeout(700);
      const calls=await q.evaluate(()=>window.__calls.filter(c=>c.reset));assert.deepEqual(calls,[{reset:"ana@example.com",redirectTo:new URL(q.url()).origin+"/"}]);
      assert.equal(await q.locator(".sheet").count(),0);await q.close();
      const r = await open("admin",{before:{__recovery:true}});
      await r.getByRole("heading",{name:"Choose a new password"}).waitFor();
      const pw=r.locator(".sheet input[type=password]");await pw.nth(0).fill("brand-new-pass");await pw.nth(1).fill("brand-new-pass");
      await r.locator(".sheet button[type=submit]").click();await r.waitForTimeout(700);
      assert.deepEqual(await r.evaluate(()=>window.__calls.filter(c=>"updateUser" in c)),[{updateUser:true}]);await r.close();
    });
    await step("Integration: one tracking logo in every theme, animated current state, Reduced disables loops", async () => {
      const q=await open("track",{width:390});
      for(const theme of ["dark","light","auto"]){await q.evaluate(v=>{savePref("cdf-theme",v);applyPrefs()},theme);await q.waitForTimeout(600);assert.equal(await q.locator(".logo img:visible").count(),1)}
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
      const q=await open("admin",{width:390});await q.locator("#navOpen").click();await q.locator("#accountBtn").click();await q.locator("#myAccountBtn").click();await q.locator("#pwBtn").click();await q.waitForTimeout(650);
      assert.equal(await q.locator("#rail.drawer-open").count(),0);await q.locator(".sheet input").first().fill("safe-test-password");await q.close();
    });
    await step("Integration: complete statistics, live invalidation, historic customers and weekly buckets",async()=>{
      const q=await open("admin");await q.locator("#tabStats").click();await q.locator("table.top").waitFor();
      assert(await q.getByRole("heading",{name:"Ideas to grow"}).isVisible());assert(await q.getByRole("heading",{name:"Top customers"}).isVisible());
      const before=await q.locator(".kpi b").first().innerText();await q.evaluate(()=>{const row={...window.__orders[0],id:"new-stats",num:"9999"};window.__orders.push(row);window.__realtime({eventType:"INSERT",new:row})});await q.waitForTimeout(500);assert.notEqual(await q.locator(".kpi b").first().innerText(),before);
      await q.locator('#statsPeriod [data-days="90"]').click();await q.waitForTimeout(700);assert(await q.getByRole("heading",{name:"Orders per week"}).isVisible());
      assert.match(await q.locator("#statsAvail").innerText(),/^Data available: .+ to .+ · \d+ orders$/);
      await q.locator('#statsPeriod [data-days="custom"]').click();assert(await q.locator("#statsFrom").isVisible());
      const min=await q.locator("#statsFrom").getAttribute("min"),max=await q.locator("#statsTo").getAttribute("max");assert(min<=max);
      await q.locator("#statsFrom").fill(max);await q.locator("#statsFrom").dispatchEvent("change");await q.waitForTimeout(700);
      assert.match(await q.locator(".chart-card .chart-head small").first().innerText(),/· 1 days$/);await q.close();
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
      await q.locator("#menuProfile").getByText("48 orders delivered").waitFor();
      assert.match(await q.locator("#menuProfile .avail").innerText(), /Available/);
      await q.locator("#editProfileBtn").click();
      await q.locator(".sheet #pName").waitFor();
      assert.equal(await q.locator(".sheet input[type=email]").inputValue(), "ana@example.com");
      assert(await q.locator(".sheet").getByText("48 orders delivered").isVisible());
      await q.locator("#pName").fill("Ana Reyes"); await q.locator("#pPhone").fill("917 555 1234");
      await q.locator("#pPhoto").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
      await q.locator(".sheet .avail-pick").selectOption("no");
      await setDate(q.locator(".sheet .absence input[type=date]").first(), mnl(2));
      await setDate(q.locator(".sheet .absence input[type=date]").nth(1), mnl(1));
      await q.locator(".sheet .absence select").selectOption("vacation");
      await q.locator(".sheet").getByRole("button", { name: "Save changes" }).click();
      // The end date can't go before the start (the picker's minimum blocks the save)
      assert(await q.locator(".sheet .absence input[type=date]").nth(1).evaluate((x) => x.validity.rangeUnderflow && x.min === x.form.querySelector(".absence input[type=date]").value));
      await q.waitForTimeout(600); assert.equal(await q.locator(".sheet").count(), 1);
      await setDate(q.locator(".sheet .absence input[type=date]").nth(1), mnl(4));
      assert(await q.locator(".sheet .notice").isHidden(), "no clash: Ana's orders are today");
      await capture(q, "profile-florist");
      // Own username: a taken one is refused and keeps the sheet open; a free one saves
      await q.locator("#pUsername").fill("taken");
      await q.locator(".sheet").getByRole("button", { name: "Save changes" }).click();
      await q.locator(".sheet .err", { hasText: "already" }).waitFor();
      await q.locator("#pUsername").fill("Ana.Reyes");
      await q.locator(".sheet").getByRole("button", { name: "Save changes" }).click();
      await q.locator(".sheet").waitFor({ state: "detached" });
      const c = await calls(q);
      assert(c.some((x) => x.upload === "cdf-avatars" && /^test\/avatar-\d+\.jpg$/.test(x.path)), "photo uploaded to the own folder");
      assert(c.some((x) => x.rpc === "cdf_save_profile" && x.args.p_name === "Ana Reyes" && x.args.p_phone === "+639175551234"));
      assert(c.some((x) => x.rpc === "cdf_set_my_username" && x.args.p_username === "ana.reyes"), "own username saved in lowercase");
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
      await q.locator("#tabOrders").click(); await q.waitForTimeout(650);
      assert(await banner.isHidden(), "no absence, no banner");
      await q.reload(); await q.locator("#list").waitFor(); await q.waitForTimeout(650);
      assert(await banner.isHidden(), "still available after a reload");
      await q.close();
    });
    await step("Profiles on a phone: My account sheet and Team fit 390px", async () => {
      const q = await open("vendor", { width: 390 });
      await q.locator("#navOpen").click(); await q.waitForTimeout(650); await q.locator("#accountBtn").click(); await q.locator("#myAccountBtn").click();
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
