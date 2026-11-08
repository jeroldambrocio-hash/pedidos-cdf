// Service worker: makes the app installable and shows push notifications (chat, orders handed to you).
// It caches nothing on purpose: the app always loads fresh from Netlify and refreshes itself on new versions.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// kind "message" (chats) or "order" (handed to you, cancelled): its own vibration on Android, and an order
// notice stays on screen until it is tapped or dismissed. iPhone ignores both and uses its standard sound.
const VIBRATE = { message: [120, 60, 120], order: [400, 150, 400, 150, 400] };
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Casa de Flores", body: e.data ? e.data.text() : "" }; }
  const kind = d.kind === "order" ? "order" : "message";
  e.waitUntil((async () => {
    // The app is on screen: it plays its own sound for this kind (if sounds are on), so the system one stays quiet
    const shown = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter((w) => w.visibilityState === "visible");
    for (const w of shown) w.postMessage({ type: "sound", kind });
    await self.registration.showNotification(d.title || "Casa de Flores", {
      body: d.body || "",
      icon: "/img/icon-192.png",
      badge: "/img/icon-192.png",
      tag: d.tag || undefined,
      renotify: !!d.tag,
      silent: shown.length > 0,
      vibrate: shown.length ? undefined : VIBRATE[kind],
      requireInteraction: kind === "order",
      data: { url: d.url || "/" },
    });
  })());
});

// Tapping a notification opens the app on that conversation or order (reusing an open window)
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin);
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === url.origin);
    if (win) { await win.focus(); win.postMessage({ type: "open", url: url.pathname + url.search }); return; }
    await self.clients.openWindow(url.href);
  })());
});
