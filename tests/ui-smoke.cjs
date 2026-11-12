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
window.__prices = window.__orders.map(o=>({order_id:o.id,amount:2500,paid:null,payment_history:[]}));
if (window.__paymentDemo) {
  window.__orders[0].photo_path = "sample/reference.jpg";
  window.__orders[0].extra_photos = ["sample/more.jpg"];
  window.__prices[0].paid = 2000;
  window.__prices[0].payment_history.push({ id: "opening", kind: "opening", amount: 2000, proofs: ["sample/transfer.jpg"] });
}
// A14: open a page with some orders already cancelled by the office
for (const o of window.__orders) if ((window.__cancelNums || []).includes(o.num)) Object.assign(o, { cancelled_at: "2026-11-07T10:00:00Z", cancelled_by: "admin@example.com", cancel_reason: "Customer cancelled" });
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
const directThreads = [], directMessages = [];
const tables = () => ({ cdf_direct_threads: directThreads, cdf_direct_messages: directMessages, cdf_message_reactions: window.__reactions, cdf_push_subs: window.__pushSubs, cdf_messages: window.__messages, cdf_message_reads: window.__reads, cdf_orders: window.__orders, cdf_members: members, cdf_notifications: window.__notifications, cdf_order_events: window.__events, cdf_order_prices: window.__role === "admin" || !window.__role ? window.__prices : [],
  // Phase 3: requests from the public form; only admins read them (RLS)
  cdf_order_requests: window.__role === "admin" || !window.__role ? (window.__requests ||= []) : [], cdf_request_files: window.__role === "admin" || !window.__role ? (window.__requestFiles ||= []) : [],
  cdf_request_events: window.__role === "admin" || !window.__role ? (window.__requestEvents ||= []) : [] });
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
      // A03: lets a test land another admin's save between this client's read and its write
      if (action === "update" && table === "cdf_orders" && window.__race) { const r = window.__race; window.__race = null; r(); }
      data = data.filter((o) => filters.every((f) => f(o)));
      // tests/notif-calendar.cjs: a database without migration 028 (no lang column), and a device still tied to someone else (RLS)
      if (action === "upsert" && table === "cdf_push_subs" && window.__noLang && "lang" in row) return Promise.resolve({ data: null, error: { code: "PGRST204", message: "Could not find the 'lang' column of 'cdf_push_subs' in the schema cache" } }).then(resolve, reject);
      if (action === "upsert" && table === "cdf_push_subs" && window.__pushSubs.some((x) => x.endpoint === row.endpoint && x.member_email !== row.member_email)) return Promise.resolve({ data: null, error: { code: "42501", message: "new row violates row-level security policy" } }).then(resolve, reject);
      if (action === "upsert" && table === "cdf_push_subs") { const r = window.__pushSubs.find((x) => x.endpoint === row.endpoint); if (r) Object.assign(r, row); else window.__pushSubs.push({ ...row }); data = [row]; }
      if (action === "upsert" && table === "cdf_message_reads") { const r = window.__reads.find((x) => x.member_email === row.member_email && x.thread === row.thread); if (r) Object.assign(r, row); else window.__reads.push({ ...row }); keepChat(); data = [row]; }
      if(action === "upsert" && table === "cdf_order_prices") {
        if(window.__role && window.__role !== "admin")return Promise.resolve({data:null,error:{message:"denied"}}).then(resolve,reject);
        const existing=window.__prices.find(p=>p.order_id===row.order_id);if(existing)Object.assign(existing,row);else window.__prices.push({...row});data=[row];
      }
      if (action !== "read") {
        window.__calls.push({ table, action, row, ids: data.map((o) => o.id) });
        if (action === "insert" && table === "cdf_messages") { const item = { ...row, id: "m" + Date.now(), created_at: new Date().toISOString(), edited_at: null }; window.__messages.push(item); keepChat(); data = [item]; window.__chatReply && window.__chatReply(item); }
        else if (action === "insert" && table === "cdf_direct_messages") { const item = { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString(), edited_at: null }; directMessages.push(item); data = [item]; }
        else if (action === "insert") { const item = table === "cdf_orders" ? { ...base, ...row, id: "99999999-9999-9999-9999-" + String(Date.now()).slice(-12), code: "newcode1234", updated_at: new Date().toISOString() } : { ...row, ok: true, created_at: new Date().toISOString() }; tables()[table].push(item); data = [item]; }
        if (action === "update") {
          const time = new Date().toISOString();
          const chat = ["cdf_messages", "cdf_direct_messages"].includes(table);
          data.forEach((o) => Object.assign(o, row, chat ? { edited_at: time } : { updated_at: time }));
          if (table === "cdf_messages") keepChat();
        }
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
  channel: () => ({ on(_a, config, cb) { if(config.table==="cdf_order_prices")window.__realtimePrice=cb;else if(config.table==="cdf_messages"&&config.event==="INSERT")window.__realtimeMsg=cb;else if(config.table==="cdf_messages"&&config.event==="UPDATE")window.__realtimeEdit=cb;else if(config.table==="cdf_message_reactions")window.__realtimeReact=cb;else if(_a==="broadcast")window.__typingCb=cb;else if(config.table==="cdf_orders")window.__realtime=cb;else if(config.table==="cdf_order_requests")window.__realtimeRequest=cb; return this; }, subscribe() { return this; }, send(m) { (window.__calls ||= []).push({ broadcast: m.event, payload: m.payload }); return Promise.resolve("ok"); } }), removeChannel() {},
  functions: { invoke: async (name, args) => { window.__calls.push({ function: name, args }); return { data: { ok: true }, error: null }; } },
  rpc: (name, args) => {
    if (name === "cdf_open_direct") return { single: async () => {
      const [member_a, member_b] = [email[window.__role] || "admin@example.com", args.peer].sort();
      let data = directThreads.find((d) => d.member_a === member_a && d.member_b === member_b);
      if (!data) { data = { id: crypto.randomUUID(), member_a, member_b }; directThreads.push(data); }
      return { data, error: null };
    } };
    return (async () => {
    window.__calls.push({ rpc: name, args });
    // Order + price + first payment in one step (same answers as the database function)
    if (name === "cdf_create_order") {
      if (window.__noCreateRpc) return { error: { code: "PGRST202", message: "Could not find the function public.cdf_create_order" } };
      if (window.__role && window.__role !== "admin") return { error: { code: "42501", message: "Forbidden" } };
      if (!args.p_request && !args.p_order) return { data: { available: true } };
      if (!args.p_request || !args.p_order) return { error: { code: "P0001", message: "cdf_invalid_order" } };
      if (window.__createOffline) return { error: { message: "TypeError: Failed to fetch" } };
      const keys = (window.__opKeys ||= {}), print = JSON.stringify([args.p_order, args.p_price, args.p_payment]);
      const answer = (k, replayed) => ({ data: JSON.parse(JSON.stringify({ order: window.__orders.find((o) => o.id === k.id), price: window.__prices.find((p) => p.order_id === k.id) || null, replayed })) });
      if (keys[args.p_request]) return keys[args.p_request].print === print ? answer(keys[args.p_request], true) : { error: { code: "P0001", message: "cdf_operation_conflict" } };
      const pay = args.p_payment;
      if (pay && (!(pay.amount > 0) || Math.round(pay.amount * 100) !== pay.amount * 100 || !pay.method || !/^\d{4}-\d{2}-\d{2}$/.test(pay.paid_at || "") || args.p_price == null)) return { error: { code: "P0001", message: "cdf_invalid_payment" } };
      if (pay && pay.amount > args.p_price) return { error: { code: "P0001", message: "cdf_payment_above_due" } };
      if (window.__orders.some((o) => o.num === args.p_order.num)) return { error: { code: "23505", message: 'duplicate key value violates unique constraint "cdf_orders_num_key"' } };
      const order = { ...base, proof_path: null, ...args.p_order, code: "new" + String(Date.now()).slice(-7), updated_at: new Date().toISOString() };
      window.__orders.push(order);
      if (args.p_price != null) window.__prices.push({ order_id: order.id, amount: args.p_price, paid: pay ? pay.amount : null, pay_proofs: [],
        payment_history: pay ? [{ id: args.p_request, kind: "payment", amount: pay.amount, created_at: new Date().toISOString(), by_email: "admin@example.com",
          proofs: pay.proofs || [], reverses: null, reason: null, method: pay.method, reference: pay.reference || null, paid_at: pay.paid_at }] : [] });
      keys[args.p_request] = { id: order.id, print };
      if (window.__createResponseLost) { window.__createResponseLost = false; return { error: { message: "TypeError: Failed to fetch" } }; }
      return answer(keys[args.p_request], false);
    }
    // Phase 4: the nearest shop (same rules as cdf_branch_ranking, over the fake team)
    if (name === "cdf_branch_ranking") {
      if (window.__role && window.__role !== "admin") return { data: null, error: { code: "42501", message: "Forbidden" } };
      if (args.p_lat == null || args.p_lng == null) return { data: null, error: { code: "P0001", message: "cdf_invalid_point" } };
      const rad = (d) => (d * Math.PI) / 180, km = (a, b, c, d) => Math.round(2 * 6371 * Math.asin(Math.sqrt(Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2)) * 100) / 100;
      const away = (m) => !!(args.p_date && m.away_from && args.p_date >= m.away_from && (!m.away_until || args.p_date <= m.away_until));
      const flo = members.filter((m) => m.role === "vendor"), ok = (m) => m.pickup_lat != null && (m.branch || "").trim();
      const shops = {};
      for (const m of flo.filter(ok)) { const k = m.branch + "|" + (+m.pickup_lat).toFixed(5) + "|" + (+m.pickup_lng).toFixed(5);
        (shops[k] ||= { branch: m.branch, address: m.pickup_address, lat: +m.pickup_lat, lng: +m.pickup_lng, km: km(+args.p_lat, +args.p_lng, +m.pickup_lat, +m.pickup_lng), florists: [] }).florists.push({ email: m.email, name: m.name, away: away(m) }); }
      const ranked = Object.values(shops).map((s) => ({ ...s, florists: s.florists.sort((a, b) => a.away - b.away || a.name.localeCompare(b.name)), all_away: s.florists.every((f) => f.away) }))
        .sort((a, b) => a.all_away - b.all_away || a.km - b.km || a.branch.localeCompare(b.branch));
      const incomplete = flo.filter((m) => !ok(m)).map((m) => ({ email: m.email, name: m.name, missing: [m.pickup_lat == null ? "point" : null, !(m.branch || "").trim() ? "branch" : null].filter(Boolean) }));
      return { data: { ranked, incomplete, conflicts: [] }, error: null };
    }
    // Phase 3: reviewing requests (same answers as the database functions in migration 20261111110000)
    if (/^cdf_request_|^cdf_order_references$/.test(name)) {
      const me = email[window.__role] || "admin@example.com", admin = !window.__role || window.__role === "admin";
      const reqs = (window.__requests ||= []), evs = (window.__requestEvents ||= []), files = (window.__requestFiles ||= []);
      const copy = (v) => JSON.parse(JSON.stringify(v));
      if (name === "cdf_order_references") {
        const r = reqs.find((x) => x.accepted_order_id === args.p_order), o = window.__orders.find((x) => x.id === args.p_order);
        if (!r || !o) return { data: [], error: null };
        return { data: files.filter((f) => f.request_id === r.id && (admin || (f.kind === "reference" && o.vendor_email === me))).map((f) => ({ ...f, request_ref: r.ref })), error: null };
      }
      if (!admin) return { data: null, error: { code: "42501", message: "Forbidden" } };
      const r = reqs.find((x) => x.id === args.p_id);
      if (!r) return { data: null, error: { code: "P0001", message: "cdf_request_gone" } };
      const ev = (kind, detail = {}) => evs.push({ request_id: r.id, kind, by_email: me, detail, created_at: new Date().toISOString() });
      const open = () => r.status === "received" || r.status === "in_review";
      if (name === "cdf_request_open") { if (r.status === "received") { Object.assign(r, { status: "in_review", reviewed_by: me }); ev("opened"); } return { data: copy(r), error: null }; }
      if (name === "cdf_request_reject") {
        if (r.status === "rejected") return { data: copy(r), error: null };
        if (!open()) return { data: null, error: { code: "P0001", message: "cdf_request_closed" } };
        Object.assign(r, { status: "rejected", reject_reason: (args.p_reason || "").trim() || null, reviewed_by: me }); ev("rejected", { reason: r.reject_reason }); return { data: copy(r), error: null };
      }
      if (name === "cdf_request_reopen") {
        if (r.status !== "rejected") return { data: null, error: { code: "P0001", message: "cdf_request_closed" } };
        Object.assign(r, { status: "in_review", reject_reason: null, reviewed_by: me }); ev("reopened"); return { data: copy(r), error: null };
      }
      if (name === "cdf_request_similar") {
        const phones = [r.buyer_phone, r.receiver_phone];
        return { data: { requests: reqs.filter((x) => x.id !== r.id && x.date === r.date && x.status !== "rejected" && (phones.includes(x.buyer_phone) || phones.includes(x.receiver_phone))).map((x) => ({ id: x.id, ref: x.ref, status: x.status })),
          orders: window.__orders.filter((o) => o.id !== r.accepted_order_id && o.date === r.date && !o.cancelled_at && (phones.includes(o.buyer_phone) || phones.includes(o.customer_phone))).map((o) => ({ id: o.id, num: o.num })) }, error: null };
      }
      if (name === "cdf_request_accept") {
        if (window.__acceptTakenBy) { Object.assign(r, { status: "accepted", accepted_key: "someone-else", accepted_order_id: null }); window.__acceptTakenBy = null; }
        if (r.status === "accepted" && r.accepted_key !== args.p_request) return { data: null, error: { code: "P0001", message: "cdf_request_taken" } };
        if (r.status !== "accepted" && !open()) return { data: null, error: { code: "P0001", message: "cdf_request_closed" } };
        const lost = window.__acceptLost; window.__acceptLost = false;
        window.__createResponseLost = false;
        return sb.rpc("cdf_create_order", { p_request: args.p_request, p_order: args.p_order, p_price: args.p_price, p_payment: args.p_payment }).then((made) => {
          if (made.error) return made;
          if (r.status !== "accepted") { Object.assign(r, { status: "accepted", accepted_key: args.p_request, accepted_order_id: made.data.order.id, reviewed_by: me }); ev("accepted", { order_id: made.data.order.id, num: made.data.order.num }); }
          if (lost) return { data: null, error: { message: "TypeError: Failed to fetch" } };
          return { data: { ...made.data, request: copy(r) }, error: null };
        });
      }
    }
    if (name === "cdf_record_payment") {
      if (window.__role && window.__role !== "admin") return { error: { code: "42501" } };
      const price = window.__prices.find(p => p.order_id === args.p_order) ||
        { order_id: args.p_order, amount: null, paid: null, payment_history: [] };
      price.payment_history ||= [];
      if (price.payment_history.some(p => p.id === args.p_request)) return { data: price };
      const original = price.payment_history.find(p => p.id === args.p_reverses);
      if (args.p_reverses && (!original || !args.p_reason || price.payment_history.some(p => p.reverses === original.id)))
        return { error: { message: "cdf_invalid_correction" } };
      if (!args.p_reverses && price.amount !== args.p_seen_price) return { error: { message: "cdf_price_changed" } };
      const delta = original ? -original.amount : args.p_amount;
      const paid = Math.round(((price.paid || 0) + delta) * 100) / 100;
      if (!original && paid > args.p_price) return { error: { message: "cdf_payment_above_due" } };
      if (!original) price.amount = args.p_price;
      price.paid = paid;
      price.payment_history.push({ id: args.p_request, kind: original ? "reversal" : "payment", amount: delta,
        created_at: new Date().toISOString(), by_email: "admin@example.com", proofs: args.p_proofs,
        reverses: args.p_reverses, reason: args.p_reason });
      if (!window.__prices.includes(price)) window.__prices.push(price);
      if (window.__paymentResponseLost) { window.__paymentResponseLost = false; return { error: { message: "network" } }; }
      return { data: price };
    }
    if(name === "cdf_search_orders") {
      const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();const q=norm(args.p_query),digits=q.replace(/\D/g,"").slice(-9);
      return {data:window.__orders.filter(o=>[o.num,o.customer_name,o.buyer_name,o.address,o.customer_email].some(v=>norm(v).includes(q)) || (digits.length>=3 && [o.customer_phone,o.buyer_phone].some(v=>String(v||"").replace(/\D/g,"").includes(digits)))),error:null};
    }
    if(name === "cdf_buyer_history") {
      const digits=p=>String(p||"").replace(/\D/g,"").slice(-9);const os=window.__orders.filter(o=>o.id!==args.p_exclude&&digits(o.buyer_phone||o.customer_phone)===digits(args.p_phone));
      return {data:[{n:os.length,total:window.__role==="admin"?os.reduce((n,o)=>n+(window.__prices.find(p=>p.order_id===o.id)?.amount||0),0):0}],error:null};
    }
    if(name === "cdf_member_stats") {
      const rows=[{email:"ana@example.com",done_week:3,done_month:12,done_total:48,open_now:4,arranged_total:48,delivered_total:0},{email:"driver@example.com",done_week:5,done_month:20,done_total:114,open_now:2,arranged_total:0,delivered_total:114},{email:"admin@example.com",done_week:0,done_month:1,done_total:5,open_now:0,arranged_total:0,delivered_total:0}];
      return {data:window.__role==="admin"||!window.__role?rows:rows.filter((r)=>r.email===(email[window.__role]||"")),error:null};
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
    if (name === "cdf_cancel_order") Object.assign(o, { cancelled_at: new Date().toISOString(), cancelled_by: me, cancel_reason: args.p_reason });
    if (name === "cdf_reinstate_order") Object.assign(o, { cancelled_at: null, cancelled_by: null, cancel_reason: null });
    if (name === "cdf_reschedule") Object.assign(o, { date: args.p_date, slot: args.p_slot, delivery_note: args.p_note, status: "Ready", delivery: "-", attempts: o.attempts + 1 });
    o.updated_at = new Date().toISOString();
    return { data: JSON.parse(JSON.stringify(o)), error: null };
    })();
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
    // These checks cover every feature, including the ones switched off in config.js (see tests/features-off.cjs)
    if (name === "/config.js") return res.end(String(b) + "\nwindow.CDF_CONFIG.features = {};\n");
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
      if (u.includes("/functions/v1/cdf-track")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: track === null ? null : track ? track : { num: "0124", date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()), slot: "8:00 - 12:00", status: "Ready", delivery: "Failed", delivery_note: "We came at 3 PM.", updated_at: "2026-10-27T02:15:00Z", for_name: "Maria", card_message: "Happy birthday, Maria!", bouquet_url: "/img/emblem.webp", proof_url: "/img/emblem.webp" } }) });
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
    await p.screenshot({ path: path.join(out, name + ".png"), animations: "disabled", fullPage: (await p.locator(".scrim, dialog[open]").count()) === 0 });
    assert(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "Horizontal overflow on " + name);
  }
  // A failed step reports the action and what blocked it, then closes any open layer so the next step starts clean
  const step = async (name, fn) => {
    if (process.env.ONLY && !name.includes(process.env.ONLY)) return; // ONLY="part of a step name" runs just that step
    try { await fn(); results.push("ok   " + name); } catch (e) {
      const lines = e.message.split("\n").map((l) => l.trim()).filter((l) => l && !/^-? ?(waiting|attempting|retrying|\d+ ×|wait for|scrolling|done scrolling)/.test(l));
      results.push("FAIL " + name + " · " + lines.slice(0, 4).join(" ⏎ "));
      for (const pg of browser.contexts().flatMap((c) => c.pages())) await pg.evaluate(() => { document.querySelectorAll("#sheetRoot, #dialogRoot").forEach((r) => r.replaceChildren()); if (typeof sheet !== "undefined") sheet = null; document.body.classList.remove("locked"); }).catch(() => {});
    }
  };

  try {
    let p = await open("admin");
    await step("Incremental payments and compact order photos", async () => {
      const q = await open("admin", { before: { __paymentDemo: true } });
      await q.locator(".order", { hasText: "#0124" }).locator(".o-name").click();
      const panel = q.locator(".sheet");
      const pay = panel.locator(".pay");
      const input = q.getByRole("spinbutton", { name: "Add payment" });
      const apply = q.getByRole("button", { name: "Apply payment" });
      await input.waitFor();
      assert.match(await pay.locator(".pay-left").innerText(), /500/);
      const details = panel.locator(".order-more");
      assert(await details.evaluate((node) => node.open));
      const extras = details.getByRole("group", { name: "Photos", exact: true });
      await extras.locator(".photo-tile img").waitFor();
      for (const event of ["drop", "paste"]) {
        await extras.evaluate(async (grid, event) => {
          const file = new File([await (await fetch("/img/emblem.png")).blob()], "sample.png", { type: "image/png" });
          const transfer = new DataTransfer();
          transfer.items.add(file);
          grid.dispatchEvent(event === "drop"
            ? new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer })
            : new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
        }, event);
        await extras.locator(".photo-tile").nth(1).waitFor();
        await extras.locator(".photo-tile").nth(1).getByRole("button", { name: /Remove/ }).click();
        await extras.locator(".photo-tile").nth(1).waitFor({ state: "detached" });
      }
      const reference = panel.getByRole("button", { name: "Enlarge reference photo" }).locator("img");
      assert(await reference.isVisible());
      assert((await reference.boundingBox()).height <= 56);
      const deliveryProof = panel.getByRole("button", { name: "Enlarge Proof photo" }).locator("img");
      assert((await deliveryProof.boundingBox()).height <= 56);
      assert(await details.locator("#f-email").isVisible());
      await input.fill("501");
      await input.press("Enter");
      assert.match(await pay.locator("p[role=status]").innerText(), /exceeds/);
      await input.fill("200.25");
      const image = require("fs").readFileSync(path.join(root, "img/emblem.png"));
      await pay.locator(".payment-proof-list + .compact-photos input[type=file]").setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: image });
      await pay.locator(".payment-proof-list + .compact-photos .photo-tile img").waitFor();
      await q.evaluate(() => { window.__paymentResponseLost = true; });
      await apply.click();
      await q.getByRole("button", { name: "Retry payment" }).click();
      await apply.waitFor();
      assert.equal(await pay.locator("p[role=status]").innerText(), "Payment applied.");
      assert.match(await pay.locator(".pay-left").innerText(), /299\.75/);
      assert.equal(await input.inputValue(), "");
      assert.equal(await pay.locator(".payment-movement").count(), 2);
      await pay.locator(".payment-thumbnails img").nth(1).waitFor();
      await input.fill("299.75");
      await input.press("Enter");
      await pay.locator(".payment-movement").nth(2).waitFor();
      assert.match(await pay.locator(".pay-left").innerText(), /₱0$/);
      await pay.getByText("Correct payment", { exact: true }).first().click();
      await pay.getByRole("textbox", { name: "Reason for correction" }).fill("Duplicate transfer");
      await pay.getByRole("button", { name: "Reverse payment" }).click();
      await pay.getByText("Correction recorded.").waitFor();
      assert.match(await pay.locator(".pay-left").innerText(), /299\.75/);
      assert(await pay.getByText("Duplicate transfer").isVisible());
      await panel.locator(".compact-photos").first().scrollIntoViewIfNeeded();
      await capture(q, "order-photos-desktop");
      await pay.scrollIntoViewIfNeeded();
      await capture(q, "order-payments-desktop");
      await q.setViewportSize({ width: 375, height: 780 });
      await panel.locator(".compact-photos").first().scrollIntoViewIfNeeded();
      await capture(q, "order-photos-mobile");
      await pay.locator("h3").scrollIntoViewIfNeeded();
      await capture(q, "order-payments-mobile");
      assert(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
      await panel.locator(".sheet-head").getByRole("button", { name: "Close" }).click();
      await q.locator(".order", { hasText: "#0127" }).locator(".o-name").click();
      assert(!(await q.locator(".order-more").evaluate((node) => node.open)));
      assert(await q.getByRole("spinbutton", { name: "Total price" }).isVisible());
      assert(await q.locator("#f-notes").isVisible());
      await q.close();
    });
    await step("Neutral palette, one stylesheet, timeline (no board), channel logos", async () => {
      await p.waitForTimeout(500); assert.equal(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(23, 23, 23)");
      assert.equal(await p.locator("link[rel=stylesheet][href^='/']").count(), 1);
      assert(await p.locator(".entry").count() >= 4);
      assert.equal(await p.locator(".board").count(), 0);
      assert(await p.locator(".chan img").count() >= 2);
      await capture(p, "desktop");
    });
    await step("Employee profile: Team, account, privacy, mobile and motion", async () => {
      await p.locator("#tabTeam").click();
      const ana = p.locator(".member", { hasText: "ana@example.com" });
      await ana.locator(".profile-name").click();
      const dialog = p.getByRole("dialog", { name: "Ana", exact: true });
      await dialog.locator(".employee-plant svg").waitFor();
      assert.equal(await dialog.locator("progress").getAttribute("value"), "48");
      assert.equal(await dialog.locator(".employee-metrics dd").allInnerTexts().then((n) => n.join(",")), "3,12,48,4");
      await capture(p, "employee-profile-desktop");
      await p.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await ana.locator(".profile-avatar").click();
      await dialog.getByRole("button", { name: "Close" }).click();
      await p.locator("#tabOrders").click();

      const q = await open("vendor", { width: 390 });
      await q.locator("#navOpen").click();
      await q.locator("#userAvatar").click();
      const own = q.getByRole("dialog", { name: "Ana", exact: true });
      await own.locator("progress").waitFor();
      assert(await q.locator("#tabTeam").isHidden());
      assert.equal(await own.evaluate((node) => getComputedStyle(node).animationName), "employee-in");
      assert(await own.evaluate((node) => Math.abs(node.getBoundingClientRect().left + node.getBoundingClientRect().right - innerWidth) < 2));
      await capture(q, "employee-profile-mobile");
      await q.keyboard.press("Escape");
      await q.locator("#accountBtn").click();
      await q.locator('#account [data-goto="prefs"]').click();
      await q.locator("#account [data-motion-set=reduced]").click();
      await q.keyboard.press("Escape");
      await q.locator("#accountBtn").click();
      await q.locator("#menuName").click();
      await own.waitFor();
      assert.equal(await own.evaluate((node) => getComputedStyle(node).animationName), "none");
      assert.equal(await own.getByText("driver@example.com").count(), 0);
      await q.context().close();
    });
    await step("Animations full by default even with OS reduce; Settings turns them down and remembers", async () => {
      assert.equal(await p.evaluate(() => document.documentElement.dataset.motion), "full");
      await p.locator("#accountBtn").click(); await p.locator('#account [data-goto="prefs"]').click(); await p.locator("#account [data-motion-set=reduced]").click();
      assert.equal(await p.evaluate(() => [document.documentElement.dataset.motion, localStorage.getItem("cdf-motion")].join()), "reduced,reduced");
      await p.locator("#account [data-motion-set=full]").click(); await p.keyboard.press("Escape");
    });
    await step("Sounds on by default; a push plays its own sound for messages and orders; Settings turns them off and remembers", async () => {
      await p.evaluate(() => { window.__sounds = []; });
      await p.locator("#accountBtn").click(); await p.locator('#account [data-goto="prefs"]').click();
      assert.equal(await p.locator("#account [data-sound-set=on]").getAttribute("aria-pressed"), "true");
      // What the service worker sends the open app when a push arrives
      await p.evaluate(() => { for (const kind of ["message", "order"]) navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "sound", kind } })); });
      assert.deepEqual(await p.evaluate(() => window.__sounds), ["message", "order"]);
      await p.locator("#account [data-sound-set=off]").click();
      assert.equal(await p.evaluate(() => localStorage.getItem("cdf-sound")), "off");
      await p.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "sound", kind: "order" } })));
      assert.equal((await p.evaluate(() => window.__sounds)).length, 2, "no sound while off");
      await p.locator("#account [data-sound-set=on]").click(); // turning them on plays a sample
      assert.deepEqual((await p.evaluate(() => window.__sounds)).slice(-1), ["order"]);
      assert.equal(await p.evaluate(() => localStorage.getItem("cdf-sound")), null);
      await p.keyboard.press("Escape");
    });
    await step("Profile menu: four entries, Preferences and My account views, Back, Escape returns focus", async () => {
      await p.locator("#accountBtn").click();
      const main = p.locator('#account .mview[data-view="main"]');
      assert.deepEqual(await main.locator(".mitem").allInnerTexts(), ["Preferences", "My account", "What's new", "Send a suggestion", "Install the app", "Sign out"]);
      assert.equal(await main.locator(".mhead small").innerText(), "Admin");
      assert.equal(await p.locator("#account .mrow:visible").count(), 0);
      await p.locator('#account [data-goto="prefs"]').click();
      assert.equal(await p.locator("#account .mrow:visible").count(), 6); // language, mode, text size, animations, sounds, notifications
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
    await step("Notifications off on this device: the orders page asks once, Not now quiets it (remembered)", async () => {
      const b = p.locator("#notifBanner");
      await b.waitFor({ state: "visible" });
      assert(/Turn on notifications/.test(await b.innerText()));
      assert(await b.locator("button", { hasText: "Turn on" }).isVisible());
      await capture(p, "notif-ask");
      await b.locator("button", { hasText: "Not now" }).click();
      assert(await b.isHidden());
      await p.reload(); await p.locator("#list").waitFor({ state: "visible" }); await p.waitForTimeout(600);
      assert(await p.locator("#notifBanner").isHidden(), "stays quiet after a reload");
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
    await step("A02 · A draft left by another account (or an old unowned one) is never offered", async () => {
      for (const stale of [
        { owner: "someone-else", at: Date.now(), data: { buyer_name: "Other Admin Buyer", address: "Secret St" } },
        { buyer_name: "Legacy Buyer", address: "Old St" },
        { owner: "test", at: Date.now() - 3 * 864e5, data: { buyer_name: "Expired Buyer" } },
      ]) {
        await p.evaluate((v) => localStorage.setItem("cdf-draft", JSON.stringify(v)), stale);
        await p.locator("#newBtn").click();
        await p.locator("#f-bname").waitFor();
        assert.equal(await p.locator(".dialog", { hasText: "unsaved new order" }).count(), 0);
        assert.equal(await p.locator("#f-bname").inputValue(), "");
        assert.equal(await p.evaluate(() => localStorage.getItem("cdf-draft")), null);
        await p.keyboard.press("Escape"); await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      }
    });
    await step("Create order: no florist by default, phone normalised, draft cleared", async () => {
      await p.evaluate(() => localStorage.removeItem("cdf-draft"));
      await p.locator("#newBtn").click();
      assert.equal(await p.locator(".new-order-sheet").count(), 1);
      assert(!(await p.locator(".order-more").evaluate((details) => details.open)));
      assert.equal(await p.locator(".new-order-sheet .payment-summary").count(), 0);
      await capture(p, "new-order-compact-desktop");
      await p.setViewportSize({ width: 375, height: 812 });
      await capture(p, "new-order-compact-mobile");
      await p.setViewportSize({ width: 1440, height: 1000 });
      assert.equal(await p.locator("#f-vendor").inputValue(), "");
      await p.locator("#f-num").fill("1001");
      await p.locator(".slot-pick select").nth(0).selectOption("540");
      await p.locator("#f-bname").fill("Buyer test"); await p.locator("#f-bphone").fill("0917 555 0101");
      await p.locator("#f-same").check();
      await p.locator("#f-addr").fill("Rockwell, Makati");
      await p.locator(".chan-opt[data-c=Instagram]").click(); // the channel is required (tests/map-channel.cjs)
      await p.locator(".sheet button[type=submit]").click();
      // No florist yet: it asks once ("Save anyway") so a rider can't be booked by surprise
      await p.locator(".dialog").getByRole("button", { name: "Save anyway" }).click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      // The order goes to the server as one operation (order + price + first payment), never as a bare insert
      assert(!(await calls(p)).some((c) => c.action === "insert" && c.table === "cdf_orders"));
      const ins = (await calls(p)).find((c) => c.rpc === "cdf_create_order" && c.args.p_order);
      assert.equal(ins.args.p_order.vendor_email, null); assert.equal(ins.args.p_order.buyer_phone, "+639175550101"); assert.equal(ins.args.p_order.customer_name, "Buyer test");
      assert.equal(ins.args.p_price, null); assert.equal(ins.args.p_payment, null);
    });
    const fillNew = async (q, num, { total, down } = {}) => {
      await q.evaluate(() => localStorage.removeItem("cdf-draft"));
      await q.locator("#newBtn").click();
      await q.locator("#f-num").fill(num);
      await q.locator(".slot-pick select").nth(0).selectOption("540");
      await q.locator("#f-vendor").selectOption("ana@example.com");
      await q.locator("#f-bname").fill("Down Payer"); await q.locator("#f-bphone").fill("0917 555 0202");
      await q.locator("#f-same").check();
      await q.locator("#f-addr").fill("Katipunan Ave, Quezon City");
      await q.locator(".chan-opt[data-c=Instagram]").click();
      if (total != null) await q.locator("#f-amount").fill(String(total));
      if (down != null) await q.locator("#f-down").fill(String(down));
    };
    const submit = (q) => q.locator(".sheet button[type=submit]").click();
    const creates = async (q) => (await calls(q)).filter((c) => c.rpc === "cdf_create_order" && c.args.p_order);
    await step("Phase 1 · Down payment while creating: balance, required method, one request, ₱2,500 − ₱2,000 = ₱500", async () => {
      await p.evaluate(() => (window.__calls = []));
      await fillNew(p, "2001");
      const more = p.locator(".pay-initial-more"), left = p.locator(".new-order-sheet #f-payleft");
      assert(await more.evaluate((x) => x.classList.contains("is-collapsed") && x.inert), "method, date and proof wait for an amount");
      assert.equal(await left.innerText(), "Add the price to see what's left");
      await p.locator("#f-amount").fill("2500");
      assert.match(await left.innerText(), /Remaining balance: ₱2,500$/);
      await p.locator("#f-down").fill("3000");
      assert.equal(await left.innerText(), "The payment exceeds the remaining balance.");
      await submit(p);
      assert.equal(await p.locator(".sheet .err").innerText(), "The payment exceeds the remaining balance.");
      await p.locator("#f-down").fill("2000");
      assert.match(await left.innerText(), /Remaining balance: ₱500$/);
      assert(!(await more.evaluate((x) => x.classList.contains("is-collapsed") || x.inert)));
      assert.equal(await p.locator("#f-paidat").inputValue(), await p.evaluate(() => manilaToday()));
      await submit(p);
      assert.equal(await p.locator(".sheet .err").innerText(), "Choose the payment method.");
      assert.equal((await creates(p)).length, 0, "nothing is sent while the form is incomplete");
      await p.getByRole("combobox", { name: "Payment method" }).selectOption({ label: "GCash" });
      await p.getByRole("textbox", { name: "Payment reference (optional)" }).fill("GC-778812");
      await p.locator(".pay-initial input[type=file]").setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: fs.readFileSync(path.join(root, "img/emblem.png")) });
      await p.locator(".pay-initial .photo-tile img").waitFor();
      await capture(p, "new-order-downpayment-desktop");
      await p.setViewportSize({ width: 375, height: 812 });
      await p.locator(".pay-initial").scrollIntoViewIfNeeded();
      await capture(p, "new-order-downpayment-mobile");
      assert(await p.locator("#f-down").evaluate((x) => x.getBoundingClientRect().height >= 40), "touch-sized amount field");
      await p.setViewportSize({ width: 1440, height: 1000 });
      await submit(p);
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      const sent = await creates(p);
      assert.equal(sent.length, 1);
      const { p_order, p_price, p_payment } = sent[0].args;
      assert.equal(p_price, 2500);
      assert.deepEqual({ ...p_payment, proofs: p_payment.proofs.length }, { amount: 2000, method: "gcash", reference: "GC-778812", paid_at: await p.evaluate(() => manilaToday()), proofs: 1 });
      assert(p_payment.proofs[0].startsWith(p_order.id + "/"), "the proof is filed under the new order");
      assert(!("amount" in p_order) && !("status" in p_order));
      const all = await calls(p);
      assert(!all.some((c) => c.action === "insert" && c.table === "cdf_orders") && !all.some((c) => c.action === "upsert" && c.table === "cdf_order_prices") && !all.some((c) => c.rpc === "cdf_record_payment"),
        "no separate insert, price write or payment call");
      const saved = await p.evaluate(() => { const o = window.__orders.filter((x) => x.num === "2001"); return { n: o.length, price: window.__prices.find((x) => x.order_id === o[0].id) }; });
      assert.equal(saved.n, 1); assert.equal(saved.price.amount - saved.price.paid, 500); assert.equal(saved.price.payment_history.length, 1);
      // Opened again: the movement shows how and when it was paid, and more payments use the usual flow
      await p.locator(".order", { hasText: "#2001" }).locator(".o-name").click();
      await p.locator(".payment-movement").waitFor();
      assert.match(await p.locator(".payment-movement .pay-meta").innerText(), /^GCash · Ref\. GC-778812 · paid on /);
      assert.match(await p.locator(".pay #f-payleft").innerText(), /₱500$/);
      assert(await p.locator("#f-payment").isVisible() && (await p.locator("#f-down").count()) === 0);
      await p.keyboard.press("Escape");
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
    });
    await step("Phase 1 · No down payment writes no zero movement; a stray reference or proof is questioned", async () => {
      await p.evaluate(() => (window.__calls = []));
      await fillNew(p, "2002", { total: 1800, down: 0 });
      await submit(p);
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      const [{ args }] = await creates(p);
      assert.equal(args.p_price, 1800); assert.equal(args.p_payment, null);
      assert.deepEqual(await p.evaluate(() => window.__prices.find((x) => x.order_id === window.__orders.find((o) => o.num === "2002").id).payment_history), []);
      await fillNew(p, "2003", { total: 1800 });
      await p.locator("#f-down").fill("5"); await p.locator("#f-payref").fill("REF"); await p.locator("#f-down").fill("");
      await submit(p);
      assert.match(await p.locator(".sheet .err").innerText(), /reference or proof without an amount/);
      await p.locator("#f-down").fill("10.005");
      await submit(p);
      assert.match(await p.locator(".sheet .err").innerText(), /Check the initial payment/);
      assert.equal((await creates(p)).length, 1, "only the first order was sent");
      await p.keyboard.press("Escape"); await p.locator(".dialog").getByRole("button", { name: "Discard" }).click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
    });
    await step("Phase 1 · A lost answer: saving again repeats the same request, one order, one payment, one upload", async () => {
      await p.evaluate(() => { window.__calls = []; window.__createResponseLost = true; });
      await fillNew(p, "2004", { total: 2500, down: 2000 });
      await p.locator("#f-method").selectOption("bank");
      await p.locator(".pay-initial input[type=file]").setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: fs.readFileSync(path.join(root, "img/emblem.png")) });
      await p.locator(".pay-initial .photo-tile img").waitFor();
      await submit(p);
      await p.locator(".sheet .err", { hasText: "Press Save again" }).waitFor();
      assert.equal(await p.evaluate(() => window.__orders.filter((x) => x.num === "2004").length), 1, "it did reach the server");
      await submit(p);
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      const sent = await creates(p);
      assert.equal(sent.length, 2); assert.deepEqual(sent[1].args, sent[0].args);
      assert.equal((await calls(p)).filter((c) => c.upload === "cdf-pagos").length, 1);
      const saved = await p.evaluate(() => { const o = window.__orders.filter((x) => x.num === "2004"); return { n: o.length, price: window.__prices.filter((x) => x.order_id === o[0].id) }; });
      assert.equal(saved.n, 1); assert.equal(saved.price.length, 1); assert.equal(saved.price[0].paid, 2000); assert.equal(saved.price[0].payment_history.length, 1);
      assert.equal(await p.locator(".order", { hasText: "#2004" }).count(), 1);
    });
    await step("Phase 1 · Lost answer, then edited, with a proof: the saved payment keeps its proof (nothing is deleted)", async () => {
      await p.evaluate(() => { window.__calls = []; window.__createResponseLost = true; });
      await fillNew(p, "2091", { total: 1500, down: 500 });
      await p.locator("#f-method").selectOption("gcash");
      await p.locator(".pay-initial input[type=file]").setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: fs.readFileSync(path.join(root, "img/emblem.png")) });
      await p.locator(".pay-initial .photo-tile img").waitFor();
      await submit(p);
      await p.locator(".sheet .err", { hasText: "Press Save again" }).waitFor();
      await p.locator("#f-bname").fill("Changed after the lost answer");
      await submit(p);
      await p.locator(".sheet .err", { hasText: "already saved a moment ago" }).waitFor();
      const kept = await p.evaluate(() => { const o = window.__orders.find((x) => x.num === "2091"); return window.__prices.find((x) => x.order_id === o.id).payment_history[0].proofs; });
      assert.equal(kept.length, 1, "the saved payment has its proof");
      const removed = (await calls(p)).filter((c) => c.remove === "cdf-pagos").flatMap((c) => c.paths);
      assert(!removed.includes(kept[0]), "the proof of the saved payment was not deleted");
      await p.keyboard.press("Escape"); await p.locator(".dialog").getByRole("button", { name: "Discard" }).click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
    });
    await step("Phase 1 · Lost answer, then edited: the server says it was already saved instead of creating a second order", async () => {
      await p.evaluate(() => { window.__calls = []; window.__createResponseLost = true; });
      await fillNew(p, "2005", { total: 900, down: 900 });
      await p.locator("#f-method").selectOption("cash");
      await submit(p);
      await p.locator(".sheet .err", { hasText: "Press Save again" }).waitFor();
      await p.locator("#f-bname").fill("Someone Else");
      await submit(p);
      await p.locator(".sheet .err", { hasText: "already saved a moment ago" }).waitFor();
      assert.equal(await p.evaluate(() => window.__orders.filter((x) => x.num === "2005").length), 1);
      assert.equal(await p.evaluate(() => localStorage.getItem("cdf-draft")), null, "no draft is left to save it a second time");
      await p.keyboard.press("Escape"); await p.locator(".dialog").getByRole("button", { name: "Discard" }).click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      await p.locator(".order", { hasText: "#2005" }).waitFor();
    });
    await step("Phase 1 · A draft restored after a lost answer still carries its request: saving it returns the order already made", async () => {
      await p.evaluate(() => { window.__calls = []; window.__createResponseLost = true; });
      await fillNew(p, "2007", { total: 1200 });
      await submit(p);
      await p.locator(".sheet .err", { hasText: "Press Save again" }).waitFor();
      await p.keyboard.press("Escape"); await p.locator(".dialog").getByRole("button", { name: "Discard" }).click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      await p.locator("#newBtn").click();
      await p.locator(".dialog").getByRole("button", { name: "Bring it back" }).click();
      await p.locator("#f-num").fill("2007"); await p.locator("#f-amount").fill("1200");
      await submit(p);
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      const sent = await creates(p);
      assert.equal(sent.length, 2); assert.equal(sent[1].args.p_request, sent[0].args.p_request); assert.equal(sent[1].args.p_order.id, sent[0].args.p_order.id);
      assert.equal(await p.evaluate(() => window.__orders.filter((x) => x.num === "2007").length), 1);
    });
    await step("Phase 1 · A refusal from the server saves nothing and removes the uploaded proof; offline keeps the form", async () => {
      await p.evaluate(() => (window.__calls = []));
      await fillNew(p, "0124", { total: 500, down: 100 });
      await p.locator("#f-method").selectOption("maya");
      await p.locator(".pay-initial input[type=file]").setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: fs.readFileSync(path.join(root, "img/emblem.png")) });
      await p.locator(".pay-initial .photo-tile img").waitFor();
      const before = await p.evaluate(() => [window.__orders.length, window.__prices.length]);
      await submit(p);
      await p.locator(".sheet .err", { hasText: "#0124" }).waitFor();
      assert.deepEqual(await p.evaluate(() => [window.__orders.length, window.__prices.length]), before);
      const up = (await calls(p)).find((c) => c.upload === "cdf-pagos"), gone = (await calls(p)).find((c) => c.remove === "cdf-pagos");
      assert.deepEqual(gone.paths, [up.path]);
      await p.evaluate(() => { window.__createOffline = true; });
      await p.locator("#f-num").fill("2006");
      await submit(p);
      await p.locator(".sheet .err", { hasText: "Press Save again" }).waitFor();
      assert.equal(await p.locator("#f-down").inputValue(), "100");
      await p.evaluate(() => { window.__createOffline = false; });
      await submit(p);
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      assert.equal(await p.evaluate(() => window.__prices.find((x) => x.order_id === window.__orders.find((o) => o.num === "2006").id).paid), 100);
      assert.equal((await calls(p)).filter((c) => c.upload === "cdf-pagos").length, 2, "the proof is uploaded again for the attempt that succeeds");
    });
    await step("Phase 1 · A database without the new function keeps the old flow (client can be published first)", async () => {
      const q = await open("admin", { before: { __noCreateRpc: true } });
      await fillNew(q, "3001", { total: 700 });
      assert.equal(await q.locator("#f-down").count(), 0);
      await submit(q);
      await q.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      const all = await calls(q);
      assert(all.some((c) => c.action === "insert" && c.table === "cdf_orders") && all.some((c) => c.action === "upsert" && c.table === "cdf_order_prices"));
      assert.equal((await creates(q)).length, 0);
      await q.context().close();
    });
    await step("Phase 1 · A florist is never offered prices or the down payment", async () => {
      const q = await open("vendor");
      assert.equal(await q.locator("#newBtn").isVisible().catch(() => false), false);
      assert(!(await calls(q)).some((c) => c.rpc === "cdf_create_order"), "not even the capability check is made for a florist");
      await q.context().close();
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
    await step("A03 · Another admin saving between the check and the write is caught, not overwritten", async () => {
      await p.locator(".order", { hasText: "#0127" }).locator(".o-name").click();
      await p.locator("#f-addr").fill("Mine again");
      // The other save lands after this client's conflict check, right before its write
      await p.evaluate(() => { window.__race = () => { const o = window.__orders.find((x) => x.num === "0127"); o.address = "Theirs, at the same moment"; o.updated_at = "2032-01-01T00:00:00Z"; }; });
      await p.locator(".sheet button[type=submit]").click();
      await p.locator(".dialog", { hasText: "Someone else changed" }).waitFor();
      assert.equal(await p.evaluate(() => window.__orders.find((x) => x.num === "0127").address), "Theirs, at the same moment");
      await p.locator(".dialog").getByRole("button", { name: "Save mine" }).click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      assert.equal(await p.evaluate(() => window.__orders.find((x) => x.num === "0127").address), "Mine again");
    });
    await step("A14 · Admin cancels with a reason; the card stops offering steps; reinstate puts it back", async () => {
      await p.evaluate(() => (window.__calls = []));
      await p.locator(".order", { hasText: "#0124" }).locator(".o-name").click();
      await p.locator(".sheet").getByRole("button", { name: "Cancel order" }).click();
      await p.locator(".sheet h2", { hasText: "Cancel order #0124" }).waitFor();
      await p.locator(".sheet button[type=submit]").click();
      await p.locator(".sheet .err", { hasText: "Write a reason" }).waitFor();
      await p.locator(".sheet .chip", { hasText: "Customer cancelled" }).click();
      await p.locator(".sheet button[type=submit]").click();
      await p.locator("#sheetRoot .scrim").waitFor({ state: "detached" });
      assert((await calls(p)).some((c) => c.rpc === "cdf_cancel_order" && c.args.p_reason === "Customer cancelled"));
      const card = p.locator(".order", { hasText: "#0124" });
      await card.locator(".badge.s-cancel").waitFor();
      assert(await card.locator(".o-cancel").innerText().then((s) => s.includes("Customer cancelled")));
      assert.equal(await card.locator(".badge-sel select").count(), 0, "no status picker on a cancelled order");
      assert.equal(await card.getByRole("button", { name: "Mark ready" }).count(), 0, "no next step");
      assert(await card.locator(".steps.off .step").first().isDisabled());
      assert(await p.locator("#filters .filter", { hasText: "Cancelled" }).isVisible());
      await capture(p, "cancelled-admin");
      await card.getByRole("button", { name: "Reinstate" }).click();
      await card.locator(".badge.s-cancel").waitFor({ state: "detached" });
      assert.equal(await card.locator(".badge-sel select").count(), 1, "the status picker is back");
      assert((await calls(p)).some((c) => c.rpc === "cdf_reinstate_order"));
    });
    await step("B5 · Replacing a photo deletes the old file only after the order points at the new one", async () => {
      await p.evaluate(() => (window.__calls = []));
      await p.locator(".order", { hasText: "#0124" }).locator(".o-name").click();
      const proofField = p.locator(".sheet .field").filter({ has: p.getByText("Proof photo", { exact: true }) });
      await proofField.locator("input[type=file]").setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: png });
      await proofField.locator("img[src^=blob]").waitFor();
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
    await step("CSV export downloads a file; formulas and line breaks are neutralised (A12)", async () => {
      await p.evaluate(() => Object.assign(window.__orders.find((x) => x.num === "0124"), { notes: "\t=1+1", card_message: "X\rY", address: " @SUM(A1)" }));
      await p.locator("#adminTools").getByRole("button", { name: "Export CSV" }).click();
      const [dl] = await Promise.all([p.waitForEvent("download"), p.locator(".sheet").getByRole("button", { name: "Download" }).click()]);
      assert(dl.suggestedFilename().endsWith(".csv"));
      const csv = fs.readFileSync(await dl.path(), "utf8");
      assert(csv.includes("'\t=1+1"), "tab-prefixed formula gets an apostrophe");
      assert(csv.includes('"X\rY"'), "a lone CR is quoted");
      assert(csv.includes("' @SUM(A1)"), "space-prefixed formula gets an apostrophe");
    });
    await step("Change history and notices in the order sheet", async () => {
      await p.locator(".order", { hasText: "#0126" }).locator(".o-name").click();
      // One "History" drop-down holds both: what changed, then the emails sent
      await p.locator(".hist summary", { hasText: /^History$/ }).click();
      assert(await p.locator(".hist-part h4", { hasText: "Change history" }).isVisible());
      assert(await p.locator(".hist-part", { hasText: "Notification history" }).innerText().then((s) => s.includes("Customer")));
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
        assert.equal(await q.locator('#account .mview[data-view="main"] .mitem:visible').count(), 6);
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
    await step("Florist: ready in one tap (no bouquet photo), then head out asks first (RPCs)", async () => {
      const q = await open("vendor", { width: 390 });
      await q.locator(".work").first().waitFor();
      await q.locator("#summary .done-stats").waitFor();
      assert.match(await q.locator("#summary .done-stats").innerText(), /3\s+7 days/);
      await capture(q, "florist-mobile");
      await q.getByRole("button", { name: "Mark ready" }).first().click();
      await q.waitForTimeout(500);
      assert.equal(await q.locator("#sheetRoot .scrim").count(), 0, "Ready opened a dialog");
      assert((await calls(q)).some((c) => c.rpc === "cdf_progress" && c.args.p_step === "ready"));
      await q.getByRole("button", { name: "Head out", exact: true }).first().click();
      await q.locator(".dialog").getByRole("button", { name: "Yes, on the way" }).click();
      await q.waitForTimeout(650);
      assert((await calls(q)).some((c) => c.rpc === "cdf_progress" && c.args.p_step === "transit"));
      await q.locator("#q").fill("Maria"); assert(await q.locator(".work").count() >= 1);
      await q.locator("#q").fill("zzzz"); assert.equal(await q.locator(".work").count(), 0);
      await q.close();
    });
    await step("Admin sees the driver assignment and departure live", async () => {
      const q = await open("admin");
      try {
        const card = q.locator(".order", { hasText: "#0127" });
        const driver = card.locator(".o-driver");
        await driver.filter({ hasText: "No driver assigned" }).waitFor();
        await q.evaluate(() => {
          const row = window.__orders.find(o => o.num === "0127");
          window.__realtime({ eventType: "UPDATE", new: { ...row, carrier_email: "driver@example.com" } });
        });
        await driver.filter({ hasText: "Assigned to" }).waitFor();
        await q.evaluate(() => {
          const row = window.__orders.find(o => o.num === "0127");
          window.__realtime({ eventType: "UPDATE", new: { ...row, carrier_email: "driver@example.com", delivery: "In transit" } });
        });
        await driver.filter({ hasText: "On the way" }).waitFor();
      } finally { await q.close(); }
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
    await step("A14 · Florist sees a cancelled order as cancelled, with no step to take; a driver doesn't get it in the free pool", async () => {
      const q = await open("vendor", { width: 390, before: { __cancelNums: ["0124"] } });
      const w = q.locator(".work", { hasText: "#0124" });
      await w.locator(".o-cancel", { hasText: "don't prepare" }).waitFor();
      assert.equal(await w.getByRole("button", { name: "Mark ready" }).count(), 0);
      await capture(q, "cancelled-florist"); await q.close();
      const r = await open("carrier", { width: 390, before: { __cancelNums: ["0127"] } });
      await r.locator(".work").first().waitFor();
      assert.equal(await r.locator(".work", { hasText: "#0127" }).count(), 0);
      await r.close();
    });
    await step("A14 · Tracking page of a cancelled order says so, without steps or photos", async () => {
      const q = await open("track", { width: 390, track: { num: "0124", date: "2026-11-08", slot: "8:00 - 12:00", updated_at: "2026-11-07T10:00:00Z", cancelled: true, for_name: "", proof_url: null, bouquet_url: null } });
      await q.locator(".track-cancel", { hasText: "cancelled" }).waitFor();
      assert.equal(await q.locator(".tl").count(), 0);
      await capture(q, "cancelled-tracking"); await q.close();
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
      const orderThread = q.locator(".thread", { hasText: "#0126" });
      const states = [
        ["Preparing", "-", "prep", "flower", "--transit-solid"],
        ["Ready", "-", "ready", "clock", "--prep-solid"],
        ["Ready", "In transit", "transit", "truck", "--ready-solid"],
        ["Ready", "Delivered", "done", "doubleCheck", "--done-solid"],
        ["Ready", "Failed", "fail", "close", "--fail-solid"],
        ["Ready", "In transit", "transit", "truck", "--ready-solid"],
      ];
      const unread = await orderThread.locator(".thread-count").innerText();
      for (const [status, delivery, key, glyph, color] of states) {
        await q.evaluate(([status, delivery]) => {
          const row = window.__orders.find((o) => o.num === "0126");
          window.__realtime({ eventType: "UPDATE", new: { ...row, status, delivery } });
        }, [status, delivery]);
        const marker = orderThread.locator(`.thread-ic[data-status="${key}"]`);
        await marker.waitFor();
        assert(await marker.evaluate((node, [glyph, color]) => {
          const sample = document.createElement("span");
          sample.style.backgroundColor = "var(" + color + ")";
          node.append(sample);
          const matches = getComputedStyle(node).backgroundColor === getComputedStyle(sample).backgroundColor
            && node.querySelector("svg").isEqualNode(icon(glyph).querySelector("svg"));
          sample.remove();
          return matches;
        }, [glyph, color]));
        assert.equal(await orderThread.locator(".thread-count").innerText(), unread);
      }
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
    await step("My Bloom Journey: thresholds, 249→250, stage lines, back subtracts, profiles, office view, no simulation in the app", async () => {
      // Isolated demo (tests/ only): the real js/bloom.js with fictitious numbers
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce" });
      const d = await ctx.newPage();await d.goto("http://127.0.0.1:" + port + "/tests/bloom-demo.html");
      await d.locator(".bloom .bloom-stage").waitFor();
      assert.equal(await d.evaluate(() => getComputedStyle(document.querySelector(".bloom")).getPropertyValue("--bloom-time").trim()), "300ms", "full motion by default even with OS reduce");
      const at = (n) => d.evaluate((n) => { const j = bloomJourney("florist", n), q = (s) => j.node.querySelector(s); return { stage: q(".bloom-stage").textContent, count: q(".bloom-count").textContent, bar: q("progress").value, fills: [...j.node.querySelectorAll(".stage-list li")].map((li) => +li.style.getPropertyValue("--stage-fill")), next: q(".bloom-next").textContent, desc: q(".bloom-desc").textContent }; }, n);
      for (const [n, stage] of [[0, "Seed"], [49, "Seed"], [50, "Sprout"], [99, "Sprout"], [100, "Growing"], [149, "Growing"], [150, "Budding"], [249, "Budding"], [250, "Full Bloom"], [300, "Full Bloom"]]) assert.equal((await at(n)).stage, stage, "stage at " + n);
      const s249 = await at(249), s250 = await at(250), s300 = await at(300);
      assert.deepEqual([s249.count, s249.bar, s249.fills.map((x) => +x.toFixed(2))], ["249 / 250", 249, [1, 1, 1, 0.99, 0]]);
      assert.deepEqual([s250.count, s250.bar, s250.fills], ["250 / 250", 250, [1, 1, 1, 1, 1]]);
      assert.equal(s300.bar, 250, "the bar stops at 250");assert.match(s300.desc, /^300 /, "the total keeps counting after 250");
      await d.locator("#jumps .btn", { hasText: /^249$/ }).click();await d.locator("#plus").click();
      await d.locator(".bloom .bloom-crown").waitFor();assert.match(await d.locator("#announce").innerText(), /Full Bloom/);
      await d.locator("#minus").click();await d.locator(".bloom .bloom-stage", { hasText: "Budding" }).waitFor();
      await d.locator("#motion").check();assert.equal(await d.evaluate(() => getComputedStyle(document.querySelector(".bloom")).getPropertyValue("--bloom-time").trim()), "0ms", "manual Reduce turns it off");
      await d.reload();assert.equal(await d.locator("#motion").isChecked(), true, "the manual choice is remembered");
      await ctx.close();
      // In the app: florist and driver profiles, the office list; no simulation controls
      const v = await open("vendor");await v.locator("#list").waitFor();await v.locator("#accountBtn").click();await v.locator("#myAccountBtn").click();
      await v.locator(".my-bloom small", { hasText: "Seed" }).waitFor();assert.match(await v.locator(".my-names b").innerText(), /Ana\s*🌰/);
      await v.locator(".my-bloom").click();await v.locator(".bloom-sheet .bloom-stage", { hasText: "Seed" }).waitFor();
      assert.equal(await v.locator(".bloom-sheet :is(#plus, #minus, #jumps, select)").count(), 0, "no simulation in the app");await v.close();
      const c = await open("carrier");await c.locator("#accountBtn").click();await c.locator("#myAccountBtn").click();
      await c.locator(".my-bloom small", { hasText: "Growing" }).waitFor();await c.close();
      const a = await open("admin");await a.locator("#list").waitFor();await a.locator("#tabTeam").click();
      await a.locator(".member .bloom-tag", { hasText: "Growing" }).waitFor();
      assert.deepEqual(await a.locator(".member .bloom-tag").allInnerTexts(), ["🌰 Seed", "🌿 Growing"]);await a.close();
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
    await step("Reference photo opens with one tap and Escape leaves the order open", async () => {
      const q = await open("admin", { width: 390 });
      for (const show of ["openEditor", "openOrderView"]) {
        await q.evaluate((show) => {
          const order = { ...S.orders[0], photo_path: "reference.jpg" };
          if (show === "openEditor") openEditor(order);
          else openOrderView(order);
        }, show);
        const preview = q.getByRole("button", { name: "Enlarge reference photo" });
        await preview.locator(".photo-preview-zoom").waitFor();
        await q.locator("#chatSection").getByRole("heading", { name: "Internal conversation" }).waitFor();
        assert.equal(await q.locator("#chatSection .chat-privacy").innerText(), "Only visible to team members who can access this order.");
        // The photo is lower in the editor now and loads lazily: bring it on screen first, as a person would scroll to it
        await preview.evaluate((b) => b.scrollIntoView({ block: "center" }));
        await preview.click();
        await q.getByRole("dialog", { name: "Reference photo" }).waitFor();
        await q.keyboard.press("Escape");
        await q.locator(".photo-viewer").waitFor({ state: "detached" });
        assert(await q.locator("#sheetRoot .sheet").isVisible());
        await q.keyboard.press("Escape");
        await q.locator("#sheetRoot .sheet").waitFor({ state: "detached" });
      }
      await q.close();
    });
    await step("Direct chat: a florist can open and reuse a private conversation with a driver", async () => {
      const q = await open("vendor");
      await q.locator("#tabChat").click();
      const picker = q.getByRole("combobox", { name: "New private message" });
      await picker.selectOption("driver@example.com");
      await q.locator(".chat-head-txt").getByText("Luis").waitFor();
      await q.locator(".chat-pane .chat-input").fill("Private test message");
      await q.locator(".chat-pane .chat-send").click();
      const bubble = q.locator(".chat-pane .msg-bubble").getByText("Private test message");
      await bubble.waitFor();
      assert.equal(await q.locator(".chat-pane .tool-e").count(), 0);
      await q.locator(".thread").filter({ hasText: "#team" }).click();
      assert.equal(await bubble.count(), 0);
      await picker.selectOption("driver@example.com");
      await bubble.waitFor();
      assert.equal(await q.locator(".thread b").getByText("Luis", { exact: true }).count(), 1);
      await q.close();
    });
    await step("Edit only your own messages in team, order and direct chats", async () => {
      const q = await open("admin");
      await q.locator("#tabChat").click();
      assert.equal(await q.locator(".cmsg:not(.mine) .tool-edit").count(), 0);
      const compose = q.locator(".chat-pane .chat-input");
      for (const title of ["#team", "#0126 · Maria Santos", "Luis"]) {
        if (title === "Luis") await q.getByRole("combobox", { name: "New private message" }).selectOption("driver@example.com");
        else await q.locator(".thread b").getByText(title, { exact: true }).click();
        await compose.fill("Original message");
        await q.locator(".chat-pane .chat-send").click();
        const message = q.locator(".chat-pane .cmsg.mine").last();
        await message.hover();
        await message.getByRole("button", { name: "Edit message" }).click();
        const editor = message.getByRole("textbox", { name: "Edit message" });
        assert.equal(await editor.inputValue(), "Original message");
        await editor.fill("Corrected message");
        await message.getByRole("button", { name: "Save", exact: true }).click();
        await message.getByText("Corrected message").waitFor();
        await message.getByText("Edited", { exact: true }).waitFor();
        await message.hover();
        await message.getByRole("button", { name: "Edit message" }).click();
        await editor.fill("Unsaved");
        await editor.press("Escape");
        await message.getByText("Corrected message").waitFor();
        assert.equal(await editor.count(), 0);
      }
      await q.close();
    });
    await step("Installable app: manifest and icons, service worker, install entry, notifications row, notification links", async () => {
      const q = await open("admin");await q.locator("#list").waitFor();
      const man = await q.evaluate(async () => { const href = document.querySelector("link[rel=manifest]").href; const m = await (await fetch(href)).json(); const ok = await Promise.all(m.icons.map(async (i) => (await fetch(i.src)).ok)); return { name: m.short_name, display: m.display, icons: m.icons.length, ok: ok.every(Boolean), maskable: m.icons.some((i) => i.purpose === "maskable") }; });
      assert.deepEqual(man, { name: "Casa de Flores", display: "standalone", icons: 3, ok: true, maskable: true });
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
      assert.match(await row.innerText(), /\+63\s*917 111 2222/);
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
