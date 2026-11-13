// Core: Supabase client, shared state, helpers and order loading. Loaded first; every other script uses these.
const { url, anonKey, bucket } = window.CDF_CONFIG;
// Read before the client consumes the URL: a "reset password" email link lands here with type=recovery.
let recovering = /[#&?]type=recovery\b/.test(location.hash + location.search);
// An email link used twice or too late comes back as #error_code=otp_expired: say so on the sign-in screen
let linkError = (/[#&?]error_code=([\w-]+)/.exec(location.hash + location.search) || [])[1] || null;
const sb = supabase.createClient(url, anonKey, {global:{fetch:async (...args)=>{
 beginRequest();try{return await fetch(...args)}finally{endRequest()}
}}});
// Private buckets: order screenshots (bucket) and bouquet / delivery photos (ENTREGAS)
const ENTREGAS = "cdf-entregas";
// The shop works on Philippine time, wherever the viewer happens to be
const TZ = "Asia/Manila";
const CHANNELS = ["Shopify", "Instagram", "TikTok", "Web"];

// One pipeline drives both stored fields: status (Preparing/Ready) and delivery (-/In transit/Delivered/Failed).
const STEPS = [
  { k: "prep", status: "Preparing", delivery: "-" },
  { k: "ready", status: "Ready", delivery: "-" },
  { k: "transit", status: "Ready", delivery: "In transit" },
  { k: "done", status: "Ready", delivery: "Delivered" },
  { k: "fail", status: "Ready", delivery: "Failed" }, // attempted, nobody home
  { k: "cancel" }, // cancelled by an admin (cancelled_at): not a step anyone moves to, and nothing moves from it
];
const CANCELLED = 5, STEP_IDS = [0, 1, 2, 3, 4]; // the steps a person can pick
// Where the order is on the line; a cancelled order keeps it, so reinstating puts it back exactly
const baseStep = (o) => (o.delivery === "Failed" ? 4 : o.delivery === "Delivered" ? 3 : o.delivery === "In transit" ? 2 : o.status === "Ready" ? 1 : 0);
const stepOf = (o) => (o.cancelled_at ? CANCELLED : baseStep(o));
// Still work to do: not delivered and not cancelled
const isOpen = (o) => { const s = stepOf(o); return s !== 3 && s !== CANCELLED; };
// The next step from each one: Preparing → Ready → In transit → Delivered; a failed attempt goes out again.
const NEXT = { 0: 1, 1: 2, 2: 3, 4: 2 };
// A pickup (the customer collects it at the shop) has its own names for the last steps and no On the way
const isPickup = (o) => !!o?.pickup;
// Completion closes delivery/collection AND payment; fulfilment is retained even if corrected later.
const isRetained = (o) => !!o?.fulfilled_at || o?.delivery === "Delivered";
const isCompleted = (o) => {
  if (!o || o.cancelled_at || o.delivery !== "Delivered") return false;
  if (o.amount != null && o.amount !== "" && o.paid != null)
    return Number.isFinite(+o.amount) && Number.isFinite(+o.paid) && Math.round(+o.paid * 100) >= Math.round(+o.amount * 100);
  return o.completed === true;
};
const PICKUP_NAME = { ready: "st_ready_pickup", done: "st_done_pickup", fail: "st_fail_pickup" };
const stepName = (i, o) => t(i === 3 && isCompleted(o) ? "st_completed" : (isPickup(o) && PICKUP_NAME[STEPS[i].k]) || "st_" + STEPS[i].k);
const NEXT_PICKUP = { 0: 1, 1: 3, 4: 3 };
const nextOf = (o, cur) => (isPickup(o) ? NEXT_PICKUP : NEXT)[cur];
const stepIdsOf = (o) => (isPickup(o) ? STEP_IDS.filter((i) => i !== 2) : STEP_IDS);
// The shop a pickup is collected from: the assigned florist's (Team → each florist's shop)
const pickupShop = (o) => { const m = o?.vendor_email && S.members.find((x) => x.email === o.vendor_email); return m ? { branch: m.branch || "", address: m.pickup_address || "" } : null; };

// ---------- small helpers ----------
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const fromIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const monthOf = (s) => { const d = fromIso(s); d.setDate(1); return d; };
const addDays = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const manilaMinutes = () => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).split(":"); return +p[0] * 60 + +p[1]; };
const el = (tag, a = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(a)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(c)); }
  return e;
};
// replaceChildren would print "null" for a left-out piece; this skips them like el() does
const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
// Any "H:MM - H:MM" is allowed; orders are grouped and sorted by start time.
const slotStart = (s) => { const m = /(\d{1,2}):(\d{2})/.exec(s || ""); return m ? +m[1] * 60 + +m[2] : 9999; };
const slotEnd = (s) => { const m = /-\s*(\d{1,2}):(\d{2})/.exec(s || ""); return m ? +m[1] * 60 + +m[2] : slotStart(s) + 60; };
const byTime = (a, b) => a.date.localeCompare(b.date) || slotStart(a.slot) - slotStart(b.slot) || String(a.num).localeCompare(String(b.num), undefined, { numeric: true });
const longDate = (s) => cap(fromIso(s).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" }));
const shortDate = (s) => cap(fromIso(s).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" }));
const dayCount = (n) => (n === 1 ? t("oneOrder") : t("nOrders", { n }));
const trackUrl = (o) => location.origin + "/p/" + o.code;
// Switches in config.js (features); anything not listed there stays on
const feature = (k) => window.CDF_CONFIG.features?.[k] !== false;
const mapsUrl = (a) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Customers are in the Philippines or Spain. Numbers become international digits (wa.me and tel: need them):
// 0917… / 917… → 63917…, Spanish 6xx/7xx/9xx → 34…, and "+…" or "00…" keep their own country code.
function intlPhone(raw) {
  const s = String(raw || "").trim();
  let d = s.replace(/\D/g, "");
  if (s.startsWith("+")) return d;
  if (d.startsWith("00")) return d.slice(2);
  if (/^09\d{9}$/.test(d)) return "63" + d.slice(1);
  if (/^9\d{9}$/.test(d)) return "63" + d;
  if (/^[6789]\d{8}$/.test(d)) return "34" + d;
  return d;
}
// Stored form: "+63917…" when the number is recognisable, otherwise exactly what was typed
const normPhone = (raw) => { const d = intlPhone(raw); return /^\d{10,15}$/.test(d) ? "+" + d : String(raw || "").trim(); };
const phoneOk = (raw) => !String(raw || "").trim() || /^\d{10,15}$/.test(intlPhone(raw));
// Phone fields: a country code picker (+63 by default) and the rest of the number. Typing + or 00 in the
// number still works for any country. The code chosen lives on the input as data-cc ("" = typed in full).
// [dial code, ISO country code]; the ISO code names the flag in /img/flags (flag-icons 7.2.3, 4x3)
const CCODES = [["63","ph"],["34","es"],["1","us"],["44","gb"],["61","au"],["64","nz"],["65","sg"],["60","my"],["62","id"],["66","th"],["84","vn"],["852","hk"],["86","cn"],["81","jp"],["82","kr"],["91","in"],["971","ae"],["966","sa"],["974","qa"],["965","kw"],["39","it"],["33","fr"],["49","de"],["351","pt"],["31","nl"],["41","ch"],["52","mx"]];
const phSplit = (p) => {
  const s = String(p || "").trim();
  if (!s.startsWith("+")) return { cc: "63", local: s };
  const d = s.slice(1).replace(/\D/g, ""), m = CCODES.map((c) => c[0]).filter((c) => d.startsWith(c)).sort((a, b) => b.length - a.length)[0];
  return m ? { cc: m, local: d.slice(m.length) } : { cc: "", local: s };
};
const phLocal = (p) => phSplit(p).local;
// A phone to read: the country's flag, its code, then the number in groups ("🇵🇭 +63 994 693 8665")
function phoneNice(raw) {
  const d = intlPhone(raw);
  if (!/^\d{7,15}$/.test(d)) return el("span", { class: "phone-nice" }, String(raw || ""));
  const cc = CCODES.map((c) => c[0]).filter((c) => d.startsWith(c)).sort((a, b) => b.length - a.length)[0];
  const iso = cc ? CCODES.find((c) => c[0] === cc)[1] : "";
  const rest = cc ? d.slice(cc.length) : d;
  // 3-3-4 for 10 digits (Philippine mobiles), otherwise threes with the remainder last
  const groups = rest.length === 10 ? [rest.slice(0, 3), rest.slice(3, 6), rest.slice(6)] : rest.match(/.{1,3}/g);
  return el("span", { class: "phone-nice" }, iso && typeof flagImg === "function" ? flagImg(iso) : null,
    cc ? el("span", { class: "phone-cc" }, "+" + cc) : null, el("span", { class: "phone-num" }, (cc ? "" : "+") + groups.join(" ")));
}
// Accepts the input itself (uses its country code) or a plain string (treated as +63)
const phFull = (v) => {
  const cc = v && v.nodeType ? (v.dataset.cc ?? "63") : "63", s = String((v && v.nodeType ? v.value : v) || "").trim();
  if (!s) return "";
  if (/^(\+|00)/.test(s) || cc === "") return normPhone(s);
  if (cc === "63") return normPhone("+63" + s.replace(/\D/g, "").replace(/^(63)?0?/, ""));
  return normPhone("+" + cc + s.replace(/\D/g, "").replace(/^0/, ""));
};
// Search without accents or case ("Sofia" finds "Sofía")
const norm = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Prices: off unless an admin turns them on in this browser (needs migration 014)
const pricesOn = () => S.cap.amount && isAdmin() && pref("cdf-prices") === "on";
// The bouquet price field in the editor: always there for the admin, whatever "Show prices" says
const priceEditable = () => S.cap.amount && isAdmin();
// Ways a payment can come in (the stored value; labels are pm_<value> in i18n.js)
const PAY_METHODS = ["gcash", "maya", "bank", "cash", "card", "other"];
const paymentPesos = (n) => "₱" + Number(n).toLocaleString("en-PH", { maximumFractionDigits: 2 });
const peso = (n) => "₱" + Math.round(n || 0).toLocaleString("en-PH");

// ---------- state ----------
// Audit F10: every sign-in (and sign-out) starts a new session number. Anything that went to the server is
// kept only if the session that asked is still the current one: an answer for the previous account on a
// shared phone is dropped instead of landing in the next person's lists.
let SESSION = 0;
const sessionNow = () => SESSION;
const newSession = () => ++SESSION;
const stale = (gen) => gen !== SESSION;
const S = {
  me: null, tab: "orders", today: manilaToday(), sel: null, month: null,
  orders: [], members: [], photoUrls: {}, channel: null, range: null,
  period: null, // office view: null = the day picked on the calendar, or { p: "7" | "30" | "custom", from, to }
  loaded: false, loadError: false, filter: null, query: "", hits: null, showArchived: false,
  pending: new Set(), selecting: false, selected: new Set(),
  // Columns and tables added by migrations 012/013; the panel works before and after they are applied
  cap: { archive: false, carrier: false, events: false, amount: false },
  chan: null,
};
S.sel = S.today; S.month = monthOf(S.today);
// admin: everything · vendor (florist): own orders · carrier (driver): deliveries
const isAdmin = () => S.me?.role === "admin";
// Statistics: admins chosen in Team (cdf_members.sees_stats, migration 20261112110000; everyone before it)
const seesStats = () => isAdmin() && S.me?.sees_stats !== false;
// The office view: only the admin
const isStaff = () => S.me?.role === "admin";
const isCarrier = () => S.me?.role === "carrier";
const isFlorist = () => S.me?.role === "vendor";
const memberName = (email) => S.members.find((m) => m.email === email)?.name || email || t("unassigned");
const prefersReducedMotion = () => document.documentElement.dataset.motion === "reduced";

// ---------- toasts ----------
// Stacked at the bottom; an action (Undo, Retry…) keeps it longer, and hovering pauses it.
function toast(msg, { action, onAction, ms, type = "ok" } = {}) {
  const node = el("div", { class: "toast " + type, role: type === "error" ? "alert" : "status" },
    el("span", { class: "ti" }, icon(type === "error" ? "alert" : type === "info" ? "clock" : "tick")), el("p", {}, msg),
    action ? el("button", { type: "button", onclick: () => { close(); onAction(); } }, action) : null);
  let h, gone = false;
  const close = async () => { if (gone) return; gone = true; clearTimeout(h); node.classList.add("out"); await wait(prefersReducedMotion() ? 120 : 300); node.remove(); };
  const arm = () => { clearTimeout(h); h = setTimeout(close, ms || (action ? 6000 : 3200)); };
  node.addEventListener("pointerenter", () => clearTimeout(h));
  node.addEventListener("pointerleave", arm);
  const box = $("toasts");
  while (box.children.length > 2) box.firstChild.remove();
  box.append(node); arm();
}
const toastErr = (msg) => toast(msg, { type: "error" });

// ---------- list motion ----------
// FLIP: cards that stay slide to their new place, new ones fade up. Keyed by data-id.
function flip(container, mutate) {
  if (!container || prefersReducedMotion()) return mutate();
  const first = new Map();
  container.querySelectorAll(":scope > [data-id]").forEach((e) => first.set(e.dataset.id, e.getBoundingClientRect()));
  mutate();
  if (!first.size) return;
  container.querySelectorAll(":scope > [data-id]").forEach((e) => {
    const f = first.get(e.dataset.id), l = e.getBoundingClientRect();
    if (f) { const dx = f.left - l.left, dy = f.top - l.top; if (dx || dy) e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 400, easing: "cubic-bezier(.45,0,.25,1)" }); }
    else e.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(.25,.8,.35,1)" });
  });
}
const stagger = (parent) => { parent.classList.add("stagger"); [...parent.children].forEach((c, i) => c.style.setProperty("--i", i)); setTimeout(() => parent.classList.remove("stagger"), 600); };
const bump = (node) => { node.classList.remove("bump"); void node.offsetWidth; node.classList.add("bump"); };

