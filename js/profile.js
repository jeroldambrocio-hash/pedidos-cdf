// Profiles and availability: photo, display name and phone (each person edits their own), the absence of a
// florist (they set their own; an admin can set anyone's), and the warnings when orders meet an absence.
// Dates are Manila days (S.today). "Until" is the last day away: they are back the day after.
const AVATARS = "cdf-avatars";
const REASONS = ["vacation", "rest", "other"];

// ---------- availability ----------
// Away on a given day (yyyy-mm-dd)
const awayOn = (m, day) => !!(m?.away_from && day >= m.away_from && (!m.away_until || day <= m.away_until));
// "available" | "away" (today) | "upcoming" (an absence that hasn't started yet)
function awayState(m, day = S.today) {
  if (!m?.away_from || (m.away_until && m.away_until < day)) return "available";
  return m.away_from > day ? "upcoming" : "away";
}
const dm = (d) => fromIso(d).toLocaleDateString(locale(), { day: "numeric", month: "short" });
function awayText(m, day = S.today) {
  const st = awayState(m, day);
  if (st === "available") return t("available");
  if (st === "upcoming") return t("awayFrom", { from: dm(m.away_from) }) + (m.away_until ? " – " + dm(m.away_until) : "");
  return m.away_until ? t("awayUntil", { until: dm(m.away_until) }) : t("awayOpen");
}
function awayBadge(m, day = S.today) {
  const st = awayState(m, day);
  return el("span", { class: "avail " + st }, el("span", { class: "dot", "aria-hidden": "true" }), awayText(m, day),
    st !== "available" && m.away_reason ? el("small", {}, " · " + t("reason_" + m.away_reason)) : null);
}

// Florists for orders on `days` (one date or several): available first, then those away, each away one labelled
function vendorChoices(days) {
  const ds = [].concat(days || []).filter(Boolean), list = S.members.filter((m) => m.role === "vendor");
  const hit = (m) => ds.find((d) => awayOn(m, d));
  return list.slice().sort((a, b) => !!hit(a) - !!hit(b) || a.name.localeCompare(b.name))
    .map((m) => { const d = hit(m); return [m.email, m.name + (m.role !== "vendor" ? " (" + t("role_" + m.role) + ")" : "") + (d ? " — " + awayText(m, d).toLowerCase() : ""), !!d]; });
}
// <option>s for a florist <select>, the away ones marked
const vendorOptions = (days, selected) => {
  const choices = vendorChoices(days);
  const options = choices.map(([v, l, away]) => el("option", { value: v, selected: v === selected, class: away ? "is-away" : null }, (away ? "⚠ " : "") + l));
  // Keep an existing assignment intact when editing an old order. It cannot be selected for another order.
  if (selected && !choices.some(([email]) => email === selected)) {
    options.unshift(el("option", { value: selected, selected: true, disabled: true, hidden: true }, memberName(selected)));
  }
  return options;
};
// Ask before giving an order to someone away on its date. Resolves true to go ahead.
async function okToAssign(email, days) {
  const m = S.members.find((x) => x.email === email);
  const hit = m && [...new Set(days)].filter((d) => awayOn(m, d)).sort();
  if (!hit || !hit.length) return true;
  return askConfirm(t("assignAwayAsk", { name: m.name }), t("assignAnyway"), { detail: t("assignAwayDetail", { dates: hit.map(dm).join(", "), until: m.away_until ? dm(m.away_until) : t("noEndDate").toLowerCase() }) });
}

// ---------- photo ----------
// The initial at once, the photo when its signed link arrives (and only if the box still shows that person)
function fillAvatar(box, m) {
  const path = m?.avatar_path || "";
  box.dataset.pic = path;
  box.replaceChildren((m?.name || "?").trim().charAt(0).toUpperCase());
  if (path) photoUrl(path, AVATARS).then((u) => { if (u && box.dataset.pic === path) box.replaceChildren(el("img", { src: u, alt: "" })); });
  return box;
}
const avatarNode = (m, cls = "avatar") => fillAvatar(el("span", { class: cls, "aria-hidden": "true" }), m);
// Square, 256px, JPEG: small and quick to load everywhere
async function avatarBlob(file) {
  const src = await compress(file);
  const img = await createImageBitmap(src);
  const s = Math.min(img.width, img.height), c = document.createElement("canvas"); c.width = c.height = 256;
  c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
}

