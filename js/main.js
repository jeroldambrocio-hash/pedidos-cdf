// Start-up: sign-in, who the person is, the sidebar and account menu, and the controls that live in the page itself.

function show(view) {
  for (const v of ["login", "noaccess", "ordersView", "teamView", "statsView", "chatView"]) {
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
  try {
    const identity = $("lEmail").value.trim(), password = $("lPass").value;
    if (identity.includes("@")) {
      const { error } = await sb.auth.signInWithPassword({ email: identity.toLowerCase(), password });
      if (error) throw error;
    } else {
      const { data, error } = await sb.functions.invoke("cdf-login", { body: { username: identity.toLowerCase(), password } });
      if (error || !data?.access_token || !data?.refresh_token) throw new Error("invalid");
      const session = await sb.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      if (session.error) throw session.error;
    }
    $("lPass").value = "";
  } catch { $("lErr").textContent = t("badLogin"); }
  finally { $("lBtn").disabled = false; }
});
// Local sign-out needs no network round trip, so it works even when the server call would fail
// (Safari kept the session when the global sign-out request errored).
$("logout").onclick = async () => {
  if (sheet && !(await closeSheet())) return;
  $("logout").disabled = true;
  await Promise.race([forgetPush(), wait(2500)]); // this device stops receiving the notifications of whoever signs out
  try { await sb.auth.signOut({ scope: "local" }); } catch { /* cleared below anyway */ }
  try { for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k); } catch {}
  writeDraft(null); // an unsaved order (customer name, address) never outlives the session on a shared device
  $("logout").disabled = false;
  booted = null; stop();
};

let booted;
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === "PASSWORD_RECOVERY") recovering = true;
  const id = session?.user?.id || null;
  if (id === booted) { if (id) maybeRecover(); return; }
  document.querySelector(".employee-profile[open]")?.close();
  booted = id;
  setTimeout(async () => { if (id) { await start(session.user); maybeRecover(); } else stop(); }, 0);
});
// Back from the reset email: signed in by the link, so ask straight away for the new password.
function maybeRecover() {
  if (!recovering || !(S.me || S.email)) return;
  recovering = false;
  try { history.replaceState(null, "", location.pathname); } catch {}
  openPasswordSheet(true);
}

function stop() {
  invalidateStats(); S.prices = {}; stopChat();
  S.me = null; S.email = null; S.orders = []; S.photoUrls = {}; S.filter = null; S.chan = null; S.query = ""; S.hits = null; S.loaded = false; S.range = null;
  $("q").value = ""; delete document.body.dataset.role;
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  renderSub();
  closeSheet(true); setConnection(null); show("login");
  if (linkError) { $("lErr").textContent = t(linkError === "otp_expired" ? "linkExpired" : "linkFailed"); linkError = null; try { history.replaceState(null, "", location.pathname); } catch {} }
}

async function start(user) {
  const email = user.email.toLowerCase();
  const { data, error } = await sb.from("cdf_members").select("*").eq("email", email).maybeSingle();
  if (error || !data) {
    S.me = null; S.email = email;
    $("noaccessTxt").textContent = t("noAccessTxt", { email });
    $("tabStats").hidden = $("tabTeam").hidden = true;
    renderSub(); show("noaccess"); return;
  }
  if (data.role === "carrier" && !feature("drivers")) {
    S.me = null; S.email = email;
    $("noaccessTxt").textContent = t("driversOff");
    $("tabStats").hidden = $("tabTeam").hidden = true;
    renderSub(); show("noaccess"); return;
  }
  S.me = data; S.uid = user.id; // the avatar folder is the auth user id
  invalidateStats();
  document.body.dataset.role = data.role;
  $("tabStats").hidden = $("tabTeam").hidden = !isAdmin();
  $("newBtn").hidden = !isStaff();
  $("selectBtn").hidden = !isStaff();
  $("viewControls").hidden = !isStaff();
  // Independent round trips go together: the database is far from Manila, so each one in a row costs a few hundred ms
  await Promise.all([detectSchema(), isStaff() ? loadMembers() : null]);
  renderSub();
  setTab("orders");
  await loadOrders();
  subscribe();
  await loadChat();
  syncPush(); paintPwa(); openDeepLink(); // this device's notifications follow whoever signs in; open what a notification pointed at
}