// ---------- connection banner ----------
function setConnection(kind) {
  const c = $("connection");
  if (!kind) { c.hidden = true; return; }
  c.replaceChildren(icon("alert"), el("span", {}, t(kind === "offline" ? "offline" : "loadError")),
    el("button", { class: "btn", type: "button", onclick: () => loadOrders() }, t("retry")));
  c.hidden = false;
}
addEventListener("offline", () => S.me && setConnection("offline"));
addEventListener("online", () => { if (S.me) loadOrders(); });

// ---------- loading ----------
// Which columns exist yet (migrations 012/013 add archived_at, carrier_email and the change log)
async function detectSchema() {
  const gen = sessionNow();
  const [a, c, e, m, p, x, k, d, b, v, pu, tr, ow, pay, mk, rq, rf, br, co] = await Promise.all([
    sb.from("cdf_orders").select("archived_at").limit(1),
    sb.from("cdf_orders").select("carrier_email").limit(1),
    sb.from("cdf_order_events").select("id").limit(1),
    sb.from("cdf_order_prices").select("order_id").limit(1),
    sb.from("cdf_members").select("away_from").limit(1), // 017: photo, phone and availability
    sb.from("cdf_orders").select("extra_photos").limit(1), // 030: several photos per order
    sb.from("cdf_members").select("pickup_lat").limit(1), // 031: each florist's pickup point (Lalamove)
    sb.from("cdf_orders").select("drop_lat").limit(1), // 033: the customer's exact delivery point
    sb.from("cdf_members").select("branch").limit(1), // 035: each person's branch of the shop
    sb.from("cdf_orders").select("vehicle").limit(1), // 036: Lalamove vehicle per order
    sb.from("cdf_orders").select("pickup").limit(1).then((r) => r, () => ({ error: true })), // 12/11/2026: pickup orders
    sb.from("cdf_orders").select("deleted_at").limit(1).then((r) => r, () => ({ error: true })), // 12/11/2026: the trash
    isAdmin() ? sb.rpc("cdf_is_owner").then((r) => r, () => ({ error: true })) : { error: true }, // who may delete for good
    sb.from("cdf_order_prices").select("paid,pay_proofs").limit(1), // 037: down payments and proofs (admins)
    // Order + price + first payment in one step: an empty call only says whether the function is there
    isAdmin() ? sb.rpc("cdf_create_order", { p_request: null, p_order: null, p_price: null, p_payment: null }).then((r) => r, () => ({})) : {},
    // Phase 3: requests from the public form (admins) and their photos on orders (admins and florists)
    isAdmin() ? sb.from("cdf_order_requests").select("id").limit(1).then((r) => r, () => ({ error: true })) : { error: true },
    sb.rpc("cdf_order_references", { p_order: "00000000-0000-0000-0000-000000000000" }).then((r) => r, () => ({ error: true })),
    // Phase 4: nearest shop to a delivery point; asked with no point, it answers by name that a point is needed
    isAdmin() ? sb.rpc("cdf_branch_ranking", { p_lat: null, p_lng: null, p_date: null }).then((r) => r, () => ({})) : {},
    sb.from("cdf_orders").select("completed,fulfilled_at").limit(1).then((r) => r, () => ({ error: true })),
  ]);
  if (stale(gen)) return;
  S.cap = { retention: !co.error, archive: !a.error, carrier: !c.error, events: !e.error, amount: isAdmin() && !m.error, profiles: !p.error, extra: !x.error, pickup: !k.error, drop: !d.error, branch: !b.error, vehicle: !v.error, pickupMode: !pu.error, trash: !tr.error, owner: !ow.error && ow.data === true, paid: isAdmin() && !m.error && !pay.error,
    create: mk?.data?.available === true, requests: isAdmin() && !rq?.error && mk?.data?.available === true, references: !rf?.error, ranking: /cdf_invalid_point/.test(br?.error?.message || "") };
}
// Staff load the weeks around the month on screen; florists and drivers the days around today.
// Anything still undelivered from before that window comes too, so late orders never vanish.
function wantedRange() {
  if (isStaff()) {
    const m = S.month;
    const r = [iso(new Date(m.getFullYear(), m.getMonth() - 1, 1)), iso(new Date(m.getFullYear(), m.getMonth() + 2, 0))];
    // A chosen period (7 days, 30 days, dates) may reach past the months around the calendar
    if (S.period) { if (S.period.from < r[0]) r[0] = S.period.from; if (S.period.to > r[1]) r[1] = S.period.to; }
    return r;
  }
  const near = [addDays(S.today, -14), addDays(S.today, 31)];
  if (!isFlorist()) return near;
  // A florist's calendar: the months around the one on screen, never less than the days around today
  const m = S.month, r = [iso(new Date(m.getFullYear(), m.getMonth() - 1, 1)), iso(new Date(m.getFullYear(), m.getMonth() + 2, 0))];
  return [r[0] < near[0] ? r[0] : near[0], r[1] > near[1] ? r[1] : near[1]];
}
const inRange = (d) => S.range && d >= S.range[0] && d <= S.range[1];
const inScope = (o) => !o.deleted_at && !(S.cap.archive && o.archived_at) && (inRange(o.date) || (S.range && o.date < S.range[0] && isOpen(o)));

