// Requests from the public order form (Phase 3). Admins see them here, with a counter in the sidebar, and
// reject them or accept them. Accepting opens the order editor already filled in from the request; saving
// it creates the order and closes the request in one step on the server (cdf_request_accept).
// A request is not an order: it is not in the calendar, the florists' work or the statistics until accepted.

const RQ = { list: [], filter: "open", kind: "all", channel: null, keys: {}, counts: null, closedLimit: 300, closedMore: false, orders: new Map() };
const CLOSED = ["accepted", "rejected", "expired"];
const reqBucket = (r) => (reqIsOpen(r) ? "open" : r.status === "accepted" ? "accepted" : "rejected");
const reqKindOk = (r, kind = RQ.kind) => kind === "all" || r.mode === kind;
const reqIsOpen = (r) => r.status === "received" || r.status === "in_review";
const reqRef = (r) => "R" + r.ref;
const reqPast = (r) => reqIsOpen(r) && r.date < manilaToday();
const reqOn = () => isAdmin() && !!S.cap.requests;

function reqStatusTag(r) {
  if (reqPast(r)) return el("span", { class: "tag req-tag past" }, t("reqDatePassed"));
  return el("span", { class: "tag req-tag " + r.status }, t("reqSt_" + r.status));
}
const reqWhen = (r) => longDate(r.date) + " · " + formatSlot12(r.slot);
const reqAgo = (ts) => {
  const m = Math.round((Date.now() - new Date(ts)) / 60e3);
  if (m < 1) return t("reqJustNow");
  if (m < 60) return t("reqMinAgo", { n: m });
  if (m < 24 * 60) return t("reqHourAgo", { n: Math.round(m / 60) });
  return formatDateTime12(ts);
};

// Every request still to review is loaded, however many (a page at a time); of the closed ones, the latest
// (more on demand). The counters come from the server, so they are exact whatever is loaded (12/11/2026).
async function loadRequests() {
  $("tabRequests").hidden = !reqOn();
  if (!reqOn()) { RQ.list = []; return; }
  const gen = sessionNow();
  const open = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from("cdf_order_requests").select("*").in("status", ["received", "in_review"]).order("created_at", { ascending: false }).range(from, from + 499);
    if (stale(gen)) return;
    if (error) { if (S.tab === "requests") fill($("requestsBody"), el("p", { class: "err" }, t("reqLoadFail"))); return; }
    open.push(...(data || []));
    if (!data || data.length < 500) break;
  }
  const [closed, counts] = await Promise.all([
    sb.from("cdf_order_requests").select("*").in("status", CLOSED).order("created_at", { ascending: false }).range(0, RQ.closedLimit),
    sb.rpc("cdf_request_counts").then((r) => r, () => ({ error: true })),
  ]);
  if (stale(gen)) return;
  if (closed.error) { if (S.tab === "requests") fill($("requestsBody"), el("p", { class: "err" }, t("reqLoadFail"))); return; }
  RQ.closedMore = (closed.data || []).length > RQ.closedLimit;
  RQ.list = [...open, ...(closed.data || []).slice(0, RQ.closedLimit)];
  RQ.counts = !counts.error && counts.data && typeof counts.data === "object" ? counts.data : null;
  await loadRequestOrders();
  if (stale(gen)) return;
  paintRequestCount();
  if (S.tab === "requests") renderRequests();
}
// What became of each accepted request's order: there, in the trash, or deleted (12/11/2026)
async function loadRequestOrders() {
  const gen = sessionNow();
  const ids = [...new Set(RQ.list.filter((r) => r.status === "accepted" && r.accepted_order_id).map((r) => r.accepted_order_id))];
  RQ.orders = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from("cdf_orders").select("id,num" + (S.cap.trash ? ",deleted_at" : "")).in("id", ids.slice(i, i + 200));
    if (stale(gen)) return;
    for (const o of data || []) RQ.orders.set(o.id, o);
  }
}
// "Accepted" on its own says nothing once the order is in the trash or gone: say what happened, with its number
function reqOrderState(r) {
  if (r.status !== "accepted") return null;
  const o = r.accepted_order_id ? RQ.orders.get(r.accepted_order_id) : null;
  const num = o?.num || r.accepted_order_num || null;
  if (!r.accepted_order_id) return { state: "deleted", num };
  if (!o) return { state: "unknown", num };
  return { state: o.deleted_at ? "trash" : "active", num };
}
// Counts by status bucket and type: the server's exact ones, else what is loaded
function reqCount(bucket, kind) {
  if (RQ.counts) {
    const k = (m) => RQ.counts[bucket + ":" + m] || 0;
    return kind === "all" ? k("pickup") + k("delivery") : k(kind);
  }
  return RQ.list.filter((r) => reqBucket(r) === bucket && reqKindOk(r, kind)).length;
}

