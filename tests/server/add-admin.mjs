// "Add an admin account" tool (server/add-admin.mjs) on a throwaway database.
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { startServer, setupHead, testEnv, SERVER_DIR } from "../lib/server.mjs";

const out = {}; let fails = 0;
const ok = (n, c, x) => { out[n] = c ? "PASS" : "FAIL " + JSON.stringify(x === undefined ? "" : x).slice(0, 200); if (!c) fails++; };
const PORT = 8371;
const tool = (dir, ...args) => { try { return execFileSync(process.execPath, ["add-admin.mjs", ...args], { cwd: SERVER_DIR, env: { ...process.env, ...testEnv(dir, PORT) }, input: "", encoding: "utf8" }); } catch (e) { return String(e.stdout || "") + String(e.stderr || ""); } };

let srv = await startServer({ port: PORT });
const dir = srv.dir;
ok("first head administrator made with /setup", await setupHead(srv.url, { username: "first.head", password: randomBytes(12).toString("base64url") }));
ok("the tool refuses while the site is running", /site is running/.test(tool(dir, "--username", "x.y", "--name", "X")));
await srv.stop({ keep: true });

const made = tool(dir, "--username", "new.head", "--name", "New Head");
const temp = (/Temporary password:\s+(\S+)/.exec(made) || [])[1] || "";
ok("the tool adds the account", /Head administrator added/.test(made), made.slice(-300));
ok("the temporary password is long and has no look-alike letters", /^[a-km-zA-HJ-NP-Z2-9]{4}(-[a-km-zA-HJ-NP-Z2-9]{4}){3}$/.test(temp));
ok("a username that already exists is refused", /already used/.test(tool(dir, "--username", "first.head", "--name", "X")));

srv = await startServer({ port: PORT, dir });
let cookie = "", csrf = "";
const req = async (m, p, body) => { const r = await fetch(srv.url + p, { method: m, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json", Origin: `http://localhost:${PORT}`, "X-CSRF": csrf } : {}) }, body: body ? JSON.stringify(body) : undefined }); for (const c of r.headers.getSetCookie()) if (/qcpl_sid=/.test(c)) cookie = c.split(";")[0]; const d = await r.json().catch(() => ({})); if (d.csrf) csrf = d.csrf; if (d.session && d.session.csrf) csrf = d.session.csrf; return { s: r.status, d }; };
await req("GET", "/api/v1/session");
const si = await req("POST", "/api/v1/act", { name: "signIn", args: ["admin", "new.head", temp], library: "main" });
const st = si.d.session && si.d.session.staff;
ok("the new account signs in with the temporary password", si.s === 200 && st && st.username === "new.head", si.d);
ok("it is a head administrator (all libraries)", st && st.library === "all" && st.level === "supervisor", st);
ok("it must choose its own password first", st && st.mustChange === true);
ok("nothing else works until then", (await req("POST", "/api/v1/act", { name: "createStaff", args: [{ name: "X", username: "xx9", role: "Desk staff", password: "abcdefghijk1" }], library: "main" })).s >= 400);
const own = randomBytes(12).toString("base64url");
ok("it can set its own password", (await req("POST", "/api/v1/act", { name: "changeStaffPassword", args: [temp, own], library: "main" })).s === 200);
const act = (await req("GET", "/api/v1/sync")).d.data.qcpllf_activity || [];
ok("the activity log records it", act.some((a) => /added on the server computer/.test(a.action) && a.ref === "new.head"));
await srv.stop();

console.log(JSON.stringify(out, null, 1));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
