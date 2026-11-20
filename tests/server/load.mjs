// Many visitors at once against the backend (each from its own network address via X-Forwarded-For).
const B = "http://127.0.0.1:8371", ORIGIN = "http://localhost:8371";
const N = +(process.argv[2] || 200), CONC = +(process.argv[3] || 50);
const today = new Date().toISOString().slice(0, 10);
const times = { session: [], sync: [], createLost: [], checkStatus: [] };
let errors = 0, resets = 0; const errSamples = [];
async function visitor(i) {
  const ip = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
  let cookie = "", csrf = "";
  const req = async (kind, method, path, body) => {
    const t0 = performance.now();
    let res; try { res = await fetch(B + path, { method, headers: { "X-Forwarded-For": ip, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json", Origin: ORIGIN, "X-CSRF": csrf } : {}) }, body: body ? JSON.stringify(body) : undefined }); } catch (e) { resets++; times[kind].push(performance.now() - t0); return null; }
    const sc = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).find((c) => /qcpl_sid=/.test(c));
    if (sc) cookie = sc.split(";")[0];
    const j = await res.json().catch(() => null);
    times[kind].push(performance.now() - t0);
    if (j && j.csrf) csrf = j.csrf; if (j && j.session && j.session.csrf) csrf = j.session.csrf;
    if (!res.ok) { errors++; if (errSamples.length < 5) errSamples.push(`${kind} ${res.status} ${j && j.error}`); }
    return j;
  };
  await req("session", "GET", "/api/v1/session");
  await req("sync", "GET", "/api/v1/sync?library=main");
  const r = await req("createLost", "POST", "/api/v1/act", { name: "createLost", library: "main", lang: "en", args: [{ category: ["phones", "bags", "keys", "others"][i % 4], itemName: "Item " + i, color: "Black", dateLost: today, branch: "QCPL Main Library", location: "Reading Area", name: "Person " + i, phone: "0917" + String(1000000 + i), contactPref: "Call me", publicPost: i % 3 === 0 }] });
  if (r && r.result) await req("checkStatus", "POST", "/api/v1/act", { name: "checkStatus", library: "main", lang: "en", args: [r.result.id, String(1000000 + i).slice(-4)] });
}
const t0 = performance.now();
let next = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (next < N) await visitor(next++); }));
const total = (performance.now() - t0) / 1000;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0); };
console.log(`${N} visitors, ${CONC} at the same time: ${total.toFixed(1)} s, errors: ${errors}${errSamples.length ? " (" + errSamples.join("; ") + ")" : ""}`);
for (const [k, a] of Object.entries(times)) console.log(`  ${k.padEnd(12)} n=${a.length}  median ${pct(a, 0.5)} ms   95% under ${pct(a, 0.95)} ms   slowest ${pct(a, 1)} ms`);
console.log(`  dropped connections: ${resets}`); console.log(`  requests per second: ${Math.round(Object.values(times).reduce((s, a) => s + a.length, 0) / total)}`);
