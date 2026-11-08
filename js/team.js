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
// so an admin can't lock themselves out. Email stays unchanged; the optional username can be assigned by an admin.
function editMember(m) {
  const self = m.email === S.me.email;
  const back = document.activeElement, scrim = el("div", { class: "scrim center-scrim" });
  const iName = el("input", { id: "eName", value: m.name, autocomplete: "off", required: true, maxlength: 80 });
  const iUsername = el("input", { id: "eUsername", value: m.username || "", autocomplete: "off", autocapitalize: "none", spellcheck: "false", pattern: "[A-Za-z0-9][A-Za-z0-9._\\-]{2,29}", minlength: 3, maxlength: 30 });
  const iRole = el("select", { id: "eRole", disabled: self }, ...["vendor", ...(feature("drivers") || m.role === "carrier" ? ["carrier"] : []), "admin", ...(["vendor", "carrier", "admin"].includes(m.role) ? [] : [m.role])].map((r) => el("option", { value: r, selected: r === m.role }, t("role_" + r))));
  // Availability: florists only; the admin can set anyone's (the server checks it too)
  const avail = S.cap.profiles && m.role === "vendor" ? availabilityFields(m) : null;
  const err = el("div", { class: "err", role: "alert" });
  const close = async () => { if (!scrim.isConnected) return; scrim.classList.add("leaving"); if (!prefersReducedMotion()) await wait(330); scrim.remove(); back?.focus?.(); };
  const save = el("button", { class: "btn primary", type: "submit" }, t("save"));
  const form = el("form", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "eTitle", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    const name = iName.value.trim(), role = self ? m.role : iRole.value;
    if (!name) { err.textContent = t("fillRequired"); iName.focus(); return; }
    const bad = avail?.check(); if (bad) { err.textContent = bad; return; }
    const username = iUsername.value.trim().toLowerCase() || null;
    const basics = name !== m.name || role !== m.role || username !== (m.username || null), away = !!avail?.changed();
    if (!basics && !away) { close(); return; }
    save.disabled = true;
    try {
      if (basics) { const { error } = await sb.from("cdf_members").update({ name, role, username }).eq("email", m.email); if (error) throw new Error(t(error.code === "23505" ? "usernameTaken" : "editFail")); }
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
      field(t("username"), iUsername), el("p", { class: "hint" }, t("usernameHint")),
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

// The member's Bloom Journey stage next to their name (office view; florists and drivers only)
function bloomTag(m) {
  const kind = bloomKind(m.role); if (!kind || !memberStats) return null;
  const total = bloomTotal(memberStats.get(m.email), kind), s = BLOOM_STAGES[bloomStage(total)];
  return el("span", { class: "bloom-tag", title: s.name + " · " + total }, s.icon + " " + s.name);
}
function renderTeam() {
  refreshMemberStats(() => { if (S.tab === "team") renderTeam(); });
  const box = $("team"); box.replaceChildren();
  const open = S.orders.filter(isOpen);
  for (const m of S.members) {
    const phone = intlPhone(m.phone);
    const self = m.email === S.me.email;
    const load = m.role === "carrier" ? open.filter((o) => o.carrier_email === m.email).length : open.filter((o) => o.vendor_email === m.email).length;
    const florist = m.role === "vendor";
    box.append(el("div", { class: "member" + (florist && S.cap.profiles && awayState(m) === "away" ? " is-away" : "") },
      employeeProfileButton(m, avatarNode(m), "profile-avatar"),
      el("div", {}, el("b", {}, employeeProfileButton(m, m.name, "profile-name"), bloomTag(m)), el("small", {}, m.email), m.username ? el("small", {}, "@" + m.username) : null,
        phone ? el("a", { class: "m-phone", href: "tel:+" + phone }, icon("phone"), "+" + phone) : null,
        florist && S.cap.profiles ? awayBadge(m) : null,
        m.role === "vendor" || m.role === "carrier" ? el("small", { class: "load" }, t("openLoad", { n: load })) : null,
        m.role === "vendor" ? doneLine(m.email) : null),
      el("span", { class: "role-tag role-" + m.role }, t("role_" + m.role)),
      el("div", { class: "m-acts" },
      CH.directOn && !self ? el("button", { class: "btn", type: "button", onclick: (e) => openDirect(m.email, e.currentTarget) }, t("chatDirect")) : null,
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
  const body = { action: "add", username: $("aUsername").value.trim().toLowerCase(), name: $("aName").value.trim(), email: $("aEmail").value.trim(), role: $("aRole").value, password: $("aPass").value };
  const { data, error } = await sb.functions.invoke("cdf-users", { body });
  $("aBtn").disabled = false;
  let msg = data?.error;
  if (error && !msg) { try { msg = (await error.context.json()).error; } catch { msg = t("addFail"); } }
  if (msg) { $("aErr").textContent = msg; return; }
  toast(t(data.existed ? "addedExisting" : "added", { name: body.name }));
  e.target.reset(); await loadMembers(); renderTeam();
});

// Drivers switched off (config.js): new accounts can't be drivers
if (!feature("drivers")) $("aRole")?.querySelector('option[value="carrier"]')?.remove();
