// Start-up: sign-in, who the person is, the sidebar and account menu, and the controls that live in the page itself.

function show(view) {
  for (const v of ["login", "noaccess", "ordersView", "teamView", "statsView"]) {
    const n = $(v), on = v === view;
    if (on && n.hidden) { n.classList.remove("view"); void n.offsetWidth; n.classList.add("view"); }
    n.hidden = !on;
  }
  const signedIn = view !== "login";
  $("rail").hidden = $("header").hidden = !signedIn;
  document.body.classList.toggle("has-rail", signedIn);
  setDrawer(false, false);
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault(); $("lErr").textContent = ""; $("lBtn").disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim(), password: $("lPass").value });
  $("lBtn").disabled = false;
  if (error) $("lErr").textContent = /invalid/i.test(error.message) ? t("badLogin") : error.message;
});
// Local sign-out needs no network round trip, so it works even when the server call would fail
// (Safari kept the session when the global sign-out request errored).
$("logout").onclick = async () => {
  if (sheet && !(await closeSheet())) return;
  $("logout").disabled = true;
  try { await sb.auth.signOut({ scope: "local" }); } catch { /* cleared below anyway */ }
  try { for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k); } catch {}
  $("logout").disabled = false;
  booted = null; stop();
};

let booted;
sb.auth.onAuthStateChange((_ev, session) => {
  const id = session?.user?.id || null;
  if (id === booted) return;
  booted = id;
  setTimeout(() => (id ? start(session.user) : stop()), 0);
});

function stop() {
  S.me = null; S.email = null; S.orders = []; S.photoUrls = {}; S.filter = null; S.chan = null; S.query = ""; S.hits = null; S.loaded = false; S.range = null;
  $("q").value = ""; delete document.body.dataset.role;
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  renderSub();
  closeSheet(true); setConnection(null); show("login");
}

async function start(user) {
  const email = user.email.toLowerCase();
  const { data, error } = await sb.from("cdf_members").select("email,name,role").eq("email", email).maybeSingle();
  if (error || !data) {
    S.me = null; S.email = email;
    $("noaccessTxt").textContent = t("noAccessTxt", { email });
    $("tabStats").hidden = $("tabTeam").hidden = true;
    renderSub(); show("noaccess"); return;
  }
  S.me = data;
  document.body.dataset.role = data.role;
  $("tabStats").hidden = $("tabTeam").hidden = !isAdmin();
  $("newBtn").hidden = !isStaff();
  $("selectBtn").hidden = !isStaff();
  $("viewControls").hidden = !isStaff();
  await detectSchema();
  renderSub();
  if (isStaff()) await loadMembers();
  setTab("orders");
  await loadOrders();
  subscribe();
}

// Who is signed in: rail footer, account menu and the thin mobile header
function renderSub() {
  const name = S.me?.name || S.email || "", role = S.me ? t("role_" + S.me.role) : "";
  $("sub").textContent = S.me ? t({ admin: "subAdmin", moderator: "subModerator", carrier: "subCarrier" }[S.me.role] || "subVendor", { name: S.me.name }) : "";
  $("userAvatar").textContent = $("menuAvatar").textContent = name.trim().charAt(0).toUpperCase();
  $("userName").textContent = $("menuName").textContent = name;
  $("userRole").textContent = role;
  $("menuSub").textContent = [role, S.me?.email || S.email].filter(Boolean).join(" · ");
  $("accountBtn").dataset.tip = name;
  $("pwBtn").hidden = !S.me;
  $("pricesRow").hidden = !(isAdmin() && S.cap.amount);
  // Florists and drivers have one section: their own list
  $("tabOrdersLabel").textContent = !S.me || isStaff() ? t("tabOrders") : isCarrier() ? t("myRoute") : t("myOrders");
  $("tabOrders").dataset.tip = $("tabOrdersLabel").textContent;
  $("tabStats").dataset.tip = t("tabStats"); $("tabTeam").dataset.tip = t("tabTeam");
}

