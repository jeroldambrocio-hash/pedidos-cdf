// Phase 2, server side of the public order form, with nothing real behind it:
//   · what counts as an image, and what is removed from one (checks.ts)
//   · what counts as a valid request (checks.ts)
//   · the function itself (handler.ts) running against the real SQL of the migration, in an in-memory
//     database; the anti-abuse check, the address search and the file store are stand-ins.
// Run: NODE_PATH=.test-tools/node_modules node --experimental-strip-types tests/public-order.test.mjs
import assert from "node:assert";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { checkRequest, cleanImage, IMAGE_MAX_BYTES, manilaDate, phoneE164, slotOpen, verifyPixels } from "../supabase/functions/cdf-public-order/checks.ts";
import { createRequire as __cr } from "node:module";
import { deflateSync } from "node:zlib";
const jpegJs = __cr(import.meta.url)("jpeg-js");
import { handle, logText } from "../supabase/functions/cdf-public-order/handler.ts";

const require = createRequire(import.meta.url);
const { PGlite } = require("@electric-sql/pglite");
const { build } = require("./lib/fresh-db.cjs");
const ok = (n) => console.log("ok " + n);
const fixture = (name) => new Uint8Array(readFileSync(new URL("./fixtures/public-order/" + name, import.meta.url)));
const has = (bytes, text) => Buffer.from(bytes).includes(Buffer.from(text, "latin1"));
const code = (fn) => { try { fn(); } catch (e) { return e.message + (e.field ? ":" + e.field : ""); } return null; };

// ---------- images ----------
// Every fixture is a 96×64 picture carrying a GPS position, a camera rotation and some text.
for (const [name, mime] of [["gps.jpg", "image/jpeg"], ["progressive.jpg", "image/jpeg"], ["text.png", "image/png"], ["exif.webp", "image/webp"]]) {
  const raw = fixture(name), clean = cleanImage(raw);
  assert.equal(clean.mime, mime); assert.equal(clean.width, 96); assert.equal(clean.height, 64);
  assert(clean.bytes.length < raw.length, name + " got smaller");
  // The GPS block is an EXIF directory pointed to by tag 0x8825; none of it, nor any text, survives
  for (const gone of ["GPS", "\x88\x25", "\x25\x88", "xmp", "XMP", "Location", "14.5995", "comment"]) assert(!has(clean.bytes, gone), `${name} still has ${JSON.stringify(gone)}`);
  assert.deepEqual(cleanImage(clean.bytes).bytes, clean.bytes, name + ": cleaning twice changes nothing");
}
assert(has(cleanImage(fixture("gps.jpg")).bytes, "Exif"), "the rotation is kept so the photo stays upright");
assert.equal(Buffer.from(cleanImage(fixture("gps.jpg")).bytes).indexOf(Buffer.from([0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06])) > 0, true);
ok("Structure check and cleaning (JPEG, progressive JPEG, PNG, WebP): location, camera data and text are removed; rotation is kept. Only JPEG passes the decode step below");

{ const jpg = fixture("gps.jpg"), png = fixture("text.png"), webp = fixture("exif.webp");
  const tail = Buffer.from("<script>alert(1)</script>PK\x03\x04hidden archive");
  for (const [name, raw] of [["jpg", jpg], ["png", png]]) {
    const clean = cleanImage(new Uint8Array(Buffer.concat([raw, tail])));
    assert(!has(clean.bytes, "script") && !has(clean.bytes, "hidden archive"), name + ": what follows the image is dropped");
  }
  const fakes = {
    "a text file named .jpg": Buffer.from("this is not a photo"),
    "html": Buffer.from("<!doctype html><script>alert(1)</script>"),
    "svg": Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    "pdf": Buffer.from("%PDF-1.7\n1 0 obj"),
    "gif": Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00", "latin1"),
    "jpeg header only": jpg.subarray(0, 3),
    "jpeg cut in half": jpg.subarray(0, jpg.length >> 1),
    "jpeg without pixels": Buffer.concat([jpg.subarray(0, 2), Buffer.from([0xff, 0xd9])]),
    "png cut in half": png.subarray(0, png.length >> 1),
    "png with a broken checksum": (() => { const b = Buffer.from(png); b[b.length - 1] ^= 1; return b; })(),
    "png header on a script": Buffer.concat([png.subarray(0, 8), Buffer.from("<script>alert(1)</script>")]),
    "webp cut in half": webp.subarray(0, webp.length >> 1),
    "riff that is not webp": Buffer.from("RIFF\x10\x00\x00\x00WAVEfmt 12345678", "latin1"),
  };
  for (const [name, bytes] of Object.entries(fakes)) assert.equal(code(() => cleanImage(new Uint8Array(bytes))), "not_an_image", name);
  assert.equal(code(() => cleanImage(new Uint8Array(0))), "empty_file");
  assert.equal(code(() => cleanImage(new Uint8Array(IMAGE_MAX_BYTES + 1))), "file_too_big");
  // Dimensions come from the file, not from what the sender says: a 1×1 and a 60000×60000 header are refused
  const sized = (w, h) => { const b = Buffer.from(jpg), at = b.indexOf(Buffer.from([0xff, 0xc0])); b.writeUInt16BE(h, at + 5); b.writeUInt16BE(w, at + 7); return new Uint8Array(b); };
  assert.equal(code(() => cleanImage(sized(1, 1))), "bad_dimensions");
  assert.equal(code(() => cleanImage(sized(60000, 60000))), "bad_dimensions"); }
