/* ==========================================================================
   Add a head administrator (when nobody can sign in as one).

     Double-click "Add an admin account.bat"   (or: node server/add-admin.mjs)

   Works only on the computer that holds the data, with the site stopped (the
   .bat file stops it first and starts it again afterwards). It asks for a
   username and a name, and makes a one-time temporary password that is shown
   here only. The site asks for a new password at the first sign-in.
   ========================================================================== */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { randomBytes, randomInt } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Same settings as the server (server/.env)
try {
  for (const line of readFileSync(path.join(HERE, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
const env = process.env;
const SYNCED = /[\\/](OneDrive|Dropbox|Google Drive|iCloud)/i.test(HERE);
const DATA_DIR = env.DATA_DIR ? path.resolve(HERE, env.DATA_DIR) : SYNCED && env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "QCPL Lost and Found", "data") : path.resolve(HERE, "data");
const DB = path.join(DATA_DIR, "qcpl.db");
// (exits through exitCode, not process.exit, so open network handles close cleanly on Windows)
const stop = (msg) => { console.log("\n" + msg + "\n"); process.exitCode = 1; throw Object.assign(new Error(msg), { quiet: true }); };
process.on("uncaughtException", (e) => { if (!e.quiet) { console.error(e); process.exitCode = 1; } });

if (!existsSync(DB)) stop("There is no data on this computer yet. Start the site and open http://localhost:" + (env.PORT || 8360) + "/setup instead.");
// The running site keeps the accounts in memory, so it must be stopped while one is added
if (await fetch(`http://127.0.0.1:${env.PORT || 8360}/api/health`).then((r) => r.ok).catch(() => false))
  stop("The site is running. Close its window first (or use \"Add an admin account.bat\", which does it for you).");

const ask = (q) => new Promise((ok) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, (a) => { rl.close(); ok(a.trim()); }); });
const arg = (name) => { const i = process.argv.indexOf("--" + name); return i > 0 ? String(process.argv[i + 1] || "") : ""; };

const { openDb } = await import("./backend/db.mjs");
const { passwords } = await import("./backend/auth.mjs");
const store = openDb(DB);
// With Supabase the accounts live there: start from its latest copy, and save the new account there too
const { cloudConfigured, createCloud } = await import("./backend/cloud.mjs");
const cloud = cloudConfigured(env) ? createCloud({ env, log: () => {} }) : null;
if (cloud) {
  try {
    if (!(await cloud.isInitialized())) stop('The Supabase database is still empty. Run "Move the database to Supabase.bat" first.');
    await cloud.acquireLease(); // also makes sure no other server is using the database right now
    await cloud.pullInto(store);
  } catch (e) { if (e.quiet) throw e; await cloud.close().catch(() => {}); stop("Can't reach the Supabase database: " + e.message); }
}
const KEY = "qcpllf_staffaccts";
const staff = store.rows.load(KEY);

console.log("\nAdd a head administrator (can manage every library)\n");
if (staff.length) console.log("Existing staff usernames: " + staff.map((s) => s.rec.username).join(", ") + "\n");

let username = arg("username").toLowerCase();
for (;;) {
  if (!username) username = (await ask("New username (3-30 letters, numbers, dots or dashes): ")).toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) { console.log("  Please use 3 to 30 letters, numbers, dots or dashes."); username = ""; continue; }
  if (staff.some((s) => String(s.rec.username).toLowerCase() === username)) { console.log("  That username is already used. Please choose another."); username = ""; continue; }
  break;
}
let name = arg("name");
while (!name || name.length > 80) name = await ask("Full name: ");

// One-time password: 16 characters with no look-alikes (0/O, 1/l/I), shown in groups of 4
const ABC = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const temp = Array.from({ length: 16 }, () => ABC[randomInt(ABC.length)]).join("").replace(/(.{4})(?!$)/g, "$1-");

const t = Date.now(), at = new Date(t).toISOString();
const rec = { id: "S" + t + randomBytes(4).toString("hex"), username, name, role: "Supervisor", library: "all",
  passHash: await passwords.hash("lf-staff", temp), active: true, mustChange: true, createdAt: at, createdBy: "Add-admin tool (server computer)" };
const act = store.rows.load("qcpllf_activity");
const aid = "A" + t + randomBytes(3).toString("hex");
const actRec = { id: aid, library: "main", at, actor: "System", action: "Head administrator account added on the server computer", ref: username, detail: name };
const staffOrd = staff.length ? Math.max(...staff.map((s) => s.ord)) + 1 : 1, actOrd = act.length ? Math.min(...act.map((a) => a.ord)) - 1 : 1; // newest first in the log
if (cloud) {
  try { await cloud.applyPlan([["upsert", KEY, rec.id, rec, staffOrd], ["upsert", "qcpllf_activity", aid, actRec, actOrd]], t); }
  catch (e) { await cloud.close().catch(() => {}); stop("The account couldn't be saved in Supabase: " + e.message + "\nNothing was changed."); }
  await cloud.close();
}
store.tx(() => {
  store.rows.upsert(KEY, rec.id, staffOrd, rec, t);
  store.rows.upsert("qcpllf_activity", aid, actOrd, actRec, t);
});
store.db.close();

console.log(`
============================================================
  Head administrator added

  Username:            ${username}
  Temporary password:  ${temp}

  Sign in at http://localhost:${env.PORT || 8360}/admin. The site will ask
  you to choose your own new password straight away.
  This password is shown only here, once. Don't share it.
============================================================
`);
