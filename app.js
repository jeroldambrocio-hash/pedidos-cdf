const { url, anonKey, bucket } = window.CDF_CONFIG;
const sb = supabase.createClient(url, anonKey);

// Any "H:MM - H:MM" is allowed; orders are grouped and sorted by start time.
const slotStart = (s) => { const m = /(\d{1,2}):(\d{2})/.exec(s || ""); return m ? +m[1] * 60 + +m[2] : 9999; };
const CHANNELS = [["Shopify", "--ch-shopify"], ["TikTok", "--ch-tiktok"], ["Instagram", "--ch-instagram"], ["Web", "--ch-web"]];
// One pipeline drives both stored fields: status (Preparing/Ready) and delivery (-/In transit/Delivered).
const STEPS = [
  { k: "prep", status: "Preparing", delivery: "-" },
  { k: "ready", status: "Ready", delivery: "-" },
  { k: "transit", status: "Ready", delivery: "In transit" },
  { k: "done", status: "Ready", delivery: "Delivered" },
  { k: "fail", status: "Ready", delivery: "Failed" }, // attempted, nobody home
];
const stepOf = (o) => (o.delivery === "Failed" ? 4 : o.delivery === "Delivered" ? 3 : o.delivery === "In transit" ? 2 : o.status === "Ready" ? 1 : 0);
// Private buckets: order screenshots (bucket) and bouquet / delivery photos (ENTREGAS)
const ENTREGAS = "cdf-entregas";

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const fromIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const el = (t, a = {}, ...kids) => {
  const e = document.createElement(t);
  for (const [k, v] of Object.entries(a)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(c)); }
  return e;
};
const trackUrl = (o) => location.origin + "/p/" + o.code;

// The shop works on Philippine time, wherever the admin happens to be
const TZ = "Asia/Manila";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const S = { me: null, tab: "orders", sel: today, month: fromIso(today), orders: [], members: [], photoUrls: {}, channel: null };
S.month.setDate(1);
S.filter=null; S.query=""; S.statusPending=new Set();
// admin: everything · moderator: all orders, no team · vendor: own orders · carrier: Ready orders, delivery steps
const isAdmin = () => S.me?.role === "admin";
const isStaff = () => S.me?.role === "admin" || S.me?.role === "moderator";
const isCarrier = () => S.me?.role === "carrier";
// Steps this user may set on an order (indexes into STEPS)
const allowedSteps = () => (isCarrier() ? [2, 3, 4] : [0, 1, 2, 3, 4]);

function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600); }
function show(view) { for (const v of ["login", "noaccess", "ordersView", "teamView"]) $(v).hidden = v !== view; }

// ---------- auth ----------
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault(); $("lErr").textContent = ""; $("lBtn").disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim(), password: $("lPass").value });
  $("lBtn").disabled = false;
  if (error) $("lErr").textContent = /invalid/i.test(error.message) ? t("badLogin") : error.message;
});
// Local sign-out needs no network round trip, so it works even when the server call would fail
// (Safari kept the session when the global sign-out request errored).
$("logout").onclick = async () => {
  $("logout").disabled = true;
  try { await sb.auth.signOut({ scope: "local" }); } catch { /* clear it below anyway */ }
  try { for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k); } catch {}
  $("logout").disabled = false;
  booted = null; stop();
};

let booted;
sb.auth.onAuthStateChange((_ev, session) => {
  const id = session?.user?.id || null;
  if (id === booted) return;
  booted = id;
  setTimeout(() => (id ? start(session.user) : stop()), 0);
});

function stop() {
  S.me = null; S.orders = []; S.photoUrls = {}; S.filter=null; S.query=""; $("q").value=""; delete document.body.dataset.role;
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  $("hright").hidden = true; $("sub").textContent = t("signIn");
  $("tabs").hidden = true;
  closeSheet(); show("login");
}

async function start(user) {
  const email = user.email.toLowerCase();
  const { data, error } = await sb.from("cdf_members").select("email,name,role").eq("email", email).maybeSingle();
  $("hright").hidden = false;
  if (error || !data) {
    $("noaccessTxt").textContent = t("noAccessTxt", { email });
    $("tabs").hidden = true; show("noaccess"); return;
  }
  S.me = data;
  document.body.dataset.role=data.role;
  renderSub();
  $("tabs").hidden = !isAdmin();
  $("newBtn").hidden = !isStaff();
  $("adminTools").hidden = !isAdmin();
  $("q").hidden = !isStaff();
  if (isStaff()) await loadMembers();
  await loadOrders();
  S.channel = sb.channel("cdf-orders")
    .on("postgres_changes", { event: "*", schema: "public", table: "cdf_orders" }, () => { clearTimeout(S.reload); S.reload = setTimeout(loadOrders, 300); })
    .subscribe();
  setTab("orders");
}

async function loadOrders() {
  const { data, error } = await sb.from("cdf_orders").select("*").order("date").order("num");
  if (error) { toast(t("loadFail")); return; }
  S.orders = data;
  renderOrders();
}
async function loadMembers() {
  const { data } = await sb.from("cdf_members").select("email,name,role").order("name");
  S.members = data || [];
}
const memberName = (email) => S.members.find((m) => m.email === email)?.name || email || t("unassigned");

function renderSub() {
  if (!S.me) { $("sub").textContent = t("signIn"); return; }
  $("sub").textContent = t({ admin: "subAdmin", moderator: "subModerator", carrier: "subCarrier" }[S.me.role] || "subVendor", { name: S.me.name });
}
document.addEventListener("langchange", () => {
  renderSub();
  if (S.me && $("noaccess").hidden === false) $("noaccessTxt").textContent = t("noAccessTxt", { email: S.me.email });
  if (S.tab === "team") renderTeam(); else renderOrders();
  if (S.openOrder !== undefined) openSheet(S.openOrder);
});

// ---------- tabs ----------
function setTab(t) {
  S.tab = t;
  $("tabOrders").setAttribute("aria-pressed", String(t === "orders"));
  $("tabTeam").setAttribute("aria-pressed", String(t === "team"));
  if (t === "team") { show("teamView"); renderTeam(); } else { show("ordersView"); renderOrders(); }
}
$("tabOrders").onclick = () => setTab("orders");
$("tabTeam").onclick = () => setTab("team");

