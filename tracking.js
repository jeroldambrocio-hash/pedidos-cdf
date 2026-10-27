// Public tracking page /p/<code>: the order's steps, the bouquet and delivery photos (short-lived links from cdf-track).
const { url, anonKey } = window.CDF_CONFIG;
const STEPS = ["prep", "ready", "transit", "done"];
const code = (location.pathname.match(/\/p\/([a-z0-9]+)/i) || [])[1] || new URLSearchParams(location.search).get("c") || "";
const card = document.getElementById("card");
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// last = { o } once the order loaded; a failed refresh keeps showing it and says so,
// so a dropped connection never reads as "order not found".
let last = null, failed = false, poll = null;
async function load() {
  try {
    const r = await fetch(url + "/functions/v1/cdf-track", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: "Bearer " + anonKey },
      body: JSON.stringify({ code }),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    last = { o: (await r.json()).order };
    failed = false;
  } catch { failed = true; }
  // Nothing to follow once the order is unknown or delivered: stop asking the server
  if (last && (!last.o || last.o.delivery === "Delivered")) stopPolling();
  render();
}
function glyph(index, isFail = false) {
  const paths = [
    '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.2 8.2 12 12M8.2 15.8 20 4M14 10l-4 4"/>',
    '<path d="m7 21-3-9 8 3 8-3-3 9H7Zm5-6V4m0 4C7 8 6 5 6 3c4 0 6 2 6 5Zm0 3c5 0 6-3 6-5-4 0-6 2-6 5Z"/>',
    '<path d="M3 6h11v12H3V6Zm11 4h4l3 4v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  ];
  const span = h("span", "dot"); span.setAttribute("aria-hidden", "true");
  span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (isFail ? '<path d="M12 3 2 21h20L12 3Zm0 6v5m0 3v1"/>' : paths[index]) + "</svg>";
  return span;
}
const photo = (src, alt, caption) => {
  const fig = h("figure", "proof-figure"), img = h("img");
  img.src = src; img.alt = alt; img.loading = "lazy";
  img.onerror = () => fig.replaceChildren(h("div", "meta", t("photoFail")));
  fig.append(img); if (caption) fig.append(h("figcaption", null, caption));
  return fig;
};

function render() {
  document.getElementById("autoRefresh").hidden = !(last?.o && last.o.delivery !== "Delivered");
  if (!last) {
    if (!failed) return;
    const retry = h("button", "btn", t("retry")); retry.type = "button";
    retry.onclick = () => { card.replaceChildren(h("h2", null, t("loadingOrder"))); load(); };
    card.replaceChildren(h("h2", null, t("loadErrTitle")), h("div", "meta", t("loadErrTxt")), retry);
    return;
  }
  const { o } = last;
  if (!o) { card.replaceChildren(h("h2", null, t("notFound")), h("div", "meta", t("notFoundTxt"))); return; }
  const isFailed = o.delivery === "Failed";
  const cur = isFailed ? 3 : o.delivery === "Delivered" ? 3 : o.delivery === "In transit" ? 2 : o.status === "Ready" ? 1 : 0;
  const [y, m, d] = o.date.split("-").map(Number);
  const head = h("div", "track-head");
  head.append(h("h2", null, t("order", { num: o.num })), h("div", "meta", cap(new Date(y, m - 1, d).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })) + " · " + o.slot));
  if (o.for_name) head.append(h("div", "meta", t("forName", { name: o.for_name })));
  const top = [head];
  if (o.bouquet_url) top.push(photo(o.bouquet_url, t("bouquetPhoto"), t("bouquetCaption")));
  if (o.card_message) top.push(h("div", "note", o.card_message));
  const tl = h("ol", "tl");
  STEPS.forEach((label, i) => {
    // A failed attempt replaces the last step: in transit is done, delivery didn't happen.
    const isFail = isFailed && i === 3;
    const li = h("li", isFail ? "fail" : i < cur ? "past" : i === cur ? "cur" : "");
    const body = h("div"); body.append(h("b", null, isFail ? t("failedTitle") : t("st_" + label)), h("small", null, isFail ? t("failedTxt") : t("stepTxt")[i]));
    if (i === cur) li.setAttribute("aria-current", "step");
    li.append(glyph(i, isFail), body); tl.append(li);
  });
  const extra = [];
  if (o.delivery_note) extra.push(h("div", "note", o.delivery_note));
  if (o.proof_url) extra.push(photo(o.proof_url, t("proofPhoto")));
  // Shop time (Philippines), whatever the viewer's own time zone
  const when = new Date(o.updated_at).toLocaleString(locale(), { timeZone: "Asia/Manila", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const upd = h("div", "meta", t("updated", { when: when + " PHT" }) + (failed ? " · " + t("staleNote") : ""));
  card.replaceChildren(...top, tl, ...extra, upd);
}
function stopPolling() { clearInterval(poll); poll = null; document.removeEventListener("visibilitychange", onVisible); }
function onVisible() { if (!document.hidden) load(); }
document.addEventListener("langchange", render);
poll = setInterval(() => { if (!document.hidden) load(); }, 60000);
document.addEventListener("visibilitychange", onVisible);
load();
