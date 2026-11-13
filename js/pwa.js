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
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "open") openDeepLink(new URL(e.data.url, location.origin).searchParams);
    if (e.data?.type === "sound") playSound(e.data.kind);
  });
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
  const row = { endpoint: j.endpoint, member_email: email, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200), lang: LANG };
  let { error } = await sb.from("cdf_push_subs").upsert(row, { onConflict: "endpoint" });
  // A database without the lang column (migration 028): the device is saved all the same, its notices come in English
  if (error && (error.code === "PGRST204" || /\blang\b/.test(error.message || ""))) {
    delete row.lang;
    ({ error } = await sb.from("cdf_push_subs").upsert(row, { onConflict: "endpoint" }));
  }
  if (error) throw Object.assign(new Error(t("notifFail")), { code: error.code });
  if (S.me?.email === email) { PWA.saved = { email, endpoint: j.endpoint }; PWA.syncError = null; }
}
// This device's subscription, saved for whoever is signed in. The browser's own one is reused; without one it
// is created (the permission is already granted, so nothing is asked). One still tied to the account that
// used this device before can't be taken over (42501, row-level security), so a fresh one replaces it.
const subOpts = () => ({ userVisibleOnly: true, applicationServerKey: vapidKey() });
async function linkDevice(reg) {
  let sub = await reg.pushManager.getSubscription(), created = !sub;
  if (!sub) sub = await reg.pushManager.subscribe(subOpts());
  try { await saveSub(sub); } catch (e) {
    if (created || e.code !== "42501") { if (created) await sub.unsubscribe().catch(() => {}); throw e; }
    await sub.unsubscribe().catch(() => {});
    sub = await reg.pushManager.subscribe(subOpts());
    try { await saveSub(sub); } catch (e2) { await sub.unsubscribe().catch(() => {}); throw e2; }
  }
}
// Turned off by hand on this device: stays off until the same person turns it on again
const notifOffKey = () => "cdf-notif-off:" + (S.me?.email || "");
const notifOffByHand = () => { try { return localStorage.getItem(notifOffKey()) === "1"; } catch { return false; } };
async function enablePush() {
  if (!pushSupported()) return installApp();
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { paintPwa(); return toast(t("notifDenied"), { type: "error" }); }
  try {
    await linkDevice(PWA.reg || (await navigator.serviceWorker.ready));
    try { localStorage.removeItem(notifOffKey()); } catch {}
    toast(t("notifOnToast"));
  } catch (e) {
    // The browser itself couldn't reach its push service (Brave with Google push off, a blocked network,
    // some Chromium builds): nothing the app can fix. Say what to do and stop asking on this device for a while.
    if (/push service|registration failed|AbortError/i.test(String(e?.name) + " " + String(e?.message))) {
      try { localStorage.setItem(notifLaterKey(), String(Date.now())); } catch {}
      toast(t("notifPushServiceErr"), { type: "error", ms: 12000 });
    } else toast(e.message || t("notifFail"), { type: "error" });
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
    try { localStorage.setItem(notifOffKey(), "1"); } catch {}
    toast(t("notifOffToast"));
  } catch { toast(t("notifFail"), { type: "error" }); }
  paintPwa();
}
// Every time the app opens on a device that already allowed notifications: keep them on for whoever is signed
// in, without asking again. Covers a new sign-in, a subscription the phone dropped and one that never got saved.
let syncing = null, syncingGen = -1;
function syncPush() {
  const gen = sessionNow(), email = S.me?.email;
  if (syncing && syncingGen === gen) return syncing;
  syncingGen = gen;
  const mine = (async () => {
    try {
      if (S.me && pushSupported() && Notification.permission === "granted" && !notifOffByHand()) {
        const reg = PWA.reg || (await Promise.race([navigator.serviceWorker.ready, wait(4000)]));
        if (reg) await linkDevice(reg);
      }
      if (!stale(gen)) PWA.syncError = null;
    } catch (e) {
      if (email && !stale(gen)) {
        const first = PWA.syncError?.email !== email;
        PWA.syncError = { email, code: String(e?.code || "registration_failed") };
        console.warn("CDF push registration failed", PWA.syncError.code);
        if (first) toast(t("notifFail"), { type: "error", action: t("retry"), onAction: () => syncPush() });
      }
    } finally { if (!stale(gen)) { PWA.synced = true; paintPwa(); } }
  })();
  syncing = mine;
  mine.finally(() => { if (syncing === mine) syncing = null; });
  return mine;
}
// A save that failed (no signal when the app opened) is tried again when the app comes back
const retryPush = () => { if (S.me && PWA.synced && !pushActive() && document.visibilityState === "visible" && navigator.onLine !== false) syncPush(); };
document.addEventListener("visibilitychange", retryPush);
addEventListener("online", retryPush);
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
  note.textContent = PWA.syncError?.email === S.me?.email && state === "off" ? t("notifFail") : t({ on: "notifIsOn", off: "notifIsOff", needInstall: "notifNeedInstall", denied: "notifIsDenied", unsupported: "notifUnsupported" }[state]);
}
async function onNotifBtn() {
  const s = $("notifBtn").dataset.state;
  if (s === "on") return disablePush();
  if (s === "needInstall") return installApp();
  if (s === "denied") return toast(t("notifDeniedHelp"), { type: "info", ms: 9000 });
  return enablePush();
}