// ---------- calendar + day ----------
function renderOrders() {
  if (!S.me || S.tab !== "orders") return;
  // Florists and drivers get their own to-do list; the calendar and board are for staff.
  $("ordersView").classList.toggle("solo", !isStaff());
  if (isStaff()) { renderCal(); renderBoard(); renderPurge(); } else renderAgenda();
}
function renderCal() {
  const m = S.month, y = m.getFullYear(), mo = m.getMonth();
  $("mLabel").textContent = cap(m.toLocaleDateString(locale(), { month: "long", year: "numeric" }));
  const counts = {}; for (const o of S.orders) counts[o.date] = (counts[o.date] || 0) + 1;
  const cal = $("cal"); cal.replaceChildren();
  t("dow").forEach((d, i) => cal.append(el("div", { class: "dow" + (i === 6 ? " sun" : "") }, d)));
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), k = iso(d), n = counts[k] || 0;
    if (i >= 35 && d.getMonth() !== mo) break;
    const dots = el("span", { class: "dots" }); for (let j = 0; j < Math.min(n, 3); j++) dots.append(el("i"));
    cal.append(el("button", {
      class: "day" + (d.getMonth() !== mo ? " out" : "") + (k === today ? " today" : "") + (k === S.sel ? " sel" : ""),
      "aria-label": d.toLocaleDateString(locale(), { day: "numeric", month: "long" }) + (n ? ", " + t("nOrders", { n }) : ""),
      onclick: () => { S.sel = k; $("q").value = ""; S.month = new Date(d.getFullYear(), d.getMonth(), 1); renderOrders(); },
    }, String(d.getDate()), dots));
  }
}
function chanChip(c) { if (!c) return null; const v = (CHANNELS.find((x) => x[0] === c) || [c, "--muted"])[1]; return el("span", { class: "chan", style: "color:var(" + v + ")" }, c); }
const stepName = (i) => t("st_" + STEPS[i].k);
const byTime = (a, b) => a.date.localeCompare(b.date) || slotStart(a.slot) - slotStart(b.slot) || a.num.localeCompare(b.num);
const addDays = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
const longDate = (s) => cap(fromIso(s).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" }));
const shortDate = (s) => cap(fromIso(s).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" }));
// The next step from each one: Preparing → Ready → In transit → Delivered; a failed attempt goes out again.
const NEXT = { 0: 1, 1: 2, 2: 3, 4: 2 };
// Staff write the row; florists and drivers go through cdf_progress(), which checks what they may do.
function setStep(id, k, extra = {}) {
  const s = STEPS.find((x) => x.k === k);
  if (isStaff()) return sb.from("cdf_orders").update({ status: s.status, delivery: s.delivery, ...extra }).eq("id", id);
  return sb.rpc("cdf_progress", { p_id: id, p_step: k, p_note: extra.delivery_note ?? null,
    p_proof: extra.proof_path ?? null, p_set_proof: "proof_path" in extra });
}
async function advance(o,i){
  if(S.statusPending.has(o.id))return;
  S.statusPending.add(o.id);const step=STEPS[i],prev={status:o.status,delivery:o.delivery};
  Object.assign(o,{status:step.status,delivery:step.delivery});renderOrders();
  try{const {error}=await setStep(o.id,step.k);if(error)throw error;
    if(step.k==='transit')toast(o.customer_email?t('outMailed'):t('outNoMail'));
  }catch{Object.assign(o,prev);toast(t('statusFail'));}
  finally{S.statusPending.delete(o.id);renderOrders();}
}
// Signed links last an hour; renew them a bit before they run out.
async function photoUrl(path, bkt = bucket) {
  if (!path) return null;
  const key = bkt + "/" + path, c = S.photoUrls[key];
  if (c && c.exp > Date.now()) return c.url;
  const { data } = await sb.storage.from(bkt).createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  S.photoUrls[key] = { url: data.signedUrl, exp: Date.now() + 50 * 60e3 };
  return data.signedUrl;
}
const imgOf = (path, bkt, alt) => {
  const box = el("div", { class: "drop" }, t("loadingPhoto"));
  photoUrl(path, bkt).then((u) => box.replaceChildren(u ? el("img", { src: u, alt }) : t("photoFail")));
  return box;
};
function thumb(o, cls = "thumb") {
  const photo=o.bouquet_path||o.photo_path;
  const th = el("div", { class: cls }, photo ? "" : el("img",{src:"/img/emblem.png",alt:"",class:"placeholder-emblem"}));
  if (photo) photoUrl(photo,o.bouquet_path?ENTREGAS:bucket).then((u) => { if (u) th.replaceChildren(el("img", { src: u, alt: "" })); });
  return th;
}
const dayCount = (n) => (n ? (n === 1 ? t("oneOrder") : t("nOrders", { n })) : "");

// ---------- admin: the day as a board, one column per step ----------
const COLS = [{ k: "prep", steps: [0] }, { k: "ready", steps: [1, 4] }, { k: "transit", steps: [2] }, { k: "done", steps: [3] }];
function renderBoard() {
  const q = $("q").value.trim().toLowerCase();
  if (q) return renderSearch(q);
  $("dLabel").textContent = longDate(S.sel);
  const all = S.orders.filter((o) => o.date === S.sel).sort(byTime);
  $("dSub").textContent = dayCount(all.length);
  const box = $("list"); box.replaceChildren();
  if (!all.length) { box.append(el("div", { class: "empty" }, el("b", {}, t("noOrdersDay")), t("emptyAdmin"))); return; }
  const board = el("div", { class: "board" });
  for (const c of COLS) {
    const os = all.filter((o) => c.steps.includes(stepOf(o)));
    board.append(el("section", { class: "col c-" + c.k },
      el("h3", {}, t("st_" + c.k), el("span", { class: "n" }, String(os.length))),
      ...os.map((o) => boardCard(o))));
  }
  box.append(board);
}
// Search every loaded order by number, name or phone (recipient or buyer)
function renderSearch(q) {
  const digits = q.replace(/\D/g, "");
  const hits = S.orders.filter((o) => o.num.toLowerCase().includes(q)
    || [o.customer_name, o.buyer_name].some((n) => (n || "").toLowerCase().includes(q))
    || (digits.length >= 3 && [o.customer_phone, o.buyer_phone].some((p) => (p || "").replace(/\D/g, "").includes(digits))))
    .sort(byTime);
  $("dLabel").textContent = t("searchTitle", { q });
  $("dSub").textContent = dayCount(hits.length);
  const box = $("list"); box.replaceChildren();
  if (!hits.length) { box.append(el("div", { class: "empty" }, el("b", {}, t("searchNone")))); return; }
  box.append(el("div", { class: "results" }, ...hits.map((o) => boardCard(o, true))));
}
function boardCard(o, withDate) {
  const cur = stepOf(o), next = NEXT[cur];
  const open = () => openFresh(o);
  return el("div", { class: "bcard", role: "button", tabindex: "0", onclick: open, onkeydown: (e) => { if (e.key === "Enter") open(); } },
    el("div", { class: "b-head" }, thumb(o),
      el("div", { class: "o-main" },
        el("div", { class: "o-top" }, el("span", { class: "time" }, (withDate ? shortDate(o.date) + " · " : "") + o.slot), el("span", { class: "num" }, "#" + o.num),
          withDate ? el("span", { class: "pill s-" + STEPS[cur].k }, stepName(cur)) : null),
        el("div", { class: "o-sub" }, o.customer_name || t("noName")),
        el("div", { class: "o-sub" }, memberName(o.vendor_email)))),
    cur === 4 && !withDate ? el("span", { class: "tag fail" }, t("st_fail")) : null,
    next != null && !withDate ? el("button", { class: "btn adv", type: "button", onclick: (e) => { e.stopPropagation(); advance(o, next); } }, stepName(next) + " →") : null);
}

// ---------- florist and driver: what to do, by day ----------
function renderAgenda() {
  const tomorrow = addDays(today, 1), week = addDays(today, 7), open = (o) => stepOf(o) !== 3;
  const os = [...S.orders].sort(byTime);
  const groups = [
    [t("grpLate"), os.filter((o) => o.date < today && open(o)), true],
    [t("today") + " · " + longDate(today), os.filter((o) => o.date === today), false],
  ];
  // Florists plan ahead; drivers only need today's route
  if (!isCarrier()) groups.push(
    [t("tomorrow") + " · " + longDate(tomorrow), os.filter((o) => o.date === tomorrow), false],
    [t("grpNext"), os.filter((o) => o.date > tomorrow && o.date <= week), true]);
  $("dLabel").textContent = isCarrier() ? t("myRoute") : t("myOrders");
  $("dSub").textContent = groups[1][1].length ? t("todayCount", { n: groups[1][1].length }) : t("nothingToday");
  const box = $("list"); box.replaceChildren();
  let any = false;
  for (const [label, list, withDate] of groups) {
    if (!list.length) continue;
    any = true;
    box.append(el("section", { class: "slot" }, el("h3", {}, label), el("div", { class: "orders" }, ...list.map((o) => workCard(o, withDate)))));
  }
  if (!any) box.append(el("div", { class: "empty" }, el("b", {}, t("allClear")), isCarrier() ? t("emptyCarrier") : t("emptyVendor")));
}
function workCard(o, withDate) {
  const cur = stepOf(o), k = STEPS[cur].k;
  const big = (label, fn, cls = "primary") => el("button", { class: "btn big " + cls, type: "button", onclick: fn, disabled:S.statusPending.has(o.id) }, label);
  const acts = [];
  if (cur === 0 && !isCarrier()) acts.push(big("✓ " + t("actReady"), () => readyDialog(o)));
  if (cur === 1 || cur === 4) acts.push(big(t("actOut"), () => advance(o, 2)));
  if (cur === 2) acts.push(big("✓ " + t("actDelivered"), () => deliverDialog(o)), big(t("actMissed"), () => missedDialog(o), ""));
  const phone = o.customer_phone && cur !== 3 ? intlPhone(o.customer_phone) : "";
  const small = [
    phone ? el("a", { class: "btn", href: "tel:+" + phone }, t("call")) : null,
    phone ? el("a", { class: "btn", href: "https://wa.me/" + phone, target: "_blank", rel: "noopener" }, "WhatsApp") : null,
    o.address && cur !== 3 ? el("a", { class: "btn", href: mapsUrl(o.address), target: "_blank", rel: "noopener" }, t("map")) : null,
  ];
  const open = () => openFresh(o);
  return el("article", { class: "wcard" + (cur === 3 ? " done" : "") },
    el("div", { class: "w-main", role: "button", tabindex: "0", onclick: open, onkeydown: (e) => { if (e.key === "Enter") open(); } },
      thumb(o, "thumb lg"),
      el("div", { class: "o-main" },
        el("div", { class: "o-top" },
          el("b", { class: "time" }, (withDate ? shortDate(o.date) + " · " : "") + o.slot),
          el("span", { class: "num" }, "#" + o.num), chanChip(o.channel),
          el("span", { class: "pill s-" + k }, stepName(cur))),
        el("div", { class: "w-name" }, o.customer_name || t("noName")),
        o.address ? el("div", { class: "o-sub" }, o.address) : null,
        o.card_message ? el("div", { class: "w-note" }, "💌 " + o.card_message) : null,
        o.notes ? el("div", { class: "w-note" }, o.notes) : null)),
    el("div", { class: "w-acts" }, ...acts, ...small));
}

// A small sheet with a form and one confirm button; onConfirm returns an error message or nothing.
function miniSheet(title, nodes, confirmLabel, onConfirm) {
  closeSheet();
  const scrim = el("div", { class: "scrim", onclick: (e) => { if (e.target === scrim) closeSheet(); } });
  const err = el("div", { class: "err", role: "alert" });
  const ok = el("button", { class: "btn primary big", type: "submit" }, confirmLabel);
  const form = el("form", { class: "sheet", role: "dialog", "aria-modal": "true", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ""; ok.disabled = true;
    const msg = await onConfirm((m) => (err.textContent = m));
    ok.disabled = false;
    if (msg) err.textContent = msg;
  } },
    el("div", { class: "sheet-head" }, el("h2", {}, title), el("button", { class: "iconbtn", type: "button", "aria-label": t("close"), onclick: closeSheet }, "✕")),
    ...nodes, err,
    el("div", { class: "sheet-foot" }, el("button", { class: "btn", type: "button", onclick: closeSheet }, t("cancel")), ok));
  scrim.append(form); $("sheetRoot").append(scrim);
  onKey = (e) => { if (e.key === "Escape") closeSheet(); }; document.addEventListener("keydown", onKey);
}
const field = (label, ...kids) => el("div", { class: "field" }, el("span", {}, label), ...kids);
// Ready: the florist can add a photo of the finished bouquet, which the customer sees on their link.
function readyDialog(o) {
  let setErr;
  const pic = proofPicker(o.bouquet_path, (m) => setErr?.(m), t("bouquetHint"));
  miniSheet(t("readyTitle", { num: o.num }), [field(t("bouquetPhoto"), pic.node)], t("confirmReady"), async (se) => {
    setErr = se;
    const bp = await pic.commit(o.id);
    if (bp !== undefined) {
      const { error } = isStaff() ? await sb.from("cdf_orders").update({ bouquet_path: bp }).eq("id", o.id)
        : await sb.rpc("cdf_set_bouquet", { p_id: o.id, p_path: bp });
      if (error) return t("saveFail", { msg: error.message });
    }
    closeSheet(); await advance(o, 1); loadOrders();
  });
}
function deliverDialog(o) {
  let setErr;
  const proof = proofPicker(o.proof_path, (m) => setErr?.(m));
  const note = el("textarea", { placeholder: t("deliveredNotePh"), style: "min-height:60px" });
  miniSheet(t("deliverTitle", { num: o.num }), [field(t("proofPhoto"), proof.node), field(t("noteOpt"), note)], t("confirmDelivered"), async (se) => {
    setErr = se;
    const extra = {}, pp = await proof.commit(o.id);
    if (pp !== undefined) extra.proof_path = pp;
    if (note.value.trim()) extra.delivery_note = note.value.trim();
    const { error } = await setStep(o.id, "done", extra);
    if (error) return t("saveFail", { msg: error.message });
    closeSheet(); toast(t("deliveredOk")); loadOrders();
  });
}
// Nobody home: photo of the door, a new date and time, and the order goes back to Ready for that day.
// The note is for the customer, so it is written in English.
function missedDialog(o) {
  let setErr;
  const proof = proofPicker(o.proof_path, (m) => setErr?.(m));
  const iDate = el("input", { type: "date", value: addDays(today, 1), min: today, required: true });
  const iSlot = slotPicker(o.slot);
  const note = el("textarea", { placeholder: t("missedNotePh"), style: "min-height:60px" });
  miniSheet(t("missedTitle", { num: o.num }), [
    el("div", { class: "hint" }, t("missedHint")),
    field(t("proofPhoto"), proof.node),
    el("div", { class: "f-row f-when" }, field(t("newDate"), iDate), field(t("newSlot"), iSlot)),
    field(t("noteOpt"), note)], t("confirmMissed"), async (se) => {
    setErr = se;
    const slot = iSlot.value();
    if (!iDate.value || !slot) return t("slotInvalid");
    const at = new Intl.DateTimeFormat("en-PH", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date());
    const when = fromIso(iDate.value).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" });
    const text = note.value.trim() || `We came at ${at} but nobody was home. We'll come back on ${when}, ${slot}.`;
    const pp = await proof.commit(o.id);
    const { error } = await sb.rpc("cdf_reschedule", { p_id: o.id, p_date: iDate.value, p_slot: slot, p_note: text,
      p_proof: pp ?? null, p_set_proof: pp !== undefined });
    if (error) return t("saveFail", { msg: error.message });
    closeSheet(); toast(t("rescheduled", { date: shortDate(iDate.value) })); loadOrders();
  });
}
$("prevM").onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); renderCal(); };
$("nextM").onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); renderCal(); };
$("todayBtn").onclick = () => { S.sel = today; S.month = fromIso(today); S.month.setDate(1); renderOrders(); };
$("newBtn").onclick = () => openFresh(null);
$("q").addEventListener("input", () => renderOrders());
// Ctrl/⌘+K jumps to search
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !$("q").hidden) { e.preventDefault(); $("q").focus(); } });

