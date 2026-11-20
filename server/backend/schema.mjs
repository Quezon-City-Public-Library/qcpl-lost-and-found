/* ==========================================================================
   The SQL schema: one real table per kind of record, with typed columns.

   Every everyday field is its own column (item name, phone, status, dates…),
   with indexes for the usual searches. Lists and nested details (status history,
   release, pick-up, photos, edits…) are kept in the "extra" column as JSON, and
   the views at the bottom turn them back into plain rows (e.g. v_status_history).

   A record is saved exactly as the website made it and read back exactly the
   same: a field goes into its column only when its value has that column's type;
   anything else (and any field added in the future) goes into "extra".

   Open the database with any SQLite tool (e.g. "DB Browser for SQLite") to look
   at it or run SQL. Don't change rows while the server runs; use the website.
   ========================================================================== */

// [field in the website, column, type] — type: text · int · real · bool
const COMMON = [["createdAt", "created_at", "text"], ["updatedAt", "updated_at", "text"], ["status", "status", "text"], ["userId", "user_id", "text"], ["lang", "lang", "text"]];
export const TABLES = {
  qcpllf_lost: { table: "lost_reports", label: "Lost reports", cols: [
    ...COMMON, ["itemName", "item_name", "text"], ["category", "category", "text"], ["brand", "brand", "text"], ["color", "color", "text"],
    ["description", "description", "text"], ["uniqueDetails", "special_marks", "text"], ["dateLost", "date_lost", "text"], ["timeOfDay", "time_of_day", "text"],
    ["branch", "branch", "text"], ["location", "place", "text"], ["floor", "floor", "text"], ["locationDetail", "exact_spot", "text"],
    ["name", "owner_name", "text"], ["phone", "phone", "text"], ["email", "email", "text"], ["role", "owner_role", "text"], ["memberId", "member_id", "text"],
    ["contactPref", "contact_by", "text"], ["assist", "needs_assistance", "bool"], ["bounty", "reward_php", "real"], ["bountyStatus", "reward_status", "text"],
    ["publicPost", "on_public_list", "bool"], ["photo", "main_photo", "text"]],
    indexes: [["status"], ["phone"], ["category"], ["created_at"], ["user_id"]] },
  qcpllf_found: { table: "found_items", label: "Found items", cols: [
    ...COMMON, ["title", "item_name", "text"], ["category", "category", "text"], ["brand", "brand", "text"], ["color", "color", "text"],
    ["description", "public_description", "text"], ["privateDetails", "private_details", "text"], ["date", "date_found", "text"],
    ["branch", "branch", "text"], ["location", "place", "text"], ["floor", "floor", "text"], ["locationDetail", "exact_spot", "text"],
    ["handover", "handover", "text"], ["keptAt", "kept_at", "text"], ["holdExtra", "hold_extra_days", "int"],
    ["finderName", "finder_name", "text"], ["finderPhone", "finder_phone", "text"], ["finderEmail", "finder_email", "text"], ["finderRole", "finder_role", "text"],
    ["finderMemberId", "finder_member_id", "text"], ["publicThanks", "thank_publicly", "bool"], ["forLost", "for_lost_id", "text"], ["thankNote", "thank_note", "text"],
    ["photo", "main_photo", "text"]],
    indexes: [["status"], ["finder_phone"], ["category"], ["created_at"], ["date_found"]] },
  qcpllf_claims: { table: "claims", label: "Claims", cols: [
    ...COMMON, ["itemId", "found_item_id", "text"], ["itemTitle", "item_name", "text"], ["lostId", "lost_report_id", "text"], ["lostRef", "lost_ref_given", "text"],
    ["name", "claimant_name", "text"], ["phone", "phone", "text"], ["email", "email", "text"], ["role", "claimant_role", "text"], ["memberId", "member_id", "text"],
    ["general", "description_given", "text"], ["specific", "details_given", "text"], ["dateLost", "date_lost", "text"], ["reviewNote", "staff_note", "text"]],
    indexes: [["status"], ["found_item_id"], ["lost_report_id"], ["phone"]] },
  qcpllf_users: { table: "users", label: "User accounts", cols: [
    ["createdAt", "created_at", "text"], ["name", "name", "text"], ["phone", "phone", "text"], ["email", "email", "text"], ["role", "role", "text"],
    ["memberId", "member_id", "text"], ["lang", "lang", "text"], ["verified", "id_checked", "bool"], ["contactVerified", "mobile_confirmed", "bool"],
    ["active", "active", "bool"], ["mustChange", "temporary_password", "bool"], ["passHash", "pass_hash", "text"]],
    indexes: [["phone"], ["email"]] },
  qcpllf_staffaccts: { table: "staff_accounts", label: "Staff accounts", cols: [
    ["username", "username", "text"], ["name", "name", "text"], ["role", "role", "text"], ["active", "active", "bool"], ["mustChange", "temporary_password", "bool"],
    ["createdAt", "created_at", "text"], ["createdBy", "created_by", "text"], ["passHash", "pass_hash", "text"]],
    indexes: [["username"]] },
  qcpllf_notifs: { table: "notifications", label: "Updates sent to people", cols: [
    ["at", "sent_at", "text"], ["phone", "phone", "text"], ["userId", "user_id", "text"], ["ref", "reference", "text"], ["type", "type", "text"],
    ["title", "title", "text"], ["body", "body", "text"], ["read", "is_read", "bool"]],
    indexes: [["reference"], ["phone"], ["user_id"]] },
  qcpllf_activity: { table: "activity_log", label: "Activity log", cols: [
    ["at", "at", "text"], ["actor", "actor", "text"], ["action", "action", "text"], ["ref", "reference", "text"], ["detail", "detail", "text"]],
    indexes: [["at"], ["reference"]] },
  qcpllf_feedback: { table: "feedback", label: "Feedback", cols: [
    ["ref", "reference", "text"], ["ease", "ease", "int"], ["satisfaction", "satisfaction", "int"], ["comment", "comment", "text"], ["at", "at", "text"]],
    indexes: [["reference"]] },
  qcpllf_contribs: { table: "contribution_certificates", label: "Certificates of Contribution", cols: [
    ["month", "month", "text"], ["key", "person_key", "text"], ["name", "name", "text"], ["phone", "phone", "text"], ["userId", "user_id", "text"],
    ["issuedAt", "issued_at", "text"], ["issuedBy", "issued_by", "text"]],
    indexes: [["month"], ["phone"]] },
};

