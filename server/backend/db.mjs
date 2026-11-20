/* ==========================================================================
   Database (SQLite, built into Node — nothing to install).

   One file: qcpl.db (plus -wal/-shm working files) in the data folder.

   Tables (see schema.mjs for every column)
     lost_reports, found_items, claims, users, staff_accounts, notifications,
     activity_log, feedback, contribution_certificates   — one row per record
     photos     the photos of reports
     sessions   who is signed in (only a hash of the cookie is stored)
     kv         security counters (password-reset codes, sign-in lockouts…)
     meta       database version
   Views (v_…) give ready-made reports. Every query uses placeholders (?),
   never text pasted into SQL.

   Version 1 kept every record as JSON in one "docs" table. On first start the
   data is moved into the tables above, in one transaction, after a safety copy.
   ========================================================================== */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { TABLES, ddl, encode, decode } from "./schema.mjs";

export const SCHEMA_VERSION = 2;

/** onBeforeUpgrade(db): called once before the data is moved to the new tables (to make a safety copy) */
export function openDb(file, { onBeforeUpgrade } = {}) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, json TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires);
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL, size INTEGER NOT NULL, sha TEXT NOT NULL,
      owner_key TEXT, owner_id TEXT, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS photos_owner ON photos (owner_key, owner_id);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  for (const stmt of ddl()) db.exec(stmt);

  const tx = (fn) => { db.exec("BEGIN IMMEDIATE"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };

  /* ---------- records: one table per kind ---------- */
  const st = {};
  for (const [key, t] of Object.entries(TABLES)) {
    const cols = ["id", "library", ...t.cols.map((c) => c[1]), "extra", "ord", "saved_at"];
    st[key] = {
      cols: t.cols.map((c) => c[1]),
      all: db.prepare(`SELECT * FROM ${t.table} ORDER BY ord, rowid`),
      upsert: db.prepare(`INSERT INTO ${t.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
        ON CONFLICT (id) DO UPDATE SET ${cols.slice(1).map((c) => `${c} = excluded.${c}`).join(", ")}`),
      ord: db.prepare(`UPDATE ${t.table} SET ord = ? WHERE id = ?`),
      del: db.prepare(`DELETE FROM ${t.table} WHERE id = ?`),
      count: db.prepare(`SELECT COUNT(*) n FROM ${t.table}`),
    };
  }
  const rows = {
    /** Every record of one kind, in order: [{ id, ord, rec }] */
    load(key) { return st[key].all.all().map((r) => ({ id: r.id, ord: r.ord, rec: decode(key, r) })); },
    upsert(key, id, ord, rec, t) {
      const { values, extra } = encode(key, rec);
      const s = st[key];
      s.upsert.run(id, typeof rec.library === "string" ? rec.library : null, ...s.cols.map((c) => (c in values ? values[c] : null)), extra, ord, t);
    },
    ord(key, id, ord) { st[key].ord.run(ord, id); },
    del(key, id) { st[key].del.run(id); },
    count(key) { return st[key].count.get().n; },
  };

  /* ---------- upgrade from version 1 (all records as JSON in "docs") ---------- */
  const hasDocs = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'docs'").get();
  if (hasDocs) {
    const n = db.prepare("SELECT COUNT(*) n FROM docs").get().n;
    if (n && onBeforeUpgrade) onBeforeUpgrade(db);
    const now = Date.now();
    tx(() => {
      for (const d of db.prepare("SELECT key, id, ord, json FROM docs ORDER BY key, ord, rowid").all()) {
        if (!TABLES[d.key]) continue;
        rows.upsert(d.key, d.id, d.ord, JSON.parse(d.json), now);
      }
      db.exec("DROP TABLE docs");
      db.prepare("INSERT INTO meta (key, value) VALUES ('upgraded_to_tables', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(new Date().toISOString());
    });
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(String(SCHEMA_VERSION));

  const q = {
    kvAll: db.prepare("SELECT key, json FROM kv"),
    kvPut: db.prepare("INSERT INTO kv (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at"),
    kvDelete: db.prepare("DELETE FROM kv WHERE key = ?"),
    sessGet: db.prepare("SELECT json, seen, expires FROM sessions WHERE id = ?"),
    sessPut: db.prepare("INSERT INTO sessions (id, json, created, seen, expires) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json, seen = excluded.seen, expires = excluded.expires"),
    sessDelete: db.prepare("DELETE FROM sessions WHERE id = ?"),
    sessPurge: db.prepare("DELETE FROM sessions WHERE expires < ?"),
    photoPut: db.prepare("INSERT INTO photos (id, mime, bytes, size, sha, owner_key, owner_id, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    photoGet: db.prepare("SELECT mime, bytes, owner_key, owner_id FROM photos WHERE id = ?"),
    photoOwn: db.prepare("UPDATE photos SET owner_key = ?, owner_id = ? WHERE id = ? AND owner_id IS NULL"),
    photoOrphans: db.prepare("DELETE FROM photos WHERE owner_id IS NULL AND created < ?"),
    photoIds: db.prepare("SELECT id, owner_key, owner_id FROM photos"),
    photoDelete: db.prepare("DELETE FROM photos WHERE id = ?"),
  };
  return { db, q, tx, rows, upgraded: !!hasDocs };
}