// The filter counts come from the server: ask again after any change (once, if several arrive together).
// Without this they stayed as they were when the tab was loaded (13/11/2026).
function refreshRequestCounts() {
  clearTimeout(refreshRequestCounts.h);
  refreshRequestCounts.h = setTimeout(async () => {
    if (!reqOn()) return;
    const gen = sessionNow();
    const r = await sb.rpc("cdf_request_counts").then((x) => x, () => ({ error: true }));
    if (stale(gen) || r.error || !r.data || typeof r.data !== "object") return;
    RQ.counts = r.data;
    if (S.tab === "requests") renderRequests();
  }, 300);
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
  RQ.channel = sb.channel("cdf-requests").on("postgres_changes", { event: "*", schema: "public", table: "cdf_order_requests" }, async (p) => {
    const row = p.new?.id ? p.new : null, id = row?.id || p.old?.id;
    // Just accepted: its order is new to this screen, so fetch it first (it read "not available" until a reload, 13/11/2026)
    if (row?.status === "accepted" && row.accepted_order_id && !RQ.orders?.has(row.accepted_order_id)) {
      const gen = sessionNow();
      const { data } = await sb.from("cdf_orders").select("id,num" + (S.cap.trash ? ",deleted_at" : "")).eq("id", row.accepted_order_id).maybeSingle();
      if (stale(gen)) return;
      if (data) { if (!RQ.orders) RQ.orders = new Map(); RQ.orders.set(data.id, data); }
    }
    const i = RQ.list.findIndex((r) => r.id === id);
    if (p.eventType === "DELETE") { if (i >= 0) RQ.list.splice(i, 1); }
    else if (i >= 0) RQ.list[i] = { ...RQ.list[i], ...row };
    else { RQ.list.unshift(row); if (p.eventType === "INSERT") toast(t("reqNewToast", { ref: reqRef(row) }), { action: t("reqOpenIt"), onAction: () => openRequest(row) }); }
    paintRequestCount(); refreshRequestCounts();
    if (S.tab === "requests") renderRequests();
    document.dispatchEvent(new CustomEvent("requestchange", { detail: row || { id } }));
  }).subscribe(onRejoin(() => loadRequests()));
}

// The form's address, to paste in WhatsApp, Instagram or the shop (shown while the form is switched on)
function paintRequestLink() {
  const box = $("reqLink");
  if (!box) return;
  box.hidden = window.CDF_CONFIG.features?.publicOrder !== true;
  if (box.hidden || box.dataset.ready) return;
  box.dataset.ready = "1";
  const url = location.origin + "/pedido.html";
  const a = $("reqLinkUrl");
  a.href = url; a.textContent = url.replace(/^https?:\/\//, "");
  $("reqLinkCopy").onclick = () => navigator.clipboard?.writeText(url).then(() => toast(t("copied")), () => toast(t("selectCopy"), { type: "info" }));
  if (navigator.share) {
    const share = $("reqLinkShare");
    share.hidden = false;
    share.onclick = () => navigator.share({ title: "Casa de Flores", text: t("reqLinkShareText"), url }).catch(() => {});
  }
}

function renderRequests() {
  paintRequestLink();
  const body = $("requestsBody");
  if (!body) return;
  // Status and type work together: each counter counts within the other filter
  for (const b of $("reqFilter").querySelectorAll("button[data-f]")) {
    b.setAttribute("aria-pressed", String(b.dataset.f === RQ.filter));
    b.querySelector(".count").textContent = String(reqCount(b.dataset.f, RQ.kind));
  }
  for (const b of $("reqKind")?.querySelectorAll("button[data-k]") || []) {
    b.setAttribute("aria-pressed", String(b.dataset.k === RQ.kind));
    b.querySelector(".count").textContent = String(reqCount(RQ.filter, b.dataset.k));
  }
  if (typeof placePill === "function") { placePill($("reqFilter")); if ($("reqKind")) placePill($("reqKind")); }
  const shown = RQ.list.filter((r) => reqBucket(r) === RQ.filter && reqKindOk(r))
    // Open ones by delivery date (the nearest first, past dates on top so they are not missed); the rest newest first
    .sort((a, b) => (RQ.filter === "open" ? a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot) : b.created_at.localeCompare(a.created_at)));
  const more = RQ.filter !== "open" && RQ.closedMore ? el("button", { class: "btn ghost req-more", type: "button", onclick: async (e) => {
    e.currentTarget.disabled = true; RQ.closedLimit += 300; await loadRequests(); } }, t("reqLoadMore")) : null;
  if (!shown.length) return fill(body, el("div", { class: "empty req-empty" }, icon("inbox"), el("p", {}, t(RQ.filter === "open" ? "reqNoneOpen" : "reqNone"))), more);
  fill(body, el("ul", { class: "req-list" }, shown.map((r) => el("li", {}, reqCard(r)))), more);
}

