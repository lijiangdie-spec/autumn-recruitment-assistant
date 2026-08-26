import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    url: text("url").notNull(),
    trust: text("trust").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastCheckedAt: text("last_checked_at"),
    lastStatus: text("last_status").notNull().default("idle"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("sources_name_unique").on(table.name),
    uniqueIndex("sources_url_unique").on(table.url),
  ],
);

export const companies = sqliteTable(
  "companies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    canonicalName: text("canonical_name").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    aliasesJson: text("aliases_json").notNull().default("[]"),
    nextJobSequence: integer("next_job_sequence").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("companies_normalized_key_unique").on(table.normalizedKey),
    index("companies_canonical_name_idx").on(table.canonicalName),
  ],
);

export const companySources = sqliteTable(
  "company_sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    sourceKind: text("source_kind").notNull().default("unknown"),
    label: text("label").notNull().default(""),
    parseStatus: text("parse_status").notNull().default("pending"),
    parseError: text("parse_error"),
    lastCheckedAt: text("last_checked_at"),
    lastSuccessAt: text("last_success_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("company_sources_company_url_unique").on(table.companyId, table.url),
    index("company_sources_company_idx").on(table.companyId),
  ],
);

export const companyApplicationRules = sqliteTable(
  "company_application_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    campaign: text("campaign").notNull().default("current"),
    maxApplications: integer("max_applications"),
    ruleText: text("rule_text").notNull().default(""),
    sourceUrl: text("source_url"),
    verifiedAt: text("verified_at"),
    extractionStatus: text("extraction_status").notNull().default("needs_review"),
    manualOverride: integer("manual_override", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("company_application_rules_campaign_unique").on(table.companyId, table.campaign),
    index("company_application_rules_company_idx").on(table.companyId),
  ],
);

export const postings = sqliteTable(
  "postings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceJobId: text("source_job_id"),
    sourceId: integer("source_id").references(() => sources.id, { onDelete: "set null" }),
    companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }),
    jobSequence: integer("job_sequence"),
    company: text("company").notNull(),
    title: text("title").notNull(),
    roleFamily: text("role_family").notNull().default("待分类"),
    citiesJson: text("cities_json").notNull().default("[]"),
    cohort: text("cohort"),
    employmentType: text("employment_type").notNull().default("unknown"),
    publishedAt: text("published_at"),
    deadlineAt: text("deadline_at"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    jdText: text("jd_text").notNull().default(""),
    jdParseStatus: text("jd_parse_status").notNull().default("missing"),
    jdSourceUrl: text("jd_source_url"),
    jdParsedAt: text("jd_parsed_at"),
    sourceUrl: text("source_url").notNull(),
    officialUrl: text("official_url"),
    applyUrl: text("apply_url"),
    applicationAvailable: integer("application_available", { mode: "boolean" }),
    sourceName: text("source_name").notNull(),
    sourceTrust: text("source_trust").notNull(),
    verificationStatus: text("verification_status").notNull().default("review"),
    status: text("status").notNull().default("unknown"),
    fitScore: integer("fit_score").notNull().default(0),
    fitReasonsJson: text("fit_reasons_json").notNull().default("[]"),
    gapReasonsJson: text("gap_reasons_json").notNull().default("[]"),
    hardRejectReasonsJson: text("hard_reject_reasons_json").notNull().default("[]"),
    personalScore: integer("personal_score").notNull().default(0),
    landingProbability: integer("landing_probability").notNull().default(0),
    scoreBreakdownJson: text("score_breakdown_json").notNull().default("{}"),
    scoreOverridesJson: text("score_overrides_json").notNull().default("{}"),
    scoreReasonsJson: text("score_reasons_json").notNull().default("[]"),
    scoreVersion: integer("score_version").notNull().default(0),
    workflowState: text("workflow_state").notNull().default("new"),
    manualDisposition: text("manual_disposition"),
    manualDispositionAt: text("manual_disposition_at"),
    manualDispositionReason: text("manual_disposition_reason"),
    reviewedAt: text("reviewed_at"),
    note: text("note").notNull().default(""),
    contentHash: text("content_hash").notNull(),
    fingerprint: text("fingerprint").notNull(),
  },
  (table) => [
    uniqueIndex("postings_fingerprint_unique").on(table.fingerprint),
    index("postings_published_at_idx").on(table.publishedAt),
    index("postings_last_seen_at_idx").on(table.lastSeenAt),
    index("postings_source_id_idx").on(table.sourceId),
    index("postings_source_job_id_idx").on(table.sourceJobId),
    index("postings_company_id_idx").on(table.companyId),
    uniqueIndex("postings_company_job_sequence_unique").on(table.companyId, table.jobSequence),
  ],
);

