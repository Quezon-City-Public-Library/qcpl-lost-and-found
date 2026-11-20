/* ==========================================================================
   The rules engine.

   The website's own rules (js/data.js, js/messages.js, js/store.js) run here on
   the server, so there is one copy of every rule (matching, claims,
   codes, permissions) and the server is the authority: a visitor's browser can
   only ask for an action; it never decides.

   How it is safe
   - One action at a time (a queue), so two requests can never mix.
   - The data is kept in memory and in the database. When an action finishes,
     what it changed is saved to the database in one transaction. If it fails,
     nothing is saved and every list it touched is put back exactly as it was
     (only the wrong-try counters are kept, so lockouts add up).
   - Who is acting (signed-in user, staff member, the visitor's opened reports,
     their network address, the library and language) is given to the rules
     for that one action only, from the server's own session — never from the browser.
   - The rules can't reach the network or files, and can't build code from text.
     Messages (email/SMS) go through the server's own sender, and codes are made
     and checked here.
   ========================================================================== */
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import path from "node:path";

// Records kept one row per item, and small values kept whole
export const ARRAY_KEYS = ["qcpllf_found", "qcpllf_lost", "qcpllf_claims", "qcpllf_users", "qcpllf_notifs", "qcpllf_activity", "qcpllf_feedback", "qcpllf_contribs", "qcpllf_staffaccts"];
const KV_KEYS = ["qcpllf_resets", "qcpllf_verifies", "qcpllf_signinfails", "qcpllf_staffpw"];
// Wrong-try counters (passwords, Check Status, codes) are saved even when the action fails —
// a failed attempt is exactly what they count, so lockouts really add up.
const KEEP_ON_FAILURE = ["qcpllf_signinfails", "qcpllf_verifies", "qcpllf_resets"];
// Per-visitor values (kept in the visitor's session, not in the shared data)
const SESSION_KEY = "qcpllf_session", PENDING_KEY = "qcpllf_pendingverify", RATE_KEY = "qcpllf_rate",
  LIBRARY_KEY = "qcpllf_library", LANG_KEY = "qcpllf_lang", STAFF_KEY = "qcpllf_staff", CERT_KEY = "qcpllf_certs";
const isArrayKey = (k) => ARRAY_KEYS.includes(k);
const idOf = (rec, i) => String(rec && rec.id != null ? rec.id : "~" + i);

