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
      if (!prefersReducedMotion()) await wait(140);
      scrim.remove(); back?.focus?.(); resolve(v);
    };
    const ok = el("button", { class: "btn " + (danger ? "danger-solid" : "primary"), type: "button", onclick: () => done(true) }, okLabel);
    const box = el("div", { class: "dialog", role: "alertdialog", "aria-modal": "true", tabindex: "-1", "aria-labelledby": "askText" },
      el("p", { id: "askText", class: "dialog-text" }, text),
      detail ? el("div", { class: "hint" }, detail) : null,
      el("div", { class: "dialog-foot" }, el("button", { class: "btn", type: "button", onclick: () => done(false) }, t("cancel")), ok));
    scrim.append(box);
    scrim.addEventListener("click", (e) => { if (e.target === scrim) done(false); });
    scrim.addEventListener("dismiss", () => done(false));
    $("dialogRoot").append(scrim);
    queueMicrotask(() => ok.focus());
  });
}

// Open a sheet; `dirty` says whether closing would lose something the person typed.
function openLayer(node, { dirty = () => false, dispose = () => {} } = {}) {
  closeSheet(true);
  const back = document.activeElement;
  const scrim = el("div", { class: "scrim" });
  scrim.append(node);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) closeSheet(); });
  scrim.addEventListener("dismiss", () => closeSheet());
  $("sheetRoot").append(scrim);
  document.body.classList.add("locked");
  node.tabIndex = -1;
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
  if (!force && !prefersReducedMotion()) { s.scrim.classList.add("leaving"); await wait(170); }
  s.scrim.remove();
  if (s.back?.isConnected) s.back.focus();
  return true;
}

const field = (label, ...kids) => el("div", { class: "field" }, el("span", {}, label), ...kids);
const closeBtn = () => el("button", { class: "iconbtn", type: "button", "aria-label": t("close"), onclick: () => closeSheet() }, icon("close"));

// A small sheet with a form and one confirm button; onConfirm returns an error message or nothing.
function miniSheet(title, nodes, confirmLabel, onConfirm, { dirty, dispose } = {}) {
  const err = el("div", { class: "err", role: "alert" });
  const ok = el("button", { class: "btn primary big", type: "submit" }, confirmLabel);
  const form = el("form", { class: "sheet", role: "dialog", "aria-modal": "true", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ""; ok.disabled = true; ok.classList.add("busy");
    let msg;
    try { msg = await onConfirm((m) => (err.textContent = m)); } catch (x) { msg = x.message || String(x); }
    ok.disabled = false; ok.classList.remove("busy");
    if (msg) err.textContent = msg;
  } },
    el("div", { class: "sheet-head" }, el("h2", {}, title), closeBtn()),
    ...nodes, err,
    el("div", { class: "sheet-foot" }, el("button", { class: "btn", type: "button", onclick: () => closeSheet() }, t("cancel")), ok));
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
  finally { S.pending.delete(o.id); render(); }
}
// A tap on a step. Steps with consequences ask first or open their form:
// On the way emails the customer, Delivered asks for the proof, Nobody home asks for a new date,
// and going back a step says what the customer will see.
async function requestStep(o, i) {
  const cur = stepOf(o);
  if (i === cur || S.pending.has(o.id)) return;
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
      .gte("created_at", since).order("created_at", { ascending: false }).limit(1);
    const n = data?.[0];
    if (n) { toast(n.ok ? t("mailSent", { to }) : t("mailFail", { msg: n.detail.replace(/^\w+:\s*/, "") }), { ms: 6000 }); return; }
  }
  toast(t("mailUnknown"), { ms: 6000 });
}

