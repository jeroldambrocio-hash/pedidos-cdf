// Office view (admin and moderator): calendar, the day's orders on a timeline, search, filters,
// orders at risk, bulk actions, archiving and the CSV export.

function renderOrders() {
  if (!S.me || S.tab !== "orders") return;
  // Florists and drivers get their own to-do list; the calendar and the day are for the office.
  $("ordersView").classList.toggle("solo", !isStaff());
  if (!isStaff()) { renderAgenda(); return; }
  renderCal(); renderDay(); renderTools();
}

// ---------- calendar ----------
function renderCal() {
  const m = S.month, y = m.getFullYear(), mo = m.getMonth();
  $("mLabel").textContent = cap(m.toLocaleDateString(locale(), { month: "long", year: "numeric" }));
  const counts = {};
  for (const o of S.orders) counts[o.date] = (counts[o.date] || 0) + 1;
  const max = Math.max(1, ...Object.values(counts));
  const cal = $("cal"); cal.replaceChildren();
  t("dow").forEach((d, i) => cal.append(el("div", { class: "dow" + (i === 6 ? " sun" : ""), "aria-hidden": "true" }, d)));
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), k = iso(d), n = counts[k] || 0;
    if (i >= 35 && d.getMonth() !== mo) break;
    // The day's load shows as a soft fill in three steps
    const level = n ? Math.min(3, Math.ceil((n / max) * 3)) : 0;
    cal.append(el("button", {
      type: "button",
      class: "day" + (d.getMonth() !== mo ? " out" : "") + (k === S.today ? " today" : "") + (k === S.sel ? " sel" : "") + (level ? " l" + level : ""),
      "aria-label": d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" }) + (n ? ", " + dayCount(n) : ""),
      "aria-current": k === S.sel ? "date" : null, title: n ? dayCount(n) : null,
      onclick: () => { selectDay(k); $("calendarToggle").setAttribute("aria-expanded", "false"); $("calendarBody").classList.remove("expanded"); },
    }, String(d.getDate())));
  }
}
function selectDay(k) {
  S.sel = k; S.month = monthOf(k);
  clearSearch(false);
  if (!inRange(k)) loadOrders(); else renderOrders();
}
function shiftMonth(n) {
  S.month = new Date(S.month.getFullYear(), S.month.getMonth() + n, 1);
  const [from, to] = wantedRange();
  if (!S.range || from < S.range[0] || to > S.range[1]) loadOrders(); else renderCal();
}

// ---------- orders at risk ----------
// Today: should already be out (its slot has started and it is still in the studio), or no florist with less
// than three hours to go. Before today: anything not delivered.
function riskOf(o) {
  const st = stepOf(o);
  if (st === 3 || (S.cap.archive && o.archived_at)) return null;
  if (o.date < S.today) return "late";
  if (o.date !== S.today) return null;
  const now = manilaMinutes(), start = slotStart(o.slot);
  if (st <= 1 && now >= start) return "shouldBeOut";
  if (!o.vendor_email && st === 0 && start - now <= 180) return "noFlorist";
  return null;
}
function renderRisk() {
  if (!isStaff() || S.tab !== "orders" || S.hits || sheet) return;
  if (S.sel === S.today) renderDay();
}

