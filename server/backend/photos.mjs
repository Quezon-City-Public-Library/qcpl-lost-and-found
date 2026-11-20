/* ==========================================================================
   Photos of reports.

   Photos arrive inside a report (as data: pictures made by the browser). Here
   they are checked (really JPEG, PNG or WebP; at most 600 KB each, 8 per
   report), stored in the database, and the report keeps only an address like
   /api/v1/photo/<32 hex>. That address works only for people allowed to see
   the report (see projection.photoAllowed), and photos are sent with headers
   that stop a browser from treating them as anything but an image.
   ========================================================================== */
import { randomBytes, createHash } from "node:crypto";

const MAX_BYTES = 600 * 1024, MAX_PER_ACTION = 8;
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAGIC = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
  "image/webp": (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
};
export const PHOTO_URL = /^\/api\/v1\/photo\/([a-f0-9]{32})$/;

/** Replaces every data: picture in a report's photo fields with a stored photo address. Returns the new ids. */
export function storePhotosIn(store, args) {
  const ids = [];
  let count = 0;
  const save = (value) => {
    if (typeof value !== "string" || !value.startsWith("data:")) return value;
    const m = DATA_URL.exec(value);
    if (!m) throw Object.assign(new Error("Please use a JPG, PNG or WebP picture."), { status: 400 });
    if (++count > MAX_PER_ACTION) throw Object.assign(new Error("You can add up to 8 photos."), { status: 400 });
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > MAX_BYTES) throw Object.assign(new Error("A photo is too large. Please use a smaller picture."), { status: 400 });
    if (!MAGIC[m[1]](bytes)) throw Object.assign(new Error("Please use a JPG, PNG or WebP picture."), { status: 400 });
    const id = randomBytes(16).toString("hex");
    store.q.photoPut.run(id, m[1], bytes, bytes.length, createHash("sha256").update(bytes).digest("hex"), null, null, Date.now());
    ids.push(id);
    return `/api/v1/photo/${id}`;
  };
  const walk = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const k of ["photo", "photos", "addPhotos"]) {
      if (Array.isArray(obj[k])) obj[k] = obj[k].map(save);
      else if (typeof obj[k] === "string") obj[k] = save(obj[k]);
    }
  };
  args.forEach((a, i) => { if (Array.isArray(a)) args[i] = a.map(save); else walk(a); });
  return ids;
}

/** After the action: link new photos to the record that now holds them */
export function claimPhotos(store, snapshot, ids, keys = ["qcpllf_lost", "qcpllf_found"]) {
  if (!ids.length) return;
  const want = new Set(ids);
  for (const key of keys) for (const rec of snapshot(key)) {
    for (const url of [rec.photo, ...(rec.photos || [])]) {
      const m = PHOTO_URL.exec(url || "");
      if (m && want.has(m[1])) { store.q.photoOwn.run(key, rec.id, m[1]); want.delete(m[1]); }
    }
  }
}

export function sendPhoto(res, row, headers) {
  res.writeHead(200, { ...headers, "Content-Type": row.mime, "Content-Length": row.bytes.length, "Cache-Control": "private, max-age=3600",
    "Content-Security-Policy": "default-src 'none'; sandbox", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" });
  res.end(row.bytes);
}
