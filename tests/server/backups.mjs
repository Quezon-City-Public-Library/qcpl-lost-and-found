// Encrypted backups and restore, end to end (server on 8373 run by run-loop.mjs, which restarts it after a restore).
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, copyFileSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const PORT = 8373, B = `http://127.0.0.1:${PORT}`, ORIGIN = `http://localhost:${PORT}`;
const SERVER = fileURLToPath(new URL("../../server/", import.meta.url));
const out = {}; let fails = 0;
const ok = (n, c, x) => { out[n] = c ? "PASS" : "FAIL" + (x !== undefined ? " — " + JSON.stringify(x).slice(0, 260) : ""); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

function startLoop(dataDir) {
  const log = path.join(dataDir, "..", path.basename(dataDir) + "-server.log");
  const p = spawn(process.execPath, [fileURLToPath(new URL("../lib/run-loop.mjs", import.meta.url)), String(PORT), dataDir, log], { stdio: "ignore" });
  return { p, log };
}
async function up() { for (let i = 0; i < 80; i++) { try { if ((await fetch(B + "/api/health")).ok) return true; } catch {} await sleep(250); } return false; }
async function down() { for (let i = 0; i < 40; i++) { try { await fetch(B + "/api/health"); } catch { return true; } await sleep(150); } return false; }

class Br {
  constructor() { this.cookie = ""; this.csrf = ""; }
  async req(method, p, body, headers = {}) {
    const isRaw = Buffer.isBuffer(body);
    const res = await fetch(B + p, { method, redirect: "manual", headers: { ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body !== undefined ? { "Content-Type": isRaw ? "application/octet-stream" : "application/json", Origin: ORIGIN, "X-CSRF": this.csrf } : {}), ...headers }, body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) if (/qcpl_sid=/.test(c)) this.cookie = c.split(";")[0];
    const buf = Buffer.from(await res.arrayBuffer());
    let data; try { data = JSON.parse(buf.toString()); } catch { data = buf; }
    if (data && data.csrf) this.csrf = data.csrf; if (data && data.session && data.session.csrf) this.csrf = data.session.csrf;
    return { status: res.status, data, buf };
  }
  act(name, ...args) { return this.req("POST", "/api/v1/act", { name, args, library: "main", lang: "en" }); }
}

// ---------- Start on an empty database ----------
const dataDir = mkdtempSync(path.join(tmpdir(), "qcpl-bk-"));
let loop = startLoop(dataDir);
ok("server starts", await up());
const headPw = randomBytes(15).toString("base64url"), pass = "correct horse battery staple " + randomBytes(3).toString("hex");
{
  const page = await (await fetch(B + "/setup")).text();
  const t = (/name="t" value="([^"]+)"/.exec(page) || [])[1];
  await fetch(B + "/setup", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, name: "Head Admin", username: "head", password: headPw, password2: headPw }) });
}
const head = new Br(); await head.req("GET", "/api/v1/session");
ok("head administrator signs in", (await head.act("signIn", "admin", "head", headPw)).status === 200);
const guest = new Br(); await guest.req("GET", "/api/v1/session");
ok("visitors can't see backups", (await guest.req("GET", "/api/v1/admin/backups")).status === 403);
ok("visitors can't make backups", (await guest.req("POST", "/api/v1/admin/backups/now", {})).status === 403);
const desk = new Br(); await desk.req("GET", "/api/v1/session");
await head.act("createStaff", { name: "Desk", username: "desk1", role: "Supervisor", password: "DeskTemp-12345" });
await desk.act("signIn", "admin", "desk1", "DeskTemp-12345"); await desk.act("changeStaffPassword", "DeskTemp-12345", "Desk-own-pass-99");
ok("a library supervisor (not head office) can't manage backups", (await desk.req("GET", "/api/v1/admin/backups")).status === 403);

// ---------- Before encryption is on ----------
let info = (await head.req("GET", "/api/v1/admin/backups")).data;
ok("encryption starts off", info.enabled === false, info);
const plain = await head.req("POST", "/api/v1/admin/backups/now", {});
ok("a backup can be made before encryption (plain)", plain.status === 200 && plain.data.encrypted === false, plain.data);
ok("plain backups can't be downloaded", (await head.req("GET", "/api/v1/admin/backups/download?name=" + plain.data.name)).status === 400);
ok("turning on needs the admin's password", /password is not correct/.test((await head.req("POST", "/api/v1/admin/backups/passphrase", { passphrase: pass, passphrase2: pass, password: "wrong" })).data.error || ""));
ok("a short passphrase is refused", (await head.req("POST", "/api/v1/admin/backups/passphrase", { passphrase: "short one", passphrase2: "short one", password: headPw })).status === 400);
ok("two different passphrases are refused", (await head.req("POST", "/api/v1/admin/backups/passphrase", { passphrase: pass, passphrase2: pass + "x", password: headPw })).status === 400);
const on = await head.req("POST", "/api/v1/admin/backups/passphrase", { passphrase: pass, passphrase2: pass, password: headPw });
ok("encrypted backups turn on", on.status === 200 && /^[a-f0-9]{16}$/.test(on.data.fingerprint), on.data);
info = (await head.req("GET", "/api/v1/admin/backups")).data;
ok("the earlier plain backup was locked too (no plain backups left)", info.enabled && info.list.length >= 1 && info.list.every((b) => b.encrypted), info.list);
const keyFile = readFileSync(path.join(dataDir, "backup-keys.json"), "utf8");
ok("the private key is never stored unlocked", !/PRIVATE KEY/.test(keyFile) && /"sealed"/.test(keyFile));

