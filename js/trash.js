// The trash (12/11/2026, migration 20261112170000). Deleting an order by mistake is no longer final: "Move to
// trash" hides it everywhere and keeps everything (its payments, history, photos and proofs), and "Restore"
// brings back the same order. Only the owner can delete for good, from here. The server checks every rule
// (admins, reason, 30 days, owner, a rider on the order) and keeps a log of who did what, when and why.

const TRASH_DAYS = 30;
const trashError = (e) => {
  const m = e?.message || "";
  for (const [code, key] of [["cdf_order_has_rider", "deleteHasRider"], ["cdf_trash_reason", "trashReasonShort"], ["cdf_restore_expired", "trashExpired"],
    ["cdf_owner_only", "trashOwnerOnly"], ["cdf_order_in_trash", "trashIsIn"], ["cdf_purge_not_in_trash", "trashIsIn"]]) if (m.includes(code)) return t(key);
  return t("saveFail", { msg: m });
};
const daysLeft = (o) => Math.ceil((Date.parse(o.deleted_at) + TRASH_DAYS * 864e5 - Date.now()) / 864e5);

// Cancel, archive and trash are three different things: say which is which before trashing.
function trashDialog(o) {
  const reason = el("textarea", { rows: 2, maxlength: 500, placeholder: t("trashReasonPh") });
  const what = (glyph, title, text) => el("li", {}, el("span", { class: "ic" }, icon(glyph)), el("div", {}, el("b", {}, title), el("small", {}, text)));
  miniSheet(t("trashTitle", { num: o.num }), [
    el("ul", { class: "trash-explain" },
      what("close", t("cancelOrder"), t("trashExplainCancel")),
      what("archive", t("archive"), t("trashExplainArchive")),
      what("trash", t("trashMove"), t("trashExplainTrash", { days: TRASH_DAYS }))),
    reqField(t("trashReason"), reason)], t("trashMove"), async () => {
    if (reason.value.trim().length < 3) { reason.closest(".field").classList.add("invalid"); reason.focus(); return t("trashReasonShort"); }
    const { data, error } = await sb.rpc("cdf_order_trash", { p_id: o.id, p_reason: reason.value.trim() });
    if (error) return trashError(error);
    S.orders = S.orders.filter((x) => x.id !== o.id);
    if (S.hits) S.hits = S.hits.filter((x) => x.id !== o.id);
    invalidateStats();
    await closeSheet(true);
    toast(t("trashMoved", { num: o.num }), { action: t("undo"), onAction: () => restoreFromTrash(data || o) });
    render();
  }, { dirty: () => !!reason.value.trim() });
}

async function restoreFromTrash(o) {
  const { data, error } = await sb.rpc("cdf_order_restore", { p_id: o.id });
  if (error) { toast(trashError(error), { type: "error", ms: 7000 }); return false; }
  if (data) upsertLocal(data);
  invalidateStats();
  toast(t("trashRestored", { num: o.num }));
  loadOrders();
  return true;
}

// The owner only: asks why, says what stays (the log, and the files in storage) and what goes
function purgeDialog(o, after) {
  const reason = el("textarea", { rows: 2, maxlength: 500, placeholder: t("trashReasonPh") });
  miniSheet(t("purgeTitle", { num: o.num }), [
    el("p", { class: "err", style: "margin:0" }, icon("alert"), " " + t("purgeWarn")),
    el("p", { class: "note", style: "margin:0" }, t("purgeKeeps")),
    reqField(t("trashReason"), reason)], t("purgeDo"), async () => {
    if (reason.value.trim().length < 3) { reason.closest(".field").classList.add("invalid"); reason.focus(); return t("trashReasonShort"); }
    const { error } = await sb.rpc("cdf_order_purge", { p_id: o.id, p_reason: reason.value.trim() });
    if (error) return trashError(error);
    await closeSheet(true);
    toast(t("purgedOne", { num: o.num }));
    after?.();
  }, { dirty: () => !!reason.value.trim() });
}

async function openTrash() {
  if (!isAdmin() || !S.cap.trash) return;
  const { data, error } = await sb.from("cdf_orders").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false });
  if (error) { toast(t("loadFail"), { type: "error" }); return; }
  const list = (data || []).filter((o) => o.deleted_at);
  const row = (o) => {
    const left = daysLeft(o), canRestore = left > 0 || S.cap.owner;
    return el("li", { class: "trash-item", "data-id": o.id },
      el("div", { class: "trash-top" }, el("b", {}, "#" + o.num), el("span", { class: "tag " + (isPickup(o) ? "pickup" : "delivery") }, icon(isPickup(o) ? "box" : "truck"), t(isPickup(o) ? "modePickup" : "modeDelivery")),
        el("span", {}, o.customer_name || o.buyer_name || t("noName")), el("span", { class: "spacer" }), el("small", { class: "note" }, shortDate(o.date) + " · " + o.slot)),
      el("p", { class: "note" }, t("trashBy", { who: memberName(o.deleted_by), when: new Date(o.deleted_at).toLocaleString(locale(), { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) }),
        " · ", el("i", {}, o.delete_reason)),
      el("p", { class: "note trash-left" + (left > 0 ? "" : " over") }, left > 0 ? t("trashDaysLeft", { n: left }) : t("trashExpiredShort")),
      el("div", { class: "btn-row" },
        canRestore ? el("button", { class: "btn", type: "button", onclick: async (e) => { e.currentTarget.disabled = true; if (await restoreFromTrash(o)) { await closeSheet(true); openTrash(); } else e.currentTarget.disabled = false; } }, icon("refresh"), " " + t("trashRestore")) : null,
        S.cap.owner ? el("button", { class: "btn danger", type: "button", onclick: async () => { await closeSheet(true); purgeDialog(o, openTrash); } }, icon("trash"), " " + t("purgeDo")) : null));
  };
  const node = el("div", { class: "sheet trash-sheet", role: "dialog", "aria-modal": "true" },
    el("div", { class: "sheet-head" }, el("h2", {}, t("trashTitleList")), el("span", { class: "tag muted" }, String(list.length)), el("span", { class: "spacer" }), closeBtn()),
    el("div", { class: "sheet-body" },
      el("p", { class: "note" }, t("trashListHint", { days: TRASH_DAYS }), " ", S.cap.owner ? t("trashOwnerYou") : t("trashOwnerOther")),
      list.length ? el("ul", { class: "trash-list" }, list.map(row)) : el("div", { class: "empty" }, icon("trash"), el("p", {}, t("trashEmpty")))));
  openLayer(node);
}
