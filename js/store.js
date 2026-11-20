/* ==========================================================================
   QCPL Lost & Found — Quezon City Public Library
   Core logic: storage, smart matching, claim workflow, notifications,
   accounts, activity log and statistics.

   The same rules run in three places:
   - in the browser on its own (the offline file / a demo): records are kept in this browser;
   - in the browser with the QCPL server ("remote"): records come from the server, which is the
     authority. This file only reads what the server sent; every change is sent to the server
     (see js/remote.js) and the server runs these same rules;
   - on the server itself (server/backend/engine.mjs), with the server's storage, sessions and
     password hashing plugged in.
   ========================================================================== */
const LF = (function () {
  "use strict";

  /* ---------------- Storage ---------------- */
  const K = {
    found: "qcpllf_found", lost: "qcpllf_lost", claims: "qcpllf_claims", users: "qcpllf_users",
    notifs: "qcpllf_notifs", activity: "qcpllf_activity", feedback: "qcpllf_feedback", clean: "qcpllf_clean_v1",
    session: "qcpllf_session", prefs: "qcpllf_prefs", contribs: "qcpllf_contribs",
    staff: "qcpllf_staffaccts", staffpw: "qcpllf_staffpw", resets: "qcpllf_resets", rate: "qcpllf_rate", fails: "qcpllf_signinfails",
    verifies: "qcpllf_verifies", pending: "qcpllf_pendingverify",
  };
  const STAFF_KEY = STAFF_SESSION_KEY;
  // Running in a browser that is connected to the QCPL server? (the server marks the page)
  const REMOTE = typeof document !== "undefined" && !!document.querySelector && !!document.querySelector('meta[name="qcpl-backend"]');
  const RS = () => window.LF_REMOTE_STATE || { data: {}, session: {}, agg: {} };
  // Keys the server owns: in remote mode they are read from what the server sent and never written here
  const SERVER_KEYS = new Set(["found", "lost", "claims", "users", "notifs", "activity", "feedback", "contribs", "staff", "staffpw", "resets", "rate", "fails", "verifies", "pending", "session"].map((k) => K[k]));
  // Which device or visitor is acting (the server sets this to the visitor's network address)
  const deviceKey = () => window.LF_DEVICE || "local";
  /* Passwords: on its own the browser uses SHA-256; the server plugs in slow, salted scrypt hashing. */
  const PW = window.LF_PASSWORDS || {
    hash: (salt, pw) => sha256(`${salt}:${pw}`),
    verify: async (stored, salt, pw) => !!stored && stored === (await sha256(`${salt}:${pw}`)),
  };

  /* Reads are decoded once per moment: a screen that asks for the same list many times
     only decodes it once. The copy is forgotten after any save and after the current task. */
  const readCache = new Map();
  let cacheTimer = 0;
  const BIG = new Set(["qcpllf_found", "qcpllf_lost", "qcpllf_claims", "qcpllf_users"]);
  function get(key, fallback) {
    if (window.LF_STORE) return window.LF_STORE.get(key, fallback);
    if (REMOTE && SERVER_KEYS.has(key)) { const v = RS().data[key]; return v === undefined ? fallback : v; }
    try {
      if (BIG.has(key) && readCache.has(key)) return readCache.get(key);
      const raw = localStorage.getItem(key);
      const val = raw ? JSON.parse(raw) : fallback;
      if (BIG.has(key) && raw) {
        readCache.set(key, val);
        if (!cacheTimer) cacheTimer = setTimeout(() => { readCache.clear(); cacheTimer = 0; }, 0);
      }
      return val;
    } catch { return fallback; }
  }
  function put(key, value) {
    readCache.delete(key); matchCache.clear();
    if (window.LF_STORE) return window.LF_STORE.put(key, value);
    if (REMOTE && SERVER_KEYS.has(key)) return true; // the server decides; nothing is stored in this browser
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }
  const matchCache = new Map(); // remembered match results, forgotten whenever anything is saved
  addEventListener("storage", () => { readCache.clear(); matchCache.clear(); }); // another tab changed the data
  const resetCaches = () => { readCache.clear(); matchCache.clear(); };

  /* Every record belongs to ONE library. db.all() only ever returns the records
     of the library portal in use, so each library is a separate system: its own
     reports, found items, claims, matches, users, updates and activity log. */
  const libraryId = () => activeLibrary().id;
  const db = {
    raw: (kind) => get(K[kind], []),                                  // all libraries (internal use)
    all: (kind) => { const id = libraryId(); return db.raw(kind).filter((x) => x.library === id); }, // library looked up once, not per record
    save(kind, list) {
      const id = libraryId();
      list.forEach((x) => { if (!x.library) x.library = id; });
      const all = db.raw(kind).filter((x) => x.library !== id).concat(list);
      if (put(K[kind], all)) return true;
      // The log and the update messages are extras: keep only the newest ones instead of failing
      if (kind === "activity" || kind === "notifs") return put(K[kind], all.slice(0, Math.floor(all.length / 2)));
      // Anything else must never look saved when it wasn't
      throw new Error("This device has no more room to save. Please remove some photos, or ask the Lost & Found desk for help.");
    },
    byId: (kind, id) => db.all(kind).find((x) => x.id === id) || null,
    upsert(kind, rec) {
      const list = db.all(kind);
      const i = list.findIndex((x) => x.id === rec.id);
      if (i > -1) list[i] = rec; else list.unshift(rec);
      db.save(kind, list);
      return rec;
    },
  };

  const now = () => new Date().toISOString();
  /* Unique record numbers: time + 8 random characters (two records made in the same millisecond never clash) */
  const uid = (prefix) => { const r = new Uint32Array(2); crypto.getRandomValues(r); return prefix + Date.now() + r[0].toString(36).padStart(7, "0").slice(-7) + (r[1] % 36).toString(36); };
  const digits = (s) => String(s || "").replace(/\D/g, "");
  const samePhone = (a, b) => { const x = digits(a), y = digits(b); return x.length >= 7 && x.slice(-10) === y.slice(-10); };

  function makeRef(prefix) {
    const d = new Date();
    const ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    const taken = new Set([...db.raw("found"), ...db.raw("lost"), ...db.raw("claims")].map((x) => x.id));
    let id; // the library code is part of every reference number, e.g. L-SB-261005-1234
    do { id = `${prefix}-${activeLibrary().code}-${ymd}-${Math.floor(1000 + Math.random() * 9000)}`; } while (taken.has(id));
    return id;
  }

  function addHistory(rec, status, actor, note) {
    rec.history = rec.history || [];
    rec.history.push({ status, at: now(), by: actor || "System", note: note || "" });
    rec.status = status;
    rec.updatedAt = now();
  }

  /* ---------------- Activity log ---------------- */
  function log(actor, action, ref, detail) {
    const list = db.all("activity");
    list.unshift({ id: uid("A"), at: now(), actor: actor || "System", action, ref: ref || "", detail: detail || "" });
    db.save("activity", list.slice(0, 1000));
  }

  /* ---------------- Notifications ----------------
     Every update is saved and shown on "My reports" and on the status page.
     When the site runs through server/server.mjs with email and/or SMS set up,
     the same update is also sent to the person's email address or mobile number.
     The wording lives in js/messages.js. */
  const viewerLang = () => (typeof I18N !== "undefined" ? I18N.lang : "en");
  function notify({ phone, userId, ref, type, vars }) {
    if (!phone && !userId) return;
    const { title, body } = MESSAGES[type](vars || {});
    // vars are kept so the update can be shown in either language
    const n = { id: uid("N"), at: now(), phone: digits(phone), userId: userId || null, ref, type, vars: vars || {}, title, body, read: false };
    const list = db.all("notifs");
    list.unshift(n);
    db.save("notifs", list);
    deliver(n, { phone, userId, ref, type, vars: vars || {} });
  }

  /* Who to send to: the email on the person's account or on the report itself,
     and how they asked to be contacted. */
  function contactFor({ userId, ref }) {
    const user = userId && db.raw("users").find((u) => u.id === userId);
    const hit = ref ? findRef(ref) : null;
    const rec = hit ? hit.item : {};
    return { email: rec.email || rec.finderEmail || (user ? user.email : "") || "", pref: rec.contactPref || "", lang: rec.lang || (user && user.lang) || "en" };
  }

  let channelsProbe = null; // { email: bool, sms: bool } — what the server can send
  function channels() {
    if (!/^https?:$/.test(location.protocol)) return Promise.resolve({ email: false, sms: false });
    if (!channelsProbe) channelsProbe = fetch("/api/health").then((r) => (r.ok ? r.json() : {})).then((j) => ({ email: !!j.email, sms: !!j.sms })).catch(() => ({ email: false, sms: false }));
    return channelsProbe;
  }

  async function deliver(n, { phone, userId, ref, type, vars }) {
    const can = await channels();
    if (!can.email && !can.sms) return;
    const { email, pref, lang } = contactFor({ userId, ref });
    let result;
    try {
      const res = await fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, vars, ref, library: n.library || activeLibrary().id, pref, lang, to: { email, phone } }) });
      result = res.ok ? await res.json() : { email: "failed", sms: "failed" };
    } catch { result = { email: "failed", sms: "failed" }; }
    // Remember how it was sent, so the person and the office can see it
    put(K.notifs, db.raw("notifs").map((x) => (x.id === n.id ? { ...x, delivery: { email: result.email || "skipped", sms: result.sms || "skipped" } } : x)));
  }
  function notificationsFor({ phone, userId, ref }) {
    return db.all("notifs").filter((n) =>
      (ref && n.ref === ref) || (userId && n.userId === userId) || (phone && n.phone && samePhone(n.phone, phone)));
  }
  function markRead(ids) {
    const set = new Set(ids);
    db.save("notifs", db.all("notifs").map((n) => (set.has(n.id) ? { ...n, read: true } : n)));
  }

  /* ==========================================================================
     SMART MATCHING
     Compares category, item name, brand, color, date, location and
     description. It suggests matches — staff still make the final decision.
     ========================================================================== */
  const STOP = new Set("the and with for from has have had was were are this that inside small big my our a an of on in at to is it its near".split(" "));
  /* Words that mean the same thing count as the same word (see SYNONYMS in data.js) */
  const CANON = new Map();
  SYNONYMS.forEach((group) => group.forEach((w) => CANON.set(w, group[0])));
  // Results are remembered, because matching compares the same texts many thousands of times
  const memo = (fn) => { const m = new Map(); return (k) => { let v = m.get(k); if (v === undefined) { if (m.size > 50000) m.clear(); v = fn(k); m.set(k, v); } return v; }; };
  const words = (s) => wordsOf(String(s || ""));
  const wordsOf = memo((s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => (w.length > 2 || CANON.has(w)) && !STOP.has(w)).map((w) => CANON.get(w) || w));
  /* For search boxes: every word that means the same as this one */
  const synonymsOf = (w) => { const k = String(w || "").toLowerCase(), c = CANON.get(k); return c ? SYNONYMS.find((g) => g[0] === c) : [k]; };
  const dayNum = memo((d) => new Date(d + "T00:00:00").getTime() / 86400000);
  const dayDiff = (a, b) => Math.round(dayNum(String(a)) - dayNum(String(b)));

  /* How alike are a lost report and a found report? Returns a percentage.

     Each kind of information is compared on its own and given a similarity
     from 0 (different) to 1 (the same). Only information that BOTH reports
     contain is counted, so a short report is not punished for what it left
     out. The percentage is the weighted average:

       Item name / model ........ 35   shared words, e.g. "samsung galaxy a15"
       Brand .................... 15
       Description & marks ...... 15   shared words in the descriptions
       Place .................... 15   same library, same area, same floor
       Date ..................... 15   how soon after the loss it was found
       Color .................... 10
       Type of item ............. 10   always the same (a different type is never a match)

     The public percentage never uses a found item's private details, so
     nobody can guess them by watching the number change. Staff see the
     percentage with private details included.

     A match is only a suggestion. Ownership is always checked by the office. */
  const SIMILAR_COLORS = [["Gray", "Silver"], ["Brown", "Beige"], ["Yellow", "Gold"], ["Red", "Pink"], ["Red", "Orange"], ["Blue", "Purple"], ["Black", "Gray"], ["White", "Silver"], ["White", "Beige"]];
  const overlapOf = (a, b) => { const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return null; let n = 0; A.forEach((w) => { if (B.has(w)) n++; }); return n / Math.min(A.size, B.size); };
  /* Words of an item's name without color words ("black phone" and "black earphones" are not alike; color is compared on its own) */
  const COLOR_WORDS = new Set([...COLORS.map((c) => c.toLowerCase()), "grey", "colored", "multi", "color", "colour"]);
  const nameWords = (s) => nameWordsOf(String(s || ""));
  const nameWordsOf = memo((s) => { const all = words(s), kept = all.filter((w) => !COLOR_WORDS.has(w)); return kept.length ? kept : all; });
  const matchLabel = (s) => (s >= 90 ? "High potential match" : s >= 75 ? "Strong possible match" : s >= MATCH_MIN ? "Possible match — needs checking" : "Low similarity");

  function score(lost, found, { includePrivate = false } = {}) {
    if (!lost || !found || lost.category !== found.category) return null;
    const gap = dayDiff(found.date, lost.dateLost);          // days between loss and find
    if (gap < -1 || gap > 60) return null;                   // found before it was lost → not a match

    const parts = [];   // { key, label, weight, sim, lost, found }
    const reasons = ["Same type of item"];
    const add = (key, label, weight, sim, l, f) => parts.push({ key, label, weight, sim, lost: l || "", found: f || "" });
    add("category", "Type of item", 10, 1, lost.category, found.category);

    // Item name and model
    const nameSim = overlapOf(nameWords(lost.itemName), nameWords(found.title));
    if (nameSim !== null) { add("name", "Item", 35, nameSim, lost.itemName, found.title); if (nameSim >= 0.99) reasons.push("Same item name"); else if (nameSim > 0) reasons.push("Similar item name"); }

    // Brand: on both reports, or named in the other report's text
    const lb = (lost.brand || "").trim().toLowerCase(), fb = (found.brand || "").trim().toLowerCase();
    const txt = (...xs) => xs.filter(Boolean).join(" "); // empty answers must not count as shared words
    const lostText = words(txt(lost.itemName, lost.description, lost.uniqueDetails));
    const foundText = words(txt(found.title, found.description, includePrivate && found.privateDetails));
    let brandSim = null;
    if (lb && fb) brandSim = lb.includes(fb) || fb.includes(lb) ? 1 : 0;
    else if (lb && words(lb).some((w) => foundText.includes(w))) brandSim = 1;
    else if (fb && words(fb).some((w) => lostText.includes(w))) brandSim = 1;
    if (brandSim !== null) { add("brand", "Brand", 15, brandSim, lost.brand, found.brand); if (brandSim) reasons.push(`Same brand (${found.brand || lost.brand})`); }

    // Color
    if (lost.color && found.color && lost.color !== "Other" && found.color !== "Other") {
      const colorSim = lost.color === found.color ? 1 : SIMILAR_COLORS.some(([a, b]) => (a === lost.color && b === found.color) || (b === lost.color && a === found.color)) ? 0.5 : 0;
      add("color", "Color", 10, colorSim, lost.color, found.color);
      if (colorSim === 1) reasons.push(`Same color (${found.color.toLowerCase()})`); else if (colorSim) reasons.push("Similar color");
    }

    // Description, distinguishing features and markings
    const detailSim = overlapOf(words(txt(lost.description, lost.uniqueDetails)), words(txt(found.description, includePrivate && found.privateDetails)));
    if (detailSim !== null) { add("details", "Description and marks", 15, detailSim, [lost.description, lost.uniqueDetails].filter(Boolean).join(" · "), found.description); if (detailSim >= 0.5) reasons.push("Similar description"); }

    // Place: library (branch), area and floor
    const sure = (v) => v && v !== "I'm not sure";
    let placeSim = null;
    if (lost.branch && found.branch && lost.branch !== found.branch) placeSim = 0;
    else if (sure(lost.location) && sure(found.location)) {
      placeSim = lost.location === found.location ? (sure(lost.floor) && sure(found.floor) && lost.floor !== found.floor ? 0.85 : 1) : 0.5;
      if (lost.location === found.location) reasons.push("Same area of the library");
    } else if (lost.branch && found.branch) placeSim = 0.7;
    if (placeSim !== null) {
      if (placeSim > 0 && lost.branch && found.branch) reasons.push("Same library");
      add("place", "Place", 15, placeSim, [lost.branch, lost.location].filter(Boolean).join(" · "), [found.branch, found.location].filter(Boolean).join(" · "));
    }

    // Date
    const dateSim = gap <= 1 ? 1 : gap <= 3 ? 0.85 : gap <= 7 ? 0.7 : gap <= 14 ? 0.5 : gap <= 30 ? 0.3 : 0.1;
    add("date", "Date", 15, dateSim, lost.dateLost, found.date);
    if (gap <= 2) reasons.push("Found on or near the same day");

    const total = parts.reduce((a, p) => a + p.weight, 0);
    let s = Math.round((parts.reduce((a, p) => a + p.weight * p.sim, 0) / total) * 100);
    // Same place and day is not enough: the items themselves must look alike
    const itemEvidence = Math.max(nameSim || 0, detailSim || 0, brandSim || 0);
    if (!itemEvidence) s = Math.min(s, 45);
    // With little to compare (say, only the name), the result cannot be "high": 3 of name, brand, color and description are needed
    const compared = parts.filter((p) => ["name", "brand", "color", "details"].includes(p.key)).length;
    if (compared < 3) s = Math.min(s, compared < 2 ? 80 : 89);
    if (placeSim === 0) s = Math.min(s, 74);                 // lost in one library, found in another: needs checking
    s = Math.max(0, Math.min(98, s));                        // never 100%: only the office can confirm ownership
    return { score: s, strength: matchLabel(s), reasons, parts };
  }

  const MATCH_MIN = 50;
  /* Compared with every found report that is still open, including items the finder has not brought to the office yet */
  const MATCHABLE_FOUND = ["found", ...PUBLIC_FOUND];
  const ACTIVE_LOST = ["reported", "searching", "possible-match"];

  function matchList(lost, foundList, opts) {
    const dismissed = new Set(lost.dismissed || []);
    return foundList
      .filter((f) => MATCHABLE_FOUND.includes(f.status) && !dismissed.has(f.id))
      .map((f) => ({ item: f, ...score(lost, f, opts) }))
      .filter((m) => m.score >= MATCH_MIN)
      .sort((a, b) => b.score - a.score);
  }
  function matchListFound(found, lostList, opts) {
    return lostList
      .filter((l) => ACTIVE_LOST.includes(l.status) && !(l.dismissed || []).includes(found.id))
      .map((l) => ({ item: l, ...score(l, found, opts) }))
      .filter((m) => m.score >= MATCH_MIN)
      .sort((a, b) => b.score - a.score);
  }
  const cached = (key, fn) => { if (/\|undefined\||\|\|/.test(key)) return fn(); if (matchCache.has(key)) return matchCache.get(key); const v = fn(); if (matchCache.size > 20000) matchCache.clear(); matchCache.set(key, v); return v; };
  const optKey = (opts) => (opts && opts.includePrivate ? "p" : "");
  const matchesForLost = (lost, opts) => cached(`L|${libraryId()}|${lost.id}|${(lost.dismissed || []).length}|${optKey(opts)}`, () => matchList(lost, db.all("found"), opts));
  const matchesForFound = (found, opts) => cached(`F|${libraryId()}|${found.id}|${optKey(opts)}`, () => matchListFound(found, db.all("lost"), opts));

  /* Re-check open cases after something changes.
     A new lost report or found item is only compared with the other side (fast, even
     with thousands of records); other changes re-check everything, reading the data once. */
  function refreshMatches(actor, only = {}) {
    const lostList = db.all("lost"), foundList = db.all("found");
    const by = actor || "Smart matching";
    let changed = false, fChanged = false;
    const updateLost = (l, ms, fresh) => {
      if (ms.length && l.status === "searching") { addHistory(l, "possible-match", by); changed = true; }
      else if (!ms.length && l.status === "possible-match" && !only.found) { addHistory(l, "searching", by); changed = true; }
      if (fresh.length) {
        l.notified = [...(l.notified || []), ...fresh.map((m) => m.item.id)];
        notify({ phone: l.phone, userId: l.userId, ref: l.id, type: "match_found", vars: { item: l.itemName, found: fresh[0].item.title } });
        changed = true;
      }
    };
    const markFound = (f, has) => {
      if (has && f.status === "recorded") { addHistory(f, "possible-owner", "Smart matching"); fChanged = true; }
      if (!has && f.status === "possible-owner") { addHistory(f, "recorded", "Smart matching"); fChanged = true; }
    };
    if (only.found) {
      // New found item: which open lost reports does it match?
      const f = foundList.find((x) => x.id === only.found);
      if (!f) return;
      const ms = matchListFound(f, lostList);
      ms.forEach((m) => { const l = m.item; if (["searching", "possible-match"].includes(l.status)) updateLost(l, [m], (l.notified || []).includes(f.id) ? [] : [{ item: f }]); });
      if (["recorded", "possible-owner"].includes(f.status)) markFound(f, ms.length > 0);
    } else if (only.lost) {
      // New lost report: which found items does it match?
      const l = lostList.find((x) => x.id === only.lost);
      if (!l) return;
      const ms = ["searching", "possible-match"].includes(l.status) ? matchList(l, foundList) : [];
      if (["searching", "possible-match"].includes(l.status)) updateLost(l, ms, ms.filter((m) => !(l.notified || []).includes(m.item.id)));
      ms.forEach((m) => { const f = foundList.find((x) => x.id === m.item.id); if (f && f.status === "recorded") markFound(f, true); });
    } else {
      const cats = only.categories && only.categories.filter(Boolean).length ? new Set(only.categories) : null;
      const inCat = (x) => !cats || cats.has(x.category);
      const lostIn = lostList.filter(inCat), foundIn = foundList.filter(inCat);
      lostIn.forEach((l) => {
        if (!["searching", "possible-match"].includes(l.status)) return;
        const ms = matchList(l, foundIn);
        updateLost(l, ms, ms.filter((m) => !(l.notified || []).includes(m.item.id)));
      });
      foundIn.forEach((f) => { if (["recorded", "possible-owner"].includes(f.status)) markFound(f, matchListFound(f, lostIn).length > 0); });
    }
    if (changed) db.save("lost", lostList);
    if (fChanged) db.save("found", foundList);
  }

  /* ==========================================================================
     WORKFLOW
     ========================================================================== */
  /* Records (and their photos) live in this browser until the site has a server, so space can run out */
  const STORAGE_FULL = "This device has no more room to save the report. Please remove some photos and try again.";

  /* Input limits: every text is trimmed and cut to a safe length, and only real
     photos (data:image/…) up to MAX_PHOTOS are kept. Stops huge or harmful input. */
  const MAX_PHOTOS = 8;
  const LIMITS = { name: 80, finderName: 80, phone: 20, finderPhone: 20, email: 120, memberId: 40, itemName: 100, title: 100, brand: 60,
    color: 30, category: 20, branch: 80, location: 80, locationDetail: 200, role: 40, finderRole: 40, contactPref: 40, handover: 60, lostRef: 30, itemId: 30 };
  const isPhoto = (p) => typeof p === "string" && ((/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p) && p.length < 1_500_000) || /^\/api\/v1\/photo\/[a-f0-9]{32}$/.test(p));
  function clip(data) {
    const out = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (k === "photos") { out.photos = (Array.isArray(v) ? v : []).filter(isPhoto).slice(0, MAX_PHOTOS); continue; }
      if (k === "photo") { if (isPhoto(v)) out.photo = v; continue; }
      out[k] = typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, LIMITS[k] || 1000) : v;
    }
    if (out.photos && out.photos.length && !out.photo) out.photo = out.photos[0];
    return out;
  }
  /* Simple anti-spam limit per device (a server limit is still needed before launch) */
  function rateGuard(kind, max, windowMs) {
    if (currentStaff()) return;
    const all = get(K.rate, {}), t = Date.now(), recent = (all[kind] || []).filter((x) => t - x < windowMs);
    if (recent.length >= max) throw new Error("Too many in a short time from this device. Please wait a while and try again, or visit the Lost & Found desk.");
    recent.push(t); all[kind] = recent; put(K.rate, all);
  }

  function createLost(data) {
    data = clip(data);
    rateGuard("report", 10, 3600_000);
    const user = currentUser();
    // No rewards: the library is a government office and takes no part in payments between people
    delete data.bounty; delete data.bountyOk; delete data.bountyStatus; delete data.publicPost;
    const rec = { id: makeRef("L"), createdAt: now(), userId: user ? user.id : null, notified: [], dismissed: [], lang: viewerLang(), ...data };
    addHistory(rec, "reported", data.name);
    addHistory(rec, "searching", "System");
    db.upsert("lost", rec);
    if (!db.byId("lost", rec.id)) throw new Error(STORAGE_FULL);
    log(data.name, "Lost item reported", rec.id, rec.itemName);
    notify({ phone: rec.phone, userId: rec.userId, ref: rec.id, type: "lost_received", vars: { item: rec.itemName } });
    refreshMatches(null, { lost: rec.id });
    return db.byId("lost", rec.id);
  }

  function createFound(data) {
    data = clip(data);
    rateGuard("report", 10, 3600_000);
    const user = currentUser();
    const staff = currentStaff();
    const rec = { id: makeRef("F"), createdAt: now(), userId: user ? user.id : null, lang: staff ? "en" : viewerLang(), ...data };
    addHistory(rec, "found", staff ? staff.name : data.finderName);
    if (staff) addHistory(rec, "recorded", staff.name, "Logged at the office");
    db.upsert("found", rec);
    if (!db.byId("found", rec.id)) throw new Error(STORAGE_FULL);
    log(staff ? staff.name : data.finderName, staff ? "Found item logged at the office" : "Found item reported", rec.id, rec.title);
    if (!staff) notify({ phone: rec.finderPhone, userId: rec.userId, ref: rec.id, type: "found_received", vars: { item: rec.title } });
    refreshMatches(null, { found: rec.id });
    return db.byId("found", rec.id);
  }

  function linkedLostFor(found, phone, lostRef) {
    const lost = db.all("lost");
    if (lostRef) {
      const l = lost.find((x) => x.id === lostRef.trim().toUpperCase());
      if (l && samePhone(l.phone, phone)) return l;
    }
    return lost.find((l) => samePhone(l.phone, phone) && l.category === found.category && ACTIVE_LOST.includes(l.status)) || null;
  }

  function createClaim(data) {
    data = clip(data);
    const found = db.byId("found", data.itemId);
    if (!found) throw new Error("Item not found");
    // One open claim per person per item
    const dup = db.all("claims").find((c) => c.itemId === found.id && samePhone(c.phone, data.phone) && !["rejected", "returned"].includes(c.status));
    if (dup) throw new Error(`You already sent a claim for this item. Its reference number is ${dup.id}. You can check it on the Check Status page.`);
    rateGuard("claim", 5, 3600_000);
    const user = currentUser();
    const lost = linkedLostFor(found, data.phone, data.lostRef || found.forLost);
    const rec = { id: makeRef("C"), createdAt: now(), userId: user ? user.id : null, itemTitle: found.title, lostId: lost ? lost.id : null, lang: viewerLang(), ...data };
    addHistory(rec, "submitted", data.name);
    db.upsert("claims", rec);

    if (["recorded", "possible-owner"].includes(found.status)) { addHistory(found, "claimed", data.name); db.upsert("found", found); }
    if (lost) { addHistory(lost, "claim-submitted", data.name); db.upsert("lost", lost); }

    log(data.name, "Claim submitted", rec.id, `${found.title} (${found.id})`);
    notify({ phone: rec.phone, userId: rec.userId, ref: rec.id, type: "claim_received", vars: { item: found.title } });
    if (found.finderPhone) notify({ phone: found.finderPhone, userId: found.userId, ref: found.id, type: "finder_claimed", vars: { item: found.title } });
    return rec;
  }

  function setClaimStatus(id, status, note) {
    requireAdmin();
    const staff = currentStaff();
    const actor = staff ? staff.name : "Staff";
    const claim = db.byId("claims", id);
    if (!claim) return;
    const found = db.byId("found", claim.itemId);
    const lost = claim.lostId ? db.byId("lost", claim.lostId) : null;
    addHistory(claim, status, actor, note);
    if (note) claim.reviewNote = note;
    db.upsert("claims", claim);

    if (status === "under-verification") {
      if (lost) { addHistory(lost, "under-verification", actor); db.upsert("lost", lost); }
      notify({ phone: claim.phone, userId: claim.userId, ref: claim.id, type: "claim_checking", vars: { item: claim.itemTitle } });
    }
    if (status === "approved") {
      if (found) { addHistory(found, "verified", actor); db.upsert("found", found); }
      if (lost) { addHistory(lost, "ready", actor); db.upsert("lost", lost); }
      // Any other open claims on the same item are declined
      db.all("claims").filter((c) => c.itemId === claim.itemId && c.id !== claim.id && ["submitted", "under-verification"].includes(c.status))
        .forEach((c) => setClaimStatus(c.id, "rejected", "Another claim for this item was approved."));
      notify({ phone: claim.phone, userId: claim.userId, ref: claim.id, type: "claim_approved", vars: { item: claim.itemTitle, desk: LIBRARY.deskLocation } });
    }
    if (status === "rejected") {
      if (found && found.status === "claimed") {
        const stillOpen = db.all("claims").some((c) => c.itemId === found.id && ["submitted", "under-verification"].includes(c.status));
        if (!stillOpen) { addHistory(found, "recorded", actor); db.upsert("found", found); }
      }
      if (lost && ["claim-submitted", "under-verification"].includes(lost.status)) { addHistory(lost, "searching", actor); db.upsert("lost", lost); }
      notify({ phone: claim.phone, userId: claim.userId, ref: claim.id, type: "claim_rejected", vars: { item: claim.itemTitle, note: note || "" } });
    }
    log(actor, `Claim ${STATUS.claims[status].label.toLowerCase()}`, claim.id, note || claim.itemTitle);
    refreshMatches(actor, { categories: [found && found.category, lost && lost.category] });
  }

  function recordReturn(claimId, release) {
    requireAdmin();
    const staff = currentStaff();
    const actor = staff ? staff.name : "Staff";
    const claim = db.byId("claims", claimId);
    const found = db.byId("found", claim.itemId);
    const lost = claim.lostId ? db.byId("lost", claim.lostId) : null;
    const { thankNote, ...relFields } = release;
    const rel = { ...relFields, at: now(), by: actor, claimId };
    addHistory(claim, "returned", actor); db.upsert("claims", claim);
    if (found) { found.release = rel; if (thankNote) found.thankNote = thankNote; addHistory(found, "returned", actor); db.upsert("found", found); }
    if (lost) { addHistory(lost, "returned", actor); db.upsert("lost", lost); }
    log(actor, "Item returned to owner", found ? found.id : claimId, `Released to ${release.releasedTo} (${release.idType})`);
    notify({ phone: claim.phone, userId: claim.userId, ref: claim.id, type: "item_returned", vars: { item: claim.itemTitle } });
    if (found && found.finderPhone) {
      const h = honestyFor({ userId: found.userId, phone: found.finderPhone });
      notify({ phone: found.finderPhone, userId: found.userId, ref: found.id, type: "finder_returned",
        vars: { item: found.title, ref: found.id, badge: h.badge ? h.badge.name : "", count: h.count, note: thankNote || "" } });
    }
  }

  /* ==========================================================================
     MONTHLY CERTIFICATE OF CONTRIBUTION
     A person qualifies in a month with at least CONTRIB_MIN lost reports of
     their own (not closed by the office), or at least CONTRIB_MIN found items
     that were returned to their owners that month. The administrator reviews
     the list and issues the certificate; nothing is issued automatically.
     ========================================================================== */
  const inMonth = (iso, month) => String(iso || "").slice(0, 7) === month;
  const monthName = (month) => new Date(month + "-01T00:00:00").toLocaleDateString(uiLocale(), { month: "long", year: "numeric" });

  function contributionCandidates(month) {
    const people = {};
    const person = (phone, name, userId) => {
      const k = digits(phone).slice(-10);
      if (k.length < 7) return null;
      const p = (people[k] = people[k] || { key: k, name, phone, userId: null, lost: [], found: [] });
      if (userId && !p.userId) p.userId = userId;
      return p;
    };
    db.all("lost").forEach((l) => {
      if (!inMonth(l.createdAt, month) || l.status === "closed") return;
      const p = person(l.phone, l.name, l.userId);
      if (p) p.lost.push(l);
    });
    db.all("found").forEach((f) => {
      if (!isRecognizable(f) || !f.release || !inMonth(f.release.at, month)) return;
      const p = person(f.finderPhone, f.finderName, f.userId);
      if (p) p.found.push(f);
    });
    const issued = db.all("contribs").filter((c) => c.month === month);
    return Object.values(people)
      .map((p) => ({ ...p, qualifies: p.lost.length >= CONTRIB_MIN || p.found.length >= CONTRIB_MIN, cert: issued.find((c) => c.key === p.key) || null }))
      .sort((a, b) => Number(b.qualifies) - Number(a.qualifies) || (b.lost.length + b.found.length) - (a.lost.length + a.found.length));
  }

  function issueContribution(month, key) {
    requireSupervisor();
    const staff = currentStaff();
    const p = contributionCandidates(month).find((x) => x.key === key);
    if (!p || !p.qualifies) throw new Error("This person does not have enough contributions for that month.");
    if (p.cert) return p.cert;
    const taken = new Set(db.raw("contribs").map((c) => c.id));
    let id;
    do { id = `CC-${activeLibrary().code}-${month.slice(2).replace("-", "")}-${Math.floor(1000 + Math.random() * 9000)}`; } while (taken.has(id));
    const rec = { id, month, key, name: p.name, phone: p.phone, userId: p.userId, lostIds: p.lost.map((l) => l.id), foundIds: p.found.map((f) => f.id), issuedAt: now(), issuedBy: staff.name };
    db.upsert("contribs", rec);
    log(staff.name, "Certificate of Contribution issued", id, `${p.name} — ${monthName(month)} (${p.lost.length} lost reports, ${p.found.length} items returned)`);
    // Sent under one of the person's own reports, so it shows there and can be emailed or texted
    notify({ phone: p.phone, userId: p.userId, ref: (p.found[0] || p.lost[0]).id, type: "contribution_certificate", vars: { month: monthName(month) } });
    return rec;
  }
  const contributionsFor = ({ userId, phone }) => db.all("contribs").filter((c) => (userId && c.userId === userId) || (phone && samePhone(c.phone, phone)));
  const contributionsForRef = (ref) => db.all("contribs").filter((c) => c.lostIds.includes(ref) || c.foundIds.includes(ref));
  /* Opens for staff, the person (signed in), or after they checked one of the reports it is based on */
  function canViewContribution(c) {
    if (!c) return false;
    if (currentStaff()) return true;
    const u = currentUser();
    if (u && (c.userId === u.id || samePhone(c.phone, confirmedPhone(u)))) return true;
    const open = openRefs(); return [...c.lostIds, ...c.foundIds].some((id) => open.includes(id));
  }

  /* ==========================================================================
     FINDER RECOGNITION — certificates, badges, Wall of Honesty
     Only finders who gave a phone number can be recognized (not security staff on duty).
     ========================================================================== */
  const isRecognizable = (f) => f.status === "returned" && !!digits(f.finderPhone);

  function honestyFor({ userId, phone }) {
    const items = db.all("found").filter((f) => isRecognizable(f) && ((userId && f.userId === userId) || (phone && samePhone(f.finderPhone, phone))));
    const count = items.length;
    const badge = [...BADGES].reverse().find((b) => count >= b.min) || null;
    const next = BADGES.find((b) => count < b.min) || null;
    return { count, items, badge, next };
  }

  const publicName = (name) => {
    const parts = String(name || "").trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || "A kind QCitizen";
  };

  /* One card per finder (their most recent return), newest first */
  function wallOfHonesty(limit = 6) {
    if (REMOTE && !currentStaff() && RS().agg && RS().agg.wall) return RS().agg.wall.slice(0, limit);
    const seen = new Set();
    return db.all("found")
      .filter((f) => isRecognizable(f) && f.publicThanks && f.release)
      .sort((a, b) => b.release.at.localeCompare(a.release.at))
      .filter((f) => { const k = digits(f.finderPhone).slice(-10); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, limit)
      .map((f) => ({ name: publicName(f.finderName), item: f.title, category: f.category, location: f.location, at: f.release.at,
        count: honestyFor({ userId: f.userId, phone: f.finderPhone }).count }));
  }

  function topFinders(limit = 5) {
    const groups = {};
    db.all("found").filter(isRecognizable).forEach((f) => {
      const k = digits(f.finderPhone).slice(-10);
      const g = (groups[k] = groups[k] || { name: f.finderName, phone: f.finderPhone, count: 0, last: "" });
      g.count++;
      if (f.release && f.release.at > g.last) g.last = f.release.at;
    });
    return Object.values(groups).sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).slice(0, limit)
      .map((g) => ({ ...g, badge: [...BADGES].reverse().find((b) => g.count >= b.min) }));
  }

  function setThankNote(foundId, note) {
    requireAdmin();
    const staff = currentStaff();
    const f = db.byId("found", foundId);
    f.thankNote = note;
    db.upsert("found", f);
    log(staff ? staff.name : "Staff", "Thank-you note sent to finder", foundId, note);
    notify({ phone: f.finderPhone, userId: f.userId, ref: f.id, type: "thank_note", vars: { note } });
  }

  /* Certificates show the finder's name, so they open only for the finder
     (signed in, or after checking the report with their phone digits) or staff. */
  const CERT_KEY = "qcpllf_certs";
  function openRefs() {
    if (REMOTE) return RS().session.unlocked || [];
    try { return JSON.parse(sessionStorage.getItem(CERT_KEY) || "[]"); } catch { return []; }
  }
  function unlockCertificate(id) {
    if (REMOTE) return; // the server unlocks reports (after Check Status)
    try { const s = new Set(JSON.parse(sessionStorage.getItem(CERT_KEY) || "[]")); s.add(id); sessionStorage.setItem(CERT_KEY, JSON.stringify([...s])); } catch {}
  }
  function canViewCertificate(f) {
    if (!f || !isRecognizable(f)) return false;
    if (currentStaff()) return true;
    const u = currentUser();
    if (u && (f.userId === u.id || samePhone(f.finderPhone, confirmedPhone(u)))) return true;
    return openRefs().includes(f.id);
  }

  function setStatus(kind, id, status, note) {
    requireAdmin();
    const staff = currentStaff();
    const actor = staff ? staff.name : "Staff";
    if (status === "disposed") requireSupervisor();
    // "Returned" is only set through the release form (which records the ID shown), unless a supervisor fixes a record
    if (kind === "found" && status === "returned" && !isSupervisor()) throw new Error("Use the release form on the approved claim to mark an item as returned.");
    if (!STATUS[kind] || !STATUS[kind][status]) throw new Error("Unknown status.");
    const rec = db.byId(kind, id);
    if (!rec || rec.status === status) return;
    addHistory(rec, status, actor, note);
    db.upsert(kind, rec);
    log(actor, `Status changed to "${STATUS[kind][status].label}"`, id, note || "");
    if (kind === "lost" && status === "closed") notify({ phone: rec.phone, userId: rec.userId, ref: rec.id, type: "report_closed", vars: { item: rec.itemName, note: note || "" } });
    refreshMatches(actor, { categories: [rec.category] });
  }

  function dismissMatch(lostId, foundId) {
    requireAdmin();
    const staff = currentStaff();
    const l = db.byId("lost", lostId);
    l.dismissed = [...new Set([...(l.dismissed || []), foundId])];
    db.upsert("lost", l);
    log(staff ? staff.name : "Staff", "Match dismissed", lostId, `Not a match with ${foundId}`);
    refreshMatches(null, { categories: [l.category] });
  }

  function contactOwner(lostId, foundId) {
    requireAdmin();
    const staff = currentStaff();
    const l = db.byId("lost", lostId), f = db.byId("found", foundId);
    notify({ phone: l.phone, userId: l.userId, ref: l.id, type: "visit_office", vars: { item: f.title, ref: f.id } });
    log(staff ? staff.name : "Staff", "Owner contacted about a match", lostId, `${f.title} (${f.id})`);
  }

  /* ==========================================================================
     OWNER SELF-SERVICE — add details to a lost report, or close it
     Allowed for the signed-in owner, or after checking the report with its
     reference number and phone digits on the Check Status page.
     ========================================================================== */
  const OPEN_LOST = ["reported", "searching", "possible-match"];
  const checkedRefs = openRefs;
  /* A mobile number links an account to reports made without signing in, but only once it is confirmed */
  const confirmedPhone = (u) => (u && u.contactVerified !== false ? u.phone : "");
  function canManage(rec, phoneField = "phone") {
    if (!rec) return false;
    if (currentStaff()) return true;
    const u = currentUser();
    if (u && (rec.userId === u.id || samePhone(rec[phoneField], confirmedPhone(u)))) return true;
    return checkedRefs().includes(rec.id);
  }
  const OWNER_FIELDS = ["brand", "color", "description", "uniqueDetails", "locationDetail", "floor", "timeOfDay"];
  function updateLostByOwner(id, changes, addPhotos = []) {
    const l = db.byId("lost", id);
    if (!canManage(l)) throw new Error("Please check this report with its reference number and phone digits first.");
    if (!OPEN_LOST.includes(l.status)) throw new Error("This report can no longer be changed. Please call the office.");
    const changed = [];
    OWNER_FIELDS.forEach((k) => { if (k in changes && String(changes[k] || "") !== String(l[k] || "")) { l[k] = String(changes[k] || "").slice(0, 600); changed.push(k); } });
    addPhotos = (addPhotos || []).filter(isPhoto);
    if (addPhotos.length) { l.photos = [...(l.photos && l.photos.length ? l.photos : l.photo ? [l.photo] : []), ...addPhotos].slice(0, MAX_PHOTOS); l.photo = l.photos[0]; changed.push(`${addPhotos.length} photo(s)`); }
    if (!changed.length) return l;
    l.updatedAt = now();
    l.history = [...(l.history || []), { status: l.status, at: now(), by: l.name, note: "Details added by the owner" }];
    db.upsert("lost", l);
    if (!db.byId("lost", l.id) || JSON.stringify(db.byId("lost", l.id).photos || []).length < JSON.stringify(l.photos || []).length) throw new Error(STORAGE_FULL);
    log(l.name, "Lost report updated by the owner", l.id, changed.join(", "));
    refreshMatches(null, { categories: [l.category] });
    return db.byId("lost", id);
  }
  function closeLostByOwner(id, reason) {
    const l = db.byId("lost", id);
    if (!canManage(l)) throw new Error("Please check this report with its reference number and phone digits first.");
    if (!OPEN_LOST.includes(l.status)) throw new Error("This report can no longer be closed online. Please call the office.");
    addHistory(l, "closed", l.name, `Closed by the owner: ${reason}`);
    db.upsert("lost", l);
    log(l.name, "Lost report closed by the owner", l.id, reason);
    notify({ phone: l.phone, userId: l.userId, ref: l.id, type: "report_closed", vars: { item: l.itemName, note: `You closed it: ${reason}.` } });
    refreshMatches(null, { categories: [l.category] });
  }

  /* ==========================================================================
     PICK-UP APPOINTMENTS — after a claim is approved
     Hourly slots during the portal's main-library hours, for the next few
     days, with a limit per hour (PICKUP_SLOT_CAP).
     ========================================================================== */
  const keptAt = (f) => (f && (f.keptAt || f.branch)) || LIBRARY.branches[0];
  function pickupSlots(claimId) {
    const hours = OPEN_HOURS[activeLibrary().id];
    const taken = {};
    db.all("claims").forEach((c) => { if (c.pickup && c.status === "approved" && c.id !== claimId) { const k = `${c.pickup.date} ${c.pickup.time}`; taken[k] = (taken[k] || 0) + 1; } });
    const days = [], start = new Date();
    for (let i = 0; i <= PICKUP_DAYS_AHEAD && days.length < 6; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const span = !hours ? null : d.getDay() === 0 ? null : d.getDay() === 6 ? hours.sat : hours.wk;
      if (!span) continue;
      const date = toISODate(d), slots = [];
      for (let h = span[0]; h < span[1]; h++) {
        if (i === 0 && h <= new Date().getHours()) continue;              // at least an hour from now
        const time = `${String(h).padStart(2, "0")}:00`;
        slots.push({ time, left: PICKUP_SLOT_CAP - (taken[`${date} ${time}`] || 0) });
      }
      if (slots.length) days.push({ date, slots });
    }
    return days;
  }
  const pickupLabel = (p) => `${new Date(p.date + "T00:00:00").toLocaleDateString(uiLocale(), { weekday: "long", month: "long", day: "numeric" })}, ${new Date(`${p.date}T${p.time}:00`).toLocaleTimeString(uiLocale(), { hour: "numeric", minute: "2-digit" })}`;
  function bookPickup(claimId, date, time) {
    const c = db.byId("claims", claimId);
    if (!canManage(c)) throw new Error("Please check your claim with its reference number and phone digits first.");
    if (c.status !== "approved") throw new Error("A pick-up time can be booked only after the claim is approved.");
    const day = pickupSlots(claimId).find((d) => d.date === date);
    const slot = day && day.slots.find((s) => s.time === time);
    if (!slot || slot.left <= 0) throw new Error("That time is no longer available. Please choose another.");
    const f = db.byId("found", c.itemId);
    c.pickup = { date, time, at: now(), place: keptAt(f) };
    c.history = [...(c.history || []), { status: c.status, at: now(), by: c.name, note: `Pick-up booked: ${pickupLabel(c.pickup)}` }];
    db.upsert("claims", c);
    log(currentStaff() ? currentStaff().name : c.name, "Pick-up time booked", c.id, pickupLabel(c.pickup));
    notify({ phone: c.phone, userId: c.userId, ref: c.id, type: "pickup_booked", vars: { item: c.itemTitle, when: pickupLabel(c.pickup), place: c.pickup.place } });
    return c;
  }
  function cancelPickup(claimId) {
    const c = db.byId("claims", claimId);
    if (!canManage(c) || !c.pickup) return;
    delete c.pickup; db.upsert("claims", c);
    log(currentStaff() ? currentStaff().name : c.name, "Pick-up time cancelled", c.id, "");
    notify({ phone: c.phone, userId: c.userId, ref: c.id, type: "pickup_cancelled", vars: { item: c.itemTitle } });
  }
  const pickupsOn = (date) => db.all("claims").filter((c) => c.status === "approved" && c.pickup && c.pickup.date === date).sort((a, b) => a.pickup.time.localeCompare(b.pickup.time));

  /* ==========================================================================
     STAFF TOOLS — correct a record, shelf location, moving items between libraries
     ========================================================================== */
  const EDITABLE = {
    lost: ["itemName", "category", "brand", "color", "description", "uniqueDetails", "dateLost", "branch", "location", "floor", "locationDetail"],
    found: ["title", "category", "brand", "color", "description", "privateDetails", "date", "branch", "location", "floor", "locationDetail"],
  };
  function updateRecord(kind, id, changes) {
    requireAdmin();
    const rec = db.byId(kind, id);
    if (!rec) return null;
    const changed = [], oldCategory = rec.category;
    EDITABLE[kind].forEach((k) => { if (k in changes && String(changes[k] ?? "") !== String(rec[k] ?? "")) { changed.push(`${k}: "${rec[k] || ""}" → "${changes[k] || ""}"`); rec[k] = changes[k]; } });
    if (!changed.length) return rec;
    rec.updatedAt = now();
    rec.edits = [...(rec.edits || []), { at: now(), by: currentStaff().name, changes: changed }];
    db.upsert(kind, rec);
    log(currentStaff().name, "Record corrected", id, changed.join("; ").slice(0, 400));
    refreshMatches(null, { categories: [oldCategory, rec.category] });
    return rec;
  }
  function setStorage(foundId, storage) {
    requireAdmin();
    const f = db.byId("found", foundId);
    if (!f) return;
    f.storage = String(storage || "").trim().slice(0, 60);
    db.upsert("found", f);
    log(currentStaff().name, "Storage location set", foundId, f.storage || "(cleared)");
  }
  function startTransfer(foundId, to, note) {
    requireAdmin();
    const f = db.byId("found", foundId);
    if (!f || !LIBRARY.branches.includes(to) || to === keptAt(f)) throw new Error("Choose a different library.");
    f.transfer = { from: keptAt(f), to, at: now(), by: currentStaff().name, note: note || "" };
    db.upsert("found", f);
    log(currentStaff().name, "Item sent to another library", foundId, `${f.transfer.from} → ${to}`);
    // Tell anyone with an approved claim on it
    db.all("claims").filter((c) => c.itemId === f.id && c.status === "approved").forEach((c) =>
      notify({ phone: c.phone, userId: c.userId, ref: c.id, type: "item_moved", vars: { item: f.title, place: to } }));
  }
  function receiveTransfer(foundId) {
    requireAdmin();
    const f = db.byId("found", foundId);
    if (!f || !f.transfer) return;
    f.transfers = [...(f.transfers || []), { ...f.transfer, receivedAt: now(), receivedBy: currentStaff().name }];
    f.keptAt = f.transfer.to;
    delete f.transfer;
    if (f.storage) f.storage = "";                                        // new place, new shelf
    db.upsert("found", f);
    db.all("claims").filter((c) => c.itemId === f.id && c.status === "approved" && c.pickup).forEach((c) => { c.pickup.place = f.keptAt; db.upsert("claims", c); });
    log(currentStaff().name, "Moved item received", foundId, `Now kept at ${f.keptAt}`);
  }

  /* ==========================================================================
     ANALYTICS — counts only, never item details (safe to show the public)
     ========================================================================== */
  const localDate = (iso) => toISODate(new Date(iso));
  /* The last n months: lost reports, found items reported, and items returned to owners */
  const publicAgg = (k) => (REMOTE && !currentStaff() && RS().agg && RS().agg[k]) || null;
  function monthlyTotals(n = 12) {
    if (publicAgg("monthly")) return publicAgg("monthly").slice(-n);
    const now = new Date(), out = [];
    for (let i = n - 1; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({ key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`, lost: 0, found: 0, returned: 0 });
    }
    const at = Object.fromEntries(out.map((o, i) => [o.key, i]));
    const bump = (iso, field) => { if (!iso) return; const k = localDate(iso).slice(0, 7); if (k in at) out[at[k]][field]++; };
    db.all("lost").forEach((l) => bump(l.createdAt, "lost"));
    db.all("found").forEach((f) => { bump(f.createdAt, "found"); if (f.status === "returned" && f.release) bump(f.release.at, "returned"); });
    return out;
  }
  function totals() {
    if (publicAgg("totals")) return publicAgg("totals");
    const lost = db.all("lost"), found = db.all("found");
    const returned = found.filter((f) => f.status === "returned").length;
    const open = lost.filter((l) => ACTIVE_LOST.includes(l.status));
    return { lost: lost.length, found: found.length, returned, openLost: open.length,
      returnRate: found.length ? Math.round((returned / found.length) * 100) : 0 };
  }
  /* Open lost reports grouped by the day they were reported (no item details) */
  function lostReportsByDate(days = 30) {
    const from = daysAgo(days), map = {};
    if (publicAgg("lostByDate")) return publicAgg("lostByDate").filter((x) => x.date >= from);
    db.all("lost").filter((l) => ACTIVE_LOST.includes(l.status)).forEach((l) => { const d = localDate(l.createdAt); if (d >= from) map[d] = (map[d] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0])).map(([date, count]) => ({ date, count }));
  }

  /* ---------------- Check Status ----------------
     The reference number and the last 4 digits of the phone given open the report for this
     visitor. 5 wrong tries in a row from the same device (on the server: network address)
     wait 5 minutes. */
  const NOT_FOUND_STATUS = "We couldn't find that report. Please check the reference number and phone digits.";
  function checkStatus(ref, last4) {
    const key = "status:" + deviceKey();
    checkLock(key);
    const hit = findRef(ref);
    const phone = hit && (hit.item.phone || hit.item.finderPhone);
    if (!hit || !phone || digits(phone).slice(-4) !== digits(last4) || digits(last4).length !== 4) { noteFail(key); throw new Error(NOT_FOUND_STATUS); }
    clearFails(key);
    unlockCertificate(hit.item.id);
    return { kind: hit.kind, id: hit.item.id };
  }

  /* ---------------- Look-ups ---------------- */
  function findRef(ref) {
    const r = String(ref || "").trim().toUpperCase();
    for (const kind of ["lost", "claims", "found"]) {
      const item = db.byId(kind, r);
      if (item) return { kind, item };
    }
    return null;
  }
  function recordsForPerson({ userId, phone }) {
    const mine = (x, phoneField) => (userId && x.userId === userId) || (phone && samePhone(x[phoneField], phone));
    return {
      lost: db.all("lost").filter((x) => mine(x, "phone")),
      found: db.all("found").filter((x) => mine(x, "finderPhone")),
      claims: db.all("claims").filter((x) => mine(x, "phone")),
    };
  }
  const publicFound = () => db.all("found").filter((f) => PUBLIC_FOUND.includes(f.status)).sort((a, b) => b.date.localeCompare(a.date));
  const daysHeld = (f) => Math.max(0, dayDiff(toISODate(new Date()), f.date));

  /* ---------------- Holding period (old items) ----------------
     Items are kept for LIBRARY.holdDays (plus any extension). A few days before
     the limit, people with a possible match or an open claim are reminded.
     After the limit the item goes on the administrator's donation / disposal
     list — nothing is removed until the administrator approves it. */
  const holdLimit = (f) => LIBRARY.holdDays + (f.holdExtra || 0);
  const daysLeft = (f) => holdLimit(f) - daysHeld(f);
  function heldUntil(f) { const d = new Date(f.date + "T00:00:00"); d.setDate(d.getDate() + holdLimit(f)); return toISODate(d); }
  const disposalList = () => db.all("found").filter((f) => ["recorded", "possible-owner"].includes(f.status) && daysLeft(f) < 0).sort((a, b) => a.date.localeCompare(b.date));

  function housekeeping() {
    if (REMOTE) return; // the server sends the reminders
    // Offline version: the privacy clean-up once a day (the server does it every night)
    if (!window.LF_STORE) { const day = new Date().toISOString().slice(0, 10); if (get("qcpllf_retention_day", "") !== day) { try { applyRetention(); } catch {} put("qcpllf_retention_day", day); } }
    const list = db.all("found");
    let changed = false;
    list.forEach((f) => {
      if (!PUBLIC_FOUND.includes(f.status) || daysLeft(f) > LIBRARY.remindDaysBefore) return;
      const until = new Date(heldUntil(f) + "T00:00:00").toLocaleDateString(uiLocale(), { month: "long", day: "numeric" });
      const people = [
        ...matchesForFound(f).map((m) => ({ phone: m.item.phone, userId: m.item.userId, ref: m.item.id })),
        ...db.all("claims").filter((c) => c.itemId === f.id && ["submitted", "under-verification", "approved"].includes(c.status)).map((c) => ({ phone: c.phone, userId: c.userId, ref: c.id })),
      ];
      // Each person is reminded once, including people who report after the first reminders went out
      const already = new Set(f.remindedRefs || []);
      const fresh = people.filter((p) => !already.has(p.ref));
      if (!fresh.length) return;
      fresh.forEach((p) => notify({ ...p, type: "claim_soon", vars: { item: f.title, ref: f.id, until } }));
      f.remindedRefs = [...already, ...fresh.map((p) => p.ref)];
      changed = true;
      log("System", "Holding-limit reminder sent", f.id, `${fresh.length} ${fresh.length === 1 ? "person" : "people"} notified; kept until ${until}`);
    });
    if (changed) db.save("found", list);
  }

  /* ==========================================================================
     KEEPING PERSONAL INFORMATION ONLY AS LONG AS NEEDED (ORG.privacy)
     Every night (and once a day in the offline version):
     - closed reports, found items and claims older than closedRecordsDays keep
       only what the monthly numbers need (type of item, color, brand, place,
       dates, status). Names, contacts, descriptions, marks, photos, answers and
       release details are erased;
     - updates, certificates and feedback comments older than their limit are
       erased (feedback scores stay, without the comment);
     - activity log entries older than activityLogDays are erased;
     - user accounts nobody signed in to for inactiveAccountsDays are deleted.
     ========================================================================== */
  const FINAL = { lost: ["returned", "closed"], found: ["returned", "disposed"], claims: ["returned", "rejected"] };
  const KEEP = {
    lost: ["id", "library", "category", "color", "brand", "status", "createdAt", "updatedAt", "dateLost", "timeOfDay", "branch", "location", "floor", "lang"],
    found: ["id", "library", "category", "color", "brand", "status", "createdAt", "updatedAt", "date", "branch", "location", "floor", "holdExtra"],
    claims: ["id", "library", "itemId", "lostId", "status", "createdAt", "updatedAt"],
  };
  const lastActive = (r) => Date.parse(r.updatedAt || (r.history && r.history.length ? r.history[r.history.length - 1].at : "") || r.createdAt || 0) || 0;
  function anonymized(kind, r, at) {
    const out = {};
    for (const f of KEEP[kind]) if (r[f] !== undefined) out[f] = r[f];
    if (kind === "found" && r.disposition) out.disposition = { type: r.disposition.type, at: r.disposition.at };
    if (kind === "found" && r.release) out.release = { at: r.release.at };
    const typeName = (CATEGORIES.find((c) => c.id === r.category) || { name: "Item" }).name;
    if (kind === "lost") out.itemName = typeName;
    if (kind === "found") out.title = typeName;
    if (kind === "claims") out.itemTitle = "";
    out.history = (r.history || []).map((h) => ({ status: h.status, at: h.at }));
    out.anonymized = at;
    return out;
  }
  function applyRetention(at = Date.now()) {
    const P = (typeof ORG !== "undefined" && ORG.privacy) || {};
    const days = (n, d) => (Number(n) > 0 ? Number(n) : d) * 86_400_000;
    const stamp = new Date(at).toISOString(), done = { records: 0, notifs: 0, contribs: 0, feedback: 0, activity: 0, accounts: 0 };
    const recLimit = at - days(P.closedRecordsDays, 365);
    for (const kind of ["lost", "found", "claims"]) {
      let n = 0;
      const list = db.raw(kind).map((r) => (!r.anonymized && FINAL[kind].includes(r.status) && lastActive(r) < recLimit ? (n++, anonymized(kind, r, stamp)) : r));
      if (n) { put(K[kind], list); done.records += n; }
    }
    const older = (kind, field, limit, cb) => {
      const all = db.raw(kind), keep = all.filter((x) => !(Date.parse(x[field] || 0) < limit));
      if (keep.length !== all.length) { put(K[kind], keep); cb(all.length - keep.length); }
    };
    older("notifs", "at", at - days(P.notificationsDays, 365), (n) => (done.notifs = n));
    older("contribs", "issuedAt", at - days(P.closedRecordsDays, 365), (n) => (done.contribs = n));
    older("activity", "at", at - days(P.activityLogDays, 730), (n) => (done.activity = n));
    const fbLimit = at - days(P.closedRecordsDays, 365);
    const fb = db.raw("feedback");
    let fbn = 0;
    const fb2 = fb.map((x) => (x.comment && Date.parse(x.at || 0) < fbLimit ? (fbn++, { ...x, comment: "" }) : x));
    if (fbn) { put(K.feedback, fb2); done.feedback = fbn; }
    const accLimit = at - days(P.inactiveAccountsDays, 730);
    const users = db.raw("users"), active = users.filter((u) => !(Date.parse(u.lastSignIn || u.createdAt || 0) < accLimit));
    if (active.length !== users.length) { put(K.users, active); done.accounts = users.length - active.length; }
    const parts = [[done.records, "closed records anonymized"], [done.notifs, "old updates"], [done.contribs, "old certificates"], [done.feedback, "feedback comments"], [done.activity, "old log entries"], [done.accounts, "unused accounts"]].filter(([n]) => n);
    if (parts.length) log("System", "Privacy clean-up (old personal information erased)", "", parts.map(([n, w]) => `${n} ${w}`).join(", "));
    return done;
  }

  function disposeItem(id, type, note) {
    requireSupervisor();
    const f = db.byId("found", id);
    f.disposition = { type, note: note || "", at: now(), by: currentStaff().name };
    addHistory(f, "disposed", currentStaff().name, type === "donated" ? "Donated" : "Disposed");
    db.upsert("found", f);
    log(currentStaff().name, type === "donated" ? "Unclaimed item donated" : "Unclaimed item disposed", id, `${f.title}${note ? " — " + note : ""}`);
    refreshMatches(null, { categories: [f.category] });
  }
  function extendHold(id, days) {
    requireAdmin();
    const f = db.byId("found", id);
    f.holdExtra = (f.holdExtra || 0) + days;
    f.remindedRefs = []; // remind again before the new date
    db.upsert("found", f);
    log(currentStaff().name, "Holding period extended", id, `+${days} days (kept until ${heldUntil(f)})`);
  }

  /* ---------------- Feedback after an item is returned ---------------- */
  function addFeedback({ ref, ease, satisfaction, comment }) {
    const list = db.all("feedback");
    if (list.some((x) => x.ref === ref)) return;
    list.unshift({ id: uid("FB"), ref, ease: Number(ease), satisfaction: Number(satisfaction), comment: String(comment || "").slice(0, 500), at: now() });
    db.save("feedback", list);
    log("Owner", "Feedback submitted", ref, `Ease ${ease}/5, satisfaction ${satisfaction}/5`);
  }
  const feedbackFor = (ref) => db.all("feedback").find((x) => x.ref === ref) || null;
  function feedbackStats(list = db.all("feedback")) {
    const avg = (k) => (list.length ? Math.round((list.reduce((a, x) => a + x[k], 0) / list.length) * 10) / 10 : 0);
    return { count: list.length, ease: avg("ease"), satisfaction: avg("satisfaction"), recent: list.filter((x) => x.comment).slice(0, 5) };
  }

  /* ---------------- Monthly report (per library) ---------------- */
  function monthlyReport(key) { // key = "YYYY-MM"
    const inMonth = (iso) => String(iso || "").slice(0, 7) === key;
    const lost = db.all("lost").filter((l) => inMonth(l.createdAt));
    const foundAll = db.all("found");
    const found = foundAll.filter((f) => inMonth(f.createdAt));
    const returned = foundAll.filter((f) => f.status === "returned" && f.release && inMonth(f.release.at)).sort((a, b) => a.release.at.localeCompare(b.release.at));
    const disposed = foundAll.filter((f) => f.disposition && inMonth(f.disposition.at));
    const claims = db.all("claims").filter((c) => inMonth(c.createdAt));
    const count = (arr, k) => Object.entries(arr.reduce((m, x) => ((m[x[k]] = (m[x[k]] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
    const days = returned.map((f) => Math.max(0, dayDiff(f.release.at.slice(0, 10), f.date)));
    return {
      key, lost, found, returned, disposed, claims,
      claimsApproved: claims.filter((c) => ["approved", "returned"].includes(c.status)).length,
      claimsRejected: claims.filter((c) => c.status === "rejected").length,
      avgDays: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : 0,
      byCategory: count(lost, "category"),
      byLocation: count(lost.filter((l) => l.location && l.location !== "I'm not sure"), "location"),
      unclaimedNow: foundAll.filter((f) => ["recorded", "possible-owner"].includes(f.status)),
      feedback: feedbackStats(db.all("feedback").filter((x) => inMonth(x.at))),
    };
  }

  /* ---------------- Accounts ---------------- */
  async function sha256(text) {
    if (window.crypto && crypto.subtle) {
      try {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
      } catch { /* fall through */ }
    }
    return sha256Plain(text); // e.g. when the page is opened straight from a file
  }

  /* Plain-JavaScript SHA-256 (same result as crypto.subtle) */
  function sha256Plain(text) {
    const bytes = new TextEncoder().encode(text);
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total);
    m.set(bytes); m[len] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor((len * 8) / 0x100000000)); dv.setUint32(total - 4, (len * 8) >>> 0);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => (H[i] = (H[i] + v) >>> 0));
    }
    return H.map((x) => x.toString(16).padStart(8, "0")).join("");
  }

  async function register(input) {
    const { name, phone, email, role, memberId } = clip(input), password = String(input.password || "");
    rateGuard("register", 3, 3600_000);
    const passHash = await PW.hash(`lf-user:${digits(phone)}`, password);
    const everyone = db.raw("users"); // one account per person across all library portals
    if (everyone.some((u) => samePhone(u.phone, phone))) throw new Error("An account with this mobile number already exists. Please sign in instead.");
    if (email && everyone.some((u) => u.email && u.email.toLowerCase() === email.toLowerCase())) throw new Error("An account with this email already exists. Please sign in instead.");
    if (memberId && everyone.some((u) => u.memberId && u.memberId.toLowerCase() === memberId.toLowerCase())) throw new Error("An account with this QCitizen ID or library card number already exists. Please sign in instead.");
    const users = db.all("users");
    // "verified" is set by the library administrator after checking a valid ID in person
    // "contactVerified": the person typed the 6-digit code sent to their phone/email.
    // Until then the account can't be used (sign-in sends them back to the code screen).
    const user = { id: uid("U"), name, phone, email: email || "", role: role || USER_ROLES[0], memberId: memberId || "", lang: viewerLang(), verified: false, contactVerified: false, passHash, active: true, createdAt: now() };
    users.push(user);
    db.save("users", users);
    staffLogout();
    logout();
    if (!ORG.signupCode) {
      // No code for now: signed in straight away (the mobile number stays "not confirmed")
      put(K.session, { userId: user.id, at: Date.now() });
      log(name, "Account created", user.id, "");
      return user;
    }
    put(K.pending, { userId: user.id });
    log(name, "Account created (waiting for the code)", user.id, "");
    return user;
  }

  /* ---------------- New account: 6-digit verification code ----------------
     Sent automatically after sign-up, by text (and email if given).
     Valid 10 minutes, 5 tries. DEMO NOTE: checked in the browser; a real backend
     must create and check the code on the server. */
  const pendingUser = () => { const p = get(K.pending, null); return (p && db.raw("users").find((u) => u.id === p.userId)) || null; };
  function pendingVerification() {
    if (!ORG.signupCode) return null;
    if (REMOTE) return RS().session.pending || null;
    const u = pendingUser();
    return u && u.contactVerified === false ? { name: u.name, phone: u.phone, email: u.email } : null;
  }
  async function sendSignupCode(opts = {}) {
    if (!ORG.signupCode) return { sent: false, reason: "off" };
    const user = pendingUser();
    if (!user) throw new Error("Please create an account or sign in first.");
    const can = await channels();
    const demo = !!opts.demo && !can.email && !can.sms;
    // No way to send a code: the account stays off until the desk turns it on after checking a valid ID
    if (!can.email && !can.sms && !demo) return { sent: false, reason: "no-channel" };
    const all = get(K.verifies, {});
    const old = all[user.id], t = Date.now();
    // Within a minute of the last code, no new text is sent (also when the page is opened again)
    if (old && t - old.at < 60000) return { sent: true, demoCode: demo ? old.demo : undefined, wait: Math.ceil((60000 - (t - old.at)) / 1000) };
    const sends = ((old && old.sends) || []).filter((x) => t - x < 3600_000);
    if (sends.length >= 5) return { sent: false, reason: "too-many" };
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    // Wrong tries count across new codes, so "Send again" can't be used to keep guessing
    all[user.id] = { hash: await sha256(`lf-verify:${user.id}:${code}`), exp: t + 10 * 60000, tries: old && t - old.at < 3600_000 ? old.tries : 0, at: t, sends: [...sends, t], ...(demo ? { demo: code } : {}) };
    put(K.verifies, all);
    if (demo) return { sent: true, demoCode: code };
    try {
      const res = await fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "verify_code", vars: { code }, ref: user.id, library: user.library, pref: "", lang: viewerLang(), to: { email: user.email || "", phone: user.phone } }) });
      const r = res.ok ? await res.json() : null;
      if (!r || (r.sms !== "sent" && r.email !== "sent")) return { sent: false, reason: "send-failed" };
    } catch { return { sent: false, reason: "send-failed" }; }
    return { sent: true };
  }
  async function confirmSignupCode(code) {
    const user = pendingUser();
    const all = get(K.verifies, {});
    const r = user && all[user.id];
    if (!r || r.exp < Date.now()) throw new Error("The code has expired. Please press Send again for a new one.");
    if (r.tries >= 8) throw new Error("Too many wrong tries. Please wait an hour, or visit the Lost & Found desk with a valid ID.");
    if (r.hash !== (await sha256(`lf-verify:${user.id}:${String(code || "").trim()}`))) { r.tries++; put(K.verifies, all); throw new Error("The code is not correct."); }
    put(K.users, db.raw("users").map((u) => (u.id === user.id ? { ...u, contactVerified: true } : u)));
    delete all[user.id]; put(K.verifies, all);
    try { localStorage.removeItem(K.pending); } catch {}
    put(K.session, { userId: user.id, at: Date.now() });
    log(user.name, "Mobile number confirmed with the code", user.id, "");
    return user;
  }
  function cancelSignup() { try { localStorage.removeItem(K.pending); } catch {} }
  /* After 5 wrong passwords for the same account, sign-in waits 5 minutes */
  const FAIL_MAX = 5, FAIL_WAIT = 5 * 60000;
  function checkLock(key) {
    const f = get(K.fails, {})[key];
    if (f && f.n >= FAIL_MAX && Date.now() - f.at < FAIL_WAIT) throw new Error(`Too many wrong tries. Please wait ${Math.ceil((FAIL_WAIT - (Date.now() - f.at)) / 60000)} minutes and try again.`);
  }
  function noteFail(key) {
    const all = get(K.fails, {}), f = all[key] && Date.now() - all[key].at < FAIL_WAIT ? all[key] : { n: 0 };
    all[key] = { n: f.n + 1, at: Date.now() }; put(K.fails, all);
  }
  const clearFails = (key) => { const all = get(K.fails, {}); delete all[key]; put(K.fails, all); };
  async function login(idOrPhone, password) {
    const key = String(idOrPhone || "").trim().toLowerCase();
    const lockKey = "u:" + (digits(key).length >= 10 ? digits(key).slice(-10) : key);
    checkLock(lockKey);
    // Sign in with an email or mobile number (or a QCitizen ID / library card number, if one was given)
    const user = db.raw("users").find((u) => (u.memberId && u.memberId.toLowerCase() === key) || (u.email && u.email.toLowerCase() === key) || (digits(key).length >= 10 && samePhone(u.phone, key)));
    // (a check is done even for an unknown account, so the time taken doesn't tell whether it exists)
    if (!user ? (await PW.verify("", "lf-user:0", password), true) : !(await PW.verify(user.passHash, `lf-user:${digits(user.phone)}`, password))) { noteFail(lockKey); throw new Error("The email / mobile number or the password is not correct."); }
    clearFails(lockKey);
    if (!user.active) throw new Error("This account is turned off. Please call the Lost & Found Office.");
    staffLogout();
    setSelectedLibrary(user.library); // a user always works inside their own library portal
    if (user.contactVerified === false && ORG.signupCode) {
      // Not confirmed yet: send them to the code screen instead of signing in
      put(K.pending, { userId: user.id });
      const e = new Error("Please type the 6-digit code we sent to your mobile number first."); e.code = "needs-verify"; throw e;
    }
    put(K.session, { userId: user.id, at: Date.now() });
    put(K.users, db.raw("users").map((u) => (u.id === user.id ? { ...u, lastSignIn: now() } : u)));
    log(user.name, "Signed in", user.id, "");
    return user;
  }
  function logout() { try { localStorage.removeItem(K.session); } catch {} }
  const USER_IDLE = 30 * 60000, STAFF_IDLE = 20 * 60000;
  let idleSignout = false; // set when someone is signed out for not using the page
  const takeIdleSignout = () => { if (REMOTE) { const f = !!RS().idleOut; RS().idleOut = false; return f; } const f = idleSignout; idleSignout = false; return f; };
  /* Called on every page change and click: keeps an active person signed in */
  function touchSession() {
    if (REMOTE) return; // the server keeps track of activity
    const s = get(K.session, null);
    if (s && s.at && Date.now() - s.at < USER_IDLE) put(K.session, { ...s, at: Date.now() });
    try { const t = JSON.parse(sessionStorage.getItem(STAFF_KEY) || "null"); if (t && t.at && Date.now() - t.at < STAFF_IDLE) sessionStorage.setItem(STAFF_KEY, JSON.stringify({ ...t, at: Date.now() })); } catch {}
  }
  function currentUser() {
    if (REMOTE) return RS().session.user || null;
    const s = get(K.session, null);
    if (s && (!s.at || Date.now() - s.at > USER_IDLE)) { if (s.at) idleSignout = true; signOut(); return null; }
    const u = s && db.raw("users").find((x) => x.id === s.userId);
    if (!u || !u.active) return null;
    if (selectedLibraryId() !== u.library) setSelectedLibrary(u.library); // keep them in their own library portal
    return u;
  }
  function setUserVerified(id, verified) {
    requireAdmin();
    const u = db.byId("users", id);
    u.verified = verified; if (verified) u.contactVerified = true; db.upsert("users", u);
    log(currentStaff().name, verified ? "User verified (valid ID checked)" : "User verification removed", id, u.name);
    if (verified) notify({ phone: u.phone, userId: u.id, ref: u.id, type: "account_verified", vars: {} });
  }
  function setUserActive(id, active) {
    requireAdmin();
    const u = db.byId("users", id);
    u.active = active; db.upsert("users", u);
    const staff = currentStaff();
    log(staff ? staff.name : "Staff", active ? "User account turned on" : "User account turned off", id, u.name);
  }

  /* Staff accounts: the built-in administrator accounts (supervisors, in data.js)
     plus accounts a supervisor creates for desk staff (kept per library portal). */
  const builtInHash = (acct) => get(K.staffpw, {})[acct.username] || acct.passHash; // a changed password overrides data.js
  function findStaff(username) {
    const u = String(username || "").trim().toLowerCase();
    const made = db.raw("staff").find((s) => s.username === u);
    if (made) return { ...made, level: made.role === "Supervisor" ? "supervisor" : "desk", custom: true };
    const b = STAFF_ACCOUNTS.find((a) => a.username === u);
    return b ? { ...b, passHash: builtInHash(b), level: "supervisor", custom: false } : null;
  }
  async function staffLogin(username, password) {
    const lockKey = "s:" + String(username || "").trim().toLowerCase();
    checkLock(lockKey);
    const acct = findStaff(username);
    if (!acct ? (await PW.verify("", "lf-staff", password), true) : !(await PW.verify(acct.passHash, "lf-staff", password))) { noteFail(lockKey); throw new Error("Username or password is not correct."); }
    clearFails(lockKey);
    if (acct.custom && !acct.active) throw new Error("This staff account is turned off. Please ask your supervisor.");
    try { sessionStorage.setItem(STAFF_KEY, JSON.stringify({ username: acct.username, name: acct.name, role: acct.role, library: acct.library, level: acct.level, mustChange: !!acct.mustChange, at: Date.now() })); } catch {}
    logout(); // an administrator is never signed in as a user at the same time
    if (acct.library !== "all") setSelectedLibrary(acct.library);
    log(acct.name, "Administrator signed in", "", "");
    return acct;
  }
  function staffLogout() { try { sessionStorage.removeItem(STAFF_KEY); } catch {} }

  /* ---------------- Authorization ----------------
     Administrator: everything. User: only their own records (see recordsForPerson,
     notificationsFor, canViewCertificate). Admin-only actions call requireAdmin(). */
  function requireAdmin() {
    if (!currentStaff()) throw new Error("Only an administrator can do this. Please sign in as an administrator.");
  }
  const currentRole = () => (currentStaff() ? "admin" : currentUser() ? "user" : "guest");
  const isSupervisor = () => { const s = currentStaff(); return !!s && s.level !== "desk"; };
  function requireSupervisor() {
    requireAdmin();
    if (!isSupervisor()) throw new Error("Only a supervisor can do this.");
  }
  const tempPassword = () => { const c = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s = ""; const r = new Uint32Array(8); crypto.getRandomValues(r); r.forEach((n) => (s += c[n % c.length])); return `QC-${s.slice(0, 4)}-${s.slice(4)}`; };

  /* ---------------- Staff management (supervisors) ---------------- */
  const staffList = () => db.all("staff");
  async function createStaff({ username, name, role, password }) {
    requireSupervisor();
    const u = String(username || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) throw new Error("Use 3 to 30 letters, numbers, dots or dashes for the username, with no spaces.");
    if (findStaff(u)) throw new Error("That username is already taken.");
    if (!name || !name.trim()) throw new Error("Please type the staff member's name.");
    if (!password || password.length < 8) throw new Error("The password needs at least 8 characters.");
    const passHash = await PW.hash("lf-staff", password);
    if (findStaff(u)) throw new Error("That username is already taken."); // checked again: a quick second click can't make a copy
    const rec = { id: uid("S"), username: u, name: name.trim().slice(0, 80), role: STAFF_ROLES.includes(role) ? role : STAFF_ROLES[0], passHash, active: true, mustChange: true, createdAt: now(), createdBy: currentStaff().name };
    db.upsert("staff", rec);
    log(currentStaff().name, "Staff account created", rec.username, `${rec.name} (${rec.role})`);
    return rec;
  }
  function setStaffActive(id, active) {
    requireSupervisor();
    const s = db.byId("staff", id);
    if (!s) return;
    s.active = active; db.upsert("staff", s);
    log(currentStaff().name, active ? "Staff account turned on" : "Staff account turned off", s.username, s.name);
  }
  function setStaffRole(id, role) {
    requireSupervisor();
    const s = db.byId("staff", id);
    if (!s || !STAFF_ROLES.includes(role)) return;
    s.role = role; db.upsert("staff", s);
    log(currentStaff().name, "Staff role changed", s.username, role);
  }
  async function resetStaffPassword(id) {
    requireSupervisor();
    const s = db.byId("staff", id);
    if (!s) return null;
    const temp = tempPassword();
    s.passHash = await PW.hash("lf-staff", temp); s.mustChange = true; db.upsert("staff", s);
    log(currentStaff().name, "Staff password reset", s.username, s.name);
    return temp;
  }
  /* Any staff member: change their own password */
  async function changeStaffPassword(current, next) {
    requireAdmin();
    const me = currentStaff();
    const acct = findStaff(me.username);
    if (!acct || !(await PW.verify(acct.passHash, "lf-staff", current))) throw new Error("Your current password is not correct.");
    if (!next || next.length < 8) throw new Error("The new password needs at least 8 characters.");
    const hash = await PW.hash("lf-staff", next);
    if (acct.custom) {
      const all = db.raw("staff").map((s) => (s.username === acct.username ? { ...s, passHash: hash, mustChange: false } : s));
      put(K.staff, all);
    } else {
      const map = get(K.staffpw, {}); map[acct.username] = hash; put(K.staffpw, map);
    }
    try { sessionStorage.setItem(STAFF_KEY, JSON.stringify({ ...me, mustChange: false })); } catch {}
    log(me.name, "Changed own password", me.username, "");
  }

  /* ---------------- User account settings ---------------- */
  const userHash = (phone, pw) => PW.hash(`lf-user:${digits(phone)}`, pw);
  const userCheck = (user, pw) => PW.verify(user.passHash, `lf-user:${digits(user.phone)}`, pw || "");
  async function updateAccount({ name, email, memberId, phone, currentPassword, newPassword }) {
    const user = currentUser();
    if (!user) throw new Error("Please sign in first.");
    if (!(await userCheck(user, currentPassword))) throw new Error("Your current password is not correct.");
    const others = db.raw("users").filter((u) => u.id !== user.id);
    const nextPhone = phone && phone.trim() ? phone.trim() : user.phone;
    if (!samePhone(nextPhone, user.phone) && others.some((u) => samePhone(u.phone, nextPhone))) throw new Error("Another account already uses this mobile number.");
    if (email && others.some((u) => u.email && u.email.toLowerCase() === email.toLowerCase())) throw new Error("Another account already uses this email.");
    if (memberId && others.some((u) => u.memberId && u.memberId.toLowerCase() === memberId.toLowerCase())) throw new Error("Another account already uses this ID or card number.");
    if (newPassword && newPassword.length < 8) throw new Error("The new password needs at least 8 characters.");
    const c = clip({ name, email, memberId });
    const phoneChanged = !samePhone(nextPhone, user.phone);
    const updated = { ...user, name: c.name || user.name, email: c.email || "", memberId: c.memberId || "", phone: nextPhone, mustChange: newPassword ? false : user.mustChange };
    updated.passHash = await userHash(nextPhone, newPassword || currentPassword);
    // A new mobile number must be confirmed with a code before it is used (sign-in, updates, matching reports)
    if (phoneChanged) { updated.contactVerified = false; const v = get(K.verifies, {}); delete v[user.id]; put(K.verifies, v); }
    if (!put(K.users, db.raw("users").map((u) => (u.id === user.id ? updated : u)))) throw new Error("This device has no more room to save. Please ask the Lost & Found desk for help.");
    log(updated.name, newPassword ? "Account details and password updated" : "Account details updated", user.id, phoneChanged ? (ORG.signupCode ? "Mobile number changed (waiting for the code)" : "Mobile number changed (not confirmed)") : "");
    if (phoneChanged && ORG.signupCode) { logout(); put(K.pending, { userId: user.id }); updated.needsVerify = true; }
    return updated;
  }
  async function deleteAccount(password) {
    const user = currentUser();
    if (!user) throw new Error("Please sign in first.");
    if (!(await userCheck(user, password))) throw new Error("The password is not correct.");
    put(K.users, db.raw("users").filter((u) => u.id !== user.id));
    logout();
    log("System", "User deleted their account", user.id, "Reports stay on file until they are closed");
  }

  /* ---------------- Forgot password ----------------
     With email or SMS set up on the server, a 6-digit code is sent to the
     person. Without it, the Lost & Found desk resets the password after checking
     a valid ID (Users page). DEMO NOTE: the code is checked in the browser; with
     a real backend the server must create and check it. */
  function findUserBy(idOrPhone) {
    const key = String(idOrPhone || "").trim().toLowerCase();
    return db.raw("users").find((u) => (u.memberId && u.memberId.toLowerCase() === key) || (u.email && u.email.toLowerCase() === key) || (digits(key).length >= 10 && samePhone(u.phone, key))) || null;
  }
  async function requestPasswordReset(idOrPhone, opts = {}) {
    const can = await channels();
    // opts.demo: only on this computer (localhost / offline file) with no email or SMS set up,
    // the code is handed back so the screen can show it. Never used on a real website.
    const demo = !!opts.demo && !can.email && !can.sms;
    if (!can.email && !can.sms && !demo) return { sent: false, reason: "no-channel" };
    const user = findUserBy(idOrPhone);
    if (!user) return { sent: true }; // same answer either way, so nobody can test which numbers have accounts
    const resets = get(K.resets, {}), old = resets[user.id], t = Date.now();
    if (old && t - old.at < 60000) return { sent: true, demoCode: demo ? old.demo : undefined, wait: Math.ceil((60000 - (t - old.at)) / 1000) };
    const sends = ((old && old.sends) || []).filter((x) => t - x < 3600_000);
    if (sends.length >= 5) return { sent: true, wait: 60 }; // quietly stop sending; the person can visit the desk
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    resets[user.id] = { hash: await sha256(`lf-reset:${user.id}:${code}`), exp: t + 15 * 60000, tries: old && t - old.at < 3600_000 ? old.tries : 0, at: t, sends: [...sends, t], ...(demo ? { demo: code } : {}) };
    put(K.resets, resets);
    if (demo) return { sent: true, demoCode: code };
    try {
      const res = await fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "reset_code", vars: { code }, ref: user.id, library: user.library, pref: "", lang: viewerLang(), to: { email: user.email || "", phone: user.phone } }) });
      const r = res.ok ? await res.json() : null;
      if (!r || (r.sms !== "sent" && r.email !== "sent")) return { sent: false, reason: "send-failed" };
    } catch { return { sent: false, reason: "send-failed" }; }
    return { sent: true };
  }
  /* Checks the code (counts wrong tries) without changing the password yet.
     The same message is shown whether or not the account exists. */
  const WRONG_CODE = "The code is not correct, or it has expired. Please check it or press Send again.";
  async function verifyResetCode(idOrPhone, code) {
    const user = findUserBy(idOrPhone);
    const resets = get(K.resets, {});
    const r = user && resets[user.id];
    if (r && r.tries >= 8) throw new Error("Too many wrong tries. Please wait an hour, or visit the Lost & Found desk with a valid ID.");
    if (!r || r.exp < Date.now() || r.hash !== (await sha256(`lf-reset:${user.id}:${String(code || "").trim()}`))) {
      if (r) { r.tries++; put(K.resets, resets); }
      throw new Error(WRONG_CODE);
    }
    return { user, resets };
  }
  async function resetPassword(idOrPhone, code, newPassword) {
    const { user, resets } = await verifyResetCode(idOrPhone, code);
    if (!newPassword || newPassword.length < 8) throw new Error("The new password needs at least 8 characters.");
    const hash = await userHash(user.phone, newPassword);
    put(K.users, db.raw("users").map((u) => (u.id === user.id ? { ...u, passHash: hash, mustChange: false } : u)));
    delete resets[user.id]; put(K.resets, resets);
    log(user.name, "Password reset with a code", user.id, "");
  }
  /* The desk resets a user's password after checking their valid ID */
  async function adminResetUserPassword(id) {
    requireAdmin();
    const u = db.byId("users", id);
    if (!u) return null;
    const temp = tempPassword();
    u.passHash = await userHash(u.phone, temp); u.mustChange = true;
    db.upsert("users", u);
    log(currentStaff().name, "User password reset at the desk (valid ID checked)", u.id, u.name);
    return temp;
  }

  /* One sign-in for both account types */
  async function signIn(kind, identifier, password) {
    if (kind === "admin") { await staffLogin(identifier, password); return "admin"; }
    await login(identifier, password);
    return "user";
  }
  /* Signing out also forgets the reports this browser was allowed to see */
  function signOut() {
    logout(); staffLogout();
    try { sessionStorage.removeItem(CERT_KEY); localStorage.removeItem(K.pending); } catch {}
  }
  function currentStaff() {
    if (REMOTE) return RS().session.staff || null;
    try {
      const s = JSON.parse(sessionStorage.getItem(STAFF_KEY) || "null");
      if (s && (!s.at || Date.now() - s.at > STAFF_IDLE)) { if (s.at) idleSignout = true; sessionStorage.removeItem(STAFF_KEY); return null; }
      return s;
    } catch { return null; }
  }

  /* ---------------- Statistics (admin dashboard) ---------------- */
  function stats() {
    const lost = db.all("lost"), found = db.all("found"), claims = db.all("claims");
    const count = (arr, key) => arr.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {});
    const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
    const returnedFound = found.filter((f) => f.status === "returned");
    const months = [];
    const d = new Date(); d.setDate(1);
    for (let i = 5; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
      months.push({
        key, label: m.toLocaleDateString(uiLocale(), { month: "short" }),
        lost: lost.filter((l) => l.createdAt.slice(0, 7) === key).length,
        returned: returnedFound.filter((f) => f.release && f.release.at.slice(0, 7) === key).length,
      });
    }
    const durations = returnedFound.filter((f) => f.release).map((f) => Math.max(0, dayDiff(f.release.at.slice(0, 10), f.date)));
    const handled = found.filter((f) => f.status !== "found");
    return {
      lostTotal: lost.length,
      foundTotal: found.length,
      returned: returnedFound.length,
      unresolved: lost.filter((l) => !["returned", "closed"].includes(l.status)).length,
      unclaimed: found.filter((f) => ["recorded", "possible-owner"].includes(f.status)).length,
      pendingClaims: claims.filter((c) => ["submitted", "under-verification"].includes(c.status)).length,
      awaitingTurnover: found.filter((f) => f.status === "found").length,
      overdue: found.filter((f) => PUBLIC_FOUND.includes(f.status) && daysLeft(f) < 0),
      recoveryRate: handled.length ? Math.round((returnedFound.length / handled.length) * 100) : 0,
      avgDays: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      byCategory: top(count(lost, "category"), 6),
      byLocation: top(count(lost.filter((l) => l.location && l.location !== "I'm not sure"), "location"), 6),
      months,
    };
  }

  /* ---------------- Start-up ----------------
     The site starts with no records. Earlier versions loaded sample data into
     the browser; that is removed once here so old samples don't linger. */
  function init() {
    if (REMOTE || window.LF_SERVER || get(K.clean, false)) return;
    ["found", "lost", "claims", "users", "notifs", "activity", "feedback", "session"].forEach((k) => { try { localStorage.removeItem(K[k]); } catch {} });
    ["qcpllf_seeded_v2", "qcpllf_seeded_v3", "qcpllf_seeded_v4", "qcpllf_seeded_v5"].forEach((k) => { try { localStorage.removeItem(k); } catch {} });
    put(K.clean, true);
  }

  /* Administrator: erase every record of the library being viewed (for testing). */
  function clearLibraryRecords() {
    requireSupervisor();
    const who = currentStaff().name, library = activeLibrary().libraryName;
    ["found", "lost", "claims", "users", "notifs", "activity", "feedback", "contribs"].forEach((k) => db.save(k, []));
    log(who, "All records cleared", "", library);
  }

  /* ---------------- Preferences ---------------- */
  const prefs = () => get(K.prefs, { size: 0, contrast: false, motion: false });
  const savePrefs = (p) => put(K.prefs, p);

  init();

  return {
    db, digits, samePhone, makeRef, daysHeld, publicFound, findRef, recordsForPerson,
    score, matchesForLost, matchesForFound, refreshMatches, matchLabel, MATCH_MIN,
    createLost, createFound, createClaim, setClaimStatus, recordReturn, setStatus, dismissMatch, contactOwner,
    notify, notificationsFor, markRead, log, channels,
    register, login, logout, currentUser, setUserActive, staffLogin, staffLogout, currentStaff,
    signIn, signOut, currentRole, requireAdmin, setUserVerified,
    holdLimit, daysLeft, heldUntil, disposalList, housekeeping, disposeItem, extendHold,
    addFeedback, feedbackFor, feedbackStats, monthlyReport,
    libraries: LIBRARIES, library: activeLibrary, selectedLibraryId,
    setLibrary(id) { setSelectedLibrary(id); },
    stats, clearLibraryRecords, prefs, savePrefs, applyRetention,
    contributionCandidates, issueContribution, contributionsFor, contributionsForRef, canViewContribution, monthName,
    monthlyTotals, totals, lostReportsByDate,
    synonymsOf, isSupervisor, requireSupervisor, staffList, createStaff, setStaffActive, setStaffRole, resetStaffPassword, changeStaffPassword,
    updateAccount, deleteAccount, requestPasswordReset, verifyResetCode, touchSession, takeIdleSignout,
    attemptGuard: checkLock, attemptFailed: noteFail, attemptOk: clearFails, pendingVerification, sendSignupCode, confirmSignupCode, cancelSignup, resetPassword, adminResetUserPassword,
    canManage, updateLostByOwner, closeLostByOwner, OPEN_LOST, keptAt, pickupSlots, pickupLabel, bookPickup, cancelPickup, pickupsOn,
    updateRecord, setStorage, startTransfer, receiveTransfer,
    isRecognizable, honestyFor, publicName, wallOfHonesty, topFinders, setThankNote, unlockCertificate, canViewCertificate,
    checkStatus, REMOTE, _resetCaches: resetCaches, _K: K,
  };
})();