// ---------- the day ----------
function filterMatch(o) {
  const f = S.filter;
  if (f == null) return true;
  if (f === "pending") return stepOf(o) !== 3;
  if (f === "unassigned") return !o.vendor_email;
  if (f === "risk") return !!riskOf(o);
  return stepOf(o) === f;
}
function renderDay() {
  const searching = !!S.hits;
  const all = (searching ? S.hits : S.orders.filter((o) => o.date === S.sel)).slice().sort(byTime);
  // Overdue orders from earlier days show on today too, so nothing is left behind
  const lateOnes = !searching && S.sel === S.today ? S.orders.filter((o) => o.date < S.today && stepOf(o) !== 3).sort(byTime) : [];
  const day = [...lateOnes, ...all];
  $("clearSearch").hidden = !searching;
  $("dLabel").textContent = searching ? (S.hitsTitle || t("searchResults")) : longDate(S.sel);
  $("dSub").textContent = dayCount(day.length) + " · " + t("manila");

  // Summary: counts that are also filters
  const n = (fn) => day.filter(fn).length;
  const risky = day.filter(riskOf);
  const sum = $("summary"); sum.replaceChildren();
  const stat = (key, label, value, glyph, cls = "") => sum.append(el("button", {
    type: "button", class: "stat " + cls + (S.filter === key ? " on" : ""), "aria-pressed": String(S.filter === key),
    onclick: () => { S.filter = S.filter === key ? null : key; renderDay(); },
  }, icon(glyph), el("b", { class: "tnum" }, String(value)), el("span", {}, label)));
  stat(null, t("summaryTotal"), day.length, "orders");
  stat("pending", t("summaryPending"), n((o) => stepOf(o) !== 3), "clock", "s-prep");
  stat(0, t("summaryPrep"), n((o) => stepOf(o) === 0), "flower");
  stat(4, t("summaryFailed"), n((o) => stepOf(o) === 4), "alert", "s-fail");
  stat("unassigned", t("summaryUnassigned"), n((o) => !o.vendor_email), "user");
  if (!searching) stat("risk", t("summaryRisk"), risky.length, "alert", risky.length ? "risk" : "");

  // Quick filters by step (sidebar)
  const tally = $("tally"); tally.replaceChildren();
  const chip = (key, label, count, cls, glyph) => tally.append(el("button", {
    class: "chip " + cls + (S.filter === key ? " on" : ""), type: "button", "aria-pressed": String(S.filter === key),
    onclick: () => { S.filter = S.filter === key ? null : key; renderDay(); },
  }, icon(glyph), el("span", {}, label), el("b", { class: "tnum" }, String(count))));
  chip(null, t("allOrders"), day.length, "", "orders");
  STEPS.forEach((s, i) => chip(i, stepName(i), n((o) => stepOf(o) === i), "s-" + s.k, ["box", "check", "truck", "check", "alert"][i]));

  // "Nobody home" moves the order to its new date; keep it visible on the day it failed
  const missedHere = !searching ? S.orders.filter((o) => o.missed_on === S.sel && o.date !== S.sel) : [];
  const box = $("list"); box.replaceChildren();
  box.setAttribute("aria-busy", String(!S.loaded));
  if (risky.length && !searching && S.filter !== "risk") box.append(el("div", { class: "banner risk-banner", role: "status" }, icon("alert"),
    el("div", {}, el("b", {}, t("riskBanner", { n: risky.length })),
      el("ul", {}, risky.slice(0, 4).map((o) => el("li", {}, el("button", { class: "linkish", type: "button", onclick: () => openOrder(o) },
        "#" + o.num + " · " + (o.customer_name || t("noName")) + " · " + t("risk_" + riskOf(o)))))),
      risky.length > 4 ? el("button", { class: "linkish", type: "button", onclick: () => { S.filter = "risk"; renderDay(); } }, t("seeAll")) : null)));
  if (missedHere.length) box.append(el("div", { class: "banner", role: "status" }, icon("alert"), el("div", {},
    el("b", {}, t("missedBanner", { n: missedHere.length })),
    ...missedHere.map((o) => el("button", { class: "linkish block", type: "button", onclick: () => { selectDay(o.date); openOrder(o); } },
      "#" + o.num + " · " + (o.customer_name || t("noName")) + " → " + shortDate(o.date) + " · " + o.slot)))));

  if (S.loadError && !S.loaded) { box.append(el("div", { class: "empty" }, el("b", {}, t("loadFail")), el("button", { class: "btn", type: "button", onclick: () => loadOrders() }, t("retry")))); return; }
  if (!S.loaded) { box.append(...[0, 1, 2].map(() => el("div", { class: "order skeleton", "aria-hidden": "true" }))); return; }
  if (!day.length) { box.append(el("div", { class: "empty" }, el("b", {}, t(searching ? "emptySearch" : "noOrdersDay")), searching ? null : t("emptyAdmin"))); return; }
  const list = day.filter(filterMatch);
  if (!list.length) { box.append(el("div", { class: "empty" }, el("b", {}, t("noneFiltered")), el("button", { class: "btn", type: "button", onclick: () => { S.filter = null; renderDay(); } }, t("showAll")))); return; }
  for (const o of list) box.append(timelineEntry(o, searching || o.date !== S.sel));
  renderBulk();
}

