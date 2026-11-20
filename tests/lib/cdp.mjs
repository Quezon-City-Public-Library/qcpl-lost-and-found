// Shared headless-Edge helper for the audit tests.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextPort = 9400 + Math.floor(Math.random() * 400);
export async function launch({ W = 1280, H = 860, mobile = W < 700, outDir = "audit-shots" } = {}) {
  mkdirSync(outDir, { recursive: true });
  const exe = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  const port = nextPort++, profile = mkdtempSync(path.join(tmpdir(), "qcpl-audit-"));
  const child = spawn(exe, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 80 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} }
  if (!target) throw new Error("Edge did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  const errors = [], consoleErrors = [], requests = [], failed = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === "Runtime.exceptionThrown") errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || "").slice(0, 400));
    if (d.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(d.params.type)) consoleErrors.push(d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
    if (d.method === "Log.entryAdded" && d.params.entry.level === "error") consoleErrors.push(("[log] " + d.params.entry.text + " " + (d.params.entry.url || "")).slice(0, 300));
    if (d.method === "Network.responseReceived") requests.push({ url: d.params.response.url, status: d.params.response.status, size: d.params.response.encodedDataLength });
    if (d.method === "Network.loadingFailed" && !d.params.canceled) failed.push(d.params.errorText + " " + d.params.requestId);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (code, timeout = 60000) => {
    const r = await send("Runtime.evaluate", { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true, timeout });
    if (r.result?.exceptionDetails) return { __exc: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || "").slice(0, 300) };
    return r.result?.result?.value;
  };
  const shot = async (name, full = false) => {
    const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 70, captureBeyondViewport: full });
    writeFileSync(path.join(outDir, name + ".jpg"), Buffer.from(s.result.data, "base64"));
  };
  await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile });
  const nav = async (url, wait = 2500) => { await send("Page.navigate", { url }); await sleep(wait); };
  const close = () => { try { ws.close(); } catch {} try { child.kill(); } catch {} };
  return { send, ev, shot, nav, close, errors, consoleErrors, requests, failed };
}
// Snippet: sign in as the main administrator using the password listed in README (test only)
export const ADMIN_SIGNIN = `const md = await (await fetch('/README.md',{cache:'no-store'})).text(); const pw = (/\`mainadmin\` \\| \`([^\`]+)\`/.exec(md)||[])[1]; await LF.signIn('admin','mainadmin',pw);`;
export const W = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;
