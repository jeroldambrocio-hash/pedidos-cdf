// The public order form (/pedido.html). A visitor fills in who buys, who receives, when and where, what
// they want and how they'd like to pay; photos are sent as they are added; the delivery point is searched,
// adjusted on the map and confirmed. Sending it makes a request for the shop to review: no price, stock or
// payment is confirmed here. What is typed stays in memory only (nothing personal is kept in the browser).
// The server (cdf-public-order) checks everything again; nothing here is a security boundary.
(() => {
  const CFG = window.CDF_CONFIG || {}, PO = CFG.publicOrder || {}, h = CDFMap.make;
  const API = PO.endpoint || `${CFG.url}/functions/v1/cdf-public-order`;
  const SLOTS = PO.slots || ["09:00 - 11:00", "11:00 - 13:00", "13:00 - 15:00", "15:00 - 17:00", "17:00 - 19:00", "19:00 - 21:00"];
  const METHODS = ["gcash", "maya", "bank", "cash", "other"];
  // PayMongo flow: the customer pays later with the team's link, so no proof and no method here. The server has the
  // last word (PUBLIC_ORDER_PAY_LATER, told with the session): if the two disagree the form follows the server.
  let PAY_LATER = (window.CDF_CONFIG || {}).features?.paymongo === true;
  const MAX = { reference: 6, payment_proof: 1 }, DAYS_AHEAD = 90, SLOT_LEAD = PO.slotLeadMinutes ?? 60, SEND_BYTES = 3 * 1024 * 1024, PICK_BYTES = 25 * 1024 * 1024;
  const root = document.getElementById("orderRoot");
  // The shop's day (Manila, UTC+8 all year), wherever the buyer is
  const manilaDate = (plus = 0) => new Date(Date.now() + 8 * 3600e3 + plus * 86400e3).toISOString().slice(0, 10);
  // Today's slots are offered while at least SLOT_LEAD minutes remain before they end (the server checks the same)
  const slotOpen = (date, slot) => {
    if (date !== manilaDate()) return date > manilaDate();
    const [hh, mm] = slot.split(" - ")[1].split(":").map(Number), at = new Date(Date.now() + 8 * 3600e3);
    return at.getUTCHours() * 60 + at.getUTCMinutes() + SLOT_LEAD <= hh * 60 + mm;
  };
  // The first day that can still be asked for: tomorrow once today's last slot is gone
  const firstDate = () => manilaDate(SLOTS.some((s) => slotOpen(manilaDate(), s)) ? 0 : 1);
  const phoneE164 = (raw) => {
    const s = String(raw ?? "").trim(), d = s.replace(/\D/g, "");
    if (!/^[\d\s().+-]{7,24}$/.test(s)) return null;
    const full = s.startsWith("+") ? d : s.startsWith("00") ? d.slice(2) : /^09\d{9}$/.test(d) ? "63" + d.slice(1) : /^9\d{9}$/.test(d) ? "63" + d : "";
    return /^[1-9]\d{9,14}$/.test(full) ? "+" + full : null;
  };

  const v = { buyer_name: "", buyer_phone: "", same: false, receiver_name: "", receiver_phone: "", mode: "delivery", date: "", slot: "",
    address: "", place_label: "", description: "", special_requests: "", card_message: "", payment_method: "", pickup_branch: "" };
  const files = { reference: [], payment_proof: [] }; // { id, name, url, state: "sending" | "ready" | "failed", blob, file, error }
  let view = CFG.features?.publicOrder === true ? "form" : "off", place = null, picker = null, session = null, sessionWait = null;
  let requestKey = crypto.randomUUID(), sending = false, touched = false, topError = "", doneRef = "", doneLink = "", restored = false;

  // ---------- draft ----------
  // A reload (or the phone dropping the tab) must not lose a half-written request: it is kept in this tab only
  // (sessionStorage, gone when the tab closes), with the photos already sent (their id + a small preview) and the
  // same session, so they still count. 6 hours at most. Cleared once the request is sent.
  const DRAFT = "cdf-po-draft", DRAFT_HOURS = 6;
  let draftOk = false;
  function saveDraft() {
    if (!touched || (view !== "form" && view !== "review")) return;
    if (picker) place = picker.state() || place;
    const sent = (k) => files[k].filter((f) => f.state === "ready" && f.id).map((f) => ({ id: f.id, name: f.name, thumb: f.thumb || "" }));
    try {
      sessionStorage.setItem(DRAFT, JSON.stringify({ at: Date.now(), v, place, session, requestKey, files: { reference: sent("reference"), payment_proof: sent("payment_proof") } }));
      draftOk = true;
    } catch { draftOk = false; }
  }
  const clearDraft = () => { try { sessionStorage.removeItem(DRAFT); } catch { /* nothing kept */ } };
  function loadDraft() {
    let d = null;
    try { d = JSON.parse(sessionStorage.getItem(DRAFT) || "null"); } catch { /* unreadable: start empty */ }
    if (!d || typeof d !== "object" || !(Date.now() - d.at < DRAFT_HOURS * 3600e3)) { clearDraft(); return; }
    for (const k of Object.keys(v)) if (typeof d.v?.[k] === typeof v[k]) v[k] = d.v[k];
    place = d.place && Number.isFinite(d.place.lat) && Number.isFinite(d.place.lng) ? d.place : null;
    if (typeof d.session === "string") session = d.session;
    if (/^[0-9a-f-]{36}$/i.test(d.requestKey || "")) requestKey = d.requestKey;
    for (const k of Object.keys(files)) files[k] = (d.files?.[k] || []).slice(0, MAX[k]).filter((f) => typeof f?.id === "string")
      .map((f) => ({ id: f.id, name: String(f.name || ""), url: String(f.thumb || "").startsWith("data:image/jpeg;base64,") ? f.thumb : "", thumb: f.thumb || "", state: "ready", blob: null, file: null, error: "", retry: false }));
    touched = restored = true;
  }
  function resetForm() {
    for (const k of Object.keys(v)) v[k] = typeof v[k] === "boolean" ? false : k === "mode" ? "delivery" : "";
    shops.me = null; shops.locMsg = "";
    for (const k of Object.keys(files)) { files[k].forEach((f) => f.url?.startsWith("blob:") && URL.revokeObjectURL(f.url)); files[k] = []; }
    place = null; requestKey = crypto.randomUUID(); restored = false; touched = false;
    for (const k of Object.keys(errs)) delete errs[k];
    clearDraft();
  }
  // A small preview kept with the draft, so a restored photo still shows
  async function thumbOf(blob) {
    try {
      const bmp = await createImageBitmap(blob), k = Math.min(1, 240 / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
      return c.toDataURL("image/jpeg", 0.6);
    } catch { return ""; }
  }

  // ---------- server ----------
  const headers = (extra = {}) => ({ ...(CFG.anonKey ? { apikey: CFG.anonKey, Authorization: "Bearer " + CFG.anonKey } : {}), ...(session ? { "x-cdf-session": session } : {}), ...extra });
  class ApiError extends Error { constructor(code, field, rid) { super(code); this.code = code; this.field = field; this.rid = /^[A-Za-z0-9_-]{10}$/.test(rid || "") ? rid : null; } }
  const call = async (url, init) => {
    let res;
    try { res = await fetch(url, init); } catch { throw new ApiError("network"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || "server", data.field, data.rid);
    return data;
  };
  const post = (body) => call(API, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
  // The anti-abuse check (Cloudflare Turnstile) runs once, the first time the server is needed
  // Shown only when Cloudflare needs the person to tap (fixed at the bottom, so it is seen wherever they are).
  // One deadline covers everything, the script's download included: 45 s after starting, if no pass came,
  // the form gives up, cleans up and lets the person press Send again. A first error is often passing
  // (Cloudflare's 600010): the widget retries on its own; three errors also end it. Settles exactly once.
  const TURNSTILE_JS = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  const captcha = () => new Promise((ok, fail) => {
    if (!PO.turnstileSiteKey) return ok(undefined);
    let done = false, id = null, slot = null, script = null, errors = 0;
    const end = (pass, token) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (id != null) window.turnstile?.remove(id); } catch { /* already gone */ }
      slot?.remove();
      // A download that never finished is dropped, so the next try starts a fresh one
      if (script && !window.turnstile) script.remove();
      pass ? ok(token) : fail(new ApiError("captcha"));
    };
    const timer = setTimeout(() => end(false), 45000);
    const run = () => {
      if (done) return;
      try {
        slot = h("div", { class: "po-captcha", role: "region", "aria-label": t("poCaptchaLabel") });
        document.body.append(slot);
        id = window.turnstile.render(slot, { sitekey: PO.turnstileSiteKey, action: "order_form", appearance: "interaction-only", retry: "auto", "retry-interval": 2000,
          callback: (token) => end(true, token),
          "error-callback": () => { if (++errors >= 3) end(false); return true; },
          "expired-callback": () => { try { window.turnstile.reset(id); } catch { /* */ } } });
      } catch { end(false); }
    };
    if (window.turnstile) return run();
    script = [...document.scripts].find((x) => x.src === TURNSTILE_JS) || null;
    if (!script) { script = h("script", { src: TURNSTILE_JS, async: true }); document.head.append(script); }
    script.addEventListener("load", run, { once: true });
    script.addEventListener("error", () => end(false), { once: true });
  });
  const openSession = () => (sessionWait ||= (async () => {
    const data = await post({ action: "session", captcha: await captcha() });
    session = data.session;
    if (typeof data.pay_later === "boolean" && data.pay_later !== PAY_LATER) { PAY_LATER = data.pay_later; if (view === "form") render(); }
  })().finally(() => { sessionWait = null; }));
  // Runs fn with a session; if the server no longer knows it (expired), starts a new one once.
  const withSession = async (fn) => {
    if (!session) await openSession();
    try { return await fn(); }
    catch (e) {
      if (e.code !== "session") throw e;
      session = null;
      // Photos belonged to the old session: they have to be added again
      const had = files.reference.length + files.payment_proof.length;
      for (const k of Object.keys(files)) { files[k].forEach((f) => URL.revokeObjectURL(f.url)); files[k] = []; }
      await openSession();
      if (had) { topError = t("poSessionExpired"); render(); throw new ApiError("session_lost"); }
      return await fn();
    }
  };
  const errorText = (e) => t({ network: "poErrNetwork", slow_down: "poErrSlow", quota: "poErrQuota", captcha: "poErrCaptcha", off: "poNotOpen", requests_not_open: "poNotOpen", conflict: "poErrServer",
    search_unavailable: "locSearchFail", file_too_big: "poErrBig", not_an_image: "poErrNotImage", bad_dimensions: "poErrNotImage", empty_file: "poErrNotImage",
    session_lost: "poSessionExpired", origin: "poNotOpen", heic: "poErrHeic" }[e?.code] || "poErrServer") + (e?.rid ? " (Ref: " + e.rid + ")" : "");

  // ---------- pickup shops ----------
  // The shops come from the team's data (Team → each florist's shop), open or not on the chosen day. No
  // session is needed: it is the shops' own public information. "Use my location" only sorts them here,
  // in the browser; the position is never sent anywhere.
  const shops = { list: null, forDate: undefined, loading: false, failed: false, me: null, locating: false, locMsg: "" };
  const km = (a, b) => {
    const r = (x) => (x * Math.PI) / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  };
  async function loadShops() {
    const date = v.date || null;
    if (shops.loading || (shops.list && shops.forDate === date)) return;
    shops.loading = true; shops.failed = false; paintShops();
    try {
      const data = await post({ action: "shops", ...(date ? { date } : {}) });
      shops.list = Array.isArray(data.shops) ? data.shops : []; shops.forDate = date;
      // A shop chosen before that is closed on the new day (or gone) has to be chosen again
      const still = shops.list.find((x) => x.branch === v.pickup_branch);
      if (v.pickup_branch && !still?.available) v.pickup_branch = "";
    } catch { shops.failed = true; }
    shops.loading = false;
    paintShops();
    if (v.date !== (shops.forDate ?? "") && (v.date || shops.forDate)) loadShops(); // the date changed meanwhile
  }
  function locateMe() {
    if (!navigator.geolocation) { shops.locMsg = t("locNoGps"); paintShops(); return; }
    shops.locating = true; shops.locMsg = t("locAsking"); paintShops();
    navigator.geolocation.getCurrentPosition(
      (p) => { shops.locating = false; shops.locMsg = ""; shops.me = { lat: p.coords.latitude, lng: p.coords.longitude };
        // The nearest open shop is chosen for them, unless they already chose one
        const near = sortedShops().find((x) => x.available);
        if (near && !v.pickup_branch) { v.pickup_branch = near.branch; touched = true; if (errs.pickup_branch) delete errs.pickup_branch; }
        paintShops(); },
      () => { shops.locating = false; shops.locMsg = t("poShopLocFail"); paintShops(); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  }
  const sortedShops = () => {
    const list = [...(shops.list || [])].map((x) => ({ ...x, km: shops.me ? km(shops.me, x) : null }));
    return shops.me ? list.sort((a, b) => (b.available - a.available) || a.km - b.km) : list;
  };
  let shopBox = null;
  function paintShops() {
    if (!shopBox?.isConnected) return;
    const list = sortedShops(), nearest = shops.me ? list.find((x) => x.available) : null;
    const chosen = list.find((x) => x.branch === v.pickup_branch) || null;
    const err = fields.pickup_branch?.err;
    const body = shops.loading && !shops.list ? [h("p", { class: "note", role: "status" }, t("poShopsLoading"))]
      : shops.failed ? [h("p", { class: "note", role: "alert" }, t("poShopsFail")), h("button", { type: "button", class: "btn", onclick: () => loadShops() }, t("poRetry"))]
      : !list.length ? [h("p", { class: "note" }, t("poShopsNone"))]
      : [
        h("div", { class: "po-shops", role: "radiogroup", "aria-labelledby": "po-pickup_branch-label", "aria-describedby": "po-pickup_branch-err" },
          list.map((x) => h("label", { class: "po-shop" + (x.available ? "" : " is-closed") + (x.branch === v.pickup_branch ? " is-chosen" : "") },
            h("input", { type: "radio", name: "po-shop", value: x.branch, checked: x.branch === v.pickup_branch, disabled: !x.available,
              onchange: () => { v.pickup_branch = x.branch; touched = true; if (errs.pickup_branch) { delete errs.pickup_branch; paintError("pickup_branch"); } paintShops();
                shopBox.querySelector(`input[value="${CSS.escape(x.branch)}"]`)?.focus(); } }),
            h("span", { class: "po-shop-text" },
              h("b", {}, x.branch),
              h("small", {}, !x.available ? t("poShopClosed") : x.km != null ? t("poShopKm", { km: x.km < 10 ? x.km.toFixed(1) : Math.round(x.km) }) : x.branch === v.pickup_branch ? t("poShopChosen") : t("poShopTap"))),
            x === nearest ? h("span", { class: "po-shop-near" }, t("poShopNearest")) : null))),
        h("div", { class: "po-shop-tools" },
          h("button", { type: "button", class: "btn", disabled: shops.locating, onclick: locateMe }, t("poShopUseLocation")),
          shops.locMsg ? h("span", { class: "note", role: "status" }, shops.locMsg) : null),
        chosen ? h("div", { class: "po-shop-detail", role: "status" },
          h("span", { class: "po-label" }, t("poShopAddress")),
          h("p", {}, chosen.address || chosen.branch),
          h("a", { class: "link-out", target: "_blank", rel: "noopener", href: `https://www.google.com/maps/search/?api=1&query=${chosen.lat},${chosen.lng}` }, t("poShopMap"))) : null];
    shopBox.replaceChildren(...body, err || "");
    if (err) paintError("pickup_branch");
  }

  // ---------- photos ----------
  // Shrunk in the browser to save the visitor's data (and it drops camera and location data on the way).
  // A file the browser cannot read as a picture is refused here; the server refuses it too.
  async function shrink(file) {
    if (file.size > PICK_BYTES) throw new ApiError("file_too_big");
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch { throw new ApiError(/hei[cf]/i.test(file.type + " " + file.name) ? "heic" : "not_an_image"); }
    for (const [side, quality] of [[1600, 0.82], [1280, 0.75], [1024, 0.7]]) {
      const k = Math.min(1, side / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", quality));
      if (blob && blob.size <= SEND_BYTES) { bmp.close?.(); return blob; }
    }
    bmp.close?.();
    throw new ApiError("file_too_big");
  }
  async function send(kind, item) {
    item.state = "sending"; item.error = ""; paintFiles(kind);
    try {
      item.blob ||= await shrink(item.file);
      item.url ||= URL.createObjectURL(item.blob);
      const data = await withSession(() => call(`${API}?action=upload&kind=${kind}`, { method: "POST", headers: headers({ "Content-Type": "image/jpeg" }), body: item.blob }));
      item.id = data.file; item.state = "ready";
      item.thumb = await thumbOf(item.blob); saveDraft();
    } catch (e) {
      if (e.code === "session_lost") return;
      item.state = "failed"; item.error = errorText(e);
      // Worth trying again only when the photo itself was fine
      item.retry = !["not_an_image", "heic", "file_too_big", "quota"].includes(e.code);
    }
    if (files[kind].includes(item)) {
      const key = kind === "reference" ? "reference_files" : "payment_proof";
      if (item.state === "ready" && errs[key]) { delete errs[key]; paintError(key); }
      paintFiles(kind);
    }
  }
  function addFiles(kind, list) {
    const room = MAX[kind] - files[kind].length, picked = [...list];
    for (const file of picked.slice(0, Math.max(0, room))) {
      const item = { name: file.name, file, state: "sending", id: null, url: "", blob: null, error: "", retry: false };
      files[kind].push(item); send(kind, item);
    }
    fileNote[kind] = picked.length > room ? t("poPhotosMax", { n: MAX[kind] }) : "";
    touched = true; paintFiles(kind);
  }
  function dropFile(kind, item) {
    files[kind] = files[kind].filter((f) => f !== item);
    if (item.url) URL.revokeObjectURL(item.url);
    if (item.id && session) post({ action: "remove", file: item.id }).catch(() => {}); // the server also clears what is never sent
    fileNote[kind] = ""; paintFiles(kind);
  }
  const fileNote = { reference: "", payment_proof: "" }, fileBox = {};
  function paintFiles(kind) {
    const box = fileBox[kind];
    if (!box?.isConnected) return;
    const input = h("input", { type: "file", accept: "image/*", multiple: kind === "reference", class: "po-file-input", id: "po-" + kind,
      onchange: (e) => { addFiles(kind, e.target.files); } });
    const full = files[kind].length >= MAX[kind];
    box.replaceChildren(
      h("ul", { class: "po-photos" }, files[kind].map((f) => h("li", { class: "po-photo is-" + f.state },
        f.url ? h("img", { src: f.url, alt: t("poPhotoAlt", { name: f.name }) }) : h("span", { class: "po-photo-blank", "aria-hidden": "true" }),
        h("span", { class: "po-photo-state", role: f.state === "failed" ? "alert" : "status" }, f.state === "sending" ? t("poSendingPhoto") : f.state === "failed" ? f.error : t("poPhotoReady")),
        h("span", { class: "po-photo-actions" },
          f.state === "failed" && f.retry ? h("button", { type: "button", class: "btn", onclick: () => send(kind, f) }, t("poRetry")) : null,
          h("button", { type: "button", class: "btn", "aria-label": t("poRemovePhoto", { name: f.name }), onclick: () => dropFile(kind, f) }, t("poRemove")))))),
      full ? null : h("label", { class: "btn po-add po-add-" + kind, for: "po-" + kind }, ico(kind === "reference" ? "imagePlus" : "upload"), h("span", {}, t(kind === "reference" ? (files[kind].length ? "poAddMore" : "poAddPhotos") : "poAddProof"))),
      full ? null : input,
      h("p", { class: "note po-files-note", role: "status" }, fileNote[kind] || (kind === "reference" ? "" : t("poProofHint", { n: MAX[kind] }))));
  }

  // ---------- form ----------
  const errs = {};
  // Top to bottom, as the form reads: the first of these with an error is the one focused
  const ORDER = ["date", "slot", "pickup_branch", "location", "address", "buyer_name", "buyer_phone", "receiver_name", "receiver_phone",
    "description", "special_requests", "card_message", "reference_files", "payment_method", "payment_proof"];
  let fields = {};
  // Line icons for the form (27/11/2026 redesign); decorative only, the labels carry the meaning
  const ICONS = {
    truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    store: '<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9h18v1a3 3 0 0 1-6 0a3 3 0 0 1-6 0a3 3 0 0 1-6 0z"/><path d="M5 12.5V20h14v-7.5"/><path d="M10 20v-4h4v4"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
    chevDown: '<path d="m6 9 6 6 6-6"/>', chevRight: '<path d="m9 6 6 6-6 6"/>', check: '<path d="M20 6 9 17l-5-5"/>',
    info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4.5M12 8h.01"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    nav: '<path d="M3 11 22 2l-9 19-2-8-8-2z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    sparkles: '<path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z"/><path d="M19 15v4M21 17h-4"/>',
    note: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h10M7 14h6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    imagePlus: '<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"/><path d="M16 5h6M19 2v6"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
    arrow: '<path d="M5 12h14M13 5l7 7-7 7"/>' };
  const ico = (name) => {
    const s = h("span", { class: "po-ico", "aria-hidden": "true" });
    s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
    return s;
  };
  const req = () => h("span", { class: "po-req", "aria-hidden": "true" }, " *");
  function field(name, label, control, { hint, optional, required, icon, tile, quiet } = {}) {
    const id = "po-" + name;
    control.id = id; control.name = name;
    if (name in v) {
      control.value = v[name];
      control.addEventListener("input", () => {
        v[name] = control.value; touched = true; if (errs[name]) { delete errs[name]; paintError(name); }
        if (name === "description" && errs.reference_files && v.description.trim().length >= 3 && !files.reference.some((f) => f.state !== "ready")) { delete errs.reference_files; paintError("reference_files"); }
      });
    }
    const err = h("p", { class: "err", id: id + "-err", role: "alert" });
    const note = hint ? h("p", { class: "note", id: id + "-hint" }, hint) : null;
    control.setAttribute("aria-describedby", [note && id + "-hint", id + "-err"].filter(Boolean).join(" "));
    if (required) control.setAttribute("aria-required", "true");
    const lab = h("label", { for: id, class: quiet ? "sr-only" : null }, icon ? ico(icon) : null, label, optional ? h("span", { class: "po-optional" }, " " + t("poOptional")) : null, required ? req() : null);
    // tile: the icon sits in its own square to the left of the label and the box (buyer, receiver, payment)
    const wrap = tile
      ? h("div", { class: "field po-field po-tiled" }, h("span", { class: "po-tile", "aria-hidden": "true" }, ico(tile)), h("div", { class: "po-tiled-main" }, lab, control, note, err))
      : h("div", { class: "field po-field" + (icon ? " po-iconed" : "") }, lab, control, note, err);
    fields[name] = { wrap, control, err };
    paintError(name);
    return wrap;
  }
  function paintError(name) {
    const f = fields[name];
    if (!f) return;
    f.err.textContent = errs[name] || "";
    f.wrap.classList.toggle("invalid", !!errs[name]);
    if (f.control.setAttribute) f.control.setAttribute("aria-invalid", String(!!errs[name]));
    if (name === "slot") f.wrap.setAttribute("aria-invalid", String(!!errs.slot));
  }
  function validate() {
    for (const k of Object.keys(errs)) delete errs[k];
    const need = (k, min, key) => { if (v[k].trim().length < min) errs[k] = t(key); };
    need("buyer_name", 2, "poErrName");
    if (!phoneE164(v.buyer_phone)) errs.buyer_phone = t("poErrPhone");
    if (!v.same) { need("receiver_name", 2, "poErrName"); if (!phoneE164(v.receiver_phone)) errs.receiver_phone = t("poErrPhone"); }
    if (!v.date || v.date < firstDate() || v.date > manilaDate(DAYS_AHEAD)) errs.date = t(v.date === manilaDate() ? "poErrToday" : "poErrDate");
    if (!SLOTS.includes(v.slot)) errs.slot = t("poErrSlot");
    else if (v.date && !errs.date && !slotOpen(v.date, v.slot)) errs.slot = t("poErrSlotPast");
    if (v.mode === "delivery") {
      place = picker?.state() || place;
      if (!place) errs.location = t("poErrLocation"); else if (!place.confirmedAt) errs.location = t("poErrConfirm");
    } else if (!(shops.list || []).some((x) => x.branch === v.pickup_branch && x.available)) errs.pickup_branch = t("poErrShop");
    // A reference photo or a description is enough (the server and the database check the same)
    if (!files.reference.some((f) => f.state === "ready" && f.id) && v.description.trim().length < 3) errs.reference_files = t("poErrReference");
    if (!PAY_LATER && !files.payment_proof.some((f) => f.state === "ready" && f.id)) errs.payment_proof = t("poErrProof");
    if (!PAY_LATER && !METHODS.includes(v.payment_method)) errs.payment_method = t("poErrMethod");
    for (const [kind, key] of [["reference", "reference_files"], ["payment_proof", "payment_proof"]]) {
      if (files[kind].some((f) => f.state === "sending")) errs[key] = t("poErrSending");
      else if (files[kind].some((f) => f.state === "failed")) errs[key] = t("poErrFailedPhoto");
    }
    return Object.keys(errs);
  }
  // The delivery address stored for the team: the place chosen in the search (if any) + the customer's notes for the
  // rider (optional). The pin is the exact point; without either text, its coordinates (the server wants some text).
  const deliveryAddress = () => {
    const notes = v.address.trim(), label = v.place_label.trim().slice(0, Math.max(0, 297 - notes.length));
    const text = [label, notes].filter(Boolean).join(" · ");
    return text.length >= 8 ? text.slice(0, 300) : "Pin " + place.lat.toFixed(5) + ", " + place.lng.toFixed(5) + (text ? " · " + text : "");
  };
  const payload = () => {
    const same = v.same;
    return { request_key: requestKey, lang: LANG, buyer_name: v.buyer_name.trim(), buyer_phone: v.buyer_phone.trim(),
      receiver_name: (same ? v.buyer_name : v.receiver_name).trim(), receiver_phone: (same ? v.buyer_phone : v.receiver_phone).trim(),
      mode: v.mode, date: v.date, slot: v.slot,
      ...(v.mode === "delivery" ? { address: deliveryAddress(), lat: place.lat, lng: place.lng, location_source: place.source, location_confirmed_at: place.confirmedAt } : { pickup_branch: v.pickup_branch }),
      description: v.description.trim(), special_requests: v.special_requests.trim(), card_message: v.card_message.trim(), payment_method: v.payment_method,
      reference_files: files.reference.map((f) => f.id), payment_proof: files.payment_proof[0]?.id || null };
  };

  const section = (n, title, ...kids) => h("fieldset", { class: "po-section" }, h("legend", {}, h("span", { class: "po-step", "aria-hidden": "true" }, String(n)), title), ...kids);
  const input = (props = {}) => h("input", { class: "input", ...props });
  const area = (props = {}) => h("textarea", { rows: 3, ...props });

  function renderForm() {
    fields = {};
    const receiver = h("div", { class: "po-receiver" },
      field("receiver_name", t("poReceiverName"), input({ autocomplete: "off", maxLength: 80 }), { required: true, tile: "user" }),
      field("receiver_phone", t("poReceiverPhone"), input({ type: "tel", inputMode: "tel", autocomplete: "off", maxLength: 24, placeholder: "0917 123 4567" }), { hint: t("poPhoneHint"), required: true, tile: "phone" }));
    // Optional extras fold into one line each; they open on a tap, and stay open once something is written
    const fold = (name, label, icon, control) => {
      const f = field(name, label, control, { optional: true, quiet: true });
      const d = h("details", { class: "po-fold", open: !!v[name].trim() },
        h("summary", {}, ico(icon), h("span", { class: "po-fold-title" }, label, h("span", { class: "po-optional" }, " " + t("poOptional"))), ico("chevRight")), f);
      d.addEventListener("toggle", () => { if (d.open && !control.value) control.focus({ preventScroll: true }); });
      return d;
    };
    receiver.hidden = v.same;
    const same = h("input", { type: "checkbox", id: "po-same", checked: v.same, onchange: (e) => { v.same = e.target.checked; receiver.hidden = v.same; touched = true; } });

    const mode = (m) => h("button", { type: "button", "aria-pressed": String(v.mode === m), "data-mode": m, onclick: () => { if (v.mode !== m) { place = picker?.state() || place; v.mode = m; touched = true; render(); document.querySelector(`[data-mode=${m}]`)?.focus(); } } }, ico(m === "delivery" ? "truck" : "store"), h("span", {}, t(m === "delivery" ? "poDelivery" : "poPickup")));
    const date = input({ type: "date", min: firstDate(), max: manilaDate(DAYS_AHEAD), required: true });
    const today = h("button", { class: "po-today", type: "button", "aria-describedby": "po-date-hint", onclick: () => {
      refreshDateLimits();
      if (today.disabled) return;
      date.value = manilaDate();
      date.dispatchEvent(new Event("input", { bubbles: true }));
      date.dispatchEvent(new Event("change", { bubbles: true }));
    } }, t("today"));
    function refreshDateLimits() {
      date.min = firstDate();
      date.max = manilaDate(DAYS_AHEAD);
      today.disabled = date.min !== manilaDate();
      const hint = root.querySelector("#po-date-hint");
      if (hint) hint.textContent = t(today.disabled ? "poErrToday" : "poDateHint");
      if (hint) hint.hidden = !today.disabled;
    }
    // The time slot is a set of buttons (radio inputs under their labels), not a dropdown: all six are seen at once,
    // the ones not available today say so, and no phone or in-app browser draws its own list over the page.
    // Android's dropdown had small rows and covered the date, and some customers could not pick a time (27/11/2026).
    const slotErr = h("p", { class: "err", id: "po-slot-err", role: "alert" });
    const slotsNote = h("p", { class: "note po-slots-note", hidden: true }, ico("info"), h("span", {}, t("poSlotGone")));
    const slotItems = SLOTS.map((s, i) => {
      const id = "po-slot-" + i;
      const radio = h("input", { type: "radio", name: "po-slot", value: s, id, class: "po-slot-input", checked: v.slot === s,
        "aria-describedby": "po-slot-err",
        onchange: () => { if (!radio.checked) return; v.slot = s; touched = true; if (errs.slot) { delete errs.slot; paintError("slot"); } } });
      // "9:00 – 11:00 AM", "11:00 AM – 1:00 PM": the half of the day is said once when both ends share it
      let [a, b] = formatSlot12(s).split(" - ");
      if (a.slice(-2) === b.slice(-2)) a = a.slice(0, -3);
      const label = h("label", { for: id, class: "po-slot" }, h("span", { class: "po-slot-time" }, h("span", { class: "po-slot-part" }, a), " – ", h("span", { class: "po-slot-part" }, b)), ico("check"));
      return { s, radio, node: h("div", { class: "po-slot-item" }, radio, label) };
    });
    const slotWrap = h("div", { class: "field po-field po-slots-field", role: "radiogroup", id: "po-slot", "aria-labelledby": "po-slot-label", "aria-required": "true" },
      h("span", { id: "po-slot-label", class: "po-label" }, t("poSlot")), h("div", { class: "po-slots" }, slotItems.map((x) => x.node)), slotsNote, slotErr);
    fields.slot = { wrap: slotWrap, control: { focus: (o) => (slotItems.find((x) => x.radio.checked) || slotItems.find((x) => !x.radio.disabled))?.radio.focus(o) }, err: slotErr };
    // Today's slots that have passed (or are about to) cannot be chosen and say so; a choice dropped because of the
    // date is explained, not cleared silently
    const paintSlots = () => {
      const day = date.value || v.date;
      for (const x of slotItems) {
        const gone = !!day && !slotOpen(day, x.s);
        if (x.radio.disabled !== gone) x.radio.disabled = gone;
      }
      slotsNote.hidden = !slotItems.some((x) => x.radio.disabled);
      if (v.slot && day && !slotOpen(day, v.slot)) {
        v.slot = "";
        errs.slot = t("poErrSlotPast"); paintError("slot");
      }
      for (const x of slotItems) { const on = v.slot === x.s; if (x.radio.checked !== on) x.radio.checked = on; }
    };
    date.addEventListener("input", paintSlots);
    date.addEventListener("change", paintSlots);
    date.addEventListener("focus", refreshDateLimits);
    today.addEventListener("focus", refreshDateLimits);
    // The date reads as a day ("Thu, Nov 27, 2026"); the real date box lies on top, invisible, so a tap opens the
    // phone's own calendar
    const dateText = h("span", { class: "po-date-text", "aria-hidden": "true" });
    const paintDate = () => {
      dateText.textContent = date.value
        ? new Intl.DateTimeFormat(LANG === "es" ? "es-ES" : "en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(date.value + "T00:00:00Z"))
        : t("poPickDate");
      dateText.classList.toggle("is-empty", !date.value);
    };
    date.classList.add("po-date-input");
    date.addEventListener("input", paintDate); date.addEventListener("change", paintDate);
    date.addEventListener("click", () => { try { date.showPicker?.(); } catch {} });
    const dateField = field("date", t("poDate"), date, { hint: t("poDateHint"), quiet: true });
    date.replaceWith(h("div", { class: "po-datebox" }));
    dateField.querySelector(".po-datebox").append(ico("calendar"), dateText, date, today, ico("chevDown"));
    paintDate();

    let where = null;
    if (v.mode === "delivery") {
      picker = CDFMap.picker({ start: place, google: PO.googleMapsKey ? { key: PO.googleMapsKey, mapId: PO.googleMapId || "" } : null,
        // A chosen suggestion fills the written address only when nothing was written yet
        // The chosen search result is kept as the place's name; the text box below is only for notes to the rider
        onAddress: (text) => { v.place_label = String(text || "").slice(0, 200); },
        onChange: () => { touched = touched || !!picker?.state(); if (errs.location) { delete errs.location; paintError("location"); } },
        search: async (q) => { try { return await withSession(() => post({ action: "search", query: q })); } catch (e) { throw new Error(errorText(e)); } } });
      const address = area({ rows: 2, maxLength: 300, autocomplete: "off", placeholder: t("poAddressPh") });
      // The picker's own controls, dressed for this form: a search icon inside the box, "Set pin" next to "Use my location"
      const findBtn = picker.node.querySelector(".ll-search .btn");
      if (findBtn) { findBtn.replaceChildren(ico("search")); findBtn.setAttribute("aria-label", t("locSearch")); findBtn.classList.add("po-find"); }
      picker.node.querySelector(".loc-here")?.prepend(ico("nav"));
      const centreBtn = picker.node.querySelector(".loc-centre");
      if (centreBtn) { centreBtn.replaceChildren(ico("pin"), h("span", {}, t("poSetPin"))); centreBtn.setAttribute("aria-label", t("locPinCentre")); }
      // The confirmed pin is the delivery point; the written address only helps the rider, so editing it later
      // does not ask to confirm the pin again (22/11/2026)
      const locErr = h("p", { class: "err", id: "po-location-err", role: "alert" });
      const locWrap = h("div", { class: "field po-field po-location", role: "group", "aria-labelledby": "po-location-label", "aria-describedby": "po-location-err" },
        h("span", { id: "po-location-label", class: "po-card-head" }, ico("pin"), t("poDeliveryLocation")), picker.node, locErr,
        field("address", t("poAddress"), address, { optional: true, icon: "file" }));
      fields.location = { wrap: locWrap, control: { focus: () => picker.focus() }, err: locErr };
      paintError("location");
      // PayMongo flow: how the total is made up (no amounts here; the team works it out and sends the total)
      const feeNote = CFG.features?.paymongo === true ? h("p", { class: "note po-fee-note" }, t("feeCustomer")) : null;
      locWrap.classList.add("po-card");
      where = [locWrap, feeNote];
    } else {
      picker = null;
      shopBox = h("div", { class: "po-shop-box" });
      const shopErr = h("p", { class: "err", id: "po-pickup_branch-err", role: "alert" });
      const shopWrap = h("div", { class: "field po-field po-pickup", role: "group", "aria-labelledby": "po-pickup_branch-label" },
        h("span", { id: "po-pickup_branch-label", class: "po-card-head" }, ico("store"), t("poShop")), h("p", { class: "note" }, t("poShopHint")), shopBox);
      shopWrap.classList.add("po-card");
      fields.pickup_branch = { wrap: shopWrap, control: { focus: () => (shopBox.querySelector("input:checked, input:not(:disabled), button") || shopWrap).focus() }, err: shopErr };
      where = [shopWrap];
    }

    const method = h("select", {}, h("option", { value: "" }, t("poChoose")), METHODS.map((m) => h("option", { value: m }, t("pm_" + m))));
    fileBox.reference = h("div", { class: "po-files" }); fileBox.payment_proof = h("div", { class: "po-files" });
    const filesErr = h("p", { class: "err", id: "po-reference_files-err", role: "alert" });
    const refWrap = h("div", { class: "field po-field", role: "group", tabIndex: -1, "aria-labelledby": "po-ref-label", "aria-describedby": "po-reference_files-err" },
      h("div", { class: "po-files-head" }, ico("image"), h("div", {}, h("span", { id: "po-ref-label", class: "po-label" }, t("poPhotos"), req()), h("p", { class: "note" }, t("poPhotosHint", { n: MAX.reference })))),
      fileBox.reference, filesErr);
    fields.reference_files = { wrap: refWrap, control: refWrap, err: filesErr };

    const proofErr = h("p", { class: "err", id: "po-payment_proof-err", role: "alert" });
    const proofWrap = h("div", { class: "field po-field po-tiled", role: "group", tabIndex: -1, "aria-labelledby": "po-proof-label", "aria-describedby": "po-payment_proof-err" },
      h("span", { class: "po-tile", "aria-hidden": "true" }, ico("upload")),
      h("div", { class: "po-tiled-main" }, h("span", { id: "po-proof-label", class: "po-label" }, t("poProof"), req(), h("span", { class: "sr-only" }, " · " + t("poRequired"))), fileBox.payment_proof, proofErr));
    fields.payment_proof = { wrap: proofWrap, control: proofWrap, err: proofErr };

    const top = h("p", { class: "err po-top", role: "alert", tabIndex: -1 }, topError);
    const draftNote = restored ? h("div", { class: "po-draft", role: "status" }, h("p", { class: "note" }, t("poDraftRestored")),
      h("button", { type: "button", class: "btn", onclick: () => { resetForm(); render(); root.querySelector(".po-mode [aria-pressed=true]")?.focus(); } }, t("poDraftClear"))) : null;
    const form = h("form", { class: "po-form", noValidate: true, onsubmit: (e) => {
      e.preventDefault();
      const bad = validate();
      Object.keys(fields).forEach(paintError);
      if (bad.length) {
        topError = t(bad.length === 1 ? "poFixOne" : "poFixMany", { n: bad.length }); top.textContent = topError;
        const first = ORDER.find((k) => errs[k] && fields[k]);
        fields[first]?.wrap.scrollIntoView({ block: "center", behavior: document.documentElement.dataset.motion === "reduced" ? "auto" : "smooth" });
        fields[first]?.control.focus({ preventScroll: true });
        return;
      }
      topError = ""; view = "review"; saveDraft(); render();
    } },
      draftNote, top,
      section(1, t("poDeliveryInfo"),
        h("div", { class: "seg po-mode", role: "group", "aria-label": t("poMode") }, mode("delivery"), mode("pickup")),
        dateField, slotWrap, where),
      section(2, t("poBuyer"),
        field("buyer_name", t("poBuyerName"), input({ autocomplete: "name", maxLength: 80 }), { required: true, tile: "user" }),
        field("buyer_phone", t("poBuyerPhone"), input({ type: "tel", inputMode: "tel", autocomplete: "tel", maxLength: 24, placeholder: "0917 123 4567" }), { hint: t("poPhoneHint"), required: true, tile: "phone" })),
      section(3, t("poReceiver"), h("label", { class: "po-check", for: "po-same" }, same, h("span", {}, t("poSame"))), receiver),
      section(4, t("poOrderInfo"),
        field("description", t("poDescription"), area({ rows: 3, maxLength: 1000, placeholder: t("poDescriptionPh") }), { hint: t("poDescriptionHint"), required: true, icon: "gift" }),
        fold("special_requests", t("poSpecial"), "sparkles", area({ rows: 2, maxLength: 500 })),
        fold("card_message", t("poCard"), "note", area({ rows: 2, maxLength: 300 })),
        refWrap),
      PAY_LATER ? null : h("fieldset", { class: "po-section po-pay" }, h("legend", {}, h("span", { class: "po-step po-step-ico", "aria-hidden": "true" }, ico("card")), t("poPayment")),
        field("payment_method", t("poMethod"), method, { hint: t("poMethodHint"), tile: "card" }),
        proofWrap),
      h("button", { class: "btn primary block po-submit", type: "submit" }, h("span", {}, t("poReview")), ico("arrow")));
    paintSlots();
    root.replaceChildren(form);
    refreshDateLimits();
    paintFiles("reference"); paintFiles("payment_proof");
    Object.keys(fields).forEach(paintError);
    if (v.mode === "pickup") { paintShops(); loadShops(); }
    date.addEventListener("change", () => { if (v.mode === "pickup") loadShops(); });
    if (typeof placePill === "function") document.querySelectorAll(".po-mode").forEach(placePill);
  }

  function renderReview() {
    const p = payload();
    const edit = (selector) => {
      if (sending) return;
      view = "form"; topError = ""; render();
      root.querySelector(selector)?.focus();
    };
    const row = (k, val, target) => !val ? [] : [
      h("dt", {}, k, target ? h("button", { class: "linkish po-edit-row", type: "button",
        "aria-label": t("poEditBlock", { section: k }), onclick: () => edit(target) }, t("edit")) : null),
      h("dd", {}, val),
    ];
    const day = new Intl.DateTimeFormat(locale(), { dateStyle: "full", timeZone: "UTC" }).format(new Date(p.date + "T00:00:00Z"));
    const pics = (list) => (list.length ? h("ul", { class: "po-photos po-photos-review" }, list.map((f) => h("li", { class: "po-photo" }, h("img", { src: f.url, alt: t("poPhotoAlt", { name: f.name }) })))) : null);
    const msg = h("p", { class: "err", role: "alert" }, topError);
    const sendBtn = h("button", { class: "btn primary block", type: "button", onclick: async () => {
      if (sending) return;
      sending = true; sendBtn.disabled = back.disabled = true; sendBtn.classList.add("busy"); msg.textContent = ""; sendBtn.textContent = t("poSending");
      try {
        const answer = await withSession(() => post({ action: "submit", ...p }));
        doneRef = answer?.ref ? (answer.shared_number ? "#" + String(answer.ref).padStart(4, "0") : "R" + answer.ref) : "";
        // With PayMongo on: their own page to come back to (the total and the button to pay appear there)
        doneLink = CFG.features?.paymongo === true && /^[A-Za-z0-9_-]{30,80}$/.test(answer?.status_token || "") ? location.origin + "/solicitud.html#" + answer.status_token : "";
        view = "done";
        // Nothing of the request stays in the page (or in the tab's draft) once it is sent
        resetForm();
        render();
      } catch (e) {
        sending = false;
        if (e.field && e.code !== "files") {
          // The server disagreed with something: back to the form, on that field
          const name = e.field === "location" ? "location" : e.field;
          if (name === "pickup_branch") { shops.list = null; v.pickup_branch = ""; }
          view = "form"; topError = t("poFixOne"); render();
          if (fields[name]) { errs[name] = t(name === "slot" && v.date === manilaDate() ? "poErrSlotPast" : "poErrServerField"); paintError(name); fields[name].wrap.scrollIntoView({ block: "center" }); }
          return;
        }
        if (e.code === "session_lost") { view = "form"; render(); return; }
        topError = e.code === "files" ? t("poSessionExpired") : errorText(e); msg.textContent = topError; topError = "";
        sendBtn.disabled = back.disabled = false; sendBtn.classList.remove("busy"); sendBtn.textContent = t("poSend");
      }
    } }, t("poSend"));
    const back = h("button", { class: "btn block", type: "button", onclick: () => { view = "form"; topError = ""; render(); } }, t("poEdit"));
    root.replaceChildren(h("section", { class: "po-review", "aria-labelledby": "po-review-h" },
      h("h2", { id: "po-review-h", tabIndex: -1 }, t("poReviewTitle")),
      h("p", { class: "note" }, t("poReviewHint")),
      h("dl", { class: "po-summary" },
        row(t("poBuyer"), `${p.buyer_name} · ${phoneE164(p.buyer_phone)}`, "#po-buyer_name"),
        row(t("poReceiver"), v.same ? t("poSameShort") : `${p.receiver_name} · ${phoneE164(p.receiver_phone)}`, v.same ? "#po-same" : "#po-receiver_name"),
        row(t("poWhen"), `${day} · ${formatSlot12(p.slot)}`, "#po-date"),
        row(t(p.mode === "delivery" ? "poDelivery" : "poPickup"), p.mode === "delivery" ? p.address : (() => {
          const x = (shops.list || []).find((y) => y.branch === p.pickup_branch);
          return [h("b", {}, p.pickup_branch), x?.address ? h("span", { class: "po-review-addr" }, " · " + x.address) : null];
        })(), ".po-mode [aria-pressed=true]"),
        p.mode === "delivery" ? row(t("poLocation"), t("locConfirmed")) : [],
        row(t("poDescription"), p.description, "#po-description"), row(t("poSpecial"), p.special_requests), row(t("poCard"), p.card_message),
        PAY_LATER ? [] : row(t("poMethod"), t("pm_" + p.payment_method)),
        row(t("poPhotos"), pics(files.reference), "[aria-labelledby=po-ref-label]"), row(t("poProof"), files.payment_proof.length ? [pics(files.payment_proof), h("p", { class: "note" }, t("poProofPending"))] : null)),
      h("p", { class: "note po-notice" }, t(PAY_LATER ? "poNoticePayLater" : "poNotice")), msg, sendBtn, back));
    root.querySelector("h2").focus();
  }

  function render() {
    if (view === "off") root.replaceChildren(h("div", { class: "card po-done" }, h("h2", {}, t("poOffTitle")), h("p", {}, t("poOff"))));
    // PayMongo: the customer goes straight to their request's page and waits there for the total and the button to pay
    else if (view === "done" && doneLink) location.replace(doneLink);
    else if (view === "done") {
      root.replaceChildren(h("div", { class: "card po-done", role: "status" }, h("h2", { tabIndex: -1 }, t("poDoneTitle")),
        doneRef ? h("p", { class: "po-ref" }, t("poRef"), " ", h("b", {}, doneRef)) : null,
        h("p", {}, t("poDone")), h("p", { class: "note" }, t("poDoneNote")),
        doneLink ? [h("a", { class: "btn primary block", href: doneLink }, t("rsOpen")), h("p", { class: "note" }, t("rsSave")),
          h("button", { class: "btn block", type: "button", onclick: async (e) => {
            try { await navigator.clipboard.writeText(doneLink); e.target.textContent = t("rsCopied"); setTimeout(() => { e.target.textContent = t("rsCopy"); }, 2000); } catch { /* the button above still opens it */ }
          } }, t("rsCopy"))] : null));
      root.querySelector("h2").focus();
    } else if (view === "review") renderReview();
    else renderForm();
  }

  applyStatic(); applyPrefs();
  document.addEventListener("langchange", () => { if (picker) place = picker.state() || place; render(); });
  // The draft is saved whenever the page may go away; leaving only asks first when something would be lost
  // (a photo still sending, or a browser that does not let the page keep the draft)
  window.addEventListener("pagehide", saveDraft);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveDraft(); });
  window.addEventListener("beforeunload", (e) => {
    if (!touched || view === "done" || view === "off") return;
    saveDraft();
    if (!draftOk || Object.values(files).some((l) => l.some((f) => f.state === "sending"))) { e.preventDefault(); e.returnValue = ""; }
  });
  if (view === "form") loadDraft();
  render();
})();