// ---------- Backup A: one report ----------
await guest.act("createLost", { category: "others", itemName: "BEFORE-umbrella", color: "Blue", dateLost: today, branch: "QCPL Main Library", location: "Reading Area", name: "Ana Before", phone: "09171112222", contactPref: "Call me" });
const A = (await head.req("POST", "/api/v1/admin/backups/now", {})).data;

// ---------- Copies off this computer (BACKUP_COPY_DIR; OneDrive by default) ----------
{
  const copies = dataDir + "-copies", have = existsSync(copies) ? readdirSync(copies) : [];
  ok("each encrypted backup is also copied to the copy folder", have.includes(A.name), have);
  ok("the earlier (converted) backup was copied once it was locked", have.some((f) => /-converted\.qcplbak$/.test(f)), have);
  ok("an unencrypted backup is never copied there", !have.some((f) => f.endsWith(".db")), have);
  const page = (await head.req("GET", "/api/v1/admin/backups")).data;
  ok("the Backups page names the copy folder", page.copyFolder && page.copyFolder.replace(/\\/g, "/").endsWith("-copies"), page.copyFolder);
}
ok("encrypted backup made", A.encrypted === true && /\.qcplbak$/.test(A.name), A);
const dl = await head.req("GET", "/api/v1/admin/backups/download?name=" + encodeURIComponent(A.name));
ok("download works for the head admin", dl.status === 200 && dl.buf.subarray(0, 8).toString() === "QCPLBAK1");
const body = dl.buf.subarray(200).toString("latin1");
ok("a downloaded backup reveals nothing (encrypted)", !/BEFORE-umbrella|Ana Before|09171112222|SQLite format 3|qcpllf_|scrypt\$/.test(body));
ok("download refused for others", (await guest.req("GET", "/api/v1/admin/backups/download?name=" + encodeURIComponent(A.name))).status === 403);
ok("odd file names refused (no reaching other files)", (await head.req("GET", "/api/v1/admin/backups/download?name=" + encodeURIComponent("..\\..\\qcpl.db"))).status === 404);

// ---------- Test (verify) ----------
const wrongPass = await head.req("POST", "/api/v1/admin/backups/verify", { name: A.name, passphrase: "not the passphrase at all", password: headPw });
ok("wrong passphrase: refused", /passphrase is not correct/.test(wrongPass.data.error || ""), wrongPass.data);
const ver = await head.req("POST", "/api/v1/admin/backups/verify", { name: A.name, passphrase: pass, password: headPw });
ok("right passphrase: backup opens and passes every check", ver.status === 200 && ver.data.counts.lost === 1, ver.data);

// ---------- Tampered and fake files ----------
const tampered = Buffer.from(dl.buf); tampered[tampered.length - 100] ^= 1;
const up1 = await head.req("POST", "/api/v1/admin/backups/upload", tampered);
ok("a changed backup can be uploaded…", up1.status === 200, up1.data);
const t1 = await head.req("POST", "/api/v1/admin/backups/verify", { name: up1.data.name, passphrase: pass, password: headPw });
ok("…but is refused when opened (one byte changed in the data)", /changed or is damaged/.test(t1.data.error || ""), t1.data);
const hlen = dl.buf.readUInt32BE(8), hdr = JSON.parse(dl.buf.subarray(12, 12 + hlen).toString());
hdr.counts.lost = 999;
const nh = Buffer.from(JSON.stringify(hdr)), nl = Buffer.alloc(4); nl.writeUInt32BE(nh.length);
const forged = Buffer.concat([dl.buf.subarray(0, 8), nl, nh, dl.buf.subarray(12 + hlen)]);
const up2 = await head.req("POST", "/api/v1/admin/backups/upload", forged);
const t2 = await head.req("POST", "/api/v1/admin/backups/verify", { name: up2.data.name, passphrase: pass, password: headPw });
ok("a backup whose description was edited is refused", t2.status === 400, t2.data);
ok("a file that isn't a backup can't be uploaded", (await head.req("POST", "/api/v1/admin/backups/upload", Buffer.from("SQLite format 3\0 not a backup"))).status === 400);

