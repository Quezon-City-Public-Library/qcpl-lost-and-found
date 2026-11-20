-- QCPL Lost & Found — SQL schema (SQLite), version 2
-- Made from server/backend/schema.mjs (that file is the source; this one is for reading).
-- The server creates all of this by itself in qcpl.db. You never need to run it.
--
-- Also in the database: sessions (who is signed in, hash only), photos, kv (security
-- counters such as lockouts and code hashes), meta (database version).
-- Columns: id, library, the typed columns, extra (JSON: lists and nested details),
-- ord (display order), saved_at (time saved, milliseconds).

CREATE TABLE IF NOT EXISTS lost_reports (
  id TEXT PRIMARY KEY NOT NULL,
  library TEXT,
  created_at TEXT,
  updated_at TEXT,
  status TEXT,
  user_id TEXT,
  lang TEXT,
  item_name TEXT,
  category TEXT,
  brand TEXT,
  color TEXT,
  description TEXT,
  special_marks TEXT,
  date_lost TEXT,
  time_of_day TEXT,
  branch TEXT,
  place TEXT,
  floor TEXT,
  exact_spot TEXT,
  owner_name TEXT,
  phone TEXT,
  email TEXT,
  owner_role TEXT,
  member_id TEXT,
  contact_by TEXT,
  needs_assistance INTEGER CHECK (needs_assistance IN (0, 1)),
  reward_php REAL,
  reward_status TEXT,
  on_public_list INTEGER CHECK (on_public_list IN (0, 1)),
  main_photo TEXT,
  extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra)),
  ord REAL NOT NULL DEFAULT 0,
  saved_at INTEGER NOT NULL
) -- Lost reports (website key qcpllf_lost);

CREATE INDEX IF NOT EXISTS ix_lost_reports_library ON lost_reports (library);

CREATE INDEX IF NOT EXISTS ix_lost_reports_status ON lost_reports (status);

CREATE INDEX IF NOT EXISTS ix_lost_reports_phone ON lost_reports (phone);

CREATE INDEX IF NOT EXISTS ix_lost_reports_category ON lost_reports (category);

CREATE INDEX IF NOT EXISTS ix_lost_reports_created_at ON lost_reports (created_at);

CREATE INDEX IF NOT EXISTS ix_lost_reports_user_id ON lost_reports (user_id);

CREATE TABLE IF NOT EXISTS found_items (
  id TEXT PRIMARY KEY NOT NULL,
  library TEXT,
  created_at TEXT,
  updated_at TEXT,
  status TEXT,
  user_id TEXT,
  lang TEXT,
  item_name TEXT,
  category TEXT,
  brand TEXT,
  color TEXT,
  public_description TEXT,
  private_details TEXT,
  date_found TEXT,
  branch TEXT,
  place TEXT,
  floor TEXT,
  exact_spot TEXT,
  handover TEXT,
  kept_at TEXT,
  hold_extra_days INTEGER,
  finder_name TEXT,
  finder_phone TEXT,
  finder_email TEXT,
  finder_role TEXT,
  finder_member_id TEXT,
  thank_publicly INTEGER CHECK (thank_publicly IN (0, 1)),
  for_lost_id TEXT,
  thank_note TEXT,
  main_photo TEXT,
  extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra)),
  ord REAL NOT NULL DEFAULT 0,
  saved_at INTEGER NOT NULL
) -- Found items (website key qcpllf_found);

CREATE INDEX IF NOT EXISTS ix_found_items_library ON found_items (library);

CREATE INDEX IF NOT EXISTS ix_found_items_status ON found_items (status);

CREATE INDEX IF NOT EXISTS ix_found_items_finder_phone ON found_items (finder_phone);

CREATE INDEX IF NOT EXISTS ix_found_items_category ON found_items (category);

CREATE INDEX IF NOT EXISTS ix_found_items_created_at ON found_items (created_at);

