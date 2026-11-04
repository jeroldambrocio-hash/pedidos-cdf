// Team (admin only): who has access and with which role. Accounts are created by the cdf-users function.

// Completed orders per florist: weekly/monthly/total come from the server (whole history, archived included),
// today's count from the orders already loaded. Florists only get their own numbers.
let memberStats = null, memberStatsAt = 0, memberStatsBusy = false;
function refreshMemberStats(after) {
  if (memberStatsBusy || Date.now() - memberStatsAt < 60000) return;
  memberStatsBusy = true;
  sb.rpc("cdf_member_stats").then(({ data, error }) => {
    if (!error && Array.isArray(data)) memberStats = new Map(data.map((r) => [r.email, r]));
    memberStatsAt = Date.now(); memberStatsBusy = false; after();
  }, () => { memberStatsAt = Date.now(); memberStatsBusy = false; });
}
function doneLine(email) {
  if (!memberStats) return null;
  const r = memberStats.get(email) || {};
  const today = S.orders.filter((o) => o.vendor_email === email && o.date === S.today && o.delivery === "Delivered").length;
  return el("span", { class: "done-stats" }, el("span", { class: "done-h" }, t("doneTitle") + ":"),
    ...[["doneToday", today], ["doneWeek", r.done_week], ["doneMonth", r.done_month], ["doneTotal", r.done_total]]
      .map(([k, n]) => el("span", {}, el("b", {}, String(+n || 0)), " " + t(k))));
}

function renderTeam() {
  refreshMemberStats(() => { if (S.tab === "team") renderTeam(); });
  const box = $("team"); box.replaceChildren();
  const open = S.orders.filter((o) => stepOf(o) !== 3);
  for (const m of S.members) {
    const self = m.email === S.me.email;
    const load = m.role === "carrier" ? open.filter((o) => o.carrier_email === m.email).length : open.filter((o) => o.vendor_email === m.email).length;
    box.append(el("div", { class: "member" },
      el("span", { class: "avatar", "aria-hidden": "true" }, m.name.trim().charAt(0).toUpperCase()),
      el("div", {}, el("b", {}, m.name), el("small", {}, m.email),
        m.role === "vendor" || m.role === "carrier" ? el("small", { class: "load" }, t("openLoad", { n: load })) : null,
        m.role === "vendor" ? doneLine(m.email) : null),
      el("span", { class: "role-tag role-" + m.role }, t("role_" + m.role)),
      self ? el("span", { class: "hint" }, t("you")) : el("button", { class: "btn danger", type: "button", onclick: async (e) => {
        const b = e.currentTarget;
        if (!(await askConfirm(t("removeAsk", { name: m.name }), t("remove"), { danger: true, detail: t("removeHint") }))) return;
        b.disabled = true;
        const { data, error } = await sb.functions.invoke("cdf-users", { body: { action: "remove", email: m.email } });
        if (error || data?.error) { b.disabled = false; toast(data?.error || t("removeFail"), { type: "error" }); return; }
        toast(t("removed", { name: m.name })); await loadMembers(); renderTeam();
      } }, t("remove"))));
  }
  stagger(box);
}
$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault(); $("aErr").textContent = ""; $("aBtn").disabled = true;
  const body = { action: "add", name: $("aName").value.trim(), email: $("aEmail").value.trim(), role: $("aRole").value, password: $("aPass").value };
  const { data, error } = await sb.functions.invoke("cdf-users", { body });
  $("aBtn").disabled = false;
  let msg = data?.error;
  if (error && !msg) { try { msg = (await error.context.json()).error; } catch { msg = t("addFail"); } }
  if (msg) { $("aErr").textContent = msg; return; }
  toast(t(data.existed ? "addedExisting" : "added", { name: body.name }));
  e.target.reset(); await loadMembers(); renderTeam();
});
