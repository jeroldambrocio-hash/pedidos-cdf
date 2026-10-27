const { url, anonKey, bucket } = window.CDF_CONFIG;
const sb = supabase.createClient(url, anonKey);

const SLOTS = ["8:00 - 12:00", "12:00 - 16:00", "16:00 - 20:00"];
const CHANNELS = [["Shopify", "--ch-shopify"], ["TikTok", "--ch-tiktok"], ["Instagram", "--ch-instagram"], ["Web", "--ch-web"]];
// One pipeline drives both stored fields: status (Preparing/Ready) and delivery (-/In transit/Delivered).
const STEPS = [
  { k: "prep", label: "Preparing", status: "Preparing", delivery: "-" },
  { k: "ready", label: "Ready", status: "Ready", delivery: "-" },
  { k: "transit", label: "In transit", status: "Ready", delivery: "In transit" },
  { k: "done", label: "Delivered", status: "Ready", delivery: "Delivered" },
  { k: "fail", label: "Failed", status: "Ready", delivery: "Failed" }, // attempted, nobody home
];
const stepOf = (o) => (o.delivery === "Failed" ? 4 : o.delivery === "Delivered" ? 3 : o.delivery === "In transit" ? 2 : o.status === "Ready" ? 1 : 0);
const proofUrl = (path) => url + "/storage/v1/object/public/cdf-entregas/" + path;

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

const today = iso(new Date());
const S = { me: null, filter: null, tab: "orders", sel: today, month: new Date(), orders: [], members: [], photoUrls: {}, channel: null };
S.month = new Date(S.month.getFullYear(), S.month.getMonth(), 1);
const isAdmin = () => S.me?.role === "admin";

function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600); }
function show(view) { for (const v of ["login", "noaccess", "ordersView", "teamView"]) $(v).hidden = v !== view; }

// ---------- auth ----------
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault(); $("lErr").textContent = ""; $("lBtn").disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim(), password: $("lPass").value });
  $("lBtn").disabled = false;
  if (error) $("lErr").textContent = /invalid/i.test(error.message) ? t("badLogin") : error.message;
});
$("logout").onclick = async () => { await sb.auth.signOut(); };

let booted;
sb.auth.onAuthStateChange((_ev, session) => {
  const id = session?.user?.id || null;
  if (id === booted) return;
  booted = id;
  setTimeout(() => (id ? start(session.user) : stop()), 0);
});