// ---------- purge delivered ----------
function renderPurge() {
  if (!isAdmin()) return;
  const n = S.orders.filter((o) => o.delivery === "Delivered").length;
  $("purgeBtn").textContent = t("purge", { n });
  $("purgeBtn").disabled = n === 0;
}
$("purgeBtn").onclick = () => {
  const n = S.orders.filter((o) => o.delivery === "Delivered").length;
  $("purgeTxt").textContent = t("purgeAsk", { n });
  $("purgeConfirm").hidden = false;
};
$("purgeNo").onclick = () => ($("purgeConfirm").hidden = true);
$("purgeYes").onclick = async () => {
  const done = S.orders.filter((o) => o.delivery === "Delivered");
  // Rows first: if that fails, every order keeps its photos
  const { error } = await sb.from("cdf_orders").delete().in("id", done.map((o) => o.id));
  $("purgeConfirm").hidden = true;
  if (error) { toast(t("purgeFail")); return; }
  await removeFiles(done);
  toast(t("purged", { n: done.length })); loadOrders();
};

async function removeFiles(orders) {
  const shots = orders.map((o) => o.photo_path).filter(Boolean);
  const pics = orders.flatMap((o) => [o.proof_path, o.bouquet_path]).filter(Boolean);
  if (shots.length) await sb.storage.from(bucket).remove(shots);
  if (pics.length) await sb.storage.from(ENTREGAS).remove(pics);
}