// Ready: the florist can add a photo of the finished bouquet, which the customer sees on their link.
function readyDialog(o) {
  let setErr;
  const pic = photoPicker({ current: o.bouquet_path, hint: t("bouquetHint"), alt: t("bouquetPhoto"), onErr: (m) => setErr?.(m) });
  miniSheet(t("readyTitle", { num: o.num }), [field(t("bouquetPhoto"), pic.node)], t("confirmReady"), async (se) => {
    setErr = se;
    const bp = await pic.upload(o.id);
    if (bp !== undefined) {
      const { error } = isStaff() ? await sb.from("cdf_orders").update({ bouquet_path: bp }).eq("id", o.id)
        : await sb.rpc("cdf_set_bouquet", { p_id: o.id, p_path: bp });
      if (error) return t("saveFail", { msg: error.message });
      o.bouquet_path = bp;
      await pic.cleanup();
    }
    await closeSheet(true);
    await advance(o, 1);
  }, { dirty: () => pic.dirty, dispose: () => pic.dispose() });
}
function deliverDialog(o) {
  let setErr;
  const proof = photoPicker({ current: o.proof_path, hint: t("proofHint"), alt: t("proofPhoto"), onErr: (m) => setErr?.(m) });
  const note = el("textarea", { placeholder: t("deliveredNotePh"), rows: 2 });
  miniSheet(t("deliverTitle", { num: o.num }), [field(t("proofPhoto"), proof.node), field(t("noteOpt"), note)], t("confirmDelivered"), async (se) => {
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
  let setErr;
  const proof = photoPicker({ current: o.proof_path, hint: t("proofHint"), alt: t("proofPhoto"), onErr: (m) => setErr?.(m) });
  const iDate = el("input", { type: "date", value: addDays(S.today, 1), min: isStaff() ? null : S.today, required: true });
  const iSlot = slotPicker(o.slot);
  const note = el("textarea", { placeholder: t("missedNotePh"), rows: 2 });
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
    const pp = await proof.upload(o.id);
    const { data, error } = await sb.rpc("cdf_reschedule", { p_id: o.id, p_date: iDate.value, p_slot: slot, p_note: text,
      p_proof: pp ?? null, p_set_proof: pp !== undefined });
    if (error) return t("saveFail", { msg: error.message });
    await proof.cleanup();
    if (data) upsertLocal(data);
    await closeSheet(true); toast(t("rescheduled", { date: shortDate(iDate.value) })); loadOrders();
  }, { dirty: () => proof.dirty || !!note.value.trim(), dispose: () => proof.dispose() });
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
  const box = el("div", { class: "slot-pick" }, from, el("span", { "aria-hidden": "true" }, "→"), to);
  box.first = from;
  box.value = () => (from.value === "" || to.value === "" || +to.value <= +from.value ? "" : fmt(+from.value) + " - " + fmt(+to.value));
  return box;
}