// ---------- one order on the timeline ----------
const NEXT_LABEL = { 0: "actReady", 1: "actOut", 2: "actDelivered", 4: "actOutAgain" };
function timelineEntry(o, withDate) {
  const times = String(o.slot || "").split(/\s*-\s*/);
  return el("section", { class: "timeline-entry state-" + STEPS[stepOf(o)].k },
    el("div", { class: "route-time" }, withDate ? el("small", {}, shortDate(o.date)) : null, el("b", { class: "tnum" }, times[0] || o.slot), el("span", { class: "tnum" }, times[1] || "")),
    orderCard(o));
}
function orderCard(o) {
  const cur = stepOf(o), k = STEPS[cur].k, next = NEXT[cur], busy = S.pending.has(o.id), risk = riskOf(o);
  const phone = intlPhone(o.customer_phone);
  const archived = S.cap.archive && o.archived_at;
  const card = el("article", { class: "order state-" + k + (risk ? " at-risk" : "") + (S.selected.has(o.id) ? " picked" : ""), "data-id": o.id });
  if (S.selecting) card.append(el("label", { class: "pick" }, el("input", { type: "checkbox", checked: S.selected.has(o.id), "aria-label": t("selectOrder", { num: o.num }),
    onchange: (e) => { e.target.checked ? S.selected.add(o.id) : S.selected.delete(o.id); card.classList.toggle("picked", e.target.checked); renderBulk(); } })));
  card.append(
    el("button", { class: "order-open", type: "button", onclick: () => openOrder(o), "aria-label": t("order", { num: o.num }) + " · " + (o.customer_name || t("noName")) },
      thumb(o),
      el("div", { class: "o-main" },
        el("div", { class: "o-top" }, el("span", { class: "num tnum" }, "#" + o.num), chanChip(o.channel), archived ? el("span", { class: "pill" }, t("archived")) : null),
        el("b", { class: "o-name" }, o.customer_name || t("noName")),
        o.attempts > 0 && cur !== 3 ? el("span", { class: "tag fail" }, (o.missed_on ? t("retryTag", { n: o.attempts + 1, date: shortDate(o.missed_on) }) : t("retryTagNoDate", { n: o.attempts + 1 }))) : null,
        risk ? el("span", { class: "tag risk" }, t("risk_" + risk)) : null)),
    el("div", { class: "order-info" },
      /^\d{7,15}$/.test(phone) ? el("a", { href: "tel:+" + phone }, icon("phone"), el("span", {}, "+" + phone)) : null,
      o.address ? el("a", { href: mapsUrl(o.address), target: "_blank", rel: "noopener" }, icon("map"), el("span", {}, o.address)) : el("span", { class: "meta" }, icon("map"), t("noAddress")),
      o.card_message || o.notes ? el("div", { class: "order-note" }, icon("note"), el("span", {}, o.card_message || o.notes)) : null,
      floristPicker(o)),
    stepper(o),
    el("div", { class: "order-actions" },
      next != null && !archived ? el("button", { class: "btn primary next", type: "button", disabled: busy, onclick: () => requestStep(o, next) }, t(NEXT_LABEL[cur])) : null,
      cur === 2 && !archived ? el("button", { class: "btn", type: "button", disabled: busy, onclick: () => missedDialog(o) }, t("actMissed")) : null,
      el("button", { class: "iconbtn", type: "button", "aria-label": t("notify"), title: t("notify"), onclick: async () => { await openFresh(o); document.querySelector(".sheet #f-link")?.scrollIntoView({ block: "center" }); } }, icon("message")),
      el("button", { class: "btn", type: "button", onclick: () => openOrder(o) }, t("details"))));
  return card;
}
// The progress line is the one status control: a tap moves the order, and steps with consequences ask first.
function stepper(o) {
  const cur = stepOf(o), idx = [0, 1, 2, cur === 4 ? 4 : 3];
  return el("div", { class: "steps", role: "group", "aria-label": t("status") }, idx.map((i) =>
    // "Nobody home" comes after On the way, so the first three steps count as done
    el("button", { type: "button", class: "step s-" + STEPS[i].k + (cur === i ? " on" : i < 3 && (cur === 4 || i < cur) ? " past" : ""),
      "aria-pressed": String(cur === i), disabled: S.pending.has(o.id) || (S.cap.archive && o.archived_at), onclick: () => requestStep(o, i) },
      el("span", { class: "dot", "aria-hidden": "true" }), el("span", {}, stepName(i)))));
}
// Change the florist straight from the card (the server emails them when assigned)
function floristPicker(o) {
  const vendors = S.members.filter((m) => m.role !== "carrier");
  const s = el("select", { class: "inline-select" + (o.vendor_email ? "" : " empty"), "aria-label": t("vendor") + " · #" + o.num },
    el("option", { value: "" }, t("unassigned")), ...vendors.map((m) => el("option", { value: m.email, selected: m.email === o.vendor_email }, m.name)));
  s.addEventListener("change", async () => {
    const before = o.vendor_email || null, v = s.value || null;
    const { data, error } = await sb.from("cdf_orders").update({ vendor_email: v }).eq("id", o.id).select().single();
    if (error) { s.value = before || ""; toast(t("saveFail", { msg: error.message })); return; }
    upsertLocal(data); render();
    toast(t("assignedTo", { name: v ? memberName(v) : t("unassigned") }), { action: t("undo"), onAction: async () => {
      const r = await sb.from("cdf_orders").update({ vendor_email: before }).eq("id", o.id).select().single();
      if (!r.error) { upsertLocal(r.data); render(); }
    } });
  });
  return el("label", { class: "florist" }, icon("flower"), s);
}