const fits = (type, v) => (type === "text" ? typeof v === "string" : type === "int" ? Number.isInteger(v) : type === "real" ? typeof v === "number" && isFinite(v) : type === "bool" ? typeof v === "boolean" : false);
const SQLTYPE = { text: "TEXT", int: "INTEGER", real: "REAL", bool: "INTEGER" };

/** A record → the values for its row (columns + extra JSON) */
export function encode(key, rec) {
  const t = TABLES[key];
  const extra = {}, values = {};
  const byField = new Map(t.cols.map((c) => [c[0], c]));
  for (const [f, v] of Object.entries(rec)) {
    if (f === "id" || (f === "library" && typeof v === "string")) continue;
    const c = byField.get(f);
    if (c && fits(c[2], v)) values[c[1]] = c[2] === "bool" ? (v ? 1 : 0) : v;
    else extra[f] = v;
  }
  return { values, extra: JSON.stringify(extra) };
}
/** A row → the record, exactly as it was saved */
export function decode(key, row) {
  const t = TABLES[key];
  const rec = { id: row.id, ...(row.library !== null && row.library !== undefined ? { library: row.library } : {}), ...JSON.parse(row.extra || "{}") };
  for (const [f, col, type] of t.cols) if (row[col] !== null && row[col] !== undefined) rec[f] = type === "bool" ? row[col] === 1 : row[col];
  return rec;
}

/** CREATE statements for every table, index and view */
export function ddl() {
  const out = [];
  for (const [key, t] of Object.entries(TABLES)) {
    out.push(`CREATE TABLE IF NOT EXISTS ${t.table} (
  id TEXT PRIMARY KEY NOT NULL,
  library TEXT,
${t.cols.map(([, col, type]) => `  ${col} ${SQLTYPE[type]}${type === "bool" ? ` CHECK (${col} IN (0, 1))` : ""},`).join("\n")}
  extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra)),
  ord REAL NOT NULL DEFAULT 0,
  saved_at INTEGER NOT NULL
) -- ${t.label} (website key ${key})`);
    out.push(`CREATE INDEX IF NOT EXISTS ix_${t.table}_library ON ${t.table} (library)`);
    for (const cols of t.indexes) out.push(`CREATE INDEX IF NOT EXISTS ix_${t.table}_${cols.join("_")} ON ${t.table} (${cols.join(", ")})`);
  }
  out.push(...VIEWS);
  return out;
}