// Notifications arrive in this device's language: changing it here updates what the server sends
document.addEventListener("langchange", () => { if (S.me && PWA.saved?.email === S.me.email) currentSub().then((s) => s && saveSub(s)).catch(() => {}); });
const pushActive = () => pushSupported() && Notification.permission === "granted" && !!PWA.saved && PWA.saved.email === S.me?.email;

// ---------- sounds while the app is open ----------
// Made on the fly (no audio files): a soft two-note "tin" for messages, a brighter three-note chime for an
// order handed to you or cancelled. A push tells the open app which one to play; without notifications on
// this device, chat messages for you still play theirs. On by default; Preferences turns them off.
let audioCtx = null;
const soundOn = () => pref("cdf-sound") !== "off";
function audio() {
  if (!audioCtx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; audioCtx = new C(); }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}
// iPhone only lets a page make sound after a tap: wake the audio on the first one
addEventListener("pointerdown", () => { try { audio(); } catch {} }, { once: true, capture: true });
const SOUNDS = {
  message: { wave: "sine", notes: [[880, 0], [1318.5, 0.11]], len: 0.32, vol: 0.18 },
  order: { wave: "triangle", notes: [[1046.5, 0], [1318.5, 0.16], [1568, 0.32]], len: 0.9, vol: 0.3 },
};
function playSound(kind, force) {
  if (!force && !soundOn()) return;
  const s = SOUNDS[kind] || SOUNDS.message;
  window.__sounds = [...(window.__sounds || []), kind]; // for the UI test
  try {
    const ctx = audio(); if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    for (const [freq, at] of s.notes) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = s.wave; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(s.vol, t0 + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + s.len);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + at); o.stop(t0 + at + s.len + 0.05);
    }
  } catch {}
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
  const chat = params.get("chat"), order = params.get("order"), request = params.get("request");
  if (!S.me || (!chat && !order && !request)) return;
  try { history.replaceState(null, "", location.pathname); } catch {}
  if (chat && CH.on) return openThread(chat);
  // A new request from the public form (the notice the admins get)
  if (request && reqOn()) {
    setTab("requests");
    let r = RQ.list.find((x) => x.id === request);
    const gen = sessionNow();
    if (!r) { const { data } = await sb.from("cdf_order_requests").select("*").eq("id", request).maybeSingle(); if (stale(gen)) return; r = data; }
    if (r) openRequest(r);
    return;
  }
  if (order) {
    let o = byId(order);
    const gen = sessionNow();
    if (!o) { const { data } = await sb.from("cdf_orders").select("*").eq("id", order).maybeSingle(); if (stale(gen)) return; o = data; }
    if (o) openOrder(o);
  }
}
