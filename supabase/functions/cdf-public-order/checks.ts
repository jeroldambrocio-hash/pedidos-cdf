// What the public order form's server accepts, with no network or database in it (tested from Node:
// tests/public-order.test.mjs). Two parts: what a real image is, and what a valid request is.

export class CheckError extends Error {
  field?: string;
  constructor(code: string, field?: string) { super(code); this.field = field; }
}

// ---------------------------------------------------------------------------------------------------
// Images. The browser shrinks photos before sending, but that is a courtesy, not a guarantee: anything
// can be posted here. So the file is read by its bytes (never by its name or declared type), walked from
// the first byte to its proper end, measured, and rebuilt without the parts a photo does not need:
// location and camera data (EXIF), XMP, IPTC, comments, and anything stuck on after the end of the image.
// Only the rotation is kept from EXIF, so phone photos stay upright.
// This checks the structure of the file; it does not decode the pixels.

export const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
// The form sends JPEGs of at most 1600 px; the limits leave room without letting a decode get expensive.
const MAX_SIDE = 4096, MIN_SIDE = 16, MAX_PIXELS = 16_800_000;

export type CleanImage = { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp"; width: number; height: number; bytes: Uint8Array };

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const be16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const be32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const le16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const le24 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const le32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const join = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const bad = (): never => { throw new CheckError("not_an_image"); };

// Rotation (EXIF tag 0x0112) out of an APP1 segment's payload, or 0.
function exifOrientation(seg: Uint8Array): number {
  if (seg.length < 14 || ascii(seg, 0, 6) !== "Exif\0\0") return 0;
  const t = seg.subarray(6), little = ascii(t, 0, 2) === "II";
  if (!little && ascii(t, 0, 2) !== "MM") return 0;
  const u16 = (at: number) => (little ? le16(t, at) : be16(t, at)), u32 = (at: number) => (little ? le32(t, at) : be32(t, at));
  const ifd = u32(4);
  if (ifd + 2 > t.length) return 0;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12;
    if (at + 12 > t.length) return 0;
    if (u16(at) === 0x0112) { const v = u16(at + 8); return v >= 1 && v <= 8 ? v : 0; }
  }
  return 0;
}
// The smallest EXIF block there is: just the rotation.
const orientationSegment = (v: number) => new Uint8Array([0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
  0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, v, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

function cleanJpeg(b: Uint8Array): CleanImage {
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  let at = 2, width = 0, height = 0, orientation = 0, scans = 0;
  for (;;) {
    if (at + 2 > b.length || b[at] !== 0xff) bad();
    const marker = b[at + 1];
    if (marker === 0xd9) { if (!scans) bad(); keep.push(b.subarray(at, at + 2)); break; } // end of image: whatever follows is dropped
    if (marker === 0xff) { at++; continue; } // fill byte
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || at + 4 > b.length) bad();
    const len = be16(b, at + 2);
    if (len < 2 || at + 2 + len > b.length) bad();
    const seg = b.subarray(at, at + 2 + len);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (len < 8 || width) bad();
      height = be16(b, at + 5); width = be16(b, at + 7);
    }
    if (marker === 0xe1 && !orientation) orientation = exifOrientation(b.subarray(at + 4, at + 2 + len));
    // Kept: tables, frame and scan headers, JFIF (APP0), colour profile (APP2), Adobe colour marker (APP14).
    const dropped = marker === 0xfe || (marker >= 0xe0 && marker <= 0xef && marker !== 0xe0 && marker !== 0xe2 && marker !== 0xee);
    if (!dropped) keep.push(seg);
    at += 2 + len;
    if (marker === 0xda) {
      if (!width) bad();
      scans++;
      // Compressed data runs to the next real marker (0xFF followed by anything but 0x00 or a restart marker)
      const from = at;
      while (at + 1 < b.length && !(b[at] === 0xff && b[at + 1] !== 0x00 && !(b[at + 1] >= 0xd0 && b[at + 1] <= 0xd7))) at++;
      if (at + 1 >= b.length) bad();
      keep.push(b.subarray(from, at));
    }
  }
  if (orientation > 1) keep.splice(1, 0, orientationSegment(orientation));
  return { mime: "image/jpeg", ext: "jpg", width, height, bytes: join(keep) };
}

