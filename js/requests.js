// Requests from the public order form (Phase 3). Admins see them here, with a counter in the sidebar, and
// reject them or accept them. Accepting opens the order editor already filled in from the request; saving
// it creates the order and closes the request in one step on the server (cdf_request_accept).
// A request is not an order: it is not in the calendar, the florists' work or the statistics until accepted.

const RQ = { list: [], filter: "open", kind: "all", channel: null, keys: {}, counts: null, closedLimit: 300, closedMore: false, orders: new Map() };
const CLOSED = ["accepted", "rejected", "expired"];
const reqBucket = (r) => (reqIsOpen(r) ? "open" : r.status === "accepted" ? "accepted" : "rejected");
const reqKindOk = (r, kind = RQ.kind) => kind === "all" || r.mode === kind;
const reqIsOpen = (r) => r.status === "received" || r.status === "in_review";
const reqRef = (r) => r.shared_number ? "#" + String(r.ref).padStart(4, "0") : "R" + r.ref;
const reqPast = (r) => reqIsOpen(r) && r.date < manilaToday();
const reqOn = () => isAdmin() && !!S.cap.requests;

function reqStatusTag(r) {
  // A payment arrived that could not be applied: it wins over every other label (also on closed requests)
  if (RQ.payIssues?.has(r.id)) return el("span", { class: "tag req-tag pay-issue" }, t("plTagIssue"));
  if (reqIsOpen(r) && RQ.paying?.has(r.id)) return el("span", { class: "tag req-tag paying" }, t("plTag"));
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
  // PayMongo: which open requests have a payment link waiting
  // and which have a payment that could not be applied (the team checks it)
  if (pmOn()) {
    const [open, issues] = await Promise.all([sb.from("cdf_request_payments").select("request_id").eq("status", "open"),
      sb.from("cdf_request_payments").select("request_id").not("issue", "is", null)]);
    if (stale(gen)) return;
    RQ.paying = new Set((open.data || []).map((x) => x.request_id));
    RQ.payIssues = new Set((issues.data || []).map((x) => x.request_id));
  }
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
    // PayMongo (feature paymongo): its payment links, newest first
    pmOn() ? requestResult(sb.from("cdf_request_payments").select("id,status,amount,token,created_by,created_at,checkout_expires_at,issue").eq("request_id", r.id).order("created_at", { ascending: false }).limit(5)).then((x) => x || []) : [],
  ]).catch(() => null);
  if (stale(gen) || !reqOn()) return;
  if (!loaded) { requestLoadError(() => openRequest(r)); return; }
  const [files, similar, events, orderNow, links] = loaded;
  const link = links.find((p) => p.status === "open"), issues = links.filter((p) => p.issue);
  const os = orderNow || reqOrderState(r);
  const refs = files.filter((f) => f.kind === "reference"), proof = files.find((f) => f.kind === "payment_proof");
  const tel = (p) => el("a", { href: "tel:+" + intlPhone(p), class: "link-out" }, phoneNice(p));
  const pinUrl = r.lat != null ? `https://www.google.com/maps/search/?api=1&query=${+r.lat},${+r.lng}` : null;
  const err = el("div", { class: "err", role: "alert" });
  const dupes = [...similar.requests.map((x) => ({ label: reqRef(x), open: () => { const o = RQ.list.find((y) => y.id === x.id); if (o) openRequest(o); } })),
    ...similar.orders.map((x) => ({ label: "#" + x.num, open: async () => { const { data } = await sb.from("cdf_orders").select("*").eq("id", x.id).maybeSingle(); if (data && !stale(gen)) openOrder(data); } }))];

  const acts = [];
  if (reqIsOpen(r)) {
    acts.push(el("button", { class: "btn danger foot-act", type: "button", onclick: () => rejectRequest(r) }, icon("close"), el("span", { class: "lbl" }, t("reqReject"))));
    acts.push(el("span", { class: "spacer" }));
    if (pmOn()) {
      // PayMongo: one main action, set the price; accepting without online payment is kept aside
      acts.push(el("button", { class: "btn", type: "button", onclick: () => moreRequestOptions(r) }, t("prMore")));
      acts.push(el("button", { class: "btn primary", type: "button", onclick: () => priceRequest(r) }, icon("card"), " ", t(link ? "plChange" : "prBtn")));
    } else acts.push(el("button", { class: "btn primary", type: "button", onclick: () => acceptRequest(r) }, icon("check"), " ", t("reqAccept")));
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
      ...issues.map((p) => el("div", { class: "sheet-note warn" }, icon("alert"), el("span", {}, t("plIssue", { issue: p.issue })))),
      link && reqIsOpen(r) ? payLinkNote(r, link) : null,
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
        feature("paymongo") ? null : [el("dt", {}, t("reqMethod")), el("dd", {}, t("pm_" + r.payment_method))],
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

// ---------- PayMongo (branch paymongo-solicitudes; feature paymongo) ----------
// Instead of accepting now, the admin writes the order as usual and the customer gets a payment link. PayMongo's
// confirmation (webhook or the customer's check) accepts the request and creates that order with the payment.
const pmOn = () => !!window.CDF_CONFIG?.features?.paymongo && isAdmin();
const payUrl = (token) => location.origin + "/pagar.html#" + token;
async function payLinkCall(body) {
  const { data, error } = await sb.functions.invoke("cdf-paymongo", { body }).then((x) => x, (e) => ({ error: e }));
  if (!error) return data;
  let code = ""; try { code = (await error.context?.json())?.error || ""; } catch {}
  return { error: /cdf_request_|42501|Forbidden/.test(code) ? reqError({ message: code, code: /42501|Forbidden/.test(code) ? "42501" : "" }) : t("plFail") };
}
async function payRequest(r) {
  const gen = sessionNow();
  if (!(await closeSheet())) return;
  if (stale(gen)) return;
  // Its own operation key (not the Accept one): the order the payment will create
  const key = ((RQ.payKeys ||= {})[r.id] ||= { key: crypto.randomUUID(), id: crypto.randomUUID() });
  await openFresh(null, { draft: requestDraft(r), fromRequest: { ...r, accept: key, payLink: true } });
}
// The message for the customer, in the language they used for the request
const payMessage = (r, link, amount) => tIn(r.lang === "es" ? "es" : "en", "plMsg", { name: (r.buyer_name || "").split(" ")[0], ref: reqRef(r), amount: paymentPesos(amount), link });
function payShare(r, link, amount) {
  const msg = () => payMessage(r, link, amount);
  return el("div", { class: "notify-row" },
    el("button", { class: "btn", type: "button", onclick: () => window.open("https://wa.me/" + intlPhone(r.buyer_phone) + "?text=" + encodeURIComponent(msg()), "_blank", "noopener") }, icon("message"), "WhatsApp"),
    el("button", { class: "btn", type: "button", onclick: () => { location.href = "sms:+" + intlPhone(r.buyer_phone) + "?body=" + encodeURIComponent(msg()); } }, icon("phone"), "SMS"),
    el("button", { class: "btn", type: "button", onclick: () => navigator.clipboard?.writeText(msg()).then(() => toast(t("msgCopied")), () => toast(t("selectCopy"))) }, t("copyMsg")),
    el("button", { class: "btn", type: "button", onclick: () => navigator.clipboard?.writeText(link).then(() => toast(t("plCopied")), () => toast(t("selectCopy"))) }, icon("copy"), " ", t("plCopy")));
}
function showPayLink(r, link, amount) {
  const box = el("input", { class: "input", readonly: true, value: link, onfocus: (e) => e.target.select() });
  miniSheet(t("plLinkTitle", { ref: reqRef(r) }), [el("p", { class: "pr-link-amount" }, t("prLinkAmount", { amount: paymentPesos(amount) })), el("p", { class: "note", style: "margin:0" }, t("prLinkHint")), box, el("div", { class: "notify-row" }, copyLinkBtn(link))], t("close"), async () => { await closeSheet(); });
}
function payLinkNote(r, p) {
  const open = p.checkout_expires_at && new Date(p.checkout_expires_at) > new Date();
  return el("div", { class: "sheet-note pay-link-note" }, icon("card"), el("div", {},
    el("b", {}, t("plOpen", { amount: paymentPesos(p.amount), who: reqWho(p.created_by), ago: reqAgo(p.created_at) })),
    open ? el("small", { class: "note", style: "display:block" }, t("plOpenUntil", { time: formatClock12(p.checkout_expires_at) })) : null,
    el("div", { class: "notify-row" }, copyLinkBtn(payUrl(p.token)),
      el("button", { class: "linkish", type: "button", onclick: () => cancelPayLink(r) }, t("plCancel")))));
}
const copyLinkBtn = (link) => el("button", { class: "btn", type: "button", onclick: () => navigator.clipboard?.writeText(link).then(() => toast(t("plCopied")), () => toast(t("selectCopy"))) }, icon("copy"), " ", t("plCopy"));

// The shops (Team → each florist's shop point), grouped by branch like the public form's list; open that day = a
// florist there who is not away. Each with the florist the order would go to.
function requestShops(day) {
  const by = new Map();
  for (const m of S.members || []) {
    const b = (m.branch || "").trim();
    if (m.role !== "vendor" || !b || m.pickup_lat == null || m.pickup_lng == null) continue;
    const s = by.get(b) || { branch: b, lat: +m.pickup_lat, lng: +m.pickup_lng, florists: [] };
    s.florists.push(m); by.set(b, s);
  }
  return [...by.values()].map((s) => { const free = s.florists.find((m) => !(typeof awayOn === "function" && awayOn(m, day))); return { ...s, open: !!free, florist: free || s.florists[0] }; });
}

// Set the price (PayMongo): the flowers price typed by the admin + the delivery from the chosen shop (by distance,
// motorcycle or car), and the total. Saving creates the payment link; when the customer pays, the order is created
// by itself from the request, given to that shop's florist, with the breakdown in its notes.
async function priceRequest(r) {
  const gen = sessionNow();
  if (!(await closeSheet())) return;
  if (stale(gen)) return;
  // Numbers not shared with requests (older database): the full editor still asks for one
  if (!S.cap.sharedNumbers || !window.CDFDeliveryFee) return payRequest(r);
  const key = ((RQ.payKeys ||= {})[r.id] ||= { key: crypto.randomUUID(), id: crypto.randomUUID() });
  const pickup = r.mode === "pickup", point = r.lat != null && r.lng != null ? { lat: +r.lat, lng: +r.lng } : null;
  const shops = requestShops(r.date).map((s) => {
    const km = point ? CDFDeliveryFee.straightKm(point, s) : null;
    return { ...s, km, fee: km == null ? null : CDFDeliveryFee.forKm(km) };
  }).sort((a, b) => (b.open - a.open) || ((a.km ?? 1e9) - (b.km ?? 1e9)) || a.branch.localeCompare(b.branch));
  let veh = "motorcycle", chosen = pickup ? shops.find((s) => s.branch === r.pickup_branch) || shops[0] : shops.find((s) => s.open) || shops[0];
  const nearest = !pickup && point ? shops.find((s) => s.open) : null;
  const iFlowers = el("input", { id: "pr-flowers", type: "number", inputmode: "decimal", min: 0, step: 0.01, max: 9999999, placeholder: "1800", "aria-label": t("chargeFlowers") });
  const iManual = el("input", { id: "pr-delivery", type: "number", inputmode: "decimal", min: 0, step: 0.01, max: 99999, placeholder: "0", "aria-label": t("chargeDelivery") });
  const peso = (input) => el("div", { class: "peso-input" }, el("span", { "aria-hidden": "true" }, "₱"), input, el("span", { class: "cur" }, "PHP"));
  const vehSeg = el("div", { class: "seg pr-veh", role: "group", "aria-label": t("llVehicle") });
  const list = el("div", { class: "pr-shops", role: "radiogroup", "aria-label": t("prShip") });
  // Another delivery price (agreed with the customer, a special trip…): typed by the admin, instead of the one by distance.
  // The shop stays chosen: it is who makes the order.
  let custom = false;
  const customBtn = el("button", { type: "button", class: "linkish pr-custom-toggle", onclick: () => {
    custom = !custom;
    if (custom && iManual.value === "" && autoFee() != null) iManual.value = autoFee();
    paint(); if (custom) { iManual.focus(); iManual.select(); }
  } });
  const manualBox = el("div", { class: "pr-manual", hidden: true }, field(t("prCustomLabel"), peso(iManual)));
  const totalOut = el("div", { class: "pr-total", role: "status" });
  const autoFee = () => (pickup || !chosen?.fee || chosen.fee.far ? null : chosen.fee[veh]);
  const manualFee = () => (iManual.value === "" ? null : +iManual.value);
  const delivery = () => (pickup ? 0 : custom ? manualFee() : autoFee() ?? manualFee());
  function paint() {
    vehSeg.replaceChildren(...[["motorcycle", "prMoto"], ["car", "prCar"]].map(([v, k]) => el("button", { type: "button", "aria-pressed": String(veh === v), onclick: () => { veh = v; paint(); } }, t(k))));
    list.replaceChildren(...shops.map((s) => el("button", { type: "button", role: "radio", class: "pr-shop" + (s === chosen ? " is-chosen" : "") + (s.open ? "" : " is-closed"), "aria-checked": String(s === chosen),
      onclick: () => { chosen = s; paint(); } },
      el("span", { class: "pr-shop-name" }, el("b", {}, s.branch), s === nearest ? el("span", { class: "tag pr-near" }, t("prNearest")) : null, s.open ? null : el("span", { class: "tag muted" }, t("prClosed"))),
      el("span", { class: "pr-shop-km" }, pickup ? (s.branch === r.pickup_branch ? t("prPickupHere") : "") : s.fee ? t("prKm", { km: fmtKm(s.fee.roadKm) }) : ""),
      el("span", { class: "pr-shop-fee" }, pickup ? "" : !s.fee ? "—" : s.fee.far ? t("prFarShort") : paymentPesos(s.fee[veh])))));
    vehSeg.hidden = pickup;
    manualBox.hidden = pickup || (!custom && autoFee() != null);
    customBtn.hidden = pickup || autoFee() == null;
    customBtn.textContent = t(custom ? "prCustomOff" : "prCustomOn");
    list.classList.toggle("is-custom", custom);
    const a = iFlowers.value === "" ? null : +iFlowers.value, d = delivery();
    totalOut.replaceChildren(...[el("span", {}, t("prTotal")), el("b", {}, a == null || d == null ? "—" : paymentPesos(a + d)),
      a != null && d != null && !pickup ? el("small", { class: "note" }, t("prSum", { flowers: paymentPesos(a), delivery: paymentPesos(d) })) : null].filter(Boolean));
  }
  iFlowers.addEventListener("input", paint); iManual.addEventListener("input", paint);
  const intro = el("div", { class: "pr-req" }, el("b", {}, r.buyer_name + (r.receiver_name && r.receiver_name !== r.buyer_name ? " → " + r.receiver_name : "")),
    el("span", { class: "note" }, reqWhen(r)), el("span", { class: "note" }, pickup ? t("reqPickup") + " · " + (r.pickup_branch || "") : r.address || ""),
    // What to price: the customer's words and reference photos (tap a photo to see it big)
    r.description ? el("p", { class: "msg pr-desc" }, r.description) : null,
    r.special_requests ? el("p", { class: "note pr-desc" }, t("reqSpecial") + ": " + r.special_requests) : null);
  paint();
  const photos = requestPhotos(r); photos.classList.add("pr-photos");
  miniSheet(t("prTitle", { ref: reqRef(r) }), [intro, photos, field(t("chargeFlowers"), peso(iFlowers)),
    el("div", { class: "field" }, el("span", { class: "label pr-ship-head" }, el("span", {}, t(pickup ? "prPickupFrom" : "prShip")), vehSeg), list,
      !pickup && !point ? el("small", { class: "note" }, t("prNoPoint")) : null),
    customBtn, manualBox, totalOut, el("p", { class: "note", style: "margin:0" }, t("prHint"))], t("prCreate"), async () => {
    const a = iFlowers.value === "" ? null : +iFlowers.value, d = delivery();
    if (!(a > 0)) { iFlowers.focus(); return t("prNeedFlowers"); }
    if (d == null || d < 0) { iManual.focus(); return t("prNeedDelivery"); }
    const total = Math.round((a + d) * 100) / 100;
    if (!(total >= 100)) { iFlowers.focus(); return t("plNeedPrice"); }
    const base = requestDraft(r);
    const notes = [base.notes, pickup ? t("prNotePickup", { flowers: paymentPesos(a), shop: chosen?.branch || "" })
      : custom && autoFee() != null && d !== autoFee() ? t("prNoteCustom", { flowers: paymentPesos(a), delivery: paymentPesos(d), shop: chosen?.branch || "?", auto: paymentPesos(autoFee()) })
      : t("prNote", { flowers: paymentPesos(a), delivery: paymentPesos(d), veh: t(veh === "car" ? "prCar" : "prMoto").toLowerCase(), shop: chosen?.branch || "?" })].join("\n");
    const order = { id: key.id, num: null, date: r.date, slot: r.slot, channel: "Web", vendor_email: chosen?.florist?.email || null,
      customer_name: base.customer_name, address: base.address, customer_phone: base.customer_phone, customer_email: "",
      buyer_name: base.buyer_name, buyer_phone: base.buyer_phone, card_message: base.card_message || "", delivery_note: "", notes };
    if (S.cap.carrier) order.carrier_email = null;
    if (S.cap.drop) { order.drop_lat = pickup ? null : base.drop_lat; order.drop_lng = pickup ? null : base.drop_lng; }
    if (S.cap.vehicle) order.vehicle = !pickup && veh === "car" ? "SEDAN" : null;
    if (S.cap.pickupMode) { order.pickup = pickup; if (pickup) order.address = ""; }
    const res = await payLinkCall({ action: "link", request_id: r.id, key: key.key, order, price: total });
    if (stale(gen)) return;
    if (res.error) return res.error;
    await closeSheet(true);
    showPayLink(r, res.link, res.amount);
    if (res.warning) toast(t("plExpireWarn"), { type: "error" });
    loadRequests();
  }, { dirty: () => !!iFlowers.value || !!iManual.value });
}

function moreRequestOptions(r) {
  miniSheet(t("prMore"), [el("p", { class: "note", style: "margin:0" }, t("prMoreHint"))], t("prAcceptNoPay"), async () => {
    // Accepting without online payment: the open payment link (and its PayMongo page) is closed first
    const dropped = await dropPayLink(r); if (dropped) return dropped;
    await closeSheet(true); acceptRequest(r);
  });
}

// Before a request is closed another way (rejected, accepted without online payment): its open link is cancelled
// and its PayMongo page closed, so the customer can no longer pay for it. The database cancels the link too, but
// only this call can close the page at PayMongo. Returns an error text, or nothing when done.
async function dropPayLink(r) {
  if (!pmOn() || !RQ.paying?.has(r.id)) return;
  const res = await payLinkCall({ action: "cancel", request_id: r.id });
  if (res.error) return t("plDropFail");
  RQ.paying.delete(r.id);
  if (res.warning) toast(t("plExpireWarn"), { type: "error" });
}

async function cancelPayLink(r) {
  if (!(await askConfirm(t("plCancelAsk"), t("plCancel")))) return;
  const res = await payLinkCall({ action: "cancel", request_id: r.id });
  if (res.error) { toast(res.error, { type: "error" }); return; }
  toast(res.warning ? t("plExpireWarn") : t("plCancelledToast"), res.warning ? { type: "error" } : undefined);
  if (await closeSheet()) openRequest(r);
}

function rejectRequest(r) {
  const gen = sessionNow();
  const why = el("textarea", { id: "req-reason", rows: 3, maxlength: 500, placeholder: t("reqReasonPh") });
  miniSheet(t("reqRejectTitle", { ref: reqRef(r) }), [el("p", { class: "note", style: "margin:0" }, t("reqRejectHint")), field(t("reqReason"), why)], t("reqReject"), async () => {
    const dropped = await dropPayLink(r); if (dropped) return dropped;
    if (stale(gen)) return;
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
    feature("paymongo") ? t("reqFromNotePm", { ref: reqRef(r) }) : t("reqFromNote", { ref: reqRef(r), method: t("pm_" + r.payment_method) })].filter(Boolean).join("\n");
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
  if (!S.cap.sharedNumbers) await refreshNumTop().catch(() => {});
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
    fill(box, el("h3", {}, t("reqOnOrder", { ref: reqRef({ ref: data[0].request_ref, shared_number: data[0].shared_number }) })),
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