// ---------- bulk actions ----------
function setSelecting(on) {
  S.selecting = on; S.selected.clear();
  $("selectBtn").setAttribute("aria-pressed", String(on));
  renderDay();
}
function renderBulk() {
  const bar = $("bulk");
  const picked = S.orders.concat(S.hits || []).filter((o, i, a) => S.selected.has(o.id) && a.findIndex((x) => x.id === o.id) === i);
  bar.hidden = !S.selecting;
  if (!S.selecting) return;
  const vend = el("select", { "aria-label": t("assignFlorist") }, el("option", { value: "" }, t("assignFlorist") + "…"),
    el("option", { value: "-" }, t("unassigned")), ...S.members.filter((m) => m.role !== "carrier").map((m) => el("option", { value: m.email }, m.name)));
  vend.onchange = () => { if (vend.value) bulkUpdate(picked, { vendor_email: vend.value === "-" ? null : vend.value }); };
  bar.replaceChildren(
    el("span", { class: "tnum" }, t("nSelected", { n: picked.length })),
    el("button", { class: "btn", type: "button", onclick: () => { const vis = [...document.querySelectorAll("#list .order[data-id]")].map((c) => c.dataset.id); vis.forEach((id) => S.selected.add(id)); renderDay(); } }, t("selectAll")),
    vend,
    el("button", { class: "btn", type: "button", disabled: !picked.some((o) => stepOf(o) === 0), onclick: () => bulkUpdate(picked.filter((o) => stepOf(o) === 0), { status: "Ready", delivery: "-" }) }, t("actReady")),
    S.cap.archive ? el("button", { class: "btn", type: "button", disabled: !picked.length, onclick: () => setArchived(picked, true) }, icon("archive"), t("archive")) : null,
    el("button", { class: "btn ghost", type: "button", onclick: () => setSelecting(false) }, t("done")));
}
async function bulkUpdate(list, patch) {
  if (!list.length) return;
  const { data, error } = await sb.from("cdf_orders").update(patch).in("id", list.map((o) => o.id)).select();
  if (error) { toast(t("saveFail", { msg: error.message })); return; }
  (data || []).forEach(upsertLocal);
  toast(t("bulkDone", { n: list.length }));
  S.selected.clear(); render();
}

