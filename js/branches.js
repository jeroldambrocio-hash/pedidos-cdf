// Phase 4: the shop nearest to the delivery point, shown beside the florist picker as a suggestion.
// The server works it out (cdf_branch_ranking) from the florists' shop points in Team. It is a straight-line
// distance, not a driving time, and nothing is ever assigned by it: the admin picks, as always.

function shopSuggestion(select) {
  const node = el("div", { class: "shop-suggest", hidden: true, "aria-live": "polite" });
  let asked = 0, last = "";
  const pick = (email) => { select.value = email; select.dispatchEvent(new Event("change", { bubbles: true })); paint(); };
  const name = (f) => f.name + (f.away ? " (" + t("shopAway") + ")" : "");
  let data = null;

  function paint() {
    if (!data) return;
    const best = data.ranked.find((s) => !s.all_away), bestFlorist = best?.florists.find((f) => !f.away);
    const chosen = select.value;
    const top = best && bestFlorist
      ? el("p", { class: "shop-best" }, icon("map"), el("span", {}, t("shopNearest"), " ", el("b", {}, best.branch), " · ", t("shopKm", { km: fmtKm(best.km) }),
          " · ", best.florists.filter((f) => !f.away).map((f) => f.name).join(", ")),
          best.florists.some((f) => f.email === chosen)
            ? el("span", { class: "shop-chosen" }, icon("tick"), t("shopChosen"))
            : el("button", { class: "btn shop-use", type: "button", onclick: () => pick(bestFlorist.email) }, t("shopUse", { name: bestFlorist.name })))
      : el("p", { class: "shop-best note" }, icon("alert"), " ", t(data.ranked.length ? "shopAllAway" : "shopNone"));
    const rows = data.ranked.map((s) => el("li", { class: s.all_away ? "is-away" : null },
      el("span", { class: "shop-row-head" }, el("b", {}, s.branch), el("span", { class: "shop-km" }, t("shopKm", { km: fmtKm(s.km) }))),
      el("span", { class: "shop-florists" }, s.florists.map((f) => el("button", { class: "linkish" + (f.email === chosen ? " is-chosen" : ""), type: "button",
        "aria-pressed": String(f.email === chosen), onclick: () => pick(f.email) }, name(f))))));
    const left = data.incomplete.length ? el("p", { class: "note shop-left" }, t("shopLeftOut"), " ",
      data.incomplete.map((f) => f.name + " (" + f.missing.map((m) => t("shopMiss_" + m)).join(", ") + ")").join(" · ")) : null;
    const clash = data.conflicts.length ? el("p", { class: "note warn shop-clash" }, icon("alert"), " ", t("shopConflicts"), " ",
      data.conflicts.map((c) => t("shopClash_" + c.kind, { label: c.label, who: c.florists.join(", ") })).join(" · ")) : null;
    // The full list stays open across a repaint (choosing someone from it repaints)
    const wasOpen = !!node.querySelector(".shop-all")?.open;
    fill(node, top, el("details", { class: "shop-all", open: wasOpen }, el("summary", {}, t("shopAll")),
      el("p", { class: "note" }, t("shopStraight")), el("ol", { class: "shop-list" }, rows), left, clash));
    node.hidden = false;
  }

  // Asked again when the point or the date changes; a late answer for an older point is dropped
  async function update(point, date) {
    const key = point ? `${point.lat},${point.lng},${date || ""}` : "";
    if (key === last) return paint();
    last = key;
    const mine = ++asked;
    if (!point) { data = null; node.hidden = true; return; }
    const { data: d, error } = await sb.rpc("cdf_branch_ranking", { p_lat: point.lat, p_lng: point.lng, p_date: date || null }).then((r) => r, () => ({ error: true }));
    if (mine !== asked) return;
    if (error || !d) { data = null; node.hidden = true; return; }
    data = d; paint();
  }
  select.addEventListener("change", () => paint());
  return { node, update };
}
const fmtKm = (km) => new Intl.NumberFormat(locale(), { maximumFractionDigits: +km < 10 ? 1 : 0 }).format(+km);