function stop() {
  S.me = null; S.orders = []; S.photoUrls = {};
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  $("hright").hidden = true; $("sub").textContent = t("signIn");
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
  renderSub();
  $("tabs").hidden = !isAdmin();
  $("newBtn").hidden = !isAdmin();
  $("adminTools").hidden = !isAdmin();
  if (isAdmin()) await loadMembers();
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
  $("sub").textContent = t(isAdmin() ? "subAdmin" : "subVendor", { name: S.me.name });
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
  renderCal(); renderDay(); renderPurge();
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
      onclick: () => { S.sel = k; S.filter = null; S.month = new Date(d.getFullYear(), d.getMonth(), 1); renderOrders(); },
    }, String(d.getDate()), dots));
  }
}
function chanChip(c) { if (!c) return null; const v = (CHANNELS.find((x) => x[0] === c) || [c, "--muted"])[1]; return el("span", { class: "chan", style: "color:var(" + v + ")" }, c); }
function stepper(o, editable) {
  const cur = stepOf(o), w = el("div", { class: "steps" });
  STEPS.forEach((s, i) => w.append(el("button", {
    class: "step s-" + s.k + (i === cur ? " on" : i < cur ? " past" : ""), disabled: !editable, "aria-pressed": String(i === cur),
    onclick: async (e) => {
      e.stopPropagation(); if (!editable || i === cur) return;
      const prev = { status: o.status, delivery: o.delivery };
      Object.assign(o, { status: s.status, delivery: s.delivery }); renderOrders();
      const { error } = await sb.from("cdf_orders").update({ status: s.status, delivery: s.delivery }).eq("id", o.id);
      if (error) { Object.assign(o, prev); renderOrders(); toast(t("statusFail")); }
    },
  }, s.label)));
  return w;
}
async function photoUrl(path) {
  if (!path) return null;
  if (S.photoUrls[path]) return S.photoUrls[path];
  const { data } = await sb.storage.from(bucket).createSignedUrl(path, 3600);
  if (data?.signedUrl) S.photoUrls[path] = data.signedUrl;
  return S.photoUrls[path] || null;
}
function renderDay() {
  $("dLabel").textContent = cap(fromIso(S.sel).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" }));
  const all = S.orders.filter((o) => o.date === S.sel).sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || a.num.localeCompare(b.num));
  $("dSub").textContent = all.length ? (all.length === 1 ? t("oneOrder") : t("nOrders", { n: all.length })) : "";
  // Tally chips double as filters: a step, or "pending" (everything not delivered yet).
  const match = (o) => S.filter == null ? true : S.filter === "pending" ? stepOf(o) !== 3 : stepOf(o) === S.filter;
  const tally = $("tally"); tally.replaceChildren();
  const chip = (key, label, n, style) => tally.append(el("button", { class: "chip" + (S.filter === key ? " on" : ""), type: "button", style,
    "aria-pressed": String(S.filter === key), disabled: !n && S.filter !== key, onclick: () => { S.filter = S.filter === key ? null : key; renderDay(); } }, n + " " + label));
  if (all.length) {
    chip("pending", t("pending"), all.filter((o) => stepOf(o) !== 3).length, "background:var(--petal-soft);color:var(--petal)");
    STEPS.forEach((s, i) => chip(i, s.label, all.filter((o) => stepOf(o) === i).length, "background:var(--st-" + s.k + "-bg);color:var(--st-" + s.k + ")"));
  }
  const list = all.filter(match);
  const box = $("list"); box.replaceChildren();
  if (!all.length) {
    box.append(el("div", { class: "empty" }, el("b", {}, t("noOrdersDay")), isAdmin() ? t("emptyAdmin") : t("emptyVendor")));
    return;
  }
  if (!list.length) { box.append(el("div", { class: "empty" }, el("b", {}, t("noneFiltered")), el("button", { class: "btn", type: "button", onclick: () => { S.filter = null; renderDay(); } }, t("showAll")))); return; }
  for (const slot of SLOTS) {
    const os = list.filter((o) => o.slot === slot); if (!os.length) continue;
    const g = el("div", { class: "orders" });
    for (const o of os) {
      const th = el("div", { class: "thumb" }, o.photo_path ? "" : t("noPhotoShort"));
      if (o.photo_path) photoUrl(o.photo_path).then((u) => { if (u) th.replaceChildren(el("img", { src: u, alt: "" })); });
      g.append(el("div", { class: "order", role: "button", tabindex: "0", onclick: () => openSheet(o), onkeydown: (e) => { if (e.key === "Enter") openSheet(o); } },
        th,
        el("div", { class: "o-main" },
          el("div", { class: "o-top" }, el("span", { class: "num" }, "#" + o.num), chanChip(o.channel)),
          el("div", { class: "o-sub" }, [o.customer_name, isAdmin() ? memberName(o.vendor_email) : null, o.address || o.notes || t("noAddress")].filter(Boolean).join(" · "))),
        stepper(o, isAdmin())));
    }
    box.append(el("section", { class: "slot" }, el("h3", {}, slot), g));
  }
}
$("prevM").onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); renderCal(); };
$("nextM").onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); renderCal(); };
$("todayBtn").onclick = () => { S.sel = today; S.filter = null; S.month = new Date(); S.month.setDate(1); renderOrders(); };
$("newBtn").onclick = () => openSheet(null);

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
  const paths = done.map((o) => o.photo_path).filter(Boolean);
  if (paths.length) await sb.storage.from(bucket).remove(paths);
  const proofs = done.map((o) => o.proof_path).filter(Boolean);
  if (proofs.length) await sb.storage.from("cdf-entregas").remove(proofs);
  const { error } = await sb.from("cdf_orders").delete().in("id", done.map((o) => o.id));
  $("purgeConfirm").hidden = true;
  if (error) toast(t("purgeFail")); else { toast(t("purged", { n: done.length })); loadOrders(); }
};

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

