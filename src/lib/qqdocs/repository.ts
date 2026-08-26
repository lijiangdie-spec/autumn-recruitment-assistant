import { sqlite } from "@/lib/db/client";
import { upsertCompanyLink } from "@/lib/imports/repository";
import type { SourceRowCompanyLink } from "@/lib/imports/source-row";
import type { SourceRowArchiveResult } from "@/lib/qqdocs/prepare";
import type { NormalizedSheetRow, QqDocsExtractionMethod } from "@/lib/qqdocs/types";
import type { SourceArchiveCoverage } from "@/lib/types";

export interface QqDocsCursorRecord {
  sourceKey: string;
  overlapDate: string;
  checkedThrough: string;
  lastSnapshotHash: string;
  lastRunId: number;
  updatedAt: string;
}

export interface QqDocsRunRecord {
  id: number;
  sourceKey: string;
  boundaryDate: string;
  targetDate: string;
  method: QqDocsExtractionMethod | null;
  status: "running" | "success" | "failed";
  snapshotHash: string | null;
  rowsRead: number;
  rowsInRange: number;
  candidates: number;
  inserted: number;
  updated: number;
  skipped: number;
  ineligible: number;
  companyLinks: number;
  policyExcluded: number;
  unresolved: number;
  dateCounts: Record<string, number>;
  errors: Array<{ code: string; message: string }>;
  startedAt: string;
  finishedAt: string | null;
}

export interface QqDocsImportCounts {
  candidates: number;
  inserted: number;
  updated: number;
  skipped: number;
  ineligible: number;
  companyLinks: number;
  policyExcluded: number;
  unresolved: number;
}

export type QqDocsPostingImportCounts = Pick<QqDocsImportCounts, "candidates" | "inserted" | "updated" | "skipped" | "ineligible">;

interface RawCursor {
  sourceKey: string;
  overlapDate: string;
  checkedThrough: string;
  lastSnapshotHash: string;
  lastRunId: number;
  updatedAt: string;
}

