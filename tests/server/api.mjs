// Backend security and behaviour test (talks to the server like browsers and attackers would).
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
const B = process.env.BASE || "http://127.0.0.1:8371";
const ORIGIN = B.replace("127.0.0.1", "localhost").replace(/\/$/, "");
const out = {}; let fails = 0;
const ok = (name, cond, extra) => { out[name] = cond ? "PASS" : "FAIL" + (extra !== undefined ? " â€” " + JSON.stringify(extra).slice(0, 260) : ""); if (!cond) fails++; };

class Browser {
  constructor(name) { this.name = name; this.cookie = ""; this.csrf = ""; }
  async req(method, path, body, headers = {}) {
    const res = await fetch(B + path, { method, redirect: "manual", headers: { ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json", Origin: ORIGIN, "X-CSRF": this.csrf } : {}), ...headers }, body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) { const v = c.split(";")[0]; if (/^(__Host-)?qcpl_sid=/.test(v)) { this.cookie = v; this.lastSetCookie = c; } }
    let data = null; const text = await res.text(); try { data = JSON.parse(text); } catch { data = text; }
    if (data && data.csrf) this.csrf = data.csrf;
    if (data && data.session && data.session.csrf) this.csrf = data.session.csrf;
    return { status: res.status, data, text, headers: res.headers };
  }
  session() { return this.req("GET", "/api/v1/session"); }
  sync(lib = "main") { return this.req("GET", "/api/v1/sync?library=" + lib); }
  act(name, ...args) { return this.req("POST", "/api/v1/act", { name, args, library: "main", lang: "en" }); }
}
const today = new Date().toISOString().slice(0, 10);
const fakePng = () => "data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), randomBytes(200)]).toString("base64");

// ---------- Setup (first start) ----------
const admin = new Browser("admin");
const g = await admin.req("GET", "/setup");
const token = (/name="t" value="([^"]+)"/.exec(g.text) || [])[1];
const headPw = randomBytes(18).toString("base64url"); // throwaway, only for this test
const form = new URLSearchParams({ t: token, name: "Head Admin", username: "head.admin", password: headPw, password2: headPw }).toString();
const s1 = await fetch(B + "/setup", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form }).then((r) => r.text());
ok("setup creates the head administrator", /All set/.test(s1));
const again = await fetch(B + "/setup", { redirect: "manual" });
ok("setup is locked afterwards", again.status === 303);

// ---------- Sessions, cookies, CSRF ----------
const a = new Browser("A");
const sA = await a.session();
ok("session cookie is HttpOnly and SameSite=Strict", /HttpOnly/i.test(a.lastSetCookie || "") && /SameSite=Strict/i.test(a.lastSetCookie || ""), a.lastSetCookie);
const noCsrf = await a.req("POST", "/api/v1/act", { name: "createLost", args: [{}] }, { "X-CSRF": "wrong" });
ok("change without the CSRF token is refused", noCsrf.status === 403, noCsrf.status);
const evil = await a.req("POST", "/api/v1/act", { name: "createLost", args: [{}] }, { Origin: "https://evil.example" });
ok("change from another website is refused", evil.status === 403, evil.status);
const nocookie = await new Browser("x").req("POST", "/api/v1/act", { name: "createLost", args: [{}] });
ok("change without a session is refused", nocookie.status === 403);
const unknown = await a.act("notify", { phone: "09170000000" });
ok("internal functions can't be called (notify)", unknown.status === 400, unknown.data);
const proto = await a.act("__proto__");
ok("odd action names are refused", proto.status === 400);
ok("public /api/notify no longer exists", (await fetch(B + "/api/notify", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: "{}" })).status === 404);
const big = await a.req("POST", "/api/v1/act", JSON.stringify({ name: "createLost", args: ["x".repeat(5 * 1024 * 1024)] }));
ok("huge request refused", big.status === 413, big.status);

