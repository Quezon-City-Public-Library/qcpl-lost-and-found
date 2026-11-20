/* ==========================================================================
   Supabase: the database (Postgres) and photo storage in the cloud.

   Turned on by SUPABASE_DB_URL (and SUPABASE_URL + SUPABASE_SERVICE_KEY for
   photos) in server/.env — set up with "Move the database to Supabase.bat".

   How it works
   - Supabase holds the real data. Every change is saved there FIRST (in one
     transaction); only then is it kept, so nothing is lost if this computer or
     the host's disk is wiped.
   - The server keeps a working copy in its own qcpl.db, filled from Supabase at
     every start. The rules, backups and reports keep working the same way.
   - Everything is in a private schema "qcpl", which Supabase's public website
     API does not serve, with row level security on and no access for the
     public roles. Only this server (with the database password) can read it.
   - Photos are in a private Storage bucket; their owners are in qcpl.photos.
   - Only ONE server may use the database at a time (a "lease" in qcpl.meta).
   ========================================================================== */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { TABLES, encode } from "./schema.mjs";

const require = createRequire(import.meta.url);
const S = "qcpl";
const PGTYPE = { text: "text", int: "integer", real: "double precision", bool: "boolean" };
export const BUCKET = "qcpl-photos";
const LEASE_SECONDS = 90;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

export function cloudConfigured(env) { return !!env.SUPABASE_DB_URL; }

