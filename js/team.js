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
  // Branch of the shop this person works for (any role; shown on the profile and in Team)
  const iBranch = S.cap.branch ? el("input", { id: "eBranch", value: m.branch || "", maxlength: 60, autocomplete: "off", placeholder: t("branchPh") }) : null;
  // Lalamove: where riders pick up this florist's orders (her shop)
  const pick = S.cap.pickup && m.role === "vendor" ? {
    addr: el("input", { id: "ePickAddr", value: m.pickup_address || "", maxlength: 300, autocomplete: "off", placeholder: t("pickupAddrPh") }),
    point: el("input", { id: "ePickPoint", value: m.pickup_lat != null ? `${+m.pickup_lat}, ${+m.pickup_lng}` : "", autocomplete: "off", inputmode: "url", placeholder: t("pickupPointPh") }),
  } : null;
  // A short share link (maps.app.goo.gl): the server opens it and the field shows the point it leads to
  pick?.point.addEventListener("change", async () => {
    const v = pick.point.value.trim();
    if (!v || llParseCoords(v) || !/goo\.gl\//i.test(v)) return;
    try { const r = (await llCall({ action: "geocode", query: v })).results?.[0]; if (r) pick.point.value = `${r.lat}, ${r.lng}`; } catch {}
  });
  const pickMap = pick ? el("button", { class: "linkish", type: "button", id: "ePickMap", onclick: async () => {
    const p = await llPickOnMap(llParseCoords(pick.point.value), pick.addr.value.trim());
    if (p) pick.point.value = `${p.lat}, ${p.lng}`;
  } }, icon("map"), " " + t("mapPickBtn")) : null;
  const err = el("div", { class: "err", role: "alert" });
  const close = async () => { if (!scrim.isConnected) return; scrim.classList.add("leaving"); if (!prefersReducedMotion()) await wait(330); scrim.remove(); back?.focus?.(); };
  const save = el("button", { class: "btn primary", type: "submit" }, t("save"));
  const form = el("form", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "eTitle", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    const name = iName.value.trim(), role = self ? m.role : iRole.value;
    if (!name) { err.textContent = t("fillRequired"); iName.focus(); return; }
    const bad = avail?.check(); if (bad) { err.textContent = bad; return; }
    const username = iUsername.value.trim().toLowerCase() || null;
    let pickup = null;
    if (pick) {
      const addr = pick.addr.value.trim() || null, raw = pick.point.value.trim();
      const pt = raw ? llParseCoords(raw) : null;
      if (raw && !pt) { err.textContent = t("pickupPointBad"); pick.point.focus(); return; }
      if (!!addr !== !!pt) { err.textContent = t("pickupBoth"); (addr ? pick.point : pick.addr).focus(); return; }
      if (addr !== (m.pickup_address || null) || (pt?.lat ?? null) !== (m.pickup_lat == null ? null : +m.pickup_lat) || (pt?.lng ?? null) !== (m.pickup_lng == null ? null : +m.pickup_lng))
        pickup = { pickup_address: addr, pickup_lat: pt?.lat ?? null, pickup_lng: pt?.lng ?? null };
    }
    const branch = iBranch ? iBranch.value.trim() || null : m.branch ?? null, branchChanged = !!iBranch && branch !== (m.branch || null);
    const basics = name !== m.name || role !== m.role || username !== (m.username || null) || !!pickup || branchChanged, away = !!avail?.changed();
    if (!basics && !away) { close(); return; }
    save.disabled = true;
    try {
      if (basics) { const { error } = await sb.from("cdf_members").update({ name, role, username, ...(pickup || {}), ...(branchChanged ? { branch } : {}) }).eq("email", m.email); if (error) throw new Error(t(error.code === "23505" ? "usernameTaken" : "editFail")); }
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
      iBranch ? field(t("branch"), iBranch) : null,
      el("div", { class: "hint" }, self ? t("ownRoleHint") : m.email),
      avail ? el("h3", { class: "grp" }, t("availability")) : null, avail?.node,
      pick ? el("h3", { class: "grp" }, t("pickupTitle")) : null,
      pick ? field(t("pickupAddr"), pick.addr) : null,
      pick ? field(t("pickupPoint"), pick.point, el("small", { class: "note" }, t("pickupPointHint"))) : null,
      pickMap,
      pick && !m.phone ? el("p", { class: "hint" }, t("pickupNoPhone")) : null,
      err),
    el("div", { class: "sheet-foot" }, el("button", { class: "btn", type: "button", onclick: close }, t("cancel")), save));
  scrim.append(form);
  closeOnBackdrop(scrim, () => close());
  scrim.addEventListener("dismiss", close);
  $("dialogRoot").append(scrim);
  queueMicrotask(() => { iName.focus(); iName.select(); });
}

// "Casa de Flores · Parañaque" under the name, when the person has a branch
function branchLine(m, cls = "branch") {
  return m?.branch ? el("small", { class: cls }, icon("flower"), t("branchOf", { b: m.branch })) : null;
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
      el("div", {}, el("b", {}, employeeProfileButton(m, m.name, "profile-name"), bloomTag(m)), branchLine(m), el("small", {}, m.email), m.username ? el("small", {}, "@" + m.username) : null,
        phone ? el("a", { class: "m-phone", href: "tel:+" + phone }, icon("phone"), phoneNice(phone)) : null,
        florist && S.cap.profiles ? awayBadge(m) : null,
        m.role === "vendor" || m.role === "carrier" ? el("small", { class: "load" }, t("openLoad", { n: load })) : null,
        m.role === "vendor" ? doneLine(m.email) : null,
        // Phase 4: a florist without a shop location or branch never appears in the nearest-shop suggestion
        florist && S.cap.ranking && (m.pickup_lat == null || !(m.branch || "").trim())
          ? el("small", { class: "shop-gap" }, icon("alert"), t("shopGapTeam", { what: [m.pickup_lat == null ? t("shopMiss_point") : null, !(m.branch || "").trim() ? t("shopMiss_branch") : null].filter(Boolean).join(", ") })) : null),
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
  e.preventDefault(); $("aErr").textContent = "";
  const body = { action: "add", username: $("aUsername").value.trim().toLowerCase(), name: $("aName").value.trim(), email: $("aEmail").value.trim(), role: $("aRole").value, password: $("aPass").value };
  // Already in the team: say so here, before anything is sent (the server refuses it too)
  const same = (S.members || []).find((m) => m.email?.toLowerCase() === body.email.toLowerCase());
  if (same) { $("aErr").textContent = t("emailTaken", { name: same.name }); $("aEmail").focus(); return; }
  $("aBtn").disabled = true;
  const { data, error } = await sb.functions.invoke("cdf-users", { body });
  $("aBtn").disabled = false;
  let msg = data?.error;
  if (error && !msg) { try { const b = await error.context.json(); msg = b.code === "email_taken" ? t("emailTaken", { name: b.name }) : b.error; } catch { msg = t("addFail"); } }
  if (msg) { $("aErr").textContent = msg; return; }
  toast(t(data.existed ? "addedExisting" : "added", { name: body.name }));
  e.target.reset(); await loadMembers(); renderTeam();
});

// Drivers switched off (config.js): new accounts can't be drivers
if (!feature("drivers")) $("aRole")?.querySelector('option[value="carrier"]')?.remove();