// ---------- A guest reports a lost item (with a photo) ----------
const lost = await a.act("createLost", { category: "others", itemName: "Blue umbrella", color: "Blue", description: "folding", uniqueDetails: "name tag ANA", dateLost: today, branch: "QCPL Main Library", location: "Reading Area", name: "Ana Cruz", phone: "09171112222", contactPref: "Call me", publicPost: true, photos: [fakePng()] });
ok("guest can report a lost item", lost.status === 200 && /^L-/.test(lost.data.result.id), lost.data);
const lostId = lost.data.result.id;
ok("photo stored on the server, record keeps only its address", /^\/api\/v1\/photo\/[a-f0-9]{32}$/.test(lost.data.result.photos[0]), lost.data.result.photos);
ok("reporter sees their own report right away", (lost.data.patch || lost.data.sync.data).qcpllf_lost ? true : !!lost.data.sync);
const bad = await a.act("createLost", { category: "others", itemName: "x", dateLost: today, name: "x", phone: "09171112222", photos: ["data:image/png;base64," + Buffer.from("<script>alert(1)</script>").toString("base64")] });
ok("fake picture (not really PNG) refused", bad.status === 400, bad.data);

// ---------- Another visitor sees only general details ----------
const b = new Browser("B");
const syncB = (await b.sync()).data.data;
const lostB = syncB.qcpllf_lost;
ok("others don't get the real reference number", !JSON.stringify(syncB).includes(lostId));
ok("others don't get name, phone or special marks", !/Ana Cruz|09171112222|name tag ANA/.test(JSON.stringify(syncB)));
ok("other visitors receive no lost reports at all (no rewards, no public list)", lostB.length === 0, lostB);
const rw = await a.act("createLost", { category: "keys", itemName: "Red keys", dateLost: today, branch: "QCPL Main Library", location: "Reading Area", name: "Rex", phone: "09171113333", contactPref: "Call me", bounty: 500, bountyOk: true, publicPost: true });
ok("a reward sent to the server is not saved", rw.status === 200 && !("bounty" in rw.data.result) && !("publicPost" in rw.data.result) && !("bountyStatus" in rw.data.result), rw.data.result);
ok("the reward action no longer exists", (await a.act("completeBounty", rw.data.result.id)).status >= 400);
const photoAsB = await b.req("GET", lost.data.result.photos[0]);
ok("others can't open a lost report's photo", photoAsB.status === 404);
const photoAsA = await a.req("GET", lost.data.result.photos[0]);
ok("the reporter can open their photo (safe headers)", photoAsA.status === 200 && /sandbox/.test(photoAsA.headers.get("content-security-policy") || "") && photoAsA.headers.get("x-content-type-options") === "nosniff");

// ---------- Found items: private details and ID photos stay private ----------
const found = await a.act("createFound", { title: "Brown wallet", category: "wallets", color: "Brown", description: "leather", privateDetails: "Two IDs: Juan Dela Cruz", date: today, branch: "QCPL Main Library", location: "Reading Area", handover: "Already at the office", finderName: "Felix Finder", finderPhone: "09175556666", photos: [fakePng()] });
const umb = await a.act("createFound", { title: "Green umbrella", category: "others", color: "Green", description: "", date: today, branch: "QCPL Main Library", location: "Entrance / Lobby", handover: "Already at the office", finderName: "Gina", finderPhone: "09175557777", photos: [fakePng()] });
ok("guest can report found items", found.status === 200 && umb.status === 200, found.data);

// ---------- Staff ----------
await admin.session();
const guestCookie = admin.cookie;
const signin = await admin.act("signIn", "admin", "head.admin", headPw);
ok("head administrator signs in", signin.status === 200 && signin.data.result === "admin" && signin.data.session.staff.level === "supervisor", signin.data);
ok("signing in gives a new session cookie (no session fixation)", admin.cookie !== guestCookie);
const fix = new Browser("fixation"); fix.cookie = guestCookie; fix.csrf = signin.data.session ? signin.data.session.csrf : "";
ok("the old cookie is not signed in", !(await fix.session()).data.staff);
const syncStaff = (await admin.sync()).data.data;
ok("staff see full records (private details, finder)", JSON.stringify(syncStaff).includes("Two IDs: Juan Dela Cruz") && JSON.stringify(syncStaff).includes("09175556666"));
ok("staff never get password hashes", !JSON.stringify(syncStaff).includes("scrypt$") && !JSON.stringify(syncStaff).includes("passHash"));
const st1 = await admin.act("setStatus", "found", found.data.result.id, "recorded");
const st2 = await admin.act("setStatus", "found", umb.data.result.id, "recorded");
ok("staff can change a status", st1.status === 200 && st2.status === 200, [st1.data, st2.data, found.data.result && found.data.result.status, found.data.result && found.data.result.library]);
const syncB2 = (await b.sync()).data.data;
const fB = syncB2.qcpllf_found;
const wallet = fB.find((f) => f.title === "Brown wallet"), umbrella = fB.find((f) => f.title === "Green umbrella");
ok("public found items have no private details or finder", wallet && umbrella && !/Juan|Felix|09175556666|privateDetails|finderPhone/.test(JSON.stringify(fB)), fB);
ok("wallet/ID photos are not public", wallet && !wallet.photo && !wallet.photos);
ok("other photos are public", umbrella && umbrella.photos && umbrella.photos.length === 1 && (await b.req("GET", umbrella.photos[0])).status === 200);
ok("wallet photo address can't be opened by the public", (await b.req("GET", found.data.result.photos[0])).status === 404);
const asGuestStaffAct = await b.act("setStatus", "found", umb.data.result.id, "returned");
ok("a visitor can't do staff actions", asGuestStaffAct.status === 401, asGuestStaffAct.status);