// One request in the list. The type is written out, and each type shows what matters for it:
// Pickup: the shop, when, and who comes for it. Delivery: where, when, and buyer → recipient.
function reqCard(r) {
  const pickup = r.mode === "pickup", same = r.receiver_name === r.buyer_name;
  const os = reqOrderState(r);
  return el("button", { class: "req-card " + (pickup ? "is-pickup" : "is-delivery") + (r.status === "received" ? " is-new" : ""), type: "button", "data-id": r.id, onclick: () => openRequest(r) },
    el("span", { class: "req-top" }, el("b", { class: "req-ref" }, reqRef(r)), reqKindTag(r), reqStatusTag(r), el("span", { class: "spacer" }), el("small", { class: "note" }, reqAgo(r.created_at))),
    el("span", { class: "req-when" }, icon("clock"), " ", reqWhen(r)),
    pickup
      ? el("span", { class: "req-where" }, icon("flower"), " ", r.pickup_branch ? t("pickupAt", { shop: r.pickup_branch }) : t("reqShopNotChosen"))
      : el("span", { class: "req-where" }, icon("map"), " ", el("span", { class: "req-addr" }, r.address || "—")),
    el("span", { class: "req-who" }, pickup ? [t("reqPicksUp") + " ", el("b", {}, r.receiver_name)] : [r.buyer_name, same ? null : " → " + r.receiver_name]),
    os && os.state !== "active" ? el("span", { class: "req-order " + os.state }, icon(os.state === "trash" ? "trash" : "alert"), " ", reqOrderText(os)) : null,
    el("span", { class: "req-what note" }, r.description));
}
const reqKindTag = (r) => el("span", { class: "tag req-kind " + (r.mode === "pickup" ? "pickup" : "delivery") }, icon(r.mode === "pickup" ? "box" : "truck"), t(r.mode === "pickup" ? "modePickup" : "modeDelivery"));
function reqOrderText(os) {
  const num = os.num ? "#" + os.num : "";
  return os.state === "trash" ? t("reqOrderTrash", { num }) : os.state === "deleted" ? t("reqOrderDeleted", { num }) : os.state === "unknown" ? t("reqOrderUnknown", { num }) : num;
}

function setRequestFilter(f) { RQ.filter = f; renderRequests(); }
function setRequestKind(k) { RQ.kind = k; renderRequests(); }

