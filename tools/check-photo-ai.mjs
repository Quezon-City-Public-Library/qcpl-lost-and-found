// Checks how well the photo helper recognizes real photos.
//
// 1. Put photos in folders named after the item type:
//      photo-tests/phones/   photo-tests/wallets/   photo-tests/bags/   photo-tests/keys/
//      photo-tests/books/    photo-tests/accessories/   photo-tests/others/
//    (Optional: a subfolder "colors/<Color>/" with photos whose main color is known, e.g. photo-tests/colors/Blue/)
// 2. Build the offline file:  node tools/build-offline.mjs
// 3. Run:                      node tools/check-photo-ai.mjs
//
// It opens the offline site in Edge (hidden), shows each photo to the helper exactly
// like the report form does, and prints how many it got right and what it confused.
// Photos stay on this computer.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "photo-tests");
const SITE = path.join(ROOT, "QCPL-Lost-and-Found-OFFLINE.html");
const CATS = ["phones", "wallets", "bags", "keys", "books", "accessories", "others"];
const IMG = /\.(jpe?g|png|webp)$/i;
if (!existsSync(DIR)) { console.log(`Make a folder "photo-tests" with subfolders ${CATS.join(", ")} and put photos in them.`); process.exit(1); }
if (!existsSync(SITE)) { console.log("Build the offline file first: node tools/build-offline.mjs"); process.exit(1); }
const files = [];
for (const c of CATS) { const d = path.join(DIR, c); if (existsSync(d)) for (const f of readdirSync(d)) if (IMG.test(f)) files.push({ want: c, kind: "type", file: path.join(d, f) }); }
const cdir = path.join(DIR, "colors");
if (existsSync(cdir)) for (const col of readdirSync(cdir)) { const d = path.join(cdir, col); if (statSync(d).isDirectory()) for (const f of readdirSync(d)) if (IMG.test(f)) files.push({ want: col, kind: "color", file: path.join(d, f) }); }
if (!files.length) { console.log("No photos found in photo-tests/."); process.exit(1); }

const exe = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
const port = 9600 + Math.floor(Math.random() * 300), profile = mkdtempSync(path.join(tmpdir(), "qcpl-ai-check-"));
const child = spawn(exe, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 80 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (code) => { const r = await send("Runtime.evaluate", { expression: `(async () => { ${code} })()`, awaitPromise: true, returnByValue: true, timeout: 120000 }); return r.result?.result?.value ?? { error: r.result?.exceptionDetails?.exception?.description }; };
await send("Page.navigate", { url: pathToFileURL(SITE).href }); await sleep(4000);

const rows = [], confusion = {};
let typeRight = 0, typeTotal = 0, typeUnsure = 0, colorRight = 0, colorTotal = 0;
for (const f of files) {
  const b64 = readFileSync(f.file).toString("base64"), mime = /png$/i.test(f.file) ? "image/png" : /webp$/i.test(f.file) ? "image/webp" : "image/jpeg";
  // Same as the report form: resize to 640 px JPEG, then analyze
  const r = await ev(`
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = "data:${mime};base64,${b64}"; });
    const k = Math.min(1, 640 / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const a = await PhotoAI.analyze(c.toDataURL("image/jpeg", 0.75), { kind: "found" });
    return { category: a.category || "", itemName: a.itemName || "", color: a.color, second: a.secondColor, level: a.level, guesses: (a.guesses || []).slice(0, 3).map((g) => g.name + " " + Math.round(g.score * 100) + "%") };`);
  const name = path.relative(DIR, f.file);
  if (f.kind === "type") {
    typeTotal++;
    const good = r.category === f.want;
    if (good) typeRight++; else if (!r.category) typeUnsure++;
    if (!good) confusion[`${f.want} → ${r.category || "(not sure)"}`] = (confusion[`${f.want} → ${r.category || "(not sure)"}`] || 0) + 1;
    rows.push(`${good ? "✓" : "✗"} ${name.padEnd(40)} ${String(r.category || "(not sure)").padEnd(12)} ${String(r.itemName).padEnd(26)} ${r.color}${r.second ? "+" + r.second : ""}   ${(r.guesses || []).join(", ")}`);
  } else {
    colorTotal++;
    const good = r.color === f.want || (f.want === "Gray" && r.color === "Silver") || r.second === f.want;
    if (good) colorRight++;
    rows.push(`${good ? "✓" : "✗"} ${name.padEnd(40)} color: ${r.color}${r.second ? " + " + r.second : ""}`);
  }
}
console.log(rows.join("\n"));
console.log("\n" + "=".repeat(70));
if (typeTotal) console.log(`Item type right: ${typeRight} of ${typeTotal} (${Math.round((typeRight / typeTotal) * 100)}%). Not sure (left for the person to choose): ${typeUnsure}.`);
if (colorTotal) console.log(`Main color right: ${colorRight} of ${colorTotal} (${Math.round((colorRight / colorTotal) * 100)}%).`);
const conf = Object.entries(confusion).sort((a, b) => b[1] - a[1]);
if (conf.length) console.log("Most common mix-ups:\n  " + conf.slice(0, 10).map(([k, v]) => `${k}: ${v}`).join("\n  "));
ws.close(); child.kill();
