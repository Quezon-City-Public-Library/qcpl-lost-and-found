/* ==========================================================================
   Keeping personal information only as long as the Privacy Policy says.
   Runs every night (server.mjs, before the daily backup):
   1. the site's own rule (applyRetention in js/store.js, limits in ORG.privacy
      in js/data.js) erases or anonymizes old records, updates, comments,
      log entries and unused accounts;
   2. photos that no report uses any more are deleted from the database.
   ========================================================================== */
const PHOTO_KEYS = ["qcpllf_lost", "qcpllf_found", "qcpllf_claims"];

/** at: the time to measure from (tests use a later date) → { records, notifs, …, photos } */
export async function runPrivacyJobs({ engine, store, log = () => {}, at = Date.now() }) {
  const r = await engine.exec({ ip: "system", library: engine.LF.libraries[0].id, lang: "en", unlocked: [] }, (LF) => LF.applyRetention(at));
  const done = { ...((r && r.result) || {}) };
  const total = Object.values(done).reduce((a, n) => a + n, 0);
  if (total) log("Old personal information erased (Privacy Policy):", JSON.stringify(done));

  const used = new Set();
  for (const key of PHOTO_KEYS) for (const rec of engine.snapshot(key)) for (const m of JSON.stringify(rec).matchAll(/\/api\/v1\/photo\/([a-f0-9]{32})/g)) used.add(m[1]);
  const unused = store.q.photoIds.all().filter((p) => p.owner_id && !used.has(p.id)).map((p) => p.id);
  if (unused.length && store.cloud) await store.cloud.deletePhotos(unused); // Supabase first (database row and file)
  for (const id of unused) store.q.photoDelete.run(id);
  const photos = unused.length;
  if (photos) log(`Photos no longer used by any report removed: ${photos}`);
  return { ...done, photos };
}
