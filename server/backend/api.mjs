/* ==========================================================================
   The website's API (/api/v1/…).

   GET  /api/v1/session         who is signed in, and the CSRF token
   GET  /api/v1/sync?library=   the records this visitor may see (see projection.mjs)
   POST /api/v1/act             one action, e.g. {"name":"createLost","args":[{…}]}
   GET  /api/v1/photo/<id>      a photo, if this visitor may see it
   GET  /setup  POST /setup     first start only, from this computer only: create the head administrator

   Every change needs: the session cookie, the CSRF token in the X-CSRF header,
   a request from this website (Origin), JSON, and a size within limits. Only
   the actions listed in ACTIONS can be called, each with the role it needs; the
   rules check permissions again themselves.
   ========================================================================== */
import { fullSync, patchFor, viewOf, photoAllowed, userView, staffView, DATA_KEYS } from "./projection.mjs";
import { storePhotosIn, claimPhotos, sendPhoto } from "./photos.mjs";
import { safeEqual, passwords } from "./auth.mjs";
import { tmpdir } from "node:os";
import { unlinkSync, createReadStream, statSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/* Every action the browser may ask for: [who may ask, what comes back]
   who: public (anyone) · user (signed-in user) · staff · supervisor
   back: "none" · "value" · "record" (secrets removed) · a function */
const ACTIONS = {
  // Reports and claims
  createLost: ["public", "record"], createFound: ["public", "record"], createClaim: ["public", "record"],
  addFeedback: ["public", "none"], markRead: ["public", "none"], checkStatus: ["public", "value"],
  updateLostByOwner: ["public", "record"], closeLostByOwner: ["public", "none"], bookPickup: ["public", "record"], cancelPickup: ["public", "none"],
  // Accounts
  register: ["public", "none"], signIn: ["public", "value"], signOut: ["public", "none"],
  sendSignupCode: ["public", "value"], confirmSignupCode: ["public", "none"], cancelSignup: ["public", "none"],
  requestPasswordReset: ["public", "value"], verifyResetCode: ["public", () => true], resetPassword: ["public", "none"],
  updateAccount: ["user", (r) => ({ needsVerify: !!(r && r.needsVerify) })], deleteAccount: ["user", "none"],
  // Staff
  setClaimStatus: ["staff", "none"], recordReturn: ["staff", "none"], setStatus: ["staff", "none"], dismissMatch: ["staff", "none"],
  contactOwner: ["staff", "none"], setUserActive: ["staff", "none"], setUserVerified: ["staff", "none"], extendHold: ["staff", "none"],
  adminResetUserPassword: ["staff", "value"], updateRecord: ["staff", "record"], setStorage: ["staff", "none"],
  startTransfer: ["staff", "none"], receiveTransfer: ["staff", "none"], setThankNote: ["staff", "none"], changeStaffPassword: ["staff", "none"],
  // Supervisors
  disposeItem: ["supervisor", "none"], issueContribution: ["supervisor", "record"], clearLibraryRecords: ["supervisor", "none"],
  createStaff: ["supervisor", "none"], setStaffActive: ["supervisor", "none"], setStaffRole: ["supervisor", "none"], resetStaffPassword: ["supervisor", "value"],
};
const CREATES = { createLost: "lost", createFound: "found", createClaim: "claims" };
// Wrong passwords / passphrases on the Backups page: 10 in an hour, then wait (correct tries don't count)
const backupFails = new Map();
const tooManyFails = (key) => (backupFails.get(key) || []).filter((t) => Date.now() - t < 3600_000).length >= 10;
const noteBackupFail = (key) => backupFails.set(key, [...(backupFails.get(key) || []).filter((t) => Date.now() - t < 3600_000), Date.now()]);
const WITH_PHOTOS = new Set(["createLost", "createFound", "updateLostByOwner"]);
const SECRET = new Set(["passHash", "hash", "demo", "resets", "verifies"]);
const scrub = (v, depth = 0) => {
  if (depth > 6 || v == null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET.has(k)).map(([k, x]) => [k, scrub(x, depth + 1)]));
};

