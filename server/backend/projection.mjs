/* ==========================================================================
   What each visitor may see.

   The browser only ever receives the records it is allowed to see, with only
   the fields it is allowed to see:

   - Staff: every record of their library (never password hashes, codes or lockouts).
   - A signed-in user: their own reports, claims, updates and certificates
     (matched by account, or by their confirmed mobile number).
   - A visitor who checked a report on Check Status (reference + phone digits):
     that report and its updates.
   - Everyone: found items on public display, with general details only
     (no finder, no private details, no exact spot; photos of IDs, wallets and
     phones removed). Other people's lost reports are never sent.
   - Numbers for the public pages (totals, monthly chart, wall of honesty) are
     worked out here, so visitors never receive other people's records.
   ========================================================================== */
import { createHash } from "node:crypto";

const PUBLIC_FOUND = ["recorded", "possible-owner", "claimed"];
const ACTIVE_LOST = ["reported", "searching", "possible-match"];
const PRIVATE_PHOTO_CATS = ["wallets", "phones"];
const FOUND_PUBLIC_FIELDS = ["id", "library", "createdAt", "updatedAt", "title", "category", "color", "brand", "description", "date", "branch", "location", "floor", "status", "photo", "photos", "holdExtra"];
const SECRET_FIELDS = ["passHash", "hash", "demo", "remindedRefs"];
export const DATA_KEYS = { found: "qcpllf_found", lost: "qcpllf_lost", claims: "qcpllf_claims", users: "qcpllf_users", notifs: "qcpllf_notifs",
  activity: "qcpllf_activity", feedback: "qcpllf_feedback", contribs: "qcpllf_contribs", staff: "qcpllf_staffaccts" };

const digits = (s) => String(s || "").replace(/\D/g, "");
const samePhone = (a, b) => { const x = digits(a), y = digits(b); return x.length >= 7 && x.slice(-10) === y.slice(-10); };
const pick = (rec, fields) => Object.fromEntries(fields.filter((f) => rec[f] !== undefined).map((f) => [f, rec[f]]));
const clean = (rec) => { const o = { ...rec }; SECRET_FIELDS.forEach((f) => delete o[f]); return o; };
export const publicId = (id) => "P-" + createHash("sha256").update("qcpl-public:" + id).digest("hex").slice(0, 12).toUpperCase();
const publicPhotos = (rec, out) => {
  if (PRIVATE_PHOTO_CATS.includes(rec.category)) { delete out.photo; delete out.photos; }
  return out;
};

/* Who is looking: staff, user (with their record), what they opened */
export function viewOf(ctx, snapshot) {
  const user = ctx.userId ? snapshot(DATA_KEYS.users).find((u) => u.id === ctx.userId && u.active !== false) || null : null;
  return { library: ctx.library, staff: ctx.staff || null, user, phoneOk: !!(user && user.contactVerified !== false), unlocked: new Set(ctx.unlocked || []) };
}

/* One record as this visitor may see it: { full } | { pub } | null */
function judge(kind, rec, v) {
  if (!rec || rec.library !== v.library) return null;
  if (v.staff) return { full: clean(rec) };
  const u = v.user;
  const mine = (phoneField) => !!u && (rec.userId === u.id || (v.phoneOk && samePhone(rec[phoneField], u.phone)));
  switch (kind) {
    case "found":
      if (mine("finderPhone") || v.unlocked.has(rec.id)) return { full: clean(rec) };
      return PUBLIC_FOUND.includes(rec.status) ? { pub: publicPhotos(rec, { ...pick(rec, FOUND_PUBLIC_FIELDS), history: (rec.history || []).map((h) => ({ status: h.status, at: h.at })) }) } : null;
    case "lost":
      return mine("phone") || v.unlocked.has(rec.id) ? { full: clean(rec) } : null;
    case "claims":
      return mine("phone") || v.unlocked.has(rec.id) || (rec.lostId && v.unlocked.has(rec.lostId)) ? { full: clean(rec) } : null;
    case "notifs":
      return (u && (rec.userId === u.id || (v.phoneOk && samePhone(rec.phone, u.phone)))) || v.unlocked.has(rec.ref) ? { full: clean(rec) } : null;
    case "contribs":
      return (u && (rec.userId === u.id || (v.phoneOk && samePhone(rec.phone, u.phone)))) || [...(rec.lostIds || []), ...(rec.foundIds || [])].some((id) => v.unlocked.has(id)) ? { full: clean(rec) } : null;
    case "feedback":
      return v.unlocked.has(rec.ref) || (u && v.ownRefs && v.ownRefs.has(rec.ref)) ? { full: clean(rec) } : null;
    case "users":
      return u && rec.id === u.id ? { full: clean(rec) } : null;
    default:
      return null; // activity log and staff accounts: staff only
  }
}

