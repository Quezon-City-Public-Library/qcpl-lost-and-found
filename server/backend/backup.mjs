/* ==========================================================================
   Encrypted backups and safe restore.

   Keys
   - When the head administrator chooses a RECOVERY PASSPHRASE, the server makes a
     key pair (RSA-3072). The public key is kept by the server; the private key is
     locked with the passphrase (scrypt N=2^17 → AES-256-GCM) and is never kept
     unlocked anywhere.
   - So the server can MAKE backups on its own (it only needs the public key),
     but nobody can OPEN one without the passphrase — not someone who copies the
     backups, and not someone who takes the server.

   A backup file (.qcplbak)
     "QCPLBAK1" · header length · header (JSON) · data · 16-byte tag
   - The data is the whole database (records, accounts, photos), encrypted with
     AES-256-GCM using a new random key for each backup. That key is locked with
     the public key and stored in the header, together with the locked private key,
     so a backup + the passphrase is enough to restore on a brand-new computer.
   - The header is authenticated too: changing any byte of the file makes it fail.
   - The header also holds a SHA-256 of the unencrypted data, the database
     version and the record counts, which are checked again before restoring.

   Restore
   - Decrypt to a temporary file, check the tag, the SHA-256, SQLite's integrity
     check and the tables; then the server restarts and swaps it in at start-up.
     A safety backup of the current data is made first, and every session is
     ended (everyone signs in again).
   ========================================================================== */
import { generateKeyPairSync, createPublicKey, createPrivateKey, publicEncrypt, privateDecrypt, randomBytes, scrypt as scryptCb,
  createCipheriv, createDecipheriv, createHash, constants } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync,
  renameSync, openSync, readSync, closeSync, copyFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { TABLES } from "./schema.mjs";

const MAGIC = Buffer.from("QCPLBAK1");
export const EXT = ".qcplbak";
const KDF = { N: 1 << 17, r: 8, p: 1, maxmem: 512 * 1024 * 1024 };
const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" };
const scrypt = (pw, salt, n = KDF.N, r = KDF.r, p = KDF.p) => new Promise((ok, no) => scryptCb(pw, salt, 32, { N: n, r, p, maxmem: KDF.maxmem }, (e, k) => (e ? no(e) : ok(k))));
const b64 = (b) => Buffer.from(b).toString("base64"), unb64 = (s) => Buffer.from(String(s || ""), "base64");
const sha256File = async (file) => { const h = createHash("sha256"); await pipeline(createReadStream(file), h); return h.digest("hex"); };
const userError = (msg, status = 400) => Object.assign(new Error(msg), { status });
export const PASSPHRASE_MIN = 16;

