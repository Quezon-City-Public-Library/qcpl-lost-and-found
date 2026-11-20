/* ==========================================================================
   QCPL Lost & Found — the server

   Does four things:
     1. Serves the website (only its public files).
     2. The backend (server/backend/): one shared database, sign-in, sessions,
        and every change to the records, checked by the site's own rules on the
        server (/api/v1/…). First start: open /setup on this computer.
     3. Sends updates and codes by email and/or SMS — only messages the server
        itself creates (there is no public "send a message" address).
     4. POST /api/describe-item — sends a photo of an item to Claude, which
        returns the type, name, brand, color and any text it can read.

   Settings go in the file  server/.env  (copy .env.example and fill it in).
   Each feature turns on only when its settings are present; without them the
   website still works and updates simply stay on the website.

   Run:  double-click "Start QCPL Lost and Found.bat"
   or:   cd server  →  npm install  →  npm start     then open http://localhost:8360
   ========================================================================== */
import http from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { readFile, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/* ---- Settings: read server/.env (KEY=value per line) before anything else ---- */
try {
  for (const line of readFileSync(path.join(HERE, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env file — that's fine */ }

const { default: Anthropic } = await import("@anthropic-ai/sdk");
const { z } = await import("zod");
const { default: nodemailer } = await import("nodemailer");
const { MESSAGES, messagesFor, placeFil, LIBRARY_NAMES } = createRequire(import.meta.url)("../js/messages.js"); // same wording as the website

const env = process.env;
const PORT = Number(env.PORT || 8360);
const SITE_URL = (env.SITE_URL || "").replace(/\/+$/, ""); // public address of the site, used in messages (optional)

/* ==========================================================================
   1. NOTIFICATIONS — email (SMTP) and SMS (Semaphore, Philippines)
   ========================================================================== */
// Google shows app passwords in groups ("abcd efgh ijkl mnop"); the spaces are not part of the password
if (/gmail\.com$/i.test(env.SMTP_HOST || "") && env.SMTP_PASS) env.SMTP_PASS = env.SMTP_PASS.replace(/\s+/g, "");
const EMAIL_ON = !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
const SMS_ON = !!env.SEMAPHORE_API_KEY;
const MAIL_FROM = env.MAIL_FROM || (env.SMTP_USER ? `QCPL Lost & Found <${env.SMTP_USER}>` : "");

const mailer = EMAIL_ON ? nodemailer.createTransport({
  host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 465), secure: String(env.SMTP_PORT || "465") === "465",
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
}) : null;

/* Values that get filled into a message come from the browser, so clean them:
   one line, no links, limited length. The message wording itself is fixed. */
// Links of any kind are removed (http://…, www.…, and bare domains like bit.ly/x or qcpl-claim.ph),
// so nobody can use the library's sender name to send a phishing link.
const LINKISH = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:[a-z]{2,24})(?:\/\S*)?(?=$|[\s,;!?)])/gi;
const clean = (v, max = 160) => String(v ?? "").replace(/[\r\n\t\u2028\u2029]+/g, " ").replace(LINKISH, "").replace(/[<>{}\\]/g, "").replace(/\s{2,}/g, " ").trim().slice(0, max);
// Each value a message can use, and what it may contain. Anything else is dropped.
const VAR_RULES = {
  code: (v) => /^\d{6}$/.test(String(v)) ? String(v) : null,          // 6-digit codes only
  amount: (v) => /^\d{1,6}(\.\d{1,2})?$/.test(String(v)) ? String(v) : null,
  count: (v) => /^\d{1,5}$/.test(String(v)) ? String(v) : null,
  ref: (v) => validRef(String(v)) ? String(v) : null,
  note: (v) => clean(v, 120),
};
function cleanVars(vars) {
  const out = {};
  for (const [k, v] of Object.entries(vars && typeof vars === "object" ? vars : {}).slice(0, 12)) {
    if (!/^[a-z]{1,12}$/i.test(k)) continue;
    const val = VAR_RULES[k] ? VAR_RULES[k](v) : clean(v, 80);
    if (val === null) throw Object.assign(new Error(`The value for "${k}" is not valid.`), { status: 400 });
    out[k] = val;
  }
  return out;
}
const validEmail = (e) => typeof e === "string" && e.length <= 120 && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(e);
const validRef = (r) => typeof r === "string" && /^([LFC]-[A-Z][A-Z0-9]-\d{6}-\d{4}|U[0-9a-z]{6,40})$/.test(r);

/* Philippine mobile numbers only: 09XXXXXXXXX, 639XXXXXXXXX or +639XXXXXXXXX → 639XXXXXXXXX */
function phMobile(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(d)) return "63" + d.slice(1);
  if (/^639\d{9}$/.test(d)) return d;
  return null;
}

async function sendEmail(to, title, body, ref, library, fil) {
  const link = SITE_URL && validRef(ref) && !ref.startsWith("U") ? `${SITE_URL}/#/status?ref=${encodeURIComponent(ref)}` : "";
  const footer = (fil
    ? [`Numero ng reperensiya: ${ref}`, `Quezon City Public Library — Nawala at Napulot, ${placeFil(library)}`, link && `Tingnan ang iyong ulat: ${link}`, "", "Awtomatikong mensahe ito. Huwag po itong sagutin."]
    : [`Reference: ${ref}`, `Quezon City Public Library — Lost & Found, ${library}`, link && `Check your report: ${link}`, "", "This is an automatic message. Please do not reply."]).filter((x) => x !== false && x !== "").join("\n");
  await mailer.sendMail({ from: MAIL_FROM, to, subject: `[${fil ? "QCPL Nawala at Napulot" : "QCPL Lost & Found"}] ${title}`, text: `${body}\n\n${footer}` });
}

async function sendSms(number, body, ref, fil) {
  const params = new URLSearchParams({ apikey: env.SEMAPHORE_API_KEY, number, message: `${fil ? "QCPL Nawala at Napulot" : "QCPL Lost&Found"}: ${body} ${fil ? "Reperensiya" : "Ref"} ${ref}`.slice(0, 320) });
  if (env.SEMAPHORE_SENDER) params.set("sendername", env.SEMAPHORE_SENDER);
  const res = await fetch("https://api.semaphore.co/api/v4/messages", { method: "POST", body: params });
  if (!res.ok) throw new Error(`Semaphore replied ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function notifyPerson({ type, vars, ref, library, pref, lang, to }) {
  if (!Object.hasOwn(MESSAGES, type)) throw Object.assign(new Error("Unknown message type."), { status: 400 });
  if (!validRef(ref)) throw Object.assign(new Error("Unknown reference."), { status: 400 });
  const fil = lang === "fil";
  const { title, body } = messagesFor(fil ? "fil" : "en")[type](cleanVars(vars));
  const libraryName = Object.hasOwn(LIBRARY_NAMES, library) ? LIBRARY_NAMES[library] : "Quezon City Public Library";
  const email = validEmail(to && to.email) ? to.email : null;
  const mobile = phMobile(to && to.phone);

  // Email whenever there is an address. SMS when the person asked for text
  // messages, or when there is no email address to use.
  const wantEmail = EMAIL_ON && !!email;
  const wantSms = SMS_ON && !!mobile && pref !== "Send an email" && (pref === "Send a text message" || !wantEmail);

  const result = { email: "skipped", sms: "skipped" };
  if (wantEmail) {
    if (!allow("to:" + email, PER_RECIPIENT) || !allow("email:day", EMAIL_PER_DAY)) result.email = "limited";
    else try { await sendEmail(email, title, body, ref, libraryName, fil); result.email = "sent"; }
      catch (err) { console.error("Email failed:", err.message); result.email = "failed"; }
  }
  if (wantSms) {
    if (!allow("to:" + mobile, PER_RECIPIENT) || !allow("sms:day", SMS_PER_DAY)) result.sms = "limited";
    else try { await sendSms(mobile, body, ref, fil); result.sms = "sent"; }
      catch (err) { console.error("SMS failed:", err.message); result.sms = "failed"; }
  }
  return result;
}

/* ==========================================================================
   2. ONLINE PHOTO READING — Claude
   ========================================================================== */
const MODEL = "claude-opus-5-5";
const VISION_ON = !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.QCPL_VISION === "on");
// Reads the key (or `ant auth login` profile) from the environment. Short timeout, one retry.
const client = VISION_ON ? new Anthropic({ timeout: 45_000, maxRetries: 1 }) : null;

/* Must match CATEGORIES and COLORS in js/data.js */
const CATEGORY_IDS = ["phones", "wallets", "bags", "keys", "books", "accessories", "others"];
const COLORS = ["Black", "White", "Gray", "Brown", "Beige", "Red", "Pink", "Orange", "Yellow", "Green", "Blue", "Purple", "Gold", "Silver", "Multi-colored", "Other"];

const ItemSchema = z.object({
  recognized: z.boolean().describe("false if the photo does not clearly show a single lost-and-found item"),
  category: z.enum(CATEGORY_IDS),
  itemName: z.string().describe("Short plain name, 2 to 5 words, e.g. 'Black folding umbrella'. No personal names or numbers."),
  brand: z.string().describe("Brand if it is visible or unmistakable, otherwise an empty string"),
  color: z.enum(COLORS),
  description: z.string().describe("One or two plain sentences safe to show publicly. No names, ID numbers, card numbers or phone numbers."),
  identifyingDetails: z.string().describe("Details that identify this exact item: text, names, stickers, damage, contents. Kept private."),
});
// The answer format sent to Claude, written out by zod itself so the allowed categories and
// colors stay a strict list ("enum"). Every answer is checked again with ItemSchema below.
const { $schema, ...ITEM_JSON_SCHEMA } = z.toJSONSchema(ItemSchema);
const ITEM_FORMAT = { type: "json_schema", schema: ITEM_JSON_SCHEMA };

const SYSTEM = `You help a public library's Lost & Found desk describe an item from a photo.

The description is used in two places. The public listing lets owners recognize their item, and must never contain anything that would let a stranger falsely claim it or that exposes the owner's personal information. The private notes are seen only by office staff, who use them to check that a claimant is the real owner.

So: put the general look of the item (type, brand, color, size, material) in the public fields. Put everything specific to this one item in identifyingDetails: any names, ID or card numbers or other text you can read, stickers, engravings, scratches, keychains, and visible contents. For bank or ID card numbers, give only the last four characters, even in identifyingDetails.

Describe only what is visible. If you cannot tell what the item is, or the photo shows no item, set recognized to false and leave the text fields empty.

Categories: phones = phones, laptops, tablets, earphones, chargers, flash drives. wallets = IDs, wallets, bank cards, documents. bags = bags and pouches. keys = keys and key cards. books = books, notebooks, calculators, pens. accessories = eyeglasses, watches, jewelry, caps. others = tumblers, umbrellas, clothing, anything else.`;

async function describeItem(imageDataUrl, kind) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl || "");
  if (!m) throw Object.assign(new Error("Send the photo as a JPEG, PNG or WebP image."), { status: 400 });
  // The bytes must really be that kind of picture (not just labelled as one)
  const head = Buffer.from(m[2].slice(0, 24), "base64");
  const isJpeg = head[0] === 0xff && head[1] === 0xd8, isPng = head.subarray(0, 4).toString("hex") === "89504e47";
  const isWebp = head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP";
  if (!({ "image/jpeg": isJpeg, "image/png": isPng, "image/webp": isWebp })[m[1]]) throw Object.assign(new Error("Send the photo as a JPEG, PNG or WebP image."), { status: 400 });

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2048, // the answer is a short form; a small cap also limits cost
    // If a safety classifier declines the request, the API re-runs it on Anthropic's recommended fallback model
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: ITEM_FORMAT },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
        { type: "text", text: `This item was ${kind === "found" ? "found in the library and turned in" : "lost; the photo is from its owner and may show the item itself or a similar one"}. Describe it.` },
      ],
    }],
  });

  if (response.stop_reason === "refusal") return { recognized: false };
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) return { recognized: false };
  let data; try { data = JSON.parse(text); } catch { return { recognized: false }; }
  const parsed = ItemSchema.safeParse(data);
  return parsed.success ? parsed.data : { recognized: false };
}

/* ==========================================================================
   HTTP
   ========================================================================== */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon" };
/* Only these public files are ever served (an allow-list, not a block-list), so
   README, passwords, server settings, .bat files and tools can never be downloaded —
   not even with tricks like "README.md::$DATA", short names (CLAUDE~1) or "..". */
const PUBLIC_FILES = new Set(["index.html", "robots.txt"]);
const PUBLIC_DIRS = ["css/", "js/", "assets/"];
function publicFile(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return null; }
  rel = rel.replace(/^\/+/, "") || "index.html";
  if (rel.length > 200 || /[\\:~*?"<>|\0]|\/\/|(^|\/)\.|\.$| $/.test(rel)) return null;
  if (!PUBLIC_FILES.has(rel) && !PUBLIC_DIRS.some((d) => rel.startsWith(d))) return null;
  const ext = path.extname(rel).toLowerCase();
  if (!TYPES[ext] && ext !== ".txt") return null;
  const file = path.resolve(ROOT, rel);
  return file.startsWith(ROOT + path.sep) ? { file, ext } : null;
}

const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".txt"]);
const zipCache = new Map(); // file + type → { mtime, data }
async function compressed(file, mtime, enc) {
  const key = enc + ":" + file, hit = zipCache.get(key);
  if (hit && hit.mtime === mtime) return hit.data;
  const raw = await readFile(file);
  const data = enc === "br" ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }) : zlib.gzipSync(raw, { level: 9 });
  zipCache.set(key, { mtime, data });
  return data;
}

const MAX_NOTIFY_BODY = 16 * 1024;           // a message request is tiny
const MAX_PHOTO_BODY = 1.5 * 1024 * 1024;    // photos are resized to ~640px in the browser, so this is generous
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

/* Limits so the service can't be used to flood people or run up bills */
const DAY = 86_400_000;
const PER_RECIPIENT = { max: 6, windowMs: 3600_000 };                           // messages to one address or number per hour
const PER_VISITOR_NOTIFY = { max: 30, windowMs: 3600_000 };                     // messages one visitor (IP address) can trigger per hour
const PER_VISITOR_PHOTO = { max: 20, windowMs: 3600_000 };                      // photos one visitor can send per hour
const SMS_PER_DAY = { max: num(env.SMS_DAILY_LIMIT, 300), windowMs: DAY };      // whole site, per day
const EMAIL_PER_DAY = { max: num(env.EMAIL_DAILY_LIMIT, 1000), windowMs: DAY };
const PHOTO_PER_DAY = { max: num(env.PHOTO_DAILY_LIMIT, 300), windowMs: DAY };
const hits = new Map();
function allow(key, { max, windowMs }) {
  const now = Date.now(), recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return false; }
  recent.push(now); hits.set(key, recent);
  return true;
}
// Forget old entries every 10 minutes so memory can't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of hits) { const keep = list.filter((t) => now - t < DAY); keep.length ? hits.set(k, keep) : hits.delete(k); }
  if (hits.size > 50_000) hits.clear();
}, 600_000).unref();

/* Security headers on every answer */
const CSP = [
  "default-src 'self'", "script-src 'self' blob: 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'", "media-src 'self' blob:",
  "frame-src https://www.google.com https://maps.google.com", "object-src 'none'", "base-uri 'none'",
  "form-action 'self'", "frame-ancestors 'none'",
].join("; ");
const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin", "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()",
  ...(SITE_URL.startsWith("https://") ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
};
const json = (res, status, body) => { res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] || 0) > max) { reject(Object.assign(new Error("The request is too large."), { status: 413 })); req.resume(); return; }
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > max) { reject(Object.assign(new Error("The request is too large."), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
const readJson = async (req, max) => { try { return JSON.parse(await readBody(req, max)); } catch (e) { if (e.status) throw e; throw Object.assign(new Error("The request was not valid."), { status: 400 }); } };

/* Which addresses this server answers to. Stops "DNS rebinding" (another site
   pretending to be localhost). Add your public domain with SITE_URL or ALLOWED_HOSTS. */
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`,
  ...(() => { try { return SITE_URL ? [new URL(SITE_URL).host.toLowerCase()] : []; } catch { console.log("SITE_URL in server/.env must start with https:// - it was ignored."); return []; } })(), ...String(env.ALLOWED_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)]);
const hostOk = (req) => ALLOWED_HOSTS.has(String(req.headers.host || "").toLowerCase());
/* The API may only be called by this website: the browser must say where the request comes from */
const sameOrigin = (req) => { const o = req.headers.origin; try { return !!o && ALLOWED_HOSTS.has(new URL(o).host.toLowerCase()); } catch { return false; } };
const isJson = (req) => /^application\/json\b/i.test(req.headers["content-type"] || "");
/* The visitor's real address when the site is reached through a proxy, so each visitor is counted separately:
     TRUST_PROXY=cloudflare  Cloudflare Tunnel on this computer: Cloudflare's CF-Connecting-IP, and only for
                             requests that come from this computer (cloudflared). Visitors can't fake it.
     TRUST_PROXY=1           one other proxy (Nginx, IIS, Render…): the LAST address in X-Forwarded-For, the
                             one the proxy itself added. The first ones can be typed in by anyone. */
const IP_LIKE = /^[0-9a-f:.]{3,45}$/i;
const fromThisComputer = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
function clientIp(req) {
  const direct = req.socket.remoteAddress;
  if (env.TRUST_PROXY === "cloudflare") {
    const cf = String(req.headers["cf-connecting-ip"] || "").trim();
    return fromThisComputer(req) && IP_LIKE.test(cf) ? cf : direct;
  }
  if (env.TRUST_PROXY === "1") {
    const last = String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean).pop();
    return last && IP_LIKE.test(last) ? last : direct;
  }
  return direct;
}

