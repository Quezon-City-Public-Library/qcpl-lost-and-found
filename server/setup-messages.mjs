/* ==========================================================================
   Set up email and text (SMS) updates — a guided helper.

     Double-click "Set up email and text messages.bat"   (or: node server/setup-messages.mjs)

   Asks a few questions, saves the answers in server/.env (passwords are hidden
   while typed and never shown again), runs the real test (check.mjs), can turn
   the 6-digit sign-up code back on, and restarts the website.
   Options (for testing): --env <file>  --no-check  --no-restart
   ========================================================================== */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const arg = (n) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : null; };
const flag = (n) => process.argv.includes("--" + n);
const ENV_FILE = arg("env") ? path.resolve(arg("env")) : path.join(HERE, ".env");

/* ---------- questions (one line at a time; passwords hidden) ---------- */
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let muted = false;
rl._writeToOutput = (s) => { if (!muted || s.includes("\n")) rl.output.write(muted ? (s.includes("\n") ? "\n" : "") : s); };
const lines = [];
let waiting = null;
rl.on("line", (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else lines.push(l); });
rl.on("close", () => { if (waiting) { const w = waiting; waiting = null; w(""); } });
function ask(q, { hidden = false } = {}) {
  return new Promise((ok) => {
    rl.output.write(q);
    muted = hidden;
    const done = (a) => { muted = false; if (hidden) rl.output.write("\n"); ok(String(a || "").trim()); };
    if (lines.length) done(lines.shift()); else waiting = done;
  });
}
async function choose(q, options) {
  console.log("\n" + q);
  options.forEach((o, i) => console.log(`  ${i + 1}. ${o}`));
  for (;;) { const a = await ask("Type a number: "); const n = Number(a); if (n >= 1 && n <= options.length) return n; if (a === "" && !process.stdin.isTTY) return options.length; console.log("  Please type one of the numbers above."); }
}
async function yes(q) { for (;;) { const a = (await ask(q + " (y/n): ")).toLowerCase(); if (["y", "yes", "o", "oo"].includes(a)) return true; if (["n", "no", "hindi", ""].includes(a)) return false; } }
const oneLine = (v) => String(v || "").replace(/[\r\n]+/g, " ").trim();

/* ---------- server/.env: change only the lines we ask about ---------- */
if (!existsSync(ENV_FILE)) copyFileSync(path.join(HERE, ".env.example"), ENV_FILE);
let envText = readFileSync(ENV_FILE, "utf8");
const current = (key) => { const m = new RegExp(`^\\s*${key}\\s*=(.*)$`, "m").exec(envText); return m ? m[1].trim() : ""; };
function setVal(key, value) {
  const re = new RegExp(`^(\\s*${key}\\s*=).*$`, "m");
  value = oneLine(value);
  envText = re.test(envText) ? envText.replace(re, (_, a) => a + value) : envText.replace(/\s*$/, "\n") + `${key}=${value}\n`;
}

console.log(`
============================================================
  Email and text (SMS) updates - setup
============================================================
People get an update when their item is found, when a claim is
approved, and to reset a password. Passwords and keys you type here
are saved only in server\\.env on this computer and are hidden on screen.
`);

/* ---------- email ---------- */
const mail = await choose("EMAIL - which email service will send the updates?", [
  "Gmail (a Gmail account with 2-Step Verification)",
  "Brevo (brevo.com - free, about 300 emails a day)",
  "Another email service (I have its SMTP details)",
  current("SMTP_HOST") ? `Keep what is set now (${current("SMTP_HOST")})` : "No email for now",
]);
if (mail === 1) {
  console.log(`
  Gmail needs an "App password" (your normal Gmail password will NOT work):
    1. Open  https://myaccount.google.com/apppasswords  (sign in to the Gmail account)
    2. Type a name such as "QCPL Lost and Found" and press Create
    3. Google shows 16 letters. Type them below (spaces don't matter).`);
  let user = ""; while (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) user = await ask("  Gmail address: ");
  const pass = await ask("  App password (hidden): ", { hidden: true });
  setVal("SMTP_HOST", "smtp.gmail.com"); setVal("SMTP_PORT", "465"); setVal("SMTP_USER", user); setVal("SMTP_PASS", pass.replace(/\s+/g, ""));
  setVal("MAIL_FROM", `QCPL Lost & Found <${user}>`);
} else if (mail === 2) {
  console.log(`
  In Brevo: open "SMTP & API" > SMTP. You need the "Login" and an "SMTP key"
  (create one there). The sender address must be verified under "Senders".`);
  const user = await ask("  Login (shown on Brevo's SMTP page): ");
  const pass = await ask("  SMTP key (hidden): ", { hidden: true });
  let from = ""; while (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) from = await ask("  Sender email address (verified in Brevo): ");
  setVal("SMTP_HOST", "smtp-relay.brevo.com"); setVal("SMTP_PORT", "587"); setVal("SMTP_USER", user); setVal("SMTP_PASS", pass);
  setVal("MAIL_FROM", `QCPL Lost & Found <${from}>`);
} else if (mail === 3) {
  const host = await ask("  SMTP server (e.g. smtp.office365.com): ");
  const port = (await ask("  Port (465 or 587; press Enter for 587): ")) || "587";
  const user = await ask("  Username: ");
  const pass = await ask("  Password (hidden): ", { hidden: true });
  const from = await ask("  Sender email address (press Enter to use the username): ");
  setVal("SMTP_HOST", host); setVal("SMTP_PORT", port); setVal("SMTP_USER", user); setVal("SMTP_PASS", pass);
  setVal("MAIL_FROM", `QCPL Lost & Found <${from || user}>`);
} else if (!current("SMTP_HOST")) {
  for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"]) setVal(k, "");
}

