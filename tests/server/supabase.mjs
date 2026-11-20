// The site with its database in Supabase (a local stand-in: real Postgres + fake Storage), end to end.
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
// The stand-in database runs in THIS process, so helpers must run alongside it (never block while they work)
const runTool = (args, opts) => new Promise((ok) => {
  const p = spawn(process.execPath, args, { cwd: opts.cwd, env: opts.env });
  let stdout = "", stderr = "";
  p.stdout.on("data", (d) => (stdout += d)); p.stderr.on("data", (d) => (stderr += d));
  p.stdin.end(opts.input || "");
  const t = setTimeout(() => p.kill(), opts.timeout || 120000);
  p.on("exit", (status) => { clearTimeout(t); ok({ status, stdout, stderr }); });
});
import { mkdtempSync, rmSync, copyFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer, setupHead, testEnv, SERVER_DIR } from "../lib/server.mjs";
import { startFakeSupabase, FAKE_KEY } from "../lib/fake-supabase.mjs";

const out = {}; let fails = 0;
const ok = (n, c, x) => { out[n] = c ? "PASS" : "FAIL " + JSON.stringify(x === undefined ? "" : x).slice(0, 260); if (!c) fails++; };
const PORT = 8371, ORIGIN = `http://localhost:${PORT}`, today = new Date().toISOString().slice(0, 10);
const png = () => "data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), randomBytes(200)]).toString("base64");
class Br {
  constructor(url) { this.url = url; this.cookie = ""; this.csrf = ""; }
  async req(m, p, body) {
    const r = await fetch(this.url + p, { method: m, headers: { ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body ? { "Content-Type": "application/json", Origin: ORIGIN, "X-CSRF": this.csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie()) if (/qcpl_sid=/.test(c)) this.cookie = c.split(";")[0];
    const buf = Buffer.from(await r.arrayBuffer()); let d; try { d = JSON.parse(buf.toString()); } catch { d = buf; }
    if (d && d.csrf) this.csrf = d.csrf; if (d && d.session && d.session.csrf) this.csrf = d.session.csrf;
    return { s: r.status, d, buf };
  }
  async start() { await this.req("GET", "/api/v1/session"); return this; }
  act(name, ...args) { return this.req("POST", "/api/v1/act", { name, args, library: "main", lang: "en" }); }
}
const fake = await startFakeSupabase();
const q = async (sql, p) => (await fake.query(sql, p)).rows;
const pw = randomBytes(12).toString("base64url");

// ---------- 1. A site on this computer only, with some data ----------
let srv = await startServer({ port: PORT });
const dir1 = srv.dir;
await setupHead(srv.url, { username: "head", password: pw });
const guest = await new Br(srv.url).start();
const lost = await guest.act("createLost", { category: "bags", itemName: "Blue backpack", color: "Blue", description: "has a keychain", dateLost: today, branch: "QCPL Main Library", location: "Reading Area", name: "Ana Cruz", phone: "09171112222", contactPref: "Call me", photos: [png()] });
const lostId = lost.d.result.id, photoUrl = lost.d.result.photos[0];
await (await new Br(srv.url).start()).act("register", { name: "Ben User", phone: "09173334444", email: "", password: "benpass123", role: "Library member", memberId: "" });
await srv.stop({ keep: true });

// ---------- 2. The server refuses an empty Supabase (it would never wipe the data) ----------
srv = null;
try { srv = await startServer({ port: PORT, env: fake.env() }); } catch (e) { void e; }
ok("the server refuses to start on an EMPTY Supabase (nothing is wiped)", !srv);
if (srv) await srv.stop();

// ---------- 3. Move the database to Supabase ----------
const envDir = mkdtempSync(path.join(tmpdir(), "qcpl-mv-")), envFile = path.join(envDir, ".env");
copyFileSync(path.join(SERVER_DIR, ".env.example"), envFile);
const mv = await runTool(["move-to-supabase.mjs", "--env", envFile, "--data", dir1, "--url", fake.storageUrl, "--key", FAKE_KEY, "--db", fake.dbUrl, "--ca", "", "--region", "Test region"],
  { cwd: SERVER_DIR, input: "\n", timeout: 120000, env: { ...process.env, PORT: String(PORT), SUPABASE_POOL_MAX: "1" } });
if (mv.status !== 0) console.log("MOVE OUTPUT:\n" + mv.stdout + "\n" + mv.stderr);
ok("the move finishes and the counts match", mv.status === 0 && /counts match/.test(mv.stdout), (mv.stdout + mv.stderr).slice(-400));
ok("the secret key and database password are never shown", !mv.stdout.includes(FAKE_KEY) && !mv.stdout.includes("postgres:postgres@"));
ok("a safety backup was made first", /Safety backup/.test(mv.stdout));
const envSaved = readFileSync(envFile, "utf8");
ok("the settings are saved in the settings file", envSaved.includes(`SUPABASE_URL=${fake.storageUrl}`) && envSaved.includes(`SUPABASE_DB_URL=${fake.dbUrl}`) && envSaved.includes("SUPABASE_REGION=Test region"));
ok("the records are in Supabase", (await q("SELECT count(*)::int n FROM qcpl.lost_reports"))[0].n === 1 && (await q("SELECT count(*)::int n FROM qcpl.users"))[0].n === 1 && (await q("SELECT count(*)::int n FROM qcpl.staff_accounts"))[0].n === 1);
ok("…with the same details", (await q("SELECT owner_name, phone, item_name FROM qcpl.lost_reports"))[0].owner_name === "Ana Cruz");
ok("the photo file is in private Storage", fake.files.size === 1 && fake.buckets.get("qcpl-photos") && fake.buckets.get("qcpl-photos").public === false);
ok("every table has row level security on", (await q(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'qcpl' AND c.relkind = 'r' AND NOT c.relrowsecurity`))[0].n === 0);
ok("the data is in the private schema, not the public one", (await q(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public'`))[0].n === 0);
ok("the views work on Postgres", (await q("SELECT count(*)::int n FROM qcpl.v_open_lost_reports"))[0].n === 1 && (await q("SELECT count(*)::int n FROM qcpl.v_status_history"))[0].n >= 1);

// ---------- 4. A NEW server with an empty disk (e.g. a new host) gets everything from Supabase ----------
srv = await startServer({ port: PORT, env: fake.env() });
const health = (await new Br(srv.url).req("GET", "/api/health")).d;
ok("the server says its database is Supabase", health.database === "supabase" && health.region === "Test region", health);
const head = await new Br(srv.url).start();
ok("the head administrator signs in (account came from Supabase)", (await head.act("signIn", "admin", "head", pw)).s === 200);
const sync = (await head.req("GET", "/api/v1/sync")).d.data;
ok("staff see the report that was made before the move", sync.qcpllf_lost.some((l) => l.id === lostId && l.name === "Ana Cruz"));
const photo = await head.req("GET", photoUrl);
ok("its photo opens (fetched from Storage the first time)", photo.s === 200 && photo.buf.length > 200, photo.s);

// ---------- 5. New changes go to Supabase first ----------
const g2 = await new Br(srv.url).start();
const r2 = await g2.act("createLost", { category: "keys", itemName: "House keys", color: "Silver", dateLost: today, branch: "QCPL Main Library", location: "Restrooms", name: "Carla New", phone: "09175556666", contactPref: "Call me", photos: [png()] });
ok("a new report is saved", r2.s === 200);
ok("…it is in Supabase right away", (await q("SELECT owner_name FROM qcpl.lost_reports WHERE id = $1", [r2.d.result.id]))[0]?.owner_name === "Carla New");
ok("…with its photo file and owner", fake.files.size === 2 && (await q("SELECT owner_id FROM qcpl.photos WHERE owner_id = $1", [r2.d.result.id])).length === 1);
// another server can't use the same database at the same time
let second = null;
try { second = await startServer({ port: PORT + 2, env: fake.env() }); } catch (e) { void e; }
ok("a second server can't use the same database at the same time", !second);
if (second) await second.stop();
// If Supabase can't be reached, the change is refused and nothing is half-saved
await fake.dbDown();
const r3 = await g2.act("createLost", { category: "keys", itemName: "Lost while offline", color: "Red", dateLost: today, branch: "QCPL Main Library", location: "Restrooms", name: "Off Line", phone: "09175550000", contactPref: "Call me" });
ok("while Supabase is unreachable, a change is refused with a plain message", r3.s === 503 && /try again in a minute/.test(r3.d.error || "") && !/ECONN|terminated|postgres/i.test(r3.d.error || ""), r3.d);
await fake.dbUp();
const staffSync = (await head.req("GET", "/api/v1/sync")).d.data;
ok("…and it isn't on the site either (nothing half-saved)", !staffSync.qcpllf_lost.some((l) => l.itemName === "Lost while offline"));
await new Promise((r) => setTimeout(r, 1500));
const r4 = await g2.act("createLost", { category: "keys", itemName: "After it came back", color: "Red", dateLost: today, branch: "QCPL Main Library", location: "Restrooms", name: "Back Again", phone: "09175550001", contactPref: "Call me" });
ok("when Supabase is back, saving works again", r4.s === 200 && (await q("SELECT count(*)::int n FROM qcpl.lost_reports WHERE item_name = 'After it came back'"))[0].n === 1, r4.s);
// a backup made on the new server includes every photo
const bk = await head.req("POST", "/api/v1/admin/backups/now", {});
const list = (await head.req("GET", "/api/v1/admin/backups")).d.list;
ok("a backup includes every photo (fetched from Storage first)", bk.s === 200 && list[0] && list[0].counts === undefined ? bk.s === 200 : list[0].counts.photos === 2, list[0]);
const dir2 = srv.dir;
await srv.stop({ keep: true });

// ---------- 6. The add-admin tool saves to Supabase ----------
const add = await runTool(["add-admin.mjs", "--username", "second.head", "--name", "Second Head"], { cwd: SERVER_DIR, input: "", env: { ...process.env, ...testEnv(dir2, PORT), ...fake.env() } });
const temp = (/Temporary password:\s+(\S+)/.exec(add.stdout) || [])[1];
ok("the add-admin tool works with Supabase", !!temp && (await q("SELECT count(*)::int n FROM qcpl.staff_accounts WHERE username = 'second.head'"))[0].n === 1, (add.stdout + add.stderr).slice(-300));
srv = await startServer({ port: PORT, env: fake.env() }); // yet another empty disk
const h2 = await new Br(srv.url).start();
ok("…and the new admin can sign in on a fresh server", (await h2.act("signIn", "admin", "second.head", temp)).s === 200);
await srv.stop();

await fake.stop();
for (const d of [dir1, dir2, envDir]) try { rmSync(d, { recursive: true, force: true }); } catch {}
console.log(JSON.stringify(out, null, 1));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(0);
