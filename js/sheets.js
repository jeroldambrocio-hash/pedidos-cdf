// Sheets and dialogs: the order editor, the read-only order, the florist/driver forms, confirmations,
// and the guarded status changes. One sheet at a time; a confirmation can sit on top of it.

// ---------- layers: focus, Escape, unsaved changes ----------
let sheet = null; // { node, scrim, dirty(), dispose(), back }
// A layer that is already animating out doesn't count, so a quick second Escape reaches the one below it
const layers = () => [...document.querySelectorAll("#sheetRoot .scrim:not(.leaving), #dialogRoot .scrim:not(.leaving)")];
function trapKeys(e) {
  const top = layers().pop();
  if (!top) return;
  if (e.key === "Escape") { e.preventDefault(); top.dispatchEvent(new Event("dismiss")); return; }
  if (e.key !== "Tab") return;
  const box = top.firstElementChild;
  const items = [...box.querySelectorAll("button:not(:disabled),a[href],input:not([hidden]):not(:disabled),select:not(:disabled),textarea,summary")].filter((n) => n.getClientRects().length);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
}
document.addEventListener("keydown", trapKeys);

// Ask before something with consequences. Resolves true when confirmed.
function askConfirm(text, okLabel, { danger = false, detail } = {}) {
  return new Promise((resolve) => {
    const back = document.activeElement;
    const scrim = el("div", { class: "scrim center-scrim" });
    const done = async (v) => {
      if (!scrim.isConnected) return;
      scrim.classList.add("leaving");
      if (!prefersReducedMotion()) await wait(330);
      scrim.remove(); back?.focus?.(); resolve(v);
    };
    const ok = el("button", { class: "btn " + (danger ? "danger-solid" : "primary"), type: "button", onclick: () => done(true) }, okLabel);
    const box = el("div", { class: "dialog", role: "alertdialog", "aria-modal": "true", tabindex: "-1", "aria-labelledby": "askText" },
      el("div", { class: "sheet-body" }, el("p", { id: "askText", class: "dialog-text" }, text), detail ? el("div", { class: "hint" }, detail) : null),
      el("div", { class: "sheet-foot" }, el("button", { class: "btn", type: "button", onclick: () => done(false) }, t("cancel")), ok));
    scrim.append(box);
    closeOnBackdrop(scrim, () => done(false));
    scrim.addEventListener("dismiss", () => done(false));
    $("dialogRoot").append(scrim);
    queueMicrotask(() => ok.focus());
  });
}

// Open a sheet; `dirty` says whether closing would lose something the person typed.
function openLayer(node, { dirty = () => false, dispose = () => {} } = {}) {
  setDrawer(false, false);
  closeSheet(true);
  const back = document.activeElement;
  const scrim = el("div", { class: "scrim" });
  scrim.append(node);
  closeOnBackdrop(scrim, () => closeSheet());
  scrim.addEventListener("dismiss", () => closeSheet());
  $("sheetRoot").append(scrim);
  document.body.classList.add("locked");
  node.tabIndex = -1;
  const content = node.querySelector(".sheet-body"); if (content) stagger(content);
  sheet = { node, scrim, dirty, dispose, back };
  const title = node.querySelector("h2");
  if (title) { title.id = "sheetTitle"; node.setAttribute("aria-labelledby", "sheetTitle"); }
  queueMicrotask(() => node.focus());
  return sheet;
}
// Closing asks first when there are unsaved changes; force skips the question (after saving).
async function closeSheet(force = false) {
  if (!sheet) return true;
  const s = sheet;
  if (!force && s.dirty() && !(await askConfirm(t("draftWarning"), t("discard"), { danger: true }))) return false;
  if (sheet !== s) return true;
  sheet = null;
  s.dispose();
  document.body.classList.remove("locked");
  if (!force && !prefersReducedMotion()) { s.scrim.classList.add("leaving"); await wait(330); }
  s.scrim.remove();
  if (s.back?.isConnected) s.back.focus();
  return true;
}

let fieldId = 0;
const field = (label, ...kids) => {
 const caption = el("span", { id: "field-label-" + (++fieldId) }, label);
 const box = el("div", { class: "field" }, caption, ...kids);
 box.querySelectorAll("input:not([type=file]),textarea,select").forEach(input => {
   if (!input.hasAttribute("aria-label")) input.setAttribute("aria-labelledby", caption.id);
 });
 return box;
};
// Required fields carry a red asterisk; the whole field shakes and turns red when left empty
const reqField = (label, ...kids) => {
 const box = field(label, ...kids); box.firstElementChild.append(el("b", {class:"req","aria-hidden":"true"}," *")); return box;
};
const checkRow = (input, label) => el("label", { class: "check" }, input, el("span", { class: "box", "aria-hidden": "true" }, icon("tick")), el("span", {}, label));
const closeBtn = () => el("button", { class: "btn icon ghost", type: "button", "aria-label": t("close"), onclick: () => closeSheet() }, icon("close"));

// A small sheet with a form and one confirm button; onConfirm returns an error message or nothing.
function miniSheet(title, nodes, confirmLabel, onConfirm, { dirty, dispose } = {}) {
  const err = el("div", { class: "err", role: "alert" });
  const ok = el("button", { class: "btn primary", type: "submit" }, confirmLabel);
  const form = el("form", { class: "sheet", role: "dialog", "aria-modal": "true", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ""; ok.disabled = true; ok.classList.add("busy");
    let msg;
    try { msg = await onConfirm((m) => (err.textContent = m)); } catch (x) { msg = x.message || String(x); }
    ok.disabled = false; ok.classList.remove("busy");
    if (msg) err.textContent = msg;
  } },
    el("div", { class: "sheet-head" }, el("h2", {}, title), el("span", { class: "spacer" }), closeBtn()),
    el("div", { class: "sheet-body" }, el("section", {}, ...nodes, err)),
    el("div", { class: "sheet-foot" }, el("span", { class: "spacer" }), el("button", { class: "btn", type: "button", onclick: () => closeSheet() }, t("cancel")), ok));
  openLayer(form, { dirty, dispose });
  return form;
}

// ---------- status changes ----------
// Staff write the row; florists and drivers go through cdf_progress(), which checks what they may do.
function setStep(id, k, extra = {}) {
  const s = STEPS.find((x) => x.k === k);
  if (isStaff()) return sb.from("cdf_orders").update({ status: s.status, delivery: s.delivery, ...extra }).eq("id", id).select().single();
  return sb.rpc("cdf_progress", { p_id: id, p_step: k, p_note: extra.delivery_note ?? null,
    p_proof: extra.proof_path ?? null, p_set_proof: "proof_path" in extra });
}
// Optimistic: the card moves at once and goes back if the server says no.
async function advance(o, i) {
  if (S.pending.has(o.id)) return;
  S.pending.add(o.id);
  const step = STEPS[i], prev = { status: o.status, delivery: o.delivery };
  Object.assign(o, { status: step.status, delivery: step.delivery }); render();
  try {
    const { data, error } = await setStep(o.id, step.k);
    if (error) throw error;
    if (data) Object.assign(o, data);
    if (step.k === "transit") watchMail(o);
  } catch (e) { Object.assign(o, prev); toast(t("statusFail") + (e?.message ? " · " + e.message : "")); }
  finally {
    S.pending.delete(o.id); render();
    if (!prefersReducedMotion()) requestAnimationFrame(() => document.querySelector(`#list .entry[data-id="${o.id}"] .step.cur`)?.classList.add("pop"));
  }
}
// A tap on a step. Steps with consequences ask first or open their form:
// On the way emails the customer, Delivered asks for the proof, Nobody home asks for a new date,
// and going back a step says what the customer will see.
async function requestStep(o, i) {
  const cur = stepOf(o);
  if (cur === CANCELLED) { toast(t("isCancelled"), { type: "error" }); return; }
  if (i === cur || S.pending.has(o.id)) return;
  // Pickup: no On the way; Picked up and Not collected only ask to confirm (no photo, no new date)
  if (isPickup(o)) {
    if (i === 2) { toast(t("pickupNoTransit"), { type: "error" }); return; }
    if (i === 3 && !(await askConfirm(t("confirmPickedUp", { num: o.num }), t("markPickedUp")))) return;
    if (i === 4 && !(await askConfirm(t("confirmNotCollected", { num: o.num }), t("markNotCollected"), { detail: t("notCollectedHint") }))) return;
    if (i < cur && i !== 3 && !(await askConfirm(t("confirmBack", { num: o.num, step: stepName(i, o) }), t("moveBack"), { detail: t("confirmBackHint") }))) return;
    return advance(o, i);
  }
  if (i === 3) return deliverDialog(o);
  if (i === 4) return missedDialog(o);
  if (i === 2) {
    const to = (o.customer_email || "").trim();
    const ok = await askConfirm(t("confirmTransit", { num: o.num }), t("markTransit"),
      { detail: to ? t("transitMailTo", { to }) : t("transitNoMail") });
    if (!ok) return;
  } else if (i < cur && !(await askConfirm(t("confirmBack", { num: o.num, step: stepName(i) }), t("moveBack"), { detail: t("confirmBackHint") }))) return;
  return advance(o, i);
}
// The automatic email is sent by the server a moment later: report what really happened.
async function watchMail(o) {
  const to = (o.customer_email || "").trim();
  if (!to) { toast(t("outNoMail")); return; }
  toast(t("outSending", { to }));
  const since = new Date(Date.now() - 5000).toISOString();
  for (let i = 0; i < 6; i++) {
    await wait(3000);
    const { data } = await sb.from("cdf_notifications").select("ok,detail,created_at").eq("order_id", o.id).eq("channel", "email")
      .eq("audience", "customer").eq("recipient", to).gte("created_at", since).order("created_at", { ascending: false }).limit(1);
    const n = data?.[0];
    if (n) { toast(n.ok ? t("mailSent", { to }) : t("mailFail", { msg: n.detail.replace(/^\w+:\s*/, "") }), { ms: 6000 }); return; }
  }
  toast(t("mailUnknown"), { ms: 6000 });
}

// Ready: straight to the next step (the bouquet photo was dropped on 8/11/2026)
function readyDialog(o) { return advance(o, 1); }
function deliverDialog(o) {
  let setErr;
  const proof = photoPicker({ current: o.proof_path, hint: t("proofHint"), alt: t("proofPhoto"), onErr: (m) => setErr?.(m) });
  const note = el("textarea", { placeholder: t("deliveredNotePh"), rows: 2 });
  // Tracking off: nobody would read a note for the customer, and it would replace the delivery instructions
  miniSheet(t("deliverTitle", { num: o.num }), [field(t("proofPhoto"), proof.node), feature("tracking") ? field(t("noteOpt"), note) : null], t("confirmDelivered"), async (se) => {
    setErr = se;
    const extra = {}, pp = await proof.upload(o.id);
    if (pp !== undefined) extra.proof_path = pp;
    if (note.value.trim()) extra.delivery_note = note.value.trim();
    const { data, error } = await setStep(o.id, "done", extra);
    if (error) return t("saveFail", { msg: error.message });
    await proof.cleanup();
    upsertLocal(data || { ...o, ...extra, status: "Ready", delivery: "Delivered" });
    await closeSheet(true); toast(t("deliveredOk")); render();
  }, { dirty: () => proof.dirty || !!note.value.trim(), dispose: () => proof.dispose() });
}
// Nobody home: photo of the door, a new date and time, and the order goes back to Ready for that day.
// The note is for the customer, so it is written in English.
function missedDialog(o) {
  if (isPickup(o)) return pickupRescheduleDialog(o);
  let setErr;
  const proof = photoPicker({ current: o.proof_path, hint: t("proofHint"), alt: t("proofPhoto"), onErr: (m) => setErr?.(m) });
  const iDate = el("input", { type: "date", value: addDays(S.today, 1), min: isStaff() ? null : S.today, required: true });
  const iSlot = slotPicker(o.slot);
  const track = feature("tracking");
  const note = el("textarea", { placeholder: t(track ? "missedNotePh" : "riderNotePh"), rows: 2 });
  miniSheet(t("missedTitle", { num: o.num }), [
    el("p", { class: "note", style: "margin:0" }, t("missedHint")),
    field(t("proofPhoto"), proof.node),
    el("div", { class: "row2 when-row" }, field(t("newDate"), iDate), field(t("newSlot"), iSlot)),
    field(t(track ? "noteOpt" : "riderNoteOpt"), note)], t("confirmMissed"), async (se) => {
    setErr = se;
    const slot = iSlot.value();
    if (!iDate.value || !slot) return t("slotInvalid");
    const at = new Intl.DateTimeFormat("en-PH", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date());
    const when = fromIso(iDate.value).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" });
    // With tracking on, the customer reads this on their link; off, it is only the rider's instructions (kept if empty)
    const text = note.value.trim() || (track ? `We came at ${at} but nobody was home. We'll come back on ${when}, ${slot}.` : null);
    if (typeof llReleaseRider === "function" && !(await llReleaseRider(o))) return t("llReleaseStopped");
    const pp = await proof.upload(o.id);
    const { data, error } = await sb.rpc("cdf_reschedule", { p_id: o.id, p_date: iDate.value, p_slot: slot, p_note: text,
      p_proof: pp ?? null, p_set_proof: pp !== undefined });
    if (error) return t("saveFail", { msg: error.message });
    await proof.cleanup();
    if (data) upsertLocal(data);
    await closeSheet(true); toast(t("rescheduled", { date: shortDate(iDate.value) })); loadOrders();
  }, { dirty: () => proof.dirty || !!note.value.trim(), dispose: () => proof.dispose() });
}