/* ---------- SMS ---------- */
const sms = await choose("TEXT MESSAGES (SMS) - send updates by text to Philippine mobile numbers?", [
  "Yes, with Semaphore (semaphore.co - each text uses about 1 credit)",
  current("SEMAPHORE_API_KEY") ? "Keep what is set now" : "No text messages for now",
]);
if (sms === 1) {
  console.log(`
  In Semaphore: sign in, open "Account" > API, and copy the API key.
  Add credits there too; without credits no texts go out.`);
  const key = await ask("  API key (hidden): ", { hidden: true });
  const sender = await ask("  Approved sender name (press Enter if you don't have one): ");
  setVal("SEMAPHORE_API_KEY", key); setVal("SEMAPHORE_SENDER", sender);
} else if (!current("SEMAPHORE_API_KEY")) {
  setVal("SEMAPHORE_API_KEY", ""); setVal("SEMAPHORE_SENDER", "");
}

/* ---------- where the test sends to ---------- */
const emailOn = !!current("SMTP_HOST"), smsOn = !!current("SEMAPHORE_API_KEY");
if (emailOn || smsOn) console.log("\nTEST - send one real message now, to check that it works:");
if (emailOn) setVal("TEST_EMAIL", await ask("  Your email address for a test email (press Enter to skip): "));
if (smsOn) setVal("TEST_PHONE", await ask("  Your mobile number for a test text, e.g. 09171234567 (uses 1 credit; Enter to skip): "));

writeFileSync(ENV_FILE, envText);
console.log("\nSaved in server\\.env.");

/* ---------- real test ---------- */
let works = false;
if (!flag("no-check") && (emailOn || smsOn)) {
  console.log("\nTesting now (this can take up to 30 seconds)...");
  const r = spawnSync(process.execPath, ["check.mjs"], { cwd: HERE, stdio: "inherit", env: { ...process.env, QCPL_ENV_FILE: ENV_FILE } });
  works = r.status === 0;
} else if (emailOn || smsOn) works = true;

/* ---------- the 6-digit code at sign-up ---------- */
const dataFile = path.join(ROOT, "js", "data.js");
const dataText = readFileSync(dataFile, "utf8");
const codeOn = /^\s*signupCode:\s*true\b/m.test(dataText);
if (works && !codeOn) {
  console.log(`
The 6-digit code at sign-up is OFF (new accounts work right away, and the desk
confirms the mobile number). Now that messages work, it can be turned back on:
new users then get a code by text or email to confirm their number.`);
  if (await yes("Turn the 6-digit code at sign-up back on?")) {
    writeFileSync(dataFile, dataText.replace(/^(\s*signupCode:\s*)false\b/m, "$1true"));
    console.log("  The sign-up code is ON.");
  }
} else if (!works && (emailOn || smsOn)) {
  console.log("\nSomething didn't work (see the XX lines above). Run this helper again to fix it. The sign-up code stays off.");
}

/* ---------- restart the website ---------- */
if (!flag("no-restart")) {
  const running = await fetch(`http://127.0.0.1:${process.env.PORT || 8360}/api/health`).then((r) => r.ok).catch(() => false);
  if (running && await yes("\nRestart the website now so it uses these settings?")) {
    spawn("cmd.exe", ["/c", "start", '""', "/min", `"${path.join(ROOT, "Start QCPL Lost and Found.bat")}"`], { cwd: ROOT, detached: true, stdio: "ignore", env: { ...process.env, QCPL_NO_BROWSER: "1" }, windowsVerbatimArguments: true }).unref();
    console.log("  The website is restarting (about 10 seconds).");
  } else if (!running) console.log("\nStart the website with \"Start QCPL Lost and Found.bat\" to use these settings.");
}
console.log("\nDone.");
rl.close();