interface RawRun extends Omit<QqDocsRunRecord, "method" | "status" | "dateCounts" | "errors"> {
  method: string | null;
  status: string;
  dateCountsJson: string;
  errorsJson: string;
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function toRun(row: RawRun): QqDocsRunRecord {
  return {
    ...row,
    method: row.method === "structured" || row.method === "clipboard" ? row.method : null,
    status: row.status === "success" || row.status === "failed" ? row.status : "running",
    dateCounts: parseJson(row.dateCountsJson, {}),
    errors: parseJson(row.errorsJson, []),
  };
}

const RUN_SELECT = `
  SELECT
    id,
    source_key AS sourceKey,
    boundary_date AS boundaryDate,
    target_date AS targetDate,
    method,
    status,
    snapshot_hash AS snapshotHash,
    rows_read AS rowsRead,
    rows_in_range AS rowsInRange,
    candidates,
    inserted,
    updated,
    skipped,
    ineligible,
    company_links AS companyLinks,
    policy_excluded AS policyExcluded,
    unresolved,
    date_counts_json AS dateCountsJson,
    errors_json AS errorsJson,
    started_at AS startedAt,
    finished_at AS finishedAt
  FROM qqdocs_import_runs
`;

export function getQqDocsCursor(sourceKey: string): QqDocsCursorRecord | null {
  return (sqlite.prepare(`
    SELECT
      source_key AS sourceKey,
      overlap_date AS overlapDate,
      checked_through AS checkedThrough,
      last_snapshot_hash AS lastSnapshotHash,
      last_run_id AS lastRunId,
      updated_at AS updatedAt
    FROM qqdocs_source_cursors
    WHERE source_key = ?
  `).get(sourceKey) as RawCursor | undefined) ?? null;
}

export function getQqDocsRun(id: number): QqDocsRunRecord | null {
  const row = sqlite.prepare(`${RUN_SELECT} WHERE id = ?`).get(id) as RawRun | undefined;
  return row ? toRun(row) : null;
}

export function createQqDocsRun(input: { sourceKey: string; boundaryDate: string; targetDate: string }): QqDocsRunRecord {
  const result = sqlite.prepare(`
    INSERT INTO qqdocs_import_runs (source_key, boundary_date, target_date, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
  `).run(input.sourceKey, input.boundaryDate, input.targetDate, new Date().toISOString());
  const run = getQqDocsRun(Number(result.lastInsertRowid));
  if (!run) throw new Error("创建腾讯文档导入记录失败");
  return run;
}

export function getQqDocsRowsByDate(sourceKey: string, sourceDate: string): NormalizedSheetRow[] {
  const rows = sqlite.prepare(`
    SELECT data_json AS dataJson
    FROM qqdocs_source_rows
    WHERE source_key = ? AND source_date = ?
    ORDER BY id
  `).all(sourceKey, sourceDate) as Array<{ dataJson: string }>;
  return rows.map((row) => parseJson<NormalizedSheetRow | null>(row.dataJson, null)).filter((row): row is NormalizedSheetRow => row !== null);
}

export function getCurrentQqDocsRows(from: string): NormalizedSheetRow[] {
  const rows = sqlite.prepare(`
    SELECT data_json AS dataJson
    FROM qqdocs_source_rows s
    WHERE source_date >= ?
      AND last_seen_run_id = (
        SELECT MAX(r.id)
        FROM qqdocs_import_runs r
        WHERE r.source_key = s.source_key
          AND r.status = 'success'
          AND r.boundary_date <= s.source_date
          AND r.target_date >= s.source_date
      )
    ORDER BY source_date DESC, id
  `).all(from) as Array<{ dataJson: string }>;
  return rows.map((row) => parseJson<NormalizedSheetRow | null>(row.dataJson, null)).filter((row): row is NormalizedSheetRow => row !== null);
}

export function getQqDocsArchiveCoverage(): SourceArchiveCoverage {
  return sqlite.prepare(`
    WITH classified AS (
      SELECT archive_outcome AS archiveOutcome,
             CASE WHEN last_seen_run_id = (
               SELECT MAX(r.id)
               FROM qqdocs_import_runs r
               WHERE r.source_key = s.source_key
                 AND r.status = 'success'
                 AND r.boundary_date <= s.source_date
                 AND r.target_date >= s.source_date
             ) THEN 1 ELSE 0 END AS isCurrent
      FROM qqdocs_source_rows s
    )
    SELECT
      COUNT(*) AS totalRows,
      COALESCE(SUM(isCurrent), 0) AS currentRows,
      COALESCE(SUM(CASE WHEN isCurrent = 0 THEN 1 ELSE 0 END), 0) AS staleRows,
      COALESCE(SUM(CASE WHEN isCurrent = 1 AND archiveOutcome = 'postings' THEN 1 ELSE 0 END), 0) AS postingRows,
      COALESCE(SUM(CASE WHEN isCurrent = 1 AND archiveOutcome = 'company_link' THEN 1 ELSE 0 END), 0) AS companyLinkRows,
      COALESCE(SUM(CASE WHEN isCurrent = 1 AND archiveOutcome = 'policy_excluded' THEN 1 ELSE 0 END), 0) AS policyExcludedRows,
      COALESCE(SUM(CASE WHEN isCurrent = 1 AND archiveOutcome = 'unresolved' THEN 1 ELSE 0 END), 0) AS unresolvedRows,
      COALESCE(SUM(CASE WHEN archiveOutcome IS NULL THEN 1 ELSE 0 END), 0) AS unarchivedRows,
      COALESCE(SUM(CASE WHEN isCurrent = 1 AND archiveOutcome IS NULL THEN 1 ELSE 0 END), 0) AS currentUnarchivedRows
    FROM classified
  `).get() as SourceArchiveCoverage;
}

export function failQqDocsRun(id: number, errors: Array<{ code: string; message: string }>): QqDocsRunRecord {
  sqlite.prepare(`
    UPDATE qqdocs_import_runs
    SET status = 'failed', errors_json = ?, finished_at = ?
    WHERE id = ?
  `).run(JSON.stringify(errors), new Date().toISOString(), id);
  const run = getQqDocsRun(id);
  if (!run) throw new Error(`腾讯文档导入记录 ${id} 不存在`);
  return run;
}

export function commitQqDocsImport(input: {
  runId: number;
  sourceKey: string;
  boundaryDate: string;
  targetDate: string;
  method: QqDocsExtractionMethod;
  snapshotHash: string;
  rows: NormalizedSheetRow[];
  dateCounts: Record<string, number>;
  postingFingerprintsBySource: Map<string, string[]>;
  archiveResultsBySource: Map<string, SourceRowArchiveResult>;
  companyLinks: SourceRowCompanyLink[];
  policyExcluded: number;
  unresolved: number;
  importPostings: () => QqDocsPostingImportCounts;
}): { run: QqDocsRunRecord; cursor: QqDocsCursorRecord; counts: QqDocsImportCounts } {
  return sqlite.transaction(() => {
    const postingCounts = input.importPostings();
    const companyLinkIds = new Map<string, number>();
    for (const companyLink of input.companyLinks) {
      const saved = upsertCompanyLink(companyLink);
      companyLinkIds.set(companyLink.applyUrl, saved.link.id);
    }
    const counts: QqDocsImportCounts = {
      ...postingCounts,
      companyLinks: input.companyLinks.length,
      policyExcluded: input.policyExcluded,
      unresolved: input.unresolved,
    };
    const now = new Date().toISOString();
    const upsertRow = sqlite.prepare(`
      INSERT INTO qqdocs_source_rows (
        source_key, source_identity, source_date, content_hash, data_json,
        posting_fingerprints_json, archive_outcome, archive_reason, company_link_id, archived_at,
        first_seen_run_id, last_seen_run_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_key, source_identity) DO UPDATE SET
        source_date = excluded.source_date,
        content_hash = excluded.content_hash,
        data_json = excluded.data_json,
        posting_fingerprints_json = excluded.posting_fingerprints_json,
        archive_outcome = excluded.archive_outcome,
        archive_reason = excluded.archive_reason,
        company_link_id = excluded.company_link_id,
        archived_at = excluded.archived_at,
        last_seen_run_id = excluded.last_seen_run_id,
        updated_at = excluded.updated_at
    `);
    for (const row of input.rows) {
      const archive = input.archiveResultsBySource.get(row.sourceIdentity);
      if (!archive) throw new Error(`来源行缺少归档结果：${row.sourceIdentity}`);
      const fingerprints = input.postingFingerprintsBySource.get(row.sourceIdentity) ?? [];
      const companyLinkId = archive.companyLinkApplyUrl ? companyLinkIds.get(archive.companyLinkApplyUrl) ?? null : null;
      assertArchiveResult({ outcome: archive.outcome, reason: archive.reason, fingerprints, companyLinkId });
      upsertRow.run(
        input.sourceKey,
        row.sourceIdentity,
        row.sourceDate,
        row.contentHash,
        JSON.stringify(row),
        JSON.stringify(fingerprints),
        archive.outcome,
        archive.reason,
        companyLinkId,
        now,
        input.runId,
        input.runId,
        now,
        now,
      );
    }

    const previousCursor = getQqDocsCursor(input.sourceKey);
    const overlapDate = input.rows.reduce<string | null>(
      (latest, row) => latest === null || row.sourceDate > latest ? row.sourceDate : latest,
      null,
    ) ?? previousCursor?.overlapDate ?? input.boundaryDate;
    sqlite.prepare(`
      INSERT INTO qqdocs_source_cursors (
        source_key, overlap_date, checked_through, last_snapshot_hash, last_run_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        overlap_date = excluded.overlap_date,
        checked_through = excluded.checked_through,
        last_snapshot_hash = excluded.last_snapshot_hash,
        last_run_id = excluded.last_run_id,
        updated_at = excluded.updated_at
    `).run(input.sourceKey, overlapDate, input.targetDate, input.snapshotHash, input.runId, now);

    sqlite.prepare(`
      UPDATE qqdocs_import_runs SET
        method = ?, status = 'success', snapshot_hash = ?, rows_read = ?, rows_in_range = ?,
        candidates = ?, inserted = ?, updated = ?, skipped = ?, ineligible = ?,
        company_links = ?, policy_excluded = ?, unresolved = ?,
        date_counts_json = ?, errors_json = '[]', finished_at = ?
      WHERE id = ?
    `).run(
      input.method,
      input.snapshotHash,
      input.rows.length,
      input.rows.length,
      counts.candidates,
      counts.inserted,
      counts.updated,
      counts.skipped,
      counts.ineligible,
      counts.companyLinks,
      counts.policyExcluded,
      counts.unresolved,
      JSON.stringify(input.dateCounts),
      now,
      input.runId,
    );

    const run = getQqDocsRun(input.runId);
    const cursor = getQqDocsCursor(input.sourceKey);
    if (!run || !cursor) throw new Error("腾讯文档导入事务提交后无法读取运行状态");
    return { run, cursor, counts };
  })();
}

function assertArchiveResult(input: {
  outcome: SourceRowArchiveResult["outcome"];
  reason: string;
  fingerprints: string[];
  companyLinkId: number | null;
}): void {
  if (!input.reason.trim()) throw new Error(`归档结果 ${input.outcome} 缺少原因`);
  if (input.outcome === "postings") {
    if (input.fingerprints.length === 0) throw new Error("岗位归档结果缺少岗位指纹");
    const findPosting = sqlite.prepare("SELECT 1 FROM postings WHERE fingerprint = ? LIMIT 1");
    const missing = input.fingerprints.find((fingerprint) => !findPosting.get(fingerprint));
    if (missing) throw new Error(`岗位归档指纹没有对应实体：${missing}`);
  }
  if (input.outcome === "company_link" && input.companyLinkId === null) {
    throw new Error("公司入口归档结果缺少 company_link_id");
  }
}