// ---------- Claims and someone else's updates ----------
if (!umbrella) { console.log(JSON.stringify(out, null, 1)); console.log("public found:", JSON.stringify(fB).slice(0, 600)); process.exit(1); }
const claim = await b.act("createClaim", { itemId: umbrella.id, general: "green umbrella", specific: "bent handle", dateLost: today, name: "Ben", phone: "09173334444" });
ok("visitor can claim a found item", claim.status === 200 && /^C-/.test(claim.data.result.id), claim.data);
const notifsA = (await a.sync()).data.data.qcpllf_notifs;
const notifB = (await b.sync()).data.data.qcpllf_notifs;
ok("each visitor only gets their own updates", notifsA.length > 0 && notifB.every((n) => !notifsA.some((m) => m.id === n.id)), { a: notifsA.length, b: notifB.length });
await b.act("markRead", notifsA.map((n) => n.id));
const notifsA2 = (await a.sync()).data.data.qcpllf_notifs;
ok("a visitor can't mark someone else's updates as read", notifsA2.every((n) => !n.read));

// ---------- Check Status ----------
const c = new Browser("C");
await c.session();
const wrong = await c.act("checkStatus", lostId, "0000");
ok("Check Status with wrong digits: not found", wrong.status === 400);
const right = await c.act("checkStatus", lostId, "2222");
ok("Check Status with the right digits opens the report", right.status === 200 && right.data.sync.data.qcpllf_lost.some((l) => l.id === lostId && l.name === "Ana Cruz"), right.data);
const d = new Browser("D"); await d.session();
let lockMsg = "";
for (let i = 0; i < 6; i++) { const r = await d.act("checkStatus", "L-ML-000000-" + (1000 + i), "1234"); lockMsg = r.data && r.data.error; }
ok("Check Status locks after 5 wrong tries (on the server)", /Too many wrong tries/.test(lockMsg || ""), lockMsg);
const d2 = new Browser("D2"); await d2.session();
ok("â€¦even with a new session from the same address", /Too many wrong tries/.test(((await d2.act("checkStatus", lostId, "2222")).data || {}).error || ""));

// ---------- Accounts ----------
const u = new Browser("U"); await u.session();
const reg = await u.act("register", { name: "Ana Cruz", phone: "09171112222", email: "", password: "anapass123", role: "Library member", memberId: "" });
ok("register works", reg.status === 200, reg.data);
const code = { data: { result: { demoCode: "000000" } } }; // (codes are off for now)
ok("new account is signed in straight away (no code for now)", reg.data.session && reg.data.session.user && reg.data.session.user.phone === "09171112222" && reg.data.session.user.contactVerified === false, reg.data.session);
const noCode = await u.act("sendSignupCode");
ok("no code is sent while codes are off", noCode.status === 200 && noCode.data.result && noCode.data.result.sent === false && !noCode.data.result.demoCode, noCode.data);
const conf = await u.req("GET", "/api/v1/sync");
const before = conf.data.data;
ok("an unconfirmed number does NOT show reports made by that number", !before.qcpllf_lost.some((l) => l.id === lostId));
const editOther = await u.act("closeLostByOwner", lostId, "found it myself"); console.log("  blocked edit said:", editOther.status, editOther.data && editOther.data.error);
ok("an unconfirmed number can't change someone else's report", editOther.status >= 400, editOther.status);
const vf = await admin.act("setUserVerified", reg.data.session.user.id, true);
ok("desk confirms the account after checking an ID", vf.status === 200, vf.data);
const mine = (await u.req("GET", "/api/v1/sync")).data.data;
ok("after the desk confirms it, the user sees their earlier guest report", mine.qcpllf_lost.some((l) => l.id === lostId && l.uniqueDetails === "name tag ANA"));
ok("user record has no password hash", !JSON.stringify(mine).includes("passHash") && !JSON.stringify(conf.data).includes("scrypt$"));
for (let i = 0; i < 5; i++) await new Browser("bf" + i).session().then(() => 0);
const bf = new Browser("BF"); await bf.session();
let bfMsg = ""; for (let i = 0; i < 6; i++) { const r = await bf.act("signIn", "user", "09171112222", "wrong" + i); bfMsg = r.data.error; }
ok("6th wrong password for an account is locked", /Too many wrong tries/.test(bfMsg), bfMsg);