let crcTable: Uint32Array | null = null;
function crc32(b: Uint8Array): number {
  crcTable ||= Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "bKGD", "pHYs"]);
function cleanPng(b: Uint8Array): CleanImage {
  const keep: Uint8Array[] = [b.subarray(0, 8)];
  let at = 8, width = 0, height = 0, data = false;
  for (;;) {
    if (at + 12 > b.length) bad();
    const len = be32(b, at), type = ascii(b, at + 4, 4);
    if (len > b.length || at + 12 + len > b.length) bad();
    if (crc32(b.subarray(at + 4, at + 8 + len)) !== be32(b, at + 8 + len)) bad();
    if (at === 8) {
      if (type !== "IHDR" || len !== 13) bad();
      width = be32(b, 16); height = be32(b, 20);
    } else if (type === "IHDR") bad();
    if (type === "IDAT") data = true;
    if (PNG_KEEP.has(type)) keep.push(b.subarray(at, at + 12 + len));
    at += 12 + len;
    if (type === "IEND") { if (!data || len) bad(); break; }
  }
  return { mime: "image/png", ext: "png", width, height, bytes: join(keep) };
}

function cleanWebp(b: Uint8Array): CleanImage {
  if (b.length < 20 || le32(b, 4) + 8 > b.length) bad();
  const end = le32(b, 4) + 8, chunks: Uint8Array[] = [];
  let at = 12, width = 0, height = 0, pixels = false, first = true;
  while (at < end) {
    if (at + 8 > end) bad();
    const type = ascii(b, at, 4), len = le32(b, at + 4), full = 8 + len + (len & 1);
    if (at + 8 + len > end) bad();
    const body = b.subarray(at + 8, at + 8 + len);
    if (first) {
      if (type === "VP8X") { if (len < 10) bad(); width = le24(body, 4) + 1; height = le24(body, 7) + 1; }
      else if (type === "VP8 ") { if (len < 10 || body[3] !== 0x9d || body[4] !== 0x01 || body[5] !== 0x2a) bad(); width = le16(body, 6) & 0x3fff; height = le16(body, 8) & 0x3fff; }
      else if (type === "VP8L") { if (len < 5 || body[0] !== 0x2f) bad(); const v = le32(body, 1); width = (v & 0x3fff) + 1; height = ((v >>> 14) & 0x3fff) + 1; }
      else bad();
      first = false;
    }
    if (type === "VP8 " || type === "VP8L" || type === "ANMF") pixels = true;
    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = b.slice(at, Math.min(at + full, end));
      if (type === "VP8X") chunk[8] &= ~0x0c; // the header's "has EXIF" and "has XMP" flags
      chunks.push(chunk.length < full ? join([chunk, new Uint8Array(full - chunk.length)]) : chunk);
    }
    at += full;
  }
  if (!pixels) bad();
  const size = 4 + chunks.reduce((n, c) => n + c.length, 0);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 4), 0); head.set([size & 255, (size >>> 8) & 255, (size >>> 16) & 255, size >>> 24], 4); head.set(b.subarray(8, 12), 8);
  return { mime: "image/webp", ext: "webp", width, height, bytes: join([head, ...chunks]) };
}

