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
];
const stepOf = (o) => (o.delivery === "Delivered" ? 3 : o.delivery === "In transit" ? 2 : o.status === "Ready" ? 1 : 0);

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
const S = { me: null, tab: "orders", sel: today, month: new Date(), orders: [], members: [], photoUrls: {}, channel: null };
S.month = new Date(S.month.getFullYear(), S.month.getMonth(), 1);
const isAdmin = () => S.me?.role === "admin";

function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2600); }
function show(view) { for (const v of ["login", "noaccess", "ordersView", "teamView"]) $(v).hidden = v !== view; }

// ---------- auth ----------
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault(); $("lErr").textContent = ""; $("lBtn").disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim(), password: $("lPass").value });
  $("lBtn").disabled = false;
  if (error) $("lErr").textContent = /invalid/i.test(error.message) ? "Email o contraseña incorrectos." : error.message;
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
  $("hright").hidden = true; $("sub").textContent = "Inicia sesión";
  closeSheet(); show("login");
}

async function start(user) {
  const email = user.email.toLowerCase();
  const { data, error } = await sb.from("cdf_members").select("email,name,role").eq("email", email).maybeSingle();
  $("hright").hidden = false;
  if (error || !data) {
    $("noaccessTxt").textContent = "La cuenta " + email + " no está en el equipo de Pedidos CDF. Pide a un admin que te añada.";
    $("tabs").hidden = true; show("noaccess"); return;
  }
  S.me = data;
  $("sub").textContent = isAdmin() ? "Admin · " + data.name : data.name + " · tus pedidos";
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
  if (error) { toast("No se pudieron cargar los pedidos"); return; }
  S.orders = data;
  renderOrders();
}
async function loadMembers() {
  const { data } = await sb.from("cdf_members").select("email,name,role").order("name");
  S.members = data || [];
}
const memberName = (email) => S.members.find((m) => m.email === email)?.name || email || "Sin asignar";

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
  $("mLabel").textContent = cap(m.toLocaleDateString("es-ES", { month: "long", year: "numeric" }));
  const counts = {}; for (const o of S.orders) counts[o.date] = (counts[o.date] || 0) + 1;
  const cal = $("cal"); cal.replaceChildren();
  ["L", "M", "X", "J", "V", "S", "D"].forEach((d, i) => cal.append(el("div", { class: "dow" + (i === 6 ? " sun" : "") }, d)));
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), k = iso(d), n = counts[k] || 0;
    if (i >= 35 && d.getMonth() !== mo) break;
    const dots = el("span", { class: "dots" }); for (let j = 0; j < Math.min(n, 3); j++) dots.append(el("i"));
    cal.append(el("button", {
      class: "day" + (d.getMonth() !== mo ? " out" : "") + (k === today ? " today" : "") + (k === S.sel ? " sel" : ""),
      "aria-label": d.toLocaleDateString("es-ES", { day: "numeric", month: "long" }) + (n ? ", " + n + " pedidos" : ""),
      onclick: () => { S.sel = k; S.month = new Date(d.getFullYear(), d.getMonth(), 1); renderOrders(); },
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
      if (error) { Object.assign(o, prev); renderOrders(); toast("No se pudo cambiar el estado"); }
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
  $("dLabel").textContent = cap(fromIso(S.sel).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }));
  const list = S.orders.filter((o) => o.date === S.sel).sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || a.num.localeCompare(b.num));
  $("dSub").textContent = list.length ? list.length + (list.length === 1 ? " pedido" : " pedidos") : "";
  const t = $("tally"); t.replaceChildren();
  if (list.length) STEPS.forEach((s, i) => { const n = list.filter((o) => stepOf(o) === i).length; t.append(el("span", { style: "background:var(--st-" + s.k + "-bg);color:var(--st-" + s.k + ")" }, n + " " + s.label)); });
  const box = $("list"); box.replaceChildren();
  if (!list.length) {
    box.append(el("div", { class: "empty" }, el("b", {}, "Sin pedidos este día"),
      isAdmin() ? "Pulsa «+ Nuevo pedido» para añadir uno desde la captura del cliente." : "Cuando te asignen un pedido para este día aparecerá aquí."));
    return;
  }
  for (const slot of SLOTS) {
    const os = list.filter((o) => o.slot === slot); if (!os.length) continue;
    const g = el("div", { class: "orders" });
    for (const o of os) {
      const th = el("div", { class: "thumb" }, o.photo_path ? "" : "sin foto");
      if (o.photo_path) photoUrl(o.photo_path).then((u) => { if (u) th.replaceChildren(el("img", { src: u, alt: "" })); });
      g.append(el("div", { class: "order", role: "button", tabindex: "0", onclick: () => openSheet(o), onkeydown: (e) => { if (e.key === "Enter") openSheet(o); } },
        th,
        el("div", { class: "o-main" },
          el("div", { class: "o-top" }, el("span", { class: "num" }, "#" + o.num), chanChip(o.channel)),
          el("div", { class: "o-sub" }, [o.customer_name, isAdmin() ? memberName(o.vendor_email) : null, o.address || o.notes || "Sin dirección"].filter(Boolean).join(" · "))),
        stepper(o, isAdmin())));
    }
    box.append(el("section", { class: "slot" }, el("h3", {}, slot), g));
  }
}
$("prevM").onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); renderCal(); };
$("nextM").onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); renderCal(); };
$("todayBtn").onclick = () => { S.sel = today; S.month = new Date(); S.month.setDate(1); renderOrders(); };
$("newBtn").onclick = () => openSheet(null);

