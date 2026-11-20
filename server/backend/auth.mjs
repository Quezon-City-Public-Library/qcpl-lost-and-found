/* ==========================================================================
   Passwords and sessions.

   Passwords: scrypt (slow on purpose, with a random salt per password), compared
   in constant time. Stored as "scrypt$N$r$p$salt$hash".

   Sessions: a random 256-bit token in an HttpOnly, SameSite=Strict cookie
   ("__Host-" prefixed and Secure on HTTPS). Only a SHA-256 hash of the token is
   stored, so a copy of the database can't be used to sign in. A new token is
   issued on every sign-in or sign-out (no session fixation). Each session also
   has a CSRF token that must come back in a header with every change.
   Users are signed out after 30 idle minutes, staff after 20, and every
   session ends 12 hours after it was last used.
   ========================================================================== */
import { scrypt, randomBytes, timingSafeEqual, createHash } from "node:crypto";

const N = 1 << 15, R = 8, P = 1, KEYLEN = 32;
const scryptAsync = (pw, salt, n = N, r = R, p = P) => new Promise((resolve, reject) =>
  scrypt(pw, salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) => (err ? reject(err) : resolve(key))));
const DUMMY = "scrypt$32768$8$1$" + Buffer.alloc(16).toString("base64") + "$" + Buffer.alloc(KEYLEN).toString("base64");

/* Plugged into the rules (js/store.js) as window.LF_PASSWORDS. The "salt" argument the rules pass
   (e.g. "lf-staff") is only a label here; every password gets its own random salt. */
export const passwords = {
  async hash(_label, pw) {
    pw = String(pw || "");
    if (pw.length > 256) throw Object.assign(new Error("The password is too long."), { status: 400 });
    const salt = randomBytes(16);
    const key = await scryptAsync(pw.normalize("NFKC"), salt);
    return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
  },
  async verify(stored, _label, pw) {
    const parts = String(stored || "").startsWith("scrypt$") ? String(stored).split("$") : DUMMY.split("$");
    const [, n, r, p, salt, hash] = parts;
    const want = Buffer.from(hash, "base64");
    let key;
    try { key = await scryptAsync(String(pw || "").slice(0, 256).normalize("NFKC"), Buffer.from(salt, "base64"), Number(n), Number(r), Number(p)); } catch { return false; }
    const same = key.length === want.length && timingSafeEqual(key, want);
    return same && String(stored || "").startsWith("scrypt$");
  },
};

const sha = (s) => createHash("sha256").update(s).digest("hex");
export const USER_IDLE = 30 * 60_000, STAFF_IDLE = 20 * 60_000, SESSION_LIFE = 12 * 3600_000;

export function createSessions(store, { secure }) {
  const COOKIE = secure ? "__Host-qcpl_sid" : "qcpl_sid";
  const cache = new Map(); // hashed id → session
  const fresh = (ip) => ({ csrf: randomBytes(24).toString("base64url"), userId: null, staff: null, pending: null, unlocked: [], created: Date.now(), userSeen: 0, staffSeen: 0, ip });

  function save(id, s) {
    s.seen = Date.now();
    cache.set(id, s);
    store.q.sessPut.run(id, JSON.stringify(s), s.created, s.seen, s.seen + SESSION_LIFE);
  }
  function load(token) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const id = sha(token);
    let s = cache.get(id);
    if (!s) {
      const row = store.q.sessGet.get(id);
      if (!row || row.expires < Date.now()) return null;
      s = JSON.parse(row.json);
    }
    if (Date.now() - (s.seen || 0) > SESSION_LIFE) { destroyId(id); return null; }
    return { id, s };
  }
  function destroyId(id) { cache.delete(id); store.q.sessDelete.run(id); }

  /** The visitor's session (a new guest session if they have none). Applies idle sign-out. */
  function get(req, res) {
    const token = cookieOf(req, COOKIE);
    let found = load(token);
    let isNew = false;
    if (!found) {
      const t = randomBytes(32).toString("base64url");
      found = { id: sha(t), s: fresh(req.ip), token: t };
      isNew = true;
    }
    const { s } = found;
    const now = Date.now();
    s.idleOut = false;
    if (s.staff && now - (s.staffSeen || 0) > STAFF_IDLE) { s.staff = null; s.idleOut = true; }
    if (s.userId && now - (s.userSeen || 0) > USER_IDLE) { s.userId = null; s.idleOut = true; }
    if (isNew) setCookie(res, found.token);
    return { ...found, isNew };
  }
  /** Saves the session. With rotate=true (sign-in/out) the visitor gets a new token. */
  function commit(res, sess, { rotate = false, active = false } = {}) {
    const s = sess.s;
    if (active) { if (s.staff) s.staffSeen = Date.now(); if (s.userId) s.userSeen = Date.now(); }
    if (rotate) {
      destroyId(sess.id);
      const t = randomBytes(32).toString("base64url");
      sess.id = sha(t); sess.token = t;
      s.csrf = randomBytes(24).toString("base64url");
      setCookie(res, t);
    }
    save(sess.id, s);
  }
  function setCookie(res, token) {
    const prev = res.getHeader("Set-Cookie");
    const c = `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
    res.setHeader("Set-Cookie", prev ? [].concat(prev, c) : c);
  }
  // Expired sessions are removed every 10 minutes
  setInterval(() => {
    store.q.sessPurge.run(Date.now());
    for (const [id, s] of cache) if (Date.now() - s.seen > SESSION_LIFE) cache.delete(id);
  }, 600_000).unref();
  return { get, commit, COOKIE };
}

export function cookieOf(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(/;\s*/)) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1); }
  return null;
}
export const safeEqual = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };
