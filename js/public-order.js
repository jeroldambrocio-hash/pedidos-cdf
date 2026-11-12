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
  const MAX = { reference: 6, payment_proof: 1 }, DAYS_AHEAD = 90, SEND_BYTES = 3 * 1024 * 1024, PICK_BYTES = 25 * 1024 * 1024;
  const root = document.getElementById("orderRoot");
  // The shop's day (Manila, UTC+8 all year), wherever the buyer is
  const manilaDate = (plus = 0) => new Date(Date.now() + 8 * 3600e3 + plus * 86400e3).toISOString().slice(0, 10);
  const phoneE164 = (raw) => {
    const s = String(raw ?? "").trim(), d = s.replace(/\D/g, "");
    if (!/^[\d\s().+-]{7,24}$/.test(s)) return null;
    const full = s.startsWith("+") ? d : s.startsWith("00") ? d.slice(2) : /^09\d{9}$/.test(d) ? "63" + d.slice(1) : /^9\d{9}$/.test(d) ? "63" + d : "";
    return /^[1-9]\d{9,14}$/.test(full) ? "+" + full : null;
  };

  const v = { buyer_name: "", buyer_phone: "", same: false, receiver_name: "", receiver_phone: "", mode: "delivery", date: "", slot: "",
    address: "", description: "", special_requests: "", card_message: "", payment_method: "" };
  const files = { reference: [], payment_proof: [] }; // { id, name, url, state: "sending" | "ready" | "failed", blob, file, error }
  let view = CFG.features?.publicOrder === true ? "form" : "off", place = null, picker = null, session = null, sessionWait = null;
  let requestKey = crypto.randomUUID(), sending = false, touched = false, topError = "", doneRef = "";

  // ---------- server ----------
  const headers = (extra = {}) => ({ ...(CFG.anonKey ? { apikey: CFG.anonKey, Authorization: "Bearer " + CFG.anonKey } : {}), ...(session ? { "x-cdf-session": session } : {}), ...extra });
  class ApiError extends Error { constructor(code, field) { super(code); this.code = code; this.field = field; } }
  const call = async (url, init) => {
    let res;
    try { res = await fetch(url, init); } catch { throw new ApiError("network"); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || "server", data.field);
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
    session_lost: "poSessionExpired", origin: "poNotOpen", heic: "poErrHeic" }[e?.code] || "poErrServer");

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
    } catch (e) {
      if (e.code === "session_lost") return;
      item.state = "failed"; item.error = errorText(e);
      // Worth trying again only when the photo itself was fine
      item.retry = !["not_an_image", "heic", "file_too_big", "quota"].includes(e.code);
    }
    if (files[kind].includes(item)) paintFiles(kind);
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
      full ? null : h("label", { class: "btn po-add", for: "po-" + kind }, t(kind === "reference" ? (files[kind].length ? "poAddMore" : "poAddPhotos") : "poAddProof")),
      full ? null : input,
      h("p", { class: "note", role: "status" }, fileNote[kind] || t(kind === "reference" ? "poPhotosHint" : "poProofHint", { n: MAX[kind] })));
  }

  // ---------- form ----------
  const errs = {};
  // Top to bottom, as the form reads: the first of these with an error is the one focused
  const ORDER = ["buyer_name", "buyer_phone", "receiver_name", "receiver_phone", "date", "slot", "address", "location",
    "description", "special_requests", "card_message", "reference_files", "payment_method"];
  let fields = {};
  function field(name, label, control, { hint, optional } = {}) {
    const id = "po-" + name;
    control.id = id; control.name = name;
    if (name in v) {
      control.value = v[name];
      control.addEventListener("input", () => { v[name] = control.value; touched = true; if (errs[name]) { delete errs[name]; paintError(name); } });
    }
    const err = h("p", { class: "err", id: id + "-err", role: "alert" });
    const note = hint ? h("p", { class: "note", id: id + "-hint" }, hint) : null;
    control.setAttribute("aria-describedby", [note && id + "-hint", id + "-err"].filter(Boolean).join(" "));
    const wrap = h("div", { class: "field po-field" }, h("label", { for: id }, label, optional ? h("span", { class: "po-optional" }, " " + t("poOptional")) : null), control, note, err);
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
  }
  function validate() {
    for (const k of Object.keys(errs)) delete errs[k];
    const need = (k, min, key) => { if (v[k].trim().length < min) errs[k] = t(key); };
    need("buyer_name", 2, "poErrName");
    if (!phoneE164(v.buyer_phone)) errs.buyer_phone = t("poErrPhone");
    if (!v.same) { need("receiver_name", 2, "poErrName"); if (!phoneE164(v.receiver_phone)) errs.receiver_phone = t("poErrPhone"); }
    if (!v.date || v.date < manilaDate() || v.date > manilaDate(DAYS_AHEAD)) errs.date = t("poErrDate");
    if (!SLOTS.includes(v.slot)) errs.slot = t("poErrSlot");
    if (v.mode === "delivery") {
      need("address", 8, "poErrAddress");
      place = picker?.state() || place;
      if (!place) errs.location = t("poErrLocation"); else if (!place.confirmedAt) errs.location = t("poErrConfirm");
    }
    need("description", 3, "poErrDescription");
    if (!METHODS.includes(v.payment_method)) errs.payment_method = t("poErrMethod");
    const all = [...files.reference, ...files.payment_proof];
    if (all.some((f) => f.state === "sending")) errs.reference_files = t("poErrSending");
    else if (all.some((f) => f.state === "failed")) errs.reference_files = t("poErrFailedPhoto");
    return Object.keys(errs);
  }
  const payload = () => {
    const same = v.same;
    return { request_key: requestKey, lang: LANG, buyer_name: v.buyer_name.trim(), buyer_phone: v.buyer_phone.trim(),
      receiver_name: (same ? v.buyer_name : v.receiver_name).trim(), receiver_phone: (same ? v.buyer_phone : v.receiver_phone).trim(),
      mode: v.mode, date: v.date, slot: v.slot,
      ...(v.mode === "delivery" ? { address: v.address.trim(), lat: place.lat, lng: place.lng, location_source: place.source, location_confirmed_at: place.confirmedAt } : {}),
      description: v.description.trim(), special_requests: v.special_requests.trim(), card_message: v.card_message.trim(), payment_method: v.payment_method,
      reference_files: files.reference.map((f) => f.id), payment_proof: files.payment_proof[0]?.id || null };
  };

  const section = (n, title, ...kids) => h("fieldset", { class: "po-section" }, h("legend", {}, h("span", { class: "po-step", "aria-hidden": "true" }, String(n)), title), ...kids);
  const input = (props = {}) => h("input", { class: "input", ...props });
  const area = (props = {}) => h("textarea", { rows: 3, ...props });

  function renderForm() {
    fields = {};
    const receiver = h("div", { class: "po-receiver row2" },
      field("receiver_name", t("poReceiverName"), input({ autocomplete: "off", maxLength: 80 })),
      field("receiver_phone", t("poReceiverPhone"), input({ type: "tel", inputMode: "tel", autocomplete: "off", maxLength: 24, placeholder: "0917 123 4567" }), { hint: t("poPhoneHint") }));
    receiver.hidden = v.same;
    const same = h("input", { type: "checkbox", id: "po-same", checked: v.same, onchange: (e) => { v.same = e.target.checked; receiver.hidden = v.same; touched = true; } });

    const mode = (m) => h("button", { type: "button", "aria-pressed": String(v.mode === m), "data-mode": m, onclick: () => { if (v.mode !== m) { place = picker?.state() || place; v.mode = m; touched = true; render(); document.querySelector(`[data-mode=${m}]`)?.focus(); } } }, t(m === "delivery" ? "poDelivery" : "poPickup"));
    const date = input({ type: "date", min: manilaDate(), max: manilaDate(DAYS_AHEAD), required: true });
    const slot = h("select", {}, h("option", { value: "" }, t("poChoose")), SLOTS.map((s) => h("option", { value: s }, s.replace(" - ", " – "))));

    let where = null;
    if (v.mode === "delivery") {
      picker = CDFMap.picker({ start: place, google: PO.googleMapsKey ? { key: PO.googleMapsKey, mapId: PO.googleMapId || "" } : null,
        // A chosen suggestion fills the written address only when nothing was written yet
        onAddress: (text) => { if (!v.address.trim() && fields.address) { v.address = text.slice(0, 300); fields.address.control.value = v.address; if (errs.address) { delete errs.address; paintError("address"); } } },
        onChange: () => { touched = touched || !!picker?.state(); if (errs.location) { delete errs.location; paintError("location"); } },
        search: async (q) => { try { return await withSession(() => post({ action: "search", query: q })); } catch (e) { throw new Error(errorText(e)); } } });
      const address = area({ rows: 3, maxLength: 300, autocomplete: "off", placeholder: t("poAddressPh") });
      // The pin was confirmed for the address as it was written then
      address.addEventListener("change", () => picker.invalidate());
      const locErr = h("p", { class: "err", id: "po-location-err", role: "alert" });
      const locWrap = h("div", { class: "field po-field po-location", role: "group", "aria-labelledby": "po-location-label", "aria-describedby": "po-location-err" },
        h("span", { id: "po-location-label", class: "po-label" }, t("poLocation")), h("p", { class: "note" }, t("poLocationHint")), picker.node, locErr);
      fields.location = { wrap: locWrap, control: { focus: () => picker.focus() }, err: locErr };
      paintError("location");
      where = [field("address", t("poAddress"), address, { hint: t("poAddressHint") }), locWrap];
    } else { picker = null; where = [h("p", { class: "note po-pickup-note" }, t("poPickupNote"))]; }

    const method = h("select", {}, h("option", { value: "" }, t("poChoose")), METHODS.map((m) => h("option", { value: m }, t("pm_" + m))));
    fileBox.reference = h("div", { class: "po-files" }); fileBox.payment_proof = h("div", { class: "po-files" });
    const filesErr = h("p", { class: "err", id: "po-reference_files-err", role: "alert" });
    const refWrap = h("div", { class: "field po-field", role: "group", "aria-labelledby": "po-ref-label" },
      h("span", { id: "po-ref-label", class: "po-label" }, t("poPhotos"), h("span", { class: "po-optional" }, " " + t("poOptional"))), fileBox.reference, filesErr);
    fields.reference_files = { wrap: refWrap, control: { focus: () => refWrap.querySelector("button, label")?.focus?.() || refWrap.scrollIntoView() }, err: filesErr };

    const top = h("p", { class: "err po-top", role: "alert", tabIndex: -1 }, topError);
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
      topError = ""; view = "review"; render();
    } },
      top,
      section(1, t("poBuyer"), h("div", { class: "row2" },
        field("buyer_name", t("poBuyerName"), input({ autocomplete: "name", maxLength: 80 })),
        field("buyer_phone", t("poBuyerPhone"), input({ type: "tel", inputMode: "tel", autocomplete: "tel", maxLength: 24, placeholder: "0917 123 4567" }), { hint: t("poPhoneHint") }))),
      section(2, t("poReceiver"), h("label", { class: "po-check", for: "po-same" }, same, h("span", {}, t("poSame"))), receiver),
      section(3, t("poDeliveryInfo"),
        h("div", { class: "seg po-mode", role: "group", "aria-label": t("poMode") }, mode("delivery"), mode("pickup")),
        h("div", { class: "row2" }, field("date", t("poDate"), date, { hint: t("poDateHint") }), field("slot", t("poSlot"), slot)), where),
      section(4, t("poOrderInfo"),
        field("description", t("poDescription"), area({ rows: 4, maxLength: 1000, placeholder: t("poDescriptionPh") })),
        field("special_requests", t("poSpecial"), area({ rows: 2, maxLength: 500 }), { optional: true }),
        field("card_message", t("poCard"), area({ rows: 2, maxLength: 300 }), { optional: true }),
        refWrap,
        field("payment_method", t("poMethod"), method, { hint: t("poMethodHint") }),
        h("div", { class: "field po-field", role: "group", "aria-labelledby": "po-proof-label" },
          h("span", { id: "po-proof-label", class: "po-label" }, t("poProof"), h("span", { class: "po-optional" }, " " + t("poOptional"))), fileBox.payment_proof)),
      h("button", { class: "btn primary block", type: "submit" }, t("poReview")));
    root.replaceChildren(form);
    paintFiles("reference"); paintFiles("payment_proof");
    Object.keys(fields).forEach(paintError);
    if (typeof placePill === "function") document.querySelectorAll(".po-mode").forEach(placePill);
  }

  function renderReview() {
    const p = payload(), row = (k, val) => (val ? [h("dt", {}, k), h("dd", {}, val)] : []);
    const day = new Intl.DateTimeFormat(locale(), { dateStyle: "full", timeZone: "UTC" }).format(new Date(p.date + "T00:00:00Z"));
    const pics = (list) => (list.length ? h("ul", { class: "po-photos po-photos-review" }, list.map((f) => h("li", { class: "po-photo" }, h("img", { src: f.url, alt: t("poPhotoAlt", { name: f.name }) })))) : null);
    const msg = h("p", { class: "err", role: "alert" }, topError);
    const sendBtn = h("button", { class: "btn primary block", type: "button", onclick: async () => {
      if (sending) return;
      sending = true; sendBtn.disabled = back.disabled = true; sendBtn.classList.add("busy"); msg.textContent = ""; sendBtn.textContent = t("poSending");
      try {
        const answer = await withSession(() => post({ action: "submit", ...p }));
        doneRef = answer?.ref ? "R" + answer.ref : "";
        view = "done"; touched = false;
        // Nothing of the request stays in the page once it is sent
        for (const k of Object.keys(v)) v[k] = typeof v[k] === "boolean" ? false : k === "mode" ? "delivery" : "";
        for (const k of Object.keys(files)) { files[k].forEach((f) => f.url && URL.revokeObjectURL(f.url)); files[k] = []; }
        place = null; requestKey = crypto.randomUUID();
        render();
      } catch (e) {
        sending = false;
        if (e.field && e.code !== "files") {
          // The server disagreed with something: back to the form, on that field
          const name = e.field === "location" ? "location" : e.field;
          view = "form"; topError = t("poFixOne"); render();
          if (fields[name]) { errs[name] = t("poErrServerField"); paintError(name); fields[name].wrap.scrollIntoView({ block: "center" }); }
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
        row(t("poBuyer"), `${p.buyer_name} · ${phoneE164(p.buyer_phone)}`),
        row(t("poReceiver"), v.same ? t("poSameShort") : `${p.receiver_name} · ${phoneE164(p.receiver_phone)}`),
        row(t("poWhen"), `${day} · ${p.slot.replace(" - ", " – ")}`),
        row(t(p.mode === "delivery" ? "poDelivery" : "poPickup"), p.mode === "delivery" ? p.address : t("poPickupShort")),
        p.mode === "delivery" ? row(t("poLocation"), t("locConfirmed")) : [],
        row(t("poDescription"), p.description), row(t("poSpecial"), p.special_requests), row(t("poCard"), p.card_message),
        row(t("poMethod"), t("pm_" + p.payment_method)),
        row(t("poPhotos"), pics(files.reference)), row(t("poProof"), files.payment_proof.length ? [pics(files.payment_proof), h("p", { class: "note" }, t("poProofPending"))] : null)),
      h("p", { class: "note po-notice" }, t("poNotice")), msg, sendBtn, back));
    root.querySelector("h2").focus();
  }

  function render() {
    if (view === "off") root.replaceChildren(h("div", { class: "card po-done" }, h("h2", {}, t("poOffTitle")), h("p", {}, t("poOff"))));
    else if (view === "done") {
      root.replaceChildren(h("div", { class: "card po-done", role: "status" }, h("h2", { tabIndex: -1 }, t("poDoneTitle")),
        doneRef ? h("p", { class: "po-ref" }, t("poRef"), " ", h("b", {}, doneRef)) : null,
        h("p", {}, t("poDone")), h("p", { class: "note" }, t("poDoneNote"))));
      root.querySelector("h2").focus();
    } else if (view === "review") renderReview();
    else renderForm();
  }

  applyStatic(); applyPrefs();
  document.addEventListener("langchange", () => { if (picker) place = picker.state() || place; render(); });
  // Leaving with a half-written request asks first; nothing is saved for later
  window.addEventListener("beforeunload", (e) => { if (touched && view !== "done" && view !== "off") { e.preventDefault(); e.returnValue = ""; } });
  render();
})();