// ---------- one request ----------
async function requestResult(query) {
  const result = await query;
  if (result.error) throw new Error(t("reqLoadFail"));
  return result.data;
}
function requestLoadError(retry) {
  toast(t("reqLoadFail"), { type: "error", action: t("retry"), onAction: retry });
}
async function openRequest(r) {
  if (!reqOn()) return;
  // Signed out (or another account) while it loaded: never open the customer's details afterwards (13/11/2026)
  const gen = sessionNow();
  // Opening it tells the other admins someone has it (received → in review). Nothing else changes.
  if (r.status === "received") {
    const result = await Promise.resolve(sb.rpc("cdf_request_open", { p_id: r.id })).catch(() => ({ error: true }));
    if (stale(gen)) return;
    if (result.error) { requestLoadError(() => openRequest(r)); return; }
    const { data } = result;
    if (data) { Object.assign(r, data); const i = RQ.list.findIndex((x) => x.id === r.id); if (i >= 0) RQ.list[i] = r; paintRequestCount(); refreshRequestCounts(); if (S.tab === "requests") renderRequests(); }
  }
  const loaded = await Promise.all([
    requestResult(sb.from("cdf_request_files").select("id,kind,path,width,height").eq("request_id", r.id).order("created_at")).then(x => x || []),
    requestResult(sb.rpc("cdf_request_similar", { p_id: r.id })).then(x => x || { requests: [], orders: [] }),
    requestResult(sb.from("cdf_request_events").select("kind,by_email,detail,created_at").eq("request_id", r.id).order("created_at")).then(x => x || []),
    // Accepted: where its order is now (there, in the trash, deleted), with who, when and why (12/11/2026)
    r.status === "accepted" && S.cap.trash ? requestResult(sb.rpc("cdf_request_order", { p_id: r.id })) : null,
  ]).catch(() => null);
  if (stale(gen) || !reqOn()) return;
  if (!loaded) { requestLoadError(() => openRequest(r)); return; }
  const [files, similar, events, orderNow] = loaded;
  const os = orderNow || reqOrderState(r);
  const refs = files.filter((f) => f.kind === "reference"), proof = files.find((f) => f.kind === "payment_proof");
  const tel = (p) => el("a", { href: "tel:+" + intlPhone(p), class: "link-out" }, phoneNice(p));
  const pinUrl = r.lat != null ? `https://www.google.com/maps/search/?api=1&query=${+r.lat},${+r.lng}` : null;
  const err = el("div", { class: "err", role: "alert" });
  const dupes = [...similar.requests.map((x) => ({ label: "R" + x.ref, open: () => { const o = RQ.list.find((y) => y.id === x.id); if (o) openRequest(o); } })),
    ...similar.orders.map((x) => ({ label: "#" + x.num, open: async () => { const { data } = await sb.from("cdf_orders").select("*").eq("id", x.id).maybeSingle(); if (data && !stale(gen)) openOrder(data); } }))];

  const acts = [];
  if (reqIsOpen(r)) {
    acts.push(el("button", { class: "btn danger foot-act", type: "button", onclick: () => rejectRequest(r) }, icon("close"), el("span", { class: "lbl" }, t("reqReject"))));
    acts.push(el("span", { class: "spacer" }));
    acts.push(el("button", { class: "btn primary", type: "button", onclick: () => acceptRequest(r) }, icon("check"), " ", t("reqAccept")));
  } else if (r.status === "rejected") {
    acts.push(el("span", { class: "spacer" }), el("button", { class: "btn", type: "button", onclick: () => reopenRequest(r, err) }, icon("refresh"), " ", t("reqReopen")));
  } else if (r.status === "accepted" && os?.state === "trash") {
    acts.push(el("span", { class: "spacer" }), el("button", { class: "btn", type: "button", onclick: async () => { if (await closeSheet()) openTrash(); } }, icon("trash"), " ", t("reqSeeTrash")));
  } else if (r.status === "accepted" && r.accepted_order_id && os?.state !== "deleted") {
    acts.push(el("span", { class: "spacer" }), el("button", { class: "btn primary", type: "button", onclick: async () => {
      const o = byId(r.accepted_order_id) || (await sb.from("cdf_orders").select("*").eq("id", r.accepted_order_id).maybeSingle()).data;
      if (stale(gen)) return;
      if (o) openOrder(o); else err.textContent = t("goneMeanwhile");
    } }, t("reqSeeOrder")));
  } else acts.push(el("span", { class: "spacer" }));

  const node = el("div", { class: "sheet req-sheet", role: "dialog", "aria-modal": "true" },
    el("div", { class: "sheet-head" }, el("h2", {}, t("reqTitle", { ref: reqRef(r) })), reqKindTag(r), reqStatusTag(r), el("span", { class: "spacer" }), closeBtn()),
    el("div", { class: "sheet-body" },
      r.status === "in_review" && r.reviewed_by && r.reviewed_by !== S.me?.email
        ? el("div", { class: "sheet-note" }, icon("user"), el("span", {}, t("reqBeingReviewed", { who: reqWho(r.reviewed_by) }))) : null,
      os && os.state === "active" && os.num ? el("div", { class: "sheet-note" }, icon("check"), el("span", {}, t("reqBecameOrder", { num: "#" + os.num }))) : null,
      os && (os.state === "trash" || os.state === "deleted" || os.state === "unknown") ? el("div", { class: "sheet-note warn req-order-note" }, icon(os.state === "trash" ? "trash" : "alert"),
        el("span", {}, el("b", {}, reqOrderText(os)), os.by || os.at ? " · " + t("reqOrderWho", { who: os.by ? memberName(os.by) : "?", when: os.at ? formatDateTime12(os.at) : "?" }) : "",
          os.reason ? el("i", {}, " · " + os.reason) : null,
          os.state === "deleted" && os.logged === false ? el("small", { class: "note", style: "display:block" }, t("reqOrderNoLog")) : null)) : null,
      r.status === "rejected" ? el("div", { class: "sheet-note cancel-note" }, icon("close"), el("span", {}, r.reject_reason ? t("reqRejectedWhy", { why: r.reject_reason }) : t("reqRejectedNoWhy"))) : null,
      reqPast(r) ? el("div", { class: "sheet-note warn" }, icon("alert"), el("span", {}, t("reqPastHint"))) : null,
      dupes.length ? el("div", { class: "sheet-note warn req-dupes" }, icon("alert"), el("span", {}, t("reqSimilar"), " ",
        dupes.flatMap((d, i) => [i ? ", " : "", el("button", { class: "linkish", type: "button", onclick: async () => { if (await closeSheet()) d.open(); } }, d.label)]))) : null,
      el("section", {}, el("dl", { class: "ro" },
        el("dt", {}, t("reqWhen")), el("dd", {}, reqWhen(r)),
        el("dt", {}, t("buyerH")), el("dd", {}, r.buyer_name, " · ", tel(r.buyer_phone)),
        el("dt", {}, t("recipientH")), r.receiver_name === r.buyer_name && r.receiver_phone === r.buyer_phone ? el("dd", {}, t("reqSameAsBuyer")) : el("dd", {}, r.receiver_name, " · ", tel(r.receiver_phone)),
        el("dt", {}, t(r.mode === "pickup" ? "reqPickup" : "address")),
        r.mode === "pickup" ? el("dd", {}, r.pickup_branch ? reqShop(r) : t("reqPickupDd")) : el("dd", {}, r.address,
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
  const gen = sessionNow();
  const why = el("textarea", { id: "req-reason", rows: 3, maxlength: 500, placeholder: t("reqReasonPh") });
  miniSheet(t("reqRejectTitle", { ref: reqRef(r) }), [el("p", { class: "note", style: "margin:0" }, t("reqRejectHint")), field(t("reqReason"), why)], t("reqReject"), async () => {
    const { data, error } = await sb.rpc("cdf_request_reject", { p_id: r.id, p_reason: why.value.trim() });
    if (stale(gen)) return;
    if (error) return reqError(error);
    Object.assign(r, data); await closeSheet(true);
    if (stale(gen)) return;
    toast(t("reqRejectedToast", { ref: reqRef(r) }));
    paintRequestCount(); refreshRequestCounts(); if (S.tab === "requests") renderRequests();
  }, { dirty: () => !!why.value.trim() });
}

async function reopenRequest(r, err) {
  const gen = sessionNow();
  const { data, error } = await sb.rpc("cdf_request_reopen", { p_id: r.id });
  if (stale(gen)) return;
  if (error) { err.textContent = reqError(error); return; }
  Object.assign(r, data); await closeSheet(true);
  if (stale(gen)) return;
  paintRequestCount(); refreshRequestCounts(); if (S.tab === "requests") renderRequests();
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

// The shop a pickup request chose, with its address (from Team), and its florists
const shopFlorists = (branch) => S.members.filter((m) => m.role === "vendor" && (m.branch || "").trim() === branch);
function reqShop(r) {
  const m = shopFlorists(r.pickup_branch)[0];
  return [el("b", {}, r.pickup_branch), ...(m?.pickup_address ? [el("br"), el("a", { class: "link-out", href: mapsUrl(m.pickup_address), target: "_blank", rel: "noopener" }, icon("map"), " ", m.pickup_address)] : [])];
}
// What the editor opens with: the request's details where the order keeps them, and the rest in the notes.
// A pickup becomes a pickup order, given to the chosen shop's florist (one who is not away that day, if any).
function requestDraft(r) {
  const asPickup = r.mode === "pickup" && S.cap.pickupMode;
  const notes = [r.description, r.special_requests ? t("reqSpecialNote", { text: r.special_requests }) : "", r.mode === "pickup" && !asPickup ? t("reqPickupNote") : "",
    t("reqFromNote", { ref: reqRef(r), method: t("pm_" + r.payment_method) })].filter(Boolean).join("\n");
  const florists = asPickup && r.pickup_branch ? shopFlorists(r.pickup_branch) : [];
  const florist = florists.find((m) => !(typeof awayOn === "function" && awayOn(m, r.date))) || florists[0];
  return { date: r.date, slot: r.slot, channel: "Web", buyer_name: r.buyer_name, buyer_phone: r.buyer_phone,
    customer_name: r.receiver_name, customer_phone: r.receiver_phone, address: r.mode === "pickup" ? (asPickup ? "" : t("reqPickupAddress")) : r.address,
    drop_lat: r.lat != null ? +r.lat : null, drop_lng: r.lng != null ? +r.lng : null, card_message: r.card_message, notes, delivery_note: "",
    ...(asPickup ? { pickup: true, vendor_email: florist?.email || "" } : {}) };
}

async function acceptRequest(r) {
  const gen = sessionNow();
  if (!(await closeSheet())) return;
  if (stale(gen)) return;
  await refreshNumTop().catch(() => {});
  if (stale(gen)) return;
  // One operation key per request in this tab: saving again after a lost answer returns the same order
  const key = (RQ.keys[r.id] ||= { key: crypto.randomUUID(), id: crypto.randomUUID() });
  await openFresh(null, { draft: requestDraft(r), fromRequest: { ...r, accept: key } });
}

// While accepting: the request's photos, to look at while writing the order
function requestPhotos(r) {
  const box = el("section", { class: "req-on-order", hidden: true });
  const gen = sessionNow();
  const load = () => requestResult(sb.from("cdf_request_files").select("kind,path").eq("request_id", r.id).order("created_at")).then((data) => {
    if (stale(gen)) return;
    box.hidden = true; box.replaceChildren();
    const refs = (data || []).filter((f) => f.kind === "reference"), proof = (data || []).find((f) => f.kind === "payment_proof");
    if (!refs.length && !proof) return;
    fill(box, el("h3", {}, t("reqRefs")),
      refs.length ? el("div", { class: "photo-grid ro" }, refs.map((f, i) => el("div", { class: "pic" }, imgOf(f.path, "cdf-solicitudes", t("reqRefN", { n: i + 1 }), true)))) : null,
      proof ? el("p", { class: "note req-unverified" }, icon("alert"), " ", t("reqProofAccepting")) : null);
    box.hidden = false;
  }).catch(() => { if (!stale(gen)) requestBlockError(box, load); });
  load();
  return box;
}

// The customer's photos on an order that came from a request (admins: all; its florist: the reference photos)
function orderReferences(o) {
  const box = el("div", { class: "req-on-order", hidden: true });
  if (!o?.id || !S.cap.requests && !S.cap.references) return box;
  const gen = sessionNow();
  const load = () => requestResult(sb.rpc("cdf_order_references", { p_order: o.id })).then((data) => {
    if (stale(gen)) return;
    box.hidden = true; box.replaceChildren();
    if (!data?.length) return;
    const refs = data.filter((f) => f.kind === "reference"), proof = data.find((f) => f.kind === "payment_proof");
    fill(box, el("h3", {}, t("reqOnOrder", { ref: "R" + data[0].request_ref })),
      refs.length ? el("div", { class: "photo-grid ro" }, refs.map((f, i) => el("div", { class: "pic" }, imgOf(f.path, "cdf-solicitudes", t("reqRefN", { n: i + 1 }), true)))) : null,
      proof ? el("div", { class: "req-proof-on-order" }, el("div", { class: "pic" }, imgOf(proof.path, "cdf-solicitudes", t("reqProof"), true)),
        el("p", { class: "note" }, t("reqProofOnOrder"))) : null);
    box.hidden = false;
  }).catch(() => { if (!stale(gen)) requestBlockError(box, load); });
  load();
  return box;
}

function requestBlockError(box, retry) {
  box.hidden = false;
  fill(box, el("p", { class: "err", role: "alert" }, t("reqLoadFail")),
    el("button", { class: "btn", type: "button", onclick: async (e) => {
      e.currentTarget.disabled = true;
      await retry();
    } }, t("retry")));
}
