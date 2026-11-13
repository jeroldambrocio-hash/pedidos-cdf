// Lalamove inside the order editor (admin only, needs migration 029 and the cdf-lalamove function).
// Steps: confirm where the flowers go (map search or a pasted Google Maps link) → see the price → book a rider
// → follow the rider and status live → cancel while Lalamove still allows it.
// In sandbox nothing is charged, no real rider comes, and orders are never moved by Lalamove.
const LL = { cap: null, env: null };
const LL_ACTIVE = new Set(["ASSIGNING_DRIVER", "ON_GOING", "PICKED_UP"]);
const llCall = async (body) => {
  const { data, error } = await sb.functions.invoke("cdf-lalamove", { body });
  if (error) {
    let msg = error.message;
    let body = null;
    try { body = await error.context?.json(); msg = body?.error || msg; } catch {}
    const e = new Error(msg); e.body = body; throw e; // the body may carry more (e.g. the real priority fee)
  }
  return data;
};
// Same reading of a pasted point as the server (supabase/functions/cdf-lalamove/lalamove.ts): "lat, lng" or a Google Maps link
function llParseCoords(input) {
  const s = String(input || "");
  // The place's own pin (!3d…!4d…) first: "@lat,lng" is only where the map was centred
  const m = /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(s)
    || /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/.exec(s)
    || /[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i.exec(s)
    || /\/(?:search|place|dir)\/(-?\d{1,2}\.\d+)(?:,|%2C)\+?\s*(-?\d{1,3}\.\d+)/i.exec(s)
    || /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/.exec(s);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return lat >= 4 && lat <= 21.5 && lng >= 116 && lng <= 127 ? { lat, lng } : null;
}
// The map itself (Leaflet, the Philippines' bounds, tiles and pin) lives in location-picker.js, shared with
// the public order form.
const llInPH = CDFMap.inPH, llLoadMap = CDFMap.load;
// Opens the map on `start` ({lat, lng}; without one, on what `query` finds, else Metro Manila).
// Resolves with the chosen { lat, lng }, or null when closed without choosing.
function llPickOnMap(start, query) {
  return new Promise((resolve) => {
    const back = document.activeElement, scrim = el("div", { class: "scrim center-scrim" });
    let map = null, pin = null, point = null;
    const done = async (v) => {
      if (!scrim.isConnected) return;
      scrim.classList.add("leaving");
      if (!prefersReducedMotion()) await wait(330);
      try { map?.remove(); } catch {}
      scrim.remove(); back?.focus?.(); resolve(v);
    };
    const holder = el("div", { class: "map-pick", id: "mapPick" }, el("p", { class: "note" }, t("mapLoading")));
    const where = el("p", { class: "note map-where", role: "status" }, t("mapNoPin"));
    const ok = el("button", { class: "btn primary", id: "mapUse", type: "button", disabled: true, onclick: () => done(point) }, t("mapUse"));
    const put = (lat, lng, centre) => {
      if (!map) return;
      if (!llInPH(lat, lng)) { where.textContent = t("mapOutside"); return; }
      point = { lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6) };
      pin.setLatLng([point.lat, point.lng]);
      if (centre) map.setView([point.lat, point.lng], Math.max(map.getZoom(), 17));
      where.textContent = t("mapAt", { point: `${point.lat}, ${point.lng}` }); ok.disabled = false;
    };
    const q = el("input", { id: "mapSearch", class: "input", value: query || "", placeholder: t("mapSearchPh"), autocomplete: "off", "aria-label": t("mapSearchPh") });
    const find = el("button", { class: "btn", type: "button", onclick: async () => {
      const text = q.value.trim();
      if (!text || !map) return;
      find.disabled = true; find.classList.add("busy");
      try {
        const r = (await llCall({ action: "geocode", query: text })).results?.[0];
        if (r) put(r.lat, r.lng, true); else where.textContent = t("mapNoHits");
      } catch (x) { where.textContent = x.message; }
      finally { find.disabled = false; find.classList.remove("busy"); }
    } }, t("llSearch"));
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); find.click(); } });
    const box = el("div", { class: "dialog map-dialog", role: "dialog", "aria-modal": "true", tabindex: "-1", "aria-labelledby": "mapTitle" },
      el("div", { class: "sheet-body" },
        el("h2", { id: "mapTitle", class: "dialog-text" }, t("mapTitle")),
        el("p", { class: "note" }, t("mapHint")),
        el("div", { class: "ll-search" }, q, find), holder, where),
      el("div", { class: "sheet-foot" }, el("button", { class: "btn", type: "button", onclick: () => done(null) }, t("cancel")), ok));
    scrim.append(box);
    closeOnBackdrop(scrim, () => done(null));
    scrim.addEventListener("dismiss", () => done(null));
    $("dialogRoot").append(scrim);
    queueMicrotask(() => box.focus());
    llLoadMap().then((L) => {
      if (!scrim.isConnected) return;
      holder.replaceChildren();
      const at = start && llInPH(+start.lat, +start.lng) ? [+start.lat, +start.lng] : null;
      map = L.map(holder).setView(at || [14.6, 121.03], at ? 17 : 12);
      CDFMap.tiles(L, map);
      pin = L.marker(map.getCenter(), { draggable: true, title: t("mapPinTitle"), icon: CDFMap.pinIcon(L) }).addTo(map);
      pin.on("dragend", () => { const c = pin.getLatLng(); put(c.lat, c.lng); });
      map.on("click", (e) => put(e.latlng.lat, e.latlng.lng));
      setTimeout(() => map?.invalidateSize(), 400); // the dialog was still growing when the map measured itself
      if (at) put(at[0], at[1]); else if (q.value.trim()) find.click();
    }).catch(() => fill(holder, el("p", { class: "err", role: "alert" }, t("mapFail"))));
  });
}