CREATE INDEX IF NOT EXISTS ix_found_items_date_found ON found_items (date_found);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY NOT NULL,
  library TEXT,
  created_at TEXT,
  updated_at TEXT,
  status TEXT,
  user_id TEXT,
  lang TEXT,
  found_item_id TEXT,
  item_name TEXT,
  lost_report_id TEXT,
  lost_ref_given TEXT,
  claimant_name TEXT,
  phone TEXT,
  email TEXT,
  claimant_role TEXT,
  member_id TEXT,
  description_given TEXT,
  details_given TEXT,
  date_lost TEXT,
  staff_note TEXT,
  extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra)),
  ord REAL NOT NULL DEFAULT 0,
  saved_at INTEGER NOT NULL
) -- Claims (website key qcpllf_claims);

CREATE INDEX IF NOT EXISTS ix_claims_library ON claims (library);

CREATE INDEX IF NOT EXISTS ix_claims_status ON claims (status);

CREATE INDEX IF NOT EXISTS ix_claims_found_item_id ON claims (found_item_id);

CREATE INDEX IF NOT EXISTS ix_claims_lost_report_id ON claims (lost_report_id);

CREATE INDEX IF NOT EXISTS ix_claims_phone ON claims (phone);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  library TEXT,
  created_at TEXT,
  name TEXT,
  phone TEXT,
  email TEXT,
  role TEXT,
  member_id TEXT,
  lang TEXT,
  id_checked INTEGER CHECK (id_checked IN (0, 1)),
  mobile_confirmed INTEGER CHECK (mobile_confirmed IN (0, 1)),
  active INTEGER CHECK (active IN (0, 1)),
  temporary_password INTEGER CHECK (temporary_password IN (0, 1)),
  pass_hash TEXT,
  extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra)),
  ord REAL NOT NULL DEFAULT 0,
  saved_at INTEGER NOT NULL
) -- User accounts (website key qcpllf_users);

CREATE INDEX IF NOT EXISTS ix_users_library ON users (library);

CREATE INDEX IF NOT EXISTS ix_users_phone ON users (phone);

CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);

CREATE TABLE IF NOT EXISTS staff_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  library TEXT,
  username TEXT,
  name TEXT,
  role TEXT,
  active INTEGER CHECK (active IN (0, 1)),
  temporary_password INTEGER CHECK (temporary_password IN (0, 1)),
  created_at TEXT,
  created_by TEXT,
  pass_hash TEXT,
  extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra)),
  ord REAL NOT NULL DEFAULT 0,
  saved_at INTEGER NOT NULL
) -- Staff accounts (website key qcpllf_staffaccts);

CREATE INDEX IF NOT EXISTS ix_staff_accounts_library ON staff_accounts (library);

CREATE INDEX IF NOT EXISTS ix_staff_accounts_username ON staff_accounts (username);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY NOT NULL,
  library TEXT,
  sent_at TEXT,
  phone TEXT,
  user_id TEXT,
  reference TEXT,
  type TEXT,
  title TEXT,
  body TEXT,
  is_read INTEGER CHECK (is_read IN (0, 1)),
  extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra)),
  ord REAL NOT NULL DEFAULT 0,
  saved_at INTEGER NOT NULL
) -- Updates sent to people (website key qcpllf_notifs);

CREATE INDEX IF NOT EXISTS ix_notifications_library ON notifications (library);

CREATE INDEX IF NOT EXISTS ix_notifications_reference ON notifications (reference);

CREATE INDEX IF NOT EXISTS ix_notifications_phone ON notifications (phone);

CREATE INDEX IF NOT EXISTS ix_notifications_user_id ON notifications (user_id);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY NOT NULL,
  library TEXT,
  at TEXT,
  actor TEXT,
  action TEXT,
  reference TEXT,
  detail TEXT,
  extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra)),
  ord REAL NOT NULL DEFAULT 0,
  saved_at INTEGER NOT NULL
) -- Activity log (website key qcpllf_activity);

CREATE INDEX IF NOT EXISTS ix_activity_log_library ON activity_log (library);

CREATE INDEX IF NOT EXISTS ix_activity_log_at ON activity_log (at);

CREATE INDEX IF NOT EXISTS ix_activity_log_reference ON activity_log (reference);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY NOT NULL,
  library TEXT,
  reference TEXT,
  ease INTEGER,
  satisfaction INTEGER,
  comment TEXT,
  at TEXT,
  extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra)),
  ord REAL NOT NULL DEFAULT 0,
  saved_at INTEGER NOT NULL
) -- Feedback (website key qcpllf_feedback);

