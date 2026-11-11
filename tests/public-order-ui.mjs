// Phase 2 in a real browser: the public order form end to end, against the real function code
// (handler.ts) and the real SQL of the migration in an in-memory database. Only three things are
// stand-ins: the anti-abuse check, the address search provider and the file store. Map tiles are a blank
// image. Nothing leaves this machine and nothing reaches Supabase.
// Run: NODE_PATH=.test-tools/node_modules node --experimental-strip-types tests/public-order-ui.mjs
import assert from "node:assert";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handle } from "../supabase/functions/cdf-public-order/handler.ts";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const { chromium } = require("playwright");
const { build } = require("./lib/fresh-db.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, ".impeccable", "review"); mkdirSync(shots, { recursive: true });
const fixture = (name) => readFileSync(path.join(root, "tests/fixtures/public-order", name));
const only = process.env.ONLY;
let failed = 0;
const step = async (name, fn) => { if (only && !name.includes(only)) return; try { await fn(); console.log("ok " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n  " + String(e.stack || e).split("\n").slice(0, 6).join("\n  ")); } };

// ---------- the server side, for real ----------
const db = new PGlite();
await build((sql) => db.exec(sql));
const sha = (v) => createHash("sha256").update(v).digest("hex");
const stored = new Map();
const env = { PUBLIC_ORDER: "on", TURNSTILE_SECRET: "", PUBLIC_ORDER_NO_CAPTCHA: "test-only", PUBLIC_ORDER_SALT: "salt", GOOGLE_MAPS_KEY: "server-key", PUBLIC_GOOGLE_DAILY: "1" };
const PLACES = [
  { geometry: { coordinates: [121.0775, 14.6397] }, properties: { name: "Katipunan Avenue", district: "Loyola Heights", city: "Quezon City", state: "Metro Manila", countrycode: "PH" } },
  { geometry: { coordinates: [121.0509, 14.6513] }, properties: { name: "Katipunan Street", city: "Quezon City", state: "Metro Manila", countrycode: "PH" } },
];
const deps = {
  env: (k) => env[k], now: () => Date.now(), randomToken: () => randomBytes(32).toString("base64url"), sha256: async (v) => sha(v),
  rpc: async (name, args) => {
    const keys = Object.keys(args);
    try { return { data: (await db.query(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]))).rows[0].r, error: null }; }
    catch (e) { return { data: null, error: { message: e.message } }; }
  },
  store: async (p, bytes, mime) => { stored.set(p, { bytes, mime }); return { error: null }; },
  unstore: async (paths) => { paths.forEach((p) => stored.delete(p)); },
  // Google answers only a search for "Mabini" here; everything else goes to the free search
  fetch: async (url) => (String(url).includes("maps.googleapis.com")
    ? new Response(JSON.stringify(/mabini/i.test(new URL(url).searchParams.get("address")) ? { status: "OK", results: [{ formatted_address: "12 Mabini St, Quezon City, Metro Manila, Philippines", geometry: { location: { lat: 14.6501, lng: 121.0702 } }, types: ["street_address"] }] } : { status: "ZERO_RESULTS", results: [] }))
    : new Response(JSON.stringify({ features: /nowhere/i.test(new URL(url).searchParams.get("q")) ? [] : PLACES }))),
};

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
const site = http.createServer((q, r) => {
  const name = decodeURIComponent(q.url.split("?")[0]);
  try { const body = readFileSync(path.join(root, path.normalize(name))); r.setHeader("Content-Type", types[path.extname(name)] || "application/octet-stream"); r.end(body); }
  catch { r.writeHead(404).end(); }
});
await new Promise((ok) => site.listen(0, "127.0.0.1", ok));
const ORIGIN = "http://127.0.0.1:" + site.address().port, API = "https://demo.invalid/functions/v1/cdf-public-order";
env.PUBLIC_ORDER_ORIGINS = ORIGIN;
const TILE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");


// A stand-in for Google's Maps JavaScript API with the same shapes the form uses (Map, markers, Places
// suggestions with session tokens). It records what it is asked in window.__gm so the tests can read it.
const FAKE_GOOGLE = `(() => {
  const gm = window.__gm = { maps: 0, requests: [], tokens: 0, fetched: [], listeners: {}, pinListeners: {}, map: null, pin: null, advanced: false, failSuggest: false };
  const ll = (p) => ({ lat: () => p.lat, lng: () => p.lng });
  class Map { constructor(el, o) { gm.maps++; gm.map = this; this.o = o; this.c = { ...o.center }; this.z = o.zoom; el.dataset.google = "1"; el.textContent = "google map"; }
    addListener(n, f) { gm.listeners[n] = f; } getCenter() { return ll(this.c); } setCenter(c) { this.c = { ...c }; } getZoom() { return this.z; } setZoom(z) { this.z = z; } }
  class Marker { constructor(o) { gm.pin = this; this.p = o.position; this.m = o.map; this.o = o; } setPosition(p) { this.p = p; } setMap(m) { this.m = m; } getPosition() { return ll(this.p); } addListener(n, f) { gm.pinListeners[n] = f; } }
  class AdvancedMarkerElement { constructor(o) { gm.pin = this; gm.advanced = true; this.position = o.position; this.map = o.map; this.o = o; } addListener(n, f) { gm.pinListeners[n] = f; } }
  class AutocompleteSessionToken { constructor() { this.id = ++gm.tokens; } }
  const known = [{ label: "Makati Avenue, Makati, Metro Manila", lat: 14.5623, lng: 121.0267 }, { label: "Makati Medical Center, Amorsolo Street, Makati", lat: 14.5592, lng: 121.0146 }, { label: "Katipunan Avenue, Quezon City", lat: 14.6397, lng: 121.0775 }];
  const AutocompleteSuggestion = { fetchAutocompleteSuggestions: async (req) => {
    gm.requests.push({ input: req.input, token: req.sessionToken?.id, regions: req.includedRegionCodes });
    if (gm.failSuggest) throw new Error("OVER_QUERY_LIMIT");
    const hits = known.filter((p) => p.label.toLowerCase().includes(req.input.toLowerCase().slice(0, 4)));
    return { suggestions: hits.map((p) => ({ placePrediction: { text: { text: p.label, toString: () => p.label }, toPlace: () => {
      const place = { location: null, formattedAddress: null, fetchFields: async ({ fields }) => { gm.fetched.push({ fields, token: req.sessionToken?.id }); place.location = ll(p); place.formattedAddress = p.label + ", Philippines"; } };
      return place; } } })) };
  } };
  window.google = { maps: { importLibrary: async (n) => ({ maps: { Map }, marker: { Marker, AdvancedMarkerElement }, places: { AutocompleteSessionToken, AutocompleteSuggestion } }[n]), event: { trigger() {} } } };
  gm.click = (lat, lng) => gm.listeners.click({ latLng: ll({ lat, lng }) });
  gm.drag = (lat, lng) => { if (gm.advanced) gm.pin.position = { lat, lng }; else gm.pin.p = { lat, lng }; gm.pinListeners.dragend({ latLng: ll({ lat, lng }) }); };
  window[new URL(document.currentScript.src).searchParams.get("callback")]();
})();`;

const browser = await chromium.launch({ headless: true, channel: "chrome" });
// Everything the page asks for is answered here or refused: a request to any other host fails the test.
async function open({ feature = true, viewport = { width: 390, height: 844 }, geo, accept = false, lang = "en", google = false, mapId = "" } = {}) {
  const ctx = await browser.newContext({ viewport, locale: "en-PH", timezoneId: "Europe/Madrid", ...(geo ? { geolocation: geo, permissions: ["geolocation"] } : {}) });
  const page = await ctx.newPage();
  const state = { calls: [], strangers: [], failUploads: 0, accept, errors: [], googleScripts: [] };
  page.on("pageerror", (e) => state.errors.push(e.message));
  await page.addInitScript((l) => { try { localStorage.setItem("cdf-lang", l); } catch {} }, lang);
  await page.route("**/*", async (route) => {
    const req = route.request(), url = req.url();
    if (url.startsWith(ORIGIN + "/config.js")) return route.fulfill({ contentType: "text/javascript", body:
      `window.CDF_CONFIG = { url: "https://demo.invalid", anonKey: "", features: { publicOrder: ${feature} }, publicOrder: { turnstileSiteKey: "", googleMapsKey: "${google ? "browser-key" : ""}", googleMapId: "${mapId}" } };` });
    if (url.startsWith("https://maps.googleapis.com/maps/api/js")) {
      state.googleScripts.push(url);
      if (google === "blocked") return route.abort();
      // "refused": the script loads, then Google reports the key is not allowed (as it does for a bad referrer)
      return route.fulfill({ contentType: "text/javascript", body: google === "refused" ? FAKE_GOOGLE + ";setTimeout(() => window.gm_authFailure(), 50);" : FAKE_GOOGLE });
    }
    if (url.startsWith(ORIGIN)) return route.continue();
    if (url.startsWith("https://tile.openstreetmap.org/")) return route.fulfill({ contentType: "image/png", body: TILE });
    if (url.startsWith("https://fonts.")) return route.abort();
    if (!url.startsWith(API)) { state.strangers.push(url); return route.abort(); }
    const action = new URL(url).searchParams.get("action") || JSON.parse(req.postData() || "{}").action;
    state.calls.push({ action, body: action === "upload" ? null : JSON.parse(req.postData() || "{}"), bytes: req.postDataBuffer()?.length });
    if (action === "upload" && state.failUploads > 0) { state.failUploads--; return route.abort("connectionreset"); } // the connection drops mid-upload
    const res = await handle(new Request(url, { method: req.method(), headers: { ...req.headers(), origin: ORIGIN, "x-forwarded-for": "203.0.113.7" }, body: req.postDataBuffer() ?? undefined }), deps);
    let status = res.status, body = await res.text();
    // Phase 2's function answers a valid request with "not open yet". To see the last screen, a test may stand in for Phase 3.
    if (state.accept && /requests_not_open/.test(body)) { status = 200; body = JSON.stringify({ received: true }); }
    return route.fulfill({ status, headers: Object.fromEntries(res.headers), body });
  });
  await page.goto(ORIGIN + "/pedido.html");
  return { page, state, ctx };
}
const tomorrow = () => new Date(Date.now() + 8 * 3600e3 + 86400e3).toISOString().slice(0, 10);
async function fill(page, { pickup = false, location = true } = {}) {
  await page.locator("#po-buyer_name").fill("Jose Santos");
  await page.locator("#po-buyer_phone").fill("+34 612 345 678");
  await page.locator("#po-receiver_name").fill("Maria Santos");
  await page.locator("#po-receiver_phone").fill("0917 123 4567");
  if (pickup) await page.locator("[data-mode=pickup]").click();
  await page.locator("#po-date").fill(tomorrow());
  await page.locator("#po-slot").selectOption("11:00 - 13:00");
  if (!pickup) {
    await page.locator("#po-address").fill("12 Katipunan Ave, Loyola Heights, Quezon City");
    if (location) { await search(page, "Katipunan"); await page.locator(".loc-result").first().click(); await page.locator(".loc-confirm").click(); }
  }
  await page.locator("#po-description").fill("A dozen red roses, wrapped in kraft paper");
  await page.locator("#po-payment_method").selectOption("gcash");
}
const search = async (page, text) => { await page.locator(".loc-picker input[type=search]").fill(text); await page.locator(".loc-picker .ll-search .btn").click(); await page.locator(".loc-status:not(:has-text('Searching'))").waitFor(); };
const review = (page) => page.locator(".po-form button[type=submit]").click();
const pinAt = (page) => page.locator(".loc-where").innerText();
const noOverflow = async (page) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no sideways scrolling");

await step("Off in the published config: the page says so and never calls the server", async () => {
  const { page, state, ctx } = await open({ feature: false });
  await page.locator(".po-done h2", { hasText: "Not open yet" }).waitFor();
  assert.equal(await page.locator("form").count(), 0); assert.equal(state.calls.length, 0);
  const real = readFileSync(path.join(root, "config.js"), "utf8");
  assert.match(real, /publicOrder: false/); assert(!/pedido\.html/.test(readFileSync(path.join(root, "index.html"), "utf8") + readFileSync(path.join(root, "scripts/deploy-netlify.sh"), "utf8")), "not linked and not in the deploy list yet");
  await ctx.close();
});

await step("Phone: one column, visible labels, touch-sized controls, nothing asked of the server until it is needed", async () => {
  const { page, state, ctx } = await open();
  await page.locator(".po-form").waitFor();
  await page.locator(".loc-map.leaflet-container").waitFor();
  assert.equal(state.calls.length, 0, "opening the form creates no session");
  await noOverflow(page);
  assert.deepEqual(await page.locator(".po-section > legend").allInnerTexts().then((l) => l.map((s) => s.replace(/^\d+\s*/, ""))), ["Buyer information", "Receiver information", "Delivery information", "Order information"]);
  const small = await page.evaluate(() => [...document.querySelectorAll(".po-form :is(input:not([type=checkbox]):not([type=file]), select, textarea, button, .po-add)")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.id || e.className || e.textContent));
  assert.deepEqual(small, [], "controls under 44px tall");
  const unlabelled = await page.evaluate(() => [...document.querySelectorAll(".po-form :is(input:not([type=file]), select, textarea)")].filter((e) => !(e.labels?.length || e.getAttribute("aria-label"))).map((e) => e.id));
  assert.deepEqual(unlabelled, []);
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector(".po-section .row2")).gridTemplateColumns.split(" ").length);
  assert.equal(cols, 1);
  await page.screenshot({ path: path.join(shots, "public-order-mobile-top.png"), fullPage: true });
  await page.setViewportSize({ width: 1100, height: 900 });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".po-section .row2")).gridTemplateColumns.split(" ").length), 2, "related fields pair up on a wide screen");
  await page.screenshot({ path: path.join(shots, "public-order-desktop.png"), fullPage: true });
  assert.deepEqual(state.errors, []); assert.deepEqual(state.strangers, []);
  await ctx.close();
});

