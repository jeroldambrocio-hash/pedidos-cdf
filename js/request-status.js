// The customer's own page for a request (/solicitud.html#<secret>), linked from the form's "received" screen.
// While the team prepares the price it says so and checks again by itself; once an admin opens a PayMongo link it
// shows the total and sends them to /pagar.html to pay. The admin's message stays the main way; this is the backup.
// The secret stays in the # part of the address, which browsers never send to any server.
(() => {
  const CFG = window.CDF_CONFIG || {};
  const API = `${CFG.url}/functions/v1/cdf-paymongo`;
  const root = document.getElementById("payRoot");
  const token = decodeURIComponent(location.hash.slice(1));
  const h = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) if (v != null) k === "class" ? (n.className = v) : k.startsWith("on") ? (n[k] = v) : n.setAttribute(k, v); n.append(...kids.flat().filter((x) => x != null && x !== false)); return n; };
  const money = (n) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(n));
  const day = (d) => new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Manila" }).format(new Date(d + "T12:00:00+08:00"));
  const EVERY = 15_000;           // while it waits for a price; also right away when the page comes back into view
  let view = null, msg = "", timer = 0, copied = false;

  async function load() {
    clearTimeout(timer);
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.anonKey }, body: JSON.stringify({ action: "status", token }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || "server"), { status: r.status });
      view = j; msg = "";
      let saved = null; try { saved = localStorage.getItem("cdf-lang"); } catch {}
      if (!saved && view.lang && view.lang !== LANG) setLang(view.lang);
    } catch (e) { msg = e.status === 404 ? t("rsGone") : t("plError"); if (e.status === 404) view = null; }
    render();
    if (waiting() || (!view && msg && msg !== t("rsGone"))) timer = setTimeout(() => { if (!document.hidden) load(); }, EVERY);
  }
  const open = () => view && ["received", "in_review"].includes(view.status);
  const waiting = () => open() && view.pay?.status !== "open";

  function render() {
    if (!view) { root.replaceChildren(h("div", { class: "card po-done", role: msg ? "alert" : "status" }, h("p", {}, msg || t("plLoading")))); return; }
    const v = view, paid = v.pay?.status === "paid";
    const card = h("div", { class: "card po-done pay-card rs-card" + (paid ? " is-paid" : "") });
    if (paid) {
      card.append(h("div", { class: "pay-check", "aria-hidden": "true" }, "✓"), h("h2", {}, t("plPaidTitle")), h("p", {}, t("plPaid", { ref: v.ref })),
        v.pay.paidAt ? h("p", { class: "note" }, t("plPaidOn", { date: new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(v.pay.paidAt)), amount: money(v.pay.amount) })) : null);
    } else {
      card.append(h("p", { class: "po-ref" }, t("poRef"), " ", h("b", {}, v.ref)),
        h("dl", { class: "pay-dl" },
          h("div", {}, h("dt", {}, t("plFor", { name: v.receiver })), h("dd", {}, day(v.date) + " · " + formatSlot12(v.slot))),
          h("div", {}, h("dt", {}, v.mode === "pickup" ? t("plPickup", { shop: v.pickupBranch || "Casa de Flores" }) : t("plDelivery")), h("dd", {})),
          open() && v.pay?.status === "open" ? h("div", { class: "pay-total" }, h("dt", {}, t("plAmount")), h("dd", {}, money(v.pay.amount))) : null));
      if (open() && v.pay?.status === "open" && v.pay.token) {
        card.append(h("p", { class: "rs-ready" }, t("rsReady")),
          h("a", { class: "btn primary block", href: "/pagar.html#" + encodeURIComponent(v.pay.token) }, t("rsPayBtn", { amount: money(v.pay.amount) })),
          h("p", { class: "note" }, t("plMethods")));
      } else if (open()) {
        card.append(h("p", { class: "pay-wait", role: "status" }, t("rsPreparing")), h("p", { class: "note" }, t("rsPreparingNote")));
      } else card.append(h("p", { class: v.status === "accepted" ? "" : "err" }, t(v.status === "accepted" ? "rsAccepted" : v.status === "rejected" ? "rsRejected" : "rsExpired")));
      if (msg) card.append(h("p", { class: "err", role: "alert" }, msg));
      if (open()) card.append(h("p", { class: "note" }, t("rsSave")),
        h("button", { class: "btn block", type: "button", onclick: copy }, copied ? t("rsCopied") : t("rsCopy")));
    }
    if (CFG.testCopy || /test/i.test(CFG.payMode || "")) card.append(h("p", { class: "note pay-test" }, t("plTest")));
    root.replaceChildren(card);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(location.href); copied = true; render(); setTimeout(() => { copied = false; render(); }, 2000); }
    catch { /* the address bar still has it */ }
  }

  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) { msg = t("rsGone"); render(); return; }
  document.addEventListener("langchange", render);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && (waiting() || !view)) load(); });
  load();
})();