function libraryOf(kind, rec, v) {
  // Staff accounts of the head office ("all") are listed with every library
  if (kind === "staff" && v.staff && rec.library === "all") return v.library;
  return rec.library;
}

/** Everything this visitor may see, ready for the browser */
export function fullSync(ctx, snapshot) {
  const v = viewOf(ctx, snapshot);
  const data = {};
  // Own references (for feedback on own reports)
  if (v.user) {
    v.ownRefs = new Set();
    for (const k of ["lost", "found", "claims"]) for (const r of snapshot(DATA_KEYS[k])) {
      const j = judge(k, r, v); if (j && j.full) v.ownRefs.add(r.id);
    }
  }
  for (const [kind, key] of Object.entries(DATA_KEYS)) {
    const out = [];
    if (!v.staff && (kind === "activity" || kind === "staff")) { data[key] = out; continue; }
    for (const rec of snapshot(key)) {
      const r = kind === "staff" ? { ...rec, library: libraryOf(kind, rec, v) } : rec;
      if (kind === "staff") { if (r.library === v.library && v.staff) out.push(clean(r)); continue; }
      const j = judge(kind, r, v);
      if (j) out.push(j.full || j.pub);
    }
    data[key] = out;
  }
  return data;
}

/** Only what changed in one action, as this visitor may see it */
export function patchFor(ctx, snapshot, changes) {
  const v = viewOf(ctx, snapshot);
  const patch = {};
  for (const [kind, key] of Object.entries(DATA_KEYS)) {
    const ch = changes[key];
    if (!ch) continue;
    const upsert = [], remove = [];
    const byId = new Map(snapshot(key).map((r) => [r.id, r]));
    for (const id of ch.upserted) {
      const rec = byId.get(id);
      if (kind === "staff") { if (v.staff && rec) { upsert.push(clean({ ...rec, library: libraryOf(kind, rec, v) })); } continue; }
      if (kind === "activity") { if (v.staff && rec && rec.library === v.library) upsert.push(clean(rec)); continue; }
      const j = judge(kind, rec, v);
      if (j && j.full) { upsert.push(j.full); if (kind === "lost") remove.push(publicId(id)); }
      else if (j && j.pub) { upsert.push(j.pub); if (kind === "lost") remove.push(id); }
      else { remove.push(id); if (kind === "lost") remove.push(publicId(id)); }
    }
    for (const id of ch.removed) { remove.push(id); if (kind === "lost") remove.push(publicId(id)); }
    if (upsert.length || remove.length) patch[key] = { upsert, remove };
  }
  return patch;
}

/** Can this visitor see this record's photos? (for /api/v1/photo/…) */
export function photoAllowed(ctx, snapshot, ownerKey, ownerId) {
  const kind = Object.keys(DATA_KEYS).find((k) => DATA_KEYS[k] === ownerKey);
  if (!kind || (kind !== "found" && kind !== "lost")) return false;
  const rec = snapshot(ownerKey).find((r) => r.id === ownerId);
  if (!rec) return false;
  const v = viewOf({ ...ctx, library: rec.library }, snapshot);
  if (v.staff && (v.staff.library === "all" || v.staff.library === rec.library)) return true;
  const j = judge(kind, rec, v);
  return !!(j && (j.full || (j.pub && (j.pub.photo || (j.pub.photos || []).length))));
}

/** A visitor's account, as shown to them (never the password hash) */
export const userView = (u) => u && pick(u, ["id", "name", "phone", "email", "role", "memberId", "verified", "contactVerified", "mustChange", "library", "lang", "active", "createdAt"]);
export const staffView = (s) => s && pick(s, ["username", "name", "role", "library", "level", "mustChange"]);
