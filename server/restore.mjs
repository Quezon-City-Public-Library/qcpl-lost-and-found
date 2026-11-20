/* ==========================================================================
   Emergency restore (when nobody can sign in, or on a new computer).

     node server/restore.mjs  "path\to\qcpl-….qcplbak"
   or drag the backup file onto "Restore a backup.bat".

   It asks for the recovery passphrase, decrypts and fully checks the backup,
   keeps a safety copy of the current data, and prepares the restore. The next
   time the site starts, the backup becomes the live data and everyone has to
   sign in again. On a new computer it also sets up encrypted backups again with
   the same recovery passphrase.
   ========================================================================== */
import path from "node:path";
import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { createPublicKey, createPrivateKey, createHash, scrypt as scryptCb, createDecipheriv } from "node:crypto";

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
const BACKUP_DIR = env.BACKUP_DIR ? path.resolve(HERE, env.BACKUP_DIR) : path.join(DATA_DIR, "backups");
mkdirSync(DATA_DIR, { recursive: true });

const file = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!file || !existsSync(file)) {
  console.log("\nUsage: drag a backup file (.qcplbak) onto \"Restore a backup.bat\",\nor run:  node server/restore.mjs \"path\\to\\backup.qcplbak\"\n");
  process.exit(1);
}
// Is the site running? (the database must not be swapped while it is open — the next start does it)
const running = await fetch(`http://127.0.0.1:${env.PORT || 8360}/api/health`).then((r) => r.ok).catch(() => false);

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    let muted = false;
    rl._writeToOutput = (s) => { if (!muted || s.includes("\n")) rl.output.write(muted ? "\n" : s); };
    rl.question(question, (a) => { rl.close(); resolve(a); });
    muted = true;
  });
}

const { openDb, SCHEMA_VERSION } = await import("./backend/db.mjs");
const { createBackups } = await import("./backend/backup.mjs");
const live = path.join(DATA_DIR, "qcpl.db");
// (Reading while the site runs is safe: the database allows it, and the copy is taken in one consistent step)
const store = existsSync(live) ? openDb(live) : null;
const backups = createBackups({ store: store || { db: null }, dataDir: DATA_DIR, backupDir: BACKUP_DIR, schemaVersion: SCHEMA_VERSION, log: () => {} });

let header;
try { header = backups.readHeader(file).header; } catch (e) { console.log("\n" + e.message + "\n"); process.exit(1); }
console.log(`\nBackup made: ${header.created}`);
console.log(`Contains: ${Object.entries(header.counts || {}).map(([k, v]) => `${v} ${k}`).join(", ")}\n`);
const passphrase = await askHidden("Recovery passphrase: ");
const pending = path.join(DATA_DIR, "restore-pending.db");
try {
  await backups.decryptTo(file, passphrase, pending + ".part");
} catch (e) { console.log("\n" + e.message + "\nNothing was changed.\n"); process.exit(1); }
console.log("The backup opened and passed every check.");

// Safety copy of the current data (encrypted if backups are encrypted on this computer)
let safety = "none (no data on this computer yet)";
if (existsSync(live)) {
  if (store && backups.enabled()) { safety = (await backups.create("before-restore")).name; }
  else { mkdirSync(BACKUP_DIR, { recursive: true }); safety = path.join(BACKUP_DIR, `qcpl-before-restore-${Date.now()}.db`); copyFileSync(live, safety); }
}
if (store) store.db.close();

// New computer: set up encrypted backups again with the same passphrase (the key travels inside the backup)
const keyFile = path.join(DATA_DIR, "backup-keys.json");
if (!existsSync(keyFile)) {
  const salt = Buffer.from(header.sealed.salt, "base64");
  const key = await new Promise((ok, no) => scryptCb(String(passphrase).normalize("NFKC"), salt, 32, { N: header.sealed.N, r: header.sealed.r, p: header.sealed.p, maxmem: 512 * 1024 * 1024 }, (e, k) => (e ? no(e) : ok(k))));
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(header.sealed.iv, "base64")); d.setAuthTag(Buffer.from(header.sealed.tag, "base64"));
  const priv = createPrivateKey({ key: Buffer.concat([d.update(Buffer.from(header.sealed.ct, "base64")), d.final()]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(priv).export({ type: "spki", format: "pem" });
  const fingerprint = createHash("sha256").update(createPublicKey(publicKey).export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);
  writeFileSync(keyFile, JSON.stringify({ v: 1, publicKey, fingerprint, sealed: header.sealed, created: new Date().toISOString(), changed: new Date().toISOString() }, null, 1));
  console.log("Encrypted backups are set up on this computer with the same recovery passphrase.");
}

renameSync(pending + ".part", pending);
writeFileSync(path.join(DATA_DIR, "restore-pending.json"), JSON.stringify({ from: path.basename(file), created: header.created, counts: header.counts, by: "Emergency restore (this computer)", at: new Date().toISOString(), safety: path.basename(safety) }));
console.log(`\nReady. Safety copy of the current data: ${path.basename(safety)}`);
console.log(running
  ? "The site is running: close its window and start it again (\"Start QCPL Lost and Found.bat\"). The backup becomes the live data then."
  : "Start the site (\"Start QCPL Lost and Found.bat\"). The backup becomes the live data then. Everyone signs in again.");
console.log("");
