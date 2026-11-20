// The administrator sign-in: its own address, separate from users, and (optionally) only from allowed networks.
import { randomBytes } from "node:crypto";
import { startServer, setupHead } from "../lib/server.mjs";
import { adminNetworkCheck } from "../../server/backend/api.mjs";

const out = {}; let fails = 0;
const ok = (n, c, x) => { out[n] = c ? "PASS" : "FAIL " + JSON.stringify(x === undefined ? "" : x).slice(0, 200); if (!c) fails++; };
const PORT = 8371, ORIGIN = `http://localhost:${PORT}`;
class Br {
  constructor(url, from, extra = {}) { this.url = url; this.from = from; this.extra = extra; this.cookie = ""; this.csrf = ""; }
  async req(m, p, body) {
    const r = await fetch(this.url + p, { method: m, redirect: "manual", headers: { ...this.extra, ...(this.from ? { "X-Forwarded-For": this.from } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body ? { "Content-Type": "application/json", Origin: ORIGIN, "X-CSRF": this.csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie()) if (/qcpl_sid=/.test(c)) this.cookie = c.split(";")[0];
    const d = await r.json().catch(() => ({})); if (d.csrf) this.csrf = d.csrf; if (d.session && d.session.csrf) this.csrf = d.session.csrf;
    return { s: r.status, d, loc: r.headers.get("location") };
  }
  act(name, ...args) { return this.req("POST", "/api/v1/act", { name, args, library: "main" }); }
}
const pw = randomBytes(12).toString("base64url");

// ---------- The address ----------
let srv = await startServer({ port: PORT });
await setupHead(srv.url, { username: "head", password: pw });
const r = await new Br(srv.url).req("GET", "/admin");
ok("/admin leads to the administrator sign-in", r.s === 302 && r.loc === "/#/staff", r);
const home = await (await fetch(srv.url + "/")).text();
ok("the home page has no link to the admin sign-in", ![...home.matchAll(/href="([^"]*)"/g)].some((m) => /staff|admin/i.test(m[1])) && !/Administrator sign in|as=admin/i.test(home));
const setupNow = await new Br(srv.url).req("GET", "/setup");
ok("after setup, /setup points to the admin sign-in", setupNow.s === 303 && setupNow.loc === "/admin", setupNow);
// a user's details don't open the admin area, and an admin's don't work as a user
const u = new Br(srv.url); await u.req("GET", "/api/v1/session");
await u.act("register", { name: "Ana User", phone: "09171230000", email: "", password: "anapass123", role: "Library member", memberId: "" });
await u.act("signOut");
ok("a user's details don't sign in as an administrator", (await u.act("signIn", "admin", "09171230000", "anapass123")).s === 400);
ok("an administrator's details don't sign in as a user", (await u.act("signIn", "user", "head", pw)).s === 400);
const a = new Br(srv.url); await a.req("GET", "/api/v1/session");
ok("anywhere (no setting): the administrator signs in", (await a.act("signIn", "admin", "head", pw)).s === 200);
await srv.stop();

// ---------- ADMIN_NETWORKS ----------
srv = await startServer({ port: PORT, env: { ADMIN_NETWORKS: "local", TRUST_PROXY: "1" } });
await setupHead(srv.url, { username: "head", password: pw });
const lan = new Br(srv.url, "192.168.1.20"); await lan.req("GET", "/api/v1/session");
ok("local setting: sign-in from the library network works", (await lan.act("signIn", "admin", "head", pw)).s === 200);
const net = new Br(srv.url, "203.0.113.9"); await net.req("GET", "/api/v1/session");
const refused = await net.act("signIn", "admin", "head", pw);
ok("local setting: sign-in from the internet is refused", refused.s === 403 && /isn't available from this network/.test(refused.d.error || ""), refused);
const guestFromNet = new Br(srv.url, "203.0.113.9"); await guestFromNet.req("GET", "/api/v1/session");
ok("local setting: users can still use the site from anywhere", (await guestFromNet.act("register", { name: "Ben", phone: "09171239999", email: "", password: "benpass123", role: "Library member", memberId: "" })).s === 200);
// a signed-in administrator session carried to another network loses its rights
const moved = new Br(srv.url, "203.0.113.9"); moved.cookie = lan.cookie; moved.csrf = lan.csrf;
const sess = await moved.req("GET", "/api/v1/session");
ok("an administrator session used from outside loses its rights", !sess.d.staff, sess.d.staff);
ok("…and staff data isn't sent there", ((await moved.req("GET", "/api/v1/sync")).d.data.qcpllf_activity || []).length === 0);
ok("…and backups can't be reached from there", (await moved.req("GET", "/api/v1/admin/backups")).s === 403);
await srv.stop();

// ---------- a visitor can't fake a library address ----------
srv = await startServer({ port: PORT, env: { ADMIN_NETWORKS: "local", TRUST_PROXY: "1" } });
await setupHead(srv.url, { username: "head", password: pw });
const chain = new Br(srv.url, "192.168.1.5, 203.0.113.9"); await chain.req("GET", "/api/v1/session"); // the visitor typed the first one
ok("behind a proxy, a typed-in library address is ignored (the proxy's own entry counts)", (await chain.act("signIn", "admin", "head", pw)).s === 403);
await srv.stop();
srv = await startServer({ port: PORT, env: { ADMIN_NETWORKS: "local", TRUST_PROXY: "cloudflare" } });
await setupHead(srv.url, { username: "head", password: pw });
const fakeXff = new Br(srv.url, "192.168.1.5", { "CF-Connecting-IP": "203.0.113.9" }); await fakeXff.req("GET", "/api/v1/session");
ok("Cloudflare: a faked X-Forwarded-For is ignored; Cloudflare's own address counts", (await fakeXff.act("signIn", "admin", "head", pw)).s === 403);
const lanCf = new Br(srv.url, null, { "CF-Connecting-IP": "192.168.1.20" }); await lanCf.req("GET", "/api/v1/session");
ok("Cloudflare: a real library-network visitor can sign in", (await lanCf.act("signIn", "admin", "head", pw)).s === 200);
const viaTunnel = await fetch(srv.url + "/setup", { headers: { "CF-Connecting-IP": "203.0.113.9" }, redirect: "manual" });
ok("Cloudflare: /setup still isn't treated as this computer", viaTunnel.status === 303 || viaTunnel.status === 403, viaTunnel.status);
await srv.stop();

// ---------- the rule itself ----------
const chk = adminNetworkCheck("local, 203.177.42.10, 112.198.");
ok("rule: this computer", chk("127.0.0.1") && chk("::1") && chk("::ffff:127.0.0.1"));
ok("rule: private networks", chk("192.168.0.5") && chk("10.1.2.3") && chk("172.16.0.1") && chk("172.31.255.1") && !chk("172.32.0.1"));
ok("rule: listed address and start of address", chk("203.177.42.10") && !chk("203.177.42.11") && chk("112.198.5.6") && !chk("112.19.5.6"));
ok("rule: empty means anywhere", adminNetworkCheck("")("8.8.8.8") && adminNetworkCheck("anywhere")("8.8.8.8"));

console.log(JSON.stringify(out, null, 1));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