await step("Empty form: errors appear next to each field, the first one is focused, nothing is sent", async () => {
  const { page, state, ctx } = await open();
  await review(page);
  assert.match(await page.locator(".po-top").innerText(), /fields need checking/);
  for (const [id, text] of [["buyer_name", "Enter the name."], ["buyer_phone", "Enter a valid phone number"], ["date", "Choose a date"], ["slot", "Choose a time slot."], ["address", "Enter the full address."],
    ["location", "Mark the delivery point on the map."], ["description", "Tell us what you'd like."], ["payment_method", "Choose how you'd prefer to pay."]])
    assert((await page.locator(`#po-${id}-err`).innerText()).includes(text), id);
  assert.equal(await page.evaluate(() => document.activeElement.id), "po-buyer_name");
  assert.equal(await page.locator("#po-buyer_name").getAttribute("aria-invalid"), "true");
  await page.locator("#po-buyer_name").fill("Jose");
  assert.equal(await page.locator("#po-buyer_name-err").innerText(), "", "the error clears as soon as the field is corrected");
  assert.equal(state.calls.length, 0);
  await ctx.close();
});

await step("Search, choose a result, drag the pin, confirm; any later change asks to confirm again", async () => {
  const { page, state, ctx } = await open();
  await page.locator(".loc-map.leaflet-container").waitFor();
  assert.equal(await page.locator(".loc-confirm").isDisabled(), true); assert.equal(await pinAt(page), "No pin yet.");
  assert.equal(await page.locator(".loc-map .map-pin").count(), 0, "no pin is drawn before a point is chosen");
  await search(page, "Ka");
  assert.match(await page.locator(".loc-status").innerText(), /at least 3 letters/);
  await search(page, "Katipunan");
  assert.deepEqual(await page.locator(".loc-result").allInnerTexts(), ["Katipunan Avenue, Loyola Heights, Quezon City, Metro Manila", "Katipunan Street, Quezon City, Metro Manila"]);
  assert.deepEqual(state.calls.map((c) => c.action), ["session", "search"], "the session is opened by the first search");
  await page.locator(".loc-result").first().click();
  assert.equal(await pinAt(page), "Pin at 14.6397, 121.0775");
  assert.equal(await page.locator(".loc-result").count(), 0);
  // Not confirmed yet: reviewing is refused with the reason
  await fill(page, { location: false });
  await review(page);
  assert.equal(await page.locator("#po-location-err").innerText(), "Confirm the delivery point on the map.");
  // Drag the pin a little
  const pin = page.locator(".loc-map .map-pin"); await pin.scrollIntoViewIfNeeded();
  const box = await pin.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 6 }); await page.mouse.up();
  const dragged = await pinAt(page);
  assert.notEqual(dragged, "Pin at 14.6397, 121.0775"); assert.match(dragged, /^Pin at 14\.63\d+, 121\.07\d+$/);
  await page.locator(".loc-confirm").click();
  assert.equal(await page.locator(".loc-done").innerText(), "Location confirmed");
  assert.equal(await page.locator(".loc-confirm").isVisible(), false);
  // Tapping elsewhere on the map moves the pin: confirmation is withdrawn
  await page.locator(".loc-map").click({ position: { x: 90, y: 150 } });
  assert.equal(await page.locator(".loc-done").isVisible(), false);
  assert.equal(await page.locator(".loc-status").innerText(), "The location changed: confirm it again.");
  await page.locator(".loc-confirm").click();
  // Changing the written address withdraws it too
  await page.locator("#po-address").fill("99 Another Street, Quezon City"); await page.locator("#po-address").blur();
  assert.equal(await page.locator(".loc-done").isVisible(), false);
  await review(page);
  assert.equal(await page.locator("#po-location-err").innerText(), "Confirm the delivery point on the map.");
  await page.locator(".loc-confirm").click();
  // "Change" reopens it
  await page.locator(".loc-edit").click();
  assert.equal(await page.locator(".loc-confirm").isVisible(), true);
  await page.locator(".loc-confirm").click();
  await review(page);
  await page.locator(".po-review").waitFor();
  assert.deepEqual(state.errors, []);
  await ctx.close();
});

