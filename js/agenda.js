// Florists and drivers: what to do, by day, with one big button per step and a search box.

function renderAgenda() {
  const tomorrow = addDays(S.today, 1), week = addDays(S.today, 7), open = (o) => stepOf(o) !== 3;
  const q = S.query.toLowerCase(), digits = S.query.replace(/\D/g, "");
  const match = (o) => !q || [o.num, o.customer_name, o.address].some((v) => String(v || "").toLowerCase().includes(q))
    || (digits.length >= 3 && String(o.customer_phone || "").replace(/\D/g, "").includes(digits.slice(-9)));
  const os = S.orders.filter(match).sort(byTime);
  const groups = q ? [[t("searchResults"), os, true]] : [
    [t("grpLate"), os.filter((o) => o.date < S.today && open(o)), true],
    [t("today") + " · " + longDate(S.today), os.filter((o) => o.date === S.today), false],
  ];
  // Florists plan ahead; drivers only need today's route
  if (!q && !isCarrier()) groups.push(
    [t("tomorrow") + " · " + longDate(tomorrow), os.filter((o) => o.date === tomorrow), false],
    [t("grpNext"), os.filter((o) => o.date > tomorrow && o.date <= week), true]);
  $("clearSearch").hidden = !q;
  $("dLabel").textContent = isCarrier() ? t("myRoute") : t("myOrders");
  const todays = S.orders.filter((o) => o.date === S.today);
  $("dSub").textContent = (todays.length ? t("todayCount", { n: todays.length }) : t("nothingToday")) + " · " + t("manila");
  const box = $("list"); box.replaceChildren();
  if (S.loadError && !S.loaded) { box.append(el("div", { class: "empty" }, el("b", {}, t("loadFail")), el("button", { class: "btn", type: "button", onclick: () => loadOrders() }, t("retry")))); return; }
  if (!S.loaded) { box.append(...[0, 1].map(() => el("div", { class: "wcard skeleton", "aria-hidden": "true" }))); return; }
  let any = false;
  for (const [label, list, withDate] of groups) {
    if (!list.length) continue;
    any = true;
    box.append(el("section", { class: "slot" }, el("h3", {}, label, el("span", { class: "count tnum" }, String(list.length))),
      el("div", { class: "orders" }, ...list.map((o) => workCard(o, withDate)))));
  }
  if (!any) box.append(el("div", { class: "empty" }, el("b", {}, t(q ? "emptySearch" : "allClear")), q ? null : isCarrier() ? t("emptyCarrier") : t("emptyVendor")));
}

function workCard(o, withDate) {
  const cur = stepOf(o), k = STEPS[cur].k, busy = S.pending.has(o.id);
  const big = (label, glyph, fn, cls = "primary") => el("button", { class: "btn big " + cls, type: "button", onclick: fn, disabled: busy }, icon(glyph), label);
  const acts = [];
  if (cur === 0 && !isCarrier()) acts.push(big(t("actReady"), "check", () => readyDialog(o)));
  if (cur === 1 || cur === 4) acts.push(big(t(cur === 4 ? "actOutAgain" : "actOut"), "truck", async () => {
    const to = (o.customer_email || "").trim();
    if (await askConfirm(t("confirmTransit", { num: o.num }), t("markTransit"), { detail: to ? t("transitMailTo", { to }) : t("transitNoMail") })) advance(o, 2);
  }));
  if (cur === 2) acts.push(big(t("actDelivered"), "check", () => deliverDialog(o)), big(t("actMissed"), "alert", () => missedDialog(o), ""));
  const phone = o.customer_phone && cur !== 3 ? intlPhone(o.customer_phone) : "";
  const small = [
    phone ? el("a", { class: "btn", href: "tel:+" + phone }, icon("phone"), t("call")) : null,
    phone ? el("a", { class: "btn", href: "https://wa.me/" + phone, target: "_blank", rel: "noopener" }, icon("message"), "WhatsApp") : null,
    o.address && cur !== 3 ? el("a", { class: "btn", href: mapsUrl(o.address), target: "_blank", rel: "noopener" }, icon("map"), t("map")) : null,
  ];
  const open = () => openOrder(o);
  return el("article", { class: "wcard state-" + k + (cur === 3 ? " done" : "") },
    el("div", { class: "w-main", role: "button", tabindex: "0", "aria-label": t("order", { num: o.num }), onclick: open, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } } },
      thumb(o, "thumb lg"),
      el("div", { class: "o-main" },
        el("div", { class: "o-top" },
          el("b", { class: "time tnum" }, (withDate ? shortDate(o.date) + " · " : "") + o.slot),
          el("span", { class: "num tnum" }, "#" + o.num), chanChip(o.channel),
          el("span", { class: "pill s-" + k }, stepName(cur))),
        el("div", { class: "w-name" }, o.customer_name || t("noName")),
        o.attempts > 0 && cur !== 3 ? el("span", { class: "tag fail" }, (o.missed_on ? t("retryTag", { n: o.attempts + 1, date: shortDate(o.missed_on) }) : t("retryTagNoDate", { n: o.attempts + 1 }))) : null,
        o.address ? el("div", { class: "o-sub" }, o.address) : null,
        o.card_message ? el("div", { class: "w-note" }, icon("note"), el("span", {}, o.card_message)) : null,
        o.notes ? el("div", { class: "w-note" }, el("span", {}, o.notes)) : null)),
    el("div", { class: "w-acts" }, ...acts, ...small));
}