export function createEngine({ root, store, notify, channels, passwords, demoCodes = false, strict = false }) {
  /* ---------- the data: live in memory, with the saved text of each record ---------- */
  // arrays: { value: [records], rows: Map(id → saved JSON), ords: Map(id → position) }
  // small values: { value: object|null, json: saved JSON|null }
  const state = new Map();
  for (const key of ARRAY_KEYS) {
    const rows = new Map(), ords = new Map(), value = [];
    for (const r of store.rows.load(key)) { rows.set(r.id, JSON.stringify(r.rec)); ords.set(r.id, r.ord); value.push(r.rec); }
    state.set(key, { value, rows, ords });
  }
  const kvRows = new Map(store.q.kvAll.all().map((r) => [r.key, r.json]));
  for (const key of KV_KEYS) { const json = kvRows.get(key) || null; state.set(key, { value: json ? JSON.parse(json) : null, json }); }
  /** The current records of a list (read-only use: projections copy what they send) */
  const snapshot = (key) => (state.get(key) || { value: [] }).value || [];

  /* ---------- per-action context ---------- */
  let cur = null;        // { ip, library, lang, userId, staff, pending, unlocked, out }
  let draft = null;      // key → new value (what the action saved)
  let touched = null;    // keys the action read (it may have changed them in place)
  const rate = new Map(); // network address → anti-spam counters (memory only)

  // How the rules read and save data on the server (js/store.js uses window.LF_STORE)
  const LF_STORE = {
    get(k, fallback) {
      if (!cur) return fallback;
      if (k === SESSION_KEY) return cur.userId ? { userId: cur.userId, at: Date.now() } : fallback;
      if (k === PENDING_KEY) return cur.pending ? { userId: cur.pending } : fallback;
      if (k === RATE_KEY) return rate.get(cur.ip) || fallback;
      if (draft.has(k)) { const v = draft.get(k); return v == null ? fallback : v; }
      const s = state.get(k);
      if (!s) return fallback;
      touched.add(k);
      return s.value == null ? fallback : s.value;
    },
    put(k, v) {
      if (!cur) return false;
      if (k === SESSION_KEY) { cur.userId = v && v.userId; cur.out.identity = true; return true; }
      if (k === PENDING_KEY) { cur.pending = v && v.userId; cur.out.identity = true; return true; }
      if (k === RATE_KEY) { rate.set(cur.ip, v); return true; }
      if (!state.has(k)) return true; // preferences and such have no meaning on the server
      draft.set(k, v);
      return true;
    },
  };
  const localStorage = {
    getItem(k) {
      if (!cur) return null;
      if (k === LIBRARY_KEY) return cur.library;
      if (k === LANG_KEY) return cur.lang;
      return null;
    },
    setItem(k, v) { if (cur && k === LIBRARY_KEY) cur.library = String(v); },
    removeItem(k) {
      if (!cur) return;
      if (k === SESSION_KEY) { cur.userId = null; cur.out.identity = true; return; }
      if (k === PENDING_KEY) { cur.pending = null; cur.out.identity = true; return; }
      if (state.has(k)) draft.set(k, isArrayKey(k) ? [] : null);
    },
    key: () => null, get length() { return 0; },
  };
  const sessionStorage = {
    getItem(k) {
      if (!cur) return null;
      if (k === STAFF_KEY) return cur.staff ? JSON.stringify({ ...cur.staff, at: Date.now() }) : null;
      if (k === CERT_KEY) return JSON.stringify(cur.unlocked || []);
      return null;
    },
    setItem(k, v) {
      if (!cur) return;
      if (k === STAFF_KEY) { const o = JSON.parse(v); if (o) delete o.at; cur.staff = o; cur.out.identity = true; }
      if (k === CERT_KEY) { const a = JSON.parse(v); cur.unlocked = Array.isArray(a) ? a.slice(-50) : []; cur.out.unlocked = true; }
    },
    removeItem(k) {
      if (!cur) return;
      if (k === STAFF_KEY) { cur.staff = null; cur.out.identity = true; }
      if (k === CERT_KEY) { cur.unlocked = []; cur.out.unlocked = true; }
    },
    key: () => null, get length() { return 0; },
  };
  const response = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
  async function serverFetch(url, opts = {}) {
    if (url === "/api/health") return response({ ok: true, ...channels() });
    if (url === "/api/notify") { try { return response(await notify(JSON.parse(opts.body))); } catch (e) { return { ok: false, status: 500, json: async () => ({ error: e.message }) }; } }
    throw new Error("The rules engine has no network access.");
  }

  const sandbox = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, queueMicrotask,
    TextEncoder, TextDecoder, URL, Intl, structuredClone, atob, btoa,
    crypto: webcrypto, localStorage, sessionStorage, fetch: serverFetch,
    addEventListener: () => {}, removeEventListener: () => {},
    location: { protocol: "https:", hostname: "server", href: "https://server/" },
    document: { querySelector: () => null, querySelectorAll: () => [], body: { classList: { contains: () => false } }, documentElement: {} },
    navigator: { userAgent: "server" },
    I18N: { get lang() { return cur ? cur.lang : "en"; }, t: (s) => s },
    LF_SERVER: true, LF_PASSWORDS: passwords, LF_STORE,
    get LF_DEVICE() { return cur ? cur.ip : "server"; },
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox, { name: "qcpl-rules", codeGeneration: { strings: false, wasm: false } });
  const code = ["js/data.js", "js/messages.js", "js/store.js", "js/xlsx.js"].map((f) => readFileSync(path.join(root, f), "utf8")).join("\n;\n")
    // Built-in demo administrator accounts (in data.js, which is a public file) never work on the server
    + "\n;STAFF_ACCOUNTS.length = 0; window.LF = LF; window.__resetLibrary = () => { LIBRARY_MEMORY = null; LIBRARY_OVERRIDE = null; };";
  vm.runInContext(code, context, { filename: "rules.js", timeout: 5000 });
  const LF = sandbox.LF;

  /* ---------- one action at a time ---------- */
  let queue = Promise.resolve();
  let version = 1; // goes up whenever data is saved
  const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };

  function begin(ctx) {
    cur = { ...ctx, unlocked: [...(ctx.unlocked || [])], out: {} };
    draft = new Map(); touched = new Set();
    sandbox.__resetLibrary();
    LF._resetCaches();
  }
  function end() { cur = null; draft = null; touched = null; LF._resetCaches(); }

  /* Put lists back exactly as last saved (after a failed action: undoes changes made in place) */
  function restore(keys) {
    for (const key of keys) {
      const s = state.get(key);
      if (!s) continue;
      if (isArrayKey(key)) {
        const order = [...s.ords.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
        s.value = order.map((id) => JSON.parse(s.rows.get(id)));
      } else s.value = s.json ? JSON.parse(s.json) : null;
    }
  }

  /* Save the draft in one transaction; returns which records changed.
     With Supabase (store.cloud) the records are saved there FIRST; if that fails nothing changes. */
  async function commit(onlyKeys) {
    const changes = {};
    const keys = [...draft.keys()].filter((k) => !onlyKeys || onlyKeys.includes(k));
    if (!keys.length) return changes;
    const t = Date.now(), plan = [], next = new Map();
    for (const key of keys) {
      const value = draft.get(key), before = state.get(key);
      if (isArrayKey(key)) {
        const list = Array.isArray(value) ? value : [];
        const rows = new Map(), order = [], recs = [], ch = { upserted: [], removed: [] };
        list.forEach((rec, i) => {
          const id = idOf(rec, i);
          if (rows.has(id)) return; // keep the first copy of a duplicate id
          rows.set(id, JSON.stringify(rec)); order.push(id); recs.push(rec);
        });
        /* Positions: rows keep their stored position number whenever the order allows, so adding
           an item at the front (newest first) writes one row, not every row after it */
        const ords = new Map(), oldOrd = before.ords;
        let last = -Infinity, renumber = false;
        for (let i = 0; i < order.length; i++) {
          const id = order[i], old = oldOrd.get(id);
          if (old !== undefined && old > last) { ords.set(id, old); last = old; continue; }
          let nextOld; for (let j = i + 1; j < order.length; j++) { const o = oldOrd.get(order[j]); if (o !== undefined && o > last) { nextOld = o; break; } }
          const ord = nextOld === undefined ? (last === -Infinity ? 0 : last + 1) : last === -Infinity ? nextOld - 1 : (last + nextOld) / 2;
          if (!(ord > last) || (nextOld !== undefined && !(ord < nextOld))) { renumber = true; break; }
          ords.set(id, ord); last = ord;
        }
        if (renumber) { ords.clear(); order.forEach((id, i) => ords.set(id, i)); }
        order.forEach((id, i) => {
          const json = rows.get(id);
          if (before.rows.get(id) !== json) { plan.push(["upsert", key, id, recs[i], ords.get(id)]); ch.upserted.push(id); }
          else if (oldOrd.get(id) !== ords.get(id)) plan.push(["ord", key, id, ords.get(id)]);
        });
        for (const id of before.rows.keys()) if (!rows.has(id)) { plan.push(["delete", key, id]); ch.removed.push(id); }
        next.set(key, { value: recs, rows, ords });
        if (ch.upserted.length || ch.removed.length) changes[key] = ch;
      } else {
        const json = value == null ? null : JSON.stringify(value);
        if (json !== before.json) plan.push(json == null ? ["kvdel", key] : ["kv", key, json]);
        next.set(key, { value: json == null ? null : value, json });
      }
    }
    if (store.cloud) {
      try { await store.cloud.applyPlan(plan, t); } // fails → the action fails and nothing is kept
      catch (e) {
        console.error("Supabase save failed:", e.message);
        throw Object.assign(new Error("This couldn't be saved right now because the database can't be reached. Please try again in a minute."), { status: 503 });
      }
    }
    try {
    store.tx(() => {
      for (const p of plan) {
        if (p[0] === "upsert") store.rows.upsert(p[1], p[2], p[4], p[3], t);
        else if (p[0] === "ord") store.rows.ord(p[1], p[2], p[3]);
        else if (p[0] === "delete") store.rows.del(p[1], p[2]);
        else if (p[0] === "kv") store.q.kvPut.run(p[1], p[2], t);
        else store.q.kvDelete.run(p[1]);
      }
    });
    } catch (e) {
      // Supabase already has it: the local working copy is refreshed from there at the next start
      if (!store.cloud) throw e;
      console.error("Local copy not updated (Supabase has the change):", e.message);
    }
    // Only after the database has it: the new values become the current ones
    for (const [key, v] of next) state.set(key, v);
    if (plan.length) version++;
    return changes;
  }

  /* After an action: any list it read but did not save must still match what is saved
     (a rule that changes a record in place without saving would otherwise go unnoticed) */
  function settleTouched() {
    if (!strict) return; // a full check after every action costs time; it runs in testing (STRICT_CHECKS=1)
    for (const key of touched) {
      if (draft.has(key) || !isArrayKey(key)) continue;
      const s = state.get(key);
      if (s.value.length !== s.rows.size || s.value.some((r, i) => s.rows.get(idOf(r, i)) !== JSON.stringify(r))) { console.error("Rules changed " + key + " without saving it — put back."); restore([key]); }
    }
  }

  /** Runs one of the rules' actions for a visitor. ctx: { ip, library, lang, userId, staff, pending, unlocked } */
  function run(name, args, ctx, { before, after } = {}) {
    return serial(async () => {
      begin(ctx);
      try {
        if (typeof LF[name] !== "function") throw Object.assign(new Error("Unknown action."), { status: 400 });
        if (before) await before(LF, cur);
        const result = await LF[name](...args);
        if (after) await after(LF, cur, result);
        let changes;
        try { changes = await commit(); } catch (e) { e.saveFailed = true; throw e; }
        settleTouched();
        return { result, changes, identity: { userId: cur.userId || null, staff: cur.staff || null, pending: cur.pending || null, unlocked: cur.unlocked, library: cur.library }, flags: cur.out };
      } catch (err) {
        // Keep only the wrong-try counters; put everything else back as it was
        const keys = new Set([...(touched || []), ...(draft ? draft.keys() : [])]);
        if (draft) { try { await commit(KEEP_ON_FAILURE); } catch {} }
        restore([...keys].filter((k) => !KEEP_ON_FAILURE.includes(k) || !draft || !draft.has(k)));
        throw err;
      } finally { end(); }
    });
  }
  /** Server jobs (setup, reminders): fn(LF, LF_STORE) may change data; saved like an action */
  function exec(ctx, fn) {
    return serial(async () => {
      begin(ctx);
      try { const result = await fn(LF, LF_STORE); const changes = await commit(); settleTouched(); return { result, changes }; }
      catch (err) { restore([...touched, ...draft.keys()]); throw err; }
      finally { end(); }
    });
  }
  /** Reads with the rules (nothing is saved) */
  function read(ctx, fn) {
    return serial(async () => {
      begin(ctx);
      try { return await fn(LF, cur); } finally { if (draft.size) restore([...draft.keys()]); settleTouched(); end(); }
    });
  }

  // Anti-spam counters older than a day are forgotten
  setInterval(() => { for (const [ip, o] of rate) { const fresh = Object.values(o || {}).some((a) => (a || []).some((t) => Date.now() - t < 86_400_000)); if (!fresh) rate.delete(ip); } }, 3600_000).unref();
  return { run, exec, read, snapshot, LF, sandbox, demoCodes, get version() { return version; } };
}