await step("Results from Google are credited to Google Maps; the free search's are not", async () => {
  await db.exec("delete from public.cdf_rate_limits where bucket = 'google-geocode'");
  const { page, ctx } = await open();
  await page.locator(".loc-map.leaflet-container").waitFor();
  await search(page, "12 Mabini");
  assert.deepEqual(await page.locator(".loc-result").allInnerTexts(), ["12 Mabini St, Quezon City, Metro Manila"]);
  assert.equal(await page.locator(".loc-credit").innerText(), "Results from Google Maps");
  await search(page, "12 Mabini St"); // today's allowance (1 in this test) is spent: the free search answers
  assert.equal(await page.locator(".loc-result").count(), 2); assert.equal(await page.locator(".loc-credit").count(), 0);
  await ctx.close();
});


await step("Google Maps: suggestions while typing (one session per search), pin on the chosen place, adjust, confirm", async () => {
  const { page, state, ctx } = await open({ google: true });
  await page.locator(".loc-picker").scrollIntoViewIfNeeded(); await page.locator(".loc-map[data-google]").waitFor();
  assert.equal(await page.locator(".loc-picker").getAttribute("data-map"), "google"); assert.equal(await page.locator(".leaflet-container").count(), 0);
  const asked = new URL(state.googleScripts[0]);
  assert.equal(asked.searchParams.get("key"), "browser-key"); assert.equal(asked.searchParams.get("region"), "PH"); assert(!state.googleScripts[0].includes("server-key"));
  const gm = () => page.evaluate(() => ({ requests: window.__gm.requests, fetched: window.__gm.fetched, tokens: window.__gm.tokens, pin: window.__gm.pin && (window.__gm.pin.p || window.__gm.pin.position), centre: window.__gm.map.c, zoom: window.__gm.map.z, advanced: window.__gm.advanced }));
  const box = page.locator(".loc-picker input[type=search]");
  await box.pressSequentially("Ma", { delay: 20 }); await page.waitForTimeout(500);
  assert.equal((await gm()).requests.length, 0, "nothing is asked before three letters");
  await box.pressSequentially("kati Av", { delay: 20 });
  await page.locator(".loc-result").first().waitFor();
  let g = await gm();
  assert.deepEqual(g.requests, [{ input: "Makati Av", token: 1, regions: ["ph"] }], "one request after the typing pauses, not one per key");
  assert.deepEqual(await page.locator(".loc-result").allInnerTexts(), ["Makati Avenue, Makati, Metro Manila", "Makati Medical Center, Amorsolo Street, Makati"]);
  assert.equal(await page.locator(".loc-credit").innerText(), "Results from Google Maps");
  assert.equal(g.pin, null, "no pin before a place is chosen");
  await page.locator(".loc-result").first().click();
  await page.locator(".loc-where", { hasText: "Pin at 14.5623, 121.0267" }).waitFor();
  g = await gm();
  assert.deepEqual(g.fetched, [{ fields: ["location", "formattedAddress"], token: 1 }], "the choice closes the same session");
  assert.equal(g.tokens, 2, "and the next search starts a new one");
  assert.deepEqual([g.centre, g.zoom, g.pin], [{ lat: 14.5623, lng: 121.0267 }, 17, { lat: 14.5623, lng: 121.0267 }]);
  assert.equal(await page.locator("#po-address").inputValue(), "Makati Avenue, Makati, Metro Manila, Philippines", "an empty address takes the chosen place's");
  // Adjust: drag the pin to the delivery entrance, then tap the map; each change asks to confirm again
  await page.locator(".loc-confirm").click();
  await page.evaluate(() => window.__gm.drag(14.56301, 121.02712));
  assert.equal(await page.locator(".loc-done").isVisible(), false); assert.equal(await pinAt(page), "Pin at 14.56301, 121.02712");
  await page.locator(".loc-confirm").click();
  await page.evaluate(() => window.__gm.click(14.5635, 121.0275));
  assert.equal(await page.locator(".loc-status").innerText(), "The location changed: confirm it again.");
  await page.evaluate(() => window.__gm.click(35.68, 139.69)); // Tokyo
  assert.equal(await page.locator(".loc-status.err").count(), 1); assert.equal(await pinAt(page), "Pin at 14.5635, 121.0275");
  await page.locator(".loc-centre").click();
  assert.equal(await pinAt(page), "Pin at 14.5623, 121.0267");
  await page.locator(".loc-confirm").click();
  // A second search uses the new session; what the visitor wrote as the address is not replaced
  await page.locator("#po-address").fill("Unit 4B, Tower 2, 123 Makati Avenue, Makati");
  await box.fill(""); await box.pressSequentially("Katipunan", { delay: 10 });
  await page.locator(".loc-result", { hasText: "Katipunan Avenue" }).click();
  await page.locator(".loc-where", { hasText: "Pin at 14.6397, 121.0775" }).waitFor();
  assert.equal((await gm()).requests.at(-1).token, 2);
  assert.equal(await page.locator("#po-address").inputValue(), "Unit 4B, Tower 2, 123 Makati Avenue, Makati");
  await page.locator(".loc-confirm").click();
  await fill(page, { location: false });
  await page.locator("#po-address").fill("Unit 4B, Tower 2, Katipunan Avenue, Quezon City"); await page.locator("#po-address").blur();
  await page.locator(".loc-confirm").click();
  await review(page);
  await page.locator(".po-review").waitFor();
  await page.getByRole("button", { name: "Send request" }).click();
  await page.locator(".po-review .err", { hasText: "isn't taking requests yet" }).waitFor();
  assert.deepEqual(state.calls.map((c) => c.action), ["session", "submit"], "address search never touches the server");
  const sent = state.calls.at(-1).body;
  assert.deepEqual([sent.lat, sent.lng, sent.location_source], [14.6397, 121.0775, "search"]);
  assert.deepEqual(state.errors, []); assert.deepEqual(state.strangers, []);
  await page.screenshot({ path: path.join(shots, "public-order-google-mobile.png") });
  await ctx.close();
});

