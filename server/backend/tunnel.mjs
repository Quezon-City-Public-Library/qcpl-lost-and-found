/* ==========================================================================
   Free public address with a Cloudflare "Quick Tunnel" (PUBLIC_TUNNEL=quick).

   Starts cloudflared next to the server and waits for the address Cloudflare
   gives (https://<random words>.trycloudflare.com). No account or domain is
   needed, but:
   - the address CHANGES every time the site starts;
   - Cloudflare offers Quick Tunnels for testing, without an uptime promise.
   Good for a pilot. For the real launch use a named tunnel with a domain.
   ========================================================================== */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export function findCloudflared(env = process.env) {
  const tries = [env.CLOUDFLARED_PATH, "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe", "C:\\Program Files\\cloudflared\\cloudflared.exe"].filter(Boolean);
  for (const p of tries) if (existsSync(p)) return p;
  try { return execFileSync(process.platform === "win32" ? "where" : "which", ["cloudflared"], { encoding: "utf8" }).split(/\r?\n/)[0].trim() || null; } catch { return null; }
}

/** → { url, stop() }. Rejects if cloudflared is missing or gives no address within `timeoutMs`. */
export function startQuickTunnel({ port, log = console.log, timeoutMs = 45000, env = process.env } = {}) {
  const exe = findCloudflared(env);
  if (!exe) return Promise.reject(new Error("cloudflared is not installed (winget install Cloudflare.cloudflared)."));
  return new Promise((resolve, reject) => {
    // --no-autoupdate: never replaces itself while the site runs
    const child = spawn(exe, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let done = false, seen = "";
    const stop = () => { try { child.kill(); } catch {} };
    const timer = setTimeout(() => { if (!done) { done = true; stop(); reject(new Error("Cloudflare gave no address in time. Check the internet connection.")); } }, timeoutMs);
    const read = (d) => {
      seen = (seen + d).slice(-4000);
      const m = QUICK_URL.exec(seen);
      if (m && !done) { done = true; clearTimeout(timer); resolve({ url: m[0].toLowerCase(), stop, child }); }
    };
    child.stdout.on("data", read); child.stderr.on("data", read);
    child.on("exit", (code) => {
      if (!done) { done = true; clearTimeout(timer); reject(new Error(`cloudflared stopped (code ${code}).`)); }
      else log(`The public address stopped working (cloudflared exited with code ${code}). Restart the site to get a new one.`);
    });
    // The tunnel ends with the server
    process.on("exit", stop);
  });
}
