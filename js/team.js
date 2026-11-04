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

// Edit a member's name and role (admins only; RLS allows it). Your own role can't be changed here,
// so an admin can't lock themselves out. The email is the login, so it stays as it is.
function editMember(m) {
  const self = m.email === S.me.email;
  const back = document.activeElement, scrim = el("div", { class: "scrim center-scrim" });
  const iName = el("input", { id: "eName", value: m.name, autocomplete: "off", required: true, maxlength: 80 });
  const iRole = el("select", { id: "eRole", disabled: self }, ...["vendor", "carrier", "admin", ...(["vendor", "carrier", "admin"].includes(m.role) ? [] : [m.role])].map((r) => el("option", { value: r, selected: r === m.role }, t("role_" + r))));
  // Availability: florists only; the admin can set anyone's (the server checks it too)
  const avail = S.cap.profiles && m.role === "vendor" ? availabilityFields(m) : null;
  const err = el("div", { class: "err", role: "alert" });
  const close = async () => { if (!scrim.isConnected) return; scrim.classList.add("leaving"); if (!prefersReducedMotion()) await wait(140); scrim.remove(); back?.focus?.(); };
  const save = el("button", { class: "btn primary", type: "submit" }, t("save"));
  const form = el("form", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "eTitle", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    const name = iName.value.trim(), role = self ? m.role : iRole.value;
    if (!name) { err.textContent = t("fillRequired"); iName.focus(); return; }
    const bad = avail?.check(); if (bad) { err.textContent = bad; return; }
    const basics = name !== m.name || role !== m.role, away = !!avail?.changed();
    if (!basics && !away) { close(); return; }
    save.disabled = true;
    try {
      if (basics) { const { error } = await sb.from("cdf_members").update({ name, role }).eq("email", m.email); if (error) throw new Error(t("editFail")); }
      if (away) await saveAvailability(m.email, avail.value());
    } catch (x) { save.disabled = false; err.textContent = x.message; return; }
    save.disabled = false;
    await close(); toast(t("memberSaved", { name })); await loadMembers();
    if (self) { Object.assign(S.me, S.members.find((x) => x.email === m.email) || {}); renderSub(); }
    renderTeam(); render(); refreshAwayConflicts(true);
  } },
    el("div", { class: "sheet-body" },
      el("h2", { id: "eTitle", class: "dialog-text" }, t("editMember")),
      el("label", { class: "field" }, el("span", {}, t("name")), iName),
      el("label", { class: "field" }, el("span", {}, t("role")), iRole),
      el("div", { class: "hint" }, self ? t("ownRoleHint") : m.email),
      avail ? el("h3", { class: "grp" }, t("availability")) : null, avail?.node,
      err),
    el("div", { class: "sheet-foot" }, el("button", { class: "btn", type: "button", onclick: close }, t("cancel")), save));
  scrim.append(form);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  scrim.addEventListener("dismiss", close);
  $("dialogRoot").append(scrim);
  queueMicrotask(() => { iName.focus(); iName.select(); });
}

function renderTeam() {
  refreshMemberStats(() => { if (S.tab === "team") renderTeam(); });
  const box = $("team"); box.replaceChildren();
  const open = S.orders.filter((o) => stepOf(o) !== 3);
  for (const m of S.members) {
    const self = m.email === S.me.email;
    const load = m.role === "carrier" ? open.filter((o) => o.carrier_email === m.email).length : open.filter((o) => o.vendor_email === m.email).length;
    const florist = m.role === "vendor";
    box.append(el("div", { class: "member" + (florist && S.cap.profiles && awayState(m) === "away" ? " is-away" : "") },
      avatarNode(m),
      el("div", {}, el("b", {}, m.name), el("small", {}, m.email),
        m.phone ? el("a", { class: "m-phone", href: "tel:+" + m.phone }, icon("phone"), "+" + m.phone) : null,
        florist && S.cap.profiles ? awayBadge(m) : null,
        m.role === "vendor" || m.role === "carrier" ? el("small", { class: "load" }, t("openLoad", { n: load })) : null,
        m.role === "vendor" ? doneLine(m.email) : null),
      el("span", { class: "role-tag role-" + m.role }, t("role_" + m.role)),
      el("div", { class: "m-acts" },
      el("button", { class: "btn", type: "button", "aria-label": t("editMember") + ": " + m.name, onclick: () => editMember(m) }, t("edit")),
      self ? el("span", { class: "hint" }, t("you")) : el("button", { class: "btn danger", type: "button", onclick: async (e) => {
        const b = e.currentTarget;
        if (!(await askConfirm(t("removeAsk", { name: m.name }), t("remove"), { danger: true, detail: t("removeHint") }))) return;
        b.disabled = true;
        const { data, error } = await sb.functions.invoke("cdf-users", { body: { action: "remove", email: m.email } });
        if (error || data?.error) { b.disabled = false; toast(data?.error || t("removeFail"), { type: "error" }); return; }
        toast(t("removed", { name: m.name })); await loadMembers(); renderTeam();
      } }, t("remove")))));
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