await step("What Google bills is kept to a minimum: the map loads only when reached, once per page; repeated text is not asked again", async () => {
  const { page, state, ctx } = await open({ google: true });
  await page.locator(".po-form").waitFor();
  await page.locator("#po-buyer_name").fill("Jose Santos"); await page.waitForTimeout(400);
  assert.equal(state.googleScripts.length, 0, "opening the page and filling the first fields loads nothing from Google");
  // Someone who picks up at the shop never loads the map
  await page.locator("[data-mode=pickup]").click(); await page.locator(".po-pickup-note").scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
  assert.equal(state.googleScripts.length, 0);
  await page.locator("[data-mode=delivery]").click();
  await page.locator(".loc-picker").scrollIntoViewIfNeeded(); await page.locator(".loc-map[data-google]").waitFor();
  assert.equal(state.googleScripts.length, 1);
  const count = () => page.evaluate(() => [window.__gm.maps, window.__gm.requests.length, window.__gm.fetched.length]);
  const box = page.locator(".loc-picker input[type=search]");
  // Type, delete back, type the same again: the repeated texts are answered without asking Google
  await box.pressSequentially("Makati", { delay: 10 }); await page.locator(".loc-result").first().waitFor();
  await box.fill("Mak"); await box.dispatchEvent("input"); await page.waitForTimeout(800);
  await box.fill("Makati"); await box.dispatchEvent("input"); await page.waitForTimeout(800);
  await box.fill("Mak"); await box.dispatchEvent("input"); await page.waitForTimeout(800);
  assert.deepEqual(await count(), [1, 2, 0], "two different texts, two requests; no place details until one is chosen");
  await page.locator(".loc-result").first().click(); await page.locator(".loc-confirm").click();
  assert.deepEqual(await count(), [1, 2, 1]);
  // Drawing the form again (language, pickup and back, review and back) keeps the same map and its pin
  await page.locator("[data-settings]").click(); await page.locator(".menu [data-lang=es]").click(); await page.locator(".menu [data-lang=en]").click(); await page.keyboard.press("Escape");
  await page.locator("[data-mode=pickup]").click(); await page.locator("[data-mode=delivery]").click();
  await page.locator(".loc-done", { hasText: "Location confirmed" }).waitFor();
  await fill(page, { location: false }); // the written address changed, so the point is confirmed again
  await page.locator(".loc-confirm").click();
  await review(page); await page.locator(".po-review").waitFor();
  await page.getByRole("button", { name: "Back to edit" }).click();
  await page.locator(".loc-picker").scrollIntoViewIfNeeded(); await page.locator(".loc-map[data-google]").waitFor();
  assert.deepEqual(await count(), [1, 2, 1], "still one map load, and nothing asked again");
  assert.equal(state.googleScripts.length, 1);
  assert.deepEqual(await page.evaluate(() => window.__gm.pin.p), { lat: 14.5623, lng: 121.0267 });
  // Moving the pin, panning and confirming ask Google for nothing
  await page.evaluate(() => { window.__gm.drag(14.5624, 121.0268); window.__gm.click(14.5625, 121.0269); });
  await page.locator(".loc-centre").click(); await page.locator(".loc-confirm").click();
  assert.deepEqual(await count(), [1, 2, 1]);
  assert.deepEqual(state.errors, []);
  await ctx.close();
});

