// Core: Supabase client, shared state, helpers and order loading. Loaded first; every other script uses these.
const { url, anonKey, bucket } = window.CDF_CONFIG;
const sb = supabase.createClient(url, anonKey);
// Private buckets: order screenshots (bucket) and bouquet / delivery photos (ENTREGAS)
const ENTREGAS = "cdf-entregas";
// The shop works on Philippine time, wherever the viewer happens to be
const TZ = "Asia/Manila";
const CHANNELS = ["Shopify", "TikTok", "Instagram", "Web"];

// One pipeline drives both stored fields: status (Preparing/Ready) and delivery (-/In transit/Delivered/Failed).
const STEPS = [
  { k: "prep", status: "Preparing", delivery: "-" },
  { k: "ready", status: "Ready", delivery: "-" },
  { k: "transit", status: "Ready", delivery: "In transit" },
  { k: "done", status: "Ready", delivery: "Delivered" },
  { k: "fail", status: "Ready", delivery: "Failed" }, // attempted, nobody home
];
const stepOf = (o) => (o.delivery === "Failed" ? 4 : o.delivery === "Delivered" ? 3 : o.delivery === "In transit" ? 2 : o.status === "Ready" ? 1 : 0);
// The next step from each one: Preparing → Ready → In transit → Delivered; a failed attempt goes out again.
const NEXT = { 0: 1, 1: 2, 2: 3, 4: 2 };
const stepName = (i) => t("st_" + STEPS[i].k);

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
// Any "H:MM - H:MM" is allowed; orders are grouped and sorted by start time.
const slotStart = (s) => { const m = /(\d{1,2}):(\d{2})/.exec(s || ""); return m ? +m[1] * 60 + +m[2] : 9999; };
const slotEnd = (s) => { const m = /-\s*(\d{1,2}):(\d{2})/.exec(s || ""); return m ? +m[1] * 60 + +m[2] : slotStart(s) + 60; };
const byTime = (a, b) => a.date.localeCompare(b.date) || slotStart(a.slot) - slotStart(b.slot) || String(a.num).localeCompare(String(b.num), undefined, { numeric: true });
const longDate = (s) => cap(fromIso(s).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" }));
const shortDate = (s) => cap(fromIso(s).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" }));
const dayCount = (n) => (n === 1 ? t("oneOrder") : t("nOrders", { n }));
const trackUrl = (o) => location.origin + "/p/" + o.code;
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

// ---------- state ----------
const S = {
  me: null, tab: "orders", today: manilaToday(), sel: null, month: null,
  orders: [], members: [], photoUrls: {}, channel: null, range: null,
  loaded: false, loadError: false, filter: null, query: "", hits: null, showArchived: false,
  pending: new Set(), selecting: false, selected: new Set(),
  // Columns and tables added by migrations 012/013; the panel works before and after they are applied
  cap: { archive: false, carrier: false, events: false },
};
S.sel = S.today; S.month = monthOf(S.today);
// admin: everything · moderator: all orders, no team or deleting · vendor: own orders · carrier: deliveries
const isAdmin = () => S.me?.role === "admin";
const isStaff = () => S.me?.role === "admin" || S.me?.role === "moderator";
const isCarrier = () => S.me?.role === "carrier";
const memberName = (email) => S.members.find((m) => m.email === email)?.name || email || t("unassigned");
const prefersReducedMotion = () => document.documentElement.dataset.motion === "reduced";

// ---------- toasts ----------
// One message at a time; an optional action button (Undo, Retry…) stays a little longer.
function toast(msg, { action, onAction, ms } = {}) {
  const box = $("toast");
  clearTimeout(toast.h);
  box.replaceChildren(el("span", {}, msg), ...(action ? [el("button", { type: "button", onclick: () => { box.hidden = true; onAction(); } }, action)] : []));
  box.hidden = false;
  toast.h = setTimeout(() => (box.hidden = true), ms || (action ? 6000 : 3200));
}

// ---------- connection banner ----------
function setConnection(kind) {
  const c = $("connection");
  if (!kind) { c.hidden = true; return; }
  c.replaceChildren(el("span", {}, t(kind === "offline" ? "offline" : "loadError")),
    el("button", { class: "btn", type: "button", onclick: () => loadOrders() }, t("retry")));
  c.hidden = false;
}
addEventListener("offline", () => S.me && setConnection("offline"));
addEventListener("online", () => { if (S.me) loadOrders(); });

// ---------- loading ----------
// Which columns exist yet (migrations 012/013 add archived_at, carrier_email and the change log)
async function detectSchema() {
  const [a, c, e] = await Promise.all([
    sb.from("cdf_orders").select("archived_at").limit(1),
    sb.from("cdf_orders").select("carrier_email").limit(1),
    sb.from("cdf_order_events").select("id").limit(1),
  ]);
  S.cap = { archive: !a.error, carrier: !c.error, events: !e.error };
}
// Staff load the weeks around the month on screen; florists and drivers the days around today.
// Anything still undelivered from before that window comes too, so late orders never vanish.
function wantedRange() {
  if (isStaff()) {
    const m = S.month;
    return [iso(new Date(m.getFullYear(), m.getMonth() - 1, 1)), iso(new Date(m.getFullYear(), m.getMonth() + 2, 0))];
  }
  return [addDays(S.today, -14), addDays(S.today, 31)];
}
const inRange = (d) => S.range && d >= S.range[0] && d <= S.range[1];
const inScope = (o) => !(S.cap.archive && o.archived_at) && (inRange(o.date) || (S.range && o.date < S.range[0] && o.delivery !== "Delivered"));

let loading = null;
async function loadOrders() {
  if (loading) return loading;
  loading = (async () => {
    const [from, to] = wantedRange();
    const live = (q) => (S.cap.archive ? q.is("archived_at", null) : q);
    const [a, b] = await Promise.all([
      live(sb.from("cdf_orders").select("*").gte("date", from).lte("date", to)).order("date"),
      live(sb.from("cdf_orders").select("*").lt("date", from).neq("delivery", "Delivered")).order("date"),
    ]);
    if (a.error || b.error) {
      S.loadError = true;
      setConnection(navigator.onLine === false ? "offline" : "error");
      render();
      return false;
    }
    const seen = new Set();
    S.orders = [...a.data, ...b.data].filter((o) => !seen.has(o.id) && seen.add(o.id));
    S.range = [from, to]; S.loaded = true; S.loadError = false;
    setConnection(null);
    render();
    return true;
  })();
  try { return await loading; } finally { loading = null; }
}
async function loadMembers() {
  const { data } = await sb.from("cdf_members").select("email,name,role").order("name");
  if (data) S.members = data;
}
// Realtime: apply the one row that changed instead of reloading everything
function applyChange(p) {
  const row = p.new && p.new.id ? p.new : null, id = row?.id || p.old?.id;
  if (!id) return;
  const i = S.orders.findIndex((o) => o.id === id);
  if (p.eventType === "DELETE" || !row || !inScope(row)) { if (i >= 0) S.orders.splice(i, 1); }
  else if (i >= 0) S.orders[i] = { ...S.orders[i], ...row };
  else S.orders.push(row);
  if (row) document.dispatchEvent(new CustomEvent("orderchange", { detail: row }));
  clearTimeout(applyChange.h); applyChange.h = setTimeout(render, 120);
}
function subscribe() {
  if (S.channel) sb.removeChannel(S.channel);
  S.channel = sb.channel("cdf-orders")
    .on("postgres_changes", { event: "*", schema: "public", table: "cdf_orders" }, applyChange)
    .subscribe();
}
const byId = (id) => S.orders.find((o) => o.id === id);
// Merge a row the server just returned (after a save) without waiting for realtime
function upsertLocal(row) {
  if (!row?.id) return;
  const i = S.orders.findIndex((o) => o.id === row.id);
  if (!inScope(row)) { if (i >= 0) S.orders.splice(i, 1); }
  else if (i >= 0) S.orders[i] = row; else S.orders.push(row);
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
document.addEventListener("visibilitychange", () => { if (document.hidden) return; checkDay(); if (S.me) loadOrders(); });

// Every view draws through here; each script registers what it draws
function render() {
  if (!S.me) return;
  if (S.tab === "team") renderTeam();
  else if (S.tab === "stats") renderStats();
  else renderOrders();
}