export function cleanImage(input: Uint8Array): CleanImage {
  if (!input?.length) throw new CheckError("empty_file");
  if (input.length > IMAGE_MAX_BYTES) throw new CheckError("file_too_big");
  let image: CleanImage;
  try {
    if (input.length > 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) image = cleanJpeg(input);
    else if (input.length > 8 && ascii(input, 0, 8) === "\x89PNG\r\n\x1a\n") image = cleanPng(input);
    else if (input.length > 12 && ascii(input, 0, 4) === "RIFF" && ascii(input, 8, 4) === "WEBP") image = cleanWebp(input);
    else throw new CheckError("not_an_image");
  } catch (e) {
    throw e instanceof CheckError ? e : new CheckError("not_an_image"); // a truncated file read past its end
  }
  const { width, height } = image;
  if (!(width >= MIN_SIDE && height >= MIN_SIDE && width <= MAX_SIDE && height <= MAX_SIDE && width * height <= MAX_PIXELS)) throw new CheckError("bad_dimensions");
  return image;
}

// ---------------------------------------------------------------------------------------------------
// The pixels. The structure check above can be fooled by a file whose parts are well formed but whose
// picture data is garbage. Only what the form itself sends is accepted: the page shrinks every photo in the
// browser and always sends a JPEG. That JPEG is decoded in full here (jpeg-js, strict, with limits on size
// and memory) and its size must match its header. PNG and WebP are refused at this step: checking their
// structure is not decoding them (a PNG can be well formed and still not decodable, e.g. indexed colour
// with no palette), and nothing legitimate sends them.
export type DecodeJpeg = (bytes: Uint8Array) => { width: number; height: number } | Promise<{ width: number; height: number }>;

export async function verifyPixels(image: CleanImage, decodeJpeg: DecodeJpeg) {
  if (image.mime !== "image/jpeg") throw new CheckError("not_an_image");
  try {
    const d = await decodeJpeg(image.bytes);
    if (d?.width !== image.width || d?.height !== image.height) bad();
  } catch (e) {
    throw e instanceof CheckError ? e : new CheckError("not_an_image");
  }
}

// ---------------------------------------------------------------------------------------------------
// The request. Every field is named here; anything else in the body is refused, which is also what
// keeps price, status, shop or anything internal from being set from outside.

export const SLOTS = ["09:00 - 11:00", "11:00 - 13:00", "13:00 - 15:00", "15:00 - 17:00", "17:00 - 19:00", "19:00 - 21:00"];
export const PAYMENT_METHODS = ["gcash", "maya", "bank", "cash", "other"];
export const MAX_DAYS_AHEAD = 90;
const FIELDS = ["request_key", "lang", "buyer_name", "buyer_phone", "receiver_name", "receiver_phone", "mode", "date", "slot",
  "address", "lat", "lng", "location_source", "location_confirmed_at", "description", "special_requests", "card_message",
  "payment_method", "reference_files", "payment_proof", "pickup_branch"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const inPhilippines = (lat: number, lng: number) => lat >= 4 && lat <= 21.5 && lng >= 116 && lng <= 127;
// The shop's day, whatever the server's or the visitor's clock zone: Manila is UTC+8 all year.
export const manilaDate = (now: number, plusDays = 0) => new Date(now + 8 * 3600_000 + plusDays * 86400_000).toISOString().slice(0, 10);

// "+639171234567" from what people type. Philippine mobiles may come without the country code; any
// other country needs it (+ or 00), because the buyer is often abroad.
export function phoneE164(raw: unknown): string | null {
  const s = String(raw ?? "").trim(), digits = s.replace(/\D/g, "");
  if (!/^[\d\s().+-]{7,24}$/.test(s)) return null;
  const full = s.startsWith("+") ? digits : s.startsWith("00") ? digits.slice(2)
    : /^09\d{9}$/.test(digits) ? "63" + digits.slice(1) : /^9\d{9}$/.test(digits) ? "63" + digits : "";
  return /^[1-9]\d{9,14}$/.test(full) ? "+" + full : null;
}

const text = (v: unknown, field: string, min: number, max: number, lines = false) => {
  if (v == null && min === 0) return "";
  if (typeof v !== "string") throw new CheckError("invalid", field);
  // Control characters have no place in any of these; line breaks only in the longer texts
  const s = v.replace(/\r\n?/g, "\n").trim();
  if (s.length < min || s.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s) || (!lines && /[\n\t]/.test(s))) throw new CheckError("invalid", field);
  return s;
};