ok("Files that only claim to be photos are refused: text, HTML, SVG, PDF, GIF, cut or corrupt images, absurd sizes; trailing data is dropped");

// ---------- the pixels themselves ----------
{ const decode = (b) => { const img = jpegJs.decode(b, { useTArray: true, tolerantDecoding: false, maxResolutionInMP: 17, maxMemoryUsageInMB: 160 }); return { width: img.width, height: img.height }; };
  const fails = async (bytes) => { try { await verifyPixels(cleanImage(bytes), decode); return null; } catch (e) { return e.message; } };
  for (const name of ["gps.jpg", "progressive.jpg"]) assert.equal(await fails(fixture(name)), null, name + " decodes");
  // PNG is refused at this step, even a well-made one: the form only ever sends JPEG
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type, "latin1"), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
  const png = (w, h, idat, { color = 2, depth = 8 } = {}) => { const head = Buffer.alloc(13); head.writeUInt32BE(w); head.writeUInt32BE(h, 4); head[8] = depth; head[9] = color;
    return new Uint8Array(Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", head), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))])); };
  const rows = (w, h, bytes) => Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * bytes, 1)])));
  const noPalette = png(16, 16, deflateSync(rows(16, 16, 1)), { color: 3 });                 // indexed colour with no PLTE: not decodable
  assert.equal(code(() => cleanImage(noPalette)), null, "its structure passes");
  assert.equal(await fails(noPalette), "not_an_image", "indexed PNG without a palette");
  assert.equal(await fails(png(20, 20, Buffer.from("this is not compressed pixel data at all"))), "not_an_image", "PNG with garbage IDAT");
  assert.equal(await fails(png(20, 20, deflateSync(rows(20, 20, 3)))), "not_an_image", "a well-made PNG too");
  assert.equal(await fails(fixture("text.png")), "not_an_image");
  // A JPEG whose markers are fine but whose compressed picture is cut short or scrambled
  const jpg = Buffer.from(fixture("gps.jpg")), sos = jpg.lastIndexOf(Buffer.from([0xff, 0xda]));
  const cut = Buffer.concat([jpg.subarray(0, sos + 14 + ((jpg.length - sos) / 3 | 0)), Buffer.from([0xff, 0xd9])]);
  assert.equal(code(() => cleanImage(new Uint8Array(cut))), null, "its structure passes");
  assert.equal(await fails(new Uint8Array(cut)), "not_an_image", "JPEG cut short (end marker added back)");
  const blank = Buffer.from(jpg); blank.fill(0xfe, sos + 20, blank.length - 2);
  assert.equal(await fails(new Uint8Array(blank)), "not_an_image", "JPEG with its picture data overwritten");
  assert.equal(await fails(fixture("exif.webp")), "not_an_image", "WebP is not accepted (the form only sends JPEG)"); }
ok("Only JPEG, decoded in full: a JPEG cut short or overwritten is refused, and so is any PNG (even without a palette or with broken data) or WebP");

// ---------- the request ----------
const NOW = Date.parse("2026-11-11T04:00:00Z"); // midday in Manila
const good = (extra = {}) => ({ request_key: randomUUID(), lang: "en", buyer_name: "Jose Santos", buyer_phone: "+34 612 345 678",
  receiver_name: "Maria Santos", receiver_phone: "0917 123 4567", mode: "delivery", date: manilaDate(NOW, 2), slot: "11:00 - 13:00",
  address: "12 Mabini St, Brgy. Loyola Heights, Quezon City", lat: 14.6397, lng: 121.0775, location_source: "search",
  location_confirmed_at: new Date(NOW - 60_000).toISOString(), description: "A dozen red roses, wrapped", special_requests: "", card_message: "Happy birthday",
  payment_method: "gcash", reference_files: [], payment_proof: null, ...extra });