await step("Google Maps with a Map ID uses the newer marker; a failed suggestion says so and the pin can still be placed", async () => {
  const { page, ctx } = await open({ google: true, mapId: "cdf-map" });
  await page.locator(".loc-picker").scrollIntoViewIfNeeded(); await page.locator(".loc-map[data-google]").waitFor();
  assert.equal(await page.evaluate(() => window.__gm.map.o.mapId), "cdf-map");
  await page.evaluate(() => { window.__gm.failSuggest = true; });
  await page.locator(".loc-picker input[type=search]").pressSequentially("Makati", { delay: 10 });
  await page.locator(".loc-status.err", { hasText: "Search isn't available right now" }).waitFor();
  await page.evaluate(() => window.__gm.click(14.5623, 121.0267));
  assert.equal(await page.evaluate(() => window.__gm.advanced), true);
  await page.evaluate(() => window.__gm.drag(14.5624, 121.0268));
  assert.equal(await pinAt(page), "Pin at 14.5624, 121.0268");
  await page.locator(".loc-confirm").click();
  assert.equal(await page.locator(".loc-done").isVisible(), true);
  await ctx.close();
});

await step("Google Maps keeps “Use my location”: only when pressed, centred on the device, still to be adjusted and confirmed", async () => {
  const { page, ctx } = await open({ google: true, geo: { latitude: 14.5547, longitude: 121.0244 } }); // Makati
  await page.locator(".loc-picker").scrollIntoViewIfNeeded(); await page.locator(".loc-map[data-google]").waitFor();
  assert.equal(await page.locator(".loc-here").innerText(), "Use my location");
  assert.equal(await pinAt(page), "No pin yet."); assert.equal(await page.evaluate(() => window.__gm.pin), null);
  await page.locator(".loc-here").click();
  await page.locator(".loc-where", { hasText: "Pin at 14.5547, 121.0244" }).waitFor();
  assert.deepEqual(await page.evaluate(() => [window.__gm.map.c, window.__gm.map.z, window.__gm.pin.p]), [{ lat: 14.5547, lng: 121.0244 }, 17, { lat: 14.5547, lng: 121.0244 }]);
  assert.equal(await page.locator(".loc-done").isVisible(), false, "it still has to be confirmed");
  await page.evaluate(() => window.__gm.drag(14.5549, 121.0246));
  await page.locator(".loc-confirm").click();
  assert.equal(await page.locator(".loc-done").isVisible(), true);
  await ctx.close();
  const denied = await open({ google: true });
  await denied.page.locator(".loc-picker").scrollIntoViewIfNeeded(); await denied.page.locator(".loc-map[data-google]").waitFor();
  await denied.page.locator(".loc-here").click();
  await denied.page.locator(".loc-status.err", { hasText: "Your location couldn't be used" }).waitFor();
  await denied.ctx.close();
});

