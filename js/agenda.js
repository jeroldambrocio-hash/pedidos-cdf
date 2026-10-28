// Florists and drivers: what to do, by day, with one big button per step and a search box.

function renderAgenda() {
  const tomorrow = addDays(S.today, 1), week = addDays(S.today, 7), open = (o) => stepOf(o) !== 3;
  const q = norm(S.query), digits = S.query.replace(/\D/g, "");
  const match = (o) => !q || [o.num, o.customer_name, o.address].some((v) => norm(v).includes(q))
    || (digits.length >= 3 && String(o.customer_phone || "").replace(/\D/g, "").includes(digits.slice(-9)));
  const os = S.orders.filter(match).sort(byTime);
  const groups = q ? [[t("searchResults"), os, true, false]] : [
    [t("grpLate"), os.filter((o) => o.date < S.today && open(o)), true, true],
    [t("today") + " · " + longDate(S.today), os.filter((o) => o.date === S.today), false, false],
  ];
  // Florists plan ahead; drivers only need today's route
  if (!q && !isCarrier()) groups.push(
    [t("tomorrow") + " · " + longDate(tomorrow), os.filter((o) => o.date === tomorrow), false, false],
    [t("grpNext"), os.filter((o) => o.date > tomorrow && o.date <= week), true, false]);
  $("clearSearch").hidden = !q;
  $("dLabel").textContent = isCarrier() ? t("myRoute") : t("myOrders");
  const todays = S.orders.filter((o) => o.date === S.today);
  $("dSub").textContent = (todays.length ? t("todayCount", { n: todays.length }) : t("nothingToday")) + " · " + t("manila");
  $("summary").replaceChildren();
  const box = $("list"); box.replaceChildren();
  box.classList.remove("timeline");
  const empty = (title, sub, action) => box.append(el("div", { class: "empty" }, el("img", { src: "/img/emblem.webp", alt: "" }), el("b", {}, title), sub ? el("span", {}, sub) : null, action));
  if (S.loadError && !S.loaded) { empty(t("loadFail"), null, el("button", { class: "btn", type: "button", onclick: () => loadOrders() }, t("retry"))); return; }
  if (!S.loaded) {
    box.append(...[0, 1].map(() => el("div", { class: "skel-card", "aria-hidden": "true" }, el("div", { class: "skel", style: "height:84px" }),
      el("div", { class: "skel-lines" }, el("div", { class: "skel", style: "height:14px;width:40%" }), el("div", { class: "skel", style: "height:18px;width:60%" })))));
    return;
  }
  let any = false;
  for (const [label, list, withDate, late] of groups) {
    if (!list.length) continue;
    any = true;
    box.append(el("div", { class: "agenda-list" },
      el("div", { class: "sec-h" + (late ? " late" : "") }, el("h3", {}, label), el("span", { class: "count neutral" }, String(list.length))),
      el("div", { class: "list-work" }, ...list.map((o) => workCard(o, withDate, late)))));
  }
  if (!any) empty(t(q ? "emptySearch" : "allClear"), q ? null : isCarrier() ? t("emptyCarrier") : t("emptyVendor"));
  stagger(box);
}

function workCard(o, withDate, late) {
  const cur = stepOf(o), k = STEPS[cur].k, busy = S.pending.has(o.id);
  const big = (label, glyph, fn, cls = "primary") => el("button", { class: "btn block " + cls, type: "button", onclick: fn, disabled: busy }, icon(glyph), label);
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
  ].filter(Boolean);
  const open = () => openOrder(o);
  return el("article", { class: "work k-" + k + (late ? " late" : ""), "data-id": o.id },
    el("div", { class: "w-top", role: "button", tabindex: "0", "aria-label": t("order", { num: o.num }), onclick: open, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } } },
      thumb(o, "thumb lg"),
      el("div", { class: "o-main" },
        el("div", { class: "w-head" }, el("span", { class: "time" }, (withDate ? shortDate(o.date) + " · " : "") + o.slot), el("span", {}, "#" + o.num), chanChip(o.channel), badge(cur)),
        el("div", { class: "w-name" }, o.customer_name || t("noName")),
        retryTag(o),
        o.address ? el("div", { class: "note" }, o.address) : null)),
    o.card_message ? el("div", { class: "msg" }, icon("note"), el("span", {}, o.card_message)) : null,
    o.notes ? el("div", { class: "note" }, el("b", {}, t("note") + ": "), o.notes) : null,
    acts.length ? el("div", { class: "w-actions" }, ...acts) : null,
    small.length ? el("div", { class: "w-contact" }, ...small) : null);
}
