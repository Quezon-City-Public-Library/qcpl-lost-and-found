/* ==========================================================================
   Move the database to Supabase (one time).

     Double-click "Move the database to Supabase.bat"   (or: node server/move-to-supabase.mjs)

   1. Asks for the Supabase details (keys and the database password are hidden
      while typed and are saved only in server/.env).
   2. Checks the connection, makes the private tables and photo bucket.
   3. Makes a safety backup of the data on this computer.
   4. Copies every record and photo to Supabase, and checks the counts match.
   5. Saves the settings; from the next start the site uses Supabase.
   The site must be stopped (the .bat file does it and starts it again).
   Options (for testing): --env <file> --data <folder> --url --key --db --region --replace --yes
   ========================================================================== */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : null; };
const flag = (n) => process.argv.includes("--" + n);
const ENV_FILE = arg("env") ? path.resolve(arg("env")) : path.join(HERE, ".env");
const fail = (msg) => { console.log("\n" + msg + "\nNothing was changed.\n"); process.exitCode = 1; throw Object.assign(new Error(msg), { quiet: true }); };
process.on("uncaughtException", (e) => { if (!e.quiet) { console.error("\n" + (e.message || e)); process.exitCode = 1; } });

// Settings already in server/.env (the same way the server reads them)
if (!existsSync(ENV_FILE)) copyFileSync(path.join(HERE, ".env.example"), ENV_FILE);
let envText = readFileSync(ENV_FILE, "utf8");
const fileVal = (k) => { const m = new RegExp(`^\\s*${k}\\s*=(.*)$`, "m").exec(envText); return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""; };
const setVal = (k, v) => { v = String(v || "").replace(/[\r\n]+/g, " ").trim(); const re = new RegExp(`^(\\s*${k}\\s*=).*$`, "m"); envText = re.test(envText) ? envText.replace(re, (_, a) => a + v) : envText.replace(/\s*$/, "\n") + `${k}=${v}\n`; };
const SYNCED = /[\\/](OneDrive|Dropbox|Google Drive|iCloud)/i.test(HERE);
const DATA_DIR = arg("data") ? path.resolve(arg("data")) : fileVal("DATA_DIR") ? path.resolve(HERE, fileVal("DATA_DIR")) : SYNCED && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "QCPL Lost and Found", "data") : path.resolve(HERE, "data");
const DB = path.join(DATA_DIR, "qcpl.db");
const PORT = fileVal("PORT") || process.env.PORT || 8360;

/* ---------- questions (hidden when secret) ---------- */
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let muted = false;
rl._writeToOutput = (s) => { if (!muted || s.includes("\n")) rl.output.write(muted ? (s.includes("\n") ? "\n" : "") : s); };
const queue = []; let waiting = null;
rl.on("line", (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else queue.push(l); });
rl.on("close", () => { if (waiting) { const w = waiting; waiting = null; w(""); } });
// (control characters are removed: some windows put ^V in the text when Ctrl+V is pressed)
const ask = (q, hidden = false) => new Promise((ok) => { rl.output.write(q); muted = hidden; const done = (a) => { muted = false; if (hidden) rl.output.write("\n"); ok(String(a || "").replace(/[\x00-\x1f\x7f]/g, "").trim()); }; if (queue.length) done(queue.shift()); else waiting = done; });

console.log(`
============================================================
  Move the database to Supabase
============================================================
Have these ready from your Supabase project (supabase.com/dashboard):
  1. Project URL     - Project Settings > Data API (looks like https://abcdefgh.supabase.co)
  2. Secret key      - Project Settings > API Keys: the "service_role" / secret key
                       (NOT the "anon" / publishable key). It gives full access: never share it.
  3. Connection string - the green "Connect" button at the top > "Session pooler",
                       copy the URI and put your database password in place of [YOUR-PASSWORD].
  4. (Recommended) SSL certificate - Database Settings > SSL Configuration > Download certificate.
Pick the region closest to the Philippines (e.g. Singapore) when you create the project.
`);

if (!existsSync(DB)) fail(`There is no data on this computer yet (${DB}). Start the site once first.`);
const running = await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.ok).catch(() => false);
if (running) fail('The site is running. Close its window first (or use "Move the database to Supabase.bat", which does it for you).');

