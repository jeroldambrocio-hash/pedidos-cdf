// The map, shared by the panel (Lalamove's "pick on the map") and the public order form.
// It needs nothing from the panel: only t() from i18n.js.
//   · The panel uses Leaflet with OpenStreetMap tiles (served from this site, loaded on first use).
//   · The public form's picker uses Google Maps with address suggestions as you type when a browser key is
//     configured, and falls back to Leaflet plus the server's search when it is not, or when Google fails
//     to load. Either way the person searches, adjusts the pin and confirms; only then does the point count.
const CDFMap = (() => {
  const inPH = (lat, lng) => lat >= 4 && lat <= 21.5 && lng >= 116 && lng <= 127;
  const MANILA = { lat: 14.6, lng: 121.03 };
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

  // Google Maps, loaded once and only when a picker asks for it. The key is a browser key: it is meant to
  // be public, restricted in Google Cloud to this site and to the Maps JavaScript and Places APIs, with a
  // daily quota there (that quota, not this page, is what caps the cost).
  let gm = null;
  const loadGoogle = (key) => (gm ||= new Promise((ok, fail) => {
    if (window.google?.maps?.importLibrary) return ok(window.google.maps);
    const timer = setTimeout(() => fail(new Error("google maps: timeout")), 15000);
    window.gm_authFailure = () => { gm = null; document.dispatchEvent(new Event("cdf-google-maps-failed")); };
    window.__cdfGoogleMaps = () => { clearTimeout(timer); ok(window.google.maps); };
    const sc = make("script", { async: true, src: "https://maps.googleapis.com/maps/api/js?" + new URLSearchParams({ key, v: "weekly", loading: "async",
      libraries: "maps,marker,places", language: typeof LANG === "string" ? LANG : "en", region: "PH", callback: "__cdfGoogleMaps" }) });
    sc.onerror = () => { clearTimeout(timer); fail(new Error("google maps: not loaded")); };
    document.head.append(sc);
  }).catch((e) => { gm = null; throw e; }));

  // What a picker needs from a map, whichever one it is:
  //   show(lat, lng, recentre)  draw the pin there        centre()  the middle of the view
  //   resize()                  the box changed size
  // onPick(lat, lng) is called when the person drags the pin or taps the map.
  async function leafletMap(holder, at, onPick) {
    const L = await load();
    holder.replaceChildren();
    const map = L.map(holder, { scrollWheelZoom: false }).setView(at ? [at.lat, at.lng] : [MANILA.lat, MANILA.lng], at ? 17 : 12);
    tiles(L, map);
    // The pin appears once there is a point: an empty map does not suggest one was chosen
    const pin = L.marker(map.getCenter(), { draggable: true, keyboard: false, title: t("mapPinTitle"), icon: pinIcon(L) });
    if (at) pin.setLatLng([at.lat, at.lng]).addTo(map);
    pin.on("dragend", () => { const c = pin.getLatLng(); onPick(c.lat, c.lng); });
    map.on("click", (e) => onPick(e.latlng.lat, e.latlng.lng));
    setTimeout(() => map.invalidateSize(), 400);
    return {
      clear: () => { pin.remove(); },
      show: (lat, lng, recentre) => { pin.setLatLng([lat, lng]); if (!map.hasLayer(pin)) pin.addTo(map); if (recentre) map.setView([lat, lng], Math.max(map.getZoom(), 17)); },
      centre: () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; },
      resize: () => map.invalidateSize(),
    };
  }
  async function googleMap(holder, at, onPick, { key, mapId }) {
    const maps = await loadGoogle(key);
    const { Map: GMap } = await maps.importLibrary("maps"), markerLib = await maps.importLibrary("marker");
    holder.replaceChildren();
    const map = new GMap(holder, { center: at || MANILA, zoom: at ? 17 : 12, ...(mapId ? { mapId } : {}), clickableIcons: false, gestureHandling: "cooperative",
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false, restriction: { latLngBounds: { north: 21.5, south: 4, west: 116, east: 127 } } });
    const num = (v) => (typeof v === "function" ? v() : v), where = (p) => ({ lat: num(p.lat), lng: num(p.lng) });
    // The newer marker needs a map ID; without one the classic marker does the same job
    let pin = null;
    const place = (pos) => {
      if (pin) { if (mapId) { pin.position = pos; pin.map = map; } else { pin.setPosition(pos); pin.setMap(map); } return; }
      pin = mapId ? new markerLib.AdvancedMarkerElement({ map, position: pos, gmpDraggable: true, title: t("mapPinTitle") })
        : new markerLib.Marker({ map, position: pos, draggable: true, title: t("mapPinTitle") });
      pin.addListener("dragend", (e) => { const p = where(e?.latLng || (mapId ? pin.position : pin.getPosition())); onPick(p.lat, p.lng); });
    };
    if (at) place(at);
    map.addListener("click", (e) => { if (e.latLng) { const p = where(e.latLng); onPick(p.lat, p.lng); } });
    return {
      clear: () => { if (pin) { if (mapId) pin.map = null; else pin.setMap(null); } },
      show: (lat, lng, recentre) => { place({ lat, lng }); if (recentre) { map.setCenter({ lat, lng }); if (map.getZoom() < 17) map.setZoom(17); } },
      centre: () => where(map.getCenter()),
      resize: () => maps.event?.trigger?.(map, "resize"),
    };
  }
  // One Google map per page, however many times the form is drawn again (language, delivery/pickup, back
  // from the review): Google counts every new map as a map load, so the same one is moved, not rebuilt.
  let shared = null;
  const sharedGoogle = (opts, into) => (shared ||= (() => {
    const holder = make("div", { class: "map-pick loc-map", role: "application", "aria-label": t("locMapLabel") }, make("p", { class: "note" }, t("mapLoading")));
    const target = { onPick: () => {} };
    into.replaceWith(holder);
    return googleMap(holder, null, (lat, lng) => target.onPick(lat, lng), opts).then((view) => ({ holder, view, target }));
  })().catch((e) => { shared = null; throw e; }));

  // Suggestions as the person types, from Google Places. One session token covers the keystrokes and the
  // choice that ends them (that is how Google bills a search as one), and a new one starts after each choice.
  async function googleSuggest(key) {
    const maps = await loadGoogle(key), { AutocompleteSessionToken, AutocompleteSuggestion } = await maps.importLibrary("places");
    let token = new AutocompleteSessionToken();
    // The same text asked twice in one session (typing, deleting, typing again) is answered from here.
    // It is emptied with the session: a kept suggestion would carry a token that is no longer valid.
    const seen = new Map();
    return async (input) => {
      const text = input.toLowerCase();
      if (seen.has(text)) return seen.get(text);
      const mine = token;
      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({ input, sessionToken: token, includedRegionCodes: ["ph"],
        language: typeof LANG === "string" ? LANG : "en", region: "ph", locationBias: { west: 120.9, south: 14.35, east: 121.15, north: 14.8 } });
      const items = (suggestions || []).filter((s) => s.placePrediction).slice(0, 5).map((s) => ({
        label: String(s.placePrediction.text?.text ?? s.placePrediction.text ?? ""),
        // The exact point is asked for only once a suggestion is chosen
        resolve: async () => {
          const found = s.placePrediction.toPlace();
          // Only the point and its address: both belong to the cheapest Place Details tier (Essentials)
          await found.fetchFields({ fields: ["location", "formattedAddress"] });
          token = new AutocompleteSessionToken(); seen.clear();
          const p = found.location;
          return { lat: typeof p.lat === "function" ? p.lat() : p.lat, lng: typeof p.lng === "function" ? p.lng() : p.lng, address: found.formattedAddress || "" };
        },
      }));
      if (mine === token) seen.set(text, items);
      return items;
    };
  }

  // An inline picker: search an address, choose a result, adjust the pin, then confirm.
  //   search(query) → Promise<[{ label, lat, lng }]> or { results, credit }   (the page's own search; used
  //                   with the Leaflet map, and whenever Google is not available)
  //   google          { key, mapId } to use Google Maps and its suggestions; omitted or without a key: Leaflet
  //   onChange()      called whenever the chosen point or its confirmation changes
  //   onAddress(text) called with the address of a chosen suggestion (the page may offer it as the written one)
  // The point only counts once confirmed, and any later change (pin, result, device location, or the
  // page calling invalidate() because the written address changed) asks for confirmation again.
  // The device's location is used only when the person presses the button for it.
  //   start           { lat, lng, source, confirmedAt } to open on a point chosen before (a redrawn page)
  function picker({ search, google = null, onChange = () => {}, onAddress = () => {}, start = null }) {
    let view = null, point = start ? { lat: start.lat, lng: start.lng } : null, source = start?.source || null,
      confirmedAt = start?.confirmedAt || null, suggest = null, typing = null, asked = 0;
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
      view?.show(point.lat, point.lng, recentre);
      paint();
    };
    const smooth = () => node.querySelector(".loc-map")?.scrollIntoView({ block: "nearest", behavior: document.documentElement.dataset.motion === "reduced" ? "auto" : "smooth" });
    const list = (items, credit) => results.replaceChildren(...items.map((r) => make("li", {}, make("button", { type: "button", class: "loc-result", onclick: async (e) => {
      try {
        e.currentTarget.disabled = true;
        const at = r.resolve ? await r.resolve() : r;
        results.replaceChildren();
        put(at.lat, at.lng, "search", true); say(t("locAdjust")); smooth();
        if (at.address) onAddress(at.address);
      } catch { say(t("locSearchFail"), true); }
    } }, r.label))), credit ? make("li", { class: "note loc-credit" }, t("locGoogle")) : null);
    const run = async () => {
      clearTimeout(typing);
      const text = query.value.trim(), mine = ++asked;
      if (text.length < 3) { say(t("locTypeMore"), true); query.focus(); return; }
      find.disabled = true; find.classList.add("busy"); say(t("locSearching"));
      try {
        const found = suggest ? await suggest(text) : await search(text), items = Array.isArray(found) ? found : found?.results;
        if (mine !== asked) return; // a newer search is on its way
        if (!items?.length) { results.replaceChildren(); say(t("mapNoHits"), true); return; }
        say(t("locPick", { n: items.length }));
        list(items, suggest ? true : found?.credit === "google");
      } catch (e) { if (mine === asked) { results.replaceChildren(); say((!suggest && e?.message) || t("locSearchFail"), true); } }
      finally { if (mine === asked) { find.disabled = false; find.classList.remove("busy"); } }
    };
    find.addEventListener("click", run);
    query.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } });
    // With Google, suggestions follow the typing: after half a second's pause and from three letters, never
    // per key (each request that reaches Google is counted)
    query.addEventListener("input", () => {
      if (!suggest) return;
      clearTimeout(typing);
      if (query.value.trim().length < 3) { asked++; results.replaceChildren(); say(""); return; }
      typing = setTimeout(run, 500);
    });
    here.addEventListener("click", () => {
      if (!navigator.geolocation) { say(t("locNoGps"), true); return; }
      here.disabled = true; say(t("locAsking"));
      navigator.geolocation.getCurrentPosition(
        (p) => { here.disabled = false; say(t("locAdjust")); put(p.coords.latitude, p.coords.longitude, "device", true); },
        () => { here.disabled = false; say(t("locDenied"), true); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
    // Without dragging: move the map with the arrow keys (or by panning), then drop the pin in its centre
    centre.addEventListener("click", () => { if (view) { const c = view.centre(); put(c.lat, c.lng, "pin"); say(t("locAdjust")); } });
    confirm.addEventListener("click", () => { if (!point) return; confirmedAt = new Date().toISOString(); say(""); paint(); edit.focus(); });
    edit.addEventListener("click", () => { confirmedAt = null; say(t("locAdjust")); paint(); query.focus(); });

    const node = make("div", { class: "loc-picker" },
      make("div", { class: "ll-search" }, query, find), status, results, holder,
      make("div", { class: "loc-tools" }, here, centre), where,
      make("div", { class: "loc-confirm-row" }, confirm, done, edit));

    const onPick = (lat, lng) => put(lat, lng, "pin");
    const ready = (v) => { view = v; centre.disabled = false; };
    const box = () => node.querySelector(".loc-map");
    const useLeaflet = () => {
      suggest = null; node.dataset.map = "leaflet";
      const fresh = make("div", { class: "map-pick loc-map", role: "application", "aria-label": t("locMapLabel") }, make("p", { class: "note" }, t("mapLoading")));
      box().replaceWith(fresh);
      return leafletMap(fresh, point, onPick).then(ready);
    };
    const failed = () => box().replaceChildren(make("p", { class: "err", role: "alert" }, t("mapFail")));
    const useGoogle = () => {
      const was = shared;
      Promise.all([sharedGoogle(google, box()), googleSuggest(google.key)]).then(([g, s]) => {
        if (!node.isConnected) return; // the form was drawn again meanwhile: the newer picker takes the map
        if (box() !== g.holder) box().replaceWith(g.holder);
        g.target.onPick = onPick;
        if (point) g.view.show(point.lat, point.lng, true); else if (was) g.view.clear();
        ready(g.view); suggest = s;
      // Google did not load (offline, blocked, key refused): the form still works with the other map
      }).catch(() => { if (node.isConnected) useLeaflet().catch(failed); });
    };
    if (google?.key) {
      node.dataset.map = "google";
      // Loaded when the map comes near the screen, not when the page opens: a visitor who leaves before
      // reaching it, or who chooses pickup, costs no map load. Already loaded: used at once.
      if (shared || !("IntersectionObserver" in window)) queueMicrotask(useGoogle);
      else {
        const near = new IntersectionObserver((seen) => { if (seen.some((e) => e.isIntersecting)) { near.disconnect(); useGoogle(); } }, { rootMargin: "300px" });
        near.observe(node);
        query.addEventListener("focus", () => { near.disconnect(); if (!shared && !view) useGoogle(); }, { once: true });
      }
      document.addEventListener("cdf-google-maps-failed", () => { shared = null; if (node.isConnected && node.dataset.map === "google") { view = null; centre.disabled = true; useLeaflet().catch(failed); } }, { once: true });
    } else queueMicrotask(() => useLeaflet().catch(failed));

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
      resize: () => view?.resize(),
      seed: (text) => { if (!query.value) query.value = text; },
    };
  }
  return { inPH, load, tiles, pinIcon, picker, make };
})();