let loading = null, loadingGen = -1;
// Every row of a query, however many requests it takes. `make` builds the query afresh for each page (ordered,
// so pages don't overlap). It goes on until the count the server reports is reached, so it does not depend on
// knowing the API's row limit; without a count, until a page comes back short or empty.
const PAGE_ROWS = 1000;
async function allPages(make) {
  const rows = [];
  for (;;) {
    const q = make(), paged = typeof q.range === "function";
    const { data, error, count } = await (paged ? q.range(rows.length, rows.length + PAGE_ROWS - 1) : q);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!paged || !data?.length || (count != null ? rows.length >= count : data.length < PAGE_ROWS)) break;
  }
  return { data: rows, error: null };
}
async function loadOrders() {
  invalidateStats(); awayAt = 0;
  const gen = sessionNow();
  // The same load is shared only within one session: a new account never waits on (or gets) the last one's
  if (loading && loadingGen === gen) return loading;
  loadingGen = gen;
  const mine = (async () => {
    const [from, to] = wantedRange();
    // Not archived, and not in the trash (12/11/2026)
    const live = (q) => { if (S.cap.archive) q = q.is("archived_at", null); return S.cap.trash ? q.is("deleted_at", null) : q; };
    // Audit F07: both lists are read to the end, page by page. The API hands out a limited number of rows per
    // request; without this, a busy range would simply stop there and orders would be missing with no warning.
    const [a, b] = await Promise.all([
      allPages(() => live(sb.from("cdf_orders").select("*", { count: "exact" }).gte("date", from).lte("date", to)).order("date").order("id")),
      allPages(() => live(sb.from("cdf_orders").select("*", { count: "exact" }).lt("date", from).neq("delivery", "Delivered")).order("date").order("id")),
    ]);
    if (stale(gen)) return false;
    if (a.error || b.error) {
      S.loadError = true;
      setConnection(navigator.onLine === false ? "offline" : "error");
      render();
      return false;
    }
    const seen = new Set(), me = S.me?.email;
    // Overdue orders from before the range are open work only; a cancelled one stays on its own day.
    // A driver sees a cancelled order only if it was theirs (so they know not to go), not in the free pool.
    const rows = [...a.data, ...b.data.filter((o) => !o.cancelled_at)].filter((o) => !seen.has(o.id) && seen.add(o.id))
      .filter((o) => !(isCarrier() && o.cancelled_at && o.carrier_email !== me));
    await attachPrices(rows);
    if (stale(gen)) return false;
    S.orders = rows;
    // Riders booked for these orders: extra information, never a reason for the list not to load
    if (typeof llLoadRows === "function") await llLoadRows().catch(() => {});
    if (stale(gen)) return false;
    S.range = [from, to]; S.loaded = true; S.loadError = false;
    setConnection(null);
    render();
    return true;
  })();
  loading = mine;
  try { return await mine; } catch(e) { if (stale(gen)) return false; S.loadError=true;setConnection("error");render();return false; } finally { if (loading === mine) loading = null; }
}
async function loadMembers() {
  const gen = sessionNow();
  const { data } = await sb.from("cdf_members").select("*").order("name");
  if (data && !stale(gen)) S.members = data;
}
// Realtime: apply the one row that changed instead of reloading everything
function applyChange(p) {
  invalidateStats();
  const row = p.new && p.new.id ? p.new : null, id = row?.id || p.old?.id;
  if (!id) return;
  awayTouched(row || p.old);
  const i = S.orders.findIndex((o) => o.id === id);
  if (p.eventType === "DELETE" || !row || !inScope(row)) { if (i >= 0) S.orders.splice(i, 1); }
  else if (i >= 0) S.orders[i] = { ...S.orders[i], ...row };
  else S.orders.push(row);
  refreshThreadOrder(id, p.eventType === "DELETE" ? null : row);
  if (row) document.dispatchEvent(new CustomEvent("orderchange", { detail: row }));
  clearTimeout(applyChange.h); applyChange.h = setTimeout(render, 120);
}
function subscribe() {
  if (S.channel) sb.removeChannel(S.channel);
  S.channel = sb.channel("cdf-orders")
    .on("postgres_changes", { event: "*", schema: "public", table: "cdf_orders" }, applyChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "cdf_order_prices" }, async () => {
      const account=S.me?.email;invalidateStats();
      try { await attachPrices(S.orders);if(S.me?.email===account)render(); } catch(e) { toast(e.message,{type:"error"}); }
    })
    .subscribe(onRejoin(() => loadOrders()));
}
// Realtime does not replay what happened while the connection was down (phone locked, network change):
// when a channel joins again after a drop, reload so nothing is missed (13/11/2026)
function onRejoin(reload) {
  let joined = false, dropped = false;
  return (status) => {
    if (status === "SUBSCRIBED") { if (joined && dropped && S.me) reload(); joined = true; dropped = false; }
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") dropped = true;
  };
}
const byId = (id) => S.orders.find((o) => o.id === id);
// Merge a row the server just returned (after a save) without waiting for realtime
function upsertLocal(row) {
  invalidateStats(); awayTouched(row);
  if (!row?.id) return;
  refreshThreadOrder(row.id, row);
  const i = S.orders.findIndex((o) => o.id === row.id);
  if (!inScope(row)) { if (i >= 0) S.orders.splice(i, 1); }
  else if (i >= 0) S.orders[i] = { ...S.orders[i], ...row }; else S.orders.push(row);
}