// ---------- purge delivered ----------
function renderPurge() {
  if (!isAdmin()) return;
  const n = S.orders.filter((o) => o.delivery === "Delivered").length;
  $("purgeBtn").textContent = "Borrar entregados (" + n + ")";
  $("purgeBtn").disabled = n === 0;
}
$("purgeBtn").onclick = () => {
  const n = S.orders.filter((o) => o.delivery === "Delivered").length;
  $("purgeTxt").textContent = "¿Borrar " + n + (n === 1 ? " pedido entregado" : " pedidos entregados") + " y sus fotos? Sus enlaces de seguimiento dejarán de funcionar.";
  $("purgeConfirm").hidden = false;
};
$("purgeNo").onclick = () => ($("purgeConfirm").hidden = true);
$("purgeYes").onclick = async () => {
  const done = S.orders.filter((o) => o.delivery === "Delivered");
  const paths = done.map((o) => o.photo_path).filter(Boolean);
  if (paths.length) await sb.storage.from(bucket).remove(paths);
  const { error } = await sb.from("cdf_orders").delete().in("id", done.map((o) => o.id));
  $("purgeConfirm").hidden = true;
  if (error) toast("No se pudieron borrar"); else { toast(done.length + " pedidos borrados"); loadOrders(); }
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
  const a = el("a", { target: "_blank", rel: "noopener", style: "color:inherit" }, "Abrir en Google Maps ↗");
  const sync = () => { a.href = mapsUrl(input.value); a.hidden = !input.value.trim(); };
  input.addEventListener("input", sync); sync();
  return a;
}