// ---------- photo helpers ----------
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?|jfif)$/i;
const isImage = (f) => f && (f.type.startsWith("image/") || IMAGE_EXT.test(f.name || ""));
const isHeic = (f) => /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name || "");
let heicLib = null;
function loadHeic() {
  // iPhone photos (HEIC) only decode natively in Safari; elsewhere convert them in the browser.
  heicLib ||= new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
    sc.onload = () => res(window.heic2any); sc.onerror = () => { heicLib = null; rej(new Error("heic2any")); };
    document.head.append(sc);
  });
  return heicLib;
}
async function compress(file) {
  try { return await toJpeg(file); } catch (e) {
    if (!isHeic(file)) throw e;
    const heic2any = await loadHeic();
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    return toJpeg(Array.isArray(out) ? out[0] : out);
  }
}
function toJpeg(file) {
  return new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height; const max = 1200;
      if (Math.max(w, h) > max) { const r = max / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
      const c = document.createElement("canvas"); c.width = w; c.height = h; const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h); // white behind transparent PNGs
      URL.revokeObjectURL(u); c.toBlob((b) => (b ? res(b) : rej(new Error("blob"))), "image/jpeg", 0.8);
    };
    img.onerror = () => rej(new Error("img")); img.src = u;
  });
}

const mapsUrl = (a) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a);
const mapLink = (a) => el("a", { href: mapsUrl(a), target: "_blank", rel: "noopener", style: "color:inherit" }, a + " ↗");
function mapHint(input) {
  const a = el("a", { target: "_blank", rel: "noopener", style: "color:inherit" }, t("openMaps"));
  const sync = () => { a.href = mapsUrl(input.value); a.hidden = !input.value.trim(); };
  input.addEventListener("input", sync); sync();
  return a;
}

