/* ==========================================================================
   QCPL Lost & Found — settings test
   Reads server/.env and tries each feature for real:
     Email  — signs in to the mail service and sends one test email to TEST_EMAIL
     SMS    — checks the Semaphore key and credits; sends one text if TEST_PHONE is set
     Photos — asks Claude for a one-word reply to check the API key
   Run:  double-click "Test email and text.bat"   (or: cd server → node check.mjs)
   Nothing secret is printed.
   ========================================================================== */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let hasFile = true;
try {
  for (const line of readFileSync(process.env.QCPL_ENV_FILE || path.join(HERE, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { hasFile = false; }
const env = process.env;

const say = (mark, text) => console.log(`  ${mark}  ${text}`);
const head = (t) => console.log(`\n${t}\n${"-".repeat(t.length)}`);
/* Example text left in a setting, e.g. "your 16-letter app password" */
const looksLikeExample = (v) => /\byour\b|16-letter|youraddress|example\.com|xxxx|<.*>$/i.test(v || "") && !/^.+<[^<>\s]+@[^<>\s]+>$/.test(v || "");
const results = [];
const done = (name, state) => results.push([name, state]);

console.log("QCPL Lost & Found — testing the settings in server\\.env");
if (!hasFile) {
  console.log("\nThere is no server\\.env file yet. Start the website once (it creates the file), fill it in, and run this test again.");
  process.exit(1);
}

/* ---------------- Email ---------------- */
head("Email");
await (async () => {
  const need = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
  const missing = need.filter((k) => !env[k]);
  if (missing.length === need.length) { say("--", "Not set up. Updates will stay on the website only."); return done("Email", "not set up"); }
  if (missing.length) { say("XX", `These lines are still empty: ${missing.join(", ")}`); return done("Email", "NOT WORKING"); }
  const fake = [...need, "MAIL_FROM"].filter((k) => looksLikeExample(env[k]));
  if (fake.length) { say("XX", `These lines still hold the example text, not your real details: ${fake.join(", ")}`); return done("Email", "NOT WORKING"); }

  const gmail = /gmail\.com$/i.test(env.SMTP_HOST);
  const pass = gmail ? env.SMTP_PASS.replace(/\s+/g, "") : env.SMTP_PASS;
  const port = Number(env.SMTP_PORT || 465);
  const { default: nodemailer } = await import("nodemailer");
  const mailer = nodemailer.createTransport({ host: env.SMTP_HOST, port, secure: port === 465, auth: { user: env.SMTP_USER, pass }, connectionTimeout: 15000 });
  try {
    await mailer.verify();
    say("OK", `Signed in to ${env.SMTP_HOST}.`);
  } catch (err) {
    say("XX", "Could not sign in to the mail service.");
    if (err.code === "EAUTH") say("  ", gmail ? "Google refused the password. SMTP_PASS must be a 16-letter App password, not your normal Gmail password." : "The service refused SMTP_USER or SMTP_PASS. Copy them again from the provider's SMTP page.");
    else if (["ESOCKET", "ETIMEDOUT", "ECONNECTION", "EDNS", "ENOTFOUND"].includes(err.code)) say("  ", `Could not reach ${env.SMTP_HOST} on port ${port}. Check SMTP_HOST, SMTP_PORT and your internet connection.`);
    say("  ", `Details: ${err.message.split("\n")[0]}`);
    return done("Email", "NOT WORKING");
  }
  const to = env.TEST_EMAIL || (/@/.test(env.SMTP_USER) && !/brevo|smtp-/i.test(env.SMTP_USER) ? env.SMTP_USER : "");
  if (!to) { say("--", "Sign-in works. To also send a test email, fill in TEST_EMAIL and run this again."); return done("Email", "sign-in works, no test email sent"); }
  const from = env.MAIL_FROM || `QCPL Lost & Found <${env.SMTP_USER}>`;
  try {
    const info = await mailer.sendMail({ from, to, subject: "[QCPL Lost & Found] Test email", text: "This is a test from the QCPL Lost & Found website.\n\nIf you can read this, email updates are working." });
    say("OK", `Test email sent to ${to}. Check the inbox (and the Spam folder).`);
    if (info.rejected && info.rejected.length) say("!!", `The service rejected: ${info.rejected.join(", ")}`);
    done("Email", "working");
  } catch (err) {
    say("XX", "Signed in, but the test email was refused.");
    say("  ", /sender|from/i.test(err.message) ? "The sender address in MAIL_FROM is not accepted. In Brevo, it must be an address you verified under Senders." : `Details: ${err.message.split("\n")[0]}`);
    done("Email", "NOT WORKING");
  }
})();

/* ---------------- SMS ---------------- */
head("Text messages (SMS)");
await (async () => {
  const key = env.SEMAPHORE_API_KEY;
  if (!key) { say("--", "Not set up. No text messages will be sent."); return done("SMS", "not set up"); }
  if (looksLikeExample(key)) { say("XX", "SEMAPHORE_API_KEY still holds the example text."); return done("SMS", "NOT WORKING"); }
  try {
    const res = await fetch("https://api.semaphore.co/api/v4/account?apikey=" + encodeURIComponent(key), { signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.credit_balance === undefined) { say("XX", `Semaphore did not accept the API key. Copy it again from your Semaphore dashboard.`); return done("SMS", "NOT WORKING"); }
    say("OK", `Semaphore key accepted. Account: ${body.account_name || "—"}. Credits left: ${body.credit_balance}.`);
    if (Number(body.credit_balance) <= 0) say("!!", "The account has no credits, so texts will not go out until you add some.");
  } catch (err) { say("XX", `Could not reach Semaphore: ${err.message}`); return done("SMS", "NOT WORKING"); }

  const d = String(env.TEST_PHONE || "").replace(/\D/g, "");
  const number = /^09\d{9}$/.test(d) ? "63" + d.slice(1) : /^639\d{9}$/.test(d) ? d : null;
  if (!env.TEST_PHONE) { say("--", "To also send a test text (uses 1 credit), fill in TEST_PHONE and run this again."); return done("SMS", "key works, no test text sent"); }
  if (!number) { say("XX", "TEST_PHONE is not a Philippine mobile number. Example: 09171234567"); return done("SMS", "key works, test number is wrong"); }
  try {
    const params = new URLSearchParams({ apikey: key, number, message: "QCPL Lost&Found: this is a test. Text updates are working." });
    if (env.SEMAPHORE_SENDER) params.set("sendername", env.SEMAPHORE_SENDER);
    const res = await fetch("https://api.semaphore.co/api/v4/messages", { method: "POST", body: params, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (!res.ok || /"?error"?|invalid|not (?:valid|allowed)/i.test(text) && !/"message_id"/.test(text)) { say("XX", `Semaphore refused the text: ${text.slice(0, 200)}`); return done("SMS", "NOT WORKING"); }
    say("OK", `Test text sent to ${env.TEST_PHONE}. It can take a minute to arrive.`);
    done("SMS", "working");
  } catch (err) { say("XX", `Could not send the text: ${err.message}`); done("SMS", "NOT WORKING"); }
})();

/* ---------------- Claude ---------------- */
head("Online photo reading (Claude)");
await (async () => {
  if (!env.ANTHROPIC_API_KEY) { say("--", "Not set up. Photos are read on the device only (no brands or text)."); return done("Photo reading", "not set up"); }
  if (looksLikeExample(env.ANTHROPIC_API_KEY)) { say("XX", "ANTHROPIC_API_KEY still holds the example text."); return done("Photo reading", "NOT WORKING"); }
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ timeout: 30000, maxRetries: 0 });
    const model = /const MODEL = "([^"]+)"/.exec(readFileSync(path.join(HERE, "server.mjs"), "utf8"))[1];
    await client.messages.create({ model, max_tokens: 16, messages: [{ role: "user", content: "Reply with the single word OK." }] });
    say("OK", `The API key works with the model ${model}.`);
    done("Photo reading", "working");
  } catch (err) {
    const s = err.status;
    say("XX", s === 401 ? "Anthropic did not accept the API key. Copy it again from console.anthropic.com." : s === 403 || s === 404 ? "The key works, but this account cannot use the model set in server.mjs." : s === 400 && /credit|billing/i.test(err.message) ? "The key works, but the account has no credits. Add credits at console.anthropic.com." : `Could not reach Claude: ${String(err.message).split("\n")[0].slice(0, 200)}`);
    done("Photo reading", "NOT WORKING");
  }
})();

head("Summary");
for (const [name, state] of results) console.log(`  ${name.padEnd(14)} ${state}`);
console.log(results.some(([, s]) => s.startsWith("NOT")) ? "\nFix the lines marked XX in server\\.env, save, and run this test again."
  : results.every(([, s]) => s === "not set up") ? "\nNothing is set up yet. Open server\\.env with Notepad, fill in what you want to turn on, save, and run this test again." : "\nRestart the website (Start QCPL Lost and Found.bat) so it uses these settings.");
process.exitCode = results.some(([, s]) => s.startsWith("NOT")) ? 1 : 0;
