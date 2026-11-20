// "Set up email and text messages" helper, with made-up answers and a throwaway settings file.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SERVER_DIR, ROOT } from "../lib/server.mjs";

const out = {}; let fails = 0;
const ok = (n, c, x) => { out[n] = c ? "PASS" : "FAIL " + JSON.stringify(x === undefined ? "" : x).slice(0, 200); if (!c) fails++; };
const dir = mkdtempSync(path.join(tmpdir(), "qcpl-env-"));
const envFile = path.join(dir, ".env");
const dataBefore = readFileSync(path.join(ROOT, "js", "data.js"), "utf8");
const run = (answers) => spawnSync(process.execPath, ["setup-messages.mjs", "--env", envFile, "--no-check", "--no-restart"], { cwd: SERVER_DIR, input: answers.join("\n") + "\n", encoding: "utf8", timeout: 30000 });
const val = (k) => (new RegExp(`^${k}=(.*)$`, "m").exec(readFileSync(envFile, "utf8")) || [])[1];
const count = (k) => (readFileSync(envFile, "utf8").match(new RegExp(`^${k}=`, "gm")) || []).length;

// 1) Gmail + Semaphore, test email only, don't turn the code on
const fakePass = "abcd efgh ijkl mnop", fakeKey = "semaphore-test-key-123";
let r = run(["1", "not-an-email", "library.test@gmail.com", fakePass, "1", fakeKey, "QCPL", "me@example.com", "", "n"]);
ok("the helper finishes", r.status === 0 && /Done\./.test(r.stdout), (r.stderr || r.stdout).slice(-300));
ok("it asks again when the email address is wrong", (r.stdout.match(/Gmail address:/g) || []).length === 2);
ok("Gmail settings are saved", val("SMTP_HOST") === "smtp.gmail.com" && val("SMTP_PORT") === "465" && val("SMTP_USER") === "library.test@gmail.com" && val("MAIL_FROM") === "QCPL Lost & Found <library.test@gmail.com>");
ok("the app password is saved without spaces", val("SMTP_PASS") === fakePass.replace(/\s+/g, ""));
ok("the SMS key and sender are saved", val("SEMAPHORE_API_KEY") === fakeKey && val("SEMAPHORE_SENDER") === "QCPL");
ok("the test address is saved", val("TEST_EMAIL") === "me@example.com" && val("TEST_PHONE") === "");
ok("passwords and keys are never shown on screen", !r.stdout.includes(fakePass.replace(/\s+/g, "")) && !r.stdout.includes("abcd efgh") && !r.stdout.includes(fakeKey));
ok("each setting appears once (no duplicates)", ["SMTP_HOST", "SMTP_PASS", "SEMAPHORE_API_KEY", "SITE_URL", "TEST_EMAIL"].every((k) => count(k) === 1));
ok("other settings in the file are kept", /^HOST=127\.0\.0\.1$/m.test(readFileSync(envFile, "utf8")) && /BACKUP_COPY_DIR=/.test(readFileSync(envFile, "utf8")));
ok("the sign-up code was left off when the answer was no", readFileSync(path.join(ROOT, "js", "data.js"), "utf8") === dataBefore);

// 2) Run again: keep email, switch to Brevo? No: keep everything as it is
r = run(["4", "2", "", "", "n"]);
ok("running again and keeping everything changes nothing important", r.status === 0 && val("SMTP_HOST") === "smtp.gmail.com" && val("SEMAPHORE_API_KEY") === fakeKey);

// 3) Brevo
r = run(["2", "brevo-login@smtp-brevo.com", "xsmtpsib-key", "desk@library.example", "2", "", "", "n"]);
ok("Brevo settings are saved", val("SMTP_HOST") === "smtp-relay.brevo.com" && val("SMTP_PORT") === "587" && val("SMTP_USER") === "brevo-login@smtp-brevo.com" && val("MAIL_FROM") === "QCPL Lost & Found <desk@library.example>");

// 4) A line break typed into an answer can't add a new setting
copyFileSync(path.join(SERVER_DIR, ".env.example"), envFile);
r = run(["3", "smtp.example.org", "587", "user", "pass\rADMIN_NETWORKS=anywhere", "", "2", "", "n"]);
ok("an answer can't sneak in another setting", count("ADMIN_NETWORKS") === 1 && !/^ADMIN_NETWORKS=anywhere/m.test(readFileSync(envFile, "utf8")));

rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(out, null, 1));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