// ---------- notices and history ----------
const CH_LABEL = { email: "Email", whatsapp: "WhatsApp", telegram: "Telegram", viber: "Viber", copy: t("copyShort") };
function notifyMsg(o, name, k) {
  const st = { prep: "msgPrep", ready: "msgReady", transit: "msgTransit", done: "msgDone", fail: "msgFail" }[k] || "msgTransit";
  return tIn("en", st, { name: name ? " " + name : "", num: o.num, link: trackUrl(o) });
}
async function logOpened(o, channel, recipient, label, message) {
  await sb.from("cdf_notifications").insert({ order_id: o.id, audience: "customer", channel, recipient, detail: label, subject: label, message, by_email: S.me.email });
}
const when = (ts) => new Date(ts).toLocaleString(locale(), { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function historyBlock(o) {
  const box = el("div", { class: "hist" });
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
  address: "deliveryAddr", card_message: "cardMsg", notes: "note", delivery_note: "deliveryNote", status: "status", delivery: "delivery",
  photo_path: "photo", bouquet_path: "bouquetPhoto", proof_path: "proofPhoto" };
const evValue = (k, v) => {
  if (v === null || v === "" || v === undefined) return "—";
  if (typeof v === "boolean") return v ? t("evPhotoYes") : t("evPhotoNo");
  if (k === "vendor_email" || k === "carrier_email") return memberName(v);
  if (k === "date") return shortDate(v);
  if (k === "status" || k === "delivery") return t("db_" + String(v).replace(/\W/g, "")) || v;
  return String(v);
};
function eventsBlock(o) {
  const box = el("div", { class: "hist" });
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
  return el("div", { class: "btn-row" },
    el("button", { class: "btn", type: "button", onclick: () => {
      if (!phone()) { toast(t("needPhone")); return; }
      window.open("https://wa.me/" + intlPhone(phone()) + "?text=" + encodeURIComponent(msg()), "_blank", "noopener");
      log("whatsapp", phone());
    } }, icon("message"), "WhatsApp"),
    el("button", { class: "btn", type: "button", onclick: () => navigator.clipboard?.writeText(msg()).then(() => { toast(t("msgCopied")); log("copy", ""); }, () => toast(t("selectCopy"))) }, t("copyMsg")));
}
const mapLink = (a) => el("a", { href: mapsUrl(a), target: "_blank", rel: "noopener", class: "plain-link" }, a + " ↗");

// ---------- an order, read-only (florists and drivers) ----------
function openOrderView(o) {
  const hist = historyBlock(o), cur = stepOf(o);
  const node = el("div", { class: "sheet", role: "dialog", "aria-modal": "true" },
    el("div", { class: "sheet-head" }, el("h2", {}, t("order", { num: o.num })), closeBtn()),
    el("dl", { class: "ro" },
      el("dt", {}, t("status")), el("dd", {}, el("span", { class: "pill s-" + STEPS[cur].k }, stepName(cur))),
      el("dt", {}, t("dateSlot")), el("dd", {}, longDate(o.date) + " · " + o.slot),
      el("dt", {}, t("recipient")), el("dd", {}, o.customer_name || t("noName")),
      el("dt", {}, t("address")), el("dd", {}, o.address ? mapLink(o.address) : t("noAddress")),
      o.customer_phone ? [el("dt", {}, t("phoneShort")), el("dd", {}, el("a", { href: "tel:+" + intlPhone(o.customer_phone), class: "plain-link" }, o.customer_phone))] : null,
      o.card_message ? [el("dt", {}, t("cardMsg")), el("dd", { class: "note" }, o.card_message)] : null,
      el("dt", {}, t("note")), el("dd", { class: "note" }, o.notes || t("noNotes")),
      el("dt", {}, t("photo")), el("dd", {}, o.photo_path ? imgOf(o.photo_path, bucket, t("photoAlt")) : t("noPhoto")),
      o.bouquet_path ? [el("dt", {}, t("bouquetPhoto")), el("dd", {}, imgOf(o.bouquet_path, ENTREGAS, t("bouquetPhoto")))] : null,
      o.delivery_note ? [el("dt", {}, t("deliveryNote")), el("dd", { class: "note" }, o.delivery_note)] : null,
      o.proof_path ? [el("dt", {}, t("proofPhoto")), el("dd", {}, imgOf(o.proof_path, ENTREGAS, t("proofPhoto")))] : null),
    el("div", { class: "field" }, el("span", {}, t("notifyBuyer")),
      notifyRow(o, () => o.buyer_name || o.customer_name || "", () => o.buyer_phone || o.customer_phone || "", () => STEPS[stepOf(o)].k, hist)),
    el("details", { class: "deliv" }, el("summary", {}, t("history")), hist),
    S.cap.events ? el("details", { class: "deliv" }, el("summary", {}, t("changeLog")), eventsBlock(o)) : null,
    el("div", { class: "sheet-foot" }, el("span"), el("button", { class: "btn", type: "button", onclick: () => closeSheet() }, t("close"))));
  openLayer(node);
}

// ---------- the order editor (admin and moderator) ----------
const DRAFT_KEY = "cdf-draft";
const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; } };
const writeDraft = (v) => { try { v ? localStorage.setItem(DRAFT_KEY, JSON.stringify(v)) : localStorage.removeItem(DRAFT_KEY); } catch {} };
// Re-read the team first so the lists never hold an email that was changed in the meantime
async function openFresh(o, opts) {
  if (isStaff()) await loadMembers();
  if (isStaff()) openEditor(o, opts); else openOrderView(o);
}
function openOrder(o) { openFresh(o); }

const ORDER_FIELDS = ["num", "date", "slot", "channel", "vendor_email", "carrier_email", "customer_name", "address", "customer_phone",
  "customer_email", "buyer_name", "buyer_phone", "card_message", "delivery_note", "notes"];