export const crawlRuns = sqliteTable(
  "crawl_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    cursorFrom: text("cursor_from").notNull(),
    status: text("status").notNull().default("running"),
    discovered: integer("discovered").notNull().default(0),
    inserted: integer("inserted").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    errorsJson: text("errors_json").notNull().default("[]"),
  },
  (table) => [index("crawl_runs_started_at_idx").on(table.startedAt)],
);

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: text("updated_at").notNull(),
});

export const applications = sqliteTable(
  "applications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    postingId: integer("posting_id").references(() => postings.id, { onDelete: "set null" }),
    companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }),
    sequence: integer("sequence").notNull(),
    folderName: text("folder_name").notNull(),
    company: text("company").notNull(),
    title: text("title").notNull(),
    citiesJson: text("cities_json").notNull().default("[]"),
    jdText: text("jd_text").notNull().default(""),
    sourceUrl: text("source_url"),
    applyUrl: text("apply_url"),
    currentStage: text("current_stage").notNull().default("preparing"),
    currentRound: integer("current_round"),
    note: text("note").notNull().default(""),
    resumeStatus: text("resume_status").notNull().default("empty"),
    resumeUpdatedAt: text("resume_updated_at"),
    resumeStale: integer("resume_stale", { mode: "boolean" }).notNull().default(false),
    resumeDraftJson: text("resume_draft_json"),
    personalScore: integer("personal_score").notNull().default(0),
    landingProbability: integer("landing_probability").notNull().default(0),
    scoreBreakdownJson: text("score_breakdown_json").notNull().default("{}"),
    scoreOverridesJson: text("score_overrides_json").notNull().default("{}"),
    scoreReasonsJson: text("score_reasons_json").notNull().default("[]"),
    scoreVersion: integer("score_version").notNull().default(0),
    manualDisposition: text("manual_disposition"),
    manualDispositionAt: text("manual_disposition_at"),
    manualDispositionReason: text("manual_disposition_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("applications_sequence_unique").on(table.sequence),
    uniqueIndex("applications_posting_unique").on(table.postingId),
    index("applications_company_id_idx").on(table.companyId),
  ],
);

export const applicationEvents = sqliteTable(
  "application_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    round: integer("round"),
    occurredAt: text("occurred_at").notNull(),
    note: text("note").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("application_events_application_idx").on(table.applicationId)],
);

export const companyLinks = sqliteTable(
  "company_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }),
    company: text("company").notNull(),
    sourceUrl: text("source_url"),
    applyUrl: text("apply_url").notNull(),
    reason: text("reason").notNull().default(""),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("company_links_apply_url_unique").on(table.applyUrl)],
);

export const spreadsheetImportRuns = sqliteTable("spreadsheet_import_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull().default("running"),
  rowsRead: integer("rows_read").notNull().default(0),
  postingsFound: integer("postings_found").notNull().default(0),
  postingsImported: integer("postings_imported").notNull().default(0),
  linksImported: integer("links_imported").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  errorsJson: text("errors_json").notNull().default("[]"),
});

