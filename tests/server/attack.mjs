// Tries to break into the test server (port 8371). Every probe must be refused.
import net from "node:net";
const B = "http://127.0.0.1:8371";
const raw = (path, host = "127.0.0.1:8371") => new Promise((res) => {
  const s = net.connect(8371, "127.0.0.1", () => s.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
  let d = ""; s.on("data", (c) => (d += c)); s.on("end", () => res(d.split("\r\n")[0] + " | " + d.length + "B")); s.on("error", (e) => res("ERR " + e.message));
});
const must = [];
const check = (name, ok, got) => { must.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  →  ${got}`); };
const leaks = ["/README.md", "/README.md::$DATA", "/readme.MD", "/CLAUDE~1/launch.json", "/.claude/launch.json", "/server/.env", "/server/ENV~1", "/server%2f.env",
  "/%2e%2e/%2e%2e/Windows/win.ini", "/..%5c..%5cWindows%5cwin.ini", "/js/..%2f..%2fREADME.md", "/Start%20QCPL%20Lost%20and%20Found.bat", "/server/server.mjs",
  "/tools/build-offline.mjs", "/QCPL-Lost-and-Found-OFFLINE.html", "/js/app.js::$DATA", "/index.html.", "/assets/../README.md", "/%E0%A4%A", "/js/app.js%00.png", "/hero.jpeg"];
for (const p of leaks) { const r = await raw(p); check("blocked " + p, !/ 200 /.test(r), r); }
for (const p of ["/", "/index.html", "/js/app.js", "/css/styles.css", "/assets/qcpl-hero.jpg"]) { const r = await raw(p); check("serves " + p, / 200 /.test(r), r); }
check("unknown Host refused (DNS rebinding)", / 421 /.test(await raw("/", "evil.example:8371")), await raw("/", "evil.example:8371"));
const h = await fetch(B + "/");
for (const k of ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"]) check("header " + k, !!h.headers.get(k), (h.headers.get(k) || "missing").slice(0, 60));
const post = (p, body, headers = {}) => fetch(B + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body }).then(async (r) => r.status + " " + (await r.text()).slice(0, 80));
// Email/SMS/AI are off on this test copy, so the API answers 503 before anything is sent; with them on, the origin check comes next.
check("the old public message sender is gone (only the server sends messages)", /^404/.test(await post("/api/notify", "{}")), await post("/api/notify", "{}"));
check("unknown api 404", /^404/.test(await post("/api/xyz", "{}")), await post("/api/xyz", "{}"));
const big = "x".repeat(3 * 1024 * 1024);
check("huge body refused or ignored", !/^200/.test(await post("/api/describe-item", big).catch((e) => "ERR " + e.message)), "ok");
console.log(must.every(Boolean) ? "\nALL PROBES REFUSED" : "\nSOME PROBES GOT THROUGH");
