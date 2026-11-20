// Runs the server like the launcher does: starts it again when it exits with code 3.
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
const [port, dataDir, logFile] = process.argv.slice(2);
writeFileSync(logFile, "");
function start() {
  const child = spawn(process.execPath, ["server.mjs"], { cwd: new URL("../../server/", import.meta.url), env: { ...process.env, PORT: port, DATA_DIR: dataDir, BACKUP_DIR: dataDir + "/backups", BACKUP_COPY_DIR: dataDir + "-copies", DEMO_CODES: "1", STRICT_CHECKS: "1", SUPABASE_DB_URL: "", SUPABASE_URL: "", SUPABASE_SERVICE_KEY: "", SMTP_HOST: "", SEMAPHORE_API_KEY: "", ANTHROPIC_API_KEY: "", ADMIN_NETWORKS: "", PUBLIC_TUNNEL: "", SITE_URL: "" } });
  child.stdout.on("data", (d) => appendFileSync(logFile, d));
  child.stderr.on("data", (d) => appendFileSync(logFile, "[err] " + d));
  child.on("exit", (code) => { appendFileSync(logFile, `\n[loop] server exited with ${code}\n`); if (code === 3) setTimeout(start, 300); else process.exit(0); });
}
start();