// ---------- the date in Manila moves on by itself ----------
// A tab left open overnight must not keep yesterday as "today".
function checkDay() {
  const d = manilaToday();
  if (d === S.today) return;
  const was = S.today;
  S.today = d;
  if (S.sel === was) { S.sel = d; S.month = monthOf(d); }
  if (S.me) { if (!inRange(d)) loadOrders(); else render(); }
}
setInterval(() => { checkDay(); if (S.me && S.tab === "orders") renderRisk?.(); }, 60000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  checkDay();
  if (S.me) { loadOrders(); if (typeof loadRequests === "function") loadRequests(); if (typeof catchUpChat === "function") catchUpChat(); }
});
// Safety net in case a change slips past realtime: a quiet reload every 2 minutes while the app is on screen
setInterval(() => { if (S.me && !document.hidden && navigator.onLine !== false) loadOrders(); }, 120000);

// Every view draws through here; each script registers what it draws
function render() {
  if (!S.me) return;
  if (S.tab === "team") renderTeam();
  else if (S.tab === "stats" && seesStats()) renderStats();
  else if (S.tab === "chat") renderChat();
  else if (S.tab === "requests") renderRequests();
  else renderOrders();
  refreshAwayConflicts();
  paintGapBanner();
}

// The office: today's and tomorrow's open orders that a rider can't be booked for yet
// (no florist, so no shop to pick up from; or a florist whose shop has no pickup address)
function orderGaps() {
  if (!isStaff()) return [];
  const today = manilaToday(), tomorrow = addDays(today, 1);
  const riderLeft = typeof llActive === "function" ? S.orders.filter((o) => o.cancelled_at && !o.archived_at && llActive(o)).map((o) => ({ o, why: t("gapCancelledRider") })) : [];
  return riderLeft.concat(S.orders.filter((o) => (o.date === today || o.date === tomorrow) && isOpen(o) && !o.archived_at && o.delivery !== "In transit")
    .map((o) => {
      const m = o.vendor_email && S.members.find((x) => x.email === o.vendor_email);
      const due = dueOf(o);
      const why = [
        !o.vendor_email ? t("gapNoFlorist") : S.cap.pickup && m && m.role === "vendor" && (m.pickup_lat == null || !m.pickup_address) ? t("gapNoShop", { name: m.name }) : null,
        typeof llDropped === "function" && llDropped(o) ? t("gapLalamove", { why: t("ll_" + llRowOf(o).status) || llRowOf(o).status }) : null,
        due > 0 ? (pricesOn() ? t("gapUnpaid", { sum: paymentPesos(due) }) : t("gapUnpaidNoSum")) : null,
      ].filter(Boolean).join(" · ");
      return why ? { o, why } : null;
    }).filter(Boolean).sort((a, b) => (a.o.date + a.o.slot).localeCompare(b.o.date + b.o.slot)));
}
function paintGapBanner() {
  const box = $("gapBanner"); if (!box) return;
  const gaps = S.tab === "orders" ? orderGaps() : [];
  box.hidden = !gaps.length;
  if (box.hidden) return;
  const today = manilaToday();
  box.replaceChildren(icon("alert"), el("div", {},
    el("b", {}, t("gapBanner", { n: gaps.length })),
    ...gaps.map(({ o, why }) => el("div", { class: "away-row" },
      el("button", { class: "linkish", type: "button", onclick: () => openOrder(o) }, "#" + o.num + " · " + (o.date === today ? t("today") : t("tomorrow")) + (o.slot ? " " + formatSlot12(o.slot) : "")),
      el("span", {}, why)))));
}