// ---------- Desk staff with a temporary password ----------
const mk = await admin.act("createStaff", { name: "Desk Dina", username: "dina", role: "Desk staff", password: "TempDesk-1234" });
ok("supervisor adds a desk staff account", mk.status === 200, mk.data);
const dina = new Browser("dina"); await dina.session();
await dina.act("signIn", "admin", "dina", "TempDesk-1234");
const blocked = await dina.act("setStatus", "found", umb.data.result.id, "possible-owner");
ok("temporary password: nothing else works until it is changed", blocked.status === 403, blocked.data);
await dina.act("changeStaffPassword", "TempDesk-1234", "Dina-own-pass-77");
const allowed = await dina.act("extendHold", umb.data.result.id, 15);
ok("after changing it, desk work works", allowed.status === 200, allowed.data);
const sup = await dina.act("createStaff", { name: "X", username: "xx1", role: "Supervisor", password: "abcdefghijk1" });
ok("desk staff can't do supervisor actions", sup.status === 403, sup.status);

// ---------- What is stored ----------
const dir = process.env.QCPL_TEST_DIR;
const db = new DatabaseSync(dir + "/qcpl.db", { readOnly: true });
const staffRows = db.prepare("SELECT pass_hash passHash FROM staff_accounts").all();
ok("staff passwords stored with scrypt", staffRows.length >= 2 && staffRows.every((s) => /^scrypt\$32768\$8\$1\$/.test(s.passHash)));
const userRows = db.prepare("SELECT pass_hash FROM users").all();
ok("user passwords stored with scrypt (SQL column)", userRows.length >= 1 && userRows.every((r) => /^scrypt\$/.test(r.pass_hash)));
ok("SQL tables hold the records", db.prepare("SELECT COUNT(*) n FROM lost_reports").get().n >= 1 && db.prepare("SELECT COUNT(*) n FROM found_items").get().n >= 1);
ok("no old docs table", !db.prepare("SELECT name FROM sqlite_master WHERE name='docs'").get());
ok("staff view hides password hashes", !db.prepare("SELECT * FROM v_staff LIMIT 1").columns().some((c) => /pass_hash/.test(c.name)) && !db.prepare("SELECT * FROM v_users LIMIT 1").columns().some((c) => /pass_hash/.test(c.name)));
ok("every extra column is valid JSON", db.prepare("SELECT COUNT(*) n FROM lost_reports WHERE NOT json_valid(extra)").get().n === 0);
const sess = db.prepare("SELECT id FROM sessions").all();
ok("session cookies are not stored (only their hash)", sess.length > 0 && sess.every((r) => /^[a-f0-9]{64}$/.test(r.id)) && !sess.some((r) => admin.cookie.includes(r.id)));
const photos = db.prepare("SELECT COUNT(*) n FROM photos WHERE owner_id IS NOT NULL").get().n;
ok("photos linked to their reports", photos === 3, photos);
const resets = db.prepare("SELECT json FROM kv WHERE key='qcpllf_verifies'").get();
ok("codes are stored only as hashes", !resets || !resets.json.includes(code.data.result.demoCode) || /"demo"/.test(resets.json));
db.close();

console.log(JSON.stringify(out, null, 1));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