/* Where administrators may sign in from (ADMIN_NETWORKS in server/.env):
     empty  → anywhere
     local  → this computer and private networks (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
     or a list of addresses / starts of addresses, e.g.  local, 203.177.42.10, 112.198.  */
export function adminNetworkCheck(setting) {
  const list = String(setting || "").split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.includes("anywhere")) return () => true;
  const LOCAL = (ip) => ip === "127.0.0.1" || ip === "::1" || /^127\./.test(ip) || /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe80:/.test(ip);
  return (raw) => {
    const ip = String(raw || "").toLowerCase().replace(/^::ffff:/, "");
    return list.some((x) => (x === "local" ? LOCAL(ip) : x.endsWith(".") || x.endsWith(":") ? ip.startsWith(x) : ip === x));
  };
}

export function createApi({ engine, store, sessions, allow, json, headers, readJson, libraries, demoCodes, channels, log, backups, restart, maxUploadBytes = 2 * 1024 ** 3, adminNetworks = "" }) {
  const adminNetworkOk = adminNetworkCheck(adminNetworks);
  const NOT_HERE = "Administrator sign-in isn't available from this network. Please use a computer at the library.";
  const LIB_IDS = new Set(libraries.map((l) => l.id));
  const snapshot = engine.snapshot;
  const aggCache = new Map(); // library → { version, agg }

  /* The library a visitor works in: staff and users always their own; head office staff and guests choose */
  function libraryFor(s, asked) {
    if (s.staff && s.staff.library !== "all") return s.staff.library;
    if (s.userId) { const u = snapshot(DATA_KEYS.users).find((x) => x.id === s.userId); if (u && LIB_IDS.has(u.library)) return u.library; }
    return LIB_IDS.has(asked) ? asked : libraries[0].id;
  }
  const ctxOf = (req, s, library, lang) => ({ ip: req.ip, library, lang: lang === "fil" ? "fil" : "en", userId: s.userId, staff: s.staff, pending: s.pending, unlocked: s.unlocked || [] });
  function sessionView(s) {
    const u = s.userId ? snapshot(DATA_KEYS.users).find((x) => x.id === s.userId) : null;
    const p = s.pending ? snapshot(DATA_KEYS.users).find((x) => x.id === s.pending) : null;
    return { csrf: s.csrf, user: userView(u), staff: staffView(s.staff), pending: p ? { name: p.name, phone: p.phone, email: p.email } : null,
      unlocked: s.unlocked || [], idleOut: !!s.idleOut, channels: channels(), demoCodes };
  }
  /* Numbers for the public pages, worked out from all records but showing no details */
  async function aggFor(library) {
    const c = aggCache.get(library);
    if (c && c.version === engine.version) return c.agg;
    const agg = await engine.read({ ip: "server", library, lang: "en", unlocked: [] }, (LF) => ({
      totals: LF.totals(), monthly: LF.monthlyTotals(12), lostByDate: LF.lostReportsByDate(30), wall: LF.wallOfHonesty(12),
    }));
    aggCache.set(library, { version: engine.version, agg });
    return agg;
  }
  const isUserError = (e) => e && (e.name === "Error" || e.status) && typeof e.message === "string" && e.message.length < 400;

  async function act(req, res, sess) {
    const s = sess.s;
    const body = await readJson(req, 4 * 1024 * 1024);
    const name = String(body.name || "");
    const def = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : null;
    if (!def) return json(res, 400, { error: "Unknown action." });
    const [role, back] = def;
    if (role === "user" && !s.userId) return json(res, 401, { error: "Please sign in first." });
    if ((role === "staff" || role === "supervisor") && !s.staff) return json(res, 401, { error: "Only an administrator can do this. Please sign in as an administrator." });
    if (role === "supervisor" && s.staff.level === "desk") return json(res, 403, { error: "Only a supervisor can do this." });
    // Temporary staff password: only "change my password" (and sign out) until it is changed
    if (s.staff && s.staff.mustChange && !["changeStaffPassword", "signOut"].includes(name)) return json(res, 403, { error: "Please choose your own password first." });
    const args = Array.isArray(body.args) ? body.args.slice(0, 6) : [];
    if (JSON.stringify(args).length > 4 * 1024 * 1024) return json(res, 413, { error: "The request is too large." });
    if (name === "signIn" && args[0] === "admin" && !adminNetworkOk(req.ip)) { log(`Administrator sign-in refused from ${req.ip} (not an allowed network)`); return json(res, 403, { error: NOT_HERE }); }
    // Sign-in attempts from one network address, across all accounts
    if (name === "signIn" && !allow("signin:" + req.ip, { max: 30, windowMs: 15 * 60_000 })) return json(res, 429, { error: "Too many sign-in attempts. Please wait 15 minutes." });
    // Codes: the browser can't ask to see them; only the server's demo setting can
    if (name === "sendSignupCode") args.splice(0, args.length, { demo: demoCodes });
    if (name === "requestPasswordReset") args.splice(1, args.length, { demo: demoCodes });
    const library = libraryFor(s, String(body.library || ""));
    const ctx = ctxOf(req, s, library, body.lang);
    // Only the visitor's own updates can be marked as read
    if (name === "markRead") {
      const v = viewOf(ctx, snapshot), mine = new Set(fullSync(ctx, snapshot)[DATA_KEYS.notifs].map((n) => n.id));
      void v; args[0] = (Array.isArray(args[0]) ? args[0] : []).filter((id) => mine.has(id)).slice(0, 500);
    }
    const photoIds = WITH_PHOTOS.has(name) ? storePhotosIn(store, args) : [];
    if (photoIds.length && store.cloud) {
      try { await store.cloud.uploadPhotos(store, photoIds); }
      catch (e) { for (const id of photoIds) store.q.photoDelete.run(id); log("Photo upload to Supabase failed:", e.message); return json(res, 503, { error: "The photo couldn't be saved right now. Please try again in a minute." }); }
    }
    let out;
    try {
      out = await engine.run(name, args, ctx, {
        // A new report or claim opens for the visitor who made it (they can check it right away)
        after: (LF, cur, result) => { if (CREATES[name] && result && result.id) LF.unlockCertificate(result.id); },
      });
    } catch (e) {
      if (isUserError(e)) return json(res, e.status === 503 ? 503 : e.status && e.status >= 400 && e.status < 500 ? e.status : 400, { error: e.message });
      log("Action failed:", name, e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e);
      return json(res, 500, { error: "Something went wrong. Please try again." });
    }
    claimPhotos(store, snapshot, photoIds);
    if (photoIds.length && store.cloud) { try { await store.cloud.setPhotoOwners(store, photoIds); } catch (e) { log("Photo owners not saved in Supabase:", e.message); } }
    // Who the visitor is now
    const id = out.identity;
    const identityChanged = (id.userId || null) !== (s.userId || null) || JSON.stringify(id.staff || null) !== JSON.stringify(s.staff || null);
    const signedInNow = identityChanged && (id.userId || id.staff);
    s.userId = id.userId; s.staff = id.staff; s.pending = id.pending; s.unlocked = id.unlocked;
    if (signedInNow) { if (s.userId) s.userSeen = Date.now(); if (s.staff) s.staffSeen = Date.now(); }
    if (identityChanged) log(`Session: ${name} -> ${s.staff ? "staff " + s.staff.username : s.userId ? "user " + s.userId : "guest"} (${req.ip})`);
    sessions.commit(res, sess, { rotate: identityChanged, active: true });
    const lib2 = libraryFor(s, id.library || library);
    const ctx2 = ctxOf(req, s, lib2, body.lang);
    const result = typeof back === "function" ? back(out.result) : back === "none" ? null : scrub(out.result);
    const reply = { ok: true, result, session: sessionView(s) };
    if (identityChanged || out.flags.unlocked || out.flags.identity || lib2 !== library) reply.sync = { library: lib2, data: fullSync(ctx2, snapshot), agg: s.staff ? null : await aggFor(lib2) };
    else { reply.patch = patchFor(ctx2, snapshot, out.changes); if (!s.staff) reply.agg = await aggFor(lib2); }
    return json(res, 200, reply);
  }

  /* ---------- first start: create the head administrator (this computer only) ---------- */
  const hasHead = () => snapshot(DATA_KEYS.staff).some((x) => x.library === "all" && x.role === "Supervisor" && x.active !== false);
  // This computer itself, not a visitor coming in through a proxy or tunnel on this computer
  const local = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress) && !req.headers["x-forwarded-for"] && !req.headers["cf-connecting-ip"] && !req.headers["forwarded"];
  const setupTokens = new Map(); // one-time form tokens
  const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Set up — QCPL Lost &amp; Found</title><link rel="stylesheet" href="/css/fonts.css"><style>
    body{font-family:Inter,system-ui,sans-serif;background:#f8fafc;color:#374151;margin:0;padding:2rem 1rem}main{max-width:30rem;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:2rem}
    h1{color:#111827;margin:0 0 .5rem}label{display:block;font-weight:600;margin:1rem 0 .3rem}input{width:100%;box-sizing:border-box;padding:.75rem;border:1px solid #cbd5e1;border-radius:10px;font:inherit}
    button{margin-top:1.5rem;width:100%;padding:.85rem;border:0;border-radius:999px;background:#2563eb;color:#fff;font:600 1rem Inter,system-ui,sans-serif;cursor:pointer}.err{background:#fdecea;color:#b3261e;padding:.75rem;border-radius:10px}.ok{background:#e2f3e8;color:#14532d;padding:.75rem;border-radius:10px}p.hint{color:#6b7280;font-size:.9rem;margin:.25rem 0 0}</style></head><body><main>${body}</main></body></html>`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function setupForm(res, error = "") {
    const t = randomBytes(24).toString("base64url"); setupTokens.set(t, Date.now());
    const html = page(`<h1>Set up QCPL Lost &amp; Found</h1><p>Create the <strong>head administrator</strong> account. It can see every library and add the other staff accounts. This page works only on this computer, and only once.</p>
      ${error ? `<p class="err">${esc(error)}</p>` : ""}
      <form method="post" action="/setup"><input type="hidden" name="t" value="${t}">
      <label for="n">Full name</label><input id="n" name="name" required maxlength="80" autocomplete="name">
      <label for="u">Username</label><p class="hint">3 to 30 letters, numbers, dots or dashes. Example: qcpl.head</p><input id="u" name="username" required maxlength="30" autocapitalize="none" autocomplete="username">
      <label for="p">Password</label><p class="hint">At least 12 characters. A short sentence is easy to remember and hard to guess.</p><input id="p" name="password" type="password" required minlength="12" maxlength="200" autocomplete="new-password">
      <label for="p2">Type the password again</label><input id="p2" name="password2" type="password" required minlength="12" maxlength="200" autocomplete="new-password">
      <button type="submit">Create the head administrator</button></form>`);
    res.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(html);
  }
  async function setup(req, res) {
    if (hasHead()) { res.writeHead(303, { ...headers, Location: "/admin" }); return res.end(); }
    if (!local(req)) return json(res, 403, { error: "Setup works only on the computer running the server." });
    if (req.method === "GET") return setupForm(res);
    const raw = await new Promise((ok, no) => { let d = ""; req.on("data", (c) => { d += c; if (d.length > 8192) { no(new Error("too large")); req.destroy(); } }); req.on("end", () => ok(d)); req.on("error", no); });
    const f = Object.fromEntries(new URLSearchParams(raw));
    const t0 = setupTokens.get(f.t); setupTokens.delete(f.t);
    if (!t0 || Date.now() - t0 > 30 * 60_000) return setupForm(res, "This form expired. Please try again.");
    const username = String(f.username || "").trim().toLowerCase(), name = String(f.name || "").trim();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) return setupForm(res, "Use 3 to 30 letters, numbers, dots or dashes for the username.");
    if (!name || name.length > 80) return setupForm(res, "Please type the full name.");
    if (String(f.password || "").length < 12) return setupForm(res, "The password needs at least 12 characters.");
    if (f.password !== f.password2) return setupForm(res, "The two passwords are not the same.");
    const { passwords } = await import("./auth.mjs");
    const passHash = await passwords.hash("lf-staff", f.password);
    await engine.exec({ ip: "setup", library: libraries[0].id, lang: "en", unlocked: [] }, (LF, data) => {
      const key = DATA_KEYS.staff, list = [...data.get(key, [])];
      if (list.some((x) => x.library === "all" && x.role === "Supervisor")) return;
      list.push({ id: "S" + Date.now() + randomBytes(4).toString("hex"), username, name, role: "Supervisor", library: "all", passHash, active: true, mustChange: false, createdAt: new Date().toISOString(), createdBy: "Setup" });
      data.put(key, list);
      LF.log(name, "Head administrator account created (setup)", username, "");
    });
    log(`Setup: head administrator "${username}" created.`);
    res.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(page(`<h1>All set</h1><p class="ok">The head administrator <strong>${esc(username)}</strong> was created.</p><p>Sign in on the administrator sign-in page, <strong>/admin</strong> (for example http://localhost:8360/admin), with this username and password. Then add the other staff accounts under <strong>Staff accounts</strong>.</p><p><a href="/admin">Go to the administrator sign-in</a></p>`));
  }

  /* ---------- router ---------- */
  return {
    needsSetup: () => !hasHead(),
    async handle(req, res, url, { sameOrigin, isJson }) {
      const p = url.pathname;
      if (p === "/setup") return setup(req, res), true;
      if (!p.startsWith("/api/v1/")) return false;
      const sess = sessions.get(req, res);
      const s = sess.s;
      // An administrator session used from a network that isn't allowed loses its administrator rights
      if (s.staff && !adminNetworkOk(req.ip)) { log(`Administrator session ended: used from ${req.ip} (not an allowed network)`); s.staff = null; sessions.commit(res, sess, {}); }
      if (!allow("api:" + req.ip, { max: 240, windowMs: 60_000 })) return json(res, 429, { error: "Too many requests. Please wait a minute." }), true;
      if (req.method === "GET" && p === "/api/v1/session") { sessions.commit(res, sess, { active: url.searchParams.get("active") === "1" }); return json(res, 200, sessionView(s)), true; }
      if (req.method === "GET" && p === "/api/v1/sync") {
        const library = libraryFor(s, url.searchParams.get("library") || "");
        const ctx = ctxOf(req, s, library, url.searchParams.get("lang"));
        sessions.commit(res, sess, { active: true });
        return json(res, 200, { library, session: sessionView(s), data: fullSync(ctx, snapshot), agg: s.staff ? null : await aggFor(library) }), true;
      }
      const m = /^\/api\/v1\/photo\/([a-f0-9]{32})$/.exec(p);
      if (req.method === "GET" && m) {
        const row = store.q.photoGet.get(m[1]);
        if (!row || !row.owner_id || !photoAllowed({ ...ctxOf(req, s, "", "en") }, snapshot, row.owner_key, row.owner_id)) return json(res, 404, { error: "Not found." }), true;
        // With Supabase: the photo file is fetched the first time it is shown, then kept here
        if (!row.bytes.length && store.cloud) {
          const b = await store.cloud.fetchPhoto(m[1]).catch(() => null);
          if (!b) return json(res, 404, { error: "Not found." }), true;
          store.db.prepare("UPDATE photos SET bytes = ? WHERE id = ?").run(b, m[1]); row.bytes = b;
        }
        sendPhoto(res, row, headers); return true;
      }
      if (req.method === "POST" && p === "/api/v1/act") {
        if (!sameOrigin(req) || !isJson(req)) return json(res, 403, { error: "Not allowed from this site." }), true;
        if (sess.isNew || !safeEqual(req.headers["x-csrf"], s.csrf)) return json(res, 403, { error: "Your session expired. Please reload the page.", code: "csrf" }), true;
        await act(req, res, sess);
        return true;
      }
      if (p.startsWith("/api/v1/admin/backups")) { await backupRoutes(req, res, url, sess, { sameOrigin, isJson }); return true; }
      if (req.method === "GET" && p === "/api/v1/admin/export.xlsx") { await exportExcel(req, res, url, sess); return true; }
      return json(res, 404, { error: "Not found." }), true;
    },
  };

  /* ---------- Excel export (supervisors; the head office can export one library or all) ---------- */
  async function exportExcel(req, res, url, sess) {
    const s = sess.s;
    if (!s.staff || s.staff.level === "desk" || s.staff.mustChange) return json(res, 403, { error: "Only a supervisor can export records." });
    if (!allow("export:" + s.staff.username, { max: 20, windowMs: 3600_000 })) return json(res, 429, { error: "Too many exports. Please wait a while." });
    sessions.commit(res, sess, { active: true });
    const asked = String(url.searchParams.get("library") || "");
    const head = s.staff.library === "all";
    const libs = head ? (asked === "all" ? [...LIB_IDS] : LIB_IDS.has(asked) ? [asked] : [libraries[0].id]) : [s.staff.library];
    const inScope = (r) => libs.includes(r.library);
    const take = (key) => engine.snapshot(key).filter(inScope);
    const data = { lost: take(DATA_KEYS.lost), found: take(DATA_KEYS.found), claims: take(DATA_KEYS.claims), users: take(DATA_KEYS.users),
      staff: engine.snapshot(DATA_KEYS.staff).filter((x) => inScope(x) || x.library === "all"), activity: take(DATA_KEYS.activity),
      feedback: take(DATA_KEYS.feedback), contribs: take(DATA_KEYS.contribs) };
    const scope = libs.length === LIB_IDS.size ? "All libraries" : libs.map((id) => (libraries.find((l) => l.id === id) || {}).libraryName || id).join(", ");
    const bytes = Buffer.from(await engine.read({ ip: req.ip, library: libs[0], lang: "en", unlocked: [], staff: s.staff },
      () => engine.sandbox.QCPL_XLSX.build(data, { scope, by: `${s.staff.name} (${s.staff.username})` })));
    await engine.exec({ ip: req.ip, library: libs[0], lang: "en", unlocked: [], staff: s.staff }, (LF) =>
      LF.log(s.staff.name, "Records exported to Excel", "", `${scope}: ${data.lost.length} lost, ${data.found.length} found, ${data.claims.length} claims, ${data.users.length} users`));
    log(`Excel export by ${s.staff.username} (${req.ip}): ${scope}`);
    const name = `QCPL-Lost-and-Found-${libs.length === LIB_IDS.size ? "all-libraries" : libs[0]}-${new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)}.xlsx`; // Philippine date
    res.writeHead(200, { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Length": bytes.length,
      "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" });
    res.end(bytes);
  }

  /* ---------- Backups (head administrator only) ---------- */
  async function backupRoutes(req, res, url, sess, { sameOrigin, isJson }) {
    const s = sess.s, p = url.pathname;
    const head = s.staff && s.staff.library === "all" && s.staff.level !== "desk" && !s.staff.mustChange;
    if (!head) return json(res, 403, { error: "Only the head administrator can manage backups." });
    sessions.commit(res, sess, { active: true });
    const who = s.staff.username;
    if (req.method === "GET" && p === "/api/v1/admin/backups") {
      return json(res, 200, { enabled: backups.enabled(), key: backups.keys(), list: backups.list(), copyFolder: backups.copyDir() || "", backupFolder: backups.backupDir ? backups.backupDir() : "", passphraseMin: 16 });
    }
    if (req.method === "GET" && p === "/api/v1/admin/backups/download") {
      let file; try { file = backups.pathOf(url.searchParams.get("name")); } catch (e) { return json(res, e.status || 400, { error: e.message }); }
      if (!file.endsWith(".qcplbak")) return json(res, 400, { error: "Only encrypted backups can be downloaded. Turn on encrypted backups first." });
      log(`Backup downloaded: ${path.basename(file)} by ${who} (${req.ip})`);
      res.writeHead(200, { ...headers, "Content-Type": "application/octet-stream", "Content-Length": statSync(file).size, "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${path.basename(file)}"` });
      return createReadStream(file).pipe(res);
    }
    if (req.method !== "POST" || !sameOrigin(req) || !safeEqual(req.headers["x-csrf"], s.csrf)) return json(res, 403, { error: "Not allowed from this site." });
    // Uploading a backup file (to restore it here)
    if (p === "/api/v1/admin/backups/upload") {
      if (!/^application\/octet-stream\b/i.test(req.headers["content-type"] || "")) return json(res, 415, { error: "Send the backup file as it is." });
      if (Number(req.headers["content-length"] || 0) > maxUploadBytes) return json(res, 413, { error: "The file is too large." });
      try { const name = await backups.saveUpload(req, maxUploadBytes); log(`Backup uploaded: ${name} by ${who}`); return json(res, 200, { ok: true, name }); }
      catch (e) { return json(res, e.status || 400, { error: e.status ? e.message : "The file could not be saved." }); }
    }
    if (!isJson(req)) return json(res, 415, { error: "Use JSON." });
    const body = await readJson(req, 64 * 1024);
    // Every sensitive step asks for the head administrator's own password again, with a limit on tries
    const failKey = "backup:" + who;
    const reauth = async () => {
      if (tooManyFails(failKey)) throw Object.assign(new Error("Too many wrong tries. Please wait an hour."), { status: 429 });
      const acct = engine.snapshot(DATA_KEYS.staff).find((x) => x.username === who && x.active !== false);
      if (!acct || !(await passwords.verify(acct.passHash, "lf-staff", body.password))) { noteBackupFail(failKey); throw Object.assign(new Error("Your password is not correct."), { status: 400 }); }
    };
    // A wrong recovery passphrase counts as a wrong try too
    const withPassphrase = async (work) => { try { return await work(); } catch (e) { if (/passphrase is not correct/.test(e.message || "")) noteBackupFail(failKey); throw e; } };
    try {
      if (p === "/api/v1/admin/backups/now") {
        const r = await backups.create("manual");
        log(`Backup made by ${who}: ${r.name}`);
        return json(res, 200, { ok: true, ...r });
      }
      if (p === "/api/v1/admin/backups/passphrase") {
        await reauth();
        if (String(body.passphrase || "") !== String(body.passphrase2 || "")) return json(res, 400, { error: "The two passphrases are not the same." });
      // The recovery passphrase must be different from the sign-in password (one stolen password must not open everything)
      if (String(body.passphrase || "") === String(body.password || "")) return json(res, 400, { error: "Please choose a recovery passphrase that is different from your password." });
        const startOver = body.startOver === true && backups.enabled();
        const r = await withPassphrase(() => backups.setPassphrase(body.passphrase, body.oldPassphrase, { startOver }));
        if (startOver) log(`Backups STARTED OVER with a new key by ${who} (older backups need the old passphrase)`);
        await engine.exec({ ip: req.ip, library: libraries[0].id, lang: "en", unlocked: [], staff: s.staff }, (LF) => LF.log(s.staff.name, backups.keys() && body.oldPassphrase ? "Backup recovery passphrase changed" : "Encrypted backups turned on", r.fingerprint, ""));
        log(`Backup passphrase set by ${who} (key ${r.fingerprint})`);
        return json(res, 200, { ok: true, ...r });
      }
      if (p === "/api/v1/admin/backups/verify") {
        await reauth();
        const tmp = path.join(tmpdir(), `qcpl-verify-${Date.now()}.db`);
        try { const h = await withPassphrase(() => backups.decryptTo(backups.pathOf(body.name), body.passphrase, tmp)); return json(res, 200, { ok: true, created: h.created, counts: h.counts }); }
        finally { try { unlinkSync(tmp); } catch {} }
      }
      if (p === "/api/v1/admin/backups/restore") {
        if (body.confirm !== "RESTORE") return json(res, 400, { error: "Type RESTORE to confirm." });
        await reauth();
        const r = await withPassphrase(() => backups.prepareRestore(body.name, body.passphrase, `${s.staff.name} (${who})`));
        log(`RESTORE prepared by ${who} from ${body.name}; safety backup ${r.safety}. Restarting…`);
        json(res, 200, { ok: true, restarting: true, safety: r.safety, created: r.header.created });
        setTimeout(() => restart(), 700);
        return;
      }
    } catch (e) {
      if (e && e.status) return json(res, e.status, { error: e.message });
      log("Backup action failed:", e && e.stack ? e.stack.split("\n").slice(0, 2).join(" | ") : e);
      return json(res, 500, { error: "Something went wrong with the backup. Please try again." });
    }
    return json(res, 404, { error: "Not found." });
  }
}
