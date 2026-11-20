/* A stand-in for Supabase, for tests only (nothing leaves this computer):
   - the database: real Postgres (PGlite) on a local port;
   - photo storage: a tiny server that answers like Supabase Storage. */
import http from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { SERVER_DIR } from "./server.mjs";

const req = createRequire(path.join(SERVER_DIR, "package.json"));
const imp = (name) => import(pathToFileURL(req.resolve(name)).href);

export const FAKE_KEY = "sb_secret_test-key-not-real-0123456789";

export async function startFakeSupabase({ pgPort = 54329, storagePort = 54330 } = {}) {
  const { PGlite } = await imp("@electric-sql/pglite");
  const { PGLiteSocketServer } = await imp("@electric-sql/pglite-socket");
  const db = await PGlite.create();
  let sock = new PGLiteSocketServer({ db, port: pgPort, host: "127.0.0.1" });
  await sock.start();

  const buckets = new Map(), files = new Map();
  let storageDown = false;
  const storage = http.createServer(async (rq, rs) => {
    const send = (code, body) => { rs.writeHead(code, { "Content-Type": "application/json" }); rs.end(typeof body === "string" ? body : JSON.stringify(body)); };
    if (storageDown) return send(503, { error: "down" });
    if (rq.headers.apikey !== FAKE_KEY) return send(401, { error: "Invalid key" });
    const chunks = []; for await (const c of rq) chunks.push(c);
    const body = Buffer.concat(chunks), u = new URL(rq.url, "http://x"), p = u.pathname;
    let m;
    if ((m = /^\/storage\/v1\/bucket\/([^/]+)$/.exec(p)) && rq.method === "GET") return buckets.has(m[1]) ? send(200, buckets.get(m[1])) : send(400, { error: "Bucket not found" });
    if (p === "/storage/v1/bucket" && rq.method === "POST") { const b = JSON.parse(body); buckets.set(b.id, { id: b.id, public: !!b.public }); return send(200, { name: b.id }); }
    if ((m = /^\/storage\/v1\/object\/([^/]+)\/([^/]+)$/.exec(p))) {
      const k = m[1] + "/" + m[2];
      if (!buckets.has(m[1])) return send(400, { error: "Bucket not found" });
      if (rq.method === "POST") { files.set(k, { type: rq.headers["content-type"], bytes: body }); return send(200, { Key: k }); }
      if (rq.method === "HEAD" || rq.method === "GET") {
        const f = files.get(k); if (!f) return send(404, { error: "not found" });
        rs.writeHead(200, { "Content-Type": f.type, "Content-Length": f.bytes.length }); return rs.end(rq.method === "HEAD" ? undefined : f.bytes);
      }
    }
    if ((m = /^\/storage\/v1\/object\/([^/]+)$/.exec(p)) && rq.method === "DELETE") { for (const id of JSON.parse(body).prefixes || []) files.delete(m[1] + "/" + id); return send(200, []); }
    send(404, { error: "unknown" });
  });
  await new Promise((ok) => storage.listen(storagePort, "127.0.0.1", ok));

  return {
    db, files, buckets,
    dbUrl: `postgres://postgres:postgres@127.0.0.1:${pgPort}/postgres`,
    storageUrl: `http://127.0.0.1:${storagePort}`,
    env(region = "Test region") { return { SUPABASE_DB_URL: this.dbUrl, SUPABASE_URL: this.storageUrl, SUPABASE_SERVICE_KEY: FAKE_KEY, SUPABASE_REGION: region, SUPABASE_CA_FILE: "", SUPABASE_POOL_MAX: "1" }; }, // the stand-in takes one connection at a time
    query: (sql, params) => db.query(sql, params),
    async dbDown() { await sock.stop(); },
    async dbUp() { sock = new PGLiteSocketServer({ db, port: pgPort, host: "127.0.0.1" }); await sock.start(); },
    setStorageDown(v) { storageDown = v; },
    async stop() { try { await sock.stop(); } catch {} await new Promise((ok) => storage.close(ok)); await db.close(); },
  };
}
