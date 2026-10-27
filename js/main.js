// Start-up: sign-in, who the person is, tabs, and the controls that live in the page itself.

function show(view) { for (const v of ["login", "noaccess", "ordersView", "teamView", "statsView"]) $(v).hidden = v !== view; }

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
  S.me = null; S.orders = []; S.photoUrls = {}; S.filter = null; S.query = ""; S.hits = null; S.loaded = false; S.range = null;
  $("q").value = ""; delete document.body.dataset.role;
  if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
  $("hright").hidden = true; $("tabs").hidden = true; renderSub();
  closeSheet(true); setConnection(null); show("login");
}

async function start(user) {
  const email = user.email.toLowerCase();
  const { data, error } = await sb.from("cdf_members").select("email,name,role").eq("email", email).maybeSingle();
  $("hright").hidden = false;
  if (error || !data) {
    S.me = null;
    $("noaccessTxt").textContent = t("noAccessTxt", { email });
    $("tabs").hidden = true; show("noaccess"); return;
  }
  S.me = data;
  document.body.dataset.role = data.role;
  renderSub();
  $("tabs").hidden = !isAdmin();
  $("newBtn").hidden = !isStaff();
  $("selectBtn").hidden = !isStaff();
  $("viewControls").hidden = !isStaff();
  await detectSchema();
  if (isStaff()) await loadMembers();
  setTab("orders");
  await loadOrders();
  subscribe();
}

function renderSub() {
  $("sub").textContent = S.me ? t({ admin: "subAdmin", moderator: "subModerator", carrier: "subCarrier" }[S.me.role] || "subVendor", { name: S.me.name }) : t("signIn");
  $("userAvatar").textContent = S.me?.name?.trim().charAt(0).toUpperCase() || "";
}

// ---------- tabs ----------
function setTab(tab) {
  S.tab = tab;
  for (const [id, v] of [["tabOrders", "orders"], ["tabStats", "stats"], ["tabTeam", "team"]]) $(id).setAttribute("aria-current", tab === v ? "page" : "false");
  show({ orders: "ordersView", team: "teamView", stats: "statsView" }[tab]);
  render();
}
$("tabOrders").onclick = () => setTab("orders");
$("tabTeam").onclick = () => setTab("team");
$("tabStats").onclick = () => setTab("stats");
$("statsPeriod").addEventListener("click", (e) => { const b = e.target.closest("button[data-days]"); if (b) { statsDays = +b.dataset.days; renderStats(); } });

// ---------- calendar and the day's controls ----------
$("prevM").onclick = () => shiftMonth(-1);
$("nextM").onclick = () => shiftMonth(1);
$("todayBtn").onclick = () => selectDay(S.today);
$("newBtn").onclick = () => newOrder();
$("selectBtn").onclick = () => setSelecting(!S.selecting);
$("q").addEventListener("input", () => { if (isStaff()) onSearchInput(); else { S.query = $("q").value.trim(); renderAgenda(); } });
$("clearSearch").onclick = () => { if (isStaff()) clearSearch(); else { $("q").value = ""; S.query = ""; renderAgenda(); } $("q").focus(); };
$("calendarToggle").onclick = () => {
  const b = $("calendarToggle"), open = b.getAttribute("aria-expanded") !== "true";
  b.setAttribute("aria-expanded", String(open)); $("calendarBody").classList.toggle("expanded", open);
};
function setDensity(v) {
  document.body.dataset.density = v;
  $("timelineView").setAttribute("aria-pressed", String(v === "timeline"));
  $("compactView").setAttribute("aria-pressed", String(v === "compact"));
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
  renderSub();
  if (!S.me && !$("noaccess").hidden) return;
  if (S.me) render();
  // Reopen the sheet in the new language only when nothing typed would be lost
  if (sheet && !sheet.dirty() && sheet.order) { const o = byId(sheet.order.id) || sheet.order; closeSheet(true).then(() => openFresh(o)); }
});