// ---------- sections ----------
function setTab(tab) {
  S.tab = tab;
  for (const [id, v] of [["tabOrders", "orders"], ["tabStats", "stats"], ["tabTeam", "team"]]) $(id).setAttribute("aria-current", tab === v ? "page" : "false");
  show({ orders: "ordersView", team: "teamView", stats: "statsView" }[tab]);
  window.scrollTo({ top: 0 });
  render();
}
$("tabOrders").onclick = () => { if (S.me) setTab("orders"); };
$("tabTeam").onclick = () => setTab("team");
$("tabStats").onclick = () => setTab("stats");
$("statsPeriod").addEventListener("click", (e) => { const b = e.target.closest("button[data-days]"); if (b) { statsDays = +b.dataset.days; renderStats(); } });

// ---------- sidebar: collapsed (56px) or open (200px) on desktop, remembered; a drawer on phones ----------
const mobileNav = matchMedia("(max-width: 860px)");
function setRail(open, save = true) {
  const rail = $("rail"), tg = $("railToggle");
  rail.dataset.expanded = String(open);
  document.body.classList.toggle("rail-open", open);
  if (!mobileNav.matches) { tg.setAttribute("aria-expanded", String(open)); tg.setAttribute("aria-label", t(open ? "collapseNav" : "expandNav")); tg.dataset.tip = t("expandNav"); }
  if (save) savePref("cdf-rail", open ? "open" : "");
}
function setDrawer(open, focus = true) {
  const rail = $("rail");
  if (!mobileNav.matches) open = false;
  if (rail.classList.contains("drawer-open") === open) return;
  rail.classList.toggle("drawer-open", open);
  $("railVeil").classList.toggle("on", open);
  $("navOpen").setAttribute("aria-expanded", String(open));
  if (mobileNav.matches) $("railToggle").setAttribute("aria-label", t("closeNav"));
  if (!focus) return;
  if (open) rail.querySelector(".rail-item:not([hidden])")?.focus(); else $("navOpen").focus();
}
$("railToggle").onclick = () => (mobileNav.matches ? setDrawer(false) : setRail($("rail").dataset.expanded !== "true"));
$("navOpen").onclick = () => setDrawer(true);
$("railVeil").onclick = () => setDrawer(false);
$("rail").addEventListener("click", (e) => { if (e.target.closest(".rail-item")) setDrawer(false, false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("rail").classList.contains("drawer-open")) setDrawer(false); });
mobileNav.addEventListener("change", () => { setDrawer(false, false); setRail(pref("cdf-rail") === "open", false); });
setRail(pref("cdf-rail") === "open", false);
// Collapsed: each section's name shows beside it on hover or keyboard focus
const railTip = $("railTip");
function showTip(e) {
  const it = e.target.closest?.("[data-tip]");
  if (!it || !it.dataset.tip || $("rail").dataset.expanded === "true" || mobileNav.matches) return;
  const r = it.getBoundingClientRect();
  railTip.textContent = it.dataset.tip;
  railTip.style.left = r.right + 10 + "px"; railTip.style.top = r.top + r.height / 2 + "px";
  railTip.classList.add("on");
}
const hideTip = () => railTip.classList.remove("on");
$("rail").addEventListener("pointerover", showTip);
$("rail").addEventListener("pointerout", hideTip);
$("rail").addEventListener("focusin", (e) => e.target.matches(":focus-visible") && showTip(e));
$("rail").addEventListener("focusout", hideTip);
$("rail").addEventListener("click", hideTip);