export const qqdocsImportRuns = sqliteTable(
  "qqdocs_import_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceKey: text("source_key").notNull(),
    boundaryDate: text("boundary_date").notNull(),
    targetDate: text("target_date").notNull(),
    method: text("method"),
    status: text("status").notNull().default("running"),
    snapshotHash: text("snapshot_hash"),
    rowsRead: integer("rows_read").notNull().default(0),
    rowsInRange: integer("rows_in_range").notNull().default(0),
    candidates: integer("candidates").notNull().default(0),
    inserted: integer("inserted").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    ineligible: integer("ineligible").notNull().default(0),
    companyLinks: integer("company_links").notNull().default(0),
    policyExcluded: integer("policy_excluded").notNull().default(0),
    unresolved: integer("unresolved").notNull().default(0),
    dateCountsJson: text("date_counts_json").notNull().default("{}"),
    errorsJson: text("errors_json").notNull().default("[]"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (table) => [index("qqdocs_import_runs_source_idx").on(table.sourceKey), index("qqdocs_import_runs_started_idx").on(table.startedAt)],
);

export const qqdocsSourceCursors = sqliteTable("qqdocs_source_cursors", {
  sourceKey: text("source_key").primaryKey(),
  overlapDate: text("overlap_date").notNull(),
  checkedThrough: text("checked_through").notNull(),
  lastSnapshotHash: text("last_snapshot_hash").notNull(),
  lastRunId: integer("last_run_id").notNull().references(() => qqdocsImportRuns.id),
  updatedAt: text("updated_at").notNull(),
});

export const qqdocsSourceRows = sqliteTable(
  "qqdocs_source_rows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceKey: text("source_key").notNull(),
    sourceIdentity: text("source_identity").notNull(),
    sourceDate: text("source_date").notNull(),
    contentHash: text("content_hash").notNull(),
    dataJson: text("data_json").notNull(),
    postingFingerprintsJson: text("posting_fingerprints_json").notNull().default("[]"),
    archiveOutcome: text("archive_outcome"),
    archiveReason: text("archive_reason"),
    companyLinkId: integer("company_link_id").references(() => companyLinks.id, { onDelete: "set null" }),
    archivedAt: text("archived_at"),
    firstSeenRunId: integer("first_seen_run_id").notNull().references(() => qqdocsImportRuns.id),
    lastSeenRunId: integer("last_seen_run_id").notNull().references(() => qqdocsImportRuns.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("qqdocs_source_rows_identity_unique").on(table.sourceKey, table.sourceIdentity),
    index("qqdocs_source_rows_date_idx").on(table.sourceKey, table.sourceDate),
  ],
);

export const resumeJobs = sqliteTable(
  "resume_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    feedback: text("feedback").notNull().default(""),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => [index("resume_jobs_application_idx").on(table.applicationId)],
);

export type PostingRow = typeof postings.$inferSelect;
export type NewPostingRow = typeof postings.$inferInsert;
export type SourceRow = typeof sources.$inferSelect;
export type CompanyRow = typeof companies.$inferSelect;
export type CompanySourceRow = typeof companySources.$inferSelect;
export type CompanyApplicationRuleRow = typeof companyApplicationRules.$inferSelect;
export type CrawlRunRow = typeof crawlRuns.$inferSelect;
export type ApplicationRow = typeof applications.$inferSelect;
export type ApplicationEventRow = typeof applicationEvents.$inferSelect;
export type CompanyLinkRow = typeof companyLinks.$inferSelect;
export type SpreadsheetImportRunRow = typeof spreadsheetImportRuns.$inferSelect;
export type QqDocsImportRunRow = typeof qqdocsImportRuns.$inferSelect;
export type QqDocsSourceCursorRow = typeof qqdocsSourceCursors.$inferSelect;
export type QqDocsSourceRow = typeof qqdocsSourceRows.$inferSelect;
export type ResumeJobRow = typeof resumeJobs.$inferSelect;
