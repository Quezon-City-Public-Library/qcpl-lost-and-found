/* Starts the real server on a throwaway, empty database for one test.
   Nothing here touches the live data, its backups, or the OneDrive copy folder:
   data, backups and backup copies all go into a new temporary folder. */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const SERVER_DIR = path.join(ROOT, "server");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const healthy = (url) => fetch(url + "/api/health").then((r) => r.ok).catch(() => false);

/* Settings in server/.env that must never be used by a test (real database, email, texts, AI) */
export const NO_REAL_SERVICES = { SUPABASE_DB_URL: "", SUPABASE_URL: "", SUPABASE_SERVICE_KEY: "", SUPABASE_CA_FILE: "",
  SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "", SEMAPHORE_API_KEY: "", ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "", QCPL_VISION: "", ADMIN_NETWORKS: "", TRUST_PROXY: "", PUBLIC_TUNNEL: "", SITE_URL: "" };
export function testEnv(dir, port) {
  return { PORT: String(port), DATA_DIR: dir, BACKUP_DIR: path.join(dir, "backups"), BACKUP_COPY_DIR: path.join(dir, "copies"),
    DEMO_CODES: "1", STRICT_CHECKS: "1", ...NO_REAL_SERVICES };
}

/** { dir, port, url, stop() } */
export async function startServer({ port = 8371, dir = null, env = {} } = {}) {
  const url = `http://127.0.0.1:${port}`;
  if (await healthy(url)) throw new Error(`Port ${port} is already in use. Close whatever is using it and run the tests again.`);
  dir = dir || mkdtempSync(path.join(tmpdir(), "qcpl-test-"));
  const log = path.join(dir, "server.log");
  const child = spawn(process.execPath, ["server.mjs"], { cwd: SERVER_DIR, env: { ...process.env, ...testEnv(dir, port), ...env } });
  child.stdout.on("data", (d) => appendFileSync(log, d));
  child.stderr.on("data", (d) => appendFileSync(log, "[err] " + d));
  for (let i = 0; i < 120 && !(await healthy(url)); i++) await sleep(250);
  if (!(await healthy(url))) { child.kill(); throw new Error("The test server did not start. See " + log); }
  return {
    dir, port, url, log,
    async stop({ keep = false } = {}) {
      child.kill();
      for (let i = 0; i < 40 && (await healthy(url)); i++) await sleep(150);
      await sleep(300);
      if (!keep) try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

/** Creates the first head administrator through /setup (as a person would on first start) */
export async function setupHead(url, { username = "head", name = "Head Admin", password }) {
  const page = await (await fetch(url + "/setup")).text();
  const t = (/name="t" value="([^"]+)"/.exec(page) || [])[1];
  const r = await fetch(url + "/setup", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ t, name, username, password, password2: password }) });
  return /All set/.test(await r.text());
}
