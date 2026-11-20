// node runjs.mjs <url> <test.js> <outDir> [shot-hash ...]
// Runs test.js (an async function body) in the page, prints its result, then screenshots each hash.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const [url, testFile, outDir, ...hashes] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const exe = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
const port = 9336, profile = mkdtempSync(path.join(tmpdir(), "qcpl-run-"));
const child = spawn(exe, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description?.slice(0, 300)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable"); await send("Page.enable");
const W = Number(process.env.W || 1280), H = Number(process.env.H || 900);
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
await send("Page.navigate", { url }); await sleep(2500);
const code = readFileSync(testFile, "utf8");
const r = await send("Runtime.evaluate", { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true });
console.log(r.result.exceptionDetails ? "TEST EXCEPTION " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text) : JSON.stringify(r.result.result.value, null, 1));
for (const h of hashes) {
  const [hash, name, pre] = h.split("@");
  await send("Runtime.evaluate", { expression: `location.hash = ${JSON.stringify(hash)}; ${pre ? pre : ""}`, awaitPromise: true });
  await sleep(1200);
  const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
  writeFileSync(path.join(outDir, name + ".jpg"), Buffer.from(s.result.data, "base64"));
}
if (errors.length) console.log("PAGE ERRORS", errors);
ws.close(); child.kill(); process.exit(0);