CREATE INDEX IF NOT EXISTS ix_feedback_library ON feedback (library);

CREATE INDEX IF NOT EXISTS ix_feedback_reference ON feedback (reference);

CREATE TABLE IF NOT EXISTS contribution_certificates (
  id TEXT PRIMARY KEY NOT NULL,
  library TEXT,
  month TEXT,
  person_key TEXT,
  name TEXT,
  phone TEXT,
  user_id TEXT,
  issued_at TEXT,
  issued_by TEXT,
  extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra)),
  ord REAL NOT NULL DEFAULT 0,
  saved_at INTEGER NOT NULL
) -- Certificates of Contribution (website key qcpllf_contribs);

CREATE INDEX IF NOT EXISTS ix_contribution_certificates_library ON contribution_certificates (library);

CREATE INDEX IF NOT EXISTS ix_contribution_certificates_month ON contribution_certificates (month);

CREATE INDEX IF NOT EXISTS ix_contribution_certificates_phone ON contribution_certificates (phone);

CREATE VIEW v_users AS SELECT id, library, name, phone, email, role, member_id, id_checked, mobile_confirmed, active, created_at FROM users;

CREATE VIEW v_staff AS SELECT id, library, username, name, role, active, temporary_password, created_at, created_by FROM staff_accounts;

CREATE VIEW v_open_lost_reports AS SELECT id, library, created_at, date_lost, item_name, category, brand, color, place, status, owner_name, phone, reward_php FROM lost_reports WHERE status IN ('reported','searching','possible-match');

CREATE VIEW v_items_at_office AS SELECT id, library, date_found, item_name, category, color, place, kept_at, status, CAST(julianday('now') - julianday(date_found) AS INTEGER) AS days_kept FROM found_items WHERE status IN ('recorded','possible-owner','claimed');

CREATE VIEW v_claims_with_items AS SELECT c.id AS claim_id, c.library, c.created_at AS claimed_at, c.status AS claim_status, c.claimant_name, c.phone AS claimant_phone,
     f.id AS found_item_id, f.item_name AS found_item, f.status AS found_status, l.id AS lost_report_id, l.item_name AS lost_item
     FROM claims c LEFT JOIN found_items f ON f.id = c.found_item_id LEFT JOIN lost_reports l ON l.id = c.lost_report_id;

CREATE VIEW v_returned_items AS SELECT id, library, item_name, category, finder_name,
     json_extract(extra, '$.release.releasedTo') AS released_to, json_extract(extra, '$.release.idType') AS id_shown,
     json_extract(extra, '$.release.at') AS released_at, json_extract(extra, '$.release.by') AS released_by
     FROM found_items WHERE status = 'returned';

CREATE VIEW v_status_history AS
     SELECT 'lost' AS kind, r.id, r.library, json_extract(h.value, '$.status') AS status, json_extract(h.value, '$.at') AS at, json_extract(h.value, '$.by') AS by, json_extract(h.value, '$.note') AS note FROM lost_reports r, json_each(r.extra, '$.history') h
     UNION ALL SELECT 'found', r.id, r.library, json_extract(h.value, '$.status'), json_extract(h.value, '$.at'), json_extract(h.value, '$.by'), json_extract(h.value, '$.note') FROM found_items r, json_each(r.extra, '$.history') h
     UNION ALL SELECT 'claim', r.id, r.library, json_extract(h.value, '$.status'), json_extract(h.value, '$.at'), json_extract(h.value, '$.by'), json_extract(h.value, '$.note') FROM claims r, json_each(r.extra, '$.history') h;

CREATE VIEW v_monthly_summary AS
     SELECT library, month, SUM(lost) AS lost_reports, SUM(found) AS found_items, SUM(returned) AS returned_to_owner FROM (
       SELECT library, substr(created_at, 1, 7) AS month, 1 AS lost, 0 AS found, 0 AS returned FROM lost_reports
       UNION ALL SELECT library, substr(created_at, 1, 7), 0, 1, 0 FROM found_items
       UNION ALL SELECT library, substr(json_extract(extra, '$.release.at'), 1, 7), 0, 0, 1 FROM found_items WHERE status = 'returned'
     ) GROUP BY library, month ORDER BY month DESC, library;