// The shop the rider picks up from: the assigned florist's (Team → edit). null when there isn't one yet.
// A florist doesn't load the whole team (her list comes from a directory without addresses): for her own
// orders her shop is in her own profile (S.me).
const llShopOf = (o) => {
  const m = o.vendor_email && S.me?.email === o.vendor_email ? S.me : S.members.find((x) => x.email === o.vendor_email);
  return m?.pickup_lat != null && m.pickup_address ? m : null;
};

// Who books riders: admins for any order, a florist for the orders assigned to her (the server checks it too)
const llCanBook = (o) => !!o?.id && (isAdmin() || (S.me?.role === "vendor" && o.vendor_email === S.me.email));

// "Head out" with Lalamove set up: open the order on its Lalamove block to book the rider, instead of moving
// the order by hand. The order then follows the rider (in production). Returns false when Lalamove isn't
// available here, so the caller falls back to the manual "On the way".
async function llHeadOut(o) {
  if (isPickup(o) || !llCanBook(o) || (await llDetect().catch(() => false)) !== "ready") return false;
  await openOrder(o);
  for (let i = 0; i < 40; i++) {
    const s = document.getElementById("lalamoveSection");
    if (s && !s.hidden) { s.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" }); return true; }
    await wait(100);
  }
  return true;
}

// Once per session: is the table there, and is the function set up?
async function llDetect() {
  if (LL.cap !== null) return LL.cap;
  const { error } = await sb.from("cdf_lalamove").select("order_id").limit(1);
  if (error) return (LL.cap = false);
  try { const s = await llCall({ action: "status" }); LL.env = s.env; LL.cap = s.ready ? "ready" : "setup"; }
  catch { LL.cap = "setup"; }
  return LL.cap;
}

// The Lalamove row of every loaded order (admins: all; a florist: hers), kept live. Used by the cards
// (rider booked → follow it instead of marking by hand) and by the office banner (Lalamove dropped it).
S.ll = new Map();
let llAllChan = null;
const LL_FAILED = new Set(["CANCELED", "REJECTED", "EXPIRED"]);
async function llLoadRows() {
  if (S.me?.role !== "admin" && S.me?.role !== "vendor") return;
  const gen = sessionNow();
  const ids = S.orders.filter((o) => !o.archived_at && (isOpen(o) || o.cancelled_at)).map((o) => o.id);
  const next = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from("cdf_lalamove").select("*").in("order_id", ids.slice(i, i + 200));
    if (error || stale(gen)) return; // no table yet (migration 029) or no access: nothing to show
    (data || []).forEach((r) => next.set(r.order_id, r));
  }
  S.ll = next;
  if (!llAllChan && sb.channel) llAllChan = sb.channel("ll-all").on("postgres_changes", { event: "*", schema: "public", table: "cdf_lalamove" }, (p) => {
    const r = p.new && p.new.order_id ? p.new : null;
    if (r) S.ll.set(r.order_id, r); else if (p.old?.order_id) S.ll.delete(p.old.order_id);
    render();
  }).subscribe();
}
const llRowOf = (o) => S.ll?.get(o.id) || null;
// A rider is booked and still on it
const llActive = (o) => { const r = llRowOf(o); return !!(r?.ll_order_id && LL_ACTIVE.has(r.status)); };
// Lalamove (or the rider) dropped it; not when we cancelled it ourselves
const llDropped = (o) => { const r = llRowOf(o); return !!(r?.ll_order_id && LL_FAILED.has(r.status) && r.cancelled_by_us === false); }; // only once migration 037 can tell

