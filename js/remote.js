/* ==========================================================================
   QCPL Lost & Found — connection to the server

   When the page comes from the QCPL server (it is marked with
   <meta name="qcpl-backend">), the server holds all records:
   - On start, this file asks who is signed in and gets the records this
     visitor may see. They are kept in memory only (nothing personal is left
     in this browser's storage, which matters on shared library computers).
   - Every change (a report, a claim, signing in…) is sent to the server, which
     checks it with the same rules and answers with what changed.
   - Every change carries the session's CSRF token, so other websites can't
     make changes for a visitor.

   Without the server (the offline file, or plain file hosting) everything works
   in this browser as before. Either way, every change returns a Promise, so the
   pages use "await LF.createLost(…)" in both cases.
   ========================================================================== */
(function () {
  "use strict";
  // Everything that changes records. Reading stays as it is (from what the server sent).
  const ACTIONS = ["createLost", "createFound", "createClaim", "addFeedback", "markRead", "checkStatus", "updateLostByOwner", "closeLostByOwner",
    "bookPickup", "cancelPickup", "register", "signIn", "signOut", "sendSignupCode", "confirmSignupCode", "cancelSignup", "requestPasswordReset",
    "verifyResetCode", "resetPassword", "updateAccount", "deleteAccount", "setClaimStatus", "recordReturn", "setStatus", "dismissMatch",
    "contactOwner", "setUserActive", "setUserVerified", "extendHold", "adminResetUserPassword", "updateRecord", "setStorage",
    "startTransfer", "receiveTransfer", "setThankNote", "changeStaffPassword", "disposeItem", "issueContribution", "clearLibraryRecords",
    "createStaff", "setStaffActive", "setStaffRole", "resetStaffPassword"];

  if (!LF.REMOTE) {
    // On its own: the same actions, run here, as Promises
    ACTIONS.forEach((name) => {
      const fn = LF[name];
      if (typeof fn === "function") LF[name] = (...args) => { try { return Promise.resolve(fn(...args)); } catch (e) { return Promise.reject(e); } };
    });
    const setLib = LF.setLibrary;
    LF.setLibrary = (id) => { setLib(id); return Promise.resolve(); };
    LF.ready = Promise.resolve();
    LF.online = false;
    return;
  }

  // Demo administrator accounts (listed in data.js for the offline file) don't exist on the server
  STAFF_ACCOUNTS.length = 0;
  const S = (window.LF_REMOTE_STATE = { data: {}, session: {}, agg: {}, csrf: "", library: null, idleOut: false });
  const lang = () => (typeof I18N !== "undefined" ? I18N.lang : "en");
  const fil = () => lang() === "fil";

  class ServerError extends Error {}
  async function call(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method, credentials: "same-origin", cache: "no-store",
        headers: body ? { "Content-Type": "application/json", "X-CSRF": S.csrf } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ServerError(fil() ? "Hindi maabot ang server. Tingnan ang iyong internet at subukan ulit." : "We couldn't reach the server. Please check your internet and try again.");
    }
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      // The session ended (idle, or the server restarted): get a fresh one, then the visitor can try again
      if (res.status === 403 && data && data.code === "csrf") await refreshSession();
      throw new ServerError((data && data.error) || (fil() ? "May nangyaring mali. Subukan ulit." : "Something went wrong. Please try again."));
    }
    return data;
  }
  function applySession(s) {
    if (!s) return;
    const was = !!(S.session.user || S.session.staff);
    S.session = { user: s.user || null, staff: s.staff || null, pending: s.pending || null, unlocked: s.unlocked || [] };
    S.csrf = s.csrf || S.csrf;
    S.channels = s.channels || {};
    S.demoCodes = !!s.demoCodes;
    if (s.idleOut || (was && !s.user && !s.staff && !S.signingOut)) S.idleOut = true;
  }
  function applyData(sync) {
    S.data = sync.data || {};
    if (sync.agg !== undefined) S.agg = sync.agg || {};
    S.library = sync.library || S.library;
    LF._resetCaches();
  }
  function applyPatch(patch) {
    for (const [key, { upsert = [], remove = [] }] of Object.entries(patch || {})) {
      const drop = new Set([...remove, ...upsert.map((r) => r.id)]);
      S.data[key] = [...upsert, ...(S.data[key] || []).filter((r) => !drop.has(r.id))];
    }
    LF._resetCaches();
  }
  async function sync(library) {
    const lib = library || LF.selectedLibraryId() || "";
    applyData(await call("GET", `/api/v1/sync?library=${encodeURIComponent(lib)}&lang=${lang()}`));
  }
  async function refreshSession() {
    try { applySession(await call("GET", "/api/v1/session")); } catch {}
  }

  ACTIONS.forEach((name) => {
    LF[name] = async (...args) => {
      if (name === "signOut") S.signingOut = true;
      try {
        const r = await call("POST", "/api/v1/act", { name, args, library: LF.selectedLibraryId() || S.library || "", lang: lang() });
        applySession(r.session);
        if (r.sync) { applyData(r.sync); if (r.sync.library && r.sync.library !== LF.selectedLibraryId()) LF._setLibraryLocal(r.sync.library); }
        else { applyPatch(r.patch); if (r.agg) S.agg = r.agg; }
        return r.result;
      } finally { S.signingOut = false; }
    };
  });
  // Changing library loads that library's records
  const setLib = LF.setLibrary;
  LF._setLibraryLocal = setLib;
  LF.setLibrary = async (id) => { setLib(id); await sync(id); };
  LF.refresh = () => sync();
  // Clicking and typing count as activity, so a person who is reading isn't signed out (at most once a minute)
  let lastTouch = 0;
  LF.touchSession = () => {
    if ((!S.session.user && !S.session.staff) || Date.now() - lastTouch < 60_000) return;
    lastTouch = Date.now();
    fetch("/api/v1/session?active=1", { credentials: "same-origin", cache: "no-store" }).then((r) => r.json()).then(applySession).catch(() => {});
  };
  LF.online = true;
  LF.ready = (async () => {
    applySession(await call("GET", "/api/v1/session"));
    // A signed-in person always works in their own library
    const own = (S.session.user && S.session.user.library) || (S.session.staff && S.session.staff.library !== "all" && S.session.staff.library);
    if (own) setLib(own);
    if (LF.selectedLibraryId()) await sync();
  })();

  // Every minute while signed in: is the session still alive? (the server signs people out after idle time)
  setInterval(async () => {
    if (!S.session.user && !S.session.staff) return;
    const before = !!(S.session.user || S.session.staff);
    await refreshSession();
    if (before && !S.session.user && !S.session.staff) { S.idleOut = true; try { await sync(); } catch {} }
  }, 60_000);
})();
