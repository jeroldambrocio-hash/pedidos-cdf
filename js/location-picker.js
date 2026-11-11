// The map, shared by the panel (Lalamove's "pick on the map") and the public order form.
// It needs nothing from the panel: only t() from i18n.js. Leaflet and its styles are served from this
// site and loaded the first time a map is opened; the tiles are OpenStreetMap's.
const CDFMap = (() => {
  const inPH = (lat, lng) => lat >= 4 && lat <= 21.5 && lng >= 116 && lng <= 127;
  const make = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k in e && k !== "list") e[k] = v; else e.setAttribute(k, v === true ? "" : v);
    }
    e.append(...kids.flat().filter((x) => x != null));
    return e;
  };
  let lib = null;
  const load = () => (lib ||= new Promise((ok, fail) => {
    if (window.L?.map) return ok(window.L);
    document.head.append(make("link", { rel: "stylesheet", href: "/js/vendor/leaflet.css" }));
    const sc = make("script", { src: "/js/vendor/leaflet.js" });
    sc.onload = () => (window.L?.map ? ok(window.L) : fail(new Error("map")));
    sc.onerror = () => fail(new Error("map"));
    document.head.append(sc);
  }).catch((e) => { lib = null; throw e; }));
  const tiles = (L, map) => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
  const pinIcon = (L) => L.divIcon({ className: "map-pin", html: "<span></span>", iconSize: [30, 30], iconAnchor: [15, 29] });

  // An inline picker: search an address, choose a result, adjust the pin, then confirm.
  //   search(query) → Promise<[{ label, lat, lng }]>   (the page decides where that goes)
  //   onChange()      called whenever the chosen point or its confirmation changes
  // The point only counts once confirmed, and any later change (pin, result, device location, or the
  // page calling invalidate() because the written address changed) asks for confirmation again.
  // The device's location is used only when the person presses the button for it.
  //   start           { lat, lng, source, confirmedAt } to open on a point chosen before (a redrawn page)
  function picker({ search, onChange = () => {}, start = null }) {
    let map = null, pin = null, point = start ? { lat: start.lat, lng: start.lng } : null, source = start?.source || null,
      confirmedAt = start?.confirmedAt || null, wanted = point;
    const id = "loc" + Math.random().toString(36).slice(2, 7);
    const status = make("p", { class: "note loc-status", role: "status" });
    const query = make("input", { class: "input", id: id + "q", type: "search", enterKeyHint: "search", autocomplete: "off", placeholder: t("locSearchPh"), "aria-label": t("locSearchPh") });
    const find = make("button", { class: "btn", type: "button" }, t("locSearch"));
    const results = make("ul", { class: "loc-results", "aria-label": t("locResults") });
    const holder = make("div", { class: "map-pick loc-map", role: "application", "aria-label": t("locMapLabel") }, make("p", { class: "note" }, t("mapLoading")));
    const here = make("button", { class: "btn loc-here", type: "button" }, t("locUseMine"));
    const centre = make("button", { class: "btn loc-centre", type: "button", disabled: true }, t("locPinCentre"));
    const where = make("p", { class: "note loc-where" }, t("locNoPin"));
    const confirm = make("button", { class: "btn primary loc-confirm", type: "button", disabled: true }, t("locConfirm"));
    const done = make("p", { class: "loc-done", hidden: true });
    const edit = make("button", { class: "btn loc-edit", type: "button", hidden: true }, t("locEdit"));
    const say = (text, bad = false) => { status.textContent = text || ""; status.classList.toggle("err", !!bad && !!text); };

    const paint = () => {
      const ok = !!confirmedAt;
      confirm.hidden = ok; confirm.disabled = !point;
      done.hidden = edit.hidden = !ok;
      done.textContent = ok ? t("locConfirmed") : "";
      where.textContent = point ? t("locAt", { point: `${point.lat}, ${point.lng}` }) : t("locNoPin");
      node.classList.toggle("is-confirmed", ok);
      onChange();
    };
    const unconfirm = () => { if (confirmedAt) { confirmedAt = null; say(t("locChanged")); } };
    const put = (lat, lng, from, recentre) => {
      if (!Number.isFinite(+lat) || !Number.isFinite(+lng)) return;
      if (!inPH(+lat, +lng)) { say(t("mapOutside"), true); return; }
      unconfirm();
      point = { lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6) }; source = from;
      if (map) { pin.setLatLng([point.lat, point.lng]); if (!map.hasLayer(pin)) pin.addTo(map); if (recentre) map.setView([point.lat, point.lng], Math.max(map.getZoom(), 17)); }
      else wanted = point;
      paint();
    };
    const run = async () => {
      const text = query.value.trim();
      if (text.length < 3) { say(t("locTypeMore"), true); query.focus(); return; }
      find.disabled = true; find.classList.add("busy"); say(t("locSearching")); results.replaceChildren();
      try {
        const list = await search(text);
        if (!list?.length) { say(t("mapNoHits"), true); return; }
        say(t("locPick", { n: list.length }));
        results.replaceChildren(...list.map((r) => make("li", {}, make("button", { type: "button", class: "loc-result", onclick: () => {
          put(r.lat, r.lng, "search", true); results.replaceChildren(); say(t("locAdjust"));
          holder.scrollIntoView({ block: "nearest", behavior: document.documentElement.dataset.motion === "reduced" ? "auto" : "smooth" });
        } }, r.label))));
      } catch (e) { say(e?.message || t("locSearchFail"), true); }
      finally { find.disabled = false; find.classList.remove("busy"); }
    };
    find.addEventListener("click", run);
    query.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } });
    here.addEventListener("click", () => {
      if (!navigator.geolocation) { say(t("locNoGps"), true); return; }
      here.disabled = true; say(t("locAsking"));
      navigator.geolocation.getCurrentPosition(
        (p) => { here.disabled = false; say(t("locAdjust")); put(p.coords.latitude, p.coords.longitude, "device", true); },
        () => { here.disabled = false; say(t("locDenied"), true); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
    // Without dragging: move the map with the arrow keys (or by panning), then drop the pin in its centre
    centre.addEventListener("click", () => { if (map) { const c = map.getCenter(); put(c.lat, c.lng, "pin"); say(t("locAdjust")); } });
    confirm.addEventListener("click", () => { if (!point) return; confirmedAt = new Date().toISOString(); say(""); paint(); edit.focus(); });
    edit.addEventListener("click", () => { confirmedAt = null; say(t("locAdjust")); paint(); query.focus(); });

    const node = make("div", { class: "loc-picker" },
      make("div", { class: "ll-search" }, query, find), status, results, holder,
      make("div", { class: "loc-tools" }, here, centre), where,
      make("div", { class: "loc-confirm-row" }, confirm, done, edit));

    load().then((L) => {
      holder.replaceChildren();
      const at = wanted ? [wanted.lat, wanted.lng] : null;
      map = L.map(holder, { scrollWheelZoom: false }).setView(at || [14.6, 121.03], at ? 17 : 12);
      tiles(L, map);
      // The pin appears once there is a point: an empty map does not suggest one was chosen
      pin = L.marker(map.getCenter(), { draggable: true, keyboard: false, title: t("mapPinTitle"), icon: pinIcon(L) });
      if (at) pin.setLatLng(at).addTo(map);
      pin.on("dragend", () => { const c = pin.getLatLng(); put(c.lat, c.lng, "pin"); });
      map.on("click", (e) => put(e.latlng.lat, e.latlng.lng, "pin"));
      centre.disabled = false;
      setTimeout(() => map?.invalidateSize(), 400);
    }).catch(() => { holder.replaceChildren(make("p", { class: "err", role: "alert" }, t("mapFail"))); });

    paint();
    return {
      node,
      // { lat, lng, source: "search" | "pin" | "device", confirmedAt } once confirmed; otherwise null
      value: () => (point && confirmedAt ? { ...point, source, confirmedAt } : null),
      // The same, confirmed or not (to draw the page again without losing the pin)
      state: () => (point ? { ...point, source, confirmedAt } : null),
      pending: () => !!point && !confirmedAt,
      invalidate: () => { if (confirmedAt) { unconfirm(); paint(); } },
      focus: () => (confirmedAt ? edit : point ? confirm : query).focus(),
      resize: () => map?.invalidateSize(),
      seed: (text) => { if (!query.value) query.value = text; },
    };
  }
  return { inPH, load, tiles, pinIcon, picker, make };
})();