// ---------- notify the customer ----------
// The customer gets one automatic email when the order goes out (cdf-notify). Anything else goes by WhatsApp,
// opened with the message written; we log that it was opened, since we can't know if it was actually sent.
function notifyMsg(o, name, k) {
  const st = { prep: "msgPrep", ready: "msgReady", transit: "msgTransit", done: "msgDone", fail: "msgFail" }[k] || "msgTransit";
  return tIn("en", st, { name: name ? " " + name : "", num: o.num, link: trackUrl(o) });
}
// Customers are in the Philippines or Spain. Local numbers get their country code (wa.me needs it):
// 0917… / 917… → 63917…, and Spanish 6xx/7xx → 34…
function intlPhone(raw) {
  const d = raw.replace(/[^\d]/g, "");
  if (/^09\d{9}$/.test(d)) return "63" + d.slice(1);
  if (/^9\d{9}$/.test(d)) return "63" + d;
  if (/^[67]\d{8}$/.test(d)) return "34" + d;
  return d;
}
const CH_LABEL = { email: "Email", whatsapp: "WhatsApp", telegram: "Telegram", viber: "Viber", copy: "Copy" };
async function logOpened(o, channel, recipient, label, message) {
  await sb.from("cdf_notifications").insert({ order_id: o.id, audience: "customer", channel, recipient, detail: label, subject: label, message, by_email: S.me.email });
}
function historyBlock(o) {
  const box = el("div", { class: "hist" });
  const load = async () => {
    const { data } = await sb.from("cdf_notifications").select("*").eq("order_id", o.id).order("created_at", { ascending: false }).limit(30);
    box.replaceChildren();
    if (!data?.length) { box.append(el("div", { class: "hint" }, t("histEmpty"))); return; }
    for (const n of data) {
      const when = new Date(n.created_at).toLocaleString(locale(), { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const state = n.channel !== "email" ? t("histOpened") : n.ok ? t("histSent") : t("histFailed");
      // What was notified: the subject (or status) on the line, the full text when opened
      const label = n.ok ? n.detail.replace(/^\w+:\s*/, "") : "";
      const what = n.audience === "vendor" ? n.subject : label ? label.replace(/^automatic, /, t("histAuto") + " · ") : n.subject;
      const err = n.ok ? "" : n.detail;
      box.append(el("details", { class: "hrow" + (n.ok ? "" : " bad") },
        el("summary", {},
          el("span", { class: "hwhen" }, when),
          el("span", { class: "hwho" }, (n.audience === "vendor" ? t("histVendor") : t("histCustomer")) + " · " + CH_LABEL[n.channel] + (n.recipient ? " · " + n.recipient : ""),
            what ? el("b", { class: "hwhat" }, what) : null),
          el("span", { class: "hstate" }, state)),
        el("div", { class: "hmsg" }, n.message || err || t("histNoText"))));
    }
  };
  load();
  box.reload = load;
  return box;
}
// stepK() gives the step the message is about; customers always get English.
function notifyRow(o, name, phone, stepK, hist) {
  const msg = () => notifyMsg(o, name(), stepK());
  const label = () => tIn("en", "st_" + stepK());
  const log = (channel, recipient) => logOpened(o, channel, recipient, label(), msg()).then(() => hist.reload());
  return el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;align-items:center" },
    el("button", { class: "btn", type: "button", onclick: () => {
      if (!phone()) { toast(t("needPhone")); return; }
      window.open("https://wa.me/" + intlPhone(phone()) + "?text=" + encodeURIComponent(msg()), "_blank", "noopener");
      log("whatsapp", phone());
    } }, "WhatsApp"),
    el("button", { class: "btn", type: "button", onclick: () => navigator.clipboard?.writeText(msg()).then(() => { toast(t("msgCopied")); log("copy", ""); }, () => toast(t("selectCopy"))) }, t("copyMsg")));
}

// Bouquet or proof-of-delivery photo: pick/replace/remove, then commit(orderId) uploads it to the order's folder.
// commit returns the new path (or null when removed), or undefined when nothing changed.
function proofPicker(current, onErr, hint = t("proofHint")) {
  let blob = null, removed = false;
  const input = el("input", { type: "file", accept: "image/*,.heic,.heif", hidden: true });
  const box = el("div", { class: "drop" });
  const draw = async () => {
    const src = blob ? URL.createObjectURL(blob) : (!removed && current ? await photoUrl(current, ENTREGAS) : null);
    box.replaceChildren(
      src ? el("img", { src, alt: "" }) : el("div", {}, hint),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;justify-content:center" },
        el("button", { class: "btn", type: "button", onclick: () => input.click() }, src ? t("changePhoto") : t("uploadPhoto")),
        src ? el("button", { class: "btn", type: "button", onclick: () => { blob = null; removed = true; draw(); } }, t("remove")) : null));
  };
  input.addEventListener("change", async () => {
    const file = input.files[0]; if (!file) return;
    if (!isImage(file)) { onErr(t("notImage")); return; }
    try { blob = await compress(file); removed = false; draw(); } catch { onErr(t("readFail")); }
  });
  draw();
  return {
    node: el("div", { style: "display:contents" }, box, input),
    async commit(orderId) {
      if (blob) {
        const path = orderId + "/" + crypto.randomUUID() + ".jpg";
        const up = await sb.storage.from(ENTREGAS).upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) { toast(t("photoUploadFail")); return undefined; }
        if (current) await sb.storage.from(ENTREGAS).remove([current]);
        return path;
      }
      if (removed && current) { await sb.storage.from(ENTREGAS).remove([current]); return null; }
      return undefined;
    },
  };
}

// Time slot: pick "From" (every half hour, on the hour by default); "To" fills itself one hour later.
// Stored as "H:MM - H:MM".
function slotPicker(val) {
  const m = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(val || "");
  const mins = (h, mm) => +h * 60 + +mm;
  const fmt = (n) => Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
  const opts = (sel, from = 0, last = 23 * 60 + 30) => {
    const list = Array.from({ length: 49 }, (_, i) => i * 30).filter((n) => n >= from && n <= last);
    // keep an old value that is not on the half-hour grid
    if (sel != null && !list.includes(sel)) list.push(sel), list.sort((x, y) => x - y);
    return list.map((n) => el("option", { value: String(n), selected: n === sel }, fmt(n).padStart(5, "0")));
  };
  const a0 = m ? mins(m[1], m[2]) : null, z0 = m ? mins(m[3], m[4]) : null;
  const from = el("select", { "aria-label": t("slotFrom") }, el("option", { value: "" }, "--:--"), ...opts(a0));
  const to = el("select", { "aria-label": t("slotTo") }, el("option", { value: "" }, "--:--"), ...opts(z0, 30, 24 * 60));
  from.addEventListener("change", () => {
    if (from.value === "") return;
    const a = +from.value, z = to.value === "" ? -1 : +to.value;
    if (z <= a) to.replaceChildren(el("option", { value: "" }, "--:--"), ...opts(Math.min(a + 60, 24 * 60), 30, 24 * 60));
  });
  const box = el("div", { class: "slot-pick" }, from, el("span", {}, "→"), to);
  box.first = from;
  box.value = () => {
    if (from.value === "" || to.value === "" || +to.value <= +from.value) return "";
    return fmt(+from.value) + " - " + fmt(+to.value);
  };
  return box;
}