// The order's rider booking if one is still on, read fresh (the list may be minutes old). null if none or unknown.
async function llActiveBooking(o) {
  try {
    const { data } = await sb.from("cdf_lalamove").select("ll_order_id,status,driver_name").eq("order_id", o.id).maybeSingle();
    return data?.ll_order_id && LL_ACTIVE.has(data.status) ? data : null;
  } catch { return null; }
}
// Cancelling the order or moving it to another day first cancels its rider. When Lalamove refuses
// (a rider assigned for a while can't be cancelled), the caller asks whether to go on anyway.
async function llReleaseRider(o) {
  const b = await llActiveBooking(o);
  if (!b) return true;
  try {
    const d = await llCall({ action: "cancel", order_id: o.id });
    if (d?.row) S.ll.set(o.id, d.row);
    toast(t("llCancelled"));
    return true;
  } catch (e) {
    return askConfirm(t("llReleaseFailAsk"), t("llGoOnAnyway"), { detail: e.message + " · " + t("llStillBooked"), danger: true });
  }
}
// What a quote was made for (migration 038 keeps it with the quote). Anything that changed since makes it stale.
function llQuoteStale(o, row) {
  const f = row?.quote_for;
  if (!f) return null;
  if ((f.vendor || null) !== (o.vendor_email || null)) return t("llStaleFlorist");
  if (o.drop_lat != null && (Math.abs(+o.drop_lat - +row.lat) > 0.0002 || Math.abs(+o.drop_lng - +row.lng) > 0.0002)) return t("llStalePlace");
  if (f.date !== o.date || f.slot !== o.slot) return t("llStaleSlot");
  return null;
}