// ---------- availability form (shared by My account and the admin's edit) ----------
function availabilityFields(m) {
  const st = el("select", { class: "avail-pick", "aria-label": t("availability") },
    el("option", { value: "yes", selected: !m.away_from }, t("available")), el("option", { value: "no", selected: !!m.away_from }, t("unavailable")));
  const from = el("input", { type: "date", value: m.away_from || S.today });
  const until = el("input", { type: "date", value: m.away_until || "", min: m.away_from || S.today });
  const reason = el("select", {}, el("option", { value: "" }, t("reasonNone")), ...REASONS.map((r) => el("option", { value: r, selected: r === m.away_reason }, t("reason_" + r))));
  const state = el("b", {});
  const body = el("div", { class: "absence" },
    el("div", { class: "row2" }, field(t("awayFromLabel"), from), field(t("awayUntilLabel"), until)),
    el("p", { class: "hint" }, t("backNextDay")),
    field(t("reasonLabel"), reason));
  const paint = () => {
    body.hidden = st.value === "yes";
    until.min = from.value || S.today;
    state.textContent = st.value === "yes" ? t("available") : awayText({ away_from: from.value || S.today, away_until: until.value || null });
  };
  [st, from, until].forEach((x) => x.addEventListener("input", paint)); paint();
  const node = el("div", { class: "avail-box" },
    el("div", { class: "status-row" }, el("div", {}, state, el("small", {}, t("visibleToTeam"))), st), body);
  return {
    node,
    value: () => st.value === "yes" ? { from: null, until: null, reason: null } : { from: from.value || S.today, until: until.value || null, reason: reason.value || null },
    check: () => st.value === "no" && until.value && from.value && until.value < from.value ? t("endBeforeStart") : "",
    changed: () => { const v = st.value === "yes" ? [null, null, null] : [from.value || S.today, until.value || null, reason.value || null]; return v.join() !== [m.away_from || null, m.away_until || null, m.away_reason || null].join(); },
  };
}
async function saveAvailability(email, v) {
  const { data, error } = await sb.rpc("cdf_set_availability", { p_email: email, p_from: v.from, p_until: v.until, p_reason: v.reason });
  if (error) throw new Error(/end before/.test(error.message) ? t("endBeforeStart") : t("editFail"));
  return data;
}