// ---------- sheet ----------
let onPaste = null, onKey = null;
function closeSheet() {
  $("sheetRoot").replaceChildren();
  delete S.openOrder;
  if (onPaste) document.removeEventListener("paste", onPaste);
  if (onKey) document.removeEventListener("keydown", onKey);
  onPaste = onKey = null;
}
// Re-read the team first so the vendor list never holds an email that was changed in the meantime
async function openFresh(o) {
  if (isStaff()) await loadMembers();
  openSheet(o);
}
function openSheet(o) {
  closeSheet();
  S.openOrder = o;
  const scrim = el("div", { class: "scrim", onclick: (e) => { if (e.target === scrim) closeSheet(); } });
  const sheet = el("div", { class: "sheet", role: "dialog", "aria-modal": "true" });
  scrim.append(sheet); $("sheetRoot").append(scrim);
  onKey = (e) => { if (e.key === "Escape") closeSheet(); }; document.addEventListener("keydown", onKey);
  const closeBtn = () => el("button", { class: "iconbtn", type: "button", "aria-label": t("close"), onclick: closeSheet }, "✕");

  if (!isStaff()) {
    // Florists and drivers: the order to read, WhatsApp to the customer and the history.
    // Status changes happen on the card buttons.
    const hist = historyBlock(o);
    const cur = stepOf(o);
    sheet.append(
      el("div", { class: "sheet-head" }, el("h2", {}, t("order", { num: o.num })), closeBtn()),
      el("dl", { class: "ro" },
        el("dt", {}, t("status")), el("dd", {}, el("span", { class: "pill s-" + STEPS[cur].k }, stepName(cur))),
        el("dt", {}, t("dateSlot")), el("dd", {}, longDate(o.date) + " · " + o.slot),
        el("dt", {}, t("recipient")), el("dd", {}, o.customer_name || t("noName")),
        el("dt", {}, t("address")), el("dd", {}, o.address ? mapLink(o.address) : t("noAddress")),
        o.customer_phone ? [el("dt", {}, t("phoneShort")), el("dd", {}, el("a", { href: "tel:+" + intlPhone(o.customer_phone), style: "color:inherit" }, o.customer_phone))] : null,
        o.card_message ? [el("dt", {}, t("cardMsg")), el("dd", { class: "note" }, o.card_message)] : null,
        el("dt", {}, t("note")), el("dd", { class: "note" }, o.notes || t("noNotes")),
        el("dt", {}, t("photo")), el("dd", {}, o.photo_path ? imgOf(o.photo_path, bucket, t("photoAlt")) : t("noPhoto")),
        o.bouquet_path ? [el("dt", {}, t("bouquetPhoto")), el("dd", {}, imgOf(o.bouquet_path, ENTREGAS, t("bouquetPhoto")))] : null,
        o.delivery_note ? [el("dt", {}, t("deliveryNote")), el("dd", { class: "note" }, o.delivery_note)] : null,
        o.proof_path ? [el("dt", {}, t("proofPhoto")), el("dd", {}, imgOf(o.proof_path, ENTREGAS, t("proofPhoto")))] : null),
      el("div", { class: "field" }, el("span", {}, t("notifyBuyer")),
        notifyRow(o, () => o.buyer_name || o.customer_name || "", () => o.buyer_phone || o.customer_phone || "", () => STEPS[stepOf(o)].k, hist)),
      el("details", { class: "deliv" }, el("summary", {}, t("history")), hist),
      el("div", { class: "sheet-foot" }, el("span"), el("button", { class: "btn", type: "button", onclick: closeSheet }, t("close"))));
    return;
  }

  const isNew = !o;
  const nextNum = String(Math.max(0, ...S.orders.map((x) => parseInt(x.num, 10) || 0)) + 1).padStart(4, "0");
  const f = o ? { ...o } : { num: nextNum, date: S.sel, slot: "", channel: "", vendor_email: S.members.find((m) => m.role === "vendor")?.email || "", customer_name: "", address: "", customer_phone: "", customer_email: "", buyer_name: "", buyer_phone: "", card_message: "", delivery_note: "", proof_path: null, bouquet_path: null, notes: "", status: "Preparing", delivery: "-", photo_path: null };
  let photoBlob = null, photoRemoved = false;
  const sel = (id, opts, val) => el("select", { id }, ...opts.map(([v, l]) => el("option", { value: v, selected: v === val }, l)));
  const iDate = el("input", { type: "date", id: "f-date", value: f.date, required: true });
  const iSlot = slotPicker(f.slot);
  const iNum = el("input", { id: "f-num", value: f.num, inputmode: "numeric", style: "font-family:var(--f-mono)", required: true });
  const iChan = sel("f-chan", [["", t("noChannel")], ...CHANNELS.map((c) => [c[0], c[0]])], f.channel);
  const iName = el("input", { id: "f-name", value: f.customer_name || "", placeholder: t("namePh"), autocomplete: "off" });
  const iAddr = el("input", { id: "f-addr", value: f.address || "", placeholder: t("addrPh"), autocomplete: "off" });
  const iPhone = el("input", { id: "f-phone", type: "tel", value: f.customer_phone || "", placeholder: "0917 123 4567 · +34 600…", autocomplete: "off" });
  const iEmail = el("input", { id: "f-email", type: "email", value: f.customer_email || "", placeholder: "cliente@email.com", autocomplete: "off" });
  const iBName = el("input", { id: "f-bname", value: f.buyer_name || "", placeholder: t("buyerNamePh"), autocomplete: "off" });
  const iBPhone = el("input", { id: "f-bphone", type: "tel", value: f.buyer_phone || "", placeholder: "0917 123 4567 · +34 600…", autocomplete: "off" });
  // Not a gift: the buyer is the recipient, so their name and phone are only asked once
  const same = !isNew && (!f.buyer_name || (f.buyer_name === f.customer_name && (f.buyer_phone || "") === (f.customer_phone || "")));
  if (same && !f.buyer_name) { iBName.value = f.customer_name || ""; iBPhone.value = f.customer_phone || ""; }
  const iSame = el("input", { type: "checkbox", id: "f-same", checked: same });
  const iCard = el("textarea", { id: "f-card", placeholder: t("cardPh"), style: "min-height:56px" }, f.card_message || "");
  const bouquet = proofPicker(f.bouquet_path, (m) => (err.textContent = m), t("bouquetHint"));
  const iDNote = el("textarea", { id: "f-dnote", placeholder: t("deliveryNotePh"), style: "min-height:60px" }, f.delivery_note || "");
  const proof = proofPicker(f.proof_path, (m) => (err.textContent = m));
  const hist = isNew ? null : historyBlock(o);
  const iNotes = el("textarea", { id: "f-notes", placeholder: t("notesPh") }, f.notes);
  const iVend = sel("f-vendor", [["", t("unassigned")], ...S.members.filter((m) => m.role !== "carrier").map((m) => [m.email, m.name + (m.role !== "vendor" ? " (" + t("role_" + m.role) + ")" : "")])], f.vendor_email || "");
  const iStatus = sel("f-status", STEPS.map((s, i) => [s.k, stepName(i)]), STEPS[stepOf(f)].k);
  const fileIn = el("input", { type: "file", accept: "image/*,.heic,.heif", id: "f-file", hidden: true });
  const drop = el("div", { class: "drop" });
  const err = el("div", { class: "err", role: "alert" });
  let preview = null;
  const drawDrop = async () => {
    if (photoBlob) { if (preview) URL.revokeObjectURL(preview); preview = URL.createObjectURL(photoBlob); }
    const src = photoBlob ? preview : (!photoRemoved && f.photo_path ? await photoUrl(f.photo_path) : null);
    drop.replaceChildren(
      src ? el("img", { src, alt: t("photoAlt") }) : el("div", {}, t("pasteHint")),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;justify-content:center" },
        el("button", { class: "btn", type: "button", onclick: () => fileIn.click() }, src ? t("changePhoto") : t("uploadPhoto")),
        src ? el("button", { class: "btn", type: "button", onclick: () => { photoBlob = null; photoRemoved = true; drawDrop(); } }, t("remove")) : null));
  };
  const take = async (file) => {
    if (!file) return;
    if (!isImage(file)) { err.textContent = t("notImage"); return; }
    err.textContent = ""; if (isHeic(file)) toast(t("converting"));
    try { photoBlob = await compress(file); photoRemoved = false; drawDrop(); } catch { err.textContent = t("readFail"); }
  };
  fileIn.addEventListener("change", () => take(fileIn.files[0]));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); take(e.dataTransfer.files[0]); });
  onPaste = (e) => { const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/")); if (it) { e.preventDefault(); take(it.getAsFile()); } };
  document.addEventListener("paste", onPaste);
  drawDrop();

  const linkBlock = isNew ? el("div", { class: "hint" }, t("linkAfterSave")) : (() => {
    const li = el("input", { id: "f-link", readonly: true, value: trackUrl(o), onfocus: (e) => e.target.select() });
    return el("div", { class: "link-row" }, li,
      el("button", { class: "btn", type: "button", onclick: () => {
        navigator.clipboard?.writeText(li.value).then(() => toast(t("copied")), () => { li.focus(); li.select(); toast(t("selectCopy")); });
      } }, t("copy")),
      el("a", { class: "btn", href: trackUrl(o), target: "_blank", rel: "noopener", style: "text-decoration:none;color:inherit" }, t("view")));
  })();

  const saveBtn = el("button", { class: "btn primary", type: "submit" }, t("save"));
  const confirmBox = el("div", { class: "confirm", hidden: true }, t("askDelete", { num: f.num }),
    el("div", {},
      el("button", { class: "btn danger", type: "button", onclick: async () => {
        const { error } = await sb.from("cdf_orders").delete().eq("id", o.id);
        if (error) { toast(t("deleteFail")); return; }
        await removeFiles([o]);
        closeSheet(); toast(t("deleted")); loadOrders();
      } }, t("yesDelete")),
      el("button", { class: "btn", type: "button", onclick: () => (confirmBox.hidden = true) }, t("cancel"))));

  const syncSame = () => { const r = sheet.querySelector(".recip"); if (r) r.hidden = iSame.checked; };
  iSame.addEventListener("change", syncSame);
  const form = el("form", { style: "display:contents", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    // Required: number, date, time, buyer name + (phone or email), recipient name, phone and address
    for (const x of sheet.querySelectorAll(".missing")) x.classList.remove("missing");
    const need = [[iNum, iNum.value.trim()], [iDate, iDate.value], [iSlot, iSlot.value()], [iBName, iBName.value.trim()],
      // not a gift: the driver calls the buyer, so the phone is needed
      [iBPhone, iSame.checked ? iBPhone.value.trim() : iBPhone.value.trim() || iEmail.value.trim()], [iAddr, iAddr.value.trim()]];
    if (!iSame.checked) need.push([iName, iName.value.trim()], [iPhone, iPhone.value.trim()]);
    const miss = need.filter(([, v]) => !v).map(([x]) => x.closest(".field"));
    if (miss.length) {
      miss.forEach((x) => x.classList.add("missing"));
      miss[0].scrollIntoView({ block: "center", behavior: "smooth" });
      err.textContent = iSlot.closest(".field").classList.contains("missing") && iSlot.first.value ? t("slotInvalid") : t("fillRequired");
      return;
    }
    if (iSame.checked) { iName.value = iBName.value.trim(); iPhone.value = iBPhone.value.trim(); }
    const st = STEPS.find((s) => s.k === iStatus.value);
    const row = { num: iNum.value.trim(), date: iDate.value, slot: iSlot.value(), channel: iChan.value, vendor_email: iVend.value || null,
 customer_name: iName.value.trim(), address: iAddr.value.trim(),
      customer_phone: iPhone.value.trim(), customer_email: iEmail.value.trim(), buyer_name: iBName.value.trim(), buyer_phone: iBPhone.value.trim(),
      card_message: iCard.value.trim(), delivery_note: iDNote.value.trim(),
      notes: iNotes.value.trim(), status: st.status, delivery: st.delivery };
    saveBtn.disabled = true;
    let saved, error;
    if (isNew) ({ data: saved, error } = await sb.from("cdf_orders").insert(row).select().single());
    else ({ data: saved, error } = await sb.from("cdf_orders").update(row).eq("id", o.id).select().single());
    if (error) { saveBtn.disabled = false; err.textContent = error.code === "23505" ? t("dupNum", { num: row.num }) : t("saveFail", { msg: error.message }); return; }
    if (photoBlob) {
      const path = saved.id + ".jpg";
      const up = await sb.storage.from(bucket).upload(path, photoBlob, { upsert: true, contentType: "image/jpeg" });
      if (up.error) toast(t("photoUploadFail"));
      else { delete S.photoUrls[bucket + "/" + path]; await sb.from("cdf_orders").update({ photo_path: path }).eq("id", saved.id); }
    } else if (photoRemoved && f.photo_path) {
      await sb.storage.from(bucket).remove([f.photo_path]);
      await sb.from("cdf_orders").update({ photo_path: null }).eq("id", saved.id);
    }
    const pp = await proof.commit(saved.id), bp = await bouquet.commit(saved.id), pics = {};
    if (pp !== undefined) pics.proof_path = pp;
    if (bp !== undefined) pics.bouquet_path = bp;
    if (Object.keys(pics).length) await sb.from("cdf_orders").update(pics).eq("id", saved.id);
    S.sel = row.date; S.month = fromIso(row.date); S.month.setDate(1);
    closeSheet(); toast(t(isNew ? "created" : "saved")); loadOrders();
  } },
    el("div", { class: "sheet-head" }, el("h2", {}, isNew ? t("newOrderTitle") : t("editOrder", { num: f.num })), closeBtn()),
    el("div", { class: "f-row f-when" }, el("label", { class: "field req" }, el("span", {}, t("date")), iDate), el("div", { class: "field req" }, el("span", {}, t("slot")), iSlot)),
    el("div", { class: "f-row" }, el("label", { class: "field req" }, el("span", {}, t("orderNum")), iNum), el("label", { class: "field" }, el("span", {}, t("vendor")), iVend)),
    el("div", { class: "group" }, el("h3", {}, t("buyerH")), el("div", { class: "hint" }, t("buyerHint")),
      el("div", { class: "f-row" }, el("label", { class: "field req" }, el("span", {}, t("name")), iBName),
        el("label", { class: "field req-or" }, el("span", {}, t("phone")), iBPhone)),
      el("label", { class: "field req-or" }, el("span", {}, t("email")), iEmail)),
    el("div", { class: "group" }, el("h3", {}, t("recipientH")),
      el("label", { class: "check" }, iSame, el("span", {}, t("sameAsBuyer"))),
      el("div", { class: "f-row recip" }, el("label", { class: "field req" }, el("span", {}, t("customerName")), iName),
        el("label", { class: "field req" }, el("span", {}, t("phone")), iPhone)),
      el("div", { class: "field req" }, el("span", {}, t("deliveryAddr")), iAddr, el("div", { class: "hint" }, mapHint(iAddr))),
      el("label", { class: "field" }, el("span", {}, t("cardMsg")), iCard)),
    el("div", { class: "field" }, el("span", {}, t("photo")), drop, fileIn),
    isNew ? null : el("label", { class: "field" }, el("span", {}, t("status")), iStatus),
    isNew ? null : el("div", { class: "field" }, el("span", {}, t("customerLink")), linkBlock,
      notifyRow(o, () => iBName.value.trim() || iName.value.trim(), () => iBPhone.value.trim() || iPhone.value.trim(), () => iStatus.value, hist)),
    el("details", { class: "deliv", open: !!(f.notes || f.channel || f.delivery_note || f.proof_path || f.bouquet_path) || null },
      el("summary", {}, t("moreDetails")),
      el("label", { class: "field" }, el("span", {}, t("channel")), iChan),
      el("label", { class: "field" }, el("span", {}, t("note")), iNotes),
      el("div", { class: "field" }, el("span", {}, t("bouquetPhoto")), bouquet.node),
      el("label", { class: "field" }, el("span", {}, t("deliveryNote")), iDNote, el("div", { class: "hint" }, t("deliveryNoteHint"))),
      el("div", { class: "field" }, el("span", {}, t("proofPhoto")), proof.node)),
    isNew ? null : el("details", { class: "deliv" }, el("summary", {}, t("history")), hist),
    err, confirmBox,
    el("div", { class: "sheet-foot" }, isNew || !isAdmin() ? el("span") : el("button", { class: "btn danger", type: "button", onclick: () => (confirmBox.hidden = false) }, t("delete")), saveBtn));
  sheet.append(form);
  syncSame();
  // A filled field clears its red mark
  sheet.addEventListener("input", (e) => e.target.closest(".field")?.classList.remove("missing"));
  sheet.addEventListener("change", (e) => e.target.closest(".field")?.classList.remove("missing"));
}

