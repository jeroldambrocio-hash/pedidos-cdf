// The customer's payment page (/pagar.html#<secret>), opened from the link the shop sends after setting the price.
// It shows what is being paid and opens PayMongo's secure page; coming back from it, it asks the server to check
// with PayMongo. The page never decides that something is paid: only PayMongo's answer, read by the server, does.
// The secret stays in the # part of the address, which browsers never send to any server.
(() => {
  const CFG = window.CDF_CONFIG || {};
  const API = `${CFG.url}/functions/v1/cdf-paymongo`;
  const root = document.getElementById("payRoot");
  const token = decodeURIComponent(location.hash.slice(1));
  const back = new URLSearchParams(location.search).get("back");
  const h = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) if (v != null) k === "class" ? (n.className = v) : k.startsWith("on") ? (n[k] = v) : n.setAttribute(k, v); n.append(...kids.flat().filter((x) => x != null && x !== false)); return n; };
  const money = (n) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(n));
  const day = (d) => new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Manila" }).format(new Date(d + "T12:00:00+08:00"));
  let view = null, msg = "", payErr = false, busy = false, checks = 0; // payErr stays until the customer taps Pay again

  async function call(action) {
    const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.anonKey }, body: JSON.stringify({ action, token }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "server"), { status: r.status });
    return j;
  }

  function render() {
    if (!view) { root.replaceChildren(h("div", { class: "card po-done", role: "alert" }, h("p", {}, msg || t("plLoading")))); return; }
    const v = view, card = h("div", { class: "card po-done pay-card" + (v.status === "paid" ? " is-paid" : "") });
    if (v.status === "paid") {
      card.append(h("div", { class: "pay-check", "aria-hidden": "true" }, "✓"), h("h2", { tabindex: "-1" }, t("plPaidTitle")),
        h("p", {}, t("plPaid", { ref: v.ref })),
        h("p", { class: "note" }, t("plPaidOn", { date: new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(v.paidAt)), amount: money(v.amount) })),
        ...trackBlock(v));
    } else {
      const open = v.status === "open" && !v.review && ["received", "in_review"].includes(v.requestStatus);
      card.append(h("p", { class: "po-ref" }, t("poRef"), " ", h("b", {}, v.ref)),
        h("dl", { class: "pay-dl" },
          h("div", {}, h("dt", {}, t("plFor", { name: v.receiver })), h("dd", {}, day(v.date) + " · " + formatSlot12(v.slot))),
          h("div", {}, h("dt", {}, v.mode === "pickup" ? t("plPickup", { shop: v.pickupBranch || "Casa de Flores" }) : t("plDelivery")), h("dd", {})),
          h("div", { class: "pay-total" }, h("dt", {}, t("plAmount")), h("dd", {}, money(v.amount)))));
      if (open) {
        const pay = h("button", { class: "btn primary block", type: "button", onclick: () => go() }, busy ? t("plOpening") : payErr ? t("plRetry") : t("plButton", { amount: money(v.amount) }));
        if (busy) pay.disabled = true;
        // Element.append() writes null as the text "null": only real nodes go in
        if (payErr) card.append(h("p", { class: "err", role: "alert" }, t("plPayFailed")));
        card.append(pay, h("p", { class: "note" }, t("plMethods")));
        if (v.checkoutOpenUntil) card.append(h("p", { class: "note" }, t("plPageOpenUntil", { time: formatClock12(v.checkoutOpenUntil) })));
        if (back === "paid") card.append(h("p", { class: "pay-wait", role: "status" }, checks < 15 ? t("plChecking") : t("plStillChecking")),
          ...(checks >= 15 ? [h("button", { class: "btn block", type: "button", onclick: () => { checks = 0; poll(); } }, t("plCheck"))] : []));
        if (back === "cancelled") card.append(h("p", { class: "note" }, t("plCancelledBack")));
      } else if (v.review) card.append(h("p", { class: "pay-wait", role: "status" }, t("plReview")));
      else card.append(h("p", { class: "err" }, v.replaced ? t("plReplaced") : v.status === "cancelled" ? t("plCancelled") : t("plClosed")));
      if (msg) card.append(h("p", { class: "err", role: "alert" }, msg));
    }
    if (CFG.testCopy || /test/i.test(CFG.payMode || "")) card.append(h("p", { class: "note pay-test" }, t("plTest")));
    root.replaceChildren(card);
  }
  // The tracking page exists only while tracking is on (features.tracking in config.js)
  const tracks = (v) => !!v.trackCode && CFG.features?.tracking !== false;
  // After paying: when and where, and the order's tracking page (same link the shop shares)
  function trackBlock(v) {
    const when = day(v.date) + " · " + formatSlot12(v.slot);
    return [h("p", {}, v.mode === "pickup" ? t("plTrackPickup", { shop: v.pickupBranch || "Casa de Flores", when }) : t("plTrackDelivery", { when })),
      tracks(v) ? h("a", { class: "btn primary block", href: "/p/" + encodeURIComponent(v.trackCode) }, t(v.mode === "pickup" ? "plPickupStatus" : "plTrack")) : null,
      tracks(v) ? h("p", { class: "note" }, t("plTrackNote")) : null].filter(Boolean);
  }
  const fail = (e) => (e.status === 404 ? t("plGone") : e.status === 409 ? "" : t("plError"));

  async function load(action = "view") {
    try {
      view = await call(action);
      // First visit with no language chosen yet: the language the request was written in
      let saved = null; try { saved = localStorage.getItem("cdf-lang"); } catch {}
      if (!saved && view.lang && view.lang !== LANG) setLang(view.lang);
      msg = "";
    } catch (e) { msg = fail(e); if (e.status === 404) view = null; }
    render();
  }
  async function go() {
    if (busy) return; busy = true; msg = ""; payErr = false; render();
    try { const r = await call("pay"); if (r.paid) { busy = false; return load("check"); } location.assign(r.url); return; }
    catch (e) {
      busy = false;
      // Keep saying what happened: the refresh below must not wipe it (409/404 = the page itself shows the new state)
      payErr = e.status !== 409 && e.status !== 404;
      await load();
    }
  }
  // Back from PayMongo: ask the server to check (the webhook usually got there first)
  async function poll() {
    await load(checks === 0 ? "check" : "view");
    if (view?.status === "paid" || view?.review || back !== "paid") return;
    checks++; render();
    if (checks < 15) setTimeout(poll, checks < 5 ? 2000 : 4000);
    else if (checks === 15) load("check");
  }

  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) { msg = t("plGone"); render(); return; }
  document.addEventListener("langchange", render);
  back === "paid" ? poll() : load();
})();