let requests = 0;
const beginRequest = () => { requests++; $("progress")?.classList.add("on"); };
const endRequest = () => { requests=Math.max(0,requests-1); $("progress")?.classList.toggle("on",requests>0); };
document.addEventListener("click", e => {
 const summary=e.target.closest("details > summary"); if (!summary || prefersReducedMotion()) return;
 const details=summary.parentElement; if(details.dataset.animating) {e.preventDefault();return;}
 e.preventDefault();const opening=!details.open,start=details.getBoundingClientRect().height;
 if(opening) details.open=true;
 const end=opening?details.getBoundingClientRect().height:summary.getBoundingClientRect().height;
 details.dataset.animating="true"; details.style.overflow="hidden";
 const animation=details.animate([{height:start+"px"},{height:end+"px"}],{duration:opening?300:220,easing:"cubic-bezier(.16,1,.3,1)"});
 const finish=()=>{details.open=opening;details.style.overflow="";delete details.dataset.animating};
 animation.onfinish=finish;animation.oncancel=finish;
});
document.addEventListener("submit",e=>{
 const button=e.submitter;if(!button)return;beginRequest();
 const observer=new MutationObserver(()=>{if(!button.disabled){observer.disconnect();endRequest();if(!e.target.querySelector(".err:not(:empty)")){button.classList.add("is-done");setTimeout(()=>button.classList.remove("is-done"),900)}}});
 observer.observe(button,{attributes:true,attributeFilter:["disabled"]});
 queueMicrotask(()=>{if(!button.disabled){observer.disconnect();endRequest()}});
},true);