// Not collected: the customer will come another day. New date and time; the order goes back to Ready for pickup.
function pickupRescheduleDialog(o) {
  const iDate = el("input", { type: "date", value: addDays(S.today, 1), min: isStaff() ? null : S.today, required: true });
  const iSlot = slotPicker(o.slot);
  miniSheet(t("pickupRescheduleTitle", { num: o.num }), [
    el("p", { class: "note", style: "margin:0" }, t("pickupRescheduleHint")),
    el("div", { class: "row2 when-row" }, field(t("newDate"), iDate), field(t("newSlot"), iSlot))], t("confirmMissed"), async () => {
    const slot = iSlot.value();
    if (!iDate.value || !slot) return t("slotInvalid");
    const { data, error } = await sb.rpc("cdf_reschedule", { p_id: o.id, p_date: iDate.value, p_slot: slot, p_note: null, p_proof: null, p_set_proof: false });
    if (error) return t("saveFail", { msg: error.message });
    if (data) upsertLocal(data);
    await closeSheet(true); toast(t("rescheduled", { date: shortDate(iDate.value) })); loadOrders();
  });
}

// Time slot: pick "From" (every half hour); "To" fills itself one hour later. Stored as "H:MM - H:MM".
function slotPicker(val) {
  const m = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(val || "");
  const mins = (h, mm) => +h * 60 + +mm;
  const fmt = (n) => Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
  const opts = (sel, from = 0, last = 23 * 60 + 30) => {
    const list = Array.from({ length: 49 }, (_, i) => i * 30).filter((n) => n >= from && n <= last);
    if (sel != null && !list.includes(sel)) list.push(sel), list.sort((x, y) => x - y); // keep an old value off the grid
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
  const box = el("div", { class: "slot-pick" }, from, el("span", { class: "slot-arrow", "aria-hidden": "true" }, "→"), to);
  box.first = from;
  box.value = () => (from.value === "" || to.value === "" || +to.value <= +from.value ? "" : fmt(+from.value) + " - " + fmt(+to.value));
  return box;
}

// ---------- notices and history ----------
const CH_LABEL = { email: "Email", whatsapp: "WhatsApp", telegram: "Telegram", viber: "Viber", copy: t("copyShort") };
function notifyMsg(o, name, k) {
  const st = { prep: "msgPrep", ready: "msgReady", transit: "msgTransit", done: "msgDone", fail: "msgFail", cancel: "msgCancel" }[k] || "msgTransit";
  return tIn("en", st, { name: name ? " " + name : "", num: o.num, link: trackUrl(o) });
}
async function logOpened(o, channel, recipient, label, message) {
  await sb.from("cdf_notifications").insert({ order_id: o.id, audience: "customer", channel, recipient, detail: label, subject: label, message, by_email: S.me.email });
}
const when = (ts) => new Date(ts).toLocaleString(locale(), { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function historyBlock(o) {
  const box = el("div", { class: "hist-list" });
  const load = async () => {
    const { data } = await sb.from("cdf_notifications").select("*").eq("order_id", o.id).order("created_at", { ascending: false }).limit(30);
    box.replaceChildren();
    if (!data?.length) { box.append(el("div", { class: "hint" }, t("histEmpty"))); return; }
    for (const n of data) {
      const state = n.channel !== "email" ? t("histOpened") : n.ok ? t("histSent") : t("histFailed");
      const label = n.ok ? String(n.detail || "").replace(/^\w+:\s*/, "") : "";
      const what = n.audience === "vendor" ? n.subject : label ? label.replace(/^automatic, /, t("histAuto") + " · ") : n.subject;
      box.append(el("details", { class: "hrow" + (n.ok ? "" : " bad") },
        el("summary", {},
          el("span", { class: "hwhen" }, when(n.created_at)),
          el("span", { class: "hwho" }, (n.audience === "vendor" ? t("histVendor") : t("histCustomer")) + " · " + (CH_LABEL[n.channel] || n.channel) + (n.recipient ? " · " + n.recipient : ""),
            what ? el("b", { class: "hwhat" }, what) : null),
          el("span", { class: "hstate" }, state)),
        el("div", { class: "hmsg" }, n.message || (n.ok ? "" : n.detail) || t("histNoText"))));
    }
  };
  load();
  box.reload = load;
  return box;
}
// Who changed what (migration 012). Photos show as "changed", never by their storage path.
const EV_FIELDS = { num: "orderNum", date: "date", slot: "slot", channel: "channel", vendor_email: "vendor", carrier_email: "carrier",
  customer_name: "customerName", customer_phone: "phone", customer_email: "email", buyer_name: "buyerName", buyer_phone: "buyerPhone",
  address: "deliveryAddr", card_message: "cardMsg", notes: "note", delivery_note: "deliveryNote", status: "status", delivery: "delivery", cancel_reason: "cancelReason",
  vehicle: "llVehicle", paid: "payPaidAmount", photo_path: "photo", bouquet_path: "bouquetPhoto", proof_path: "proofPhoto", extra_photos: "extraPhotos", amount: "amount", pickup: "f_pickup", delete_reason: "f_delete_reason" };
const evValue = (k, v) => {
  if (v === null || v === "" || v === undefined) return "—";
  if (k === "pickup") return t(v ? "modePickup" : "modeDelivery");
  if (typeof v === "boolean") return v ? t("evPhotoYes") : t("evPhotoNo");
  if (k === "vendor_email" || k === "carrier_email") return memberName(v);
  if (k === "amount" || k === "paid") return paymentPesos(v);
  if (k === "date") return shortDate(v);
  if (k === "status" || k === "delivery") return t("db_" + String(v).replace(/\W/g, "")) || v;
  return String(v);
};
function eventsBlock(o) {
  const box = el("div", { class: "hist-list" });
  (async () => {
    const { data, error } = await sb.from("cdf_order_events").select("*").eq("order_id", o.id).order("at", { ascending: false }).limit(50);
    if (error || !data?.length) { box.append(el("div", { class: "hint" }, t("evEmpty"))); return; }
    for (const ev of data) {
      const lines = Object.entries(ev.changes || {}).filter(([k]) => EV_FIELDS[k]).map(([k, v]) =>
        Array.isArray(v) ? el("li", {}, el("b", {}, t(EV_FIELDS[k])), " " + evValue(k, v[0]) + " → " + evValue(k, v[1])) : el("li", {}, el("b", {}, t(EV_FIELDS[k])), " " + evValue(k, v)));
      box.append(el("details", { class: "hrow" },
        el("summary", {}, el("span", { class: "hwhen" }, when(ev.at)),
          el("span", { class: "hwho" }, (ev.by_email ? memberName(ev.by_email) : t("evSystem")), el("b", { class: "hwhat" }, t("ev_" + ev.kind))),
          el("span", { class: "hstate" }, lines.length ? String(lines.length) : "")),
        lines.length ? el("ul", { class: "hmsg evlist" }, lines) : null));
    }
  })();
  return box;
}
function notifyRow(o, name, phone, stepK, hist) {
  const msg = () => notifyMsg(o, name(), stepK());
  const label = () => tIn("en", "st_" + stepK());
  const log = (channel, recipient) => logOpened(o, channel, recipient, label(), msg()).then(() => hist.reload());
  return el("div", { class: "notify-row" },
    el("button", { class: "btn", type: "button", onclick: () => {
      if (!phone()) { toast(t("needPhone"), { type: "error" }); return; }
      window.open("https://wa.me/" + intlPhone(phone()) + "?text=" + encodeURIComponent(msg()), "_blank", "noopener");
      log("whatsapp", phone());
    } }, icon("message"), "WhatsApp"),
    el("button", { class: "btn", type: "button", onclick: () => navigator.clipboard?.writeText(msg()).then(() => { toast(t("msgCopied")); log("copy", ""); }, () => toast(t("selectCopy"))) }, t("copyMsg")));
}
const mapLink = (a) => el("a", { href: mapsUrl(a), target: "_blank", rel: "noopener", class: "link-out" }, a + " ↗");

// Says that the order is cancelled, why, by whom and when (inside the order sheet)
const cancelNote = (o) => o?.cancelled_at ? el("div", { class: "sheet-note cancel-note", role: "status" }, icon("close"),
  el("div", {}, el("b", {}, t("cancelledBanner")),
    o.cancel_reason ? el("div", {}, o.cancel_reason) : null,
    el("small", {}, [o.cancelled_by ? memberName(o.cancelled_by) : null, when(o.cancelled_at)].filter(Boolean).join(" · ")))) : null;

// ---------- an order, read-only (florists and drivers) ----------
// (5) One "History": what changed, then the emails sent (they used to be two separate drop-downs)
function historySection(o, hist) {
  return el("section", {}, el("details", { class: "hist" }, el("summary", {}, t("historyAll")),
    S.cap.events ? el("div", { class: "hist-part" }, el("h4", {}, t("changeLog")), eventsBlock(o)) : null,
    el("div", { class: "hist-part" }, el("h4", {}, t("history")), hist)));
}
function openOrderView(o) {
  const hist = historyBlock(o), cur = stepOf(o);
  const node = el("div", { class: "sheet", role: "dialog", "aria-modal": "true" },
    el("div", { class: "sheet-head" }, el("h2", {}, t("order", { num: o.num })), badge(cur, o), el("span", { class: "spacer" }), closeBtn()),
    el("div", { class: "sheet-body" },
      cancelNote(o),
      el("section", {}, el("dl", { class: "ro" },
        el("dt", {}, t("dateSlot")), el("dd", {}, longDate(o.date) + " · " + o.slot),
        el("dt", {}, t("recipient")), el("dd", {}, o.customer_name || t("noName")),
        isPickup(o) ? [el("dt", {}, t("pickupTag")), el("dd", {}, (() => { const shop = pickupShop(o);
            return shop?.branch ? [el("b", {}, shop.branch), shop.address ? el("br") : null, shop.address ? mapLink(shop.address) : null] : t("pickupNoShop"); })())]
          : [el("dt", {}, t("address")), el("dd", {}, o.address ? mapLink(o.address) : t("noAddress"))],
        o.customer_phone ? [el("dt", {}, t("phoneShort")), el("dd", {}, el("a", { href: "tel:+" + intlPhone(o.customer_phone), class: "link-out" }, phoneNice(o.customer_phone)))] : null,
        o.card_message ? [el("dt", {}, t("cardMsg")), el("dd", { class: "msg" }, o.card_message)] : null,
        o.notes ? [el("dt", {}, t("note")), el("dd", {}, o.notes)] : null,
        o.photo_path ? [el("dt", {}, t("photo")), el("dd", {}, el("div", { class: "pic" }, imgOf(o.photo_path, bucket, t("photoAlt"), true)))] : null,
        o.extra_photos?.length ? [el("dt", {}, t("extraPhotos")), el("dd", {}, el("div", { class: "photo-grid ro" }, o.extra_photos.map((p, i) => el("div", { class: "pic" }, imgOf(p, ENTREGAS, t("extraPhotos") + " " + (i + 1), true)))))] : null,
        o.delivery_note ? [el("dt", {}, t("deliveryNote")), el("dd", {}, o.delivery_note)] : null,
        o.proof_path ? [el("dt", {}, t("proofPhoto")), el("dd", {}, el("div", { class: "pic" }, imgOf(o.proof_path, ENTREGAS, t("proofPhoto"))))] : null)),
      typeof orderReferences === "function" ? orderReferences(o) : null,
      chatSection(o),
      typeof lalamoveSection !== "function" || isPickup(o) ? null
        : o.status === "Ready" && o.delivery !== "Delivered" && !o.cancelled_at ? lalamoveSection(o)
        // Delivered or cancelled: only what Lalamove left (the proofs), if a rider was booked
        : o.delivery === "Delivered" || o.cancelled_at ? lalamoveSection(o, { proofsOnly: true }) : null,
      // Tracking off: no messages to the customer from the panel at all
      !feature("tracking") ? null : el("section", {}, el("h3", {}, t("notifyBuyer")),
        notifyRow(o, () => o.buyer_name || o.customer_name || "", () => o.buyer_phone || o.customer_phone || "", () => STEPS[stepOf(o)].k, hist)),
      historySection(o, hist)),
    el("div", { class: "sheet-foot" }, el("span", { class: "spacer" }), el("button", { class: "btn", type: "button", onclick: () => closeSheet() }, t("close"))));
  openLayer(node);
}

// ---------- the order editor (admin) ----------
// The draft belongs to whoever wrote it: on a shared phone or PC the next person never sees a
// customer's name or address from someone else's unsaved order. It also expires, and signing out
// clears it (main.js); it is only there to recover from a closed tab or a crash.
const DRAFT_KEY = "cdf-draft", DRAFT_TTL = 2 * 864e5;
const draftOwner = () => S.uid || S.me?.email || null;
const readDraft = () => {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (!v) return null;
    if (!v.owner || v.owner !== draftOwner() || !(Date.now() - v.at < DRAFT_TTL)) { localStorage.removeItem(DRAFT_KEY); return null; }
    return v.data;
  } catch { return null; }
};
const writeDraft = (v) => { try { const owner = draftOwner(); v && owner ? localStorage.setItem(DRAFT_KEY, JSON.stringify({ owner, at: Date.now(), data: v })) : localStorage.removeItem(DRAFT_KEY); } catch {} };
// Re-read the team first so the lists never hold an email that was changed in the meantime
async function openFresh(o, opts) {
  if (isStaff()) await loadMembers();
  if (isStaff()) openEditor(o, opts); else openOrderView(o);
}
function openOrder(o) { return openFresh(o); }

// Phone with a country picker in front (+63 by default): flag + code when closed; a searchable list with
// flag, country and code when open. Typing + or 00 in the number also works for any country.
const countryName = (iso) => { try { return new Intl.DisplayNames([LANG === "es" ? "es" : "en"], { type: "region" }).of(iso.toUpperCase()); } catch { return iso.toUpperCase(); } };
const flagImg = (iso) => iso ? el("img", { class: "flag", src: "/img/flags/" + iso + ".svg", alt: "", width: 22, height: 16, loading: "lazy", decoding: "async" }) : el("span", { class: "flag flag-other", "aria-hidden": "true" }, "+");
function phoneBox(input) {
  if (input.dataset.cc == null) input.dataset.cc = "63";
  const list = [...CCODES.map(([c, iso]) => ({ c, iso, name: countryName(iso) })), { c: "", iso: "", name: t("otherCode") }];
  const find = (c) => list.find((x) => x.c === c) || list[0];
  const trigger = el("button", { class: "cc", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false" });
  const search = el("input", { type: "search", class: "cc-search", placeholder: t("searchCountry"), "aria-label": t("searchCountry"), autocomplete: "off" });
  const results = el("div", { class: "cc-results", role: "listbox", "aria-label": t("countryCode") });
  const panel = el("div", { class: "cc-panel", hidden: true }, search, results);
  const box = el("div", { class: "phone-in" }, trigger, input);
  const wrap = el("div", { class: "phone-wrap" }, box, panel);
  const ph = () => { input.placeholder = input.dataset.cc === "63" ? "917 123 4567" : input.dataset.cc === "" ? "+00 000 000 000" : ""; };
  const sync = () => box.classList.toggle("intl", /^(\+|00)/.test(input.value.trim()) && !/^\+?63/.test(input.value.trim()));
  const paint = () => {
    const x = find(input.dataset.cc);
    trigger.replaceChildren(flagImg(x.iso), el("span", { class: "cc-dial" }, x.c ? "+" + x.c : "+…"), el("span", { class: "cc-caret", "aria-hidden": "true" }));
    trigger.setAttribute("aria-label", t("countryCode") + ": " + x.name + (x.c ? " +" + x.c : ""));
  };
  const renderList = () => {
    const q = norm(search.value.trim()).replace(/^\+/, "");
    results.replaceChildren(...list.filter((x) => !q || norm(x.name).includes(q) || x.iso.includes(q) || (x.c && x.c.startsWith(q))).map((x) => {
      const on = x.c === input.dataset.cc;
      return el("button", { type: "button", class: "cc-opt", role: "option", "aria-selected": String(on), onclick: () => choose(x.c) },
        flagImg(x.iso), el("span", { class: "cc-name" }, x.name), el("span", { class: "cc-code" }, x.c ? "+" + x.c : ""), el("span", { class: "cc-tick", "aria-hidden": "true" }, on ? "✓" : ""));
    }));
    if (!results.childElementCount) results.append(el("div", { class: "cc-empty", role: "status" }, t("noCountry")));
  };
  const onDoc = (e) => { if (!wrap.contains(e.target)) setOpen(false, false); };
  const setOpen = (open, focus = true) => {
    if (panel.hidden === !open) return;
    panel.hidden = !open; trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      search.value = ""; renderList(); search.focus({ preventScroll: true });
      results.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
      // Inside a sheet the list could open under the fixed footer: bring all of it into view
      requestAnimationFrame(() => panel.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" }));
      document.addEventListener("pointerdown", onDoc, true);
    }
    else { document.removeEventListener("pointerdown", onDoc, true); if (focus) trigger.focus(); }
  };
  const choose = (c) => { input.dataset.cc = c; paint(); ph(); sync(); setOpen(false, false); input.focus(); };
  trigger.addEventListener("click", () => setOpen(panel.hidden));
  search.addEventListener("input", renderList);
  panel.addEventListener("keydown", (e) => {
    const opts = [...results.querySelectorAll(".cc-opt")], i = opts.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); opts[Math.min(i + 1, opts.length - 1)]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (i <= 0 ? search : opts[i - 1]).focus(); }
    else if (e.key === "Enter" && document.activeElement === search) { e.preventDefault(); opts[0]?.click(); }
  });
  input.setAttribute("aria-label", t("phone"));
  input.addEventListener("input", () => { if (input.dataset.cc === "63" && /^(\+?\s*63|0)\s*9/.test(input.value)) input.value = input.value.replace(/^(\+?\s*63|0)\s*/, ""); sync(); });
  // Code that sets the number later (the "same person" copy) can repaint the picker
  input.addEventListener("cc-change", () => { paint(); ph(); sync(); });
  paint(); ph(); sync();
  return wrap;
}

const ORDER_FIELDS = ["num", "date", "slot", "channel", "vendor_email", "carrier_email", "customer_name", "address", "customer_phone",
  "customer_email", "buyer_name", "buyer_phone", "card_message", "delivery_note", "notes", "amount"];
// Payment proofs an order's saved payments refer to (Set of storage paths), or null when it can't be read:
// before removing files after a refused save, so a payment that was saved never loses its proof.
async function proofsInUse(orderId) {
  const { data, error } = await sb.from("cdf_order_prices").select("pay_proofs, payment_history").eq("order_id", orderId).maybeSingle();
  if (error) return null;
  const used = new Set(data?.pay_proofs || []);
  for (const m of data?.payment_history || []) for (const p of m?.proofs || []) used.add(p);
  return used;
}

function openEditor(o, { copyFrom, draft, fromRequest } = {}) {
  let isNew = !o;
  const newOrderForm = isNew && !copyFrom;
  // Next number: the highest of the orders on screen and the latest ones in the database (orders far ahead or
  // long ago aren't loaded, and another admin may have just added one). The database still refuses a repeat.
  const nextNum = String(Math.max(0, S.numTop || 0, ...S.orders.map((x) => (/^\d+$/.test(x.num) ? +x.num : 0))) + 1).padStart(4, "0");
  // No florist by default: an unassigned order shows up as such instead of landing on someone by accident.
  const blank = { num: nextNum, date: S.sel, slot: "", channel: "", vendor_email: "", carrier_email: "", customer_name: "", address: "", customer_phone: "",
    customer_email: "", buyer_name: "", buyer_phone: "", card_message: "", delivery_note: "", notes: "", amount: "" };
  const src = o || (copyFrom ? { ...blank, ...Object.fromEntries(["slot", "channel", "vendor_email", "customer_name", "address", "customer_phone", "customer_email", "buyer_name", "buyer_phone", "card_message"].map((k) => [k, copyFrom[k] ?? ""])), pickup: !!copyFrom.pickup } : draft ? { ...blank, ...draft } : blank);
  const f = Object.fromEntries(ORDER_FIELDS.map((k) => [k, src[k] ?? ""]));
  const sel = (id, opts, val) => el("select", { id }, ...opts.map(([v, l]) => el("option", { value: v, selected: v === val }, l)));
  const err = el("div", { class: "err", role: "alert" });
  const setErr = (m) => (err.textContent = m);

  const iDate = el("input", { type: "date", id: "f-date", value: f.date, required: true });
  const iSlot = slotPicker(f.slot);
  const iNum = el("input", { id: "f-num", value: f.num, inputmode: "numeric", class: "num", required: true });
  const iName = el("input", { id: "f-name", value: f.customer_name, placeholder: t("namePh"), autocomplete: "off" });
  const iAddr = el("input", { id: "f-addr", value: f.address, placeholder: t("addrPh"), autocomplete: "off" });
  // The exact point for Lalamove (033): a Google Maps link or "lat, lng", read once here so booking a rider
  // later goes straight to the price. Short links (maps.app.goo.gl) are opened by the server.
  const storedPoint = o || copyFrom || draft;
  const iDrop = S.cap.drop ? el("input", { id: "f-drop", inputmode: "url", autocomplete: "off", placeholder: t("dropPh"),
    value: storedPoint?.drop_lat != null ? `${+storedPoint.drop_lat}, ${+storedPoint.drop_lng}` : "" }) : null;
  const dropNote = el("small", { class: "note" });
  // Lalamove vehicle (036): motorcycle unless the arrangement needs a car
  const vehNow = (o ? o.vehicle : copyFrom ? copyFrom.vehicle : draft?.vehicle) || "";
  let vehVal = vehNow === "MOTORCYCLE" ? "" : vehNow;
  const iVeh = S.cap.vehicle ? el("div", { class: "seg veh-seg", id: "f-vehicle", role: "group", "aria-label": t("llVehicle") },
    ...[["", "MOTORCYCLE"], ["SEDAN", "SEDAN"], ["MPV", "MPV"]].map(([v, k]) => el("button", { type: "button", "data-v": v, "aria-pressed": String(v === vehVal),
      onclick: (e) => { vehVal = v; e.currentTarget.parentNode.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v))); } }, t("llv_" + k)))) : null;
  if (iVeh) Object.defineProperty(iVeh, "value", { get: () => vehVal });
  const dropPoint = () => (iDrop && iDrop.value.trim() ? (typeof llParseCoords === "function" ? llParseCoords(iDrop.value) : null) : null);
  const paintDrop = () => {
    if (!iDrop) return;
    const p = dropPoint(), v = iDrop.value.trim();
    iDrop.closest(".field")?.classList.toggle("invalid", !!v && !p);
    fill(dropNote, !v ? t("dropHint") : p ? el("a", { class: "link-out", target: "_blank", rel: "noopener", href: `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` }, t("dropOk")) : t("dropBad"));
  };
  // "Find on the map": search the typed address and pick the right result (no Maps link needed)
  const dropHits = el("div", { class: "ll-results" });
  const setPoint = (r) => { iDrop.value = fromAddr = `${r.lat}, ${r.lng}`; paintDrop(); iDrop.dispatchEvent(new Event("change", { bubbles: true })); };
  // auto: right after the address is typed, take the first result and say which place it is (one tap to see others).
  // A point that came from the address (auto or picked from the list) belongs to that address: change the
  // address and it's cleared and looked up again. A pasted Maps link stays. Late answers for an older text are dropped.
  let lastAuto = "", fromAddr = "", seq = 0;
  const addrAtOpen = iAddr.value.trim(), dropAtOpen = iDrop ? iDrop.value.trim() : "";
  if (iDrop) iAddr.addEventListener("input", () => {
    if (fromAddr && iDrop.value.trim() === fromAddr) { iDrop.value = ""; fromAddr = ""; lastAuto = ""; dropHits.replaceChildren(); paintDrop(); }
    // A saved order whose address changes but keeps its old point: don't guess, ask to check it
    else if (dropAtOpen && iDrop.value.trim() === dropAtOpen && iAddr.value.trim() !== addrAtOpen && !dropHits.querySelector(".drop-check"))
      fill(dropHits, el("p", { class: "note warn drop-check" }, icon("alert"), " " + t("dropCheckAgain") + " ",
        el("button", { class: "linkish", type: "button", onclick: (e) => { iDrop.value = ""; dropHits.replaceChildren(); paintDrop(); locate(true, e.currentTarget); } }, t("dropFindAgain"))));
    seq++;
  });
  async function locate(auto, b) {
    const q = iAddr.value.trim(), my = ++seq;
    if (!q) { if (!auto) { iAddr.closest(".field").classList.add("invalid"); iAddr.focus(); } return; }
    if (b) { b.disabled = true; b.classList.add("busy"); }
    try {
      const { results } = await llCall({ action: "geocode", query: q });
      if (my !== seq || iAddr.value.trim() !== q) return; // the address changed while searching
      if (!results.length) return fill(dropHits, el("p", { class: "note" }, t("llNoHits")));
      const list = () => fill(dropHits, results.map((r) => el("button", { class: "ll-hit", type: "button", onclick: () => { setPoint(r); dropHits.replaceChildren(); } }, icon("map"), el("span", {}, r.label))));
      if (!auto) return list();
      setPoint(results[0]);
      fill(dropHits, el("p", { class: "note drop-found" }, icon("map"), " " + t("dropFound", { place: results[0].label }) + " ",
        results.length > 1 ? el("button", { class: "linkish", type: "button", onclick: list }, t("dropOthers")) : null));
    } catch (x) { if (!auto) fill(dropHits, el("p", { class: "err" }, x.message)); }
    finally { if (b) { b.disabled = false; b.classList.remove("busy"); } }
  }
  const dropFind = iDrop && typeof llCall === "function" ? el("button", { class: "linkish", type: "button", id: "f-dropfind", onclick: (e) => locate(false, e.currentTarget) }, icon("search"), " " + t("dropFind")) : null;
  // The pin put by hand on a map: for addresses the search doesn't know (house numbers, villages)
  const dropMap = iDrop && typeof llPickOnMap === "function" ? el("button", { class: "linkish", type: "button", id: "f-dropmap", onclick: async () => {
    const p = await llPickOnMap(dropPoint(), iAddr.value.trim());
    if (!p) return;
    iDrop.value = `${p.lat}, ${p.lng}`; fromAddr = ""; dropHits.replaceChildren(); paintDrop();
    iDrop.dispatchEvent(new Event("change", { bubbles: true }));
  } }, icon("map"), " " + t("mapPickBtn")) : null;
  if (dropFind) iAddr.addEventListener("blur", () => {
    const q = iAddr.value.trim();
    if (q.length >= 8 && !iDrop.value.trim() && q !== lastAuto) { lastAuto = q; locate(true); }
  });
  if (iDrop) {
    iDrop.addEventListener("input", paintDrop);
    // A short share link: let the server open it and keep the point it leads to
    iDrop.addEventListener("change", async () => {
      const v = iDrop.value.trim();
      if (!v || dropPoint() || !/goo\.gl\//i.test(v) || typeof llCall !== "function") return;
      fill(dropNote, t("dropResolving"));
      try { const r = (await llCall({ action: "geocode", query: v })).results?.[0]; if (r) iDrop.value = `${r.lat}, ${r.lng}`; } catch {}
      paintDrop();
    });
  }
  const iPhone = el("input", { id: "f-phone", type: "tel", inputmode: "tel", value: phLocal(f.customer_phone), "data-cc": phSplit(f.customer_phone).cc, placeholder: "917 123 4567", autocomplete: "off" });
  const iEmail = el("input", { id: "f-email", type: "email", value: f.customer_email, placeholder: "cliente@email.com", autocomplete: "off" });
  const iBName = el("input", { id: "f-bname", value: f.buyer_name, placeholder: t("buyerNamePh"), autocomplete: "off" });
  const iBPhone = el("input", { id: "f-bphone", type: "tel", inputmode: "tel", value: phLocal(f.buyer_phone), "data-cc": phSplit(f.buyer_phone).cc, placeholder: "917 123 4567", autocomplete: "off" });
  // Not a gift: the buyer is the recipient, so their name and phone are only asked once
  const same = isNew && !copyFrom && !draft ? false : (!f.buyer_name || (f.buyer_name === f.customer_name && f.buyer_phone === f.customer_phone));
  if (same && !f.buyer_name) { iBName.value = f.customer_name; iBPhone.value = phLocal(f.customer_phone); iBPhone.dataset.cc = phSplit(f.customer_phone).cc; }
  const iSame = el("input", { type: "checkbox", id: "f-same", checked: same });
  const iCard = el("textarea", { id: "f-card", placeholder: t("cardPh"), rows: newOrderForm ? 1 : 2 }, f.card_message);
  const iDNote = el("textarea", { id: "f-dnote", placeholder: t("deliveryNotePh"), rows: newOrderForm ? 1 : 2 }, f.delivery_note);
  const iNotes = el("textarea", { id: "f-notes", placeholder: t("notesPh"), rows: newOrderForm ? 1 : 3 }, f.notes);
  const iAmount = el("input", { id: "f-amount", type: "number", inputmode: "decimal", min: 0, step: 0.01, max: 99999999.99, placeholder: "2500", value: f.amount ?? "", "aria-label": t("payOrderTotal") });
  // Florists: available on the order's date first, absences marked; redone when the date changes
  const iVend = el("select", { id: "f-vendor" }, el("option", { value: "" }, t("unassigned")), ...vendorOptions(f.date, f.vendor_email));
  iDate.addEventListener("change", () => { const v = iVend.value; iVend.replaceChildren(el("option", { value: "" }, t("unassigned")), ...vendorOptions(iDate.value, v)); iVend.value = v; });
  // Phase 4: the shop nearest to the delivery point, suggested beside the florist picker (admins)
  const shops = isAdmin() && S.cap.ranking && typeof shopSuggestion === "function" ? shopSuggestion(iVend) : null;
  // Delivery or pickup (12/11/2026): a pickup has no address, no pin, no rider; the shop is the florist's
  let pickupVal = !!src.pickup;
  const inTransit = o && baseStep(o) === 2;
  const pickupInfo = el("p", { class: "note pickup-info", role: "status" });
  const iMode = S.cap.pickupMode ? el("div", { class: "seg mode-seg", id: "f-mode", role: "group", "aria-label": t("fulfilment") },
    ...[[false, "modeDelivery", "truck"], [true, "modePickup", "box"]].map(([v, k, ic]) => el("button", { type: "button", "data-pickup": String(v), "aria-pressed": String(v === pickupVal),
      disabled: v && inTransit, title: v && inTransit ? t("pickupNotWhileTransit") : null,
      onclick: (e) => { if (pickupVal === v) return; pickupVal = v; e.currentTarget.parentNode.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pickup === String(v)))); syncMode(); keepDraft(); } },
      icon(ic), " " + t(k)))) : null;
  const paintPickupInfo = () => {
    const shop = pickupShop({ vendor_email: iVend.value });
    fill(pickupInfo, !iVend.value ? t("pickupChooseFlorist") : shop?.branch ? [t("pickupAt", { shop: shop.branch }), shop.address ? " · " + shop.address : ""] : t("pickupFloristNoShop"));
  };
  iVend.addEventListener("change", paintPickupInfo);
  const iCarr = S.cap.carrier && feature("drivers") ? sel("f-carrier", [["", t("anyCarrier")], ...S.members.filter((m) => m.role === "carrier").map((m) => [m.email, m.name])], f.carrier_email) : null;
  const shot = photoPicker({ current: o?.photo_path, bkt: bucket, hint: t("pasteHint"), alt: t("photoAlt"), onErr: setErr, paste: true, expand: true });
  // Extra photos (030); a stand-in that never changes anything while the column isn't there
  const extras = S.cap.extra ? photoList({ current: o?.extra_photos, alt: t("extraPhotos"), onErr: setErr })
    : { node: null, dirty: false, upload: async () => undefined, cleanup: async () => {}, dispose() {} };
  const proof = photoPicker({ current: o?.proof_path, hint: t("proofHint"), alt: t("proofPhoto"), onErr: setErr, expand: true });
  const initialProof = o?.proof_path || null; // what the delivery photo was when this editor opened (audit F12)
  const payOn = priceEditable() && S.cap.paid;
  const iPayment = el("input", { id: "f-payment", type: "number", inputmode: "decimal", min: 0.01, step: 0.01, max: 99999999.99 });
  // A new order can be saved with its first payment (down payment): order, price and payment go to the
  // server as one operation (cdf_create_order), so there is never an order whose price or payment got lost.
  const createOn = isNew && isAdmin() && !!S.cap.create, downOn = createOn && payOn;
  const iDown = el("input", { id: "f-down", type: "number", inputmode: "decimal", min: 0, step: 0.01, max: 99999999.99, placeholder: "0" });
  const iMethod = el("select", { id: "f-method" }, el("option", { value: "" }, t("payMethodPick")),
    ...PAY_METHODS.map((m) => el("option", { value: m }, t("pm_" + m))));
  const iPayRef = el("input", { id: "f-payref", maxlength: 120, autocomplete: "off", placeholder: t("payRefPh") });
  const iPaidAt = el("input", { id: "f-paidat", type: "date", value: manilaToday(), max: manilaToday(), min: "2020-01-01" });
  const downAmount = () => (iDown.value === "" ? 0 : +iDown.value);
  // The same key (and order id) for every attempt at saving this new order. It travels with the draft, so an
  // order restored after the tab closed mid-save is still recognised by the server instead of being duplicated.
  let createReq = fromRequest?.accept ? { key: fromRequest.accept.key, id: fromRequest.accept.id, proofs: null }
    : draft?._req?.key && draft._req.id ? { key: draft._req.key, id: draft._req.id, proofs: null } : null, createSettled = false;
  const draftNow = () => ({ ...collect(), ...(createReq ? { _req: { key: createReq.key, id: createReq.id } } : {}) });
  const payMessage = el("p", { class: "note", role: "status" });
  const payLeft = el("output", { class: "pay-left", id: "f-payleft" });
  const payTotal = el("output", { class: "note" });
  const payHistory = el("div", { class: "payment-history" });
  const payProofsBox = el("div", { class: "compact-photos" });
  const savedProofs = el("div", { class: "payment-proof-list" });
  const proofEditor = field(t("payProofs"), savedProofs, payProofsBox);
  proofEditor.hidden = true;
  const apply = el("button", { class: "btn", type: "button", onclick: () => recordPayment() }, t("payApply"));
  const paymentEditor = el("div", { class: "payment-editor", hidden: true },
    field(t("payAdd"), el("div", { class: "payment-entry" }, iPayment, apply)));
  let payProofs, paymentRow, paymentBusy = false, pendingPayment;
  function resetProofs() {
    payProofs?.dispose();
    payProofs = photoList({ bkt: "cdf-pagos", alt: t("payProofs"), onErr: (msg) => { payMessage.textContent = msg; } });
    payProofsBox.replaceChildren(payProofs.node);
  }
  function paintPay() {
    const total = iAmount.value === "" ? null : +iAmount.value;
    const paid = downOn ? downAmount() || 0 : +(paymentRow?.paid ?? o?.paid ?? 0);
    const left = total == null ? null : (Math.round(total * 100) - Math.round(paid * 100)) / 100;
    payTotal.textContent = t("payAccumulated", { sum: paymentPesos(paid) });
    payLeft.className = "pay-left " + (left === 0 ? "ok" : "due");
    payLeft.textContent = left == null ? t("payNoTotal") : left < 0 ? t(downOn ? "payAboveDue" : "payPriceBelowPaid") : t(downOn ? "payBalance" : "payLeft", { sum: paymentPesos(left) });
    if (downOn) { const none = !(downAmount() > 0); downMore.classList.toggle("is-collapsed", none); downMore.inert = none; }
  }
  // Method, date, reference and proof only matter once an amount is typed
  const downMore = el("div", { class: "pay-initial-more collapse is-collapsed" },
    el("div", { class: "row2" }, reqField(t("payMethod"), iMethod), reqField(t("payDate"), iPaidAt)),
    field(t("payRef"), iPayRef), proofEditor);
  const downBlock = el("div", { class: "pay-initial" },
    field(t("payInitial"), el("div", { class: "peso-input" }, el("span", { "aria-hidden": "true" }, "₱"), iDown, el("span", { class: "cur" }, "PHP"))),
    downMore, payLeft, payMessage);
  iDown.addEventListener("input", paintPay);
  const paymentMeta = (entry) => [entry.method ? (PAY_METHODS.includes(entry.method) ? t("pm_" + entry.method) : entry.method) : null,
    entry.reference ? t("payRefShort", { ref: entry.reference }) : null,
    entry.paid_at ? t("payPaidOn", { date: new Intl.DateTimeFormat(LANG, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(entry.paid_at + "T00:00:00Z")) }) : null].filter(Boolean).join(" · ");
  const paymentDate = (entry) => new Intl.DateTimeFormat(LANG, { dateStyle: "medium", timeStyle: "short", timeZone: TZ }).format(new Date(entry.created_at));
  function paintPaymentHistory(entries) {
    const reversed = new Set(entries.map((entry) => entry.reverses));
    fill(savedProofs, [...entries].reverse().filter((entry) => entry.proofs?.length).map((entry) =>
      el("div", { class: "payment-proof-group" },
        el("small", { class: "note" }, t(entry.kind === "opening" ? "payOpening" : "payEntry"), " · ", paymentPesos(entry.amount),
          entry.created_at ? " · " + paymentDate(entry) : ""),
        el("div", { class: "payment-thumbnails" }, entry.proofs.map((path, index) =>
          imgOf(path, "cdf-pagos", t("payProofs") + " " + (index + 1), true))))));
    fill(payHistory, entries.length ? el("h4", {}, t("payHistory")) : null, [...entries].reverse().map((entry) => {
      const kind = entry.kind === "opening" ? "payOpening" : entry.kind === "reversal" ? "payReversal" : "payEntry";
      const reason = el("input", { maxlength: 500, "aria-label": t("payReason"), placeholder: t("payReason"),
        onkeydown: (event) => {
          if (event.key === "Enter") { event.preventDefault(); recordPayment(entry.id, reason.value.trim()); }
        } });
      return el("div", { class: "payment-movement" },
        el("div", { class: "payment-summary" }, el("span", {}, t(kind)), el("strong", {}, paymentPesos(entry.amount))),
        entry.created_at ? el("small", { class: "note" }, paymentDate(entry), " · ", entry.by_email) : null,
        paymentMeta(entry) ? el("small", { class: "note pay-meta" }, paymentMeta(entry)) : null,
        entry.reason ? el("p", { class: "note" }, entry.reason) : null,
        entry.id && entry.amount > 0 && !reversed.has(entry.id) ? el("details", { class: "payment-correction" },
          el("summary", {}, t("payCorrect")),
          el("div", { class: "payment-entry" }, reason, el("button", { class: "btn", type: "button",
            onclick: () => recordPayment(entry.id, reason.value.trim()) }, t("payReverse")))) : null);
    }));
  }
  async function recordPayment(reverses = null, reason = "") {
    if (!paymentRow || paymentBusy || (saveBtn.disabled && !pendingPayment)) return;
    const amount = iPayment.valueAsNumber;
    const total = iAmount.valueAsNumber;
    if (!pendingPayment) {
      if (reverses && (!reason || reason.length > 500)) { payMessage.textContent = t("payReason"); return; }
      if (!reverses && (!iPayment.validity.valid || !(amount > 0) || !iAmount.validity.valid || !Number.isFinite(total))) {
        payMessage.textContent = t("payInvalid"); return;
      }
      if (!reverses && Math.round(amount * 100) + Math.round((paymentRow.paid || 0) * 100) > Math.round(total * 100)) {
        payMessage.textContent = t("payAboveDue"); return;
      }
    }
    paymentBusy = true;
    saveBtn.disabled = true;
    payHistory.inert = true;
    payProofsBox.inert = true;
    iAmount.readOnly = iPayment.readOnly = true;
    apply.disabled = true;
    payMessage.textContent = "";
    try {
      if (!pendingPayment) {
        pendingPayment = {
          p_order: o.id, p_request: crypto.randomUUID(), p_amount: reverses ? null : amount,
          p_proofs: reverses ? [] : (await payProofs.upload(o.id)) || [],
          p_price: reverses ? null : total, p_seen_price: paymentRow.amount,
          p_reverses: reverses, p_reason: reason
        };
      }
      const request = pendingPayment;
      const { data, error } = await sb.rpc("cdf_record_payment", request);
      if (error) {
        const message = { cdf_payment_above_due: "payAboveDue", cdf_invalid_payment: "payInvalid",
          cdf_price_changed: "payChangedMeanwhile", cdf_invalid_correction: "payCorrectionInvalid",
          cdf_invalid_payment_proofs: "photoUploadFail" }[error.message];
        if (message || error.code === "42501") {
          pendingPayment = null;
          if (request.p_proofs.length) await sb.storage.from("cdf-pagos").remove(request.p_proofs);
          if (["cdf_price_changed", "cdf_payment_above_due", "cdf_invalid_correction"].includes(error.message)) await loadPayments();
        }
        throw new Error(t(message || "payRetry"));
      }
      if (!data) throw new Error(t("payRetry"));
      pendingPayment = null;
      if (!request.p_reverses) {
        iPayment.value = "";
        resetProofs();
        iAmount.value = data.amount ?? "";
        initial.amount = data.amount == null ? null : +data.amount;
      }
      showPayments(data);
      invalidateStats();
      upsertLocal(o);
      render();
      payMessage.textContent = t(request.p_reverses ? "payCorrectionSaved" : "payApplied");
      if (!request.p_reverses) iPayment.focus();
    } catch (error) {
      payMessage.textContent = pendingPayment ? t("payRetry") : error.message;
    } finally {
      paymentBusy = false;
      saveBtn.disabled = !!pendingPayment;
      payHistory.inert = !!pendingPayment;
      payProofsBox.inert = !!pendingPayment;
      iAmount.readOnly = iPayment.readOnly = !!pendingPayment;
      apply.textContent = t(pendingPayment ? "payRetryButton" : "payApply");
      apply.disabled = false;
    }
  }
  function showPayments(data) {
    paymentRow = data || { amount: null, paid: null, payment_history: [] };
    Object.assign(o, { amount: paymentRow.amount, paid: paymentRow.paid, pay_proofs: paymentRow.pay_proofs || [] });
    paintPay();
    paintPaymentHistory(paymentRow.payment_history || []);
    if (paymentRow.payment_history?.some((entry) => entry.proofs?.length)) {
      proofEditor.hidden = false;
      moreDetails.open = true;
    }
  }
  async function loadPayments() {
    const { data, error } = await sb.from("cdf_order_prices").select("amount,paid,pay_proofs,payment_history").eq("order_id", o.id).maybeSingle();
    if (!node.isConnected) return;
    if (error) {
      // Older databases keep the saved amount and payment summary visible.
      const old = await sb.from("cdf_order_prices").select("amount,paid,pay_proofs").eq("order_id", o.id).maybeSingle();
      if (old.error || !node.isConnected) return;
      const row = old.data;
      if (iAmount.value === (initial.amount ?? "").toString()) {
        iAmount.value = row?.amount ?? "";
        initial.amount = row?.amount == null ? null : +row.amount;
      }
      showPayments(row ? { ...row, payment_history: row.paid || row.pay_proofs?.length ?
        [{ kind: "opening", amount: row.paid || 0, proofs: row.pay_proofs }] : [] } : null);
      payMessage.textContent = t("payUpgrade");
      return;
    }
    if (iAmount.value === (initial.amount ?? "").toString()) {
      iAmount.value = data?.amount ?? "";
      initial.amount = data?.amount == null ? null : +data.amount;
    }
    showPayments(data);
    paymentEditor.hidden = proofEditor.hidden = false;
  }
  iPayment.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); recordPayment(); }
  });
  iAmount.addEventListener("input", paintPay);
  const hist = isNew ? null : historyBlock(o);

  // Channel: logos in the header, grey until chosen; tapping the chosen one clears it
  let channel = f.channel || "";
  const chanWarn = el("div", { class: "chan-warn collapse", role: "status" }, icon("alert"), el("span", {}, t("chanWarn")));
  const syncChan = () => {
    iChan.querySelectorAll(".chan-opt").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === channel)));
    chanWarn.classList.toggle("is-collapsed", !!channel);
  };
  const iChan = el("div", { class: "chan-pick", role: "group", "aria-label": t("channel") }, CHANNELS.map((c) =>
    el("button", { type: "button", class: "chan-opt", "data-c": c, style: "--cc:" + chanColor(c), "aria-label": c, title: c,
      onclick: () => { channel = channel === c ? "" : c; iChan.classList.remove("invalid"); syncChan(); keepDraft(); } }, chanMark(c))));

  // Returning customer: the same buyer phone on other orders already loaded
  const repeatTag = el("div", { class: "repeat-tag collapse is-collapsed", role: "status" });
  let repeatTimer, repeatGeneration=0;
  const syncRepeat = () => {
   clearTimeout(repeatTimer);const generation=++repeatGeneration,d=intlPhone(phFull(iBPhone));
   repeatTag.classList.add("is-collapsed");if(d.length<9)return;
   repeatTimer=setTimeout(async()=>{
    const {data,error}=await sb.rpc("cdf_buyer_history",{p_phone:d,p_exclude:o?.id||null});
    if(generation!==repeatGeneration || !repeatTag.isConnected)return;
    if(error){repeatTag.replaceChildren(el("span",{},t("repeatUnavailable")));repeatTag.classList.remove("is-collapsed");return;}
    const info=Array.isArray(data)?data[0]:data, n=Number(info?.n||0);
    const total=pricesOn()?t("repeatSum",{sum:peso(info?.total||0)}):"";
    repeatTag.replaceChildren(icon("star"),el("span",{},(n===1?t("repeatOne"):t("repeatMany",{n}))+total));
    repeatTag.classList.toggle("is-collapsed",!n);
   },250);
  };
  iBPhone.addEventListener("input", syncRepeat);

  // What the form holds, cleaned the way it is stored
  const collect = () => {
    const sameNow = iSame.checked;
    const row = {
      num: iNum.value.trim(), date: iDate.value, slot: iSlot.value(), channel, vendor_email: iVend.value,
      carrier_email: iCarr ? iCarr.value : f.carrier_email,
      customer_name: (sameNow ? iBName.value : iName.value).trim(), address: iAddr.value.trim(),
      customer_phone: phFull(sameNow ? iBPhone : iPhone), customer_email: iEmail.value.trim().toLowerCase(),
      buyer_name: iBName.value.trim(), buyer_phone: phFull(iBPhone),
      card_message: iCard.value.trim(), delivery_note: iDNote.value.trim(), notes: iNotes.value.trim(),
    };
    if (iDrop) { const p = dropPoint(); row.drop_lat = p ? p.lat : null; row.drop_lng = p ? p.lng : null; }
    if (iVeh) row.vehicle = iVeh.value || null;
    if (iMode) {
      row.pickup = pickupVal;
      // Nothing to deliver to: the shop is the florist's. What was typed stays in the form if they switch back.
      if (pickupVal) { row.address = ""; if (iDrop) row.drop_lat = row.drop_lng = null; if (iVeh) row.vehicle = null; row.delivery_note = ""; }
    }
    if (priceEditable()) row.amount = iAmount.value === "" ? null : Math.max(0, +iAmount.value);
    return row;
  };
  let initial = null;
  const dirty = () => JSON.stringify(collect()) !== JSON.stringify(initial) || shot.dirty || extras.dirty || proof.dirty || !!payProofs?.dirty || !!iPayment.value || paymentBusy || !!pendingPayment || !!iDown.value || !!iPayRef.value.trim();

  const linkBlock = isNew ? el("p", { class: "note", style: "margin:0" }, t("linkAfterSave")) : (() => {
    const li = el("input", { id: "f-link", class: "input", readonly: true, value: trackUrl(o), onfocus: (e) => e.target.select(), "aria-label": t("customerLink") });
    return el("div", { class: "link-row" }, li,
      el("button", { class: "btn", type: "button", onclick: () => navigator.clipboard?.writeText(li.value).then(() => toast(t("copied")), () => { li.focus(); li.select(); toast(t("selectCopy"), { type: "info" }); }) }, t("copy")),
      el("a", { class: "btn", href: trackUrl(o), target: "_blank", rel: "noopener" }, t("view")));
  })();

  const saveBtn = el("button", { class: "btn primary", type: "submit" }, t("save"));
  const fName = reqField(t("customerName"), iName), fPhone = reqField(t("phone"), phoneBox(iPhone));
  const recip = el("div", { class: "row2 recip collapse" }, fName, fPhone);
  const syncSame = (animate) => {
    recip.classList.toggle("is-collapsed", iSame.checked);
    recip.setAttribute("aria-hidden", String(iSame.checked));
    recip.querySelectorAll("input").forEach((x) => (x.tabIndex = iSame.checked ? -1 : 0));
    if (!animate) { recip.classList.add("no-anim"); requestAnimationFrame(() => recip.classList.remove("no-anim")); }
  };
  iSame.addEventListener("change", () => syncSame(true));

  const save = async () => {
    setErr("");
    for (const x of node.querySelectorAll(".invalid")) x.classList.remove("invalid");
    const row = collect();
    // Required: number, date, time, buyer name + (phone or email), recipient name, phone and address
    const need = [[iNum, row.num], [iDate, row.date], [iSlot, row.slot], [iBName, row.buyer_name],
      [iBPhone, iSame.checked ? row.buyer_phone : row.buyer_phone || row.customer_email], ...(row.pickup ? [] : [[iAddr, row.address]])];
    if (!iSame.checked) need.push([iName, row.customer_name], [iPhone, row.customer_phone]);
    const miss = need.filter(([, v]) => !v).map(([x]) => x.closest(".field"));
    // The channel is required too: where every order came from is what the statistics are built on
    const noChannel = !row.channel;
    if (noChannel) iChan.classList.add("invalid");
    const badPhones = [[iBPhone, row.buyer_phone], [iPhone, iSame.checked ? "" : row.customer_phone]].filter(([, v]) => !phoneOk(v)).map(([x]) => x.closest(".field"));
    if (miss.some((field) => moreDetails.contains(field))) moreDetails.open = true;
    if (miss.length || badPhones.length) {
      void node.offsetWidth;
      [...miss, ...badPhones].forEach((x) => x.classList.add("invalid"));
      [...miss, ...badPhones][0].scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      return miss.length ? (iSlot.closest(".field").classList.contains("invalid") && iSlot.first.value ? t("slotInvalid") : t("fillRequired")) : t("phoneInvalid");
    }
    if (noChannel) { iChan.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" }); iChan.querySelector(".chan-opt")?.focus(); return t("chanRequired"); }
    if (priceEditable() && !iAmount.validity.valid) { iAmount.focus(); return t("payInvalidPrice"); }
    // The first payment: never a zero movement; never more than the total; how and when it was paid are required
    let payment = null;
    if (downOn) {
      const down = downAmount();
      if (!iDown.validity.valid || !(down >= 0)) { iDown.closest(".field").classList.add("invalid"); iDown.focus(); return t("payInitialInvalid"); }
      if (down > 0) {
        if (row.amount == null) { iAmount.focus(); return t("payInitialNeedsTotal"); }
        if (Math.round(down * 100) > Math.round(row.amount * 100)) { iDown.closest(".field").classList.add("invalid"); iDown.focus(); return t("payAboveDue"); }
        if (!iMethod.value) { iMethod.closest(".field").classList.add("invalid"); iMethod.focus(); return t("payMethodRequired"); }
        if (!iPaidAt.value || !iPaidAt.validity.valid) { iPaidAt.closest(".field").classList.add("invalid"); iPaidAt.focus(); return t("payDateInvalid"); }
        payment = { amount: down, method: iMethod.value, reference: iPayRef.value.trim() || null, paid_at: iPaidAt.value };
      } else if (payProofs?.dirty || iPayRef.value.trim()) { iDown.closest(".field").classList.add("invalid"); iDown.focus(); return t("payInitialNoAmount"); }
    }
    if (row.customer_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.customer_email)) { moreDetails.open = true; iEmail.closest(".field").classList.add("invalid"); return t("emailInvalid"); }
    if (!row.pickup && iDrop && iDrop.value.trim() && !dropPoint()) { moreDetails.open = true; paintDrop(); iDrop.focus(); return t("dropBad"); }
    // Things a rider booking will need: a heads-up, never a block. Only for orders still to come.
    if (!o?.cancelled_at && o?.delivery !== "Delivered" && row.date >= manilaToday()) {
      const gaps = [
        !row.vendor_email ? t("gapFlorist") : null,
        !iSame.checked && !row.customer_phone ? t("gapRecipientPhone") : null,
      ].filter(Boolean);
      const before = initial ? [!initial.vendor_email, !initial.customer_phone] : null;
      const same = !isNew && before && gaps.length && [!row.vendor_email, !iSame.checked && !row.customer_phone].every((g, i) => !g || before[i]);
      // Asked when creating, or when an edit leaves a gap that wasn't there; not on every later save
      if (gaps.length && !same && !(await askConfirm(t("gapAsk"), t("saveAnyway"), { detail: gaps.join(" · ") }))) return;
    }
    const dbRow = { ...row, vendor_email: row.vendor_email || null, carrier_email: row.carrier_email || null };
    if (!S.cap.carrier) delete dbRow.carrier_email;
    delete dbRow.amount;
    // Giving it to someone away on that date (or moving it into their absence) asks first
    if (dbRow.vendor_email && (isNew || dbRow.vendor_email !== (initial.vendor_email || null) || dbRow.date !== initial.date)
      && !(await okToAssign(dbRow.vendor_email, [dbRow.date]))) return;

    let saved, error;
    if (createOn) {
      // One request, one transaction. The key and the order id stay the same for every attempt from this
      // form: if the answer got lost and the order is already there, the server returns it instead of
      // creating a second one; if what is sent no longer matches what was saved, it says so.
      createReq ||= { key: crypto.randomUUID(), id: crypto.randomUUID(), proofs: null };
      if (payment) {
        try { createReq.proofs ??= (await payProofs.upload(createReq.id)) || []; }
        catch (e) { return e.message; }
        payment.proofs = createReq.proofs;
      }
      // From a request: the same order, and the request closed with it in the same transaction
      const args = { p_request: createReq.key, p_order: { id: createReq.id, ...dbRow }, p_price: priceEditable() ? row.amount : null, p_payment: payment };
      const res = await (fromRequest ? sb.rpc("cdf_request_accept", { p_id: fromRequest.id, ...args }) : sb.rpc("cdf_create_order", args))
        .then((r) => r, (e) => ({ error: { message: String(e?.message || e) } }));
      if (res.error || !res.data?.order) {
        const e = res.error || { message: "" };
        if (e.code || /^cdf_/.test(e.message)) {
          // Refused by the database. Usually nothing was saved and the files uploaded for it go too. But a
          // conflict means an earlier attempt with this key DID save (its answer got lost, then the form was
          // changed): its payment may hold these very files, so only the ones it does not use are removed,
          // and nothing at all if that can't be checked.
          if (createReq.proofs?.length) {
            const settled = e.message === "cdf_operation_conflict" || e.message === "cdf_operation_gone";
            const keep = settled ? await proofsInUse(createReq.id) : new Set();
            const drop = keep ? createReq.proofs.filter((p) => !keep.has(p)) : [];
            if (drop.length) await sb.storage.from("cdf-pagos").remove(drop);
          }
          createReq.proofs = null;
          if (e.message === "cdf_operation_conflict" || e.message === "cdf_operation_gone") {
            createSettled = true; clearTimeout(draftT); if (!fromRequest) writeDraft(null); loadOrders(); return t("createConflict");
          }
          // Someone else accepted or rejected this request meanwhile: nothing was created here
          if (/^cdf_request_/.test(e.message)) { createSettled = true; if (typeof loadRequests === "function") loadRequests(); return reqError(e); }
          if (e.code === "23505") return /cdf_orders_num_key/.test(e.message + (e.details || "")) ? t("dupNum", { num: row.num }) : t("saveFail", { msg: e.message });
          const key = { cdf_payment_above_due: "payAboveDue", cdf_invalid_payment: "payInitialInvalid", cdf_invalid_payment_proofs: "photoUploadFail" }[e.message];
          return key ? t(key) : t("saveFail", { msg: e.code === "42501" ? t("createForbidden") : e.message });
        }
        // No answer: it may or may not have been saved. Saving again asks for the same operation.
        if (payProofs) payProofsBox.inert = !!createReq.proofs?.length;
        clearTimeout(draftT); if (!fromRequest) writeDraft(draftNow());
        return t("createRetry");
      }
      saved = res.data.order;
      if (fromRequest && res.data.request) {
        const i = RQ.list.findIndex((x) => x.id === fromRequest.id);
        if (i >= 0) RQ.list[i] = res.data.request;
        paintRequestCount();
      }
      const price = res.data.price;
      Object.assign(saved, { amount: price?.amount ?? null, paid: price?.paid ?? null, pay_proofs: price?.pay_proofs || [] });
      if (price) invalidateStats();
    }
    else if (isNew) ({ data: saved, error } = await sb.from("cdf_orders").insert(dbRow).select().single());
    else {
      // Only what this person changed, so a status set meanwhile by the florist or driver is never undone.
      const changed = Object.fromEntries(Object.entries(dbRow).filter(([k, v]) => JSON.stringify(v ?? "") !== JSON.stringify(initial[k] ?? "")));
      if (!Object.keys(changed).length && !shot.dirty && !extras.dirty && !proof.dirty && (!priceEditable() || row.amount === initial.amount)) { await closeSheet(true); return; }
      // The write only lands on the version this person was shown (updated_at), so two admins saving
      // at the same moment can't silently overwrite each other: if the row moved in between, it is
      // read again and anything that now clashes with these edits is asked about once more.
      let seen = o;
      for (let tries = 0; ; tries++) {
        const { data: server, error: readErr } = await sb.from("cdf_orders").select("*").eq("id", o.id).maybeSingle();
        if (readErr) return t("saveFail", { msg: readErr.message });
        if (!server) return t("goneMeanwhile");
        if (server.updated_at !== seen.updated_at) {
          const clash = Object.keys(changed).filter((k) => JSON.stringify(server[k] ?? "") !== JSON.stringify(seen[k] ?? ""));
          if (clash.length && !(await askConfirm(t("conflictAsk"), t("conflictKeepMine"), { detail: clash.map((k) => t(EV_FIELDS[k] || k)).join(", ") }))) return;
          seen = server;
        }
        if (!Object.keys(changed).length) { saved = server; break; }
        const r = await sb.from("cdf_orders").update(changed).eq("id", o.id).eq("updated_at", server.updated_at).select();
        if (r.error) { error = r.error; break; }
        if (r.data?.length) { saved = r.data[0]; break; }
        if (tries >= 4) return t("busyRetry");
      }
    }
    if (error) return error.code === "23505" ? t("dupNum", { num: row.num }) : t("saveFail", { msg: error.message });

    // Only a price that was typed or changed is written: an order whose price never loaded keeps it
    if (!createOn && priceEditable() && (isNew || row.amount !== initial.amount)) {
      try {
        await savePrice(saved.id, { amount: row.amount }, isNew ? null : { amount: initial.amount });
        saved.amount = row.amount;
      } catch (e) {
        upsertLocal(saved);
        if (isNew) { o = saved; isNew = false; initial = { ...row, amount: undefined }; }
        return t("payNotSaved", { msg: e.message });
      }
    }
    // Photos after the row exists; the old files go only once the row points at the new ones.
    const pics = {};
    let photoTrouble = false;
    for (const [k, p, dest] of [["photo_path", shot, (id) => id + ".jpg"], ["extra_photos", extras], ["proof_path", proof]]) {
      try { const v = await p.upload(saved.id, dest); if (v !== undefined) pics[k] = v; } catch { photoTrouble = true; }
    }
    // Audit F12. The extra photos go as "added / removed" and the database applies them to the list as it is
    // now, so two people adding photos at once both keep theirs. A database without that function yet
    // (PGRST202) keeps the old whole-list write.
    let photoClash = false;
    if (pics.extra_photos && extras.changes) {
      const m = await sb.rpc("cdf_order_photos_merge", { p_id: saved.id, p_add: extras.changes.add, p_remove: extras.changes.remove });
      if (!m.error && m.data) { saved = { ...saved, ...m.data }; delete pics.extra_photos; await extras.cleanup(m.data.extra_photos || []); }
      else if (m.error?.code !== "PGRST202" && !/could not find the function/i.test(m.error?.message || "")) {
        delete pics.extra_photos;
        const added = extras.changes.add;
        if (m.error?.code) {
          // The database answered "no" (it gives a code): nothing was written, so the new files are not needed
          photoTrouble = true;
          if (added.length) await sb.storage.from(ENTREGAS).remove(added);
        } else {
          // Re-audit F12. No clear answer (the connection dropped): the change may well have been saved, and
          // then the order points at these files. They are never deleted here. The order is read again: if
          // it has the change, it was saved; if not, or it cannot be read, the person is told and can save
          // again, and the files stay (a file nobody points at is harmless; a photo pointing at nothing is not).
          const now = await sb.from("cdf_orders").select("extra_photos, updated_at").eq("id", saved.id).maybeSingle();
          const list = now.data?.extra_photos || null;
          if (!now.error && list && added.every((p) => list.includes(p)) && extras.changes.remove.every((p) => !list.includes(p))) {
            saved = { ...saved, ...now.data }; await extras.cleanup(list);
          } else photoTrouble = true;
        }
      }
    }
    // The delivery photo is one file: written only if it is still the one this editor opened with. If someone
    // changed it meanwhile, theirs stays, ours is taken back and the person is told.
    if ("proof_path" in pics && !isNew) {
      const was = initialProof || null;
      let q = sb.from("cdf_orders").update({ proof_path: pics.proof_path }).eq("id", saved.id);
      q = was ? q.eq("proof_path", was) : q.is("proof_path", null);
      const r = await q.select();
      if (r.error) photoTrouble = true;
      else if (!r.data?.length) { photoClash = true; if (pics.proof_path) await sb.storage.from(ENTREGAS).remove([pics.proof_path]); }
      else { saved = { ...saved, ...r.data[0] }; await proof.cleanup(); }
      delete pics.proof_path;
    }
    if (Object.keys(pics).length) {
      const r = await sb.from("cdf_orders").update(pics).eq("id", saved.id).select().single();
      if (r.error) photoTrouble = true; else { saved = { ...saved, ...r.data }; await Promise.all([shot, ...("extra_photos" in pics ? [extras] : []), ...("proof_path" in pics ? [proof] : [])].map((p) => p.cleanup())); }
    }
    if (isNew && !fromRequest) writeDraft(null);
    upsertLocal(saved);
    S.sel = row.date; S.month = monthOf(row.date);
    await closeSheet(true);
    toast(photoClash ? t("photoClash") : photoTrouble ? t("partialSave") : fromRequest ? t("reqAcceptedToast", { ref: "R" + fromRequest.ref, num: saved.num }) : t(isNew ? "created" : "saved"), photoTrouble || photoClash ? { type: "error", ms: 7000 } : {});
    if (!inRange(row.date)) loadOrders(); else render();
    // The new order glows for a moment where it landed
    if (!isNew) requestAnimationFrame(()=>{const card=document.querySelector(`#list .entry[data-id="${saved.id}"]`);card?.classList.add("flash")});
    if (isNew) requestAnimationFrame(() => { const e = document.querySelector(`#list .entry[data-id="${saved.id}"]`); e?.classList.add("is-new"); e?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" }); });
  };

  const archived = !!o?.archived_at;
  const footLeft = isNew ? el("span") : el("div", { class: "btn-row" },
    el("button", { class: "btn foot-act", type: "button", "aria-label": t("duplicate"), onclick: async () => { if (await closeSheet()) { await refreshNumTop().catch(() => {}); openEditor(null, { copyFrom: o }); } } }, icon("copy"), el("span", { class: "lbl" }, t("duplicate"))),
    S.cap.archive ? el("button", { class: "btn foot-act", type: "button", "aria-label": t(archived ? "restore" : "archive"), onclick: () => setArchived([o], !archived) }, icon("archive"), el("span", { class: "lbl" }, t(archived ? "restore" : "archive"))) : null,
    isAdmin() && !o.cancelled_at && o.delivery !== "Delivered" ? el("button", { class: "btn foot-act", type: "button", "aria-label": t("cancelOrder"), onclick: async () => { if (await closeSheet()) cancelDialog(o); } }, icon("close"), el("span", { class: "lbl" }, t("cancelOrder"))) : null,
    isAdmin() && o.cancelled_at ? el("button", { class: "btn foot-act", type: "button", "aria-label": t("reinstate"), onclick: async () => { if (await closeSheet()) reinstateOrder(o); } }, icon("refresh"), el("span", { class: "lbl" }, t("reinstate"))) : null,
    // With the trash (12/11/2026), "delete" moves the order there: recoverable, logged, explained
    isAdmin() && S.cap.trash ? el("button", { class: "btn danger foot-act", type: "button", "aria-label": t("trashMove"), onclick: async () => {
      if (typeof llActive === "function" && llActive(o)) { toast(t("deleteHasRider"), { type: "error", ms: 7000 }); return; }
      if (await closeSheet()) trashDialog(o);
    } }, icon("trash"), el("span", { class: "lbl" }, t("trashMove"))) : null,
    isAdmin() && !S.cap.trash ? el("button", { class: "btn danger foot-act", type: "button", "aria-label": t("delete"), onclick: async () => {
      if (!(await askConfirm(t("askDelete", { num: o.num }), t("yesDelete"), { danger: true, detail: S.cap.archive ? t("deleteHintArchive") : null }))) return;
      const { error } = await sb.from("cdf_orders").delete().eq("id", o.id);
      // The database refuses while a Lalamove rider is on it (audit F02): cancel the rider first
      if (error) { toast(/cdf_order_has_rider/.test(error.message || "") ? t("deleteHasRider") : t("deleteFail"), { type: "error", ms: 7000 }); return; }
      await removeFiles([o]);
      S.orders = S.orders.filter((x) => x.id !== o.id);
      await closeSheet(true);
      const entry=document.querySelector(`#list .entry[data-id="${o.id}"]`);
      if(entry&&!prefersReducedMotion()) await entry.animate([{opacity:1},{opacity:0,transform:"scale(.98)"}],{duration:300,easing:"ease-in-out"}).finished;
      invalidateStats(); toast(t("deleted")); flip($("list"),render);
    } }, icon("trash"), el("span", { class: "lbl" }, t("delete"))) : null);

  // Delivery-only parts, hidden for a pickup
  const addrGroup = el("div", { style: "display:grid;gap:6px" }, reqField(t("deliveryAddr"), iAddr),
    el("div", { class: "addr-tools" }, mapHint(iAddr), dropFind, dropMap), dropFind ? dropHits : null);
  const dNoteField = field(t("deliveryNote"), iDNote, newOrderForm ? null : el("small", { class: "note" }, t("deliveryNoteHint")));
  const vehField = iVeh ? field(t("llVehicle"), iVeh, el("small", { class: "note" }, t("vehicleHint"))) : null;
  const dropField = iDrop ? field(t("dropPasteLabel"), iDrop, dropNote) : null;
  function syncMode() {
    // A class, not `hidden`: some of these (the shop suggestion) show and hide themselves too
    for (const n of [addrGroup, dNoteField, vehField, dropField, shops?.node]) n?.classList.toggle("mode-off", pickupVal);
    pickupInfo.hidden = !pickupVal;
    if (pickupVal) paintPickupInfo();
  }
  const moreDetails = el("details", {
    class: "hist order-more",
    open: !!(iEmail.value.trim() || (newOrderForm && iCarr?.value) || iVeh?.value || iDrop?.value.trim() || o?.extra_photos?.length || o?.pay_proofs?.length)
  }, el("summary", {}, t("moreDetails")),
  el("div", { class: "order-more-fields" },
    field(t("buyerEmailOptional"), iEmail, el("small", { class: "note" }, t("autoMailHint"))),
    newOrderForm && iCarr ? field(t("carrier"), iCarr, el("small", { class: "note" }, t("carrierHint"))) : null,
    vehField,
    dropField,
    extras.node ? el("div", { class: "compact-photos" }, field(t("morePhotos"), extras.node)) : null,
    payOn && !downOn ? proofEditor : null));
  const cur = o ? stepOf(o) : 0;
  const amountInput = el("div", { class: "peso-input" }, el("span", { "aria-hidden": "true" }, "₱"), iAmount,
    el("span", { class: "cur" }, "PHP"));
  const node = el("form", { class: newOrderForm ? "sheet new-order-sheet" : "sheet", role: "dialog", "aria-modal": "true", novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (paymentBusy || pendingPayment) return;
    if (!downOn && (iPayment.value || payProofs?.dirty)) { payMessage.textContent = t("payApplyFirst"); return; }
    saveBtn.disabled = true; saveBtn.classList.add("busy");
    let msg;
    try { msg = await save(); } catch (x) { msg = t("saveFail", { msg: x.message || String(x) }); }
    saveBtn.disabled = false; saveBtn.classList.remove("busy");
    if (msg) setErr(msg);
  } },
    el("div", { class: "sheet-head" }, el("h2", {}, isNew ? (fromRequest ? t("reqAcceptTitle", { ref: "R" + fromRequest.ref }) : t(copyFrom ? "duplicateTitle" : "newOrderTitle")) : t("editOrder", { num: f.num })),
      o ? badge(cur, o) : null, archived ? el("span", { class: "tag muted" }, t("archived")) : null, el("span", { class: "spacer" }), iChan, closeBtn()),
    el("div", { class: "sheet-body" },
      isNew ? null : cancelNote(o),
      newOrderForm ? null : chanWarn,
      copyFrom ? el("div", { class: "sheet-note" }, icon("copy"), el("span", {}, t("duplicateHint"))) : null,
      fromRequest ? el("div", { class: "sheet-note req-from" }, icon("inbox"), el("span", {}, t("reqFromSheet", { ref: "R" + fromRequest.ref }))) : null,
      fromRequest ? requestPhotos(fromRequest) : null,
      draft && !fromRequest ? el("div", { class: "sheet-note" }, icon("clock"), el("span", {}, t("draftRestored"))) : null,
      el("section", {},
        el("div", { class: "row2 when-row" }, reqField(t("date"), iDate), reqField(t("slot"), iSlot)),
        el("div", { class: newOrderForm ? "row2 new-order-assignment" : "row2" }, reqField(t("orderNum"), iNum), field(t("vendor"), iVend)),
        shops ? shops.node : null,
        !newOrderForm && iCarr ? field(t("carrier"), iCarr, el("small", { class: "note" }, t("carrierHint"))) : null),
      el("section", {}, el("h3", {}, t("buyerH")), newOrderForm ? null : el("p", { class: "note", style: "margin:0" }, t("buyerHint")),
        el("div", { class: "row2" }, reqField(t("name"), iBName), reqField(t("phone"), phoneBox(iBPhone))),
        repeatTag),
      el("section", {}, ...(newOrderForm
        ? [el("div", { class: "new-order-recipient" }, el("h3", {}, t("recipientH")), checkRow(iSame, t("sameAsBuyerShort")))]
        : [el("h3", {}, t("recipientH")), checkRow(iSame, t("sameAsBuyer"))]),
        recip,
        iMode ? field(t("fulfilment"), iMode, pickupInfo) : null,
        addrGroup,
        dNoteField,
        newOrderForm ? el("div", { class: "row2" }, field(t("cardMsg"), iCard), field(t("note"), iNotes)) : field(t("cardMsg"), iCard),
        newOrderForm ? null : field(t("note"), iNotes)),
      ...(newOrderForm ? [
        el("section", { class: "compact-photos" }, el("div", { class: priceEditable() ? "new-order-extras" : "" },
          field(t("photo"), shot.node),
          priceEditable() ? field(t("payOrderTotal"), amountInput) : null),
          downOn ? downBlock : null, moreDetails)
      ] : [
      el("section", { class: "compact-photos" }, el("h3", {}, t("photosH")),
        field(t("photo"), shot.node),
        isNew ? null : field(t("proofPhoto"), proof.node)),
      priceEditable() ? el("section", { class: "pay" }, el("h3", {}, t("payH")),
        field(t("payOrderTotal"), amountInput),
        payOn && !downOn ? el("div", { class: "payment-summary" }, payTotal, payLeft) : null,
        downOn ? downBlock : null,
        payOn ? paymentEditor : null, payOn && !downOn ? payMessage : null, moreDetails, payOn ? payHistory : null) : el("section", {}, moreDetails)
      ]),
      isNew || typeof orderReferences !== "function" ? null : orderReferences(o),
      isNew ? null : chatSection(o),
      isNew || !feature("tracking") ? null : el("section", { id: "linkSection" }, field(t("customerLink"), linkBlock),
        notifyRow(o, () => iBName.value.trim() || iName.value.trim(), () => phFull(iBPhone) || phFull(iPhone), () => STEPS[stepOf(o)].k, hist)),
      isNew || typeof lalamoveSection !== "function" || isPickup(o) ? null : lalamoveSection(o),
      isNew ? null : historySection(o, hist),
      newOrderForm ? null : err),
    newOrderForm ? err : null,
    el("div", { class: "sheet-foot" }, footLeft, el("span", { class: "spacer" }), saveBtn));

  // New orders keep a draft in this browser until they are saved, in case the tab closes.
  let draftT;
  function keepDraft() { if (!isNew || !initial || createSettled || fromRequest) return; clearTimeout(draftT); draftT = setTimeout(() => writeDraft(dirty() ? draftNow() : null), 400); }
  node.addEventListener("input", (e) => { e.target.closest(".field")?.classList.remove("invalid"); keepDraft(); });
  node.addEventListener("change", (e) => { e.target.closest(".field")?.classList.remove("invalid"); keepDraft(); });
  openLayer(node, { dirty, dispose: () => { [shot, extras, proof, payProofs].forEach((p) => p?.dispose()); clearTimeout(draftT);clearTimeout(repeatTimer);repeatGeneration++; } });
  syncSame(false); syncChan(); syncRepeat(); syncMode();
  // The form as it opened is the baseline: only what differs from it is saved (and asked about on close).
  // A copy or a restored draft counts as unsaved work from the start.
  initial = copyFrom || draft ? { ...collect(), num: "" } : collect();
  paintDrop(); paintPay();
  // The suggestion follows the delivery point and the date, whichever way the point is set
  if (shops) {
    let shopT;
    const syncShops = () => { clearTimeout(shopT); shopT = setTimeout(() => shops.update(dropPoint(), iDate.value), 250); };
    iDrop?.addEventListener("input", syncShops); iDrop?.addEventListener("change", syncShops);
    iDrop?.addEventListener("cdf-point-saved", syncShops); iDate.addEventListener("change", syncShops);
    shops.update(dropPoint(), iDate.value);
  }
  // The Lalamove block saved a new point on the order: show it here as the saved one, not as a pending change
  iDrop?.addEventListener("cdf-point-saved", (e) => {
    iDrop.value = `${e.detail.lat}, ${e.detail.lng}`; fromAddr = ""; dropHits.replaceChildren(); paintDrop();
    if (initial) { initial.drop_lat = e.detail.lat; initial.drop_lng = e.detail.lng; }
  });
  sheet.order = o;
  if (downOn) { resetProofs(); proofEditor.hidden = false; }
  else if (payOn && isNew) payMessage.textContent = t("payAfterSave");
  if (payOn && !isNew) { resetProofs(); loadPayments(); }
  if (!payOn && priceEditable() && o?.id && o.amount === undefined) {
    sb.from("cdf_order_prices").select("amount").eq("order_id", o.id).maybeSingle().then(({ data }) => {
      if (data?.amount != null && iAmount.value === "" && iAmount.isConnected) {
        iAmount.value = data.amount;
        initial.amount = +data.amount;
      }
    });
  }
}
function mapHint(input) {
  const a = el("a", { target: "_blank", rel: "noopener", class: "note link-out" }, t("openMaps"));
  const sync = () => { a.href = mapsUrl(input.value); a.hidden = !input.value.trim(); };
  input.addEventListener("input", sync); sync();
  return a;
}
// New order: offer the unsaved draft first, if there is one
async function refreshNumTop() {
  const { data } = await sb.from("cdf_orders").select("num").order("created_at", { ascending: false }).limit(200);
  S.numTop = Math.max(0, ...(data || []).map((x) => (/^\d+$/.test(x.num) ? +x.num : 0)));
}
async function newOrder() {
  if (isStaff()) await Promise.all([loadMembers(), refreshNumTop().catch(() => {})]);
  const d = readDraft();
  if (d && (d.buyer_name || d.customer_name || d.address || d.notes)) {
    const restore = await askConfirm(t("draftFound"), t("draftRestore"), { detail: [d.buyer_name || d.customer_name, d.address].filter(Boolean).join(" · ") });
    if (restore) return openEditor(null, { draft: d });
    writeDraft(null);
  }
  openEditor(null);
}
// The order on screen changed elsewhere (realtime): say so instead of silently diverging
document.addEventListener("orderchange", (e) => {
  const row = e.detail;
  if (!sheet?.order || sheet.order.id !== row.id || row.updated_at === sheet.order.updated_at) return;
  if (sheet.node.querySelector(".changed-banner")) return;
  sheet.node.querySelector(".sheet-body").prepend(el("div", { class: "sheet-note warn changed-banner", role: "status" }, icon("alert"), el("span", {}, t("changedMeanwhile"))));
});