const without = (o, ...keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
{ const r = checkRequest(good(), NOW);
  assert.equal(r.buyer_phone, "+34612345678"); assert.equal(r.receiver_phone, "+639171234567");
  assert.equal(phoneE164("9171234567"), "+639171234567"); assert.equal(phoneE164("0034 612 345 678"), "+34612345678");
  for (const bad of ["612345678", "12345", "+0000000000", "phone", "+63 917 123 4567 ext 4"]) assert.equal(phoneE164(bad), null, bad);
  const pickup = checkRequest(without(good({ mode: "pickup", pickup_branch: "Quezon City" }), "address", "lat", "lng", "location_source", "location_confirmed_at"), NOW);
  assert.equal(pickup.lat, null); assert.equal(pickup.address, ""); assert.equal(pickup.pickup_branch, "Quezon City");
  assert.equal(code(() => checkRequest(good({ mode: "pickup", pickup_branch: "Quezon City" }), NOW)), "invalid:location");
  assert.equal(code(() => checkRequest(without(good({ mode: "pickup" }), "address", "lat", "lng", "location_source", "location_confirmed_at"), NOW)), "invalid:pickup_branch");
  assert.equal(code(() => checkRequest(good({ pickup_branch: "Pasig" }), NOW)), "invalid:pickup_branch");
  assert.equal(checkRequest(good(), NOW).pickup_branch, null); }
ok("A buyer abroad and a receiver in the Philippines are both accepted; pickup needs no pin and refuses one");

{ const refused = (extra, expect) => assert.equal(code(() => checkRequest(good(extra), NOW)), expect, JSON.stringify(extra));
  for (const k of ["price", "amount", "paid", "status", "vendor_email", "branch", "id", "num", "accepted_order_id"]) refused({ [k]: 1 }, "unknown_field:" + k);
  refused({ lat: 40.4168, lng: -3.7038 }, "invalid:location");            // Madrid: the buyer's place, not the delivery's
  refused({ lat: "14.6", lng: 121 }, "invalid:location"); refused({ lat: NaN }, "invalid:location"); refused({ lat: Infinity }, "invalid:location");
  refused({ location_confirmed_at: null }, "invalid:location");            // a pin that was never confirmed
  refused({ location_confirmed_at: new Date(NOW + 3600_000).toISOString() }, "invalid:location");
  refused({ location_confirmed_at: new Date(NOW - 2 * 86400_000).toISOString() }, "invalid:location");
  refused({ location_source: "guess" }, "invalid:location");
  refused({ date: manilaDate(NOW, -1) }, "invalid:date"); refused({ date: manilaDate(NOW, 91) }, "invalid:date"); refused({ date: "2026-02-31" }, "invalid:date"); refused({ date: "tomorrow" }, "invalid:date");
  refused({ slot: "03:00 - 04:00" }, "invalid:slot"); refused({ payment_method: "crypto" }, "invalid:payment_method"); refused({ mode: "teleport" }, "invalid:mode");
  refused({ buyer_phone: "12345" }, "invalid:buyer_phone"); refused({ buyer_name: "x" }, "invalid:buyer_name"); refused({ buyer_name: "a".repeat(81) }, "invalid:buyer_name");
  refused({ buyer_name: "Jose\nSantos" }, "invalid:buyer_name"); refused({ description: "a\u0000b c" }, "invalid:description"); refused({ description: "x".repeat(1001) }, "invalid:description");
  refused({ address: "short" }, "invalid:address"); refused({ card_message: 5 }, "invalid:card_message");
  refused({ request_key: "1" }, "invalid:request_key");
  refused({ reference_files: Array.from({ length: 7 }, randomUUID) }, "invalid:reference_files"); refused({ reference_files: ["../etc/passwd"] }, "invalid:reference_files");
  const twice = randomUUID(); refused({ reference_files: [twice, twice] }, "invalid:reference_files"); refused({ payment_proof: "cdf-pagos/x.jpg" }, "invalid:payment_proof");
  // A reference photo replaces text; payment proof alone does not.
  refused({ description: "", reference_files: [] }, "invalid:description");
  refused({ description: "   ", reference_files: [] }, "invalid:description");
  refused({ description: "", reference_files: [], payment_proof: randomUUID() }, "invalid:description");
  assert.equal(checkRequest(good({ description: "", reference_files: [randomUUID()] }), NOW).description, "");
  assert.equal(checkRequest(good({ description: "Red roses", reference_files: [] }), NOW).description, "Red roses");
  // The shop's day, not the server's or the buyer's: 19:30 on the 11th in Manila is still "today"
  const lateManila = Date.parse("2026-11-11T11:30:00Z");
  assert.equal(checkRequest(good({ date: "2026-11-11", slot: "19:00 - 21:00", location_confirmed_at: new Date(lateManila).toISOString() }), lateManila).date, "2026-11-11");
  assert.equal(code(() => checkRequest(good({ date: "2026-11-11", slot: "19:00 - 21:00", location_confirmed_at: new Date(lateManila + 5 * 3600_000).toISOString() }), lateManila + 5 * 3600_000)), "invalid:date");
  // Today's slots: open while an hour or more is left before they end; passed ones and the last hour are refused
  const at = (hhmm) => Date.parse(`2026-11-11T${hhmm}:00+08:00`), today = (slot, now) => code(() => checkRequest(good({ date: "2026-11-11", slot, location_confirmed_at: new Date(now).toISOString() }), now));
  assert.equal(today("11:00 - 13:00", at("12:00")), null); assert.equal(today("11:00 - 13:00", at("12:01")), "invalid:slot");
  assert.equal(today("09:00 - 11:00", at("12:00")), "invalid:slot"); assert.equal(today("13:00 - 15:00", at("12:01")), null);
  assert.equal(today("19:00 - 21:00", at("20:00")), null); assert.equal(today("19:00 - 21:00", at("20:01")), "invalid:slot"); assert.equal(today("19:00 - 21:00", at("23:30")), "invalid:slot");
  assert.equal(slotOpen("2026-11-12", "09:00 - 11:00", at("23:30")), true); assert.equal(slotOpen("2026-11-10", "19:00 - 21:00", at("08:00")), false); }
ok("Price, status, shop and any unknown field are refused; so are points outside the Philippines, unconfirmed pins, bad dates, phones and texts");

// ---------- the function, on the real SQL ----------
const db = new PGlite();
await build((sql) => db.exec(sql));
const sha = (v) => createHash("sha256").update(v).digest("hex");
const stored = new Map();
let decodes = 0, clock = NOW, captchaOk = true, geocoder = null, storeFails = false, seenCaptcha = null, searches = 0, google = null, googleCalls = [];
const env = { PUBLIC_ORDER: "on", PUBLIC_ORDER_ORIGINS: "https://casadeflores.store, https://staging.example", TURNSTILE_SECRET: "secret", PUBLIC_ORDER_SALT: "salt" };
const logged = [];
const deps = {
  log: (e) => logged.push(e),
  env: (k) => env[k], now: () => clock, randomToken: () => randomBytes(32).toString("base64url"), sha256: async (v) => sha(v),
  rpc: async (name, args) => {
    const keys = Object.keys(args);
    try { return { data: (await db.query(`select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, keys.map((k) => args[k]))).rows[0].r, error: null }; }
    catch (e) { return { data: null, error: { message: e.message } }; }
  },
  store: async (path, bytes, mime) => { if (storeFails) return { error: "down" }; stored.set(path, { bytes, mime }); return { error: null }; },
  unstore: async (paths) => { paths.forEach((p) => stored.delete(p)); },
  decodeJpeg: (bytes) => { decodes++; const img = jpegJs.decode(bytes, { useTArray: true, tolerantDecoding: false, maxResolutionInMP: 17, maxMemoryUsageInMB: 160 }); return { width: img.width, height: img.height }; },
  fetch: async (url, init) => {
    if (String(url).includes("turnstile")) { seenCaptcha = Object.fromEntries(init.body); return new Response(JSON.stringify({ success: captchaOk })); }
    if (String(url).includes("maps.googleapis.com")) { googleCalls.push(new URL(url)); const answer = google?.(); return answer ? new Response(JSON.stringify(answer)) : new Response("down", { status: 500 }); }
    searches++;
    if (!geocoder) return new Response("down", { status: 503 });
    return new Response(JSON.stringify(geocoder(new URL(url))));
  },
};
const ORIGIN = "https://casadeflores.store";
const send = async (body, { session, origin = ORIGIN, ip = "203.0.113.7", method = "POST" } = {}) => {
  const res = await handle(new Request("https://x.supabase.co/functions/v1/cdf-public-order", { method,
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}), "x-forwarded-for": ip, ...(session ? { "x-cdf-session": session } : {}) },
    body: method === "POST" ? JSON.stringify(body) : undefined }), deps);
  return { status: res.status, cors: res.headers.get("access-control-allow-origin"), ...(await res.json().catch(() => ({}))) };
};
const upload = async (bytes, { session, kind = "reference", ip = "203.0.113.7", stream = false } = {}) => {
  const body = stream ? new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 65536) c.enqueue(bytes.subarray(i, i + 65536)); c.close(); } }) : bytes;
  const res = await handle(new Request(`https://x.supabase.co/functions/v1/cdf-public-order?action=upload&kind=${kind}`, { method: "POST", duplex: "half",
    headers: { "content-type": "image/jpeg", origin: ORIGIN, "x-forwarded-for": ip, ...(session ? { "x-cdf-session": session } : {}) }, body }), deps);
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
};
const open = async (opts) => (await send({ action: "session", captcha: "token-from-widget" }, opts)).session;
const rows = async (sql, params) => (await db.query(sql, params)).rows;

{ env.PUBLIC_ORDER = "off";
  assert.deepEqual(await send({ action: "session", captcha: "x" }), { status: 503, cors: ORIGIN, error: "off" });
  env.PUBLIC_ORDER = "on";
  assert.equal((await send({ action: "session", captcha: "x" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await send({ action: "session", captcha: "x" }, { origin: "https://evil.example" })).cors, null);
  assert.equal((await send({}, { method: "GET" })).status, 405);
  assert.equal((await rows("select count(*)::int n from public.cdf_upload_sessions"))[0].n, 0); }
ok("Off by default; only the listed sites are answered; nothing is created for anyone else");

{ await db.exec(`insert into public.cdf_members(email,name,role,branch,pickup_address,pickup_lat,pickup_lng) values
    ('shop-qc@t','Jhandee','vendor','Quezon City','12 Visayas Ave, Quezon City',14.6538,121.0450),
    ('shop-pas@t','Arjay','vendor','Pasig','8 Ortigas Ave, Pasig',14.5866,121.0614)`);
  const r = await send({ action: "shops", date: manilaDate(NOW, 2) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.shops.map((x) => x.branch), ["Pasig", "Quezon City"]);
  assert(r.shops.every((x) => x.available && x.address && x.lat && x.lng));
  assert(!/@t|Jhandee|Arjay/.test(JSON.stringify(r.shops)));
  assert.equal((await send({ action: "shops" })).status, 200);
  assert.equal((await send({ action: "shops", date: "tomorrow" })).field, "date");
  assert.equal((await send({ action: "shops", vendor: "x" })).error, "unknown_field");
  assert.equal((await rows("select count(*)::int n from public.cdf_upload_sessions"))[0].n, 0); }
ok("Shops for pickup: zone, address and point, without a session or the anti-abuse check, nothing about the florists");

{ captchaOk = false; assert.deepEqual(await send({ action: "session", captcha: "bad" }), { status: 403, cors: ORIGIN, error: "captcha" });
  assert.equal((await send({ action: "session" })).error, "captcha");
  captchaOk = true;
  const s = await open();
  assert.match(s, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(seenCaptcha, { secret: "secret", response: "token-from-widget", remoteip: "203.0.113.7" });
  const [row] = await rows("select token_hash, ip_hash from public.cdf_upload_sessions");
  assert.equal(row.token_hash, sha(s)); assert.notEqual(row.token_hash, s); assert.equal(row.ip_hash, sha("salt|203.0.113.7")); assert(!row.ip_hash.includes("203"));
  delete env.TURNSTILE_SECRET;
  assert.equal((await send({ action: "session" })).error, "off");
  env.TURNSTILE_SECRET = "secret";
  assert.equal((await send({ action: "session", captcha: "x", role: "admin" })).error, "unknown_field");
  assert.equal((await send({ action: "search", query: "Mabini" })).status, 401);
  assert.equal((await send({ action: "search", query: "Mabini" }, { session: "made-up-token-made-up-token-made-up-token-12" })).status, 401); }
ok("A session needs the anti-abuse check verified on the server; without its secret the form stays closed; the token and the address are stored only as hashes");

{ const s = await open();
  assert.equal((await send({ action: "search", query: "Katipunan" }, { session: s })).error, "search_unavailable");
  let asked;
  geocoder = (u) => { asked = u; return { features: [
    { geometry: { coordinates: [121.0775, 14.6397] }, properties: { name: "Katipunan Avenue", city: "Quezon City", state: "Metro Manila", countrycode: "PH" } },
    { geometry: { coordinates: [121.0775, 14.6397] }, properties: { name: "Katipunan Avenue", city: "Quezon City", state: "Metro Manila", countrycode: "PH" } },
    { geometry: { coordinates: [-3.7038, 40.4168] }, properties: { name: "Calle Katipunan", city: "Madrid", countrycode: "ES" } },
    { geometry: { coordinates: [200, 95] }, properties: { name: "Nowhere", countrycode: "PH" } },
    { geometry: {}, properties: { name: "No point" } }] }; };
  const r = await send({ action: "search", query: "  Katipunan  " }, { session: s });
  assert.deepEqual(r.results, [{ label: "Katipunan Avenue, Quezon City, Metro Manila", lat: 14.6397, lng: 121.0775 }]);
  assert.equal(asked.origin, "https://photon.komoot.io"); assert.equal(asked.searchParams.get("q"), "Katipunan"); assert.equal(asked.searchParams.get("bbox"), "116,4,127,21.5");
  assert.equal((await send({ action: "search", query: "ab" }, { session: s })).field, "query");
  assert.equal((await send({ action: "search", query: "x".repeat(201) }, { session: s })).status, 400);
  assert.equal((await send({ action: "search", query: "Katipunan", serviceType: "MOTORCYCLE" }, { session: s })).error, "unknown_field");
  for (const action of ["geocode", "quote", "book", "cancel", "refresh"]) assert.equal((await send({ action, query: "x" }, { session: s })).error, "invalid", action); }
ok("Address search answers only places in the Philippines, from its own endpoint: it cannot quote, book or cancel a rider");

const jpg = fixture("gps.jpg");
{ const s = await open(), other = await open({ ip: "198.51.100.9" });
  assert.equal((await upload(jpg)).status, 401);
  // Audit F13: a well-formed token of a session that doesn't exist (or has expired) is refused before the
  // picture is read or decoded
  { const before = decodes;
    assert.equal((await upload(jpg, { session: "made-up-token-made-up-token-made-up-token-12" })).status, 401);
    const old = await open();
    await db.query("update public.cdf_upload_sessions set expires_at = now() - interval '1 minute' where token_hash = $1", [sha(old)]);
    assert.equal((await upload(jpg, { session: old })).status, 401);
    assert.equal(decodes, before, "nothing decoded without a live session"); }
  assert.equal((await upload(jpg, { session: s, kind: "avatar" })).status, 400);
  const before = stored.size;
  for (const [bytes, error, status] of [[Buffer.from("not a photo"), "not_an_image", 415], [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "not_an_image", 415],
    [new Uint8Array(IMAGE_MAX_BYTES + 10), "file_too_big", 413], [new Uint8Array(0), "empty_file", 415]]) {
    assert.deepEqual(await upload(new Uint8Array(bytes), { session: s }), { status, error });
  }
  assert.deepEqual(await upload(new Uint8Array(IMAGE_MAX_BYTES * 3), { session: s, stream: true }), { status: 413, error: "file_too_big" });
  assert.equal(stored.size, before); assert.equal((await rows("select count(*)::int n from public.cdf_request_files"))[0].n, 0);
  ok("A fake file, an empty one and an oversized one (also when sent without a declared size) are refused and nothing is kept");

  const first = await upload(jpg, { session: s });
  assert.equal(first.status, 200); assert.deepEqual([first.width, first.height], [96, 64]); assert(!("path" in first));
  const [file] = await rows("select * from public.cdf_request_files where id=$1", [first.file]);
  assert.equal(file.status, "ready"); assert.equal(file.kind, "reference"); assert.equal(file.mime, "image/jpeg"); assert.match(file.path, /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
  const kept = stored.get(file.path);
  assert(!has(kept.bytes, "GPS") && kept.bytes.length < jpg.length); assert.equal(file.bytes, kept.bytes.length); assert.equal(file.sha256, sha(kept.bytes));
  assert(!file.path.includes("gps"), "the visitor's file name is not used");
  ok("A real photo is stored privately under a random name, already cleaned of its location data");

  for (let i = 0; i < 5; i++) assert.equal((await upload(fixture(["gps.jpg", "progressive.jpg"][i % 2]), { session: s })).status, 200);
  assert.deepEqual(await upload(jpg, { session: s }), { status: 429, error: "quota" });
  assert.equal((await upload(jpg, { session: s, kind: "payment_proof" })).status, 200);
  assert.deepEqual(await upload(jpg, { session: s, kind: "payment_proof" }), { status: 429, error: "quota" });
  assert.equal(stored.size, before + 7);
  // Taking one back frees its place; another session cannot touch it
  assert.equal((await send({ action: "remove", file: first.file }, { session: other })).status, 400);
  assert.deepEqual(await send({ action: "remove", file: first.file }, { session: s }), { status: 200, cors: ORIGIN, removed: true });
  assert(!stored.has(file.path)); assert.equal((await send({ action: "remove", file: first.file }, { session: s })).status, 400);
  const again = await upload(jpg, { session: s });
  assert.equal(again.status, 200);
  storeFails = true;
  await send({ action: "remove", file: again.file }, { session: s });
  logged.length = 0;
  assert.equal((await upload(jpg, { session: s })).status, 500);
  storeFails = false;
  // Audit F05: the failure is in the log, with the step and the cause, and nothing of the visitor's
  assert.equal(logged.length, 1); assert.equal(logged[0].step, "upload"); assert.equal(logged[0].op, "store"); assert.match(logged[0].rid, /^[\w-]{10}$/);
  assert.equal((await rows("select status from public.cdf_request_files order by created_at desc limit 1"))[0].status, "rejected");
  ok("Six reference photos and one proof per session; removing one frees its place; a failed store leaves no file marked ready");

  // ---------- submit ----------
  clock = Date.now(); // the session rows carry the database's clock
  const refs = (await rows("select id from public.cdf_request_files where session_id=(select id from public.cdf_upload_sessions where token_hash=$1) and kind='reference' and status='ready'", [sha(s)])).map((r) => r.id);
  const proof = (await rows("select id from public.cdf_request_files where kind='payment_proof' and status='ready'"))[0].id;
  const body = (extra = {}) => ({ action: "submit", ...good({ date: manilaDate(clock, 2), location_confirmed_at: new Date(clock - 1000).toISOString(), reference_files: refs, payment_proof: proof, ...extra }) });
  assert.equal((await send(body())).status, 401);
  assert.deepEqual(await send(body({ price: 1 }), { session: s }), { status: 422, cors: ORIGIN, error: "unknown_field", field: "price" });
  assert.deepEqual(await send(body({ lat: 40.4, lng: -3.7 }), { session: s }), { status: 422, cors: ORIGIN, error: "invalid", field: "location" });
  assert.equal((await send(body({ reference_files: [randomUUID()] }), { session: s })).error, "files");
  assert.equal((await send(body({ reference_files: [proof] }), { session: s })).error, "files");            // a proof is not a reference
  assert.equal((await send(body(), { session: other })).error, "files");                                    // someone else's photos
  const fromOther = await send(body({ reference_files: [], payment_proof: null }), { session: other });
  assert.equal(fromOther.status, 200); assert.equal(fromOther.received, true);
  const full = body({ description: "" }), sent = await send(full, { session: s });
  assert.equal(sent.status, 200); assert.equal(sent.received, true); assert.equal(sent.ref, fromOther.ref + 1);
  assert.equal((await rows("select description from public.cdf_order_requests where ref=$1", [sent.ref]))[0].description, "", "a photo-only request keeps the description empty");
  assert.deepEqual(Object.keys(sent).sort(), ["cors", "received", "ref", "status"], "the visitor learns the reference and nothing else");
  // The same request again (the answer got lost): the same reference, nothing new
  assert.equal((await send(full, { session: s })).ref, sent.ref);
  assert.equal((await send({ ...full, description: "Something else entirely" }, { session: s })).status, 409);
  assert.equal((await rows("select count(*)::int n from public.cdf_order_requests"))[0].n, 2);
  assert.equal((await rows("select count(*)::int n from public.cdf_request_files where request_id is not null"))[0].n, refs.length + 1);
  assert.equal((await rows("select count(*)::int n from public.cdf_orders"))[0].n, 0, "a request is not an order");
  assert.equal((await rows("select count(*)::int n from net.calls where body->>'kind' = 'request'"))[0].n, 2, "one notice per request");
  ok("A complete request is stored once with its photos and announced once; sent again it gets the same reference; it creates no order");

  // ---------- limits and expiry ----------
  await db.exec("update public.cdf_upload_sessions set expires_at = now() - interval '1 minute'");
  assert.equal((await send({ action: "search", query: "Katipunan" }, { session: s })).status, 401);
  assert.equal((await upload(jpg, { session: s })).status, 401);
  assert.equal((await send(body(), { session: s })).status, 401);
  ok("An expired or used session can no longer search, upload or send another request"); }

{ const ip = "192.0.2.50";
  const results = [];
  for (let i = 0; i < 32; i++) results.push((await send({ action: "session", captcha: "t" }, { ip })).status);
  assert.deepEqual([results.filter((x) => x === 200).length, results.filter((x) => x === 429).length], [30, 2]);
  assert.equal((await send({ action: "session", captcha: "t" }, { ip: "192.0.2.51" })).status, 200, "another address is not affected");
  const s = await open({ ip: "192.0.2.52" }), before = searches;
  const codes = [];
  for (let i = 0; i < 62; i++) codes.push((await send({ action: "search", query: "Katipunan " + i }, { session: s, ip: "192.0.2.52" })).status);
  assert.equal(codes.filter((x) => x === 429).length, 2); assert.equal(searches - before, 60, "refused searches never reach the map provider"); }
ok("Limits are counted in the database, per address and per session: one busy address does not block the others");

{ const s = await open({ ip: "192.0.2.60" }), find = (query) => send({ action: "search", query }, { session: s, ip: "192.0.2.60" });
  const place = (formatted_address, lat, lng, types = ["street_address"]) => ({ formatted_address, geometry: { location: { lat, lng } }, types });
  const free = [{ label: "Katipunan Avenue, Quezon City, Metro Manila", lat: 14.6397, lng: 121.0775 }];
  // No key: Google is never called
  assert.deepEqual((await find("12 Mabini")).results, free); assert.equal(googleCalls.length, 0);
  env.GOOGLE_MAPS_KEY = "server-key"; env.PUBLIC_GOOGLE_DAILY = "3";
  google = () => ({ status: "OK", results: [place("12 Mabini St, Quezon City, Metro Manila, Philippines", 14.6501, 121.0702), place("Philippines", 12.8, 121.7, ["country"]), place("Calle Mabini, Madrid", 40.4, -3.7)] });
  const first = await find("12 Mabini");
  assert.deepEqual(first.results, [{ label: "12 Mabini St, Quezon City, Metro Manila", lat: 14.6501, lng: 121.0702 }]); assert.equal(first.credit, "google");
  assert.equal(googleCalls[0].searchParams.get("components"), "country:PH"); assert.equal(googleCalls[0].searchParams.get("key"), "server-key");
  assert(!JSON.stringify(first).includes("server-key"), "the key never reaches the visitor");
  // Nothing found, or Google failing: the free search answers, and nothing is credited to Google
  google = () => ({ status: "ZERO_RESULTS", results: [] });
  const none = await find("somewhere odd"); assert.deepEqual(none.results, free); assert.equal(none.credit, undefined);
  google = () => null;
  assert.deepEqual((await find("12 Mabini")).results, free);
  // The day's allowance is used up (3): Google is not called again, whoever asks
  google = () => ({ status: "OK", results: [place("1 Ayala Ave, Makati, Philippines", 14.5547, 121.0244)] });
  const before = googleCalls.length;
  const other = await open({ ip: "192.0.2.61" });
  assert.deepEqual((await find("Ayala")).results, free); assert.deepEqual((await send({ action: "search", query: "Ayala" }, { session: other, ip: "192.0.2.61" })).results, free);
  assert.equal(googleCalls.length, before); assert.equal(before, 3);
  // A new day: allowed again
  await db.exec("update public.cdf_rate_limits set window_start = window_start - interval '1 day' where bucket = 'google-geocode'");
  assert.equal((await find("Ayala")).credit, "google");
  env.PUBLIC_GOOGLE_DAILY = "0"; const off = googleCalls.length;
  assert.deepEqual((await find("Ayala")).results, free); assert.equal(googleCalls.length, off);
  delete env.GOOGLE_MAPS_KEY; delete env.PUBLIC_GOOGLE_DAILY; }
ok("Google answers address searches up to a daily number counted in the database; past it, without a key or on failure, the free search does: no bill is possible");

{ const tables = ["cdf_upload_sessions", "cdf_request_files", "cdf_rate_limits"];
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const tb of tables) for (const sql of [`select * from public.${tb}`, `delete from public.${tb}`, `insert into public.${tb} default values`]) {
      // Phase 3 lets admins read the files attached to a request; any other signed-in person reads none
      if (role === "authenticated" && tb === "cdf_request_files" && sql.startsWith("select")) { assert.equal((await db.query(sql)).rows.length, 0); continue; }
      await assert.rejects(db.query(sql), { code: "42501" }, `${role}: ${sql}`);
    }
    for (const sql of ["select public.cdf_rate_hit('x', 1, 60)", "select public.cdf_upload_session_open('a','b')", "select public.cdf_upload_session_of('a')",
      "select public.cdf_upload_claim('a','reference','jpg')", "select public.cdf_upload_files_ready('a', '{}', null)"]) await assert.rejects(db.query(sql), { code: "42501" }, `${role}: ${sql}`);
    await db.exec("reset role");
  }
  const [bucket] = await rows("select public, file_size_limit, allowed_mime_types from storage.buckets where id='cdf-solicitudes'");
  assert.equal(bucket.public, false); assert.equal(Number(bucket.file_size_limit), 3145728); assert.deepEqual(bucket.allowed_mime_types, ["image/jpeg", "image/png", "image/webp"]);
  // One storage rule, from Phase 3: reading only (admins; the assigned florist for reference photos). No writing.
  assert.deepEqual((await rows("select cmd from pg_policies where schemaname='storage' and (qual like '%cdf-solicitudes%' or with_check like '%cdf-solicitudes%')")).map((r) => r.cmd), ["SELECT"]); }
ok("Neither a visitor nor a signed-in member of staff can write sessions, files or limits, or call their functions; the bucket is private and only readable as Phase 3 allows");

// Audit F05: an unexpected failure (the database throwing in the middle of a request) used to answer 500 and
// leave nothing behind. Now the log says where and why, without anything personal.
{ logged.length = 0;
  const broken = { ...deps, rpc: async () => { throw new Error("connection to db lost while saving Maria Santos +63 917 123 4567 maria@example.com token abcdefghijklmnopqrstuvwxyz0123456789ABCD"); } };
  const res = await handle(new Request("https://x/functions/v1/cdf-public-order", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: JSON.stringify({ action: "shops" }) }), broken);
  const body = await res.json();
  assert.equal(res.status, 500); assert.equal(body.error, "server"); assert.equal(body.rid, logged[0].rid);
  assert.equal(logged.length, 1); assert.equal(logged[0].step, "shops"); assert.equal(logged[0].op, "unexpected");
  assert.match(logged[0].cause, /connection to db lost/);
  assert.doesNotMatch(JSON.stringify(logged[0]), /917|maria@|abcdefghijklmnop/);
  assert.equal(logText({ message: "x ".repeat(300) }), "operation failed");
  assert.equal(logText("saving Maria Santos at 123 Main Street password=shortSecret"), "operation failed");
  assert.doesNotMatch(JSON.stringify(body), /connection/); }
ok("A failure nobody expected answers “server” with an id, and the log has the step and the cause with phones, emails and tokens taken out");

await db.close();