// ---------- team ----------
function renderTeam() {
  const box = $("team"); box.replaceChildren();
  for (const m of S.members) {
    const self = m.email === S.me.email;
    box.append(el("div", { class: "member" },
      el("div", {}, el("b", {}, m.name, el("span", { class: "role-tag" }, t("role_" + m.role))), el("small", {}, m.email)),
      self ? el("span", { class: "hint" }, t("you")) : el("button", { class: "btn ghost", onclick: async (e) => {
        const b = e.currentTarget;
        if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = t("confirmRemove"); b.classList.add("danger"); return; }
        b.disabled = true;
        const { data, error } = await sb.functions.invoke("cdf-users", { body: { action: "remove", email: m.email } });
        if (error || data?.error) { b.disabled = false; toast(data?.error || t("removeFail")); return; }
        toast(t("removed", { name: m.name })); await loadMembers(); renderTeam();
      } }, t("remove"))));
  }
}
$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault(); $("aErr").textContent = ""; $("aBtn").disabled = true;
  const body = { action: "add", name: $("aName").value.trim(), email: $("aEmail").value.trim(), role: $("aRole").value, password: $("aPass").value };
  const { data, error } = await sb.functions.invoke("cdf-users", { body });
  $("aBtn").disabled = false;
  let msg = data?.error;
  if (error && !msg) { try { msg = (await error.context.json()).error; } catch { msg = t("addFail"); } }
  if (msg) { $("aErr").textContent = msg; return; }
  toast(t(data.existed ? "addedExisting" : "added", { name: body.name }));
  e.target.reset(); await loadMembers(); renderTeam();
});