export type PublicRequest = ReturnType<typeof checkRequest>;
export function checkRequest(body: unknown, now: number) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CheckError("invalid");
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).find((k) => !FIELDS.includes(k));
  if (extra) throw new CheckError("unknown_field", extra);
  const fail = (field: string): never => { throw new CheckError("invalid", field); };

  if (typeof b.request_key !== "string" || !UUID.test(b.request_key)) fail("request_key");
  const mode = b.mode === "delivery" || b.mode === "pickup" ? b.mode : fail("mode");
  const buyer_phone = phoneE164(b.buyer_phone) ?? fail("buyer_phone");
  const receiver_phone = phoneE164(b.receiver_phone) ?? fail("receiver_phone");
  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && !Number.isNaN(Date.parse(b.date + "T00:00:00Z"))
    && new Date(b.date + "T00:00:00Z").toISOString().slice(0, 10) === b.date ? b.date : fail("date");
  if (date < manilaDate(now) || date > manilaDate(now, MAX_DAYS_AHEAD)) fail("date");
  const slot = typeof b.slot === "string" && SLOTS.includes(b.slot) ? b.slot : fail("slot");
  const payment_method = typeof b.payment_method === "string" && PAYMENT_METHODS.includes(b.payment_method) ? b.payment_method : fail("payment_method");

  let address = "", lat: number | null = null, lng: number | null = null, location_source: string | null = null, location_confirmed_at: string | null = null;
  if (mode === "delivery") {
    address = text(b.address, "address", 8, 300, true);
    if (typeof b.lat !== "number" || typeof b.lng !== "number" || !Number.isFinite(b.lat) || !Number.isFinite(b.lng) || !inPhilippines(b.lat, b.lng)) fail("location");
    lat = +(b.lat as number).toFixed(6); lng = +(b.lng as number).toFixed(6);
    location_source = b.location_source === "search" || b.location_source === "pin" || b.location_source === "device" ? b.location_source : fail("location");
    const at = typeof b.location_confirmed_at === "string" ? Date.parse(b.location_confirmed_at) : NaN;
    // Confirmed by the person, in this sitting: not in the future, not from another day
    if (!(at <= now + 5 * 60_000 && at >= now - 24 * 3600_000)) fail("location");
    location_confirmed_at = new Date(at).toISOString();
  } else if (b.address != null || b.lat != null || b.lng != null || b.location_source != null || b.location_confirmed_at != null) fail("location");
  // Pickup: the shop the customer chose (its branch name; the database checks it exists and is open that day)
  const pickup_branch = mode === "pickup" ? text(b.pickup_branch, "pickup_branch", 1, 60) : b.pickup_branch == null ? null : fail("pickup_branch");

  const refs = b.reference_files ?? [];
  if (!Array.isArray(refs) || refs.length > 6 || refs.some((f) => typeof f !== "string" || !UUID.test(f)) || new Set(refs).size !== refs.length) fail("reference_files");
  if (b.payment_proof != null && (typeof b.payment_proof !== "string" || !UUID.test(b.payment_proof))) fail("payment_proof");

  return {
    request_key: (b.request_key as string).toLowerCase(), lang: b.lang === "es" ? "es" : "en",
    buyer_name: text(b.buyer_name, "buyer_name", 2, 80), buyer_phone,
    receiver_name: text(b.receiver_name, "receiver_name", 2, 80), receiver_phone,
    mode, date, slot, address, lat, lng, location_source, location_confirmed_at, pickup_branch,
    description: text(b.description, "description", 3, 1000, true), special_requests: text(b.special_requests, "special_requests", 0, 500, true),
    card_message: text(b.card_message, "card_message", 0, 300, true), payment_method,
    reference_files: (refs as string[]).map((f) => f.toLowerCase()), payment_proof: b.payment_proof ? (b.payment_proof as string).toLowerCase() : null,
  };
}
