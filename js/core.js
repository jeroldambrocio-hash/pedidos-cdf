// Core: Supabase client, shared state, helpers and order loading. Loaded first; every other script uses these.
const { url, anonKey, bucket } = window.CDF_CONFIG;
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
// Phone fields show "+63" fixed and only the rest is typed. A number that starts with + or 00 keeps its own
// country (Spain and the rest), and the fixed prefix steps aside for it.
const phLocal = (p) => { const s = String(p || "").trim(); return /^\+63/.test(s) ? s.replace(/^\+63\s*/, "") : s; };
const phFull = (v) => { const s = String(v || "").trim(); if (!s) return ""; if (/^(\+|00)/.test(s)) return normPhone(s); return normPhone("+63" + s.replace(/\D/g, "").replace(/^(63)?0?/, "")); };
// Search without accents or case ("Sofia" finds "Sofía")
const norm = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Prices: off unless an admin turns them on in this browser (needs migration 014)
const pricesOn = () => S.cap.amount && isAdmin() && pref("cdf-prices") === "on";
const peso = (n) => "₱" + Math.round(n || 0).toLocaleString("en-PH");

// ---------- state ----------
const S = {
  me: null, tab: "orders", today: manilaToday(), sel: null, month: null,
  orders: [], members: [], photoUrls: {}, channel: null, range: null,
  loaded: false, loadError: false, filter: null, query: "", hits: null, showArchived: false,
  pending: new Set(), selecting: false, selected: new Set(),
  // Columns and tables added by migrations 012/013; the panel works before and after they are applied
  cap: { archive: false, carrier: false, events: false, amount: false },
  chan: null,
};
S.sel = S.today; S.month = monthOf(S.today);
// admin: everything · moderator: all orders, no team or deleting · vendor: own orders · carrier: deliveries
const isAdmin = () => S.me?.role === "admin";
const isStaff = () => S.me?.role === "admin" || S.me?.role === "moderator";
const isCarrier = () => S.me?.role === "carrier";
const memberName = (email) => S.members.find((m) => m.email === email)?.name || email || t("unassigned");
const prefersReducedMotion = () => document.documentElement.dataset.motion === "reduced";

// ---------- toasts ----------
// Stacked at the bottom; an action (Undo, Retry…) keeps it longer, and hovering pauses it.
function toast(msg, { action, onAction, ms, type = "ok" } = {}) {
  const node = el("div", { class: "toast " + type, role: type === "error" ? "alert" : "status" },
    el("span", { class: "ti" }, icon(type === "error" ? "alert" : type === "info" ? "clock" : "tick")), el("p", {}, msg),
    action ? el("button", { type: "button", onclick: () => { close(); onAction(); } }, action) : null);
  let h, gone = false;
  const close = async () => { if (gone) return; gone = true; clearTimeout(h); node.classList.add("out"); await wait(prefersReducedMotion() ? 120 : 170); node.remove(); };
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
    if (f) { const dx = f.left - l.left, dy = f.top - l.top; if (dx || dy) e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 240, easing: "cubic-bezier(.2,0,0,1)" }); }
    else e.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.16,1,.3,1)" });
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
  const [a, c, e, m] = await Promise.all([
    sb.from("cdf_orders").select("archived_at").limit(1),
    sb.from("cdf_orders").select("carrier_email").limit(1),
    sb.from("cdf_order_events").select("id").limit(1),
    sb.from("cdf_order_prices").select("order_id").limit(1),
  ]);
  S.cap = { archive: !a.error, carrier: !c.error, events: !e.error, amount: isAdmin() && !m.error };
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
  invalidateStats();
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
    await attachPrices(S.orders);
    S.range = [from, to]; S.loaded = true; S.loadError = false;
    setConnection(null);
    render();
    return true;
  })();
  try { return await loading; } catch(e) { S.loadError=true;setConnection("error");render();return false; } finally { loading = null; }
}
async function loadMembers() {
  const { data } = await sb.from("cdf_members").select("email,name,role").order("name");
  if (data) S.members = data;
}
// Realtime: apply the one row that changed instead of reloading everything
function applyChange(p) {
  invalidateStats();
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
    .on("postgres_changes", { event: "*", schema: "public", table: "cdf_order_prices" }, async () => {
      const account=S.me?.email;invalidateStats();
      try { await attachPrices(S.orders);if(S.me?.email===account)render(); } catch(e) { toast(e.message,{type:"error"}); }
    })
    .subscribe();
}
const byId = (id) => S.orders.find((o) => o.id === id);
// Merge a row the server just returned (after a save) without waiting for realtime
function upsertLocal(row) {
  invalidateStats();
  if (!row?.id) return;
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
document.addEventListener("visibilitychange", () => { if (document.hidden) return; checkDay(); if (S.me) loadOrders(); });

// Every view draws through here; each script registers what it draws
function render() {
  if (!S.me) return;
  if (S.tab === "team") renderTeam();
  else if (S.tab === "stats") renderStats();
  else renderOrders();
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

// Prices live behind their own administrator-only row policies, never in the shared order row.
async function attachPrices(rows) {
 if (!isAdmin() || !S.cap.amount || !rows?.length) return rows;
 for(let offset=0;offset<rows.length;offset+=200){
  const part=rows.slice(offset,offset+200), {data,error}=await sb.from("cdf_order_prices").select("order_id,amount").in("order_id",part.map(o=>o.id));
  if(error) throw new Error(t("priceLoadFail"));
  const amounts=new Map((data||[]).map(p=>[p.order_id,p.amount]));part.forEach(o=>o.amount=amounts.get(o.id)??null);
 }
 return rows;
}
async function savePrice(id,amount) {
 if(!pricesOn()) return;
 const {error}=await sb.from("cdf_order_prices").upsert({order_id:id,amount},{onConflict:"order_id"});
 if(error) throw new Error(t("priceSaveFail"));
 invalidateStats();
}
// Exhaust the paginated, RLS-protected history. Never silently accept the API's default row cap.
async function historyRows() {
 const rows=[], cols="id,num,date,slot,channel,vendor_email,status,delivery,attempts,buyer_phone,buyer_name,customer_phone";
 for(let offset=0;;offset+=1000){
  let query=sb.from("cdf_orders").select(cols).order("id");
  const paged=typeof query.range==="function";if(paged)query=query.range(offset,offset+999);
  const {data,error}=await query;if(error)throw new Error(t("loadFail"));rows.push(...(data||[]));
  if(!paged || !data || data.length<1000)break;
 }
 await attachPrices(rows);return rows;
}
