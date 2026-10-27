// Statistics (admin): how the last days went. Reads archived orders too, so archiving never loses numbers.
// One series per chart, one neutral hue, values always written next to the bar (no colour-only reading).

let statsDays = 30, statsRows = null, statsFor = null;
async function renderStats() {
  const box = $("statsBody");
  const from = addDays(S.today, -(statsDays - 1)), key = from + "|" + S.today;
  $("statsPeriod").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.days === statsDays)));
  if (statsFor !== key) {
    box.replaceChildren(el("div", { class: "empty" }, t("loading")));
    const { data, error } = await sb.from("cdf_orders").select("num,date,slot,channel,vendor_email,status,delivery,attempts,buyer_phone,buyer_name,customer_phone" + (S.cap.archive ? ",archived_at" : ""))
      .gte("date", from).lte("date", S.today);
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

  const kpi = (label, value, hint) => el("div", { class: "kpi" }, el("b", { class: "tnum" }, value), el("span", {}, label), hint ? el("small", {}, hint) : null);
  const count = (fn) => { const m = {}; rows.forEach((o) => { const k = fn(o); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const bars = (title, entries) => {
    const max = Math.max(1, ...entries.map(([, n]) => n));
    return el("section", { class: "panel chart" }, el("h3", {}, title),
      entries.length ? el("ul", { class: "hbars" }, entries.map(([k, n]) => el("li", { title: k + ": " + n },
        el("span", { class: "hb-label" }, k), el("span", { class: "hb-track" }, el("i", { style: `width:${(n / max) * 100}%` })), el("b", { class: "tnum" }, String(n)))))
        : el("p", { class: "hint" }, t("noData")));
  };
  // Orders per day: vertical bars, each with its own tooltip; the same numbers sit in a table for screen readers
  const days = Array.from({ length: statsDays }, (_, i) => addDays(from, i));
  const perDay = Object.fromEntries(days.map((d) => [d, 0])); rows.forEach((o) => { if (o.date in perDay) perDay[o.date]++; });
  const maxDay = Math.max(1, ...Object.values(perDay));
  const tip = el("div", { class: "chart-tip", role: "status", "aria-live": "polite" });
  const daily = el("section", { class: "panel chart" }, el("h3", {}, t("perDay")),
    el("div", { class: "vbars", style: `--n:${statsDays}` }, days.map((d) => {
      const n = perDay[d], label = shortDate(d) + " · " + dayCount(n);
      return el("button", { type: "button", class: "vb" + (d === S.today ? " today" : ""), "aria-label": label,
        onmouseenter: () => (tip.textContent = label), onfocus: () => (tip.textContent = label), onclick: () => { S.tab = "orders"; setTab("orders"); selectDay(d); } },
        el("i", { style: `height:${(n / maxDay) * 100}%` }));
    })),
    el("div", { class: "vb-axis" }, el("span", {}, shortDate(from)), el("span", {}, t("today"))), tip,
    el("table", { class: "sr-only" }, el("caption", {}, t("perDay")), el("tbody", {}, days.map((d) => el("tr", {}, el("th", {}, shortDate(d)), el("td", {}, String(perDay[d])))))));

  box.replaceChildren(
    el("div", { class: "kpis" },
      kpi(t("kpiOrders"), String(rows.length), t("kpiPerDay", { n: (rows.length / statsDays).toFixed(1) })),
      kpi(t("kpiDelivered"), String(done.length)),
      kpi(t("kpiFirstTry"), pct(firstTry), t("kpiFirstTryHint")),
      kpi(t("kpiAttempts"), String(attempts), t("kpiAttemptsHint")),
      kpi(t("kpiOpenLate"), String(open), t("kpiOpenLateHint")),
      kpi(t("kpiRepeat"), pct(repeat), t("kpiRepeatHint"))),
    daily,
    el("div", { class: "chart-grid" },
      bars(t("byChannel"), count((o) => o.channel || t("noChannel"))),
      bars(t("byFlorist"), count((o) => (o.vendor_email ? memberName(o.vendor_email) : t("unassigned")))),
      bars(t("bySlot"), count((o) => { const h = Math.floor(slotStart(o.slot) / 60); return h < 12 ? t("morning") : h < 17 ? t("afternoon") : t("evening"); }))));
}