// ---------- sheet ----------
let onPaste = null, onKey = null;
function closeSheet() {
  $("sheetRoot").replaceChildren();
  if (onPaste) document.removeEventListener("paste", onPaste);
  if (onKey) document.removeEventListener("keydown", onKey);
  onPaste = onKey = null;
}
function openSheet(o) {
  closeSheet();
  const scrim = el("div", { class: "scrim", onclick: (e) => { if (e.target === scrim) closeSheet(); } });
  const sheet = el("div", { class: "sheet", role: "dialog", "aria-modal": "true" });
  scrim.append(sheet); $("sheetRoot").append(scrim);
  onKey = (e) => { if (e.key === "Escape") closeSheet(); }; document.addEventListener("keydown", onKey);
  const closeBtn = () => el("button", { class: "iconbtn", type: "button", "aria-label": "Cerrar", onclick: closeSheet }, "✕");

  if (!isAdmin()) {
    const ph = el("div", { class: "drop" }, o.photo_path ? "Cargando foto…" : "Sin foto");
    if (o.photo_path) photoUrl(o.photo_path).then((u) => ph.replaceChildren(u ? el("img", { src: u, alt: "Foto del pedido " + o.num }) : "No se pudo cargar la foto"));
    sheet.append(el("div", { class: "sheet-head" }, el("h2", {}, "Pedido #" + o.num), closeBtn()),
      el("dl", { class: "ro" },
        el("dt", {}, "Fecha y franja"), el("dd", {}, cap(fromIso(o.date).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })) + " · " + o.slot),
        el("dt", {}, "Cliente"), el("dd", {}, o.customer_name || "Sin nombre"),
        el("dt", {}, "Dirección"), el("dd", {}, o.address ? mapLink(o.address) : "Sin dirección"),
        el("dt", {}, "Canal"), el("dd", {}, chanChip(o.channel) || "Sin canal"),
        el("dt", {}, "Nota / instrucción"), el("dd", { class: "note" }, o.notes || "Sin notas"),
        el("dt", {}, "Foto"), el("dd", {}, ph),
        el("dt", {}, "Estado"), el("dd", {}, stepper(o, false))));
    return;
  }

  const isNew = !o;
  const nextNum = String(Math.max(0, ...S.orders.map((x) => parseInt(x.num, 10) || 0)) + 1).padStart(4, "0");
  const f = o ? { ...o } : { num: nextNum, date: S.sel, slot: SLOTS[0], channel: "", vendor_email: S.members.find((m) => m.role === "vendor")?.email || "", customer_name: "", address: "", notes: "", status: "Preparing", delivery: "-", photo_path: null };
  let photoBlob = null, photoRemoved = false;
  const sel = (id, opts, val) => el("select", { id }, ...opts.map(([v, l]) => el("option", { value: v, selected: v === val }, l)));
  const iDate = el("input", { type: "date", id: "f-date", value: f.date, required: true });
  const iSlot = sel("f-slot", SLOTS.map((s) => [s, s]), f.slot);
  const iNum = el("input", { id: "f-num", value: f.num, inputmode: "numeric", style: "font-family:var(--f-mono)", required: true });
  const iChan = sel("f-chan", [["", "Sin canal"], ...CHANNELS.map((c) => [c[0], c[0]])], f.channel);
  const iName = el("input", { id: "f-name", value: f.customer_name || "", placeholder: "Quién recibe las flores", autocomplete: "off" });
  const iAddr = el("input", { id: "f-addr", value: f.address || "", placeholder: "Calle, número, piso, ciudad", autocomplete: "off" });
  const iNotes = el("textarea", { id: "f-notes", placeholder: "Mensaje de la tarjeta, teléfono, instrucciones…" }, f.notes);
  const iVend = sel("f-vendor", [["", "Sin asignar"], ...S.members.map((m) => [m.email, m.name + (m.role === "admin" ? " (admin)" : "")])], f.vendor_email || "");
  const iStatus = sel("f-status", STEPS.map((s) => [s.label, s.label]), STEPS[stepOf(f)].label);
  const fileIn = el("input", { type: "file", accept: "image/*,.heic,.heif", id: "f-file", hidden: true });
  const drop = el("div", { class: "drop" });
  const err = el("div", { class: "err", role: "alert" });
  let preview = null;
  const drawDrop = async () => {
    if (photoBlob) { if (preview) URL.revokeObjectURL(preview); preview = URL.createObjectURL(photoBlob); }
    const src = photoBlob ? preview : (!photoRemoved && f.photo_path ? await photoUrl(f.photo_path) : null);
    drop.replaceChildren(
      src ? el("img", { src, alt: "Foto del pedido" }) : el("div", {}, "Pega la captura con Ctrl+V / ⌘V, arrástrala aquí o"),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;justify-content:center" },
        el("button", { class: "btn", type: "button", onclick: () => fileIn.click() }, src ? "Cambiar foto" : "Subir foto"),
        src ? el("button", { class: "btn", type: "button", onclick: () => { photoBlob = null; photoRemoved = true; drawDrop(); } }, "Quitar") : null));
  };
  const take = async (file) => {
    if (!file) return;
    if (!isImage(file)) { err.textContent = "Ese archivo no es una imagen. Usa una foto o una captura de pantalla."; return; }
    err.textContent = ""; if (isHeic(file)) toast("Convirtiendo foto de iPhone…");
    try { photoBlob = await compress(file); photoRemoved = false; drawDrop(); } catch { err.textContent = "No se pudo leer esa imagen. Prueba a hacerle una captura de pantalla y pegarla."; }
  };
  fileIn.addEventListener("change", () => take(fileIn.files[0]));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); take(e.dataTransfer.files[0]); });
  onPaste = (e) => { const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/")); if (it) { e.preventDefault(); take(it.getAsFile()); } };
  document.addEventListener("paste", onPaste);
  drawDrop();

  const linkBlock = isNew ? el("div", { class: "hint" }, "El enlace para el cliente aparece al guardar el pedido.") : (() => {
    const li = el("input", { id: "f-link", readonly: true, value: trackUrl(o), onfocus: (e) => e.target.select() });
    return el("div", { class: "link-row" }, li,
      el("button", { class: "btn", type: "button", onclick: () => {
        navigator.clipboard?.writeText(li.value).then(() => toast("Enlace copiado"), () => { li.focus(); li.select(); toast("Selecciónalo y cópialo"); });
      } }, "Copiar"),
      el("a", { class: "btn", href: trackUrl(o), target: "_blank", rel: "noopener", style: "text-decoration:none;color:inherit" }, "Ver"));
  })();

  const saveBtn = el("button", { class: "btn primary", type: "submit" }, "Guardar");
  const confirmBox = el("div", { class: "confirm", hidden: true }, "¿Borrar el pedido #" + f.num + "? No se puede deshacer.",
    el("div", {},
      el("button", { class: "btn danger", type: "button", onclick: async () => {
        if (o.photo_path) await sb.storage.from(bucket).remove([o.photo_path]);
        const { error } = await sb.from("cdf_orders").delete().eq("id", o.id);
        if (error) { toast("No se pudo borrar"); return; }
        closeSheet(); toast("Pedido borrado"); loadOrders();
      } }, "Sí, borrar"),
      el("button", { class: "btn", type: "button", onclick: () => (confirmBox.hidden = true) }, "Cancelar")));

  const form = el("form", { style: "display:contents", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    const st = STEPS.find((s) => s.label === iStatus.value);
    const row = { num: iNum.value.trim(), date: iDate.value, slot: iSlot.value, channel: iChan.value, vendor_email: iVend.value || null,
 customer_name: iName.value.trim(), address: iAddr.value.trim(),
      notes: iNotes.value.trim(), status: st.status, delivery: st.delivery };
    saveBtn.disabled = true;
    let saved, error;
    if (isNew) ({ data: saved, error } = await sb.from("cdf_orders").insert(row).select().single());
    else ({ data: saved, error } = await sb.from("cdf_orders").update(row).eq("id", o.id).select().single());
    if (error) { saveBtn.disabled = false; err.textContent = error.code === "23505" ? "Ya existe un pedido #" + row.num + ". Usa otro número." : "No se pudo guardar: " + error.message; return; }
    if (photoBlob) {
      const path = saved.id + ".jpg";
      const up = await sb.storage.from(bucket).upload(path, photoBlob, { upsert: true, contentType: "image/jpeg" });
      if (up.error) toast("Pedido guardado, pero la foto no se pudo subir");
      else { delete S.photoUrls[path]; await sb.from("cdf_orders").update({ photo_path: path }).eq("id", saved.id); }
    } else if (photoRemoved && f.photo_path) {
      await sb.storage.from(bucket).remove([f.photo_path]);
      await sb.from("cdf_orders").update({ photo_path: null }).eq("id", saved.id);
    }
    S.sel = row.date; S.month = fromIso(row.date); S.month.setDate(1);
    closeSheet(); toast(isNew ? "Pedido creado" : "Pedido guardado"); loadOrders();
    if (isNew) setTimeout(() => { const n = S.orders.find((x) => x.id === saved.id); if (n) openSheet(n); }, 600);
  } },
    el("div", { class: "sheet-head" }, el("h2", {}, isNew ? "Nuevo pedido" : "Editar pedido #" + f.num), closeBtn()),
    el("div", { class: "f-row" }, el("label", { class: "field" }, el("span", {}, "Fecha"), iDate), el("label", { class: "field" }, el("span", {}, "Franja horaria"), iSlot)),
    el("div", { class: "f-row" }, el("label", { class: "field" }, el("span", {}, "Nº pedido"), iNum), el("label", { class: "field" }, el("span", {}, "Canal"), iChan)),
    el("label", { class: "field" }, el("span", {}, "Nombre del cliente (opcional)"), iName),
    el("div", { class: "field" }, el("span", {}, "Dirección de entrega (opcional)"), iAddr, el("div", { class: "hint" }, mapHint(iAddr))),
    el("label", { class: "field" }, el("span", {}, "Nota / instrucción"), iNotes),
    el("div", { class: "field" }, el("span", {}, "Foto"), drop, fileIn),
    el("div", { class: "f-row" }, el("label", { class: "field" }, el("span", {}, "Vendedor"), iVend), el("label", { class: "field" }, el("span", {}, "Estado"), iStatus)),
    el("div", { class: "field" }, el("span", {}, "Enlace para el cliente"), linkBlock),
    err, confirmBox,
    el("div", { class: "sheet-foot" }, isNew ? el("span") : el("button", { class: "btn danger", type: "button", onclick: () => (confirmBox.hidden = false) }, "Borrar"), saveBtn));
  sheet.append(form);
}

