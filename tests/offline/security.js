ORG.signupCode = true;
// Proves each protection added in the audit actually works.
const W = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const ok = (name, cond, extra) => { out[name] = cond ? "PASS" : "FAIL" + (extra !== undefined ? " — " + JSON.stringify(extra).slice(0, 200) : ""); };
const tryErr = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const tryErrA = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const reset = async () => { Object.keys(localStorage).forEach((k) => k.startsWith("qcpllf_") && k !== "qcpllf_clean_v1" && localStorage.removeItem(k)); sessionStorage.clear(); await LF.setLibrary("main"); };
await reset();
const md = await (await fetch("/README.md", { cache: "no-store" })).text();
const pw = (/`mainadmin` \| `([^`]+)`/.exec(md) || [])[1];
const today = toISODate(new Date());
const go = async (h, ms = 600) => { location.hash = "#/"; await W(120); location.hash = h; await W(ms); };

// Input limits and photo checks
const L = await LF.createLost({ category: "others", itemName: "X".repeat(5000), color: "Blue", description: "D".repeat(9000), dateLost: today, branch: "QCPL Main Library", location: "Reading Area", name: "N".repeat(500), phone: "09181112222", contactPref: "Call me", publicPost: true,
  photos: ["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", ...Array(20).fill("data:image/jpeg;base64,/9j/AAAA")] });
ok("long name cut to 100", L.itemName.length === 100);
ok("long description cut to 1000", L.description.length === 1000);
ok("bad photo links dropped, max 8 photos", L.photos.length === 8 && L.photos.every((p) => p.startsWith("data:image/jpeg")));

// Anti-spam: 10 reports an hour from one device (guest)
let spamErr = null;
for (let i = 0; i < 12 && !spamErr; i++) spamErr = await tryErr(() => LF.createFound({ title: "Pen " + i, category: "books", color: "Blue", date: today, branch: "QCPL Main Library", location: "Reading Area", handover: "Already at the office", finderName: "F", finderPhone: "09170000000" }));
ok("11th report in an hour is refused", /Too many in a short time/.test(spamErr || ""), spamErr);

// Duplicate claim
localStorage.removeItem("qcpllf_rate");
const F = LF.db.all("found")[0];
await LF.createClaim({ itemId: F.id, name: "Ana", phone: "09171112222", general: "blue pen", specific: "x", dateLost: today });
ok("second claim on same item is refused", /already sent a claim/.test(await tryErr(() => LF.createClaim({ itemId: F.id, name: "Ana", phone: "0917 111 2222", general: "blue pen", specific: "x", dateLost: today })) || ""));

// Sign-in lockout
await LF.register({ name: "Tess Tan", phone: "09179990000", email: "", password: "tesspass12", role: USER_ROLES[0], memberId: "" });
await LF.confirmSignupCode((await LF.sendSignupCode({ demo: true })).demoCode);
await LF.signOut();
for (let i = 0; i < 5; i++) await tryErrA(() => LF.signIn("user", "09179990000", "wrong" + i));
const locked = await tryErrA(() => LF.signIn("user", "09179990000", "tesspass12"));
ok("6th sign-in is locked even with the right password", /Too many wrong tries/.test(locked || ""), locked);
localStorage.removeItem("qcpllf_signinfails");
ok("after the wait, the right password works", !(await tryErrA(() => LF.signIn("user", "09179990000", "tesspass12"))) && !!LF.currentUser());

// Idle sign-out
const sess = JSON.parse(localStorage.getItem("qcpllf_session"));
localStorage.setItem("qcpllf_session", JSON.stringify({ ...sess, at: Date.now() - 31 * 60000 }));
ok("idle 31 minutes → signed out", !LF.currentUser() && LF.takeIdleSignout() === true);

// Sign-out forgets unlocked reports
LF.unlockCertificate("F-TEST"); await LF.signOut();
ok("sign-out clears unlocked reports", !sessionStorage.getItem("qcpllf_certs"));

// Staff idle sign-out
await LF.signIn("admin", "mainadmin", pw);
const st = JSON.parse(sessionStorage.getItem("qcpllf_staff"));
sessionStorage.setItem("qcpllf_staff", JSON.stringify({ ...st, at: Date.now() - 21 * 60000 }));
ok("staff idle 21 minutes → signed out", !LF.currentStaff());
LF.takeIdleSignout();

// Sign-up code: wait between codes, wrong tries are kept across "Send again"
await LF.register({ name: "Rico Reyes", phone: "09178880000", email: "", password: "ricopass12", role: USER_ROLES[0], memberId: "" });
const c1 = await LF.sendSignupCode({ demo: true });
const c2 = await LF.sendSignupCode({ demo: true, fresh: true });
ok("Send again within 60 s gives the same code", c1.demoCode === c2.demoCode && c2.wait > 0);
for (let i = 0; i < 8; i++) await tryErrA(() => LF.confirmSignupCode("000000"));
const v = JSON.parse(localStorage.getItem("qcpllf_verifies")); const uid = Object.keys(v)[0]; v[uid].at -= 61000; localStorage.setItem("qcpllf_verifies", JSON.stringify(v));
const c3 = await LF.sendSignupCode({ demo: true, fresh: true });
ok("wrong tries still count after a new code", /Too many wrong tries/.test((await tryErrA(() => LF.confirmSignupCode(c3.demoCode))) || ""));

// Password reset: same answer for unknown accounts
const unknown = await tryErrA(() => LF.verifyResetCode("09170000999", "123456"));
await LF.requestPasswordReset("09179990000", { demo: true });
const wrong = await tryErrA(() => LF.verifyResetCode("09179990000", "123456"));
ok("reset: unknown account and wrong code look the same", unknown && unknown === wrong, [unknown, wrong]);

// Check Status: 5 wrong → locked
await go("#/status");
for (let i = 0; i < 6; i++) { document.querySelector("#sref").value = "L-MN-260101-" + (1000 + i); document.querySelector("#sphone").value = "1234"; const sf = document.querySelector("#statusForm"); delete sf.dataset.busyUntil; sf.requestSubmit(); await W(60); }
ok("Check Status locks after 5 wrong tries", /Too many wrong tries/.test(document.querySelector("#statusResult").innerText), document.querySelector("#statusResult").innerText.slice(0, 80));
localStorage.removeItem("qcpllf_signinfails");

// ID and wallet photos are hidden from the public
localStorage.removeItem("qcpllf_rate");
const img = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const Wl = await LF.createFound({ title: "Brown wallet with ID", category: "wallets", color: "Brown", date: today, branch: "QCPL Main Library", location: "Reading Area", handover: "Already at the office", finderName: "F", finderPhone: "09170000001", photos: [img] });
const Um = await LF.createFound({ title: "Green umbrella", category: "others", color: "Green", date: today, branch: "QCPL Main Library", location: "Reading Area", handover: "Already at the office", finderName: "F", finderPhone: "09170000002", photos: [img] });
await LF.signIn("admin", "mainadmin", pw); await LF.setStatus("found", Wl.id, "recorded"); await LF.setStatus("found", Um.id, "recorded"); await LF.signOut();
await go("#/browse", 900);
const cards = [...document.querySelectorAll(".item-card, article")];
const cardOf = (t) => cards.find((c) => c.innerText.includes(t));
ok("public: wallet photo hidden", cardOf("Brown wallet") && !cardOf("Brown wallet").querySelector("img"), !!cardOf("Brown wallet"));
ok("public: umbrella photo shown", cardOf("Green umbrella") && !!cardOf("Green umbrella").querySelector("img"));

// Desk staff can't mark a found item returned (must use the release form)
await LF.signIn("admin", "mainadmin", pw);
await LF.createStaff({ name: "Desk Dina", username: "dina.desk", role: STAFF_ROLES.find((r) => r !== "Supervisor") || STAFF_ROLES[0], password: "deskpass123" });
await LF.signOut();
await LF.signIn("admin", "dina.desk", "deskpass123");
ok("desk staff: returned is refused", /release form/.test(await tryErr(() => LF.setStatus("found", Um.id, "returned")) || ""), LF.currentStaff() && LF.currentStaff().level);
ok("temporary staff password blocks the admin area", (await go("#/staff/dashboard", 700), /Choose your own password first/.test(document.querySelector("#staffMain").innerText)));
document.querySelector("#dialog [data-close]")?.click();
await LF.signOut();

// Bot trap on the report form
const setW = (n, v) => { const el = document.querySelector(`#wiz [name="${n}"]`); if (!el) return; if (el.type === "radio" || el.type === "checkbox") { (document.querySelector(`#wiz [name="${n}"][value="${v}"]`) || el).click(); } else { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } };
const next = async () => { document.querySelector("#wizForm").requestSubmit(); await W(250); };
async function walkLost({ website = "", pauseMs = 0, phone = "09171112222" }) {
  localStorage.removeItem("qcpllf_rate");
  await go("#/report-lost", 800);
  if (website) document.querySelector("#f-lfhp").value = website;
  setW("category", "accessories"); setW("itemName", "Silver watch"); await next();
  await next();                                    // reward step: no reward
  setW("branch", "QCPL Main Library"); setW("location", "Reading Area"); await next();
  setW("name", "Ana Cruz"); setW("phone", phone); setW("consent", "on"); await next();
  if (pauseMs) await W(pauseMs);
  const before = LF.db.all("lost").length;
  await next();                                    // send
  return { saved: LF.db.all("lost").length - before, err: document.querySelector("#saveErr")?.innerText || "" };
}
const bot1 = await walkLost({ website: "http://spam.example" , pauseMs: 4500 });
ok("bot that fills the hidden box can't send a report", bot1.saved === 0 && /not sent/.test(bot1.err), bot1);
const bot2 = await walkLost({});
ok("bot that finishes in under 4 seconds can't send", bot2.saved === 0 && /not sent/.test(bot2.err), bot2);
const human = await walkLost({ pauseMs: 4500, phone: "09171119999" });
ok("a real person's report is sent", human.saved === 1, human);