// ---------- account menu: password and suggestions ----------
$("pwBtn").onclick = () => {
  const p1 = el("input", { type: "password", autocomplete: "new-password", minlength: 8 }), p2 = el("input", { type: "password", autocomplete: "new-password" });
  const f1 = field(t("newPass"), p1), f2 = field(t("repeatPass"), p2);
  miniSheet(t("changePassword"), [el("p", { class: "note", style: "margin:0" }, t("accountOf", { email: S.me.email })), f1, f2], t("savePassword"), async () => {
    [f1, f2].forEach((w) => w.classList.remove("invalid"));
    if (p1.value.length < 8) { f1.classList.add("invalid"); return t("passMin"); }
    if (p1.value !== p2.value) { f2.classList.add("invalid"); return t("passMismatch"); }
    const { error } = await sb.auth.updateUser({ password: p1.value });
    if (error) return error.message;
    await closeSheet(true); toast(t("passChanged"));
  }, { dirty: () => !!p1.value });
};
$("fbBtn").onclick = () => {
  const to = window.CDF_CONFIG.feedbackTo;
  let kind = "fbIdea";
  const kinds = el("div", { class: "seg", role: "group", "aria-label": t("fbType") }, ["fbIdea", "fbBug", "fbOther"].map((k) =>
    el("button", { type: "button", "aria-pressed": String(k === kind), onclick: (e) => { kind = k; kinds.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); placePill(kinds); } }, t(k))));
  const msg = el("textarea", { placeholder: t("fbPh"), rows: 5 });
  const fMsg = field(t("fbMsg"), msg);
  miniSheet(t("sendFeedback"), [el("p", { class: "note", style: "margin:0" }, t("fbTo", { to })), field(t("fbType"), kinds), fMsg], t("send"), async () => {
    fMsg.classList.remove("invalid");
    if (!msg.value.trim()) { fMsg.classList.add("invalid"); return t("fbEmpty"); }
    const who = S.me ? `${S.me.name} (${t("role_" + S.me.role)}, ${S.me.email})` : S.email || "";
    const subject = `[Pedidos CDF] ${t(kind)} · ${S.me?.name || S.email || ""}`;
    location.href = "mailto:" + to + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(msg.value.trim() + "\n\n— " + who);
    await closeSheet(true); toast(t("fbOpened"), { type: "info", ms: 4500 });
  }, { dirty: () => !!msg.value.trim() });
  requestAnimationFrame(() => placePill(kinds));
};
document.addEventListener("priceschange", () => render());

// ---------- calendar and the day's controls ----------
$("prevM").onclick = () => shiftMonth(-1);
$("nextM").onclick = () => shiftMonth(1);
$("todayBtn").onclick = () => selectDay(S.today);
$("newBtn").onclick = () => newOrder();
$("selectBtn").onclick = () => setSelecting(!S.selecting);
$("statusMobile").onchange = (e) => { const v = e.target.value; setFilter(v === "" ? null : /^\d$/.test(v) ? +v : v); };
$("q").addEventListener("input", () => { if (isStaff()) onSearchInput(); else { S.query = $("q").value.trim(); renderAgenda(); } });
$("clearSearch").onclick = () => { if (isStaff()) clearSearch(); else { $("q").value = ""; S.query = ""; renderAgenda(); } $("q").focus(); };
$("calendarToggle").onclick = () => {
  const b = $("calendarToggle"), open = b.getAttribute("aria-expanded") !== "true";
  b.setAttribute("aria-expanded", String(open)); $("calendarBody").classList.toggle("expanded", open);
};
function setDensity(v) {
  $("list").classList.toggle("compact", v === "compact");
  $("list").classList.toggle("timeline", v !== "compact");
  $("timelineView").setAttribute("aria-pressed", String(v === "timeline"));
  $("compactView").setAttribute("aria-pressed", String(v === "compact"));
  placePill($("viewControls"));
  savePref("cdf-density", v);
}
$("timelineView").onclick = () => setDensity("timeline");
$("compactView").onclick = () => setDensity("compact");
setDensity(pref("cdf-density") === "compact" ? "compact" : "timeline");

// Keyboard: Ctrl/⌘+K search · N new order · T today · ←/→ previous/next day (when not typing)
document.addEventListener("keydown", (e) => {
  if (!S.me || S.tab !== "orders" || sheet || document.querySelector("#dialogRoot .scrim")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("q").focus(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input,textarea,select,[contenteditable]")) return;
  if (!isStaff()) return;
  const k = e.key.toLowerCase();
  if (k === "n") { e.preventDefault(); newOrder(); }
  else if (k === "t") selectDay(S.today);
  else if (e.key === "ArrowLeft" && !S.hits) selectDay(addDays(S.sel, -1));
  else if (e.key === "ArrowRight" && !S.hits) selectDay(addDays(S.sel, 1));
});

document.addEventListener("langchange", () => {
  renderSub(); setRail($("rail").dataset.expanded === "true", false);
  if (S.me) render();
  // Reopen the sheet in the new language only when nothing typed would be lost
  if (sheet && !sheet.dirty() && sheet.order) { const o = byId(sheet.order.id) || sheet.order; closeSheet(true).then(() => openFresh(o)); }
});