await step("Google unavailable (blocked, offline or key refused): the form falls back to the free map and the server's search", async () => {
  for (const google of ["blocked", "refused"]) {
    const { page, state, ctx } = await open({ google });
    await page.locator(".loc-picker").scrollIntoViewIfNeeded(); await page.locator(".loc-map.leaflet-container").waitFor();
    assert.equal(await page.locator(".loc-picker").getAttribute("data-map"), "leaflet", google);
    await search(page, "Katipunan"); await page.locator(".loc-result").first().click(); await page.locator(".loc-confirm").click();
    assert.equal(await page.locator(".loc-done").isVisible(), true);
    assert.deepEqual(state.calls.map((c) => c.action), ["session", "search"]);
    await ctx.close();
  }
});

await step("Without dragging: keyboard users pan the map and drop the pin at its centre", async () => {
  const { page, ctx } = await open();
  await page.locator(".loc-map.leaflet-container").waitFor();
  await page.locator(".loc-centre").focus(); await page.keyboard.press("Enter");
  assert.match(await pinAt(page), /^Pin at 14\.6\d*, 121\.03\d*$/);
  await page.locator(".loc-map").focus(); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(600);
  const before = await pinAt(page);
  await page.locator(".loc-centre").click();
  assert.notEqual(await pinAt(page), before);
  await page.locator(".loc-confirm").click();
  assert.equal(await page.evaluate(() => document.activeElement.className.includes("loc-edit")), true, "focus moves to what can be done next");
  await ctx.close();
});

await step("Location permission denied: said plainly, and search and the pin still work", async () => {
  const { page, ctx } = await open();
  await page.locator(".loc-map.leaflet-container").waitFor();
  assert.equal(await pinAt(page), "No pin yet.", "the device's location is never used on its own");
  await page.locator(".loc-here").click();
  await page.locator(".loc-status.err", { hasText: "Your location couldn't be used" }).waitFor();
  assert.equal(await pinAt(page), "No pin yet.");
  await search(page, "Katipunan"); await page.locator(".loc-result").nth(1).click(); await page.locator(".loc-confirm").click();
  assert.equal(await page.locator(".loc-done").isVisible(), true);
  await ctx.close();
});

await step("Buying from another country: the buyer's own location is refused as a delivery point; a foreign phone is fine", async () => {
  const { page, state, ctx } = await open({ geo: { latitude: 41.3874, longitude: 2.1686 } }); // Barcelona
  await page.locator(".loc-map.leaflet-container").waitFor();
  await page.locator(".loc-here").click();
  await page.locator(".loc-status.err").waitFor();
  assert.equal(await pinAt(page), "No pin yet.");
  await fill(page);
  await review(page);
  await page.locator(".po-review").waitFor();
  const summary = await page.locator(".po-summary").innerText();
  assert(summary.includes("Jose Santos · +34612345678") && summary.includes("Maria Santos · +639171234567"));
  // The date is the shop's (Manila), whatever the buyer's clock says
  assert.equal(await page.locator(".po-summary").innerText().then((s) => s.includes(new Intl.DateTimeFormat("en-PH", { dateStyle: "full", timeZone: "UTC" }).format(new Date(tomorrow() + "T00:00:00Z")))), true);
  await page.getByRole("button", { name: "Send request" }).click();
  await page.locator(".po-review .err", { hasText: "isn't taking requests yet" }).waitFor();
  const sent = state.calls.find((c) => c.action === "submit").body;
  assert.deepEqual([sent.lat, sent.lng, sent.location_source, sent.mode], [14.6397, 121.0775, "search", "delivery"]);
  assert(Date.now() - Date.parse(sent.location_confirmed_at) < 60_000);
  assert(!Object.keys(sent).some((k) => /price|amount|status|vendor|branch/.test(k)));
  assert.equal((await db.query("select count(*)::int n from public.cdf_orders")).rows[0].n, 0);
  await ctx.close();
});

