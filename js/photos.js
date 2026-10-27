// Photos: signed links to the private buckets, compression (and iPhone HEIC conversion), and the pickers.

// Signed links last an hour; renew them a bit before they run out.
async function photoUrl(path, bkt = bucket) {
  if (!path) return null;
  const key = bkt + "/" + path, c = S.photoUrls[key];
  if (c && c.exp > Date.now()) return c.url;
  const { data } = await sb.storage.from(bkt).createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  S.photoUrls[key] = { url: data.signedUrl, exp: Date.now() + 50 * 60e3 };
  return data.signedUrl;
}
const imgOf = (path, bkt, alt) => {
  const box = el("div", { class: "drop ro-photo" }, t("loadingPhoto"));
  photoUrl(path, bkt).then((u) => box.replaceChildren(u ? el("img", { src: u, alt, loading: "lazy" }) : t("photoFail")));
  return box;
};
// The bouquet once it exists, otherwise the reference photo, otherwise the emblem
function thumb(o, cls = "thumb") {
  const photo = o.bouquet_path || o.photo_path;
  const th = el("div", { class: cls }, photo ? "" : el("img", { src: "/img/emblem.webp", alt: "", class: "placeholder-emblem" }));
  if (photo) photoUrl(photo, o.bouquet_path ? ENTREGAS : bucket).then((u) => { if (u) th.replaceChildren(el("img", { src: u, alt: "", loading: "lazy" })); });
  return th;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?|jfif)$/i;
const isImage = (f) => f && (f.type.startsWith("image/") || IMAGE_EXT.test(f.name || ""));
const isHeic = (f) => /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name || "");
let heicLib = null;
function loadHeic() {
  // iPhone photos (HEIC) only decode natively in Safari; elsewhere convert them in the browser.
  heicLib ||= new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
    sc.integrity = "sha384-OTofQ0MEeiSgh62havBcemCIK0gqj809wX6UA0uPISNMRnR6NZyCdGzX3SbLrgwL"; sc.crossOrigin = "anonymous";
    sc.onload = () => res(window.heic2any); sc.onerror = () => { heicLib = null; rej(new Error("heic2any")); };
    document.head.append(sc);
  });
  return heicLib;
}
async function compress(file) {
  try { return await toJpeg(file); } catch (e) {
    if (!isHeic(file)) throw e;
    const heic2any = await loadHeic();
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    return toJpeg(Array.isArray(out) ? out[0] : out);
  }
}
function toJpeg(file) {
  return new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height; const max = 1200;
      if (Math.max(w, h) > max) { const r = max / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
      const c = document.createElement("canvas"); c.width = w; c.height = h; const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h); // white behind transparent PNGs
      URL.revokeObjectURL(u); c.toBlob((b) => (b ? res(b) : rej(new Error("blob"))), "image/jpeg", 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error("img")); };
    img.src = u;
  });
}

// One photo field: pick (file, drag, or paste when `paste` is on), replace or remove.
// upload(dest) puts a new photo in storage and returns its path, null when it was removed, or undefined when
// nothing changed. The previous file is only deleted by cleanup(), once the order row points at the new one,
// so a failed save never leaves an order pointing at a deleted photo.
function photoPicker({ current, bkt = ENTREGAS, hint, alt = "", onErr, paste = false }) {
  let blob = null, removed = false, preview = null, oldPath = null;
  const input = el("input", { type: "file", accept: "image/*,.heic,.heif", hidden: true });
  const box = el("div", { class: "drop" });
  const draw = async () => {
    if (preview) { URL.revokeObjectURL(preview); preview = null; }
    if (blob) preview = URL.createObjectURL(blob);
    const src = preview || (!removed && current ? await photoUrl(current, bkt) : null);
    box.replaceChildren(
      src ? el("img", { src, alt }) : el("div", {}, hint),
      el("div", { class: "drop-acts" },
        el("button", { class: "btn", type: "button", onclick: () => input.click() }, src ? t("changePhoto") : t("uploadPhoto")),
        src ? el("button", { class: "btn", type: "button", onclick: () => { blob = null; removed = true; picker.dirty = true; draw(); } }, t("remove")) : null));
  };
  const take = async (file) => {
    if (!file) return;
    if (!isImage(file)) { onErr(t("notImage")); return; }
    if (isHeic(file)) toast(t("converting"));
    try { blob = await compress(file); removed = false; picker.dirty = true; draw(); } catch { onErr(t("readFail")); }
  };
  input.addEventListener("change", () => take(input.files[0]));
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("over"); });
  box.addEventListener("dragleave", () => box.classList.remove("over"));
  box.addEventListener("drop", (e) => { e.preventDefault(); box.classList.remove("over"); take(e.dataTransfer.files[0]); });
  const onPaste = (e) => { const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/")); if (it) { e.preventDefault(); take(it.getAsFile()); } };
  if (paste) document.addEventListener("paste", onPaste);
  draw();
  const picker = {
    node: el("div", { style: "display:contents" }, box, input),
    dirty: false,
    // dest(orderId) → the storage path for a new file
    async upload(orderId, dest = (id) => id + "/" + crypto.randomUUID() + ".jpg") {
      if (blob) {
        const path = dest(orderId);
        // Only the order screenshot keeps a fixed name (<id>.jpg) and is overwritten; florists and drivers
        // may only add files, so bouquet and proof photos always get a new name.
        const up = await sb.storage.from(bkt).upload(path, blob, { contentType: "image/jpeg", upsert: bkt === bucket });
        if (up.error) throw new Error(t("photoUploadFail"));
        delete S.photoUrls[bkt + "/" + path];
        if (current && current !== path) oldPath = current;
        return path;
      }
      if (removed && current) { oldPath = current; return null; }
      return undefined;
    },
    async cleanup() { if (oldPath) { await sb.storage.from(bkt).remove([oldPath]); oldPath = null; } },
    dispose() { if (preview) URL.revokeObjectURL(preview); if (paste) document.removeEventListener("paste", onPaste); },
  };
  return picker;
}

// Remove every file an order points at (used when an admin deletes orders for good)
async function removeFiles(orders) {
  const shots = orders.map((o) => o.photo_path).filter(Boolean);
  const pics = orders.flatMap((o) => [o.proof_path, o.bouquet_path]).filter(Boolean);
  if (shots.length) await sb.storage.from(bucket).remove(shots);
  if (pics.length) await sb.storage.from(ENTREGAS).remove(pics);
}
