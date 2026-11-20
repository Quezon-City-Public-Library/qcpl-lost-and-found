// Keeping personal information only as long as the Privacy Policy says (ORG.privacy), on a throwaway database.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ROOT } from "../lib/server.mjs";
import { openDb } from "../../server/backend/db.mjs";
import { createEngine } from "../../server/backend/engine.mjs";
import { passwords } from "../../server/backend/auth.mjs";
import { runPrivacyJobs } from "../../server/backend/privacy.mjs";

const out = {}; let fails = 0;
const ok = (n, c, x) => { out[n] = c ? "PASS" : "FAIL " + JSON.stringify(x === undefined ? "" : x).slice(0, 240); if (!c) fails++; };
const DAY = 86_400_000, today = new Date().toISOString().slice(0, 10);
const dir = mkdtempSync(path.join(tmpdir(), "qcpl-privacy-"));
const store = openDb(path.join(dir, "qcpl.db"));
const engine = createEngine({ root: ROOT, store, notify: async () => ({}), channels: () => ({ email: false, sms: false }), passwords, demoCodes: false, strict: true });
const guest = (ip = "10.0.0.1") => ({ ip, library: "main", lang: "en", unlocked: [] });
const run = async (ctx, fn) => (await engine.exec(ctx, fn));

// A supervisor (made the way /setup makes one), then signed in
const pw = randomBytes(12).toString("base64url");
const passHash = await passwords.hash("lf-staff", pw);
await run(guest(), (LF, data) => { data.put("qcpllf_staffaccts", [{ id: "S1", username: "sup", name: "Sup Ervisor", role: "Supervisor", library: "all", passHash, active: true, mustChange: false, createdAt: new Date().toISOString(), createdBy: "test" }]); });
const staff = (await engine.run("signIn", ["admin", "sup", pw], guest())).identity.staff;
const asStaff = { ...guest(), staff };

// A closed report with a photo, an open report, a user account
const photoId = randomBytes(16).toString("hex");
const closed = (await run(guest("10.0.0.2"), (LF) => LF.createLost({ category: "bags", itemName: "Juan's red backpack", color: "Red", brand: "Jansport", description: "has my name JUAN DELA CRUZ", uniqueDetails: "keychain with my photo", dateLost: today, branch: "QCPL Main Library", location: "Reading Area", name: "Juan Dela Cruz", phone: "09171234567", email: "juan@example.com", contactPref: "Call me", photos: ["/api/v1/photo/" + photoId] }))).result;
store.q.photoPut.run(photoId, "image/png", Buffer.from("png"), 3, "x", "qcpllf_lost", closed.id, Date.now());
await run(asStaff, (LF) => LF.setStatus("lost", closed.id, "closed", "Owner found it"));
const open = (await run(guest("10.0.0.3"), (LF) => LF.createLost({ category: "keys", itemName: "House keys", color: "Silver", dateLost: today, branch: "QCPL Main Library", location: "Restrooms", name: "Maria Open", phone: "09179998888", contactPref: "Call me" }))).result;
await run(guest("10.0.0.4"), (LF) => LF.register({ name: "Old User", phone: "09170001111", email: "", password: "olduser123", role: "Library member", memberId: "" }));
const snap = (k) => engine.snapshot(k);

// Nothing is erased while it is still within the limits
let done = await runPrivacyJobs({ engine, store, at: Date.now() + 100 * DAY });
ok("within the limits nothing is erased", Object.values(done).every((n) => n === 0), done);
ok("…the closed report still has its details", snap("qcpllf_lost").find((l) => l.id === closed.id).name === "Juan Dela Cruz");

// After the limits (ORG.privacy: 365 days for records, 730 for accounts and the log)
done = await runPrivacyJobs({ engine, store, at: Date.now() + 800 * DAY });
const c = snap("qcpllf_lost").find((l) => l.id === closed.id);
const text = JSON.stringify(c);
ok("a closed report keeps only what the statistics need", c && c.anonymized && c.category === "bags" && c.status === "closed" && c.dateLost === today && c.location === "Reading Area", c);
ok("…name, phone, email, descriptions and marks are erased", !/Juan|0917|juan@|JUAN|keychain|backpack/i.test(text), text);
ok("…the item name becomes just the type of item", c.itemName === "Bags & Pouches" || /bag/i.test(c.itemName), c.itemName);
ok("…history keeps only statuses and dates (no names or notes)", c.history.every((h) => Object.keys(h).sort().join() === "at,status"), c.history);
ok("its photo is deleted from the database", !store.q.photoGet.get(photoId) && done.photos === 1, done);
const o = snap("qcpllf_lost").find((l) => l.id === open.id);
ok("an OPEN report is never touched", o && o.name === "Maria Open" && !o.anonymized, o);
ok("old updates sent to people are erased", snap("qcpllf_notifs").length === 0, snap("qcpllf_notifs").length);
const acts = snap("qcpllf_activity");
ok("old activity log entries are erased (only the clean-up's own note is left)", acts.length === 1 && /Privacy clean-up/.test(acts[0].action), acts.map((a) => a.action));
ok("the clean-up is recorded in the activity log", /closed records anonymized/.test(acts[0] && acts[0].detail), acts[0]);
ok("unused accounts are deleted", !snap("qcpllf_users").some((u) => u.name === "Old User"), snap("qcpllf_users").map((u) => u.name));
ok("staff accounts are not touched", snap("qcpllf_staffaccts").length === 1);
ok("the numbers still count the erased report", (await engine.read(asStaff, (LF) => LF.totals())).lost === 2);
const again = await runPrivacyJobs({ engine, store, at: Date.now() + 800 * DAY });
// (the test pretends it is 800 days later, so the clean-up's own note, made today, counts as old)
ok("running again changes nothing more", Object.entries(again).every(([k, n]) => n === 0 || (k === "activity" && n === 1)), again);

store.db.close();
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(out, null, 1));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