// Phone number rules
await go("#/register", 700);
const rf = document.querySelector("#regForm");
const set = (id, val) => (document.querySelector("#" + id).value = val);
set("rName", "Lito Lim"); set("rPhone", "8922 4060"); set("rPw", "litopass12"); set("rPw2", "litopass12"); document.querySelector("#rOk").checked = true;
await W(2600); rf.requestSubmit(); await W(300);
ok("landline number refused at sign-up", /mobile number/.test(rf.querySelector(".auth-err").innerText));

// Storage full: a claim must say so instead of pretending
await LF.signIn("admin", "mainadmin", pw);
const filler = "x".repeat(1024 * 1024);
let n = 0; try { for (; n < 30; n++) localStorage.setItem("qcpllf_zfill" + n, filler); } catch {}
let m = 0; for (const size of [65536, 4096, 256, 16]) { try { for (;; m++) localStorage.setItem("qcpllf_zsmall" + m, "x".repeat(size)); } catch { m++; } }
await LF.signOut(); localStorage.removeItem("qcpllf_rate");
const claimErr = await tryErr(() => LF.createClaim({ itemId: Um.id, name: "Ben", phone: "09175554444", general: "green umbrella " + "y".repeat(200), specific: "z".repeat(900), dateLost: today }));
for (let i = 0; i <= n; i++) localStorage.removeItem("qcpllf_zfill" + i);
for (let i = 0; i <= m; i++) localStorage.removeItem("qcpllf_zsmall" + i);
ok("full storage: claim says it was not saved", /no more room/.test(claimErr || ""), claimErr);

return out;