// ---------- search across every date (server side, archived included) ----------
let searchT;
function onSearchInput() {
  clearTimeout(searchT);
  S.query = $("q").value.trim(); S.filter = null;
  if (!S.query) { clearSearch(); return; }
  searchT = setTimeout(runSearch, 250);
}
async function runSearch() {
  const q = S.query;
  if (!q) return;
  const safe = q.replace(/[,()%*\\"]/g, " ").trim(), digits = q.replace(/\D/g, "");
  const ors = safe ? ["num", "customer_name", "buyer_name", "address", "customer_email"].map((c) => `${c}.ilike.%${safe}%`) : [];
  // Phones are matched on their last 9 digits, so 0917…, 917… and +63917… all find each other
  if (digits.length >= 3) { const tail = digits.slice(-9); ors.push(`customer_phone.ilike.%${tail}%`, `buyer_phone.ilike.%${tail}%`); }
  const local = S.orders.filter((o) => [o.num, o.customer_name, o.buyer_name, o.address, o.customer_email].some((v) => String(v || "").toLowerCase().includes(q.toLowerCase()))
    || (digits.length >= 3 && [o.customer_phone, o.buyer_phone].some((p) => String(p || "").replace(/\D/g, "").includes(digits.slice(-9)))));
  let remote = [];
  if (ors.length) {
    const { data } = await sb.from("cdf_orders").select("*").or(ors.join(",")).order("date", { ascending: false }).limit(100);
    remote = data || [];
  }
  if (q !== S.query) return; // a newer search is running
  const seen = new Set();
  S.hits = [...local, ...remote].filter((o) => !seen.has(o.id) && seen.add(o.id));
  S.hitsTitle = t("searchTitle", { q });
  renderDay();
}
function clearSearch(draw = true) {
  clearTimeout(searchT);
  $("q").value = ""; S.query = ""; S.hits = null; S.hitsTitle = null;
  if (draw) renderOrders();
}
// Archived orders of the month on screen
async function showArchived() {
  const m = S.month, from = iso(new Date(m.getFullYear(), m.getMonth(), 1)), to = iso(new Date(m.getFullYear(), m.getMonth() + 1, 0));
  const { data, error } = await sb.from("cdf_orders").select("*").not("archived_at", "is", null).gte("date", from).lte("date", to).order("date");
  if (error) { toast(t("loadFail")); return; }
  S.hits = data; S.hitsTitle = t("archivedTitle", { month: $("mLabel").textContent }); S.filter = null;
  renderDay();
}

// ---------- sidebar tools: archive delivered, CSV ----------
function renderTools() {
  const box = $("adminTools");
  box.hidden = !isStaff();
  if (!isStaff()) return;
  const delivered = S.orders.filter((o) => o.delivery === "Delivered" && o.date < S.today);
  box.replaceChildren(
    S.cap.archive
      ? el("button", { class: "btn ghost", type: "button", disabled: !delivered.length, onclick: async () => {
        if (await askConfirm(t("archiveAsk", { n: delivered.length }), t("archive"), { detail: t("archiveHint") })) setArchived(delivered, true);
      } }, icon("archive"), t("archiveDelivered", { n: delivered.length }))
      : isAdmin() ? el("button", { class: "btn ghost", type: "button", disabled: !delivered.length, onclick: () => purgeDelivered(delivered) }, t("purge", { n: delivered.length })) : null,
    S.cap.archive ? el("button", { class: "btn ghost", type: "button", onclick: showArchived }, icon("archive"), t("seeArchived")) : null,
    el("button", { class: "btn ghost", type: "button", onclick: exportDialog }, icon("download"), t("exportCsv")));
}
// Before migration 012 there is no archive: deleting stays available to admins, with a clear warning
async function purgeDelivered(done) {
  if (!(await askConfirm(t("purgeAsk", { n: done.length }), t("yesDelete"), { danger: true }))) return;
  const { error } = await sb.from("cdf_orders").delete().in("id", done.map((o) => o.id));
  if (error) { toast(t("purgeFail")); return; }
  await removeFiles(done);
  toast(t("purged", { n: done.length })); loadOrders();
}
function exportDialog() {
  const m = S.month;
  const iFrom = el("input", { type: "date", value: iso(new Date(m.getFullYear(), m.getMonth(), 1)) });
  const iTo = el("input", { type: "date", value: iso(new Date(m.getFullYear(), m.getMonth() + 1, 0)) });
  const iArch = el("input", { type: "checkbox", checked: true });
  miniSheet(t("exportTitle"), [el("div", { class: "f-row" }, field(t("from"), iFrom), field(t("to"), iTo)),
    S.cap.archive ? el("label", { class: "check" }, iArch, el("span", {}, t("includeArchived"))) : null,
    el("div", { class: "hint" }, t("exportHint"))], t("download"), async () => {
    if (!iFrom.value || !iTo.value || iTo.value < iFrom.value) return t("rangeInvalid");
    let q = sb.from("cdf_orders").select("*").gte("date", iFrom.value).lte("date", iTo.value).order("date");
    if (S.cap.archive && !iArch.checked) q = q.is("archived_at", null);
    const { data, error } = await q;
    if (error) return t("loadFail");
    downloadCsv(data.sort(byTime), `pedidos-cdf_${iFrom.value}_${iTo.value}.csv`);
    await closeSheet(true);
    toast(t("exported", { n: data.length }));
  });
}
function downloadCsv(rows, name) {
  const cols = [["num", "orderNum"], ["date", "date"], ["slot", "slot"], ["channel", "channel"], [(o) => stepName(stepOf(o)), "status"],
    [(o) => memberName(o.vendor_email || ""), "vendor"], ["buyer_name", "buyerName"], ["buyer_phone", "buyerPhone"], ["customer_email", "email"],
    ["customer_name", "customerName"], ["customer_phone", "phone"], ["address", "deliveryAddr"], ["card_message", "cardMsg"], ["notes", "note"],
    ["attempts", "attempts"], [(o) => (o.archived_at ? "1" : ""), "archived"], [(o) => trackUrl(o), "customerLink"]];
  const cell = (v) => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [cols.map(([, h]) => cell(t(h))).join(","), ...rows.map((o) => cols.map(([c]) => cell(typeof c === "function" ? c(o) : o[c])).join(","))];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