export function createCloud({ env, log = console.log }) {
  const pg = require("pg");
  // Keep values exactly as saved: JSON stays text (key order kept), 64-bit numbers become numbers
  const types = { getTypeParser: (oid, fmt) => (oid === 114 ? (v) => v : oid === 20 ? (v) => Number(v) : pg.types.getTypeParser(oid, fmt)) };
  const url = env.SUPABASE_DB_URL;
  const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
  const ssl = local ? false : env.SUPABASE_CA_FILE ? { ca: readFileSync(env.SUPABASE_CA_FILE, "utf8"), rejectUnauthorized: true } : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString: url, ssl, types, max: Number(env.SUPABASE_POOL_MAX || 4), connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000 });
  pool.on("error", (e) => log("Supabase connection problem:", e.message));
  const storageUrl = (env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_KEY || "";
  const me = `${os.hostname()}:${process.pid}:${randomBytes(4).toString("hex")}`;
  let beat = null;

  const tx = async (fn) => {
    const c = await pool.connect();
    try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
    catch (e) { try { await c.query("ROLLBACK"); } catch {} throw e; }
    finally { c.release(); }
  };
  const cols = (t) => ["id", "library", ...t.cols.map((c) => c[1]), "extra", "ord", "saved_at"];
  const boolCols = (t) => new Set(t.cols.filter((c) => c[2] === "bool").map((c) => c[1]));

  /* ---------- tables (same layout as the local copy, see schema.mjs) ---------- */
  async function ensureSchema() {
    const ddl = [`CREATE SCHEMA IF NOT EXISTS ${S}`,
      `CREATE TABLE IF NOT EXISTS ${S}.meta (key text PRIMARY KEY, value text NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS ${S}.photos (id text PRIMARY KEY, mime text NOT NULL, size integer NOT NULL, sha text NOT NULL, owner_key text, owner_id text, created bigint NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS photos_owner ON ${S}.photos (owner_key, owner_id)`];
    for (const t of Object.values(TABLES)) {
      ddl.push(`CREATE TABLE IF NOT EXISTS ${S}.${t.table} (
        id text PRIMARY KEY, library text,
        ${t.cols.map(([, col, type]) => `${col} ${PGTYPE[type]}`).join(", ")},
        extra json NOT NULL DEFAULT '{}', ord double precision NOT NULL DEFAULT 0, saved_at bigint NOT NULL)`);
      ddl.push(`CREATE INDEX IF NOT EXISTS ix_${t.table}_library ON ${S}.${t.table} (library)`);
      for (const ix of t.indexes) ddl.push(`CREATE INDEX IF NOT EXISTS ix_${t.table}_${ix.join("_")} ON ${S}.${t.table} (${ix.join(", ")})`);
    }
    ddl.push(...VIEWS_PG);
    // Lock it: row level security on every table, and no rights at all for Supabase's public roles
    const all = ["meta", "photos", ...Object.values(TABLES).map((t) => t.table)];
    for (const t of all) ddl.push(`ALTER TABLE ${S}.${t} ENABLE ROW LEVEL SECURITY`);
    ddl.push(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON SCHEMA ${S} FROM anon, authenticated'; EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ${S} FROM anon, authenticated'; END IF;
      EXECUTE 'REVOKE ALL ON SCHEMA ${S} FROM PUBLIC';
    END $$`);
    await tx(async (c) => { for (const q of ddl) await c.query(q); });
  }

  const meta = async (k) => ((await pool.query(`SELECT value FROM ${S}.meta WHERE key = $1`, [k])).rows[0] || {}).value;
  const setMeta = (c, k, v) => c.query(`INSERT INTO ${S}.meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [k, v]);
  async function isInitialized() { try { return !!(await meta("initialized")); } catch { return false; } }

  /* ---------- one server at a time ---------- */
  async function acquireLease({ force = false } = {}) {
    await tx(async (c) => {
      const row = (await c.query(`SELECT value FROM ${S}.meta WHERE key = 'lease' FOR UPDATE`)).rows[0];
      const cur = row ? JSON.parse(row.value) : null;
      // The same computer whose previous server process is gone (e.g. it crashed and was restarted) may take over at once
      const sameHostGone = cur && cur.host === os.hostname() && cur.pid && !alive(cur.pid);
      if (cur && cur.id !== me && Date.now() - cur.at < LEASE_SECONDS * 1000 && !force && !sameHostGone)
        throw Object.assign(new Error(`Another server is using this Supabase database right now (${cur.host}). Only one server may use it at a time. Stop the other one, or wait ${LEASE_SECONDS} seconds after it stopped.`), { lease: true });
      await setMeta(c, "lease", JSON.stringify({ id: me, host: os.hostname(), pid: process.pid, at: Date.now() }));
    });
    clearInterval(beat);
    beat = setInterval(() => pool.query(`UPDATE ${S}.meta SET value = $1 WHERE key = 'lease'`, [JSON.stringify({ id: me, host: os.hostname(), pid: process.pid, at: Date.now() })]).catch(() => {}), 30_000);
    beat.unref();
  }
  async function releaseLease() {
    clearInterval(beat);
    try { await pool.query(`DELETE FROM ${S}.meta WHERE key = 'lease' AND value::json->>'id' = $1`, [me]); } catch {}
  }

  /* ---------- rows ---------- */
  const upsertSql = (t) => { const c = cols(t); return `INSERT INTO ${S}.${t.table} (${c.join(", ")}) VALUES (${c.map((_, i) => "$" + (i + 1)).join(", ")}) ON CONFLICT (id) DO UPDATE SET ${c.slice(1).map((x) => `${x} = excluded.${x}`).join(", ")}`; };
  const rowValues = (t, row) => { const b = boolCols(t); return cols(t).map((c) => (b.has(c) ? (row[c] == null ? null : row[c] === 1 || row[c] === true) : row[c] === undefined ? null : row[c])); };
  const recRow = (key, id, ord, rec, t) => { const tb = TABLES[key], { values, extra } = encode(key, rec);
    return { id, library: typeof rec.library === "string" ? rec.library : null, ...Object.fromEntries(tb.cols.map((c) => [c[1], c[1] in values ? values[c[1]] : null])), extra, ord, saved_at: t }; };

  /** The engine's save plan: [["upsert", key, id, rec, ord] | ["ord", key, id, ord] | ["delete", key, id]] — all or nothing */
  async function applyPlan(plan, t) {
    const ops = plan.filter((p) => TABLES[p[1]] && ["upsert", "ord", "delete"].includes(p[0]));
    if (!ops.length) return;
    await tx(async (c) => {
      for (const p of ops) {
        const tb = TABLES[p[1]];
        if (p[0] === "upsert") await c.query(upsertSql(tb), rowValues(tb, recRow(p[1], p[2], p[4], p[3], t)));
        else if (p[0] === "ord") await c.query(`UPDATE ${S}.${tb.table} SET ord = $1 WHERE id = $2`, [p[3], p[2]]);
        else await c.query(`DELETE FROM ${S}.${tb.table} WHERE id = $1`, [p[2]]);
      }
    });
  }

  /** Supabase → the local working copy (records and photo details; photo bytes come when first needed) */
  async function pullInto(store) {
    const data = {};
    for (const [key, t] of Object.entries(TABLES)) data[key] = (await pool.query(`SELECT * FROM ${S}.${t.table} ORDER BY ord, id`)).rows;
    const photos = (await pool.query(`SELECT * FROM ${S}.photos`)).rows;
    const db = store.db;
    store.tx(() => {
      for (const [key, t] of Object.entries(TABLES)) {
        db.exec(`DELETE FROM ${t.table}`);
        const c = cols(t), b = boolCols(t);
        const ins = db.prepare(`INSERT INTO ${t.table} (${c.join(", ")}) VALUES (${c.map(() => "?").join(", ")})`);
        for (const r of data[key]) ins.run(...c.map((x) => (b.has(x) ? (r[x] == null ? null : r[x] ? 1 : 0) : r[x] === undefined ? null : r[x])));
      }
      const have = new Map(db.prepare("SELECT id, sha, length(bytes) n FROM photos").all().map((r) => [r.id, r]));
      const keep = new Set(photos.map((p) => p.id));
      for (const id of have.keys()) if (!keep.has(id)) db.prepare("DELETE FROM photos WHERE id = ?").run(id);
      const put = db.prepare(`INSERT INTO photos (id, mime, bytes, size, sha, owner_key, owner_id, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET mime = excluded.mime, size = excluded.size, sha = excluded.sha, owner_key = excluded.owner_key, owner_id = excluded.owner_id`);
      for (const p of photos) {
        const h = have.get(p.id);
        if (h && h.sha === p.sha) db.prepare("UPDATE photos SET owner_key = ?, owner_id = ? WHERE id = ?").run(p.owner_key, p.owner_id, p.id);
        else put.run(p.id, p.mime, Buffer.alloc(0), p.size, p.sha, p.owner_key, p.owner_id, p.created); // bytes fetched when first shown
      }
    });
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
  }

  /** The local copy → Supabase, replacing what is there (first move, and after a restore) */
  async function pushAll(store, { onProgress = () => {} } = {}) {
    const db = store.db, counts = {};
    await tx(async (c) => {
      for (const [key, t] of Object.entries(TABLES)) {
        await c.query(`DELETE FROM ${S}.${t.table}`);
        const rows = db.prepare(`SELECT * FROM ${t.table}`).all();
        for (const r of rows) await c.query(upsertSql(t), rowValues(t, r));
        counts[key.replace("qcpllf_", "")] = rows.length;
        onProgress(`${t.table}: ${rows.length}`);
      }
      await c.query(`DELETE FROM ${S}.photos`);
      const photos = db.prepare("SELECT id, mime, size, sha, owner_key, owner_id, created FROM photos").all();
      for (const p of photos) await c.query(`INSERT INTO ${S}.photos (id, mime, size, sha, owner_key, owner_id, created) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [p.id, p.mime, p.size, p.sha, p.owner_key, p.owner_id, p.created]);
      counts.photos = photos.length;
      await setMeta(c, "initialized", new Date().toISOString());
      await setMeta(c, "schema", "2");
    });
    // Photo files (only the ones Storage doesn't have yet)
    let uploaded = 0;
    const ids = db.prepare("SELECT id FROM photos WHERE length(bytes) > 0").all().map((r) => r.id);
    for (const id of ids) {
      const row = db.prepare("SELECT mime, bytes FROM photos WHERE id = ?").get(id);
      if (!(await storageHas(id))) { await storagePut(id, row.mime, row.bytes); uploaded++; }
      if (uploaded && uploaded % 25 === 0) onProgress(`photos uploaded: ${uploaded}`);
    }
    counts.photoFilesUploaded = uploaded;
    return counts;
  }

  async function counts() {
    const out = {};
    for (const [key, t] of Object.entries(TABLES)) out[key.replace("qcpllf_", "")] = Number((await pool.query(`SELECT COUNT(*) n FROM ${S}.${t.table}`)).rows[0].n);
    out.photos = Number((await pool.query(`SELECT COUNT(*) n FROM ${S}.photos`)).rows[0].n);
    return out;
  }

  /* ---------- photos (Storage) ---------- */
  // New "secret" keys (sb_secret_…) go in the apikey header only; older service_role keys (JWT, eyJ…) also as Bearer
  const sHead = (extra = {}) => ({ apikey: key, ...(/^eyJ/.test(key) ? { Authorization: `Bearer ${key}` } : {}), ...extra });
  const objUrl = (id) => `${storageUrl}/storage/v1/object/${BUCKET}/${id}`;
  function needStorage() { if (!storageUrl || !key) throw new Error("Photo storage isn't set up (SUPABASE_URL and SUPABASE_SERVICE_KEY)."); }
  async function ensureBucket() {
    needStorage();
    const r = await fetch(`${storageUrl}/storage/v1/bucket/${BUCKET}`, { headers: sHead() });
    if (r.ok) { const b = await r.json().catch(() => ({})); if (b.public) throw new Error(`The Storage bucket "${BUCKET}" is public. Make it private in Supabase (Storage → bucket settings).`); return; }
    const c = await fetch(`${storageUrl}/storage/v1/bucket`, { method: "POST", headers: sHead({ "Content-Type": "application/json" }), body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 700 * 1024, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] }) });
    if (!c.ok) throw new Error(`Couldn't create the photo bucket: ${c.status} ${(await c.text()).slice(0, 200)}`);
  }
  async function storageHas(id) { needStorage(); const r = await fetch(objUrl(id), { method: "HEAD", headers: sHead() }); return r.ok; }
  async function storagePut(id, mime, bytes) {
    needStorage();
    const r = await fetch(objUrl(id), { method: "POST", headers: sHead({ "Content-Type": mime, "x-upsert": "true" }), body: bytes });
    if (!r.ok) throw new Error(`Photo upload failed: ${r.status} ${(await r.text()).slice(0, 160)}`);
  }
  async function fetchPhoto(id) {
    needStorage();
    const r = await fetch(objUrl(id), { headers: sHead() });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  }
  /** New photos (already checked and saved locally): the file to Storage, the details to qcpl.photos */
  async function uploadPhotos(store, ids) {
    for (const id of ids) {
      const row = store.db.prepare("SELECT id, mime, bytes, size, sha, owner_key, owner_id, created FROM photos WHERE id = ?").get(id);
      if (!row) continue;
      await storagePut(id, row.mime, row.bytes);
      await pool.query(`INSERT INTO ${S}.photos (id, mime, size, sha, owner_key, owner_id, created) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`, [row.id, row.mime, row.size, row.sha, row.owner_key, row.owner_id, row.created]);
    }
  }
  async function setPhotoOwners(store, ids) {
    for (const id of ids) {
      const row = store.db.prepare("SELECT owner_key, owner_id FROM photos WHERE id = ?").get(id);
      if (row) await pool.query(`UPDATE ${S}.photos SET owner_key = $1, owner_id = $2 WHERE id = $3`, [row.owner_key, row.owner_id, id]);
    }
  }
  async function deletePhotos(ids) {
    if (!ids.length) return;
    await pool.query(`DELETE FROM ${S}.photos WHERE id = ANY($1)`, [ids]);
    if (storageUrl && key) {
      const r = await fetch(`${storageUrl}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: sHead({ "Content-Type": "application/json" }), body: JSON.stringify({ prefixes: ids }) });
      if (!r.ok) log("Photo delete in Storage failed:", r.status);
    }
  }
  /** Before a backup: every photo's bytes are fetched, so the backup is complete */
  async function cacheAllPhotos(store) {
    let n = 0;
    for (const { id } of store.db.prepare("SELECT id FROM photos WHERE length(bytes) = 0").all()) {
      const b = await fetchPhoto(id);
      if (b) { store.db.prepare("UPDATE photos SET bytes = ? WHERE id = ?").run(b, id); n++; }
    }
    return n;
  }

  return { ensureSchema, isInitialized, acquireLease, releaseLease, applyPlan, pullInto, pushAll, counts, ensureBucket, uploadPhotos, setPhotoOwners, deletePhotos, fetchPhoto, cacheAllPhotos,
    region: env.SUPABASE_REGION || "", close: async () => { await releaseLease(); await pool.end(); } };
}

/* The same ready-made views as the local copy (schema.mjs), written for Postgres. They run with the
   rights of the person asking (security_invoker), so they can't be used to get around the locks. */
const ACTIVE_LOST = "('reported','searching','possible-match')";
const V = (name, body) => [`DROP VIEW IF EXISTS ${S}.${name}`, `CREATE VIEW ${S}.${name} WITH (security_invoker = true) AS ${body}`];
const VIEWS_PG = [
  ...V("v_users", `SELECT id, library, name, phone, email, role, member_id, id_checked, mobile_confirmed, active, created_at FROM ${S}.users`),
  ...V("v_staff", `SELECT id, library, username, name, role, active, temporary_password, created_at, created_by FROM ${S}.staff_accounts`),
  ...V("v_open_lost_reports", `SELECT id, library, created_at, date_lost, item_name, category, brand, color, place, status, owner_name, phone FROM ${S}.lost_reports WHERE status IN ${ACTIVE_LOST}`),
  ...V("v_items_at_office", `SELECT id, library, date_found, item_name, category, color, place, kept_at, status, (CURRENT_DATE - NULLIF(date_found, '')::date) AS days_kept FROM ${S}.found_items WHERE status IN ('recorded','possible-owner','claimed')`),
  ...V("v_claims_with_items", `SELECT c.id AS claim_id, c.library, c.created_at AS claimed_at, c.status AS claim_status, c.claimant_name, c.phone AS claimant_phone,
     f.id AS found_item_id, f.item_name AS found_item, f.status AS found_status, l.id AS lost_report_id, l.item_name AS lost_item
     FROM ${S}.claims c LEFT JOIN ${S}.found_items f ON f.id = c.found_item_id LEFT JOIN ${S}.lost_reports l ON l.id = c.lost_report_id`),
  ...V("v_returned_items", `SELECT id, library, item_name, category, finder_name, extra->'release'->>'releasedTo' AS released_to, extra->'release'->>'idType' AS id_shown,
     extra->'release'->>'at' AS released_at, extra->'release'->>'by' AS released_by FROM ${S}.found_items WHERE status = 'returned'`),
  ...V("v_status_history", `SELECT 'lost' AS kind, r.id, r.library, h->>'status' AS status, h->>'at' AS at, h->>'by' AS by, h->>'note' AS note FROM ${S}.lost_reports r, json_array_elements(CASE WHEN json_typeof(r.extra->'history') = 'array' THEN r.extra->'history' ELSE '[]'::json END) h
     UNION ALL SELECT 'found', r.id, r.library, h->>'status', h->>'at', h->>'by', h->>'note' FROM ${S}.found_items r, json_array_elements(CASE WHEN json_typeof(r.extra->'history') = 'array' THEN r.extra->'history' ELSE '[]'::json END) h
     UNION ALL SELECT 'claim', r.id, r.library, h->>'status', h->>'at', h->>'by', h->>'note' FROM ${S}.claims r, json_array_elements(CASE WHEN json_typeof(r.extra->'history') = 'array' THEN r.extra->'history' ELSE '[]'::json END) h`),
  ...V("v_monthly_summary", `SELECT library, month, SUM(lost) AS lost_reports, SUM(found) AS found_items, SUM(returned) AS returned_to_owner FROM (
       SELECT library, substr(created_at, 1, 7) AS month, 1 AS lost, 0 AS found, 0 AS returned FROM ${S}.lost_reports
       UNION ALL SELECT library, substr(created_at, 1, 7), 0, 1, 0 FROM ${S}.found_items
       UNION ALL SELECT library, substr(extra->'release'->>'at', 1, 7), 0, 0, 1 FROM ${S}.found_items WHERE status = 'returned'
     ) x GROUP BY library, month ORDER BY month DESC, library`),
];