/* ==========================================================================
   BACKEND — database, rules engine, sessions and API (see server/backend/)
   ========================================================================== */
const { openDb, SCHEMA_VERSION } = await import("./backend/db.mjs");
const { createBackups, applyPendingRestore } = await import("./backend/backup.mjs");
const { createEngine } = await import("./backend/engine.mjs");
const { passwords, createSessions, safeEqual } = await import("./backend/auth.mjs");
const { createApi } = await import("./backend/api.mjs");
/* Where the database lives. A live database must not sit in a folder that OneDrive, Google Drive or
   Dropbox syncs (they can copy it half-written). If this project is in such a folder and DATA_DIR is not
   set, a local folder is used instead: %LOCALAPPDATA%\QCPL Lost and Found (Windows). */
const SYNCED = /[\\/](OneDrive|Dropbox|Google Drive|iCloud)/i.test(HERE);
const DATA_DIR = env.DATA_DIR ? path.resolve(HERE, env.DATA_DIR)
  : SYNCED && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "QCPL Lost and Found", "data") : path.resolve(HERE, "data");
const stamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const say = (...a) => console.log(stamp(), ...a);
// A restore prepared on the Backups page is swapped in here, before the database is opened
const restored = applyPendingRestore(DATA_DIR, say);
const BACKUP_DIR = env.BACKUP_DIR ? path.resolve(HERE, env.BACKUP_DIR) : path.join(DATA_DIR, "backups");
// An older database (all records in one "docs" table) is moved into the SQL tables once; a full copy is saved first
const dbStore = openDb(path.join(DATA_DIR, "qcpl.db"), { onBeforeUpgrade(db) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const copy = path.join(BACKUP_DIR, `qcpl-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-before-sql-upgrade.db`);
  db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`); // the file name is made here, never from a request
  say("Upgrading the database to SQL tables. A copy of the old one was saved first:", copy);
} });
if (dbStore.upgraded) say("Database upgraded: every record now has its own row in the SQL tables.");
if (restored) dbStore.db.exec("DELETE FROM sessions"); // everyone signs in again after a restore
/* Supabase (SUPABASE_DB_URL in server/.env): the real data lives there; qcpl.db is the working copy */
const { cloudConfigured, createCloud } = await import("./backend/cloud.mjs");
let cloud = null;
if (cloudConfigured(env)) {
  cloud = createCloud({ env, log: say });
  try {
    await cloud.ensureSchema();
    await cloud.acquireLease({ force: env.SUPABASE_FORCE_LEASE === "1" });
    if (restored) { say("Restore: copying the restored data to Supabase..."); say("Supabase now has:", JSON.stringify(await cloud.pushAll(dbStore))); }
    else if (!(await cloud.isInitialized())) throw new Error('The Supabase database is still empty. Run "Move the database to Supabase.bat" first; it copies your data there.');
    else say("Loaded from Supabase:", JSON.stringify(await cloud.pullInto(dbStore)));
  } catch (e) {
    console.error("\nCan't use the Supabase database: " + e.message + "\nNothing was changed. Check the SUPABASE_ lines in server/.env, or your internet connection.\n");
    try { await cloud.close(); } catch {}
    process.exit(1);
  }
  dbStore.cloud = cloud;
}
const SECURE = SITE_URL.startsWith("https://");
// DEMO_CODES=1 shows sign-up and reset codes on screen — only for trying the site on this computer, and only
// while no email or SMS is set up. Never use it on a real website.
const DEMO_CODES = env.DEMO_CODES === "1" && !EMAIL_ON && !SMS_ON;
const channelsNow = () => ({ email: EMAIL_ON, sms: SMS_ON });
const engine = createEngine({ root: ROOT, store: dbStore, notify: notifyPerson, channels: channelsNow, passwords, demoCodes: DEMO_CODES, strict: env.STRICT_CHECKS === "1" });
const sessions = createSessions(dbStore, { secure: SECURE });
// A second copy of every ENCRYPTED backup goes off this computer. Default: the OneDrive folder
// (synced to the cloud). BACKUP_COPY_DIR in server/.env picks another folder; "off" turns it off.
const BACKUP_COPY_DIR = /^off$/i.test(env.BACKUP_COPY_DIR || "") ? ""
  : env.BACKUP_COPY_DIR ? path.resolve(HERE, env.BACKUP_COPY_DIR)
  : env.OneDrive ? path.join(env.OneDrive, "QCPL Lost and Found backups") : "";
const backups = createBackups({ store: dbStore, dataDir: DATA_DIR, backupDir: BACKUP_DIR, keep: Number(env.BACKUP_KEEP || 14),
  copyDir: BACKUP_COPY_DIR, beforeBackup: cloud ? () => cloud.cacheAllPhotos(dbStore) : null, copyKeep: Number(env.BACKUP_COPY_KEEP || 60), safetyDays: Number(env.BACKUP_SAFETY_DAYS || 60) /* = backupDays in ORG.privacy */, schemaVersion: SCHEMA_VERSION, log: say });
backups.syncCopies(); // catch up on encrypted backups made while the copy folder was missing
if (dbStore.upgraded && backups.enabled()) await backups.lockPlainBackups(); // encrypt the upgrade copy right away
/* Stop cleanly; code 3 = "start me again" (the launcher restarts the server, e.g. after a restore) */
async function shutdown(code = 0) {
  try { server.close(); } catch {}
  if (cloud) { try { await Promise.race([cloud.close(), new Promise((r) => setTimeout(r, 3000))]); } catch {} } // lets the next server take over at once
  try { dbStore.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); dbStore.db.close(); } catch {}
  process.exit(code);
}
const api = createApi({ engine, store: dbStore, sessions, allow, json, headers: SECURITY_HEADERS, readJson, libraries: engine.LF.libraries,
  demoCodes: DEMO_CODES, channels: channelsNow, log: say, backups, restart: () => shutdown(3),
  maxUploadBytes: Number(env.MAX_RESTORE_UPLOAD_MB || 2048) * 1024 * 1024, adminNetworks: env.ADMIN_NETWORKS || "" });
if (restored) engine.exec({ ip: "system", library: engine.LF.libraries[0].id, lang: "en", unlocked: [] }, (LF) =>
  LF.log(restored.by || "System", "Data restored from a backup", restored.from, `Backup made ${restored.created}; the data it replaced is in ${restored.safety}`)).catch(() => {});

// Reminders before the holding period ends (every 15 minutes, every library)
setInterval(async () => {
  for (const lib of engine.LF.libraries) { try { await engine.exec({ ip: "system", library: lib.id, lang: "en", unlocked: [] }, (LF) => LF.housekeeping()); } catch (e) { console.error("Reminders failed:", e.message); } }
}, 15 * 60_000).unref();
// A backup every day (and 2 minutes after each start), and unused uploaded photos removed after a day
/* Personal information is kept only as long as the Privacy Policy says (ORG.privacy in js/data.js) */
const { runPrivacyJobs } = await import("./backend/privacy.mjs");
const privacyJobs = () => runPrivacyJobs({ engine, store: dbStore, log: say });
const dailyJobs = async () => {
  try { await privacyJobs(); } catch (e) { console.error("Privacy clean-up failed:", e.message); }
  try { const r = await backups.create("daily"); say("Backup saved:", r.name, r.encrypted ? "(encrypted)" : "(NOT encrypted - set a recovery passphrase on the Backups page)"); } catch (e) { console.error("Backup failed:", e.message); }
  // Photos uploaded with a report that was never sent
  try {
    const old = dbStore.db.prepare("SELECT id FROM photos WHERE owner_id IS NULL AND created < ?").all(Date.now() - 86_400_000).map((r) => r.id);
    if (old.length && cloud) await cloud.deletePhotos(old);
    dbStore.q.photoOrphans.run(Date.now() - 86_400_000);
  } catch (e) { console.error("Photo clean-up failed:", e.message); }
};
setTimeout(dailyJobs, 2 * 60_000).unref();
setInterval(dailyJobs, 24 * 3600_000).unref();

/* The page is marked so the browser knows the server holds the records */
const MARK = '<meta name="qcpl-backend" content="1" />';
/* Each script and stylesheet link gets "?v=<when the file last changed>", so after
   any change to the site every browser loads the new file at once (no old copies) */
async function versioned(html) {
  const out = [];
  let last = 0;
  for (const m of html.matchAll(/(src|href)="((?:js|css|assets)\/[^"?#]+\.(?:js|css))"/g)) {
    const info = await stat(path.join(ROOT, m[2])).catch(() => null);
    out.push(html.slice(last, m.index), info ? `${m[1]}="${m[2]}?v=${Math.floor(info.mtimeMs).toString(36)}"` : m[0]);
    last = m.index + m[0].length;
  }
  return out.join("") + html.slice(last);
}
async function indexPage() {
  const html = await readFile(path.join(ROOT, "index.html"), "utf8");
  return Buffer.from(await versioned(html.replace('<meta charset="utf-8" />', '<meta charset="utf-8" />\n  ' + MARK)));
}

const server = http.createServer(async (req, res) => {
  const ip = clientIp(req);
  req.ip = ip;
  try {
    if (!hostOk(req)) return json(res, 421, { error: "Unknown site address." });
    let url;
    try { url = new URL(req.url, "http://localhost"); } catch { return json(res, 400, { error: "Bad address." }); }

    if (url.pathname === "/api/health") return json(res, 200, { ok: true, vision: VISION_ON, email: EMAIL_ON, sms: SMS_ON, backend: true, database: cloud ? "supabase" : "local", region: cloud ? cloud.region : "" });
    if (await api.handle(req, res, url, { sameOrigin, isJson })) return;

    if (url.pathname === "/api/describe-item") {
      if (req.method !== "POST") return json(res, 405, { error: "Use POST." });
      if (!VISION_ON) return json(res, 503, { error: "Online photo reading is not set up on this server." });
      if (!sameOrigin(req) || !isJson(req)) return json(res, 403, { error: "Not allowed from this site." });
      // Only from a page of this site that has a session (stops scripts from using our AI budget)
      const sess = sessions.get(req, res);
      if (sess.isNew || !safeEqual(req.headers["x-csrf"], sess.s.csrf)) return json(res, 403, { error: "Please reload the page." });
      if (!allow("photo:" + ip, PER_VISITOR_PHOTO) || !allow("photo:day", PHOTO_PER_DAY)) return json(res, 429, { error: "Too many photos. Please try again later." });
      const body = await readJson(req, MAX_PHOTO_BODY);
      return json(res, 200, await describeItem(body.image, body.kind === "found" ? "found" : "lost"));
    }
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Not found." });
    // The administrator sign-in has its own address (not linked from the public pages)
    if (url.pathname === "/admin" || url.pathname === "/admin/") { res.writeHead(302, { ...SECURITY_HEADERS, Location: "/#/staff", "Cache-Control": "no-store" }); return res.end(); }

    // Static files (public ones only)
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Not allowed." });
    const pub = publicFile(url.pathname);
    if (!pub) return json(res, 404, { error: "Not found." });
    if (pub.file === path.join(ROOT, "index.html")) {
      let body = await indexPage();
      const h = { ...SECURITY_HEADERS, "Content-Type": TYPES[".html"], "Cache-Control": "no-cache", "Vary": "Accept-Encoding" };
      if (/\bgzip\b/.test(req.headers["accept-encoding"] || "")) { body = zlib.gzipSync(body); h["Content-Encoding"] = "gzip"; }
      h["Content-Length"] = body.length; res.writeHead(200, h);
      return res.end(req.method === "HEAD" ? undefined : body);
    }
    const info = await stat(pub.file).catch(() => null);
    if (!info || !info.isFile()) return json(res, 404, { error: "Not found." });
    const real = await realpath(pub.file).catch(() => "");
    if (!real.startsWith(ROOT + path.sep)) return json(res, 404, { error: "Not found." });
    // Text files are sent compressed (about 4× smaller), which matters on slow mobile internet
    const headers = { ...SECURITY_HEADERS, "Content-Type": TYPES[pub.ext] || "text/plain; charset=utf-8",
      // A versioned link (?v=…) never changes, so it can be kept; anything else is checked again every time
      "Cache-Control": pub.ext !== ".html" && /^\?v=[a-z0-9]+$/.test(url.search) ? "public, max-age=31536000, immutable" : "no-cache",
      "Last-Modified": info.mtime.toUTCString(), "Vary": "Accept-Encoding" };
    // "Not changed since you last loaded it": nothing to send again
    const since = Date.parse(req.headers["if-modified-since"] || "");
    if (since && Math.floor(info.mtimeMs / 1000) * 1000 <= since) { res.writeHead(304, headers); return res.end(); }
    const enc = COMPRESSIBLE.has(pub.ext) ? (/\bbr\b/.test(req.headers["accept-encoding"] || "") ? "br" : /\bgzip\b/.test(req.headers["accept-encoding"] || "") ? "gzip" : "") : "";
    const body = enc ? await compressed(pub.file, info.mtimeMs, enc) : await readFile(pub.file);
    if (enc) headers["Content-Encoding"] = enc;
    headers["Content-Length"] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (err) {
    // Typed SDK errors first, then anything else
    if (err instanceof Anthropic.RateLimitError) return json(res, 429, { error: "The AI service is busy. Please try again in a minute." });
    if (err instanceof Anthropic.AuthenticationError) { console.error("Check ANTHROPIC_API_KEY:", err.message); return json(res, 503, { error: "Online photo reading is not available." }); }
    if (err instanceof Anthropic.APIError) { console.error("Claude API error:", err.status, err.message); return json(res, 502, { error: "The AI service could not read the photo." }); }
    if (!err.status) console.error(err);
    if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : "Something went wrong." });
  }
});
// Slow or stuck connections are closed instead of piling up
server.headersTimeout = 10_000;
server.requestTimeout = 60_000;
server.keepAliveTimeout = 5_000;
process.on("unhandledRejection", (e) => console.error("Unexpected error:", e && e.message));
// Closing the window (Ctrl+C) finishes writing and closes the database cleanly
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(sig, () => shutdown(0));

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") console.log(`\nThe site is already running in another window (http://localhost:${PORT}).\nClose that window first, then start again.`);
  else console.error(err);
  process.exit(1);
});

// Only this computer can reach the server unless HOST is set (e.g. HOST=0.0.0.0 behind a proxy)
const HOST = env.HOST || "127.0.0.1";
server.listen(PORT, HOST, async () => {
  const onOff = (b) => (b ? "ON" : "OFF");
  console.log(`QCPL Lost & Found is running at http://localhost:${PORT}${HOST === "127.0.0.1" ? "" : `  (listening on ${HOST})`}`);
  const missingMail = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter((k) => !env[k]);
  console.log(`  Email updates:        ${onOff(EMAIL_ON)}${EMAIL_ON ? ` (from ${MAIL_FROM})` : missingMail.length < 3 ? `  - still empty in server/.env: ${missingMail.join(", ")}` : "  - add SMTP settings to server/.env"}`);
  console.log(`  Text (SMS) updates:   ${onOff(SMS_ON)}${SMS_ON ? " (Semaphore)" : "  - add SEMAPHORE_API_KEY to server/.env"}`);
  console.log(`  Online photo reading: ${onOff(VISION_ON)}${VISION_ON ? ` (${MODEL})` : "  - add ANTHROPIC_API_KEY to server/.env"}`);
  console.log(cloud ? `  Database:             Supabase${cloud.region ? " (" + cloud.region + ")" : ""} - working copy: ${path.join(DATA_DIR, "qcpl.db")}` : `  Database:             ${path.join(DATA_DIR, "qcpl.db")}`);
  console.log(`  Backups (daily):      ${BACKUP_DIR}  - ${backups.enabled() ? "encrypted" : "NOT encrypted yet: the head administrator sets a recovery passphrase on the Backups page"}`);
  if (restored) console.log(`  RESTORED from ${restored.from} (made ${restored.created}). Everyone must sign in again.`);
  if (/[\\/](OneDrive|Dropbox|Google Drive|iCloud)/i.test(DATA_DIR)) console.log("  WARNING: the database is in a synced folder (OneDrive/Dropbox). Set DATA_DIR in server/.env to a local folder.");
  if (DEMO_CODES) console.log("  DEMO_CODES is on: codes are shown on screen. Turn it off before real use.");
  if (api.needsSetup()) console.log(`\n  FIRST START: open http://localhost:${PORT}/setup on this computer to create the head administrator.\n`);
  if (EMAIL_ON) mailer.verify().then(() => console.log("  Email sign-in check: OK")).catch((e) => {
    console.log("  Email sign-in check FAILED. Emails will not be sent until this is fixed.");
    if (/gmail\.com$/i.test(env.SMTP_HOST) && env.SMTP_PASS.length !== 16) console.log(`  SMTP_PASS should be the 16-letter app password from Google. It currently has ${env.SMTP_PASS.length} characters.`);
    else console.log("  Reason:", e.message.split("\n")[0]);
  });
});
