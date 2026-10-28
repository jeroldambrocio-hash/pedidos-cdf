// Office view (admin and moderator): calendar, filters by status and channel, the day's orders on a timeline,
// search, orders at risk, bulk actions, archiving and the CSV export.

function renderOrders() {
  if (!S.me || S.tab !== "orders") return;
  // Florists and drivers get their own to-do list; the calendar and the day are for the office.
  $("ordersView").classList.toggle("solo", !isStaff());
  if (!isStaff()) { renderAgenda(); return; }
  renderCal(); renderDay(); renderTools();
}

// ---------- calendar ----------
let calShown = null;
function renderCal() {
  const m = S.month, y = m.getFullYear(), mo = m.getMonth();
  $("mLabel").textContent = cap(m.toLocaleDateString(locale(), { month: "long", year: "numeric" }));
  const counts = {};
  for (const o of S.orders) counts[o.date] = (counts[o.date] || 0) + 1;
  const max = Math.max(1, ...Object.values(counts));
  const cal = $("cal"); cal.replaceChildren();
  // The month slides in from the side it came from
  const key = y * 12 + mo;
  if (calShown != null && calShown !== key && !prefersReducedMotion()) { cal.classList.remove("slide-l", "slide-r"); void cal.offsetWidth; cal.classList.add(key > calShown ? "slide-l" : "slide-r"); }
  calShown = key;
  t("dow").forEach((d, i) => cal.append(el("div", { class: "dow" + (i === 6 ? " sun" : ""), "aria-hidden": "true" }, d)));
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), k = iso(d), n = counts[k] || 0;
    if (i >= 35 && d.getMonth() !== mo) break;
    // The day's load shows as a soft fill in three steps (no colour, so it never competes with the states)
    const level = n ? Math.min(3, Math.ceil((n / max) * 3)) : 0;
    cal.append(el("button", {
      type: "button",
      class: (d.getMonth() !== mo ? "out" : "") + (k === S.today ? " today" : "") + (k === S.sel ? " sel" : "") + (level ? " lvl-" + level : ""),
      "aria-label": d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" }) + (n ? ", " + dayCount(n) : ""),
      "aria-current": k === S.sel ? "date" : null, title: n ? dayCount(n) : null,
      onclick: () => { selectDay(k); $("calendarToggle").setAttribute("aria-expanded", "false"); $("calendarBody").classList.remove("expanded"); },
    }, String(d.getDate())));
  }
}
function selectDay(k) {
  S.sel = k; S.month = monthOf(k);
  clearSearch(false);
  if (!inRange(k)) loadOrders(); else { renderCal(); flipDay(); renderTools(); }
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

// ---------- filters: status (with "pending", "no florist" and "at risk") and channel ----------
function filterMatch(o) {
  const f = S.filter;
  if (S.chan && (o.channel || "") !== S.chan) return false;
  if (f == null) return true;
  if (f === "pending") return stepOf(o) !== 3;
  if (f === "unassigned") return !o.vendor_email;
  if (f === "risk") return !!riskOf(o);
  return stepOf(o) === f;
}
function setFilter(k) { S.filter = k; flipDay(); }
function setChan(c) { S.chan = c; flipDay(); }
// Redraw the day with cards sliding to their new place instead of jumping
const flipDay = () => flip($("list"), renderDay);

const STEP_ICON = ["box", "check", "truck", "check", "alert"];
// The orders the day shows: search hits, or the day plus anything overdue when looking at today
function dayOrders() {
  if (S.hits) return S.hits.slice().sort(byTime);
  const lateOnes = S.sel === S.today ? S.orders.filter((o) => o.date < S.today && stepOf(o) !== 3).sort(byTime) : [];
  return [...lateOnes, ...S.orders.filter((o) => o.date === S.sel).sort(byTime)];
}
function renderFilters(day) {
  const box = $("filters"), prev = Object.fromEntries([...box.querySelectorAll("[data-key] .count")].map((c) => [c.parentElement.dataset.key, c.textContent]));
  const n = (fn) => day.filter((o) => (!S.chan || (o.channel || "") === S.chan) && fn(o)).length;
  const row = (key, label, glyph, count, color, extra = {}) => {
    const c = el("span", { class: "count" + (color ? "" : " neutral"), style: color ? `background:var(--${color}-solid);color:var(--${color}-on)` : null }, String(count));
    if (prev[String(key)] != null && prev[String(key)] !== String(count)) requestAnimationFrame(() => bump(c));
    return el("button", { class: "filter", type: "button", "data-key": String(key), "aria-pressed": String(S.filter === key), onclick: () => setFilter(S.filter === key ? null : key), ...extra },
      el("span", { style: color ? `color:var(--${color === "all" ? "all-solid" : color})` : "color:var(--faint)" }, icon(glyph)), label, c);
  };
  const risky = n((o) => !!riskOf(o)), unassigned = n((o) => !o.vendor_email);
  fill(box, 
    el("h3", {}, t("statusH")),
    row(null, t("allOrders"), "orders", n(() => true), "all"),
    ...STEPS.map((s, i) => row(i, stepName(i), STEP_ICON[i], n((o) => stepOf(o) === i), s.k)),
    !S.hits && risky ? row("risk", t("summaryRisk"), "alert", risky, null) : null,
    unassigned ? row("unassigned", t("summaryUnassigned"), "user", unassigned, null) : null,
    el("h3", { class: "grp" }, t("channelH")),
    ...CHANNELS.map((ch) => {
      const c = el("span", { class: "count neutral" }, String(day.filter((o) => o.channel === ch).length));
      return el("button", { class: "filter chan-filter", type: "button", style: "--cc:" + chanColor(ch), "aria-pressed": String(S.chan === ch), onclick: () => setChan(S.chan === ch ? null : ch) },
        el("span", { class: "chan-logo sm" }, chanMark(ch)), ch, c);
    }));
  // Phones: the same filters as a select next to the search box
  const sel = $("statusMobile");
  sel.replaceChildren(el("option", { value: "" }, t("allStatuses")), ...STEPS.map((s, i) => el("option", { value: String(i) }, stepName(i))),
    el("option", { value: "risk" }, t("summaryRisk")), el("option", { value: "unassigned" }, t("summaryUnassigned")));
  sel.value = S.filter == null ? "" : String(S.filter);
}

// ---------- the day ----------
function renderDay() {
  const searching = !!S.hits, day = dayOrders();
  $("clearSearch").hidden = !searching;
  $("dLabel").textContent = searching ? (S.hitsTitle || t("searchResults")) : longDate(S.sel);
  $("dSub").textContent = dayCount(day.length) + " · " + t("manila");
  renderFilters(day);

  // Summary: small, read-only, one line (dot in the state's colour + number + state)
  const c = (i) => day.filter((o) => stepOf(o) === i).length;
  const items = [[0, "sumPrep"], [1, "sumReady"], [2, "sumTransit"], [3, "sumDone"], ...(c(4) ? [[4, "sumFail"]] : [])];
  const sum = $("summary"), sig = items.map(([i]) => c(i)).join(",");
  sum.replaceChildren(...items.map(([i, k]) => el("span", { class: "sum-item", style: `--c:var(--${STEPS[i].k})` }, el("i", { "aria-hidden": "true" }), el("b", {}, String(c(i))), " " + t(k))));
  if (sum.dataset.sig && sum.dataset.sig !== sig && !prefersReducedMotion()) sum.animate([{ opacity: .4 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
  sum.dataset.sig = sig;

  const box = $("list"); box.replaceChildren();
  box.setAttribute("aria-busy", String(!S.loaded));
  // Orders at risk and "nobody home" reschedules, above the timeline
  const risky = searching ? [] : day.filter(riskOf);
  if (risky.length && S.filter !== "risk") box.append(el("div", { class: "missed-banner risk", role: "status" }, el("span", {}, icon("alert")),
    el("div", {}, el("b", {}, t("riskBanner", { n: risky.length })),
      el("ul", {}, risky.slice(0, 4).map((o) => el("li", {}, el("button", { class: "missed-row", type: "button", onclick: () => openOrder(o) },
        el("b", {}, "#" + o.num), " · " + (o.customer_name || t("noName")) + " · ", el("small", {}, t("risk_" + riskOf(o))))))),
      risky.length > 4 ? el("button", { class: "linkish", type: "button", onclick: () => setFilter("risk") }, t("seeAll")) : null)));
  const missedHere = !searching ? S.orders.filter((o) => o.missed_on === S.sel && o.date !== S.sel) : [];
  if (missedHere.length) box.append(el("div", { class: "missed-banner", role: "status" }, el("span", {}, icon("alert")), el("div", {},
    el("b", {}, t("missedBanner", { n: missedHere.length })),
    ...missedHere.map((o) => el("button", { class: "missed-row", type: "button", onclick: () => { selectDay(o.date); openOrder(o); } },
      el("b", {}, "#" + o.num), " · " + (o.customer_name || t("noName")) + " → ", el("small", {}, shortDate(o.date) + " · " + o.slot))))));

  const empty = (title, sub, action) => box.append(el("div", { class: "empty" }, el("img", { src: "/img/emblem.webp", alt: "" }), el("b", {}, title), sub ? el("span", {}, sub) : null, action));
  if (S.loadError && !S.loaded) { empty(t("loadFail"), null, el("button", { class: "btn", type: "button", onclick: () => loadOrders() }, t("retry"))); return; }
  if (!S.loaded) {
    box.append(...[0, 1, 2].map(() => el("div", { class: "skel-card", "aria-hidden": "true" }, el("div", { class: "skel", style: "height:72px" }),
      el("div", { class: "skel-lines" }, el("div", { class: "skel", style: "height:12px;width:30%" }), el("div", { class: "skel", style: "height:16px;width:55%" }), el("div", { class: "skel", style: "height:12px;width:70%" })))));
    return;
  }
  if (!day.length) { empty(t(searching ? "emptySearch" : "noOrdersDay"), searching ? null : t("emptyAdmin")); renderBulk(); return; }
  const list = day.filter(filterMatch);
  if (!list.length) { empty(t("noneFiltered"), null, el("button", { class: "btn", type: "button", onclick: () => { S.filter = null; S.chan = null; flipDay(); } }, t("showAll"))); renderBulk(); return; }
  for (const o of list) box.append(timelineEntry(o, searching || o.date !== S.sel));
  renderBulk();
}

// ---------- one order on the timeline ----------
const NEXT_LABEL = { 0: "actReady", 1: "actOut", 2: "actDelivered", 4: "actOutAgain" };
function timelineEntry(o, withDate) {
  const [a, z] = String(o.slot || "").split(/\s*-\s*/);
  const fmt = (s) => (s || "").replace(/^(\d):/, "0$1:");
  return el("div", { class: "entry", "data-id": o.id },
    el("div", { class: "when", style: `--c:var(--${STEPS[stepOf(o)].k})` }, el("span", {}, withDate ? el("small", {}, shortDate(o.date)) : null, el("b", {}, fmt(a) || o.slot), el("small", {}, fmt(z)))),
    orderCard(o));
}
const badge = (i) => el("span", { class: "badge s-" + STEPS[i].k }, icon(STEP_ICON[i]), stepName(i));
const retryTag = (o) => o.attempts > 0 && stepOf(o) !== 3
  ? el("span", { class: "tag fail" }, icon("alert"), o.missed_on ? t("retryTag", { n: o.attempts + 1, date: shortDate(o.missed_on) }) : t("retryTagNoDate", { n: o.attempts + 1 })) : null;
function orderCard(o) {
  const cur = stepOf(o), k = STEPS[cur].k, next = NEXT[cur], busy = S.pending.has(o.id), risk = riskOf(o);
  const phone = intlPhone(o.customer_phone);
  const archived = S.cap.archive && o.archived_at;
  const open = () => openOrder(o);
  // The status badge is also a select: picking a step goes through the same checks as the progress line
  const statusSel = el("label", { class: "badge-sel" }, badge(cur),
    el("select", { "aria-label": t("status") + " · #" + o.num, disabled: busy || archived, onchange: (e) => { const v = +e.target.value; e.target.value = String(cur); requestStep(o, v); } },
      STEPS.map((s, i) => el("option", { value: String(i), selected: i === cur }, stepName(i)))));
  const pick = S.selecting ? el("label", { class: "pick" }, el("input", { type: "checkbox", checked: S.selected.has(o.id), "aria-label": t("selectOrder", { num: o.num }),
    onchange: (e) => { e.target.checked ? S.selected.add(o.id) : S.selected.delete(o.id); card.classList.toggle("picked", e.target.checked); renderBulk(); } })) : null;
  const tags = [retryTag(o), risk ? el("span", { class: "tag risk" }, icon("clock"), t("risk_" + risk)) : null, archived ? el("span", { class: "tag muted" }, icon("archive"), t("archived")) : null].filter(Boolean);
  const card = el("article", { class: "order k-" + k + (risk ? " at-risk" : "") + (S.selected.has(o.id) ? " picked" : "") + (busy ? " saving" : ""), "data-order": o.id },
    el("div", { class: "o-top" + (pick ? " picking" : "") }, pick,
      el("button", { class: "thumb-btn", type: "button", "aria-label": t("order", { num: o.num }) + " · " + (o.customer_name || t("noName")), onclick: open }, thumb(o)),
      el("div", { class: "o-main" },
        el("div", { class: "o-meta" }, el("span", { class: "no" }, "#" + o.num), chanChip(o.channel), pricesOn() && o.amount ? el("span", { class: "amt" }, peso(o.amount)) : null),
        el("button", { class: "o-name", type: "button", onclick: open }, o.customer_name || t("noName")),
        floristPicker(o),
        tags.length ? el("div", { class: "o-tags" }, tags) : null,
        el("div", { class: "o-sub" },
          /^\d{7,15}$/.test(phone) ? el("a", { href: "tel:+" + phone }, icon("phone"), "+" + phone) : null,
          o.address ? el("a", { class: "o-addr", href: mapsUrl(o.address), target: "_blank", rel: "noopener" }, icon("map"), o.address) : el("span", { class: "note" }, t("noAddress"))),
        o.card_message || o.notes ? el("div", { class: "o-card" }, icon("note"), o.card_message || o.notes) : null),
      statusSel),
    el("div", { class: "o-bottom" }, stepper(o),
      el("div", { class: "actions" },
        el("button", { class: "btn icon", type: "button", "aria-label": t("notify"), title: t("notify"), onclick: async () => { await openFresh(o); document.querySelector(".sheet #f-link")?.scrollIntoView({ block: "center" }); } }, icon("message")),
        cur === 2 && !archived ? el("button", { class: "btn", type: "button", disabled: busy, onclick: () => missedDialog(o) }, t("actMissed")) : null,
        cur === 4 && !archived ? el("button", { class: "btn danger", type: "button", disabled: busy, onclick: () => missedDialog(o) }, t("reschedule")) : null,
        next != null && !archived ? el("button", { class: "btn primary", type: "button", disabled: busy, onclick: () => requestStep(o, next) }, t(NEXT_LABEL[cur])) : null,
        el("button", { class: "btn", type: "button", onclick: open }, t("details")))));
  return card;
}
// The progress line is the one status control: a tap moves the order, and steps with consequences ask first.
function stepper(o) {
  const cur = stepOf(o), idx = cur === 4 ? 3 : cur;
  const box = el("div", { class: "steps", role: "group", "aria-label": t("status") });
  // "Nobody home" takes the last place, after On the way
  [0, 1, 2, cur === 4 ? 4 : 3].forEach((s, i) => {
    if (i) box.append(el("span", { class: "link" + (i <= idx ? " on" : "") }));
    box.append(el("button", { type: "button", class: "step" + (i < idx ? " done" : i === idx ? " cur" : ""), "aria-pressed": String(i === idx), "aria-label": stepName(s),
      disabled: S.pending.has(o.id) || (S.cap.archive && o.archived_at), onclick: () => requestStep(o, s) },
      el("span", { class: "node" }), el("span", { class: "t" }, stepName(s))));
  });
  return box;
}
// Change the florist straight from the card (the server emails them when assigned)
function floristPicker(o) {
  const vendors = S.members.filter((m) => m.role !== "carrier");
  const s = el("select", { "aria-label": t("vendor") + " · #" + o.num },
    el("option", { value: "" }, t("unassigned")), ...vendors.map((m) => el("option", { value: m.email, selected: m.email === o.vendor_email }, m.name)));
  s.addEventListener("change", async () => {
    const before = o.vendor_email || null, v = s.value || null;
    const { data, error } = await sb.from("cdf_orders").update({ vendor_email: v }).eq("id", o.id).select().single();
    if (error) { s.value = before || ""; toast(t("saveFail", { msg: error.message }), { type: "error" }); return; }
    upsertLocal(data); render();
    toast(t("assignedTo", { name: v ? memberName(v) : t("unassigned") }), { action: t("undo"), onAction: async () => {
      const r = await sb.from("cdf_orders").update({ vendor_email: before }).eq("id", o.id).select().single();
      if (!r.error) { upsertLocal(r.data); render(); }
    } });
  });
  return el("label", { class: "o-vendor" + (o.vendor_email ? "" : " unset") }, icon("flower"), s);
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
  const vend = el("select", { class: "input", "aria-label": t("assignFlorist") }, el("option", { value: "" }, t("assignFlorist") + "…"),
    el("option", { value: "-" }, t("unassigned")), ...S.members.filter((m) => m.role !== "carrier").map((m) => el("option", { value: m.email }, m.name)));
  vend.onchange = () => { if (vend.value) bulkUpdate(picked, { vendor_email: vend.value === "-" ? null : vend.value }); };
  fill(bar, 
    el("span", { class: "num" }, t("nSelected", { n: picked.length })),
    el("button", { class: "btn", type: "button", onclick: () => { [...document.querySelectorAll("#list .entry[data-id]")].forEach((c) => S.selected.add(c.dataset.id)); renderDay(); } }, t("selectAll")),
    vend,
    el("button", { class: "btn", type: "button", disabled: !picked.some((o) => stepOf(o) === 0), onclick: () => bulkUpdate(picked.filter((o) => stepOf(o) === 0), { status: "Ready", delivery: "-" }) }, t("actReady")),
    S.cap.archive ? el("button", { class: "btn", type: "button", disabled: !picked.length, onclick: () => setArchived(picked, true) }, icon("archive"), t("archive")) : null,
    el("span", { class: "spacer" }),
    el("button", { class: "btn ghost", type: "button", onclick: () => setSelecting(false) }, t("done")));
}
async function bulkUpdate(list, patch) {
  if (!list.length) return;
  const { data, error } = await sb.from("cdf_orders").update(patch).in("id", list.map((o) => o.id)).select();
  if (error) { toast(t("saveFail", { msg: error.message }), { type: "error" }); return; }
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
  const safe = q.replace(/^#/, "").replace(/[,()%*\\"]/g, " ").trim(), digits = q.replace(/\D/g, "");
  const ors = safe ? ["num", "customer_name", "buyer_name", "address", "customer_email"].map((c) => `${c}.ilike.%${safe}%`) : [];
  // Phones are matched on their last 9 digits, so 0917…, 917… and +63917… all find each other
  if (digits.length >= 3) { const tail = digits.slice(-9); ors.push(`customer_phone.ilike.%${tail}%`, `buyer_phone.ilike.%${tail}%`); }
  // Loaded orders are searched without accents too ("Sofia" finds "Sofía"); the server adds the rest
  const nq = norm(safe);
  const local = S.orders.filter((o) => (nq && [o.num, o.customer_name, o.buyer_name, o.address, o.customer_email].some((v) => norm(v).includes(nq)))
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
  flipDay();
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
  if (error) { toast(t("loadFail"), { type: "error" }); return; }
  S.hits = data; S.hitsTitle = t("archivedTitle", { month: $("mLabel").textContent }); S.filter = null;
  renderDay();
}

// ---------- sidebar tools: archive delivered, CSV ----------
function renderTools() {
  const box = $("adminTools");
  box.hidden = !isStaff();
  if (!isStaff()) return;
  const delivered = S.orders.filter((o) => o.delivery === "Delivered" && o.date < S.today);
  fill(box, 
    S.cap.archive
      ? el("button", { class: "btn ghost", type: "button", disabled: !delivered.length, onclick: async () => {
        if (await askConfirm(t("archiveAsk", { n: delivered.length }), t("archive"), { detail: t("archiveHint") })) setArchived(delivered, true);
      } }, icon("archive"), t("archiveDelivered", { n: delivered.length }))
      : isAdmin() ? el("button", { class: "btn ghost", type: "button", disabled: !delivered.length, onclick: () => purgeDelivered(delivered) }, icon("trash"), t("purge", { n: delivered.length })) : null,
    S.cap.archive ? el("button", { class: "btn ghost", type: "button", onclick: showArchived }, icon("archive"), t("seeArchived")) : null,
    el("button", { class: "btn ghost", type: "button", onclick: exportDialog }, icon("download"), t("exportCsv")));
}
// Before migration 012 there is no archive: deleting stays available to admins, with a clear warning
async function purgeDelivered(done) {
  if (!(await askConfirm(t("purgeAsk", { n: done.length }), t("yesDelete"), { danger: true }))) return;
  const { error } = await sb.from("cdf_orders").delete().in("id", done.map((o) => o.id));
  if (error) { toast(t("purgeFail"), { type: "error" }); return; }
  await removeFiles(done);
  toast(t("purged", { n: done.length })); loadOrders();
}
function exportDialog() {
  const m = S.month;
  const iFrom = el("input", { type: "date", value: iso(new Date(m.getFullYear(), m.getMonth(), 1)) });
  const iTo = el("input", { type: "date", value: iso(new Date(m.getFullYear(), m.getMonth() + 1, 0)) });
  const iArch = el("input", { type: "checkbox", checked: true });
  miniSheet(t("exportTitle"), [el("div", { class: "row2" }, field(t("from"), iFrom), field(t("to"), iTo)),
    S.cap.archive ? checkRow(iArch, t("includeArchived")) : null,
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
    ["attempts", "attempts"], ...(S.cap.amount ? [["amount", "amount"]] : []), [(o) => (o.archived_at ? "1" : ""), "archived"], [(o) => trackUrl(o), "customerLink"]];
  const cell = (v) => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [cols.map(([, h]) => cell(t(h))).join(","), ...rows.map((o) => cols.map(([c]) => cell(typeof c === "function" ? c(o) : o[c])).join(","))];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