// ---------- My account ----------
// One request per minute at most: the account card redraws often (menu, language, profile edits).
// invalidateStats() (any order change) resets myStatsAt so the count stays right.
let myStatsP = null, myStatsAt = 0;
function myStats() {
  if (!myStatsP || Date.now() - myStatsAt > 60000) {
    myStatsAt = Date.now();
    const email = S.me.email;
    myStatsP = sb.rpc("cdf_member_stats").then(({ data }) => (data || []).find((r) => r.email === email) || null, () => { myStatsAt = 0; return null; });
  }
  return myStatsP;
}
function openProfile() {
  const me = S.me, florist = me.role === "vendor";
  const gen = sessionNow(), uid = S.uid;
  let photo = null; // a new picture picked but not saved yet
  const av = avatarNode(me, "avatar xl");
  const file = el("input", { type: "file", accept: "image/*", class: "sr-only", id: "pPhoto" });
  file.addEventListener("change", () => {
    const f = file.files[0]; if (!f || !isImage(f)) return;
    photo = f; av.replaceChildren(el("img", { src: URL.createObjectURL(f), alt: "" }));
  });
  const iName = el("input", { id: "pName", value: me.name, required: true, maxlength: 60, autocomplete: "name" });
  const iPhone = el("input", { id: "pPhone", type: "tel", inputmode: "tel", value: phLocal(me.phone), "data-cc": phSplit(me.phone).cc, autocomplete: "tel" });
  // Sign-in username: each person sets their own here; the database keeps it unique.
  const iUser = el("input", { id: "pUsername", value: me.username || "", autocomplete: "off", autocapitalize: "none", spellcheck: "false", pattern: "[A-Za-z0-9][A-Za-z0-9._\\-]{2,29}", minlength: 3, maxlength: 30, placeholder: t("usernamePh") });
  const userNow = () => iUser.value.trim().toLowerCase() || null;
  const done = el("b", {}, "…");
  myStats().then((r) => { done.textContent = t("doneOrders", { n: +r?.done_total || 0 }); });
  const avail = florist ? availabilityFields(me) : null;
  const clash = el("div", { class: "notice", hidden: true });
  if (avail) {
    const check = () => {
      const v = avail.value(), mine = S.orders.filter((o) => o.vendor_email === me.email && o.delivery !== "Delivered" && awayOn({ away_from: v.from, away_until: v.until }, o.date));
      clash.hidden = !mine.length;
      clash.replaceChildren(icon("alert"), el("span", {}, t("myAwayOrders", { n: mine.length })));
    };
    avail.node.addEventListener("input", check); check();
  }
  const nodes = [
    el("div", { class: "identity" }, av,
      el("div", {}, el("b", {}, me.name), el("small", {}, t("role_" + me.role) + (me.branch ? " · " + t("branchOf", { b: me.branch }) : ""))),
      el("label", { class: "btn pic-btn", for: "pPhoto" }, icon("camera"), t("changePhoto")), file),
    el("div", { class: "completed" }, icon("check"), el("span", {}, done, el("small", {}, t("doneSince")))),
    el("h3", { class: "grp" }, t("personalData")),
    field(t("displayName"), iName),
    field(t("username"), iUser), el("p", { class: "hint" }, t("usernameHint")),
    field(t("phone"), phoneBox(iPhone)),
    field(t("email"), el("input", { type: "email", value: me.email, readonly: true, tabindex: -1, class: "ro" })),
    el("p", { class: "hint" }, t("emailIsLogin")),
    ...(avail ? [el("h3", { class: "grp" }, t("availability")), avail.node, clash] : []),
  ];
  const dirtyStart = () => iName.value.trim() !== me.name || userNow() !== (me.username || null) || phFull(iPhone) !== (me.phone || "") || !!photo || (avail && avail.changed());
  miniSheet(t("myAccount"), nodes, t("saveChanges"), async () => {
    if (stale(gen)) return;
    const name = iName.value.trim();
    if (!name) { iName.closest(".field").classList.add("invalid"); return t("fillRequired"); }
    const phone = phFull(iPhone);
    if (phone && !phoneOk(phone)) { iPhone.closest(".field").classList.add("invalid"); return t("phoneInvalid"); }
    const username = userNow(), userField = iUser.closest(".field");
    userField.classList.remove("invalid");
    if (username && !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) { userField.classList.add("invalid"); return t("usernameHint"); }
    const bad = avail?.check(); if (bad) return bad;
    // Username first: "already taken" is the likeliest refusal, so nothing else is saved before it.
    if (username !== (me.username || null)) {
      const { data, error } = await sb.rpc("cdf_set_my_username", { p_username: username });
      if (stale(gen)) return;
      if (error) { userField.classList.add("invalid"); return t(error.code === "23505" ? "usernameTaken" : "editFail"); }
      Object.assign(S.me, data);
    }
    const oldPath = me.avatar_path || null;
    let path = oldPath;
    if (photo) {
      const blob = await avatarBlob(photo), next = uid + "/avatar-" + crypto.randomUUID() + ".jpg";
      if (stale(gen)) return;
      const up = await sb.storage.from(AVATARS).upload(next, blob, { contentType: "image/jpeg" });
      if (stale(gen)) return;
      if (up.error) return t("photoUploadFail");
      path = next;
    }
    const { data, error } = await sb.rpc("cdf_save_profile", { p_name: name, p_phone: phone, p_avatar: path });
    if (stale(gen)) return;
    if (error || !data) return t("editFail");
    Object.assign(S.me, data);
    // The old image remains valid until the database confirms the replacement. On an ambiguous failure
    // keep both files: deleting a possibly referenced image is worse than an unreferenced upload.
    if (oldPath && oldPath !== path && data.avatar_path === path) {
      await sb.storage.from(AVATARS).remove([oldPath]).catch(() => {});
      if (stale(gen)) return;
    }
    if (avail?.changed()) {
      const saved = await saveAvailability(me.email, avail.value());
      if (stale(gen)) return;
      Object.assign(S.me, saved);
    }
    await closeSheet(true);
    if (stale(gen)) return;
    toast(t("profileSaved"));
    renderSub(); if (isStaff()) { await loadMembers(); } if (stale(gen)) return; render(); refreshAwayConflicts();
  }, { dirty: dirtyStart });
}

