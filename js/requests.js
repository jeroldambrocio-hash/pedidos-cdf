// Requests from the public order form (Phase 3). Admins see them here, with a counter in the sidebar, and
// reject them or accept them. Accepting opens the order editor already filled in from the request; saving
// it creates the order and closes the request in one step on the server (cdf_request_accept).
// A request is not an order: it is not in the calendar, the florists' work or the statistics until accepted.

const RQ = { list: [], filter: "open", channel: null, keys: {} };
const reqIsOpen = (r) => r.status === "received" || r.status === "in_review";
const reqRef = (r) => "R" + r.ref;
const reqPast = (r) => reqIsOpen(r) && r.date < manilaToday();
const reqOn = () => isAdmin() && !!S.cap.requests;

function reqStatusTag(r) {
  if (reqPast(r)) return el("span", { class: "tag req-tag past" }, t("reqDatePassed"));
  return el("span", { class: "tag req-tag " + r.status }, t("reqSt_" + r.status));
}
const reqWhen = (r) => longDate(r.date) + " · " + String(r.slot).replace(" - ", " – ");
const reqAgo = (ts) => {
  const m = Math.round((Date.now() - new Date(ts)) / 60e3);
  if (m < 1) return t("reqJustNow");
  if (m < 60) return t("reqMinAgo", { n: m });
  if (m < 24 * 60) return t("reqHourAgo", { n: Math.round(m / 60) });
  return new Date(ts).toLocaleString(locale(), { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

async function loadRequests() {
  $("tabRequests").hidden = !reqOn();
  if (!reqOn()) { RQ.list = []; return; }
  const { data, error } = await sb.from("cdf_order_requests").select("*").order("created_at", { ascending: false }).limit(300);
  if (error) { if (S.tab === "requests") fill($("requestsBody"), el("p", { class: "err" }, t("reqLoadFail"))); return; }
  RQ.list = data || [];
  paintRequestCount();
  if (S.tab === "requests") renderRequests();
}

function paintRequestCount() {
  const n = RQ.list.filter(reqIsOpen).length, c = $("tabRequestsCount");
  c.textContent = n ? String(n) : ""; c.hidden = !n;
  $("tabRequests").dataset.tip = n ? t("reqTabCount", { n }) : t("tabRequests");
  $("tabRequests").setAttribute("aria-label", $("tabRequests").dataset.tip);
}

// New and changed requests as they happen. A new one gets a short notice with its reference only.
function subscribeRequests() {
  if (RQ.channel) { sb.removeChannel(RQ.channel); RQ.channel = null; }
  if (!reqOn()) return;
  RQ.channel = sb.channel("cdf-requests").on("postgres_changes", { event: "*", schema: "public", table: "cdf_order_requests" }, (p) => {
    const row = p.new?.id ? p.new : null, id = row?.id || p.old?.id;
    const i = RQ.list.findIndex((r) => r.id === id);
    if (p.eventType === "DELETE") { if (i >= 0) RQ.list.splice(i, 1); }
    else if (i >= 0) RQ.list[i] = { ...RQ.list[i], ...row };
    else { RQ.list.unshift(row); if (p.eventType === "INSERT") toast(t("reqNewToast", { ref: reqRef(row) }), { action: t("reqOpenIt"), onAction: () => openRequest(row) }); }
    paintRequestCount();
    if (S.tab === "requests") renderRequests();
    document.dispatchEvent(new CustomEvent("requestchange", { detail: row || { id } }));
  }).subscribe();
}

function renderRequests() {
  const body = $("requestsBody");
  if (!body) return;
  const counts = { open: 0, accepted: 0, rejected: 0 };
  for (const r of RQ.list) counts[reqIsOpen(r) ? "open" : r.status === "accepted" ? "accepted" : "rejected"]++;
  for (const b of $("reqFilter").querySelectorAll("button[data-f]")) {
    b.setAttribute("aria-pressed", String(b.dataset.f === RQ.filter));
    b.querySelector(".count").textContent = String(counts[b.dataset.f] ?? 0);
  }
  const shown = RQ.list.filter((r) => (RQ.filter === "open" ? reqIsOpen(r) : RQ.filter === "accepted" ? r.status === "accepted" : r.status === "rejected" || r.status === "expired"))
    // Open ones by delivery date (the nearest first, past dates on top so they are not missed); the rest newest first
    .sort((a, b) => (RQ.filter === "open" ? a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot) : b.created_at.localeCompare(a.created_at)));
  if (!shown.length) return fill(body, el("div", { class: "empty req-empty" }, icon("inbox"), el("p", {}, t(RQ.filter === "open" ? "reqNoneOpen" : "reqNone"))));
  fill(body, el("ul", { class: "req-list" }, shown.map((r) => el("li", {},
    el("button", { class: "req-card" + (r.status === "received" ? " is-new" : ""), type: "button", "data-id": r.id, onclick: () => openRequest(r) },
      el("span", { class: "req-top" }, el("b", { class: "req-ref" }, reqRef(r)), reqStatusTag(r), el("span", { class: "spacer" }), el("small", { class: "note" }, reqAgo(r.created_at))),
      el("span", { class: "req-when" }, icon(r.mode === "pickup" ? "box" : "truck"), " ", reqWhen(r)),
      el("span", { class: "req-who" }, r.buyer_name, r.receiver_name !== r.buyer_name ? " → " + r.receiver_name : null),
      el("span", { class: "req-what note" }, r.description))))));
}

function setRequestFilter(f) { RQ.filter = f; renderRequests(); }

// ---------- one request ----------
async function openRequest(r) {
  if (!reqOn()) return;
  // Opening it tells the other admins someone has it (received → in review). Nothing else changes.
  if (r.status === "received") {
    const { data } = await sb.rpc("cdf_request_open", { p_id: r.id });
    if (data) { Object.assign(r, data); const i = RQ.list.findIndex((x) => x.id === r.id); if (i >= 0) RQ.list[i] = r; paintRequestCount(); if (S.tab === "requests") renderRequests(); }
  }
  const [files, similar, events] = await Promise.all([
    sb.from("cdf_request_files").select("id,kind,path,width,height").eq("request_id", r.id).order("created_at").then((x) => x.data || []),
    sb.rpc("cdf_request_similar", { p_id: r.id }).then((x) => x.data || { requests: [], orders: [] }, () => ({ requests: [], orders: [] })),
    sb.from("cdf_request_events").select("kind,by_email,detail,created_at").eq("request_id", r.id).order("created_at").then((x) => x.data || []),
  ]);
  const refs = files.filter((f) => f.kind === "reference"), proof = files.find((f) => f.kind === "payment_proof");
  const tel = (p) => el("a", { href: "tel:+" + intlPhone(p), class: "link-out" }, phoneNice(p));
  const pinUrl = r.lat != null ? `https://www.google.com/maps/search/?api=1&query=${+r.lat},${+r.lng}` : null;
  const err = el("div", { class: "err", role: "alert" });
  const dupes = [...similar.requests.map((x) => ({ label: "R" + x.ref, open: () => { const o = RQ.list.find((y) => y.id === x.id); if (o) openRequest(o); } })),
    ...similar.orders.map((x) => ({ label: "#" + x.num, open: async () => { const { data } = await sb.from("cdf_orders").select("*").eq("id", x.id).maybeSingle(); if (data) openOrder(data); } }))];

  const acts = [];
  if (reqIsOpen(r)) {
    acts.push(el("button", { class: "btn danger foot-act", type: "button", onclick: () => rejectRequest(r) }, icon("close"), el("span", { class: "lbl" }, t("reqReject"))));
    acts.push(el("span", { class: "spacer" }));
    acts.push(el("button", { class: "btn primary", type: "button", onclick: () => acceptRequest(r) }, icon("check"), " ", t("reqAccept")));
  } else if (r.status === "rejected") {
    acts.push(el("span", { class: "spacer" }), el("button", { class: "btn", type: "button", onclick: () => reopenRequest(r, err) }, icon("refresh"), " ", t("reqReopen")));
  } else if (r.status === "accepted" && r.accepted_order_id) {
    acts.push(el("span", { class: "spacer" }), el("button", { class: "btn primary", type: "button", onclick: async () => {
      const o = byId(r.accepted_order_id) || (await sb.from("cdf_orders").select("*").eq("id", r.accepted_order_id).maybeSingle()).data;
      if (o) openOrder(o); else err.textContent = t("goneMeanwhile");
    } }, t("reqSeeOrder")));
  } else acts.push(el("span", { class: "spacer" }));

  const node = el("div", { class: "sheet req-sheet", role: "dialog", "aria-modal": "true" },
    el("div", { class: "sheet-head" }, el("h2", {}, t("reqTitle", { ref: reqRef(r) })), reqStatusTag(r), el("span", { class: "spacer" }), closeBtn()),
    el("div", { class: "sheet-body" },
      r.status === "in_review" && r.reviewed_by && r.reviewed_by !== S.me?.email
        ? el("div", { class: "sheet-note" }, icon("user"), el("span", {}, t("reqBeingReviewed", { who: reqWho(r.reviewed_by) }))) : null,
      r.status === "rejected" ? el("div", { class: "sheet-note cancel-note" }, icon("close"), el("span", {}, r.reject_reason ? t("reqRejectedWhy", { why: r.reject_reason }) : t("reqRejectedNoWhy"))) : null,
      reqPast(r) ? el("div", { class: "sheet-note warn" }, icon("alert"), el("span", {}, t("reqPastHint"))) : null,
      dupes.length ? el("div", { class: "sheet-note warn req-dupes" }, icon("alert"), el("span", {}, t("reqSimilar"), " ",
        dupes.flatMap((d, i) => [i ? ", " : "", el("button", { class: "linkish", type: "button", onclick: async () => { if (await closeSheet()) d.open(); } }, d.label)]))) : null,
      el("section", {}, el("dl", { class: "ro" },
        el("dt", {}, t("reqWhen")), el("dd", {}, reqWhen(r)),
        el("dt", {}, t("buyerH")), el("dd", {}, r.buyer_name, " · ", tel(r.buyer_phone)),
        el("dt", {}, t("recipientH")), r.receiver_name === r.buyer_name && r.receiver_phone === r.buyer_phone ? el("dd", {}, t("reqSameAsBuyer")) : el("dd", {}, r.receiver_name, " · ", tel(r.receiver_phone)),
        el("dt", {}, t(r.mode === "pickup" ? "reqPickup" : "address")),
        r.mode === "pickup" ? el("dd", {}, t("reqPickupDd")) : el("dd", {}, r.address,
          pinUrl ? el("br") : null, pinUrl ? el("a", { class: "link-out", href: pinUrl, target: "_blank", rel: "noopener" }, icon("map"), " ", t("reqPinMap")) : null,
          r.location_source ? el("small", { class: "note req-pin-src" }, t("reqPinSrc_" + r.location_source)) : null),
        el("dt", {}, t("reqWhat")), el("dd", { class: "msg" }, r.description),
        r.special_requests ? [el("dt", {}, t("reqSpecial")), el("dd", { class: "msg" }, r.special_requests)] : null,
        r.card_message ? [el("dt", {}, t("cardMsg")), el("dd", { class: "msg" }, r.card_message)] : null,
        el("dt", {}, t("reqMethod")), el("dd", {}, t("pm_" + r.payment_method)),
        refs.length ? [el("dt", {}, t("reqRefs")), el("dd", {}, el("div", { class: "photo-grid ro" }, refs.map((f, i) => el("div", { class: "pic" }, imgOf(f.path, "cdf-solicitudes", t("reqRefN", { n: i + 1 }), true)))))] : null,
        proof ? [el("dt", {}, t("reqProof")), el("dd", {}, el("div", { class: "pic" }, imgOf(proof.path, "cdf-solicitudes", t("reqProof"), true)),
          el("p", { class: "note req-unverified" }, icon("alert"), " ", t("reqProofUnverified")))] : null)),
      el("section", {}, el("details", { class: "hist" }, el("summary", {}, t("historyAll")),
        el("ol", { class: "req-events" }, events.map((e) => el("li", {}, el("b", {}, t("reqEv_" + e.kind)),
          e.by_email ? " · " + reqWho(e.by_email) : "", e.detail?.num ? " · #" + e.detail.num : "", e.detail?.reason ? " · " + e.detail.reason : "",
          el("small", { class: "note" }, " " + reqAgo(e.created_at))))))),
      err),
    el("div", { class: "sheet-foot" }, ...acts));
  openLayer(node);
}

const reqWho = (email) => S.members?.find((m) => m.email === email)?.name || email;

function rejectRequest(r) {
  const why = el("textarea", { id: "req-reason", rows: 3, maxlength: 500, placeholder: t("reqReasonPh") });
  miniSheet(t("reqRejectTitle", { ref: reqRef(r) }), [el("p", { class: "note", style: "margin:0" }, t("reqRejectHint")), field(t("reqReason"), why)], t("reqReject"), async () => {
    const { data, error } = await sb.rpc("cdf_request_reject", { p_id: r.id, p_reason: why.value.trim() });
    if (error) return reqError(error);
    Object.assign(r, data); await closeSheet(true);
    toast(t("reqRejectedToast", { ref: reqRef(r) }));
    paintRequestCount(); if (S.tab === "requests") renderRequests();
  }, { dirty: () => !!why.value.trim() });
}

async function reopenRequest(r, err) {
  const { data, error } = await sb.rpc("cdf_request_reopen", { p_id: r.id });
  if (error) { err.textContent = reqError(error); return; }
  Object.assign(r, data); await closeSheet(true);
  paintRequestCount(); if (S.tab === "requests") renderRequests();
  openRequest(r);
}

function reqError(e) {
  const m = e?.message || "";
  if (/cdf_request_taken/.test(m)) return t("reqTaken");
  if (/cdf_request_closed/.test(m)) return t("reqClosed");
  if (/cdf_request_gone/.test(m)) return t("goneMeanwhile");
  if (e?.code === "42501") return t("createForbidden");
  return t("saveFail", { msg: m });
}

// What the editor opens with: the request's details where the order keeps them, and the rest in the notes
function requestDraft(r) {
  const notes = [r.description, r.special_requests ? t("reqSpecialNote", { text: r.special_requests }) : "", r.mode === "pickup" ? t("reqPickupNote") : "",
    t("reqFromNote", { ref: reqRef(r), method: t("pm_" + r.payment_method) })].filter(Boolean).join("\n");
  return { date: r.date, slot: r.slot, channel: "Web", buyer_name: r.buyer_name, buyer_phone: r.buyer_phone,
    customer_name: r.receiver_name, customer_phone: r.receiver_phone, address: r.mode === "pickup" ? t("reqPickupAddress") : r.address,
    drop_lat: r.lat != null ? +r.lat : null, drop_lng: r.lng != null ? +r.lng : null, card_message: r.card_message, notes, delivery_note: "" };
}

async function acceptRequest(r) {
  if (!(await closeSheet())) return;
  await refreshNumTop().catch(() => {});
  // One operation key per request in this tab: saving again after a lost answer returns the same order
  const key = (RQ.keys[r.id] ||= { key: crypto.randomUUID(), id: crypto.randomUUID() });
  await openFresh(null, { draft: requestDraft(r), fromRequest: { ...r, accept: key } });
}

// While accepting: the request's photos, to look at while writing the order
function requestPhotos(r) {
  const box = el("section", { class: "req-on-order", hidden: true });
  sb.from("cdf_request_files").select("kind,path").eq("request_id", r.id).order("created_at").then(({ data }) => {
    const refs = (data || []).filter((f) => f.kind === "reference"), proof = (data || []).find((f) => f.kind === "payment_proof");
    if (!refs.length && !proof) return;
    fill(box, el("h3", {}, t("reqRefs")),
      refs.length ? el("div", { class: "photo-grid ro" }, refs.map((f, i) => el("div", { class: "pic" }, imgOf(f.path, "cdf-solicitudes", t("reqRefN", { n: i + 1 }), true)))) : null,
      proof ? el("p", { class: "note req-unverified" }, icon("alert"), " ", t("reqProofAccepting")) : null);
    box.hidden = false;
  });
  return box;
}

// The customer's photos on an order that came from a request (admins: all; its florist: the reference photos)
function orderReferences(o) {
  const box = el("div", { class: "req-on-order", hidden: true });
  if (!o?.id || !S.cap.requests && !S.cap.references) return box;
  sb.rpc("cdf_order_references", { p_order: o.id }).then(({ data }) => {
    if (!data?.length) return;
    const refs = data.filter((f) => f.kind === "reference"), proof = data.find((f) => f.kind === "payment_proof");
    fill(box, el("h3", {}, t("reqOnOrder", { ref: "R" + data[0].request_ref })),
      refs.length ? el("div", { class: "photo-grid ro" }, refs.map((f, i) => el("div", { class: "pic" }, imgOf(f.path, "cdf-solicitudes", t("reqRefN", { n: i + 1 }), true)))) : null,
      proof ? el("div", { class: "req-proof-on-order" }, el("div", { class: "pic" }, imgOf(proof.path, "cdf-solicitudes", t("reqProof"), true)),
        el("p", { class: "note" }, t("reqProofOnOrder"))) : null);
    box.hidden = false;
  }, () => {});
  return box;
}
