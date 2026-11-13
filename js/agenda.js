// Florists and drivers: what to do, by day, with one big button per step and a search box.

function renderAgenda() {
  const tomorrow = addDays(S.today, 1), week = addDays(S.today, 7), open = isOpen;
  const q = norm(S.query), digits = S.query.replace(/\D/g, "");
  const match = (o) => !q || [o.num, o.customer_name, o.address].some((v) => norm(v).includes(q))
    || (digits.length >= 3 && String(o.customer_phone || "").replace(/\D/g, "").includes(digits.slice(-9)));
  const os = S.orders.filter(match).sort(byTime);
  // A florist who picked another day on the calendar sees that day; "Today" brings the usual list back
  const picked = !q && isFlorist() && S.sel !== S.today ? S.sel : null;
  const groups = q ? [[t("searchResults"), os, true, false]] : picked ? [[longDate(picked), os.filter((o) => o.date === picked), false, false]] : [
    [t("grpLate"), os.filter((o) => o.date < S.today && open(o)), true, true],
    [t("today") + " · " + longDate(S.today), os.filter((o) => o.date === S.today), false, false],
  ];
  // Florists plan ahead; drivers only need today's route
  if (!q && !picked && !isCarrier()) groups.push(
    [t("tomorrow") + " · " + longDate(tomorrow), os.filter((o) => o.date === tomorrow), false, false],
    [t("grpNext"), os.filter((o) => o.date > tomorrow && o.date <= week), true, false]);
  $("clearSearch").hidden = !q;
  $("dLabel").textContent = isCarrier() ? t("myRoute") : t("myOrders");
  const todays = S.orders.filter((o) => o.date === S.today);
  $("dSub").textContent = (picked ? longDate(picked) : todays.length ? t("todayCount", { n: todays.length }) : t("nothingToday")) + " · " + t("manila");
  // A florist sees how many of their orders are done
  const mine = S.me?.role === "vendor";
  if (mine) refreshMemberStats(() => { if (S.tab === "orders") renderAgenda(); });
  $("summary").replaceChildren(...(mine && memberStats ? [doneLine(S.me.email)] : []));
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
  if (!any && picked) empty(t("emptyVendorDay"), null, el("button", { class: "btn", type: "button", onclick: () => selectDay(S.today) }, t("backToToday")));
  else if (!any) empty(t(q ? "emptySearch" : "allClear"), q ? null : isCarrier() ? t("emptyCarrier") : t("emptyVendor"));
  stagger(box);
}

function workCard(o, withDate, late) {
  const cur = stepOf(o), k = STEPS[cur].k, busy = S.pending.has(o.id);
  const big = (label, glyph, fn, cls = "primary") => el("button", { class: "btn block " + cls, type: "button", onclick: fn, disabled: busy }, icon(glyph), label);
  const acts = [];
  // A Lalamove rider is on it: follow the rider. Live (production) the order moves by itself, so the
  // manual buttons go; in sandbox nothing moves, so they stay to finish the test by hand.
  const pickup = isPickup(o);
  const ride = !pickup && typeof llActive === "function" && (cur === 1 || cur === 2) && llActive(o) ? llRowOf(o) : null;
  const rideLine = ride ? el("div", { class: "w-ride" }, icon("truck"), el("span", {}, t("ll_" + ride.status) || ride.status, ride.driver_name ? " · " + ride.driver_name : ""),
    ride.share_link ? el("a", { class: "link-out", href: ride.share_link, target: "_blank", rel: "noopener" }, t("llTrack")) : null) : null;
  const handsOff = ride && ride.env === "production";
  // to-<step>: on hover the button takes the colour of the state it leads to (styles.css)
  if (cur === 0 && !isCarrier()) acts.push(big(t("actReady"), "check", () => readyDialog(o), "primary to-ready"));
  // Pickup: the customer comes to the shop. Picked up, or Not collected (and later a new day for it)
  if (pickup && (cur === 1 || cur === 4)) acts.push(big(t("actPickedUp"), "check", () => requestStep(o, 3), "primary to-done"),
    cur === 1 ? big(t("actNotCollected"), "alert", () => requestStep(o, 4), "to-fail") : big(t("reschedule"), "calendar", () => missedDialog(o), "to-fail"));
  if (!pickup && ((cur === 1 && !handsOff) || cur === 4)) acts.push(big(t(cur === 4 ? "actOutAgain" : "actOut"), "truck", async () => {
    // With Lalamove: book the rider (the order moves when the rider picks it up)
    if (typeof llHeadOut === "function" && await llHeadOut(o)) return;
    const to = (o.customer_email || "").trim();
    if (await askConfirm(t("confirmTransit", { num: o.num }), t("markTransit"), { detail: to ? t("transitMailTo", { to }) : t("transitNoMail") })) advance(o, 2);
  }, "primary to-transit"));
  if (!pickup && cur === 2 && !handsOff) acts.push(big(t("actDelivered"), "check", () => deliverDialog(o), "primary to-done"), big(t("actMissed"), "alert", () => missedDialog(o), "to-fail"));
  // Call / WhatsApp were for the driver at the door; florists hand over to the Lalamove rider, who calls the customer
  const phone = o.customer_phone && isOpen(o) && isCarrier() ? intlPhone(o.customer_phone) : "";
  const small = [
    phone ? el("a", { class: "btn", href: "tel:+" + phone }, icon("phone"), t("call")) : null,
    phone ? el("a", { class: "btn", href: "https://wa.me/" + phone, target: "_blank", rel: "noopener" }, icon("message"), "WhatsApp") : null,
    !pickup && o.address && isOpen(o) ? el("a", { class: "btn", href: mapsUrl(o.address), target: "_blank", rel: "noopener" }, icon("map"), t("map")) : null,
  ].filter(Boolean);
  const open = () => openOrder(o);
  return el("article", { class: "work k-" + k + (late ? " late" : ""), "data-id": o.id },
    el("div", { class: "w-top", role: "button", tabindex: "0", "aria-label": t("order", { num: o.num }), onclick: open, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } } },
      thumb(o, "thumb lg"),
      el("div", { class: "o-main" },
        el("div", { class: "w-head" }, el("span", { class: "time" }, (withDate ? shortDate(o.date) + " · " : "") + formatSlot12(o.slot)), el("span", {}, "#" + o.num), chanChip(o.channel), badge(cur, o), chatChip(o)),
        el("div", { class: "w-name" }, o.customer_name || t("noName")),
        retryTag(o),
        // Cancelled: say it plainly so nobody prepares or drives it, with the office's reason
        cur === CANCELLED ? el("div", { class: "o-cancel" }, el("b", {}, t("cancelledWork")), o.cancel_reason ? " " + o.cancel_reason : "") : null,
        pickup ? el("div", { class: "note w-pickup" }, icon("box"), " ", t("pickupTag")) : o.address ? el("div", { class: "note" }, o.address) : null)),
    o.card_message ? el("div", { class: "msg" }, icon("note"), el("span", {}, o.card_message)) : null,
    o.notes ? el("div", { class: "note" }, el("b", {}, t("note") + ": "), o.notes) : null,
    rideLine,
    acts.length ? el("div", { class: "w-actions" }, ...acts) : null,
    small.length ? el("div", { class: "w-contact" }, ...small) : null);
}