export function createBackups({ store, dataDir, backupDir, keep = 14, copyDir = "", copyKeep = 60, safetyDays = 60, beforeBackup = null, schemaVersion = 1, log = console.log }) {
  const KEYFILE = path.join(dataDir, "backup-keys.json");
  mkdirSync(backupDir, { recursive: true });
  if (copyDir) { try { mkdirSync(copyDir, { recursive: true }); } catch (e) { log("Backup copy folder can't be used:", e.message); copyDir = ""; } }

  const keys = () => (existsSync(KEYFILE) ? JSON.parse(readFileSync(KEYFILE, "utf8")) : null);
  const enabled = () => !!keys();
  const fingerprint = (pubPem) => createHash("sha256").update(createPublicKey(pubPem).export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);

  async function sealPrivate(privDer, passphrase) {
    const salt = randomBytes(16), iv = randomBytes(12);
    const key = await scrypt(String(passphrase).normalize("NFKC"), salt);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([c.update(privDer), c.final()]);
    return { kdf: "scrypt", N: KDF.N, r: KDF.r, p: KDF.p, salt: b64(salt), iv: b64(iv), ct: b64(ct), tag: b64(c.getAuthTag()) };
  }
  async function openPrivate(sealed, passphrase) {
    try {
      const key = await scrypt(String(passphrase || "").normalize("NFKC"), unb64(sealed.salt), sealed.N, sealed.r, sealed.p);
      const d = createDecipheriv("aes-256-gcm", key, unb64(sealed.iv));
      d.setAuthTag(unb64(sealed.tag));
      const der = Buffer.concat([d.update(unb64(sealed.ct)), d.final()]);
      return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    } catch { throw userError("The recovery passphrase is not correct."); }
  }

  /** Turn on encrypted backups (or change the passphrase: the old one is needed) */
  async function setPassphrase(passphrase, oldPassphrase, { startOver = false } = {}) {
    if (String(passphrase || "").length < PASSPHRASE_MIN) throw userError(`The recovery passphrase needs at least ${PASSPHRASE_MIN} characters. A short sentence of 4 or more words works well.`);
    const cur = startOver ? null : keys();
    let privDer, pubPem;
    if (cur) {
      // Same key pair, new passphrase. Backups made before keep their copy of the key locked with the OLD
      // passphrase; backups made from now on open with the new one.
      const priv = await openPrivate(cur.sealed, oldPassphrase);
      privDer = priv.export({ type: "pkcs8", format: "der" }); pubPem = cur.publicKey;
    } else {
      const kp = generateKeyPairSync("rsa", { modulusLength: 3072 });
      privDer = kp.privateKey.export({ type: "pkcs8", format: "der" }); pubPem = kp.publicKey.export({ type: "spki", format: "pem" });
    }
    const sealed = await sealPrivate(privDer, passphrase);
    // Starting over (forgotten passphrase): a new key pair; older backups still need the old passphrase
    const next = { v: 1, publicKey: pubPem, fingerprint: fingerprint(pubPem), sealed, created: cur ? cur.created : new Date().toISOString(), changed: new Date().toISOString() };
    writeFileSync(KEYFILE + ".tmp", JSON.stringify(next, null, 1)); renameSync(KEYFILE + ".tmp", KEYFILE);
    if (!cur && !startOver) await encryptOldPlainBackups();
    return { fingerprint: next.fingerprint };
  }

  function countsOf(file) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      // Version 2: one table per kind; version 1 (older backups): everything in "docs"
      const hasDocs = !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'docs'").get();
      const counts = hasDocs
        ? Object.fromEntries(db.prepare("SELECT key, COUNT(*) n FROM docs GROUP BY key").all().map((r) => [r.key.replace("qcpllf_", ""), r.n]))
        : Object.fromEntries(Object.entries(TABLES).map(([key, t]) => [key.replace("qcpllf_", ""), db.prepare(`SELECT COUNT(*) n FROM ${t.table}`).get().n]).filter(([, n]) => n > 0));
      counts.photos = db.prepare("SELECT COUNT(*) n FROM photos").get().n;
      const schema = Number((db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() || {}).value || 0);
      const ok = db.prepare("PRAGMA integrity_check").get().integrity_check === "ok";
      return { counts, schema, ok };
    } finally { db.close(); }
  }

  /* Encrypt a plain database copy into a backup file */
  async function encryptFile(plain, out, extra = {}) {
    const k = keys();
    const { counts, schema, ok } = countsOf(plain);
    if (!ok) throw new Error("The database copy failed its integrity check — backup not saved.");
    const dek = randomBytes(32), iv = randomBytes(12);
    const header = { v: 1, app: "qcpl-lost-and-found", created: new Date().toISOString(), schema, counts, size: statSync(plain).size,
      sha256: await sha256File(plain), alg: "AES-256-GCM", wrap: "RSA-OAEP-SHA256", key: b64(publicEncrypt({ key: k.publicKey, ...OAEP }, dek)),
      iv: b64(iv), fingerprint: k.fingerprint, sealed: k.sealed, ...extra };
    const hbuf = Buffer.from(JSON.stringify(header)), len = Buffer.alloc(4); len.writeUInt32BE(hbuf.length);
    const c = createCipheriv("aes-256-gcm", dek, iv);
    c.setAAD(Buffer.concat([MAGIC, len, hbuf]));
    const tmp = out + ".part";
    writeFileSync(tmp, Buffer.concat([MAGIC, len, hbuf]));
    await pipeline(createReadStream(plain), c, createWriteStream(tmp, { flags: "a" }));
    writeFileSync(tmp, c.getAuthTag(), { flag: "a" });
    renameSync(tmp, out);
    return header;
  }

  /** Make a backup now. Encrypted when a recovery passphrase is set; otherwise a plain copy (with a warning). */
  async function create(label = "daily") {
    if (beforeBackup) await beforeBackup(); // with Supabase: fetch every photo first, so the backup is complete
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + "-" + randomBytes(2).toString("hex");
    const plain = path.join(backupDir, `.tmp-${stamp}.db`);
    store.db.exec(`VACUUM INTO '${plain.replace(/'/g, "''")}'`); // the file name is made here, never from a request
    try {
      if (!enabled()) {
        const out = path.join(backupDir, `qcpl-${stamp}.db`);
        renameSync(plain, out); prune();
        return { name: path.basename(out), encrypted: false };
      }
      const name = `qcpl-${stamp}-${label.replace(/[^a-z-]/g, "")}${EXT}`;
      const out = path.join(backupDir, name);
      await encryptFile(plain, out, { label });
      copyOut(name);
      prune();
      return { name, encrypted: true };
    } finally { try { unlinkSync(plain); } catch {} }
  }
  async function encryptOldPlainBackups() {
    for (const f of readdirSync(backupDir).filter((f) => /^qcpl-.*\.db$/.test(f))) {
      const p = path.join(backupDir, f);
      try { await encryptFile(p, p.replace(/\.db$/, "-converted" + EXT), { label: "converted" }); unlinkSync(p); } catch (e) { log("Couldn't encrypt old backup", f, e.message); }
    }
    syncCopies();
  }

  /* Second copy, off this computer (e.g. the OneDrive folder, a USB drive or a network share).
     Only ENCRYPTED backups are ever copied there; plain ones never leave this computer. */
  function copyOut(name) {
    if (!copyDir || !name.endsWith(EXT)) return;
    try { copyFileSync(path.join(backupDir, name), path.join(copyDir, name)); pruneCopies(); }
    catch (e) { log("Backup copy failed:", e.message); }
  }
  /* Copies every encrypted backup that isn't in the copy folder yet (e.g. made while it was unreachable) */
  function syncCopies() {
    if (!copyDir || !enabled()) return 0;
    let have;
    try { have = new Set(readdirSync(copyDir)); } catch (e) { log("Backup copy folder can't be read:", e.message); return 0; }
    let n = 0;
    for (const f of readdirSync(backupDir).filter((f) => /^qcpl-[A-Za-z0-9-]+\.qcplbak$/.test(f) && !have.has(f))) {
      try { copyFileSync(path.join(backupDir, f), path.join(copyDir, f)); n++; } catch (e) { log("Backup copy failed:", e.message); break; }
    }
    if (n) { log(`Copied ${n} backup(s) to the backup copy folder.`); pruneCopies(); }
    return n;
  }
  /* The copy folder keeps the newest copyKeep daily backups, and safety copies for safetyDays */
  function pruneCopies() {
    try {
      const all = readdirSync(copyDir).filter((f) => /^qcpl-[A-Za-z0-9-]+\.qcplbak$/.test(f));
      all.filter((f) => !/before-|uploaded/.test(f)).sort().reverse().slice(copyKeep).forEach((f) => { try { unlinkSync(path.join(copyDir, f)); } catch {} });
      all.filter((f) => /before-|uploaded/.test(f)).forEach((f) => { try { const p = path.join(copyDir, f); if (Date.now() - statSync(p).mtimeMs > safetyDays * 86_400_000) unlinkSync(p); } catch {} });
    } catch {}
  }
  /* Keep the newest `keep` automatic backups; safety backups (before a restore or upgrade) are kept safetyDays (Privacy Policy) */
  function prune() {
    const all = list();
    const auto = all.filter((b) => !/before-restore|before-sql-upgrade|uploaded/.test(b.name));
    auto.slice(keep).forEach((b) => { try { unlinkSync(path.join(backupDir, b.name)); } catch {} });
    all.filter((b) => /before-restore|before-sql-upgrade|uploaded/.test(b.name) && Date.now() - Date.parse(b.created) > safetyDays * 86_400_000).forEach((b) => { try { unlinkSync(path.join(backupDir, b.name)); } catch {} });
  }

  function readHeader(file) {
    const fd = openSync(file, "r");
    try {
      const head = Buffer.alloc(12); readSync(fd, head, 0, 12, 0);
      if (!head.subarray(0, 8).equals(MAGIC)) throw userError("This is not a QCPL Lost & Found backup file.");
      const len = head.readUInt32BE(8);
      if (len < 10 || len > 1_000_000) throw userError("This backup file is damaged.");
      const hbuf = Buffer.alloc(len); readSync(fd, hbuf, 0, len, 12);
      const header = JSON.parse(hbuf.toString("utf8"));
      if (header.v !== 1 || header.app !== "qcpl-lost-and-found") throw userError("This backup was made by a different program or version.");
      return { header, aad: Buffer.concat([head, hbuf]), dataStart: 12 + len };
    } catch (e) { if (e.status) throw e; throw userError("This backup file is damaged."); } finally { closeSync(fd); }
  }
  /** Backups on this server, newest first */
  function list() {
    return readdirSync(backupDir).filter((f) => f.endsWith(EXT) || /^qcpl-.*\.db$/.test(f)).map((f) => {
      const p = path.join(backupDir, f), st = statSync(p);
      if (f.endsWith(EXT)) { try { const { header } = readHeader(p); return { name: f, created: header.created, size: st.size, encrypted: true, counts: header.counts, label: header.label || "", fingerprint: header.fingerprint }; } catch { return { name: f, created: st.mtime.toISOString(), size: st.size, encrypted: true, damaged: true }; } }
      return { name: f, created: st.mtime.toISOString(), size: st.size, encrypted: false };
    }).sort((a, b) => b.created.localeCompare(a.created));
  }
  /** A backup file name from a request → its path (only plain names of files in the backup folder) */
  function pathOf(name) {
    const n = String(name || "");
    if (!/^qcpl-[A-Za-z0-9-]+\.(qcplbak|db)$/.test(n)) throw userError("Unknown backup.", 404);
    const p = path.join(backupDir, n);
    if (!existsSync(p)) throw userError("Unknown backup.", 404);
    return p;
  }

  /** Decrypt and fully check a backup into `outFile` (nothing else is touched). Returns its header. */
  async function decryptTo(file, passphrase, outFile) {
    const { header, aad, dataStart } = readHeader(file);
    const priv = await openPrivate(header.sealed, passphrase);
    let dek;
    try { dek = privateDecrypt({ key: priv, ...OAEP }, unb64(header.key)); } catch { throw userError("This backup file is damaged."); }
    const size = statSync(file).size, end = size - 16;
    if (end <= dataStart) throw userError("This backup file is damaged.");
    const tag = Buffer.alloc(16); const fd = openSync(file, "r"); readSync(fd, tag, 0, 16, end); closeSync(fd);
    const d = createDecipheriv("aes-256-gcm", dek, unb64(header.iv));
    d.setAAD(aad); d.setAuthTag(tag);
    try { await pipeline(createReadStream(file, { start: dataStart, end: end - 1 }), d, createWriteStream(outFile)); }
    catch { try { unlinkSync(outFile); } catch {} throw userError("This backup file was changed or is damaged, so it can't be restored."); }
    const fail = (msg) => { try { unlinkSync(outFile); } catch {} throw userError(msg); };
    if ((await sha256File(outFile)) !== header.sha256) fail("This backup's contents don't match its check value, so it can't be restored.");
    let info;
    try { info = countsOf(outFile); } catch { fail("The database inside this backup can't be read."); }
    if (!info.ok) fail("The database inside this backup failed its integrity check.");
    if (info.schema > schemaVersion) fail("This backup was made by a newer version of the site. Update the site first.");
    return header;
  }

  /** Prepare a restore: safety backup, decrypt + check, and leave it ready to swap in at the next start */
  async function prepareRestore(name, passphrase, who) {
    if (!enabled()) throw userError("Turn on encrypted backups first.");
    const file = pathOf(name);
    if (!file.endsWith(EXT)) throw userError("Only encrypted backups can be restored here.");
    const pending = path.join(dataDir, "restore-pending.db");
    const header = await decryptTo(file, passphrase, pending + ".part");
    const safety = await create("before-restore");
    renameSync(pending + ".part", pending);
    writeFileSync(path.join(dataDir, "restore-pending.json"), JSON.stringify({ from: name, created: header.created, counts: header.counts, by: who, at: new Date().toISOString(), safety: safety.name }));
    return { header, safety: safety.name };
  }

  /** Save an uploaded backup file (checked to be a backup) */
  async function saveUpload(req, maxBytes) {
    const name = `qcpl-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${randomBytes(2).toString("hex")}-uploaded${EXT}`;
    const out = path.join(backupDir, name), tmp = out + ".part";
    let size = 0;
    const ws = createWriteStream(tmp);
    try {
      await new Promise((ok, no) => {
        req.on("data", (c) => { size += c.length; if (size > maxBytes) { no(userError("The file is too large.", 413)); req.destroy(); return; } ws.write(c); });
        req.on("end", ok); req.on("error", no);
      });
      await new Promise((ok) => ws.end(ok));
      readHeader(tmp); // must really be one of our backups
      renameSync(tmp, out);
      return name;
    } catch (e) { try { ws.destroy(); unlinkSync(tmp); } catch {} throw e; }
  }

  return { enabled, keys: () => { const k = keys(); return k && { fingerprint: k.fingerprint, created: k.created, changed: k.changed }; }, setPassphrase, create, list, pathOf, decryptTo, prepareRestore, saveUpload, readHeader, lockPlainBackups: encryptOldPlainBackups, syncCopies, copyDir: () => copyDir, backupDir: () => backupDir };
}

/** At start-up: swap in a prepared restore (before the database is opened). Returns what was restored, or null. */
export function applyPendingRestore(dataDir, log = console.log) {
  const pending = path.join(dataDir, "restore-pending.db"), marker = path.join(dataDir, "restore-pending.json");
  if (!existsSync(pending) || !existsSync(marker)) { try { if (existsSync(pending + ".part")) unlinkSync(pending + ".part"); } catch {} return null; }
  const info = JSON.parse(readFileSync(marker, "utf8"));
  const live = path.join(dataDir, "qcpl.db");
  for (const f of [live, live + "-wal", live + "-shm"]) { try { if (existsSync(f)) unlinkSync(f); } catch (e) { log("Restore: can't remove", f, e.message); throw e; } }
  renameSync(pending, live);
  unlinkSync(marker);
  log(`RESTORED the backup ${info.from} (made ${info.created}) by ${info.by}. Safety backup of the replaced data: ${info.safety}`);
  return info;
}