function openEditor(o, { copyFrom, draft } = {}) {
  const isNew = !o;
  const nextNum = String(Math.max(0, ...S.orders.map((x) => parseInt(x.num, 10) || 0)) + 1).padStart(4, "0");
  // No florist by default: an unassigned order shows up as such instead of landing on someone by accident.
  const blank = { num: nextNum, date: S.sel, slot: "", channel: "", vendor_email: "", carrier_email: "", customer_name: "", address: "", customer_phone: "",
    customer_email: "", buyer_name: "", buyer_phone: "", card_message: "", delivery_note: "", notes: "" };
  const src = o || (copyFrom ? { ...blank, ...Object.fromEntries(["slot", "channel", "vendor_email", "customer_name", "address", "customer_phone", "customer_email", "buyer_name", "buyer_phone", "card_message"].map((k) => [k, copyFrom[k] ?? ""])) } : draft ? { ...blank, ...draft } : blank);
  const f = Object.fromEntries(ORDER_FIELDS.map((k) => [k, src[k] ?? ""]));
  const sel = (id, opts, val) => el("select", { id }, ...opts.map(([v, l]) => el("option", { value: v, selected: v === val }, l)));
  const err = el("div", { class: "err", role: "alert" });
  const setErr = (m) => (err.textContent = m);

  const iDate = el("input", { type: "date", id: "f-date", value: f.date, required: true });
  const iSlot = slotPicker(f.slot);
  const iNum = el("input", { id: "f-num", value: f.num, inputmode: "numeric", class: "tnum", required: true });
  const iChan = sel("f-chan", [["", t("noChannel")], ...CHANNELS.map((c) => [c, c])], f.channel);
  const iName = el("input", { id: "f-name", value: f.customer_name, placeholder: t("namePh"), autocomplete: "off" });
  const iAddr = el("input", { id: "f-addr", value: f.address, placeholder: t("addrPh"), autocomplete: "off" });
  const iPhone = el("input", { id: "f-phone", type: "tel", value: f.customer_phone, placeholder: "0917 123 4567 · +34 600…", autocomplete: "off" });
  const iEmail = el("input", { id: "f-email", type: "email", value: f.customer_email, placeholder: "cliente@email.com", autocomplete: "off" });
  const iBName = el("input", { id: "f-bname", value: f.buyer_name, placeholder: t("buyerNamePh"), autocomplete: "off" });
  const iBPhone = el("input", { id: "f-bphone", type: "tel", value: f.buyer_phone, placeholder: "0917 123 4567 · +34 600…", autocomplete: "off" });
  // Not a gift: the buyer is the recipient, so their name and phone are only asked once
  const same = isNew && !copyFrom && !draft ? false : (!f.buyer_name || (f.buyer_name === f.customer_name && f.buyer_phone === f.customer_phone));
  if (same && !f.buyer_name) { iBName.value = f.customer_name; iBPhone.value = f.customer_phone; }
  const iSame = el("input", { type: "checkbox", id: "f-same", checked: same });
  const iCard = el("textarea", { id: "f-card", placeholder: t("cardPh"), rows: 2 }, f.card_message);
  const iDNote = el("textarea", { id: "f-dnote", placeholder: t("deliveryNotePh"), rows: 2 }, f.delivery_note);
  const iNotes = el("textarea", { id: "f-notes", placeholder: t("notesPh"), rows: 3 }, f.notes);
  const iVend = sel("f-vendor", [["", t("unassigned")], ...S.members.filter((m) => m.role !== "carrier").map((m) => [m.email, m.name + (m.role !== "vendor" ? " (" + t("role_" + m.role) + ")" : "")])], f.vendor_email);
  const iCarr = S.cap.carrier ? sel("f-carrier", [["", t("anyCarrier")], ...S.members.filter((m) => m.role === "carrier").map((m) => [m.email, m.name])], f.carrier_email) : null;
  const shot = photoPicker({ current: o?.photo_path, bkt: bucket, hint: t("pasteHint"), alt: t("photoAlt"), onErr: setErr, paste: true });
  const bouquet = photoPicker({ current: o?.bouquet_path, hint: t("bouquetHint"), alt: t("bouquetPhoto"), onErr: setErr });
  const proof = photoPicker({ current: o?.proof_path, hint: t("proofHint"), alt: t("proofPhoto"), onErr: setErr });
  const hist = isNew ? null : historyBlock(o);

  // What the form holds, cleaned the way it is stored
  const collect = () => {
    const sameNow = iSame.checked;
    return {
      num: iNum.value.trim(), date: iDate.value, slot: iSlot.value(), channel: iChan.value, vendor_email: iVend.value,
      carrier_email: iCarr ? iCarr.value : f.carrier_email,
      customer_name: (sameNow ? iBName.value : iName.value).trim(), address: iAddr.value.trim(),
      customer_phone: normPhone(sameNow ? iBPhone.value : iPhone.value), customer_email: iEmail.value.trim().toLowerCase(),
      buyer_name: iBName.value.trim(), buyer_phone: normPhone(iBPhone.value),
      card_message: iCard.value.trim(), delivery_note: iDNote.value.trim(), notes: iNotes.value.trim(),
    };
  };
  let initial = null;
  const dirty = () => JSON.stringify(collect()) !== JSON.stringify(initial) || shot.dirty || bouquet.dirty || proof.dirty;

  const linkBlock = isNew ? el("div", { class: "hint" }, t("linkAfterSave")) : (() => {
    const li = el("input", { id: "f-link", readonly: true, value: trackUrl(o), onfocus: (e) => e.target.select(), "aria-label": t("customerLink") });
    return el("div", { class: "link-row" }, li,
      el("button", { class: "btn", type: "button", onclick: () => navigator.clipboard?.writeText(li.value).then(() => toast(t("copied")), () => { li.focus(); li.select(); toast(t("selectCopy")); }) }, t("copy")),
      el("a", { class: "btn", href: trackUrl(o), target: "_blank", rel: "noopener" }, t("view")));
  })();

  const saveBtn = el("button", { class: "btn primary", type: "submit" }, t("save"));
  const syncSame = () => { node.querySelector(".recip").hidden = iSame.checked; };
  iSame.addEventListener("change", syncSame);

  const save = async () => {
    setErr("");
    for (const x of node.querySelectorAll(".missing")) x.classList.remove("missing");
    const row = collect();
    // Required: number, date, time, buyer name + (phone or email), recipient name, phone and address
    const need = [[iNum, row.num], [iDate, row.date], [iSlot, row.slot], [iBName, row.buyer_name],
      [iBPhone, iSame.checked ? row.buyer_phone : row.buyer_phone || row.customer_email], [iAddr, row.address]];
    if (!iSame.checked) need.push([iName, row.customer_name], [iPhone, row.customer_phone]);
    const miss = need.filter(([, v]) => !v).map(([x]) => x.closest(".field"));
    const badPhones = [[iBPhone, row.buyer_phone], [iPhone, iSame.checked ? "" : row.customer_phone]].filter(([, v]) => !phoneOk(v)).map(([x]) => x.closest(".field"));
    if (miss.length || badPhones.length) {
      [...miss, ...badPhones].forEach((x) => x.classList.add("missing"));
      [...miss, ...badPhones][0].scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      return miss.length ? (iSlot.closest(".field").classList.contains("missing") && iSlot.first.value ? t("slotInvalid") : t("fillRequired")) : t("phoneInvalid");
    }
    if (row.customer_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.customer_email)) { iEmail.closest(".field").classList.add("missing"); return t("emailInvalid"); }
    const dbRow = { ...row, vendor_email: row.vendor_email || null, carrier_email: row.carrier_email || null };
    if (!S.cap.carrier) delete dbRow.carrier_email;

    let saved, error;
    if (isNew) ({ data: saved, error } = await sb.from("cdf_orders").insert(dbRow).select().single());
    else {
      // Only what this person changed, so a status set meanwhile by the florist or driver is never undone.
      const changed = Object.fromEntries(Object.entries(dbRow).filter(([k, v]) => JSON.stringify(v ?? "") !== JSON.stringify(initial[k] ?? "")));
      const { data: server } = await sb.from("cdf_orders").select("*").eq("id", o.id).maybeSingle();
      if (!server) return t("goneMeanwhile");
      if (server.updated_at !== o.updated_at) {
        const clash = Object.keys(changed).filter((k) => JSON.stringify(server[k] ?? "") !== JSON.stringify(o[k] ?? ""));
        if (clash.length && !(await askConfirm(t("conflictAsk"), t("conflictKeepMine"), { detail: clash.map((k) => t(EV_FIELDS[k] || k)).join(", ") }))) return;
      }
      if (!Object.keys(changed).length && !shot.dirty && !bouquet.dirty && !proof.dirty) { await closeSheet(true); return; }
      ({ data: saved, error } = Object.keys(changed).length ? await sb.from("cdf_orders").update(changed).eq("id", o.id).select().single() : { data: server, error: null });
    }
    if (error) return error.code === "23505" ? t("dupNum", { num: row.num }) : t("saveFail", { msg: error.message });

    // Photos after the row exists; the old files go only once the row points at the new ones.
    const pics = {};
    let photoTrouble = false;
    for (const [k, p, dest] of [["photo_path", shot, (id) => id + ".jpg"], ["bouquet_path", bouquet], ["proof_path", proof]]) {
      try { const v = await p.upload(saved.id, dest); if (v !== undefined) pics[k] = v; } catch { photoTrouble = true; }
    }
    if (Object.keys(pics).length) {
      const r = await sb.from("cdf_orders").update(pics).eq("id", saved.id).select().single();
      if (r.error) photoTrouble = true; else { saved = r.data; await Promise.all([shot, bouquet, proof].map((p) => p.cleanup())); }
    }
    if (isNew) writeDraft(null);
    upsertLocal(saved);
    S.sel = row.date; S.month = monthOf(row.date);
    await closeSheet(true);
    toast(photoTrouble ? t("partialSave") : t(isNew ? "created" : "saved"));
    if (!inRange(row.date)) loadOrders(); else render();
  };

  const archived = !!o?.archived_at;
  const footLeft = isNew ? el("span") : el("div", { class: "btn-row" },
    el("button", { class: "btn", type: "button", onclick: async () => { if (await closeSheet()) openEditor(null, { copyFrom: o }); } }, icon("copy"), t("duplicate")),
    S.cap.archive ? el("button", { class: "btn", type: "button", onclick: () => setArchived([o], !archived) }, icon("archive"), t(archived ? "restore" : "archive")) : null,
    isAdmin() ? el("button", { class: "btn danger", type: "button", onclick: async () => {
      if (!(await askConfirm(t("askDelete", { num: o.num }), t("yesDelete"), { danger: true, detail: S.cap.archive ? t("deleteHintArchive") : null }))) return;
      const { error } = await sb.from("cdf_orders").delete().eq("id", o.id);
      if (error) { toast(t("deleteFail")); return; }
      await removeFiles([o]);
      S.orders = S.orders.filter((x) => x.id !== o.id);
      await closeSheet(true); toast(t("deleted")); render();
    } }, t("delete")) : null);

  const cur = o ? stepOf(o) : 0;
  const node = el("form", { class: "sheet", role: "dialog", "aria-modal": "true", novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    saveBtn.disabled = true; saveBtn.classList.add("busy");
    let msg;
    try { msg = await save(); } catch (x) { msg = t("saveFail", { msg: x.message || String(x) }); }
    saveBtn.disabled = false; saveBtn.classList.remove("busy");
    if (msg) setErr(msg);
  } },
    el("div", { class: "sheet-head" }, el("h2", {}, isNew ? t(copyFrom ? "duplicateTitle" : "newOrderTitle") : t("editOrder", { num: f.num })),
      o ? el("span", { class: "pill s-" + STEPS[cur].k }, stepName(cur)) : null, archived ? el("span", { class: "pill" }, t("archived")) : null, closeBtn()),
    copyFrom ? el("div", { class: "hint banner" }, t("duplicateHint")) : null,
    draft ? el("div", { class: "hint banner" }, t("draftRestored")) : null,
    el("div", { class: "f-row f-when" }, el("label", { class: "field req" }, el("span", {}, t("date")), iDate), el("div", { class: "field req" }, el("span", {}, t("slot")), iSlot)),
    el("div", { class: "f-row" }, el("label", { class: "field req" }, el("span", {}, t("orderNum")), iNum), el("label", { class: "field" }, el("span", {}, t("vendor")), iVend)),
    iCarr ? el("label", { class: "field" }, el("span", {}, t("carrier")), iCarr, el("div", { class: "hint" }, t("carrierHint"))) : null,
    el("div", { class: "group" }, el("h3", {}, t("buyerH")), el("div", { class: "hint" }, t("buyerHint")),
      el("div", { class: "f-row" }, el("label", { class: "field req" }, el("span", {}, t("name")), iBName),
        el("label", { class: "field req-or" }, el("span", {}, t("phone")), iBPhone)),
      el("label", { class: "field req-or" }, el("span", {}, t("email")), iEmail, el("div", { class: "hint" }, t("autoMailHint")))),
    el("div", { class: "group" }, el("h3", {}, t("recipientH")),
      el("label", { class: "check" }, iSame, el("span", {}, t("sameAsBuyer"))),
      el("div", { class: "f-row recip" }, el("label", { class: "field req" }, el("span", {}, t("customerName")), iName),
        el("label", { class: "field req" }, el("span", {}, t("phone")), iPhone)),
      el("div", { class: "field req" }, el("span", {}, t("deliveryAddr")), iAddr, el("div", { class: "hint" }, mapHint(iAddr))),
      el("label", { class: "field" }, el("span", {}, t("cardMsg")), iCard)),
    el("div", { class: "field" }, el("span", {}, t("photo")), shot.node),
    isNew ? null : el("div", { class: "field" }, el("span", {}, t("customerLink")), linkBlock,
      notifyRow(o, () => iBName.value.trim() || iName.value.trim(), () => iBPhone.value.trim() || iPhone.value.trim(), () => STEPS[stepOf(o)].k, hist)),
    el("details", { class: "deliv", open: !!(f.notes || f.channel || f.delivery_note || o?.proof_path || o?.bouquet_path) || null },
      el("summary", {}, t("moreDetails")),
      el("label", { class: "field" }, el("span", {}, t("channel")), iChan),
      el("label", { class: "field" }, el("span", {}, t("note")), iNotes),
      el("div", { class: "field" }, el("span", {}, t("bouquetPhoto")), bouquet.node),
      el("label", { class: "field" }, el("span", {}, t("deliveryNote")), iDNote, el("div", { class: "hint" }, t("deliveryNoteHint"))),
      el("div", { class: "field" }, el("span", {}, t("proofPhoto")), proof.node)),
    isNew ? null : el("details", { class: "deliv" }, el("summary", {}, t("history")), hist),
    !isNew && S.cap.events ? el("details", { class: "deliv" }, el("summary", {}, t("changeLog")), eventsBlock(o)) : null,
    err,
    el("div", { class: "sheet-foot" }, footLeft, saveBtn));

  // New orders keep a draft in this browser until they are saved, in case the tab closes.
  let draftT;
  const keepDraft = () => { if (!isNew) return; clearTimeout(draftT); draftT = setTimeout(() => writeDraft(dirty() ? collect() : null), 400); };
  node.addEventListener("input", (e) => { e.target.closest(".field")?.classList.remove("missing"); keepDraft(); });
  node.addEventListener("change", (e) => { e.target.closest(".field")?.classList.remove("missing"); keepDraft(); });
  openLayer(node, { dirty, dispose: () => { [shot, bouquet, proof].forEach((p) => p.dispose()); clearTimeout(draftT); } });
  syncSame();
  // The form as it opened is the baseline: only what differs from it is saved (and asked about on close).
  // A copy or a restored draft counts as unsaved work from the start.
  initial = copyFrom || draft ? { ...collect(), num: "" } : collect();
  sheet.order = o;
}
function mapHint(input) {
  const a = el("a", { target: "_blank", rel: "noopener", class: "plain-link" }, t("openMaps"));
  const sync = () => { a.href = mapsUrl(input.value); a.hidden = !input.value.trim(); };
  input.addEventListener("input", sync); sync();
  return a;
}
// New order: offer the unsaved draft first, if there is one
async function newOrder() {
  if (isStaff()) await loadMembers();
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
  sheet.node.querySelector(".sheet-head").after(el("div", { class: "hint banner changed-banner", role: "status" }, t("changedMeanwhile")));
});

// ---------- archive ----------
async function setArchived(list, on) {
  if (!list.length) return;
  const ids = list.map((o) => o.id);
  const { error } = await sb.from("cdf_orders").update({ archived_at: on ? new Date().toISOString() : null }).in("id", ids);
  if (error) { toast(t("saveFail", { msg: error.message })); return; }
  if (sheet && list.some((o) => o.id === sheet.order?.id)) await closeSheet(true);
  if (on) S.orders = S.orders.filter((o) => !ids.includes(o.id));
  S.selected.clear();
  toast(on ? t("archivedN", { n: list.length }) : t("restoredN", { n: list.length }), on ? { action: t("undo"), onAction: () => setArchived(list, false) } : {});
  if (!on) loadOrders(); else render();
  if (S.hits) runSearch();
}