// Without a photo, the profile card shows a smiling pink flower on a soft green circle
const FLOWER_AVATAR = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <path d="M24 30c0 6-1 11-3 16" fill="none" stroke="#5f7d5a" stroke-width="2" stroke-linecap="round"/>
  <path d="M22.5 38c-4-5-10-6-14-4 3 5 9 7 14 4Z" fill="#86a37f" stroke="#4f6b4b" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M23.5 36c4-5 10-6 14.5-4-3 5-9.5 7-14.5 4Z" fill="#86a37f" stroke="#4f6b4b" stroke-width="1.2" stroke-linejoin="round"/>
  <g fill="#f4a9b6" stroke="#c4627a" stroke-width="1.2"><circle cx="24" cy="10.5" r="7"/><circle cx="32.6" cy="16.8" r="7"/><circle cx="29.3" cy="26.9" r="7"/><circle cx="18.7" cy="26.9" r="7"/><circle cx="15.4" cy="16.8" r="7"/></g>
  <circle cx="24" cy="19.5" r="7.6" fill="#f4a9b6"/>
  <circle cx="20.6" cy="22" r="1.5" fill="#ee8ea0" opacity=".7"/><circle cx="27.4" cy="22" r="1.5" fill="#ee8ea0" opacity=".7"/>
  <ellipse cx="21.6" cy="18.6" rx="1.1" ry="1.4" fill="#4a2f35"/><ellipse cx="26.4" cy="18.6" rx="1.1" ry="1.4" fill="#4a2f35"/>
  <path d="M22.2 21.8q1.8 1.6 3.6 0" fill="none" stroke="#4a2f35" stroke-width="1.1" stroke-linecap="round"/>