// Who is signed in: rail footer, account menu and the thin mobile header
for (const id of ["userProfileBtn", "menuProfileBtn"]) {
  $(id).addEventListener("click", (e) => showEmployeeProfile(S.me, e.currentTarget));
}

function renderSub() {
  const name = S.me?.name || S.email || "", role = S.me ? t("role_" + S.me.role) : "";
  $("sub").textContent = S.me ? t({ admin: "subAdmin", carrier: "subCarrier" }[S.me.role] || "subVendor", { name: S.me.name }) : "";
  fillAvatar($("userAvatar"), { name, avatar_path: S.me?.avatar_path }); fillAvatar($("menuAvatar"), { name, avatar_path: S.me?.avatar_path });
  $("userName").textContent = $("menuName").textContent = name;
  $("userRole").textContent = role;
  $("menuSub").textContent = role || S.email || "";
  $("menuEmail").textContent = [S.me?.username, S.me?.email || S.email].filter(Boolean).join(" · ");
  $("userProfileBtn").dataset.tip = name;
  $("userProfileBtn").hidden = $("menuProfileBtn").hidden = !S.me;
  $("accountBtn").title = t("accountMenu");
  $("pwBtn").hidden = !S.me;
  $("myAccountBtn").hidden = !S.me;
  renderMyCard();
  // Prices are a per-browser view choice of the admin (localStorage "cdf-prices"), so the switch sits with the order view controls
  $("pricesBtn").hidden = !(isAdmin() && S.cap.amount);
  $("pricesBtn").dataset.tip = $("pricesBtn").title = t("showPrices");
  // Florists and drivers have one section: their own list
  $("tabOrdersLabel").textContent = !S.me || isStaff() ? t("tabOrders") : isCarrier() ? t("myRoute") : t("myOrders");
  $("tabOrders").dataset.tip = $("tabOrdersLabel").textContent;
  $("tabStats").dataset.tip = t("tabStats"); $("tabTeam").dataset.tip = t("tabTeam");
}