let url = arg("url") || "";
while (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in|net)\/?$/i.test(url) && !(arg("url") && /^http:\/\/127\.0\.0\.1:\d+/.test(url))) url = await ask("1. Project URL: ");
console.log("   (Secrets don't show on screen while you paste - that's normal. To paste: RIGHT-CLICK in this window, then press Enter.)");
let key = arg("key") || "";
for (;;) {
  if (!key) key = await ask("2. Secret key, starts with sb_secret_ (hidden): ", true);
  if (!key) { console.log("   Nothing was received. Copy the key again in Supabase, RIGHT-CLICK in this window to paste, then press Enter."); continue; }
  if (/^sb_publishable_/.test(key) || /anon/i.test(key)) { console.log("   That is the PUBLISHABLE (public) key. We need the SECRET key: Project Settings > API Keys > Secret keys (starts with sb_secret_)."); key = ""; continue; }
  if (!/^sb_secret_[A-Za-z0-9_-]{10,}$/.test(key) && !/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) { console.log(`   That doesn't look like a Supabase secret key (received ${key.length} characters). It should start with sb_secret_ (or eyJ for an older service_role key). Please copy it again.`); key = ""; continue; }
  console.log(`   OK - received a ${/^sb_secret_/.test(key) ? "secret" : "service_role"} key (${key.length} characters).`);
  break;
}
let db = arg("db") || "";
while (!/^postgres(ql)?:\/\/[^\s]+@[^\s]+\/[^\s]+$/.test(db) || /\[YOUR-PASSWORD\]/i.test(db)) {
  if (db) console.log(/\[YOUR-PASSWORD\]/i.test(db) ? "   Put your database password in place of [YOUR-PASSWORD]." : "   That doesn't look like a connection string (it starts with postgresql://).");
  db = await ask("3. Connection string with your password (hidden): ", true);
  if (!db) console.log("   Nothing was received. RIGHT-CLICK in this window to paste, then press Enter.");
}
// Shown without the password, so you can check it is the right one (Session pooler, port 5432)
const shown = db.replace(/^(postgres(?:ql)?:\/\/[^:@\s]+):[^@\s]*@/, "$1:********@");
console.log("   OK - received: " + shown);
if (/:6543\//.test(db)) console.log('   Note: that is the "Transaction pooler" (port 6543). The "Session pooler" (port 5432) is better for this website, but this works too.');
let ca = arg("ca") ?? (await ask("4. Path of the downloaded SSL certificate (press Enter to skip): ")).replace(/^"|"$/g, "");
if (ca && !existsSync(ca)) { console.log("   That file doesn't exist; continuing without it (the connection is still encrypted)."); ca = ""; }
const region = arg("region") ?? (await ask("   Region you chose (e.g. Singapore): "));

/* ---------- connect and prepare ---------- */
const { createCloud } = await import("./backend/cloud.mjs");
const env = { SUPABASE_DB_URL: db, SUPABASE_URL: url.replace(/\/+$/, ""), SUPABASE_SERVICE_KEY: key, SUPABASE_CA_FILE: ca, SUPABASE_REGION: region, SUPABASE_POOL_MAX: process.env.SUPABASE_POOL_MAX || "" };
const cloud = createCloud({ env, log: () => {} });
console.log("\nConnecting to Supabase...");
try { await cloud.ensureSchema(); } catch (e) { await cloud.close().catch(() => {}); fail("Couldn't reach the database: " + e.message + "\nCheck the connection string and the password (and your internet)."); }
try { await cloud.ensureBucket(); } catch (e) { await cloud.close().catch(() => {}); fail("Couldn't prepare photo storage: " + e.message + "\nCheck the Project URL and the secret key."); }
try { await cloud.acquireLease(); } catch (e) { await cloud.close().catch(() => {}); fail(e.message); }
console.log("  OK: connected, private tables and photo bucket ready.");

const before = await cloud.counts();
const hasData = (await cloud.isInitialized()) && Object.values(before).some((n) => n > 0);
if (hasData) {
  console.log(`\nSupabase ALREADY has data: ${Object.entries(before).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ")}.`);
  const a = flag("replace") ? "REPLACE" : await ask('Type REPLACE to replace it with the data on this computer, or press Enter to keep Supabase\'s data and just connect: ');
  if (a !== "REPLACE") {
    for (const [k, v] of Object.entries({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_KEY: key, SUPABASE_DB_URL: db, SUPABASE_CA_FILE: ca, SUPABASE_REGION: region })) setVal(k, v);
    writeFileSync(ENV_FILE, envText); await cloud.close(); rl.close();
    console.log("\nConnected to the existing Supabase data (nothing was copied). The site will load it at the next start.\n");
    process.exit(0);
  }
}

/* ---------- safety backup, then copy ---------- */
const { openDb } = await import("./backend/db.mjs");
const store = openDb(DB);
try {
  const { createBackups } = await import("./backend/backup.mjs");
  const backupDir = fileVal("BACKUP_DIR") ? path.resolve(HERE, fileVal("BACKUP_DIR")) : path.join(DATA_DIR, "backups");
  const b = await createBackups({ store, dataDir: DATA_DIR, backupDir, log: () => {} }).create("before-supabase");
  console.log(`\nSafety backup of this computer's data: ${b.name}${b.encrypted ? " (encrypted)" : ""}`);
} catch (e) { console.log("\n(No safety backup could be made: " + e.message + ")"); }

console.log("\nCopying to Supabase...");
const local = {};
for (const [k, t] of Object.entries((await import("./backend/schema.mjs")).TABLES)) local[k.replace("qcpllf_", "")] = store.db.prepare(`SELECT COUNT(*) n FROM ${t.table}`).get().n;
local.photos = store.db.prepare("SELECT COUNT(*) n FROM photos").get().n;
let pushed;
try { pushed = await cloud.pushAll(store, { onProgress: (m) => console.log("  " + m) }); }
catch (e) { store.db.close(); await cloud.close().catch(() => {}); fail("Copying stopped: " + e.message + "\nSupabase was left as it was before (the copy is all or nothing)."); }
const after = await cloud.counts();
const same = Object.keys(local).every((k) => local[k] === after[k]);
console.log(`  Photo files uploaded: ${pushed.photoFilesUploaded}`);
console.log(same ? "  OK: every record and photo is in Supabase (counts match)." : `  !! The counts don't match: here ${JSON.stringify(local)}, Supabase ${JSON.stringify(after)}`);
store.db.close();
await cloud.close();
if (!same) fail("Something didn't copy. Please run this again.");

for (const [k, v] of Object.entries({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_KEY: key, SUPABASE_DB_URL: db, SUPABASE_CA_FILE: ca, SUPABASE_REGION: region })) setVal(k, v);
writeFileSync(ENV_FILE, envText);
rl.close();
console.log(`
Done. The settings are saved in server\\.env (keep that file private).
From now on the site keeps its data in Supabase${region ? " (" + region + ")" : ""}.
The data on this computer stays as a working copy and is refreshed from Supabase at every start.
`);