// ---------- Restore A after more changes ----------
await guest.act("createLost", { category: "keys", itemName: "AFTER-keys", color: "Silver", dateLost: today, branch: "QCPL Main Library", location: "Reading Area", name: "Ben After", phone: "09173334444", contactPref: "Call me" });
ok("restore needs the word RESTORE", (await head.req("POST", "/api/v1/admin/backups/restore", { name: A.name, passphrase: pass, password: headPw })).status === 400);
ok("restore needs the right passphrase", (await head.req("POST", "/api/v1/admin/backups/restore", { name: A.name, passphrase: "wrong wrong wrong wrong", password: headPw, confirm: "RESTORE" })).status === 400);
ok("restore needs the admin's password", (await head.req("POST", "/api/v1/admin/backups/restore", { name: A.name, passphrase: pass, password: "nope", confirm: "RESTORE" })).status === 400);
const oldCookie = head.cookie;
const rs = await head.req("POST", "/api/v1/admin/backups/restore", { name: A.name, passphrase: pass, password: headPw, confirm: "RESTORE" });
ok("restore starts (server restarts)", rs.status === 200 && rs.data.restarting === true, rs.data);
await down(); ok("server comes back after the restore", await up());
const old = new Br(); old.cookie = oldCookie;
ok("everyone is signed out after a restore", !(await old.req("GET", "/api/v1/session")).data.staff);
const head2 = new Br(); await head2.req("GET", "/api/v1/session");
ok("head admin signs in again", (await head2.act("signIn", "admin", "head", headPw)).status === 200);
const data = (await head2.req("GET", "/api/v1/sync?library=main")).data.data;
ok("data is back to the backup (BEFORE yes, AFTER no)", data.qcpllf_lost.some((l) => l.itemName === "BEFORE-umbrella") && !data.qcpllf_lost.some((l) => l.itemName === "AFTER-keys"), data.qcpllf_lost.map((l) => l.itemName));
ok("the restore is in the activity log", data.qcpllf_activity.some((a) => /restored from a backup/i.test(a.action)));
const list2 = (await head2.req("GET", "/api/v1/admin/backups")).data.list;
const safety = list2.find((b) => /before-restore/.test(b.name));
ok("a safety backup of the replaced data exists", !!safety, list2.map((b) => b.name));
const sv = safety ? await head2.req("POST", "/api/v1/admin/backups/verify", { name: safety.name, passphrase: pass, password: headPw }) : { data: {} };
ok("the safety backup holds the replaced data (2 reports)", sv.data.counts && sv.data.counts.lost === 2, sv.data);
let limited = false;
for (let i = 0; i < 12 && !limited; i++) limited = (await head2.req("POST", "/api/v1/admin/backups/verify", { name: A.name, passphrase: "guess " + i + " guess guess", password: headPw })).status === 429;
ok("guessing the passphrase is limited", limited);

// ---------- Emergency restore on a brand-new computer ----------
loop.p.kill(); await sleep(400); try { execFileSync("taskkill", ["/F", "/T", "/PID", String(loop.p.pid)], { stdio: "ignore" }); } catch {} await down();
const fresh = mkdtempSync(path.join(tmpdir(), "qcpl-newpc-"));
const file = path.join(dataDir, "backups", A.name);
const cli = execFileSync(process.execPath, ["restore.mjs", file], { cwd: SERVER, input: pass + "\n", env: { ...process.env, DATA_DIR: fresh, PORT: String(PORT) }, encoding: "utf8" });
ok("emergency restore opens the backup", /passed every check/.test(cli) && /Ready/.test(cli), cli.slice(-300));
ok("new computer: encrypted backups set up again", existsSync(path.join(fresh, "backup-keys.json")) && /same recovery passphrase/.test(cli));
const badCli = (() => { try { execFileSync(process.execPath, ["restore.mjs", file], { cwd: SERVER, input: "wrong passphrase here\n", env: { ...process.env, DATA_DIR: mkdtempSync(path.join(tmpdir(), "qcpl-x-")), PORT: String(PORT) }, encoding: "utf8" }); return "no error"; } catch (e) { return String(e.stdout); } })();
ok("emergency restore with the wrong passphrase changes nothing", /not correct/.test(badCli) && /Nothing was changed/.test(badCli), badCli.slice(-200));
loop = startLoop(fresh);
ok("site starts on the new computer", await up());
ok("no setup needed: the accounts came back with the data", (await fetch(B + "/setup", { redirect: "manual" })).status === 303);
const h3 = new Br(); await h3.req("GET", "/api/v1/session");
ok("head admin signs in on the new computer", (await h3.act("signIn", "admin", "head", headPw)).status === 200);
const d3 = (await h3.req("GET", "/api/v1/sync?library=main")).data.data;
ok("records are there", d3.qcpllf_lost.some((l) => l.itemName === "BEFORE-umbrella"));
const i3 = (await h3.req("GET", "/api/v1/admin/backups")).data;
ok("backups on the new computer are encrypted with the same key", i3.enabled && i3.key.fingerprint === on.data.fingerprint);
const nb = (await h3.req("POST", "/api/v1/admin/backups/now", {})).data;
ok("…and a new backup opens with the same passphrase", (await h3.req("POST", "/api/v1/admin/backups/verify", { name: nb.name, passphrase: pass, password: headPw })).status === 200);

loop.p.kill(); try { execFileSync("taskkill", ["/F", "/T", "/PID", String(loop.p.pid)], { stdio: "ignore" }); } catch {}
console.log(JSON.stringify(out, null, 1));
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(0);