</svg>`;
function profilePic(me) {
  if (me.avatar_path) return avatarNode(me, "avatar lg");
  const pic = el("span", { class: "avatar lg flower", "aria-hidden": "true" });
  pic.innerHTML = FLOWER_AVATAR;
  return pic;
}

// The "My account" view of the profile menu, like a profile card: picture with a green "online" dot,
// name, "My flower shop", a gear to edit the profile, availability for florists, and the orders delivered
function renderMyCard() {
  const box = $("menuProfile"); if (!box) return;
  const me = S.me; if (!me) { box.replaceChildren(); return; }
  const done = el("span", {}, "…");
  // My Bloom Journey (florists and drivers): the stage icon next to the name and an entry that opens the plant
  const kind = bloomKind(me.role), nameIc = el("span", { class: "bloom-ic", "aria-hidden": "true" });
  const bloomBtn = kind && S.cap.profiles ? el("button", { class: "my-bloom", type: "button", onclick: () => openBloom() },
    el("span", { class: "mb-ic", "aria-hidden": "true" }, "…"), el("span", { class: "mb-main" }, el("b", {}, bloomT("title")), el("small", {}, "…"), el("span", { class: "mb-bar" }, el("i")))) : null;
  if (S.cap.profiles) myStats().then((r) => {
    done.textContent = t("doneOrders", { n: +r?.done_total || 0 });
    if (!kind) return;
    const total = bloomTotal(r, kind), stage = bloomStage(total), next = BLOOM_STAGES[stage + 1];
    nameIc.textContent = BLOOM_STAGES[stage].icon; nameIc.title = BLOOM_STAGES[stage].name;
    if (bloomBtn) {
      bloomBtn.querySelector(".mb-ic").textContent = BLOOM_STAGES[stage].icon;
      bloomBtn.querySelector("small").textContent = BLOOM_STAGES[stage].name + " · " + (next ? bloomT("next", { n: next.min - total, stage: next.name }) : bloomT("max"));
      bloomBtn.querySelector(".mb-bar i").style.setProperty("--p", Math.min(total, BLOOM_MAX) / BLOOM_MAX);
    }
  });
  box.replaceChildren(...[
    el("div", { class: "my-id" },
      el("span", { class: "my-pic" }, profilePic(me), el("i", { class: "online", title: t("online") })),
      el("div", { class: "my-names" }, el("b", {}, me.name, kind ? nameIc : null), el("small", {}, me.branch ? t("branchOf", { b: me.branch }) : t("myShop"))),
      S.cap.profiles ? el("button", { class: "my-gear", id: "editProfileBtn", type: "button", "aria-label": t("editProfile"), title: t("editProfile"), onclick: () => openProfile() }, icon("gear")) : null),
    S.cap.profiles && me.role === "vendor" ? el("div", { class: "my-avail" }, awayBadge(me)) : null,
    S.cap.profiles ? el("div", { class: "my-done" }, icon("bouquet"), done) : null, bloomBtn].filter(Boolean)); // DOM replaceChildren would print "null"
}

// ---------- the office: pending orders that fall inside an absence ----------
let awayConflicts = [], awayAt = 0;
async function refreshAwayConflicts(force) {
  if (!isStaff() || !S.cap.profiles) { awayConflicts = []; paintAwayBanner(); return; }
  if (!force && Date.now() - awayAt < 30000) { paintAwayBanner(); return; }
  awayAt = Date.now();
  const gen = sessionNow();
  const { data, error } = await sb.rpc("cdf_away_conflicts");
  if (stale(gen)) return;
  awayConflicts = error ? [] : data || [];
  paintAwayBanner();
}
// Only a change that can add or remove a conflict asks the server again
function awayTouched(row) {
  if (row && (awayConflicts.some((c) => c.id === row.id) || S.members.some((m) => m.email === row.vendor_email && m.away_from))) awayAt = 0;
}
function paintAwayBanner() {
  const box = $("awayBanner"); if (!box) return;
  box.hidden = !awayConflicts.length || S.tab !== "orders";
  if (box.hidden) return;
  const by = new Map();
  for (const c of awayConflicts) (by.get(c.vendor_email) || by.set(c.vendor_email, []).get(c.vendor_email)).push(c);
  box.replaceChildren(icon("alert"), el("div", {},
    el("b", {}, t("awayConflicts", { n: awayConflicts.length })),
    ...[...by].map(([email, list]) => el("div", { class: "away-row" },
      el("span", {}, memberName(email) + " · " + awayText({ away_from: list[0].away_from, away_until: list[0].away_until }, list[0].date).toLowerCase() + ": "),
      ...list.map((c) => el("button", { class: "linkish", type: "button", onclick: () => openConflict(c) }, "#" + c.num + " · " + dm(c.date)))))));
}
async function openConflict(c) {
  let o = S.orders.find((x) => x.id === c.id);
  const gen = sessionNow();
  if (!o) { const { data } = await sb.from("cdf_orders").select("*").eq("id", c.id).maybeSingle(); if (stale(gen)) return; o = data; }
  if (o) openOrder(o);
}

// The compact My Bloom Journey page, in a side sheet. Only real numbers from the database; no simulation here.
async function openBloom() {
  const kind = bloomKind(S.me?.role); if (!kind) return;
  const journey = bloomJourney(kind, 0);
  const node = el("div", { class: "sheet bloom-sheet", role: "dialog", "aria-modal": "true", "aria-label": bloomT("title") },
    el("div", { class: "sheet-head" }, el("h2", {}, bloomT("title")), el("span", { class: "spacer" }), closeBtn()),
    el("div", { class: "sheet-body" }, el("p", { class: "bloom-sub" }, bloomT("sub")), journey.node));
  openLayer(node);
  const r = await myStats();
  journey.update(bloomTotal(r, kind));
}

function employeeProfileButton(member, content, className) {
  return el("button", {
    type: "button", class: "profile-trigger " + className, "aria-haspopup": "dialog",
    "aria-label": t("viewProfile") + " · " + member.name,
    onclick: (event) => showEmployeeProfile(member, event.currentTarget),
  }, content);
}

async function showEmployeeProfile(member, trigger) {
  if (!S.me || !member || document.querySelector(".employee-profile[open]")) return;
  const viewer = S.me;
  const self = member.email === viewer.email;
  if (!self && !isAdmin()) return;
  if (self) member = viewer;

  const menu = openMenu();
  if (menu) setMenu(menu, false);
  const back = menu?.contains(trigger) ? menuOpener(menu) : trigger;
  const phone = intlPhone(member.phone);
  const close = el("button", { class: "btn ghost profile-close", type: "button",
    "aria-label": t("close"), autofocus: true, onclick: () => dialog.close() }, "×");
  const stats = el("div", { class: "employee-stats", "aria-live": "polite" }, t("loading"));
  const dialog = el("dialog", { class: "employee-profile", "aria-labelledby": "employeeProfileTitle" },
    el("header", { class: "employee-header" }, profilePic(member),
      el("div", {},
        el("h2", { id: "employeeProfileTitle" }, member.name),
        el("span", { class: "role-tag role-" + member.role }, t("role_" + member.role)),
        member.username ? el("span", { class: "employee-handle" }, "@" + member.username) : null,
        branchLine(member, "branch employee-branch")),
      close),
    el("div", { class: "employee-contact" },
      el("span", {}, member.email),
      phone ? el("a", { class: "phone-link", href: "tel:+" + phone }, phoneNice(phone)) : null,
      member.role === "vendor" && S.cap.profiles ? awayBadge(member) : null),
    stats);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Tab") event.stopPropagation();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    (back?.isConnected ? back : $(self ? "userProfileBtn" : "tabTeam")).focus();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();

  let row;
  try {
    const { data } = await sb.rpc("cdf_member_stats");
    row = data?.find((entry) => entry.email === member.email);
  } catch {
    // Profile details are still usable when the statistics request fails.
  }
  if (!dialog.open) return;
  if (S.me !== viewer) { dialog.close(); return; }
  if (!row) { stats.textContent = t("profileStatsUnavailable"); return; }

  const kind = bloomKind(member.role);
  const total = kind ? bloomTotal(row, kind) : 0;
  const level = bloomStage(total);
  const stage = BLOOM_STAGES[level];
  const next = BLOOM_STAGES[level + 1];
  const format = new Intl.NumberFormat(LANG);
  const plant = el("div", { class: "employee-plant", "aria-hidden": "true" });
  if (kind) plant.innerHTML = bloomPlant(level);
  const growth = kind ? el("section", { class: "employee-growth" },
    plant,
    el("div", {},
      el("small", {}, bloomT("level", { n: level + 1, of: BLOOM_STAGES.length })),
      el("h3", {}, stage.name),
      el("progress", { max: BLOOM_MAX, value: Math.min(total, BLOOM_MAX), "aria-label": bloomT("progress") }),
      el("small", {}, next ? bloomT("next", { n: next.min - total, stage: next.name }) : bloomT("max")),
      el("small", {}, format.format(total) + " " + bloomT(kind)))) : null;
  const metrics = [["doneWeek", row.done_week], ["doneMonth", row.done_month],
    ["doneTotal", row.done_total], ["openOrders", row.open_now]].filter(([, value]) => value != null);
  stats.replaceChildren(...[growth, metrics.length ? el("section", {},
    el("h3", {}, t("tabOrders")),
    el("dl", { class: "employee-metrics" }, ...metrics.map(([label, value]) =>
      el("div", {}, el("dt", {}, t(label)), el("dd", {}, format.format(value)))))) : null].filter(Boolean));
}