// Phase 5: the proofs Lalamove gave for this order's deliveries (kept in our private bucket by the
// function) and what happened to its bookings. Stays visible after delivery or cancellation.
// Without migration 20261111130000 the tables aren't there and nothing is shown.
const LL_PROOF_COLS = "id,ll_order_id,kind,stop_key,provider_status,provider_at,state,storage_path,error,removed_by,removed_at,created_at";
function llProofs(o, holder) {
  const node = el("div", { class: "ll-proofs" });
  let list = null, ships = [], row = null, chan = null;
  // Opens over the panel (the same viewer as the order photos) instead of a new tab.
  const view = (p) => async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const { data, error } = await sb.storage.from("cdf-lalamove-proofs").createSignedUrl(p.storage_path, 300);
      if (error || !data?.signedUrl) return toastErr(error?.message || t("llps_error"));
      openPhotoViewer(data.signedUrl, t("llProof_" + p.kind));
    } finally { b.disabled = false; }
  };
  const remove = (p) => async (e) => {
    const b = e.currentTarget;
    if (!(await askConfirm(t("llProofRemoveAsk"), t("llProofRemove"), { danger: true }))) return;
    b.disabled = true;
    try { await llCall({ action: "proof_remove", id: p.id }); toast(t("llProofRemoved")); await load(); }
    catch (x) { toastErr(x.message); b.disabled = false; }
  };
  const tagOf = (st) => st === "available" ? "tag" : st === "pending" ? "tag risk" : st === "error" ? "tag cancel" : "tag muted";
  const detail = (p) =>
    p.state === "not_provided" && p.provider_status === "FAILED" ? t("llProofFailed")
    : p.state === "error" && /^host_not_allowed:/.test(p.error || "") ? t("llProofHost", { host: p.error.slice(17) })
    : p.state === "error" ? p.error
    : p.state === "removed" && p.removed_by ? t("llProofRemovedBy", { who: p.removed_by })
    : p.provider_at ? when(p.provider_at) : null;
  function paint() {
    if (!list) return fill(node);
    const current = ships.find((x) => x.ll_order_id === row?.ll_order_id);
    const pods = list.filter((p) => p.kind === "pod" && p.ll_order_id === row?.ll_order_id);
    const waiting = row?.status === "COMPLETED" && !pods.length;
    const older = ships.filter((x) => x.ll_order_id !== row?.ll_order_id);
    if (!list.length && !waiting && !older.length && !current?.replace_noticed_at) return fill(node);
    const multi = list.filter((p) => p.kind === "pod").length > 1;
    fill(node, el("h4", {}, t("llProofs")),
      current?.replaced_from ? el("p", { class: "note" }, icon("alert"), " " + t("llReplaced")) : null,
      current?.replace_noticed_at && !current.replaced_by ? el("p", { class: "note" }, icon("clock"), " " + t("llReplacedWait")) : null,
      waiting ? el("p", { class: "note" }, t("llProofWaiting")) : null,
      list.length ? el("ul", { class: "ll-proof-list" }, list.map((p) => el("li", { class: "ll-proof", "data-state": p.state },
        el("span", { class: "ll-proof-what" }, t("llProof_" + p.kind) + (multi && p.kind === "pod" ? " · " + t("llProofStop", { n: p.stop_key }) : "")),
        el("span", { class: tagOf(p.state) }, t("llps_" + p.state)),
        detail(p) ? el("span", { class: "note" }, detail(p)) : null,
        p.state === "available" ? el("button", { class: "btn", type: "button", onclick: view(p) }, icon("camera"), " " + t("llProofView")) : null,
        p.state === "available" && isAdmin() ? el("button", { class: "linkish", type: "button", onclick: remove(p) }, t("llProofRemove")) : null))) : null,
      older.length ? el("details", { class: "ll-history" }, el("summary", {}, t("llHistory")),
        el("ul", {}, older.map((x) => el("li", {}, "#" + x.ll_order_id + " · " + (t("ll_" + x.status) || x.status || "—"))))) : null);
  }
  async function load() {
    const [p, h] = await Promise.all([
      sb.from("cdf_lalamove_proofs").select(LL_PROOF_COLS).eq("order_id", o.id).order("created_at"),
      sb.from("cdf_lalamove_shipments").select("ll_order_id,status,replaced_from,replaced_by,replace_noticed_at,created_at").eq("order_id", o.id).order("created_at"),
    ]);
    if (p.error) { list = null; return paint(); }      // not set up yet
    list = p.data || []; ships = h.error ? [] : h.data || [];
    paint();
  }
  load().catch(() => {});
  if (sb.channel) {
    chan = sb.channel("llp-" + o.id).on("postgres_changes", { event: "*", schema: "public", table: "cdf_lalamove_proofs", filter: "order_id=eq." + o.id }, () => {
      if (node.isConnected) load().catch(() => {});
    }).subscribe();
    // Closed with the editor
    let seen = false;
    const stop = setInterval(() => { if (holder.isConnected) seen = true; else if (seen) { clearInterval(stop); sb.removeChannel(chan); } }, 3000);
  }
  return { node, update(r) { const was = row?.status + "|" + row?.ll_order_id; row = r; paint(); if (was !== r?.status + "|" + r?.ll_order_id) load().catch(() => {}); } };
}

