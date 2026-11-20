import { openDb } from "../../server/backend/db.mjs";
import { TABLES } from "../../server/backend/schema.mjs";
import { DatabaseSync } from "node:sqlite";
import { rmSync, mkdtempSync, readdirSync } from "node:fs";
import os from "node:os"; import path from "node:path";
let pass = 0, fail = 0; const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n, c ? "" : x); };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const dir = mkdtempSync(path.join(os.tmpdir(), "qsql-"));
// 1) random round-trip: odd types in every column
const odd = [null, 0, -3, 2.5, 1e300, "", "x'; DROP TABLE users; --", "ñ 日本 😀", true, false, [1, { a: null }], { nested: { deep: [1, 2] } }, "2026-10-19T00:00:00.000Z", 42];
const s = openDb(path.join(dir, "a.db"));
const want = {};
let n = 0;
for (const [key, t] of Object.entries(TABLES)) {
  want[key] = [];
  for (let i = 0; i < 60; i++) {
    const rec = { id: `${key}-${i}` };
    if (i % 3) rec.library = i % 2 ? "QCPL Main" : 7;
    for (const [f] of t.cols) if ((i + f.length) % 4) rec[f] = odd[(i * 7 + f.length) % odd.length];
    rec.history = [{ status: "reported", at: "2026-10-01" }, { status: "claimed", at: "2026-10-02" }];
    rec["weird key with 'quotes'"] = i;
    s.rows.upsert(key, rec.id, i + 0.5, rec, Date.now()); want[key].push(rec); n++;
  }
}
let same = true, bad = "";
for (const key of Object.keys(TABLES)) {
  const got = s.rows.load(key);
  if (got.length !== want[key].length) { same = false; bad = key + " count"; }
  got.forEach((g, i) => { if (canon(g.rec) !== canon(want[key][i]) || g.ord !== i + 0.5) { same = false; bad = bad || `${key} #${i}: ${canon(g.rec)} vs ${canon(want[key][i])}`; } });
}
ok(`${n} records with tricky values come back exactly`, same, bad);
ok("users table survives SQL-looking text", s.db.prepare("SELECT COUNT(*) n FROM users").get().n === 60);
s.rows.del("qcpllf_lost", "qcpllf_lost-0"); s.rows.ord("qcpllf_lost", "qcpllf_lost-1", 99);
const l = s.rows.load("qcpllf_lost");
ok("delete and reorder work", l.length === 59 && l[l.length - 1].id === "qcpllf_lost-1");
for (const v of ["v_users","v_staff","v_open_lost_reports","v_items_at_office","v_claims_with_items","v_returned_items","v_status_history","v_monthly_summary"]) {
  try { s.db.prepare(`SELECT * FROM ${v} LIMIT 5`).all(); ok("view " + v + " works", true); } catch (e) { ok("view " + v, false, e.message); }
}
ok("status history view reads JSON history", s.db.prepare("SELECT COUNT(*) n FROM v_status_history").get().n > 0);
s.db.close();
// 2) upgrade from version 1 (docs table)
const old = new DatabaseSync(path.join(dir, "v1.db"));
old.exec(`CREATE TABLE docs (key TEXT NOT NULL, id TEXT NOT NULL, library TEXT, ord REAL NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (key, id));
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('schema','1');`);
const ins = old.prepare("INSERT INTO docs VALUES (?,?,?,?,?,?)");
const v1 = [];
for (const [key] of Object.entries(TABLES)) for (let i = 0; i < 25; i++) { const r = { id: key + i, library: "Main", status: "reported", name: "Juan " + i, createdAt: "2026-10-0" + (1 + (i % 9)), passHash: "scrypt$32768$8$1$x", history: [{ status: "reported" }] }; ins.run(key, r.id, "Main", i, JSON.stringify(r), 1); v1.push([key, r]); }
old.close();
let copies = 0;
const up = openDb(path.join(dir, "v1.db"), { onBeforeUpgrade(db) { copies++; db.exec(`VACUUM INTO '${path.join(dir, "qcpl-x-before-sql-upgrade.db").replace(/'/g, "''")}'`); } });
ok("old database upgraded", up.upgraded && copies === 1);
ok("safety copy made before upgrade", readdirSync(dir).includes("qcpl-x-before-sql-upgrade.db"));
ok("all old records moved", v1.every(([key, r]) => up.rows.load(key).some((g) => canon(g.rec) === canon(r))));
ok("docs table removed", !up.db.prepare("SELECT name FROM sqlite_master WHERE name='docs'").get());
ok("schema is 2", up.db.prepare("SELECT value FROM meta WHERE key='schema'").get().value === "2");
up.db.close();
const again = openDb(path.join(dir, "v1.db"), { onBeforeUpgrade() { copies++; } });
ok("second start doesn't upgrade again", !again.upgraded && copies === 1);
again.db.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