// ---------- team ----------
function renderTeam() {
  const box = $("team"); box.replaceChildren();
  for (const m of S.members) {
    const self = m.email === S.me.email;
    box.append(el("div", { class: "member" },
      el("div", {}, el("b", {}, m.name, el("span", { class: "role-tag" }, m.role === "admin" ? "Admin" : "Vendedor")), el("small", {}, m.email)),
      self ? el("span", { class: "hint" }, "Tú") : el("button", { class: "btn ghost", onclick: async (e) => {
        const b = e.currentTarget;
        if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "¿Quitar? Confirmar"; b.classList.add("danger"); return; }
        b.disabled = true;
        const { data, error } = await sb.functions.invoke("cdf-users", { body: { action: "remove", email: m.email } });
        if (error || data?.error) { b.disabled = false; toast(data?.error || "No se pudo quitar"); return; }
        toast(m.name + " ya no tiene acceso"); await loadMembers(); renderTeam();
      } }, "Quitar")));
  }
}
$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault(); $("aErr").textContent = ""; $("aBtn").disabled = true;
  const body = { action: "add", name: $("aName").value.trim(), email: $("aEmail").value.trim(), role: $("aRole").value, password: $("aPass").value };
  const { data, error } = await sb.functions.invoke("cdf-users", { body });
  $("aBtn").disabled = false;
  let msg = data?.error;
  if (error && !msg) { try { msg = (await error.context.json()).error; } catch { msg = "No se pudo añadir"; } }
  if (msg) { $("aErr").textContent = msg; return; }
  toast(data.existed ? body.name + " añadido (ya tenía cuenta, usa su contraseña)" : body.name + " añadido");
  e.target.reset(); await loadMembers(); renderTeam();
});
