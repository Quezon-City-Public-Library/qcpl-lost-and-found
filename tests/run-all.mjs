/* ==========================================================================
   Runs every test of the QCPL Lost & Found site.

     Double-click "Run all tests.bat"      (or: node tests/run-all.mjs)
     node tests/run-all.mjs excel backups   (only the tests whose name has these words)

   Each server test gets its own throwaway database on port 8371 (backups tests
   use 8373, the offline tests 8354), so the live site (8360), its data and its
   backups are never touched. Needs Microsoft Edge (browser tests) and Excel
   (the Excel test); a test that needs something missing is skipped, not failed.
   ========================================================================== */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, ROOT } from "./lib/server.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].some(existsSync);
const EXCEL = (() => { try { return !!process.env.ProgramFiles && ["Microsoft Office/root/Office16/EXCEL.EXE", "Microsoft Office/Office16/EXCEL.EXE"].some((p) => existsSync(path.join(process.env.ProgramFiles, p)) || existsSync(path.join(process.env["ProgramFiles(x86)"] || "", p))); } catch { return false; } })();

const SUITES = [
  { name: "Database tables (SQL)", file: "server/sql.mjs" },
  { name: "Rules, accounts and security", file: "server/api.mjs", server: true },
  { name: "Attack probes", file: "server/attack.mjs", server: true, pass: /ALL PROBES REFUSED/ },
  { name: "Whole site in a browser", file: "server/site-in-browser.mjs", server: true, needs: EDGE && "edge" },
  { name: "Backups and restore", file: "server/backups.mjs" },
  { name: "Backups page", file: "server/backups-page.mjs", server: true, needs: EDGE && "edge" },
  { name: "Recovery passphrase", file: "server/passphrase.mjs", server: true },
  { name: "Excel export", file: "server/excel.mjs", server: true, needs: EXCEL && "excel" },
  { name: "Add an admin account tool", file: "server/add-admin.mjs" },
  { name: "Administrator sign-in page", file: "server/admin-signin.mjs" },
  { name: "Privacy: erasing old information", file: "server/privacy.mjs" },
  { name: "Email and text setup helper", file: "server/messages-setup.mjs" },
  { name: "Supabase database (stand-in)", file: "server/supabase.mjs" },
  { name: "Many visitors at once", file: "server/load.mjs", server: true, env: { TRUST_PROXY: "1" } /* each visitor has its own address */, args: ["300", "50"], pass: /errors: 0\b[\s\S]*dropped connections: 0\b/ },
  { name: "Offline version: features", offline: "offline/features.js", needs: EDGE && "edge" },
  { name: "Offline version: security", offline: "offline/security.js", needs: EDGE && "edge" },
  { name: "Offline version: no sign-up codes", offline: "offline/no-codes.js", needs: EDGE && "edge" },
  { name: "Offline version: photo helper", offline: "offline/photo-helper.js", needs: EDGE && "edge" },
];

const run = (file, args = [], env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(HERE, file), ...args], { cwd: ROOT, env: { ...process.env, ...env } });
  let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  const timer = setTimeout(() => { out += "\nTIMED OUT"; p.kill(); }, 15 * 60_000);
  p.on("exit", (code) => { clearTimeout(timer); resolve({ code, out }); });
});

/* The site as plain files (like the offline version), for the in-browser tests. Local only. */
function staticServer(port) {
  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".md": "text/markdown; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".bin": "application/octet-stream" };
  const s = http.createServer((req, res) => {
    let rel; try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html"; } catch { rel = ""; }
    // never the server folder (settings, keys) or hidden files
    if (!rel || /(^|\/)\.|^server\/|^tests\/|\.\./.test(rel)) { res.writeHead(404); return res.end(); }
    const f = path.join(ROOT, rel);
    try { const body = readFileSync(f); res.writeHead(200, { "Content-Type": TYPES[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  return new Promise((ok, no) => { s.once("error", no); s.listen(port, "127.0.0.1", () => ok(s)); });
}

const only = process.argv.slice(2).map((w) => w.toLowerCase());
const chosen = SUITES.filter((s) => !only.length || only.some((w) => s.name.toLowerCase().includes(w)));
console.log(`\nQCPL Lost & Found - running ${chosen.length} test groups\n`);
const results = [];
let files = null;
for (const s of chosen) {
  const t0 = Date.now();
  process.stdout.write(`  ${s.name.padEnd(36)} `);
  if (s.needs === false) { console.log("SKIPPED (needs " + (s.offline || /browser|page/i.test(s.name) ? "Microsoft Edge" : "Excel") + ")"); results.push({ ...s, status: "skipped" }); continue; }
  let r, srv = null;
  try {
    if (s.offline) {
      files = files || await staticServer(8354);
      const outDir = mkdtempSync(path.join(tmpdir(), "qcpl-shots-"));
      r = await run("lib/runjs.mjs", ["http://127.0.0.1:8354/", path.join(HERE, s.offline), outDir]);
      rmSync(outDir, { recursive: true, force: true });
    } else {
      if (s.server) srv = await startServer({ port: 8371, env: s.env || {} });
      r = await run(s.file, s.args || [], srv ? { QCPL_TEST_DIR: srv.dir, BASE: srv.url } : {});
    }
  } catch (e) { r = { code: 1, out: "ERROR " + e.message }; }
  finally { if (srv) await srv.stop(); }
  const failed = /\bFAIL|TEST EXCEPTION|TIMED OUT|^ERROR |\[err\]|PAGE ERRORS/m.test(r.out) || !(s.pass || /ALL PASSED|\b0 failed\b|"PASS"/).test(r.out);
  const passes = (r.out.match(/"PASS"|^PASS /gm) || []).length;
  console.log(`${failed ? "FAILED" : "passed"}${passes ? ` (${passes} checks)` : ""}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (failed) console.log(r.out.split("\n").filter((l) => /FAIL|EXCEPTION|ERROR|TIMED OUT|PAGE ERRORS|errors: [1-9]/.test(l)).slice(0, 12).map((l) => "      " + l.trim().slice(0, 200)).join("\n") || r.out.slice(-1500));
  results.push({ ...s, status: failed ? "failed" : "passed" });
}
if (files) files.close();
const n = (st) => results.filter((x) => x.status === st).length;
console.log(`\n  ${n("passed")} passed, ${n("failed")} failed${n("skipped") ? `, ${n("skipped")} skipped` : ""}`);
console.log(n("failed") ? "\n  SOME TESTS FAILED - see the lines above.\n" : "\n  ALL TESTS PASSED\n");
process.exitCode = n("failed") ? 1 : 0;
