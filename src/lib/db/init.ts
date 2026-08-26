import type Database from "better-sqlite3";

import { canonicalCompanyName, normalizeCompanyKey } from "@/lib/companies/normalize";
import { assessJdParseStatus } from "@/lib/jd-completeness";
import { START_AT } from "@/lib/types";

function ensureColumn(sqlite: Database.Database, table: "companies" | "postings" | "applications" | "company_links" | "qqdocs_import_runs" | "qqdocs_source_rows", column: string, definition: string): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    try {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (error) {
      // Next.js may initialize multiple route workers against the same fresh
      // database during production build. Another worker can add the column
      // between PRAGMA and ALTER; that race is already the desired result.
      if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) throw error;
    }
  }
}

export function initializeDatabase(sqlite: Database.Database): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      trust TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_checked_at TEXT,
      last_status TEXT NOT NULL DEFAULT 'idle',
      last_error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sources_name_unique ON sources(name);
    CREATE UNIQUE INDEX IF NOT EXISTS sources_url_unique ON sources(url);

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name TEXT NOT NULL,
      normalized_key TEXT NOT NULL UNIQUE,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      next_job_sequence INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS companies_canonical_name_idx ON companies(canonical_name);

    CREATE TABLE IF NOT EXISTS company_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      source_kind TEXT NOT NULL DEFAULT 'unknown',
      label TEXT NOT NULL DEFAULT '',
      parse_status TEXT NOT NULL DEFAULT 'pending',
      parse_error TEXT,
      last_checked_at TEXT,
      last_success_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(company_id, url)
    );
    CREATE INDEX IF NOT EXISTS company_sources_company_idx ON company_sources(company_id);

    CREATE TABLE IF NOT EXISTS company_application_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      campaign TEXT NOT NULL DEFAULT 'current',
      max_applications INTEGER,
      rule_text TEXT NOT NULL DEFAULT '',
      source_url TEXT,
      verified_at TEXT,
      extraction_status TEXT NOT NULL DEFAULT 'needs_review',
      manual_override INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(company_id, campaign)
    );
    CREATE INDEX IF NOT EXISTS company_application_rules_company_idx ON company_application_rules(company_id);

    CREATE TABLE IF NOT EXISTS postings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_job_id TEXT,
      source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      job_sequence INTEGER,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      role_family TEXT NOT NULL DEFAULT '待分类',
      cities_json TEXT NOT NULL DEFAULT '[]',
      cohort TEXT,
      employment_type TEXT NOT NULL DEFAULT 'unknown',
      published_at TEXT,
      deadline_at TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      jd_text TEXT NOT NULL DEFAULT '',
      jd_parse_status TEXT NOT NULL DEFAULT 'missing',
      jd_source_url TEXT,
      jd_parsed_at TEXT,
      source_url TEXT NOT NULL,
      official_url TEXT,
      apply_url TEXT,
      application_available INTEGER,
      source_name TEXT NOT NULL,
      source_trust TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'review',
      status TEXT NOT NULL DEFAULT 'unknown',
      fit_score INTEGER NOT NULL DEFAULT 0,
      fit_reasons_json TEXT NOT NULL DEFAULT '[]',
      gap_reasons_json TEXT NOT NULL DEFAULT '[]',
      hard_reject_reasons_json TEXT NOT NULL DEFAULT '[]',
      personal_score INTEGER NOT NULL DEFAULT 0,
      landing_probability INTEGER NOT NULL DEFAULT 0,
      score_breakdown_json TEXT NOT NULL DEFAULT '{}',
      score_overrides_json TEXT NOT NULL DEFAULT '{}',
      score_reasons_json TEXT NOT NULL DEFAULT '[]',
      score_version INTEGER NOT NULL DEFAULT 0,
      workflow_state TEXT NOT NULL DEFAULT 'new',
      manual_disposition TEXT,
      manual_disposition_at TEXT,
      manual_disposition_reason TEXT,
      reviewed_at TEXT,
      note TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL,
      fingerprint TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS postings_fingerprint_unique ON postings(fingerprint);
    CREATE INDEX IF NOT EXISTS postings_published_at_idx ON postings(published_at);
    CREATE INDEX IF NOT EXISTS postings_last_seen_at_idx ON postings(last_seen_at);
    CREATE INDEX IF NOT EXISTS postings_source_id_idx ON postings(source_id);

    CREATE TABLE IF NOT EXISTS crawl_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      cursor_from TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      discovered INTEGER NOT NULL DEFAULT 0,
      inserted INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS crawl_runs_started_at_idx ON crawl_runs(started_at);

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      posting_id INTEGER REFERENCES postings(id) ON DELETE SET NULL,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      sequence INTEGER NOT NULL UNIQUE,
      folder_name TEXT NOT NULL,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      cities_json TEXT NOT NULL DEFAULT '[]',
      jd_text TEXT NOT NULL DEFAULT '',
      source_url TEXT,
      apply_url TEXT,
      current_stage TEXT NOT NULL DEFAULT 'preparing',
      current_round INTEGER,
      note TEXT NOT NULL DEFAULT '',
      resume_status TEXT NOT NULL DEFAULT 'empty',
      resume_updated_at TEXT,
      resume_stale INTEGER NOT NULL DEFAULT 0,
      resume_draft_json TEXT,
      personal_score INTEGER NOT NULL DEFAULT 0,
      landing_probability INTEGER NOT NULL DEFAULT 0,
      score_breakdown_json TEXT NOT NULL DEFAULT '{}',
      score_overrides_json TEXT NOT NULL DEFAULT '{}',
      score_reasons_json TEXT NOT NULL DEFAULT '[]',
      score_version INTEGER NOT NULL DEFAULT 0,
      manual_disposition TEXT,
      manual_disposition_at TEXT,
      manual_disposition_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS applications_sequence_unique ON applications(sequence);
    CREATE UNIQUE INDEX IF NOT EXISTS applications_posting_unique ON applications(posting_id);

    CREATE TABLE IF NOT EXISTS application_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      round INTEGER,
      occurred_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS application_events_application_idx ON application_events(application_id);

    CREATE TABLE IF NOT EXISTS company_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      company TEXT NOT NULL,
      source_url TEXT,
      apply_url TEXT NOT NULL UNIQUE,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spreadsheet_import_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      rows_read INTEGER NOT NULL DEFAULT 0,
      postings_found INTEGER NOT NULL DEFAULT 0,
      postings_imported INTEGER NOT NULL DEFAULT 0,
      links_imported INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS qqdocs_import_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_key TEXT NOT NULL,
      boundary_date TEXT NOT NULL,
      target_date TEXT NOT NULL,
      method TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      snapshot_hash TEXT,
      rows_read INTEGER NOT NULL DEFAULT 0,
      rows_in_range INTEGER NOT NULL DEFAULT 0,
      candidates INTEGER NOT NULL DEFAULT 0,
      inserted INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      ineligible INTEGER NOT NULL DEFAULT 0,
      company_links INTEGER NOT NULL DEFAULT 0,
      policy_excluded INTEGER NOT NULL DEFAULT 0,
      unresolved INTEGER NOT NULL DEFAULT 0,
      date_counts_json TEXT NOT NULL DEFAULT '{}',
      errors_json TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS qqdocs_import_runs_source_idx ON qqdocs_import_runs(source_key);
    CREATE INDEX IF NOT EXISTS qqdocs_import_runs_started_idx ON qqdocs_import_runs(started_at);

    CREATE TABLE IF NOT EXISTS qqdocs_source_cursors (
      source_key TEXT PRIMARY KEY,
      overlap_date TEXT NOT NULL,
      checked_through TEXT NOT NULL,
      last_snapshot_hash TEXT NOT NULL,
      last_run_id INTEGER NOT NULL REFERENCES qqdocs_import_runs(id),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS qqdocs_source_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_key TEXT NOT NULL,
      source_identity TEXT NOT NULL,
      source_date TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      data_json TEXT NOT NULL,
      posting_fingerprints_json TEXT NOT NULL DEFAULT '[]',
      archive_outcome TEXT,
      archive_reason TEXT,
      company_link_id INTEGER REFERENCES company_links(id) ON DELETE SET NULL,
      archived_at TEXT,
      first_seen_run_id INTEGER NOT NULL REFERENCES qqdocs_import_runs(id),
      last_seen_run_id INTEGER NOT NULL REFERENCES qqdocs_import_runs(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source_key, source_identity)
    );
    CREATE INDEX IF NOT EXISTS qqdocs_source_rows_date_idx ON qqdocs_source_rows(source_key, source_date);

    CREATE TABLE IF NOT EXISTS resume_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      feedback TEXT NOT NULL DEFAULT '',
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS resume_jobs_application_idx ON resume_jobs(application_id);
  `);

  for (const table of ["postings", "applications"] as const) {
    ensureColumn(sqlite, table, "personal_score", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(sqlite, table, "landing_probability", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(sqlite, table, "score_breakdown_json", "TEXT NOT NULL DEFAULT '{}'");
    ensureColumn(sqlite, table, "score_overrides_json", "TEXT NOT NULL DEFAULT '{}'");
    ensureColumn(sqlite, table, "score_reasons_json", "TEXT NOT NULL DEFAULT '[]'");
    ensureColumn(sqlite, table, "score_version", "INTEGER NOT NULL DEFAULT 0");
  }

  ensureColumn(sqlite, "companies", "next_job_sequence", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(sqlite, "postings", "company_id", "INTEGER REFERENCES companies(id) ON DELETE SET NULL");
  ensureColumn(sqlite, "postings", "job_sequence", "INTEGER");
  ensureColumn(sqlite, "postings", "source_job_id", "TEXT");
  ensureColumn(sqlite, "postings", "jd_parse_status", "TEXT NOT NULL DEFAULT 'missing'");
  ensureColumn(sqlite, "postings", "application_available", "INTEGER");
  ensureColumn(sqlite, "postings", "jd_source_url", "TEXT");
  ensureColumn(sqlite, "postings", "jd_parsed_at", "TEXT");
  ensureColumn(sqlite, "postings", "manual_disposition", "TEXT");
  ensureColumn(sqlite, "postings", "manual_disposition_at", "TEXT");
  ensureColumn(sqlite, "postings", "manual_disposition_reason", "TEXT");
  ensureColumn(sqlite, "postings", "reviewed_at", "TEXT");
  ensureColumn(sqlite, "applications", "company_id", "INTEGER REFERENCES companies(id) ON DELETE SET NULL");
  ensureColumn(sqlite, "applications", "manual_disposition", "TEXT");
  ensureColumn(sqlite, "applications", "manual_disposition_at", "TEXT");
  ensureColumn(sqlite, "applications", "manual_disposition_reason", "TEXT");
  ensureColumn(sqlite, "company_links", "company_id", "INTEGER REFERENCES companies(id) ON DELETE SET NULL");
  ensureColumn(sqlite, "qqdocs_import_runs", "company_links", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "qqdocs_import_runs", "policy_excluded", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "qqdocs_import_runs", "unresolved", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(sqlite, "qqdocs_source_rows", "archive_outcome", "TEXT");
  ensureColumn(sqlite, "qqdocs_source_rows", "archive_reason", "TEXT");
  ensureColumn(sqlite, "qqdocs_source_rows", "company_link_id", "INTEGER REFERENCES company_links(id) ON DELETE SET NULL");
  ensureColumn(sqlite, "qqdocs_source_rows", "archived_at", "TEXT");
  sqlite.exec("CREATE INDEX IF NOT EXISTS postings_company_id_idx ON postings(company_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS postings_source_job_id_idx ON postings(source_job_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS applications_company_id_idx ON applications(company_id)");

  const now = new Date().toISOString();
  const seed = sqlite.transaction(() => {
    const insertState = sqlite.prepare(`
      INSERT OR IGNORE INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
    `);
    insertState.run("startAt", START_AT, now);
    insertState.run("lastSuccessfulRefreshAt", null, now);
  });
  seed();
  backfillCompanies(sqlite, now);
  backfillJobSequences(sqlite);
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS postings_company_job_sequence_unique ON postings(company_id, job_sequence)");
}

function backfillJobSequences(sqlite: Database.Database): void {
  const companyRows = sqlite.prepare("SELECT id, next_job_sequence FROM companies ORDER BY id").all() as Array<{
    id: number;
    next_job_sequence: number;
  }>;
  const maxSequence = sqlite.prepare("SELECT COALESCE(MAX(job_sequence), 0) AS value FROM postings WHERE company_id = ?");
  const unnumbered = sqlite.prepare(`
    SELECT id FROM postings
    WHERE company_id = ? AND job_sequence IS NULL
    ORDER BY first_seen_at, id
  `);
  const assign = sqlite.prepare("UPDATE postings SET job_sequence = ? WHERE id = ?");
  const updateCounter = sqlite.prepare("UPDATE companies SET next_job_sequence = ? WHERE id = ?");

  sqlite.transaction(() => {
    for (const company of companyRows) {
      const currentMax = (maxSequence.get(company.id) as { value: number }).value;
      let sequence = Math.max(currentMax, company.next_job_sequence - 1);
      const rows = unnumbered.all(company.id) as Array<{ id: number }>;
      for (const row of rows) assign.run(++sequence, row.id);
      updateCounter.run(sequence + 1, company.id);
    }
  })();
}

function backfillCompanies(sqlite: Database.Database, now: string): void {
  const rows = sqlite.prepare(`
    SELECT company FROM postings
    UNION SELECT company FROM applications
    UNION SELECT company FROM company_links
  `).all() as Array<{ company: string }>;
  const insertCompany = sqlite.prepare(`
    INSERT OR IGNORE INTO companies
      (canonical_name, normalized_key, aliases_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const findCompany = sqlite.prepare("SELECT id, aliases_json FROM companies WHERE normalized_key = ?");
  const updateAliases = sqlite.prepare("UPDATE companies SET aliases_json = ?, updated_at = ? WHERE id = ?");
  const updatePostingCompany = sqlite.prepare("UPDATE postings SET company_id = ? WHERE company = ? AND company_id IS NULL");
  const updateApplicationCompany = sqlite.prepare("UPDATE applications SET company_id = ? WHERE company = ? AND company_id IS NULL");
  const updateLinkCompany = sqlite.prepare("UPDATE company_links SET company_id = ? WHERE company = ? AND company_id IS NULL");

  const migrate = sqlite.transaction(() => {
    for (const row of rows) {
      const rawName = row.company.trim();
      if (!rawName) continue;
      const canonicalName = canonicalCompanyName(rawName);
      const normalizedKey = normalizeCompanyKey(canonicalName);
      insertCompany.run(canonicalName, normalizedKey, JSON.stringify(rawName === canonicalName ? [] : [rawName]), now, now);
      const company = findCompany.get(normalizedKey) as { id: number; aliases_json: string };
      let aliases: string[] = [];
      try {
        aliases = JSON.parse(company.aliases_json) as string[];
      } catch {
        aliases = [];
      }
      if (rawName !== canonicalName && !aliases.includes(rawName)) {
        aliases.push(rawName);
        updateAliases.run(JSON.stringify(aliases), now, company.id);
      }
      updatePostingCompany.run(company.id, row.company);
      updateApplicationCompany.run(company.id, row.company);
      updateLinkCompany.run(company.id, row.company);
    }

    const updateJdStatus = sqlite.prepare("UPDATE postings SET jd_parse_status = ? WHERE id = ?");
    const jdRows = sqlite.prepare("SELECT id, jd_text FROM postings").all() as Array<{ id: number; jd_text: string }>;
    for (const posting of jdRows) updateJdStatus.run(assessJdParseStatus(posting.jd_text), posting.id);
    sqlite.prepare(`
      UPDATE postings
      SET manual_disposition = 'trash',
          manual_disposition_at = COALESCE(manual_disposition_at, ?),
          manual_disposition_reason = COALESCE(manual_disposition_reason, '从旧版“跳过”状态迁移')
      WHERE workflow_state = 'skipped' AND manual_disposition IS NULL
    `).run(now);

    const addSource = sqlite.prepare(`
      INSERT OR IGNORE INTO company_sources
        (company_id, url, source_kind, label, parse_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `);
    const postingRows = sqlite.prepare(`
      SELECT company_id, source_url, official_url, apply_url
      FROM postings WHERE company_id IS NOT NULL
    `).all() as Array<{ company_id: number; source_url: string; official_url: string | null; apply_url: string | null }>;
    for (const posting of postingRows) {
      if (posting.source_url) addSource.run(posting.company_id, posting.source_url, "announcement", "岗位来源", now, now);
      if (posting.official_url) addSource.run(posting.company_id, posting.official_url, "job_list", "官方招聘页", now, now);
      if (posting.apply_url) addSource.run(posting.company_id, posting.apply_url, "apply", "投递链接", now, now);
    }
    const linkRows = sqlite.prepare(`
      SELECT company_id, source_url, apply_url FROM company_links WHERE company_id IS NOT NULL
    `).all() as Array<{ company_id: number; source_url: string | null; apply_url: string }>;
    for (const link of linkRows) {
      if (link.source_url) addSource.run(link.company_id, link.source_url, "announcement", "招聘信息来源", now, now);
      if (link.apply_url) addSource.run(link.company_id, link.apply_url, "apply", "投递链接", now, now);
    }
  });
  migrate();
}
