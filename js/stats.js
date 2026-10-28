// Statistics (admin): how the last days went. Reads archived orders too, so archiving never loses numbers.
// One neutral ink per chart, values always written next to the bar (no colour-only reading).
// With prices on, sales by channel are added (needs migration 014).

let statsDays = 30, statsRows = null, statsFor = null;
async function renderStats() {
  const box = $("statsBody");
  const from = addDays(S.today, -(statsDays - 1)), key = from + "|" + S.today + "|" + pricesOn();
  $("statsPeriod").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.days === statsDays)));
  placePill($("statsPeriod"));
  if (statsFor !== key) {
    box.replaceChildren(el("div", { class: "kpis six" }, ...[0, 1, 2, 3, 4, 5].map(() => el("div", { class: "kpi" }, el("div", { class: "skel", style: "height:30px;width:30px" }), el("div", { class: "skel", style: "height:26px;width:50%" })))));
    const cols = "num,date,slot,channel,vendor_email,status,delivery,attempts,buyer_phone,buyer_name,customer_phone" + (S.cap.archive ? ",archived_at" : "") + (pricesOn() ? ",amount" : "");
    const { data, error } = await sb.from("cdf_orders").select(cols).gte("date", from).lte("date", S.today);
    if (error) { box.replaceChildren(el("div", { class: "empty" }, el("b", {}, t("loadFail")), el("button", { class: "btn", type: "button", onclick: () => { statsFor = null; renderStats(); } }, t("retry")))); return; }
    statsRows = data; statsFor = key;
  }
  const rows = statsRows;
  const done = rows.filter((o) => o.delivery === "Delivered");
  const firstTry = done.length ? done.filter((o) => !o.attempts).length / done.length : null;
  const attempts = rows.reduce((s, o) => s + (o.attempts || 0), 0);
  const open = rows.filter((o) => o.delivery !== "Delivered" && o.date < S.today).length;
  const who = (o) => intlPhone(o.buyer_phone || o.customer_phone) || (o.buyer_name || "").toLowerCase();
  const perBuyer = {}; rows.forEach((o) => { const k = who(o); if (k) perBuyer[k] = (perBuyer[k] || 0) + 1; });
  const buyers = Object.values(perBuyer), repeat = buyers.length ? buyers.filter((n) => n > 1).length / buyers.length : null;
  const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");

  const kpi = (glyph, label, value, hint) => el("div", { class: "kpi" }, el("span", { class: "ic" }, icon(glyph)), el("small", {}, label), el("b", {}, value), hint ? el("span", { class: "delta" }, hint) : null);
  const count = (fn, val = () => 1) => { const m = {}; rows.forEach((o) => { const k = fn(o); m[k] = (m[k] || 0) + val(o); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const bars = (title, entries, fmt = String, logo) => {
    const max = Math.max(1, ...entries.map(([, n]) => n)), total = entries.reduce((s, [, n]) => s + n, 0) || 1;
    return el("section", { class: "panel chart-card" }, el("div", { class: "chart-head" }, el("h3", {}, title)),
      entries.length ? el("div", { class: "hbars" }, entries.map(([k, n]) => el("div", { class: "hbar", tabindex: "0", title: k + ": " + fmt(n) },
        el("span", { class: "hbar-label" }, logo && CHANNELS.includes(k) ? el("span", { class: "chan-logo sm" }, chanMark(k)) : null, k),
        el("span", { class: "hbar-track" }, el("span", { class: "hbar-fill", style: `--w:${(n / max) * 100}%` })),
        el("span", { class: "hbar-val" }, el("b", {}, fmt(n)), el("small", {}, Math.round((n / total) * 100) + "%")))))
        : el("p", { class: "hint" }, t("noData")));
  };
  // Orders per day: columns with their value on hover/focus; the same numbers sit in a table for screen readers
  const days = Array.from({ length: statsDays }, (_, i) => addDays(from, i));
  const perDay = Object.fromEntries(days.map((d) => [d, 0])); rows.forEach((o) => { if (o.date in perDay) perDay[o.date]++; });
  const maxDay = Math.max(1, ...Object.values(perDay));
  const tip = el("div", { class: "chart-tip-line", role: "status", "aria-live": "polite" }, " ");
  const daily = el("section", { class: "panel chart-card wide" }, el("div", { class: "chart-head" }, el("h3", {}, t("perDay")), el("small", {}, dayCount(rows.length))),
    el("div", { class: "cols", style: `--n:${statsDays}` }, days.map((d) => {
      const n = perDay[d], label = shortDate(d) + " · " + dayCount(n);
      return el("button", { type: "button", class: "col" + (d === S.today ? " today" : ""), "aria-label": label, title: label,
        onmouseenter: () => (tip.textContent = label), onfocus: () => (tip.textContent = label), onclick: () => { setTab("orders"); selectDay(d); } },
        el("span", { class: "col-fill", style: `--h:${(n / maxDay) * 100}%` }));
    })),
    el("div", { class: "cols-axis" }, el("span", {}, shortDate(from)), el("span", {}, t("today"))), tip,
    el("table", { class: "sr-only" }, el("caption", {}, t("perDay")), el("tbody", {}, days.map((d) => el("tr", {}, el("th", {}, shortDate(d)), el("td", {}, String(perDay[d])))))));

  const sales = pricesOn() ? rows.reduce((s, o) => s + (+o.amount || 0), 0) : null;
  box.replaceChildren(
    el("div", { class: "kpis six" },
      kpi("orders", t("kpiOrders"), String(rows.length), t("kpiPerDay", { n: (rows.length / statsDays).toFixed(1) })),
      sales != null ? kpi("trend", t("kpiSales"), peso(sales)) : kpi("check", t("kpiDelivered"), String(done.length)),
      kpi("star", t("kpiFirstTry"), pct(firstTry), t("kpiFirstTryHint")),
      kpi("alert", t("kpiAttempts"), String(attempts), t("kpiAttemptsHint")),
      kpi("clock", t("kpiOpenLate"), String(open), t("kpiOpenLateHint")),
      kpi("user", t("kpiRepeat"), pct(repeat), t("kpiRepeatHint"))),
    el("div", { class: "chart-grid" },
      daily,
      bars(t("byChannel"), count((o) => o.channel || t("noChannel")), String, true),
      sales != null ? bars(t("bySales"), count((o) => o.channel || t("noChannel"), (o) => +o.amount || 0), peso, true)
        : bars(t("bySlot"), count((o) => { const h = Math.floor(slotStart(o.slot) / 60); return h < 12 ? t("morning") : h < 17 ? t("afternoon") : t("evening"); })),
      bars(t("byFlorist"), count((o) => (o.vendor_email ? memberName(o.vendor_email) : t("unassigned")))),
      sales != null ? bars(t("bySlot"), count((o) => { const h = Math.floor(slotStart(o.slot) / 60); return h < 12 ? t("morning") : h < 17 ? t("afternoon") : t("evening"); })) : null));
  stagger(box.querySelector(".kpis"));
}