// Tapping the dimmed backdrop closes a sheet or dialog, but only when the press also started there:
// selecting text in a field and letting go outside the window must not close it (and lose the work).
function closeOnBackdrop(scrim, close) {
  let downOnScrim = false;
  scrim.addEventListener("pointerdown", (e) => { downOnScrim = e.target === scrim; });
  scrim.addEventListener("click", (e) => { if (e.target === scrim && downOnScrim) close(); downOnScrim = false; });
}
// What is still owed on an order (price − paid). null without a price, or for anyone who can't see money.
const dueOf = (o) => S.cap.paid && o.amount != null && o.amount !== "" ? Math.max(0, Math.round(+o.amount * 100) - Math.round((+o.paid || 0) * 100)) / 100 : null;
// Prices live behind their own administrator-only row policies, never in the shared order row.
async function attachPrices(rows) {
 if (!isAdmin() || !S.cap.amount || !rows?.length) return rows;
 for(let offset=0;offset<rows.length;offset+=200){
  const part=rows.slice(offset,offset+200), {data,error}=await sb.from("cdf_order_prices").select(S.cap.paid?"order_id,amount,paid,pay_proofs":"order_id,amount").in("order_id",part.map(o=>o.id));
  if(error) throw new Error(t("priceLoadFail"));
  const byId=new Map((data||[]).map(p=>[p.order_id,p]));
  part.forEach(o=>{const p=byId.get(o.id);o.amount=p?.amount??null;if(S.cap.paid){o.paid=p?.paid??null;o.pay_proofs=p?.pay_proofs||[];}});
 }
 return rows;
}
// patch: {amount?} with only what this person changed. seen: {amount} as the sheet showed it when it opened
// (null for a new order). A price someone else changed since then is not overwritten: the save stops and says so.
// Audit F03: the comparison is part of the write itself (update … where amount = seen), so two people saving at
// once cannot both pass it; reading first and writing after let the second one win without a word.
async function savePrice(id,patch,seen) {
 if(!priceEditable()) return;
 const row={order_id:id};
 if("amount" in patch) row.amount=patch.amount;
 if(Object.keys(row).length===1) return row;
 const fail=(error)=>new Error(t(error.message === "cdf_price_below_paid" ? "payPriceBelowPaid" : "priceSaveFail"));
 if(seen){
  const was=seen.amount==null||seen.amount===""?null:+seen.amount;
  let q=sb.from("cdf_order_prices").update({amount:row.amount}).eq("order_id",id);
  q=was==null?q.is("amount",null):q.eq("amount",was);
  const {data,error}=await q.select("order_id");
  if(error) throw fail(error);
  if(!data?.length){
   // Nothing matched: the price is no longer what this sheet showed, or the order never had a price row
   if(was!=null) throw new Error(t("payChangedMeanwhile"));
   const made=await sb.from("cdf_order_prices").insert(row);
   if(made.error) throw made.error.code==="23505" ? new Error(t("payChangedMeanwhile")) : fail(made.error);
  }
 } else {
  const {error}=await sb.from("cdf_order_prices").upsert(row,{onConflict:"order_id"});
  if(error) throw fail(error);
 }
 invalidateStats();
 return row;
}
// Exhaust the paginated, RLS-protected history. Never silently accept the API's default row cap.
async function historyRows() {
 const cols="id,num,date,slot,channel,vendor_email,status,delivery,attempts,buyer_phone,buyer_name,customer_phone,cancelled_at"+(S.cap.pickupMode?",pickup":"")+(S.cap.trash?",deleted_at":"")+(S.cap.retention?",completed,fulfilled_at":"");
 const {data,error}=await allPages(()=>sb.from("cdf_orders").select(cols,{count:"exact"}).order("id"));
 if(error)throw new Error(t("loadFail"));
 // An archived order always counts. Legacy successful orders in the trash count as well.
 const rows=(data||[]).filter(o=>!o.deleted_at||isRetained(o));
 await attachPrices(rows);return rows;
}