/* Ready-made views (read-only) for reports and SQL tools */
const ACTIVE_LOST = "('reported','searching','possible-match')";
export const VIEWS = [
  `DROP VIEW IF EXISTS v_users`,
  `CREATE VIEW v_users AS SELECT id, library, name, phone, email, role, member_id, id_checked, mobile_confirmed, active, created_at FROM users`,
  `DROP VIEW IF EXISTS v_staff`,
  `CREATE VIEW v_staff AS SELECT id, library, username, name, role, active, temporary_password, created_at, created_by FROM staff_accounts`,
  `DROP VIEW IF EXISTS v_open_lost_reports`,
  `CREATE VIEW v_open_lost_reports AS SELECT id, library, created_at, date_lost, item_name, category, brand, color, place, status, owner_name, phone FROM lost_reports WHERE status IN ${ACTIVE_LOST}`,
  `DROP VIEW IF EXISTS v_items_at_office`,
  `CREATE VIEW v_items_at_office AS SELECT id, library, date_found, item_name, category, color, place, kept_at, status, CAST(julianday('now') - julianday(date_found) AS INTEGER) AS days_kept FROM found_items WHERE status IN ('recorded','possible-owner','claimed')`,
  `DROP VIEW IF EXISTS v_claims_with_items`,
  `CREATE VIEW v_claims_with_items AS SELECT c.id AS claim_id, c.library, c.created_at AS claimed_at, c.status AS claim_status, c.claimant_name, c.phone AS claimant_phone,
     f.id AS found_item_id, f.item_name AS found_item, f.status AS found_status, l.id AS lost_report_id, l.item_name AS lost_item
     FROM claims c LEFT JOIN found_items f ON f.id = c.found_item_id LEFT JOIN lost_reports l ON l.id = c.lost_report_id`,
  `DROP VIEW IF EXISTS v_returned_items`,
  `CREATE VIEW v_returned_items AS SELECT id, library, item_name, category, finder_name,
     json_extract(extra, '$.release.releasedTo') AS released_to, json_extract(extra, '$.release.idType') AS id_shown,
     json_extract(extra, '$.release.at') AS released_at, json_extract(extra, '$.release.by') AS released_by
     FROM found_items WHERE status = 'returned'`,
  `DROP VIEW IF EXISTS v_status_history`,
  `CREATE VIEW v_status_history AS
     SELECT 'lost' AS kind, r.id, r.library, json_extract(h.value, '$.status') AS status, json_extract(h.value, '$.at') AS at, json_extract(h.value, '$.by') AS by, json_extract(h.value, '$.note') AS note FROM lost_reports r, json_each(r.extra, '$.history') h
     UNION ALL SELECT 'found', r.id, r.library, json_extract(h.value, '$.status'), json_extract(h.value, '$.at'), json_extract(h.value, '$.by'), json_extract(h.value, '$.note') FROM found_items r, json_each(r.extra, '$.history') h
     UNION ALL SELECT 'claim', r.id, r.library, json_extract(h.value, '$.status'), json_extract(h.value, '$.at'), json_extract(h.value, '$.by'), json_extract(h.value, '$.note') FROM claims r, json_each(r.extra, '$.history') h`,
  `DROP VIEW IF EXISTS v_monthly_summary`,
  `CREATE VIEW v_monthly_summary AS
     SELECT library, month, SUM(lost) AS lost_reports, SUM(found) AS found_items, SUM(returned) AS returned_to_owner FROM (
       SELECT library, substr(created_at, 1, 7) AS month, 1 AS lost, 0 AS found, 0 AS returned FROM lost_reports
       UNION ALL SELECT library, substr(created_at, 1, 7), 0, 1, 0 FROM found_items
       UNION ALL SELECT library, substr(json_extract(extra, '$.release.at'), 1, 7), 0, 0, 1 FROM found_items WHERE status = 'returned'
     ) GROUP BY library, month ORDER BY month DESC, library`,
];