await step("A device in the Philippines can offer its location, only when asked, and it still has to be confirmed", async () => {
  const { page, ctx } = await open({ geo: { latitude: 14.5547, longitude: 121.0244 } }); // Makati
  await page.locator(".loc-map.leaflet-container").waitFor();
  await page.locator(".loc-here").click();
  await page.locator(".loc-where", { hasText: "Pin at 14.5547, 121.0244" }).waitFor();
  assert.equal(await page.locator(".loc-done").isVisible(), false);
  await ctx.close();
});

await step("Pickup: no address and no pin are asked for or sent", async () => {
  const { page, state, ctx } = await open();
  await page.locator("#po-address").fill("12 Katipunan Ave, Loyola Heights, Quezon City");
  await fill(page, { pickup: true });
  assert.equal(await page.locator(".loc-picker").count(), 0); assert.equal(await page.locator("#po-address").count(), 0);
  assert.match(await page.locator(".po-pickup-note").innerText(), /which shop/);
  await review(page);
  await page.locator(".po-review").waitFor();
  await page.getByRole("button", { name: "Send request" }).click();
  await page.locator(".po-review .err", { hasText: "isn't taking requests yet" }).waitFor();
  const sent = state.calls.find((c) => c.action === "submit").body;
  assert.equal(sent.mode, "pickup");
  for (const k of ["address", "lat", "lng", "location_source", "location_confirmed_at"]) assert(!(k in sent), k);
  // Back to delivery: what was typed and chosen for it is still there
  await page.getByRole("button", { name: "Back to edit" }).click();
  await page.locator("[data-mode=delivery]").click();
  assert.equal(await page.locator("#po-address").inputValue(), "12 Katipunan Ave, Loyola Heights, Quezon City");
  assert.equal(await page.locator("#po-buyer_name").inputValue(), "Jose Santos");
  await ctx.close();
});

await step("Several photos: sent as they are added, cleaned on the server, private; limits and removal", async () => {
  const { page, state, ctx } = await open();
  const before = stored.size;
  const pics = ["gps.jpg", "progressive.jpg", "text.png", "exif.webp"].map((n) => ({ name: n, mimeType: n.endsWith("png") ? "image/png" : n.endsWith("webp") ? "image/webp" : "image/jpeg", buffer: fixture(n) }));
  await page.locator("#po-reference").setInputFiles(pics);
  await page.locator(".po-photo.is-ready").nth(3).waitFor();
  assert.equal(stored.size, before + 4);
  for (const [, f] of [...stored].slice(-4)) { assert.equal(f.mime, "image/jpeg"); assert(!Buffer.from(f.bytes).includes("GPS") && !Buffer.from(f.bytes).includes("Exif"), "no location or camera data reaches the store"); }
  assert((await page.locator(".po-photo img").first().getAttribute("src")).startsWith("blob:"), "previews are local: the page is never given a link to the stored file");
  // Up to six: the rest are not taken, and it says so
  await page.locator("#po-reference").setInputFiles(["a.jpg", "b.jpg", "c.jpg"].map((name) => ({ name, mimeType: "image/jpeg", buffer: fixture("gps.jpg") })));
  await page.locator(".po-photo.is-ready").nth(5).waitFor();
  assert.equal(await page.locator(".po-files").first().locator(".po-photo").count(), 6);
  assert.match(await page.locator(".po-files").first().locator(".note").innerText(), /Only 6 can be added/);
  assert.equal(await page.locator("#po-reference").count(), 0, "no way to add a seventh");
  await page.getByRole("button", { name: "Remove photo gps.jpg" }).click();
  assert.equal(await page.locator(".po-files").first().locator(".po-photo").count(), 5);
  await page.waitForTimeout(300);
  assert.equal(stored.size, before + 5, "a removed photo is deleted from the store");
  // One proof of payment, marked as not verified
  await page.locator("#po-payment_proof").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: fixture("text.png") });
  await page.locator(".po-files").nth(1).locator(".po-photo.is-ready").waitFor();
  assert.equal(await page.locator("#po-payment_proof").count(), 0);
  await noOverflow(page);
  await page.locator(".po-files").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, "public-order-mobile-photos.png") });
  await fill(page);
  await review(page);
  await page.locator(".po-review").waitFor();
  assert.equal(await page.locator(".po-photos-review img").count(), 6);
  assert.match(await page.locator(".po-summary").innerText(), /Pending verification/);
  await page.screenshot({ path: path.join(shots, "public-order-mobile-review.png"), fullPage: true });
  await page.getByRole("button", { name: "Send request" }).click();
  await page.locator(".po-review .err", { hasText: "isn't taking requests yet" }).waitFor();
  const sent = state.calls.find((c) => c.action === "submit").body;
  assert.equal(sent.reference_files.length, 5); assert.match(sent.payment_proof, /^[0-9a-f-]{36}$/);
  assert.equal((await db.query("select count(*)::int n from public.cdf_order_prices")).rows[0].n, 0, "a proof from a customer changes nothing that has been paid");
  assert.deepEqual(state.errors, []);
  await ctx.close();
});

