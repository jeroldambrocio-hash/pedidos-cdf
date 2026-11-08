// Installable app (iPhone and Android) and push notifications.
// Android/Chrome offer an install prompt; iPhone installs from Safari's Share menu (we show the steps).
// On iPhone, notifications only exist inside the installed app (iOS 16.4+), so we say so instead of failing.
const PWA = { prompt: null, reg: null, saved: null, synced: false };
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const vapidKey = () => {
  const b = (window.CDF_CONFIG.vapidPublicKey || "").replace(/-/g, "+").replace(/_/g, "/"), raw = atob(b + "===".slice((b.length + 3) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then((r) => { PWA.reg = r; paintPwa(); }).catch(() => {});
  // A tapped notification while the app is open: go to that conversation or order
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "open") openDeepLink(new URL(e.data.url, location.origin).searchParams); });
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); PWA.prompt = e; paintPwa(); });
window.addEventListener("appinstalled", () => { PWA.prompt = null; paintPwa(); toast(t("installDone")); });

async function installApp() {
  if (PWA.prompt) { PWA.prompt.prompt(); await PWA.prompt.userChoice.catch(() => {}); PWA.prompt = null; paintPwa(); return; }
  const steps = isIOS() ? ["installIos1", "installIos2", "installIos3"] : ["installAndroid1", "installAndroid2", "installIos3"];
  miniSheet(t(isIOS() ? "installIosTitle" : "installTitle"),
    [el("ol", { class: "install-steps" }, steps.map((k, i) => el("li", {}, el("span", { class: "step-n" }, String(i + 1)), el("span", {}, t(k)))))],
    t("gotIt"), async () => { await closeSheet(true); });
}

// ---------- notifications ----------
async function currentSub() {
  if (!pushSupported()) return null;
  const reg = PWA.reg || (await navigator.serviceWorker.getRegistration());
  return reg ? reg.pushManager.getSubscription() : null;
}
async function saveSub(sub) {
  const j = sub.toJSON(), email = S.me.email;
  const { error } = await sb.from("cdf_push_subs").upsert({ endpoint: j.endpoint, member_email: email, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) }, { onConflict: "endpoint" });
  if (error) throw new Error(t("notifFail"));
  if (S.me?.email === email) PWA.saved = { email, endpoint: j.endpoint };
}
async function enablePush() {
  if (!pushSupported()) return installApp();
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { paintPwa(); return toast(t("notifDenied"), { type: "error" }); }
  let created;
  try {
    const reg = PWA.reg || (await navigator.serviceWorker.ready);
    const existing = await reg.pushManager.getSubscription();
    const sub = existing || (created = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() }));
    await saveSub(sub);
    toast(t("notifOnToast"));
  } catch (e) {
    if (created) await created.unsubscribe().catch(() => {});
    toast(e.message || t("notifFail"), { type: "error" });
  }
  paintPwa();
}
async function disablePush() {
  try {
    const sub = await currentSub();
    if (sub) {
      const { error } = await sb.from("cdf_push_subs").delete().eq("endpoint", sub.endpoint);
      if (error) throw error;
      await sub.unsubscribe().catch(() => {});
    }
    PWA.saved = null;
    toast(t("notifOffToast"));
  } catch { toast(t("notifFail"), { type: "error" }); }
  paintPwa();
}
// After signing in on a device that already allowed notifications: link it to whoever is signed in now
async function syncPush() { try { const sub = await currentSub(); if (sub && Notification.permission === "granted") await saveSub(sub); } catch {} finally { PWA.synced = true; paintPwa(); } }
// Signing out: this device stops receiving that person's notifications
async function forgetPush() { PWA.saved = null; PWA.synced = false; paintNotifBanner("off"); try { const sub = await currentSub(); if (sub) { await sb.from("cdf_push_subs").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); } } catch {} }

async function paintPwa() {
  const inst = $("installBtn"); if (inst) inst.hidden = isStandalone();
  const btn = $("notifBtn"), note = $("notifState"); if (!btn) return;
  let state = "off";
  if (!pushSupported()) state = isIOS() && !isStandalone() ? "needInstall" : "unsupported";
  else if (Notification.permission === "denied") state = "denied";
  else if (Notification.permission === "granted" && PWA.saved?.email === S.me?.email && PWA.saved &&
    (await currentSub())?.endpoint === PWA.saved?.endpoint) state = "on";
  btn.dataset.state = state;
  btn.textContent = t({ on: "notifTurnOff", off: "notifTurnOn", needInstall: "installApp", denied: "notifHelp", unsupported: "notifHelp" }[state]);
  paintNotifBanner(state);
  btn.disabled = state === "unsupported";
  note.textContent = t({ on: "notifIsOn", off: "notifIsOff", needInstall: "notifNeedInstall", denied: "notifIsDenied", unsupported: "notifUnsupported" }[state]);
}
async function onNotifBtn() {
  const s = $("notifBtn").dataset.state;
  if (s === "on") return disablePush();
  if (s === "needInstall") return installApp();
  if (s === "denied") return toast(t("notifDeniedHelp"), { type: "info", ms: 9000 });
  return enablePush();
}

// The menu button is easy to miss, so whoever has notifications off on this device is asked on the orders page.
// "Not now" quiets it for three days on this device; turning them on hides it for good.
const NOTIF_LATER_MS = 3 * 864e5;
const notifLaterKey = () => "cdf-notif-later:" + (S.me?.email || "");
function notifLater() { try { return Date.now() - Number(localStorage.getItem(notifLaterKey()) || 0) < NOTIF_LATER_MS; } catch { return false; } }
function paintNotifBanner(state) {
  const box = $("notifBanner"); if (!box) return;
  const ask = !!S.me && PWA.synced && (state === "off" || state === "needInstall") && !notifLater();
  if (!ask) { box.hidden = true; box.replaceChildren(); delete box.dataset.state; return; }
  if (!box.hidden && box.dataset.state === state) return; // same message already showing: don't replay its entrance
  const inst = state === "needInstall";
  box.dataset.state = state;
  box.replaceChildren(icon("bell"), el("div", { class: "notif-ask" },
    el("b", {}, t(inst ? "notifAskInstallTitle" : "notifAskTitle")),
    el("p", {}, t(inst ? "notifAskInstallTxt" : "notifAskTxt")),
    el("div", { class: "notif-ask-acts" },
      el("button", { class: "btn primary", type: "button", onclick: () => (inst ? installApp() : enablePush()) }, t(inst ? "installApp" : "notifTurnOn")),
      el("button", { class: "linkish", type: "button", onclick: () => { try { localStorage.setItem(notifLaterKey(), String(Date.now())); } catch {} paintNotifBanner(state); } }, t("notifLater")))));
  box.hidden = false;
}

// ?chat=<order id | team> and ?order=<id>: where a notification takes you
async function openDeepLink(params = new URLSearchParams(location.search)) {
  const chat = params.get("chat"), order = params.get("order");
  if (!S.me || (!chat && !order)) return;
  try { history.replaceState(null, "", location.pathname); } catch {}
  if (chat && CH.on) return openThread(chat);
  if (order) {
    let o = byId(order);
    if (!o) { const { data } = await sb.from("cdf_orders").select("*").eq("id", order).maybeSingle(); o = data; }
    if (o) openOrder(o);
  }
}