// ---------- sections ----------
function setTab(tab) {
  S.tab = tab;
  for (const [id, v] of [["tabOrders", "orders"], ["tabStats", "stats"], ["tabTeam", "team"], ["tabChat", "chat"]]) $(id).setAttribute("aria-current", tab === v ? "page" : "false");
  show({ orders: "ordersView", team: "teamView", stats: "statsView", chat: "chatView" }[tab]);
  window.scrollTo({ top: 0 });
  render();
}
$("tabOrders").onclick = () => { if (S.me) setTab("orders"); };
// The brand name goes home: the orders list, the drawer closed on phones
const goHome = () => { if (!S.me) return; setDrawer(false, false); if (S.tab !== "orders") setTab("orders"); else window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" }); };
$("brandHome").onclick = goHome;
$("brandHomeMobile").onclick = goHome;
$("tabTeam").onclick = () => setTab("team");
$("tabStats").onclick = () => setTab("stats");
$("tabChat").onclick = () => setTab("chat");
$("statsPeriod").addEventListener("click", (e) => { const b = e.target.closest("button[data-days]"); if (b) { setStatsPeriod(b.dataset.days); } });
for (const id of ["statsFrom", "statsTo"]) $(id).addEventListener("change", setStatsDates);

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
  $("root").inert = open; $("header").inert = open;
  if (open) { rail.setAttribute("role","dialog"); rail.setAttribute("aria-modal","true"); rail.setAttribute("aria-label",t("sections")); }
  else { rail.removeAttribute("role"); rail.removeAttribute("aria-modal"); rail.removeAttribute("aria-label"); }
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
document.addEventListener("keydown", (e) => {
 if (!$("rail").classList.contains("drawer-open")) return;
 if (e.key === "Escape") { e.preventDefault(); setDrawer(false); return; }
 if (e.key === "Tab") {
  const items = [...$("rail").querySelectorAll("button,a[href],input,select")].filter(n=>!n.disabled && n.getClientRects().length && getComputedStyle(n).visibility!=="hidden");
  const first=items[0], last=items.at(-1);
  if (e.shiftKey && document.activeElement===first) {e.preventDefault();last.focus()}
  else if (!e.shiftKey && document.activeElement===last) {e.preventDefault();first.focus()}
 }
});
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
$("pwBtn").onclick = () => openPasswordSheet(false);
function openPasswordSheet(recovery) {
  const p1 = el("input", { type: "password", autocomplete: "new-password", minlength: 8 }), p2 = el("input", { type: "password", autocomplete: "new-password" });
  const f1 = field(t("newPass"), p1), f2 = field(t("repeatPass"), p2), email = S.me?.email || S.email;
  miniSheet(t(recovery ? "resetTitle" : "changePassword"), [el("p", { class: "note", style: "margin:0" }, t(recovery ? "resetHelp" : "accountOf", { email })), f1, f2], t("savePassword"), async () => {
    [f1, f2].forEach((w) => w.classList.remove("invalid"));
    if (p1.value.length < 8) { f1.classList.add("invalid"); return t("passMin"); }
    if (p1.value !== p2.value) { f2.classList.add("invalid"); return t("passMismatch"); }
    const { error } = await sb.auth.updateUser({ password: p1.value });
    if (error) return error.message;
    await closeSheet(true); toast(t("passChanged"));
  }, { dirty: () => !!p1.value });
  requestAnimationFrame(() => p1.focus());
}
// Forgotten password: Supabase emails a one-time link back to this page.
// The reply is the same whether or not the account exists, so the form can't be used to probe emails.
$("forgotBtn").onclick = () => {
  const typed = $("lEmail").value.trim();
  const mail = el("input", { type: "email", autocomplete: "email", autocapitalize: "none", spellcheck: "false", required: true, maxlength: 254, value: typed.includes("@") ? typed : "" });
  const f = field(t("email"), mail);
  miniSheet(t("forgotTitle"), [el("p", { class: "note", style: "margin:0" }, t("forgotHelp")), f], t("forgotSend"), async () => {
    f.classList.remove("invalid");
    const email = mail.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { f.classList.add("invalid"); return t("forgotBadEmail"); }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/" });
    if (error) return t(error.status === 429 ? "forgotLimit" : "forgotFail");
    await closeSheet(true); toast(t("forgotSent", { email }), { ms: 7000 });
  }, { dirty: () => !!mail.value && mail.value !== typed });
  requestAnimationFrame(() => mail.focus());
};
$("installBtn").onclick = () => installApp();
$("notifBtn").onclick = () => onNotifBtn();
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
$("pricesBtn").onclick = () => { savePref("cdf-prices", pref("cdf-prices") === "on" ? "" : "on"); applyPrefs(); document.dispatchEvent(new Event("priceschange")); };
document.addEventListener("priceschange", async () => { invalidateStats(); await attachPrices(S.orders); render(); });

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
  paintPwa();
  renderSub(); setRail($("rail").dataset.expanded === "true", false);
  if (S.me) render();
  // Reopen the sheet in the new language only when nothing typed would be lost
  if (sheet && !sheet.dirty() && sheet.order) { const o = byId(sheet.order.id) || sheet.order; closeSheet(true).then(() => openFresh(o)); }
});

// ---------- new version ----------
// Each Netlify publish writes /version.json (scripts/deploy-netlify.sh). The first answer is the version this
// page runs; when a later check differs, a notice appears and the page reloads by itself as soon as nothing
// is open (a sheet, a dialog or a field being typed in), so no unsaved work is lost.
// Locally there is no version.json, so this stays quiet.
let appVersion = null, updateFound = false;
async function checkVersion() {
  if (updateFound || !navigator.onLine) return;
  try {
    const r = await fetch("/version.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const v = String((await r.json()).v || "");
    if (!v) return;
    if (appVersion === null) { appVersion = v; return; }
    if (v !== appVersion) { updateFound = true; announceUpdate(); }
  } catch { /* offline or a bad answer: try again on the next check */ }
}
const busyScreen = () => !!sheet || !!document.querySelector(".dialog") || (document.activeElement?.matches("input, textarea, select") && document.activeElement.value);
function announceUpdate() {
  toast(t("updateReady"), { type: "info", action: t("updateNow"), onAction: () => location.reload(), ms: 600000 });
  const tryReload = () => (busyScreen() ? setTimeout(tryReload, 3000) : location.reload());
  setTimeout(tryReload, 4000);
}
checkVersion();
setInterval(checkVersion, 5 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkVersion(); });
window.addEventListener("online", checkVersion);