// ---------- notify the customer (opens the app with the message written; nothing is sent automatically) ----------
function notifyMsg(o, name, label) {
  const st = { "Preparing": "msgPrep", "Ready": "msgReady", "In transit": "msgTransit", "Delivered": "msgDone", "Failed": "msgFail" }[label] || "msgTransit";
  return t(st, { name: name ? " " + name : "", num: o.num, link: trackUrl(o) });
}
function notifyRow(o, iName, iPhone, iEmail, iStatus) {
  const msg = () => notifyMsg(o, iName.value.trim(), iStatus.value);
  const digits = () => iPhone.value.replace(/[^\d]/g, "");
  const open = (href) => window.open(href, "_blank", "noopener");
  const b = (label, fn) => el("button", { class: "btn", type: "button", onclick: fn }, label);
  return el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" },
    b("WhatsApp", () => open("https://wa.me/" + digits() + "?text=" + encodeURIComponent(msg()))),
    b("Telegram", () => open("https://t.me/share/url?url=" + encodeURIComponent(trackUrl(o)) + "&text=" + encodeURIComponent(msg().replace(trackUrl(o), "").trim()))),
    b("Viber", () => (location.href = "viber://forward?text=" + encodeURIComponent(msg()))),
    b("Email", () => {
      if (!iEmail.value.trim()) { toast(t("needEmail")); return; }
      location.href = "mailto:" + iEmail.value.trim() + "?subject=" + encodeURIComponent(t("mailSubject", { num: o.num })) + "&body=" + encodeURIComponent(msg());
    }),
    b(t("copyMsg"), () => navigator.clipboard?.writeText(msg()).then(() => toast(t("msgCopied")), () => toast(t("selectCopy")))));
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
function openSheet(o) {
  closeSheet();
  S.openOrder = o;
  const scrim = el("div", { class: "scrim", onclick: (e) => { if (e.target === scrim) closeSheet(); } });
  const sheet = el("div", { class: "sheet", role: "dialog", "aria-modal": "true" });
  scrim.append(sheet); $("sheetRoot").append(scrim);
  onKey = (e) => { if (e.key === "Escape") closeSheet(); }; document.addEventListener("keydown", onKey);
  const closeBtn = () => el("button", { class: "iconbtn", type: "button", "aria-label": t("close"), onclick: closeSheet }, "✕");

  if (!isAdmin()) {
    const ph = el("div", { class: "drop" }, o.photo_path ? t("loadingPhoto") : t("noPhoto"));
    if (o.photo_path) photoUrl(o.photo_path).then((u) => ph.replaceChildren(u ? el("img", { src: u, alt: t("photoAlt") + " " + o.num }) : t("photoFail")));
    sheet.append(el("div", { class: "sheet-head" }, el("h2", {}, t("order", { num: o.num })), closeBtn()),
      el("dl", { class: "ro" },
        el("dt", {}, t("dateSlot")), el("dd", {}, cap(fromIso(o.date).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })) + " · " + o.slot),
        el("dt", {}, t("customer")), el("dd", {}, o.customer_name || t("noName")),
        el("dt", {}, t("address")), el("dd", {}, o.address ? mapLink(o.address) : t("noAddress")),
        el("dt", {}, t("channel")), el("dd", {}, chanChip(o.channel) || t("noChannel")),
        el("dt", {}, t("note")), el("dd", { class: "note" }, o.notes || t("noNotes")),
        el("dt", {}, t("photo")), el("dd", {}, ph),
        el("dt", {}, t("status")), el("dd", {}, stepper(o, false)),
        o.delivery_note ? [el("dt", {}, t("deliveryNote")), el("dd", { class: "note" }, o.delivery_note)] : null,
        o.proof_path ? [el("dt", {}, t("proofPhoto")), el("dd", {}, el("img", { src: proofUrl(o.proof_path), alt: t("proofPhoto"), style: "border-radius:8px;max-height:220px" }))] : null));
    return;
  }

  const isNew = !o;
  const nextNum = String(Math.max(0, ...S.orders.map((x) => parseInt(x.num, 10) || 0)) + 1).padStart(4, "0");
  const f = o ? { ...o } : { num: nextNum, date: S.sel, slot: SLOTS[0], channel: "", vendor_email: S.members.find((m) => m.role === "vendor")?.email || "", customer_name: "", address: "", customer_phone: "", customer_email: "", delivery_note: "", proof_path: null, notes: "", status: "Preparing", delivery: "-", photo_path: null };
  let photoBlob = null, photoRemoved = false;
  const sel = (id, opts, val) => el("select", { id }, ...opts.map(([v, l]) => el("option", { value: v, selected: v === val }, l)));
  const iDate = el("input", { type: "date", id: "f-date", value: f.date, required: true });
  const iSlot = sel("f-slot", SLOTS.map((s) => [s, s]), f.slot);
  const iNum = el("input", { id: "f-num", value: f.num, inputmode: "numeric", style: "font-family:var(--f-mono)", required: true });
  const iChan = sel("f-chan", [["", t("noChannel")], ...CHANNELS.map((c) => [c[0], c[0]])], f.channel);
  const iName = el("input", { id: "f-name", value: f.customer_name || "", placeholder: t("namePh"), autocomplete: "off" });
  const iAddr = el("input", { id: "f-addr", value: f.address || "", placeholder: t("addrPh"), autocomplete: "off" });
  const iPhone = el("input", { id: "f-phone", type: "tel", value: f.customer_phone || "", placeholder: "+34 600 000 000", autocomplete: "off" });
  const iEmail = el("input", { id: "f-email", type: "email", value: f.customer_email || "", placeholder: "cliente@email.com", autocomplete: "off" });
  const iDNote = el("textarea", { id: "f-dnote", placeholder: t("deliveryNotePh"), style: "min-height:60px" }, f.delivery_note || "");
  let proofBlob = null, proofRemoved = false;
  const proofIn = el("input", { type: "file", accept: "image/*,.heic,.heif", id: "f-proof", hidden: true });
  const proofBox = el("div", { class: "drop" });
  const drawProof = () => {
    const src = proofBlob ? URL.createObjectURL(proofBlob) : (!proofRemoved && f.proof_path ? proofUrl(f.proof_path) : null);
    proofBox.replaceChildren(
      src ? el("img", { src, alt: t("proofPhoto") }) : el("div", {}, t("proofHint")),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;justify-content:center" },
        el("button", { class: "btn", type: "button", onclick: () => proofIn.click() }, src ? t("changePhoto") : t("uploadPhoto")),
        src ? el("button", { class: "btn", type: "button", onclick: () => { proofBlob = null; proofRemoved = true; drawProof(); } }, t("remove")) : null));
  };
  proofIn.addEventListener("change", async () => {
    const file = proofIn.files[0]; if (!file) return;
    if (!isImage(file)) { err.textContent = t("notImage"); return; }
    try { proofBlob = await compress(file); proofRemoved = false; drawProof(); } catch { err.textContent = t("readFail"); }
  });
  drawProof();
  const iNotes = el("textarea", { id: "f-notes", placeholder: t("notesPh") }, f.notes);
  const iVend = sel("f-vendor", [["", t("unassigned")], ...S.members.map((m) => [m.email, m.name + (m.role === "admin" ? " (admin)" : "")])], f.vendor_email || "");
  const iStatus = sel("f-status", STEPS.map((s) => [s.label, s.label]), STEPS[stepOf(f)].label);
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
        if (o.photo_path) await sb.storage.from(bucket).remove([o.photo_path]);
        const { error } = await sb.from("cdf_orders").delete().eq("id", o.id);
        if (error) { toast(t("deleteFail")); return; }
        closeSheet(); toast(t("deleted")); loadOrders();
      } }, t("yesDelete")),
      el("button", { class: "btn", type: "button", onclick: () => (confirmBox.hidden = true) }, t("cancel"))));

  const form = el("form", { style: "display:contents", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    const st = STEPS.find((s) => s.label === iStatus.value);
    const row = { num: iNum.value.trim(), date: iDate.value, slot: iSlot.value, channel: iChan.value, vendor_email: iVend.value || null,
 customer_name: iName.value.trim(), address: iAddr.value.trim(),
      customer_phone: iPhone.value.trim(), customer_email: iEmail.value.trim(), delivery_note: iDNote.value.trim(),
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
      else { delete S.photoUrls[path]; await sb.from("cdf_orders").update({ photo_path: path }).eq("id", saved.id); }
    } else if (photoRemoved && f.photo_path) {
      await sb.storage.from(bucket).remove([f.photo_path]);
      await sb.from("cdf_orders").update({ photo_path: null }).eq("id", saved.id);
    }
    if (proofBlob) {
      const ppath = saved.id + "/" + crypto.randomUUID() + ".jpg";
      const up = await sb.storage.from("cdf-entregas").upload(ppath, proofBlob, { contentType: "image/jpeg" });
      if (up.error) toast(t("photoUploadFail"));
      else { if (f.proof_path) await sb.storage.from("cdf-entregas").remove([f.proof_path]); await sb.from("cdf_orders").update({ proof_path: ppath }).eq("id", saved.id); }
    } else if (proofRemoved && f.proof_path) {
      await sb.storage.from("cdf-entregas").remove([f.proof_path]);
      await sb.from("cdf_orders").update({ proof_path: null }).eq("id", saved.id);
    }
    S.sel = row.date; S.month = fromIso(row.date); S.month.setDate(1);
    S.filter = null;
    closeSheet(); toast(t(isNew ? "created" : "saved")); loadOrders();
  } },
    el("div", { class: "sheet-head" }, el("h2", {}, isNew ? t("newOrderTitle") : t("editOrder", { num: f.num })), closeBtn()),
    el("div", { class: "f-row" }, el("label", { class: "field" }, el("span", {}, t("date")), iDate), el("label", { class: "field" }, el("span", {}, t("slot")), iSlot)),
    el("div", { class: "f-row" }, el("label", { class: "field" }, el("span", {}, t("orderNum")), iNum), el("label", { class: "field" }, el("span", {}, t("channel")), iChan)),
    el("label", { class: "field" }, el("span", {}, t("customerName")), iName),
    el("div", { class: "field" }, el("span", {}, t("deliveryAddr")), iAddr, el("div", { class: "hint" }, mapHint(iAddr))),
    el("div", { class: "f-row" }, el("label", { class: "field" }, el("span", {}, t("phone")), iPhone), el("label", { class: "field" }, el("span", {}, t("emailOpt")), iEmail)),
    el("label", { class: "field" }, el("span", {}, t("note")), iNotes),
    el("div", { class: "field" }, el("span", {}, t("photo")), drop, fileIn),
    el("div", { class: "f-row" }, el("label", { class: "field" }, el("span", {}, t("vendor")), iVend), el("label", { class: "field" }, el("span", {}, t("status")), iStatus)),
    el("div", { class: "field" }, el("span", {}, t("customerLink")), linkBlock),
    isNew ? null : el("div", { class: "field" }, el("span", {}, t("notify")), notifyRow(o, iName, iPhone, iEmail, iStatus)),
    el("details", { class: "deliv", open: !!(f.delivery_note || f.proof_path || f.delivery === "Failed") || null },
      el("summary", {}, t("deliverySection")),
      el("label", { class: "field" }, el("span", {}, t("deliveryNote")), iDNote, el("div", { class: "hint" }, t("deliveryNoteHint"))),
      el("div", { class: "field" }, el("span", {}, t("proofPhoto")), proofBox, proofIn)),
    err, confirmBox,
    el("div", { class: "sheet-foot" }, isNew ? el("span") : el("button", { class: "btn danger", type: "button", onclick: () => (confirmBox.hidden = false) }, t("delete")), saveBtn));
  sheet.append(form);
}

// ---------- team ----------
function renderTeam() {
  const box = $("team"); box.replaceChildren();
  for (const m of S.members) {
    const self = m.email === S.me.email;
    box.append(el("div", { class: "member" },
      el("div", {}, el("b", {}, m.name, el("span", { class: "role-tag" }, m.role === "admin" ? "Admin" : t("roleVendor"))), el("small", {}, m.email)),
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
