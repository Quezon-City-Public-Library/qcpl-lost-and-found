import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path"; import { tmpdir } from "node:os";
const B = "http://127.0.0.1:8371", ORIGIN = "http://localhost:8371";
const out = {}; let fails = 0; const ok = (n, c, x) => { out[n] = c ? "PASS" : "FAIL " + JSON.stringify(x === undefined ? "" : x).slice(0, 300); if (!c) fails++; };
class Br { constructor() { this.cookie = ""; this.csrf = ""; }
  async req(method, p, body) { const r = await fetch(B + p, { method, headers: { ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body ? { "Content-Type": "application/json", Origin: ORIGIN, "X-CSRF": this.csrf } : {}) }, body: body ? JSON.stringify(body) : undefined }); for (const c of r.headers.getSetCookie()) if (/qcpl_sid=/.test(c)) this.cookie = c.split(";")[0]; const buf = Buffer.from(await r.arrayBuffer()); let d; try { d = JSON.parse(buf.toString()); } catch { d = null; } if (d && d.csrf) this.csrf = d.csrf; if (d && d.session && d.session.csrf) this.csrf = d.session.csrf; return { status: r.status, d, buf, headers: r.headers }; }
  act(name, lib, ...args) { return this.req("POST", "/api/v1/act", { name, args, library: lib, lang: "en" }); } }
const readX = (buf, name) => { const f = path.join(tmpdir(), name); writeFileSync(f, buf); return JSON.parse(execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", new URL("../lib/read-xlsx.ps1", import.meta.url).pathname.replace(/^\/(\w:)/, "$1").replace(/%20/g, " "), f], { encoding: "utf8" }).trim()); };
const today = new Date().toISOString().slice(0, 10);
const pw = randomBytes(15).toString("base64url");
const page = await (await fetch(B + "/setup")).text(); const t = (/name="t" value="([^"]+)"/.exec(page) || [])[1];
await fetch(B + "/setup", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, name: "Head Admin", username: "head", password: pw, password2: pw }) });
// Records in two libraries
for (const [lib, who] of [["main", "Ana Main"], ["d1", "Dino District"]]) {
  const g = new Br(); await g.req("GET", "/api/v1/session");
  await g.act("createLost", lib, { category: "others", itemName: "Umbrella " + lib, color: "Blue", dateLost: today, branch: "x", location: "Reading Area", name: who, phone: "0917" + (lib === "main" ? "1112222" : "3334444"), contactPref: "Call me" });
  await g.act("createFound", lib, { title: "Wallet " + lib, category: "wallets", color: "Black", privateDetails: "Private " + lib, date: today, branch: "x", location: "Reading Area", handover: "Already at the office", finderName: "Finder " + lib, finderPhone: "09170000001" });
}
const head = new Br(); await head.req("GET", "/api/v1/session"); await head.act("signIn", "main", "admin", "head", pw);
await head.act("createStaff", "main", { name: "Main Sup", username: "mainsup", role: "Supervisor", password: "MainSup-pass-123" });
await head.act("createStaff", "main", { name: "Main Desk", username: "maindesk", role: "Desk staff", password: "MainDesk-pass-123" });
const guest = new Br(); await guest.req("GET", "/api/v1/session");
ok("visitors can't export", (await guest.req("GET", "/api/v1/admin/export.xlsx")).status === 403);
const desk = new Br(); await desk.req("GET", "/api/v1/session"); await desk.act("signIn", "main", "admin", "maindesk", "MainDesk-pass-123"); await desk.act("changeStaffPassword", "main", "MainDesk-pass-123", "MainDesk-own-456");
ok("desk staff can't export", (await desk.req("GET", "/api/v1/admin/export.xlsx")).status === 403);
const sup = new Br(); await sup.req("GET", "/api/v1/session"); await sup.act("signIn", "main", "admin", "mainsup", "MainSup-pass-123");
ok("a supervisor with a temporary password can't export yet", (await sup.req("GET", "/api/v1/admin/export.xlsx")).status === 403);
await sup.act("changeStaffPassword", "main", "MainSup-pass-123", "MainSup-own-456");
const e1 = await sup.req("GET", "/api/v1/admin/export.xlsx?library=all");
ok("supervisor export downloads an .xlsx", e1.status === 200 && /spreadsheetml/.test(e1.headers.get("content-type")) && /attachment; filename="QCPL-Lost-and-Found-main-/.test(e1.headers.get("content-disposition")), e1.headers.get("content-disposition"));
ok("no password data in the file", !/passHash|scrypt\$/.test(e1.buf.toString("latin1")));
const x1 = readX(e1.buf, "qcpl-sup.xlsx");
ok("Excel opens it, with all 9 sheets", x1.ok && Object.keys(x1.sheets).length === 9, x1);
ok("a library supervisor gets only their library (even when asking for all)", JSON.stringify(x1.libraries) === JSON.stringify(["QCPL Main Library"]) && x1.sheets["Lost reports"] === 1, x1);
ok("staff see the full details they are allowed (owner, private details)", x1.lostOwner === "Ana Main" && x1.foundPrivate === "Private main", x1);
ok("users sheet has no password column", !/pass/i.test(x1.userHeaders), x1.userHeaders);
const e2 = await head.req("GET", "/api/v1/admin/export.xlsx?library=all");
const x2 = readX(e2.buf, "qcpl-head-all.xlsx");
ok("head office: all libraries", x2.ok && x2.sheets["Lost reports"] === 2 && x2.libraries.length === 2 && x2.summaryScope === "All libraries", x2);
const e3 = await head.req("GET", "/api/v1/admin/export.xlsx?library=d1");
const x3 = readX(e3.buf, "qcpl-head-d1.xlsx");
ok("head office: one chosen library", x3.ok && x3.sheets["Lost reports"] === 1 && x3.lostOwner === "Dino District", x3);
const act = (await head.req("GET", "/api/v1/sync?library=main")).d.data.qcpllf_activity;
ok("every export is in the activity log", act.filter((a) => /exported to Excel/.test(a.action)).length >= 2, act.map((a) => a.action).slice(0, 5));
console.log(JSON.stringify(out, null, 1)); console.log(fails ? fails + " FAILED" : "ALL PASSED");