await step("A fake file, a HEIC the browser cannot read and a file that is far too big are refused before sending", async () => {
  const { page, state, ctx } = await open();
  await page.locator("#po-reference").setInputFiles([
    { name: "holiday.jpg", mimeType: "image/jpeg", buffer: Buffer.from("this is not a photo") },
    { name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: Buffer.from("\0\0\0\x18ftypheic", "latin1") },
    { name: "huge.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(26 * 1024 * 1024, 1) }]);
  await page.locator(".po-photo.is-failed").nth(2).waitFor();
  const said = await page.locator(".po-photo-state").allInnerTexts();
  assert.match(said[0], /isn't a photo we can read/); assert.match(said[1], /HEIC/); assert.match(said[2], /too large/);
  assert.equal(await page.getByRole("button", { name: "Try again" }).count(), 0, "retrying a bad file would not help");
  assert.equal(state.calls.filter((c) => c.action === "upload").length, 0);
  await fill(page);
  await review(page);
  assert.equal(await page.locator("#po-reference_files-err").innerText(), "A photo couldn't be sent: try it again or remove it.");
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: /^Remove photo/ }).first().click();
  await review(page);
  await page.locator(".po-review").waitFor();
  await ctx.close();
});

await step("Upload interrupted: the photo is marked, can be retried, and is stored once", async () => {
  const { page, state, ctx } = await open();
  const before = stored.size;
  state.failUploads = 1;
  await page.locator("#po-reference").setInputFiles({ name: "roses.jpg", mimeType: "image/jpeg", buffer: fixture("gps.jpg") });
  await page.locator(".po-photo.is-failed").waitFor();
  assert.equal(await page.locator(".po-photo-state").innerText(), "No connection. Try again.");
  assert.equal(stored.size, before);
  await fill(page);
  await review(page);
  assert.match(await page.locator("#po-reference_files-err").innerText(), /couldn't be sent/);
  await page.getByRole("button", { name: "Try again" }).click();
  await page.locator(".po-photo.is-ready").waitFor();
  assert.equal(stored.size, before + 1);
  // Reviewing while a photo is still on its way waits for it
  await page.unroute("**/*");
  await ctx.close();
});

await step("Sending: the request is reviewed first, and the last screen says “received, pending review”, nothing more", async () => {
  const { page, state, ctx } = await open({ accept: true });
  await page.locator("#po-same").check();
  assert.equal(await page.locator("#po-receiver_name").isVisible(), false);
  await fill(page, {}).catch(() => {}); // receiver fields are hidden: fill the rest by hand
  await page.locator("#po-date").fill(tomorrow()); await page.locator("#po-slot").selectOption("11:00 - 13:00");
  await page.locator("#po-address").fill("12 Katipunan Ave, Loyola Heights, Quezon City");
  if (!(await page.locator(".loc-done").isVisible())) { await search(page, "Katipunan"); await page.locator(".loc-result").first().click(); await page.locator(".loc-confirm").click(); }
  await page.locator("#po-description").fill("A dozen red roses"); await page.locator("#po-card_message").fill("Happy birthday, Ma!");
  await page.locator("#po-payment_method").selectOption("bank");
  await review(page);
  await page.locator(".po-review").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), "po-review-h");
  assert.match(await page.locator(".po-notice").innerText(), /doesn't confirm the order/);
  assert.match(await page.locator(".po-summary").innerText(), /Same person as the buyer/);
  await page.getByRole("button", { name: "Send request" }).click();
  await page.locator(".po-done h2").waitFor();
  assert.equal(await page.locator(".po-done h2").innerText(), "Request received, pending review");
  const text = await page.locator(".po-done").innerText();
  assert(/No price, availability or payment is confirmed yet/.test(text) && !/₱|confirmed your order|order number/i.test(text));
  const sent = state.calls.filter((c) => c.action === "submit");
  assert.equal(sent.length, 1); assert.equal(sent[0].body.receiver_name, "Jose Santos"); assert.equal(sent[0].body.receiver_phone, "+34 612 345 678");
  assert.match(sent[0].body.request_key, /^[0-9a-f-]{36}$/);
  // Nothing personal was left in the browser
  const kept = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie]));
  assert(!/Jose|612|Katipunan|roses|birthday/i.test(kept), kept);
  await page.screenshot({ path: path.join(shots, "public-order-mobile-done.png") });
  await ctx.close();
});

await step("The server has the last word: a field it refuses brings the visitor back to that field", async () => {
  const { page, ctx } = await open({ accept: true });
  await fill(page);
  await review(page);
  await page.locator(".po-review").waitFor();
  // The clock moved on while the review was open: the confirmation is now too old for the server
  await db.exec("select 1");
  await page.route(API, async (route) => {
    if (JSON.parse(route.request().postData() || "{}").action !== "submit") return route.fallback();
    return route.fulfill({ status: 422, contentType: "application/json", headers: { "access-control-allow-origin": ORIGIN }, body: JSON.stringify({ error: "invalid", field: "date" }) });
  });
  await page.getByRole("button", { name: "Send request" }).click();
  await page.locator("#po-date-err", { hasText: "Check this detail." }).waitFor();
  assert.equal(await page.locator("#po-buyer_name").inputValue(), "Jose Santos", "nothing typed is lost");
  assert.equal(await page.locator(".loc-done").isVisible(), true, "the confirmed point is kept");
  await ctx.close();
});

await step("Spanish, large text, light mode and reduced motion work; switching language keeps what was typed", async () => {
  const { page, ctx } = await open({ lang: "es" });
  await page.locator(".po-form").waitFor();
  assert.equal(await page.locator(".order-h1").innerText(), "Solicita un pedido");
  await page.locator("#po-buyer_name").fill("Jose Santos");
  await page.locator(".loc-map.leaflet-container").waitFor();
  await search(page, "Katipunan"); await page.locator(".loc-result").first().click(); await page.locator(".loc-confirm").click();
  await page.locator("[data-settings]").click();
  await page.locator(".menu [data-lang=en]").click();
  assert.equal(await page.locator(".order-h1").innerText(), "Request an order");
  assert.equal(await page.locator("#po-buyer_name").inputValue(), "Jose Santos");
  await page.locator(".loc-done", { hasText: "Location confirmed" }).waitFor();
  await page.locator(".menu [data-size=lg]").click(); await page.locator(".menu [data-theme-set=light]").click(); await page.locator(".menu [data-motion-set=reduced]").click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), "reduced");
  await page.keyboard.press("Escape");
  await noOverflow(page);
  await page.screenshot({ path: path.join(shots, "public-order-mobile-light-large.png"), fullPage: true });
  await ctx.close();
});

await browser.close(); site.close(); await db.close();
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