// ---------- cancel / reinstate (admin) ----------
// A cancelled order keeps its step; the server refuses any step while cancelled, tells the assigned
// florist and driver, logs it in the history and shows the customer "cancelled" on the tracking page.
function cancelDialog(o) {
  const iReason = el("textarea", { id: "f-cancel", rows: 3, maxlength: 500, "aria-required": "true", placeholder: t("cancelReasonPh") });
  const chips = el("div", { class: "chips" }, ["cancelR1", "cancelR2", "cancelR3"].map((k) =>
    el("button", { class: "chip", type: "button", onclick: () => { iReason.value = t(k); iReason.focus(); } }, t(k))));
  // A rider booked on it: say so before confirming (it gets cancelled too)
  const riderNote = el("div", { class: "sheet-note warn", hidden: true }, icon("truck"), el("span", {}, t("cancelWithRider")));
  if (typeof llActiveBooking === "function") llActiveBooking(o).then((b) => { riderNote.hidden = !b; });
  miniSheet(t("cancelTitle", { num: o.num }), [riderNote, field(t("cancelReason"), iReason), chips, el("div", { class: "hint" }, t("cancelHint"))], t("cancelOrder"), async () => {
    const reason = iReason.value.trim();
    if (!reason) { iReason.closest(".field")?.classList.add("invalid"); iReason.focus(); return t("cancelNeedReason"); }
    if (typeof llReleaseRider === "function" && !(await llReleaseRider(o))) return t("llReleaseStopped");
    const { data, error } = await sb.rpc("cdf_cancel_order", { p_id: o.id, p_reason: reason });
    if (error) return t("saveFail", { msg: error.message });
    Object.assign(o, data); upsertLocal(o);
    await closeSheet(true);
    toast(t("cancelledN", { num: o.num }), { action: t("undo"), onAction: () => reinstateOrder(o) });
    invalidateStats(); render();
  }, { dirty: () => !!iReason.value.trim() });
  requestAnimationFrame(() => iReason.focus());
}
async function reinstateOrder(o) {
  const { data, error } = await sb.rpc("cdf_reinstate_order", { p_id: o.id });
  if (error) { toast(t("saveFail", { msg: error.message }), { type: "error" }); return; }
  Object.assign(o, data); upsertLocal(o);
  toast(t("reinstatedN", { num: o.num })); invalidateStats(); render();
}

// ---------- archive ----------
async function setArchived(list, on) {
  if (!list.length) return;
  const ids = list.map((o) => o.id);
  const { error } = await sb.from("cdf_orders").update({ archived_at: on ? new Date().toISOString() : null }).in("id", ids);
  if (error) { toast(t("saveFail", { msg: error.message }), { type: "error" }); return; }
  if (sheet && list.some((o) => o.id === sheet.order?.id)) await closeSheet(true);
  if (on) S.orders = S.orders.filter((o) => !ids.includes(o.id));
  S.selected.clear();
  toast(on ? t("archivedN", { n: list.length }) : t("restoredN", { n: list.length }), on ? { action: t("undo"), onAction: () => setArchived(list, false) } : {});
  if (!on) loadOrders(); else render();
  if (S.hits) runSearch();
}