function lalamoveSection(o, { proofsOnly = false } = {}) {
  const box = el("div", { class: "ll" });
  const sec = el("section", { id: "lalamoveSection", hidden: true }, el("h3", {}, icon("truck"), " Lalamove ", el("span", { class: "tag muted ll-env" })), box);
  let row = null, chan = null, busy = false;
  const proofs = llProofs(o, sec);

  const status = (s) => el("span", { class: "tag " + (s === "COMPLETED" ? "" : LL_ACTIVE.has(s) ? "risk" : "cancel") }, t("ll_" + s) || s);
  const btn = (label, onclick, primary) => el("button", { class: "btn" + (primary ? " primary" : ""), type: "button", onclick: async (e) => {
    if (busy) return; busy = true; const b = e.currentTarget; b.disabled = true; b.classList.add("busy");
    try { await onclick(); } catch (x) { toastErr(x.message); } finally { busy = false; b.disabled = false; b.classList.remove("busy"); }
  } }, label);
  const fee = (n, cur) => (cur && cur !== "PHP" ? cur + " " + Math.round(n) : peso(n));
  // Still looking for a rider: a priority fee (tip) makes the job pay more, so it is taken sooner. The amount
  // pressed is added to whatever the fee is now; the server works out the total and Lalamove charges the Wallet.
  let tipNow = null;
  const addTip = async (n) => {
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error(t("llTipBad"));
    if (!(await askConfirm(t("llTipAsk", { amount: peso(n) }), t("llTipYes", { amount: peso(n) }), { detail: t(LL.env === "production" ? "llTipWallet" : "llTipSandbox") }))) return;
    // It says which fee it adds to: if Lalamove's is no longer that (an earlier press whose answer was lost),
    // nothing is charged and the real fee is shown, so the same amount is never added twice (13/11/2026)
    const send = () => llCall({ action: "priority_fee", order_id: o.id, add: n, base: tipNow ?? undefined });
    let r;
    try { r = await send(); }
    catch (e) {
      if (Number.isInteger(e.body?.priority_fee)) { tipNow = e.body.priority_fee; draw(); }
      if (!e.body?.need_base) throw e;
      r = await send(); // the first press only learnt the current fee: ask once more, now with it
    }
    row = r.row || row; tipNow = r.priority_fee ?? tipNow; draw(); toast(t("llTipAdded", { amount: peso(r.priority_fee) }));
  };
  const tipBox = () => {
    const own = el("input", { class: "input ll-tip-own", type: "text", inputMode: "numeric", pattern: "[0-9]*", maxLength: 4, placeholder: t("llTipOwnPh"), "aria-label": t("llTipOwn") });
    return el("div", { class: "ll-tip", role: "group", "aria-label": t("llTip") },
      el("p", { class: "ll-tip-title" }, el("b", {}, t("llTip")), tipNow ? " · " + t("llTipNow", { amount: peso(tipNow) }) : ""),
      el("p", { class: "note" }, t("llTipHint")),
      el("div", { class: "btn-row" }, [20, 50, 100].map((n) => btn("+" + peso(n), () => addTip(n))),
        el("span", { class: "ll-tip-manual" }, own, btn(t("llTipAdd"), () => addTip(/^\d+$/.test(own.value.trim()) ? +own.value.trim() : NaN)))));
  };
  const shopLine = () => { const s = llShopOf(o); return s ? el("p", { class: "note ll-shop" }, icon("flower"), " " + t("llFrom", { name: s.name, address: s.pickup_address })) : null; };
  // The pin the rider will be sent to, in numbers (the written address stays the same when the pin moves), and a way to see it
  const coordsLink = (lat, lng) => el("p", { class: "note ll-pin" }, t("llPinAt", { point: `${+(+lat).toFixed(6)}, ${+(+lng).toFixed(6)}` }) + " · ",
    el("a", { class: "link-out", target: "_blank", rel: "noopener", href: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` }, t("llCheckPin")));
  // The point showing in the order form (More details) is the one that counts, saved or not yet: asking for a
  // price saves it on the order (keepPoint). Without a form on screen, the order's saved point.
  const far = (a, b) => Math.abs(+a - +b) > 0.0002;
  const wanted = () => {
    const f = document.getElementById("f-drop"), p = f && f.value.trim() ? llParseCoords(f.value) : null;
    return p || (o.drop_lat != null ? { lat: +o.drop_lat, lng: +o.drop_lng } : null);
  };

  // 1) Where to deliver: search the order's address (or a pasted Maps link / "lat, lng") and pick a result
  function pickPlace(after) {
    const q = el("input", { value: row?.place || o.address || "", placeholder: t("llSearchPh"), autocomplete: "off" });
    const list = el("div", { class: "ll-results" });
    const search = btn(t("llSearch"), async () => {
      const { results } = await llCall({ action: "geocode", query: q.value.trim() });
      fill(list, results.length ? results.map((r) => el("button", { class: "ll-hit", type: "button", onclick: () => Promise.resolve(after(r)).catch((x) => toastErr(x.message)) },
        icon("map"), el("span", {}, r.label))) : el("p", { class: "note" }, t("llNoHits")));
    });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search.click(); } });
    // Not in the list (house numbers and many villages aren't on the free map): put the pin by hand
    const onMap = btn(t("mapPickBtn"), async () => {
      const from = row?.lat != null ? { lat: +row.lat, lng: +row.lng } : o.drop_lat != null ? { lat: +o.drop_lat, lng: +o.drop_lng } : null;
      const p = await llPickOnMap(from, q.value.trim());
      if (p) await after({ ...p, label: o.address || q.value.trim() || `${p.lat}, ${p.lng}` });
    });
    fill(box, el("p", { class: "note" }, t("llWhereHint")), el("div", { class: "ll-search" }, q, search), list, el("div", { class: "btn-row" }, onMap));
    q.focus();
  }

  // Booking checks the order's own saved point (033), so a point chosen here is saved on the order too.
  // Only the office can change an order: a florist keeps the order's point, or asks for it to be corrected.
  async function keepPoint(place) {
    if (!S.cap.drop || (o.drop_lat != null && !far(o.drop_lat, place.lat) && !far(o.drop_lng, place.lng))) return;
    if (!isAdmin()) { if (o.drop_lat != null) throw new Error(t("llPointOffice")); return; }
    const { data, error } = await sb.from("cdf_orders").update({ drop_lat: place.lat, drop_lng: place.lng }).eq("id", o.id).select().single();
    if (error) throw new Error(t("saveFail", { msg: error.message }));
    Object.assign(o, { drop_lat: data.drop_lat, drop_lng: data.drop_lng, updated_at: data.updated_at });
    upsertLocal(data);
    // The order form on screen shows the same point, and doesn't count it as an unsaved change
    document.getElementById("f-drop")?.dispatchEvent(new CustomEvent("cdf-point-saved", { detail: { lat: place.lat, lng: place.lng } }));
  }

  // 2) Price for the chosen point
  async function quote(place) {
    await keepPoint(place);
    const vehicle = el("select", {}, ...["MOTORCYCLE", "SEDAN", "MPV"].map((v) => el("option", { value: v, selected: v === (row?.service || o.vehicle || "MOTORCYCLE") }, t("llv_" + v))));
    const when = el("select", {}, el("option", { value: "now" }, t("llNow")), el("option", { value: "slot", selected: o.date > manilaToday() }, t("llInSlot", { slot: formatSlot12(o.slot) })));
    // Lalamove's delivery type: Regular (cheaper) or Priority (pays the rider more, so one is found sooner and
    // the flowers go straight to the door). The last one used for this order is offered again.
    const tier = el("select", {}, ...["regular", "priority"].map((v) => el("option", { value: v, selected: v === (row?.quote_for?.tier || "regular") }, t("llTier_" + v))));
    const go = async () => {
      const r = await llCall({ action: "quote", order_id: o.id, lat: place.lat, lng: place.lng, place: place.label, service: vehicle.value, schedule: when.value, tier: tier.value });
      row = r.row; draw();
      if (when.value === "slot" && !r.scheduleAt) toast(t("llSlotTooClose"), { ms: 6000 });
    };
    fill(box, shopLine(), el("p", {}, el("b", {}, t("llDeliverTo")), " ", place.label), coordsLink(place.lat, place.lng),
      el("div", { class: "row2" }, field(t("llVehicle"), vehicle), field(t("llPickup"), when)),
      field(t("llTier"), tier), el("p", { class: "note" }, t("llTierHint")),
      el("div", { class: "btn-row" }, btn(t("llGetPrice"), go, true),
        btn(t("mapAdjust"), async () => { const p = await llPickOnMap(place); if (p) await quote({ ...p, label: o.address || place.label }); }),
        btn(t("llChangePlace"), () => pickPlace(quote))));
  }

  // Taken out another way (own car, another courier) or a test booking in sandbox: move the order by hand.
  // Same "On the way" as before Lalamove (it asks first and emails the customer).
  const manualOut = () => o.status === "Ready" && (o.delivery === "-" || o.delivery === "Failed")
    ? el("button", { class: "linkish ll-manual", type: "button", onclick: async () => { await requestStep(o, 2); if (stepOf(o) === 2) closeSheet(true); } }, t("llManualOut"))
    : null;

  async function reload() { row = (await sb.from("cdf_lalamove").select("*").eq("order_id", o.id).maybeSingle()).data; draw(); }
  function draw() {
    if (proofsOnly) {
      sec.hidden = !row?.ll_order_id;
      if (row?.ll_order_id) proofs.update(row);
      return fill(box, row?.ll_order_id ? proofs.node : null);
    }
    const ready = LL.cap === "ready";
    sec.querySelector(".ll-env").textContent = LL.env === "production" ? t("llLive") : t("llSandbox");
    if (!ready) return fill(box, el("p", { class: "note" }, t("llNotSetUp")));
    const riderOn = row?.ll_order_id && LL_ACTIVE.has(row.status);
    if (row?.ll_order_id) proofs.update(row);
    if (o.cancelled_at && !riderOn) return fill(box, el("p", { class: "note" }, t("llOrderCancelled")), row?.ll_order_id ? proofs.node : null);
    const err = row?.error ? el("p", { class: "err", role: "alert" }, row.error) : null;
    // A booking attempt still open (audit F01): being made now, or its result unknown. Nobody can book again
    // until it is settled: Lalamove's own number for it (checked against Lalamove), or "nothing was booked".
    const stuck = row?.booking_state === "pending" && Date.parse(row.booking_started_at) < Date.now() - 120000;
    if (row?.booking_state === "pending" && !stuck) {
      return fill(box, el("p", { class: "note ll-booking" }, icon("clock"), " " + t("llBookingNow")),
        el("div", { class: "btn-row" }, btn(t("llRefresh"), reload)));
    }
    if (row?.booking_state === "uncertain" || stuck) {
      const id = el("input", { inputmode: "numeric", autocomplete: "off", placeholder: t("llUncertainIdPh"), "aria-label": t("llUncertainIdPh") });
      return fill(box,
        el("div", { class: "sheet-note warn ll-uncertain", role: "alert" }, icon("alert"), el("span", {}, el("b", {}, t("llUncertainTitle")), " " + t("llUncertainHint"))),
        row.error ? el("p", { class: "note" }, row.error) : null,
        isAdmin() ? [
          el("div", { class: "ll-search" }, id, btn(t("llUncertainLink"), async () => {
            if (!id.value.trim()) { id.focus(); throw new Error(t("llUncertainIdPh")); }
            row = (await llCall({ action: "book_resolve", order_id: o.id, ll_order_id: id.value.trim() })).row; draw(); toast(t("llUncertainLinked"));
          }, true)),
          el("div", { class: "btn-row" }, btn(t("llUncertainNone"), async () => {
            if (!(await askConfirm(t("llUncertainNoneAsk", { num: o.num }), t("llUncertainNone"), { danger: true, detail: t("llUncertainNoneHint") }))) return;
            row = (await llCall({ action: "book_resolve", order_id: o.id })).row; draw(); toast(t("llUncertainCleared"));
          }), btn(t("llRefresh"), reload))
        ] : el("p", { class: "note" }, t("llUncertainFlorist")));
    }
    // Booked: status, rider, tracking link, refresh and cancel
    if (row?.ll_order_id) {
      const live = LL_ACTIVE.has(row.status);
      return fill(box,
        o.cancelled_at && live ? el("p", { class: "err", role: "alert" }, icon("alert"), " " + t("llCancelledOrderRider")) : null,
        el("div", { class: "ll-line" }, status(row.status), row.price_total ? el("b", {}, fee(row.price_total, row.quote_currency)) : null),
        row.driver_name ? el("p", { class: "ll-driver" }, icon("user"), " ", row.driver_name,
          row.driver_plate ? " · " + row.driver_plate : "", row.driver_phone ? el("a", { class: "link-out", href: "tel:" + row.driver_phone }, " " + row.driver_phone) : null)
          : live ? el("p", { class: "note" }, t("llFinding")) : null,
        row.place ? el("p", { class: "note" }, t("llDeliverTo") + " " + row.place) : null,
        row.share_link ? el("a", { class: "link-out", href: row.share_link, target: "_blank", rel: "noopener" }, t("llTrack")) : null,
        LL.env !== "production" && live ? el("p", { class: "note" }, t("llSandboxNoMove")) : null,
        row.status === "ASSIGNING_DRIVER" && !o.cancelled_at ? tipBox() : null,
        err,
        el("div", { class: "btn-row" },
          btn(t("llRefresh"), async () => { row = (await llCall({ action: "refresh", order_id: o.id })).row; draw(); }),
          live ? btn(t("llCancel"), async () => {
            if (!(await askConfirm(t("llCancelAsk"), t("llCancel"), { danger: true }))) return;
            row = (await llCall({ action: "cancel", order_id: o.id })).row; draw(); toast(t("llCancelled"));
          }) : btn(t("llAgain"), () => pickPlace(quote))),
        LL.env !== "production" && !o.cancelled_at ? manualOut() : null,
        proofs.node);
    }
    // Quoted: show the price and book it (a quote lasts a few minutes)
    const want = wanted();
    const stale = row?.quotation_id ? llQuoteStale(o, row) || (want && (far(want.lat, row.lat) || far(want.lng, row.lng)) ? t("llStalePlace") : null) : null;
    const fresh = row?.quotation_id && row.quote_expires && Date.parse(row.quote_expires) > Date.now() + 15000 && !stale;
    if (stale && row.quote_expires && Date.parse(row.quote_expires) > Date.now()) {
      // Something changed since the price (florist, place, day or slot): ask for a new one
      const k = want ? { ...want, label: o.address || `${want.lat}, ${want.lng}` } : null;
      return fill(box, el("p", { class: "err", role: "alert" }, icon("alert"), " " + stale + " " + t("llStaleAgain")),
        el("div", { class: "btn-row" }, k ? btn(t("llGetPrice"), () => quote(k), true) : null, btn(t("llChangePlace"), () => pickPlace(quote), !k)));
    }
    if (fresh) {
      const pick = row.quote_for?.schedule;
      const phoneMissing = !phoneOk(o.customer_phone || o.buyer_phone) || !(o.customer_phone || o.buyer_phone);
      return fill(box,
        el("div", { class: "ll-line" }, el("b", { class: "ll-price" }, fee(row.quote_total, row.quote_currency)), el("span", { class: "note" }, t("llv_" + row.service) + " · " + t("llTier_" + (row.quote_for?.tier === "priority" ? "priority" : "regular")) + " · " + t("llValidUntil", { time: when(row.quote_expires) }))),
        // When the rider is really asked to come: a time, or now (also when "in the slot" was too close to keep)
        el("p", { class: "note ll-pickup" }, icon("clock"), " " + (pick ? t("llPickupAt", { time: when(pick) }) : t("llPickupNow")),
          row.quote_for?.wanted === "slot" && !pick ? el("b", {}, " " + t("llSlotTooClose")) : null),
        shopLine(), el("p", { class: "note" }, t("llDeliverTo") + " " + (row.place || "")), coordsLink(row.lat, row.lng),
        o.status !== "Ready" ? el("p", { class: "note" }, icon("alert"), " " + t("llNotReady")) : null,
        phoneMissing ? el("p", { class: "err" }, t("llNeedPhone")) : null, err,
        el("div", { class: "btn-row" },
          phoneMissing ? null : btn(t("llBook"), async () => {
            if (!(await askConfirm(t("llBookAsk", { fee: fee(row.quote_total, row.quote_currency) }), t("llBook"), { detail: LL.env === "production" ? t("llBookLive") : t("llBookSandbox") }))) return;
            // A failed or unclear booking still changed the row (the attempt is noted): show it as it is now
            try { row = (await llCall({ action: "book", order_id: o.id })).row; draw(); toast(t("llBooked")); }
            catch (x) { await reload().catch(() => {}); throw x; }
          }, true),
          btn(t("llChangePlace"), () => pickPlace(quote))),
        manualOut());
    }
    // Nothing yet (or the quote expired): start from the last confirmed point, else the one saved with the order (033).
    const known = want ? { ...want, label: o.address || `${want.lat}, ${want.lng}` }
      : row?.lat != null ? { lat: +row.lat, lng: +row.lng, label: row.place || `${row.lat}, ${row.lng}` } : null;
    // The rider picks up at the assigned florist's shop, so there has to be one first.
    if (!llShopOf(o)) {
      const m = S.members.find((x) => x.email === o.vendor_email);
      // The florist can't fix this herself: tell her to ask, and let her take it out by hand meanwhile
      const msg = !m ? t("llNoFlorist") : isAdmin() ? t("llShopMissing", { name: m.name }) : t("llShopMissingMine");
      return fill(box, err, el("p", { class: "note" }, icon("flower"), " " + msg), manualOut());
    }
    return fill(box, err, shopLine(),
      known ? el("p", { class: "note" }, t("llDeliverTo") + " " + known.label) : el("p", { class: "note" }, t("llIntro")),
      known ? coordsLink(known.lat, known.lng) : null,
      el("div", { class: "btn-row" },
        known ? btn(t("llGetPrice"), () => quote(known), true) : null,
        btn(known ? t("llChangePlace") : t("llStart"), () => pickPlace(quote), !known)),
      manualOut());
  }

  (async () => {
    if (!llCanBook(o) || !(await llDetect().catch(() => false))) return;
    sec.hidden = false;
    row = (await sb.from("cdf_lalamove").select("*").eq("order_id", o.id).maybeSingle()).data;
    draw();
    // Live: the webhook updates the row and the panel follows
    chan = sb.channel("ll-" + o.id).on("postgres_changes", { event: "*", schema: "public", table: "cdf_lalamove", filter: "order_id=eq." + o.id }, (p) => {
      if (!sec.isConnected) { sb.removeChannel(chan); return; }
      if (p.new?.order_id && !busy) { row = p.new; draw(); }
    }).subscribe();
    const stop = setInterval(() => { if (!sec.isConnected) { clearInterval(stop); sb.removeChannel(chan); } }, 3000);
    // The pin was changed in the form: show that point here straight away (not while a rider is booked)
    document.getElementById("f-drop")?.addEventListener("change", () => { if (sec.isConnected && !busy && !(row?.ll_order_id && LL_ACTIVE.has(row.status))) draw(); });
    if (row?.ll_order_id && LL_ACTIVE.has(row.status) && LL.cap === "ready") llCall({ action: "refresh", order_id: o.id }).then((d) => { if (d?.row && !busy) { row = d.row; draw(); } }).catch(() => {});
  })().catch(() => { sec.hidden = true; });
  return sec;
}
