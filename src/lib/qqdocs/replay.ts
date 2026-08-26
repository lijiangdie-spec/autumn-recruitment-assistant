import Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { resolveRecruitmentDatabasePath } from "@/lib/db/path";
import { evaluateQqDocsSourceRow, type SourceRowCompanyLink } from "@/lib/imports/source-row";
import type { SourceRowArchiveResult } from "@/lib/qqdocs/prepare";
import type { NormalizedSheetRow } from "@/lib/qqdocs/types";

interface StoredSourceRow {
  sourceKey: string;
  sourceIdentity: string;
  sourceDate: string;
  isCurrent: boolean;
  row: NormalizedSheetRow;
  parseError: string | null;
}

interface ReplayArchiveRow {
  sourceKey: string;
  sourceIdentity: string;
  archive: SourceRowArchiveResult;
  postingFingerprints: string[];
}

type EvaluatedCandidate = ReturnType<typeof evaluateQqDocsSourceRow>["recognizedCandidates"][number];

interface PreparedReplay {
  sourceRows: StoredSourceRow[];
  recognizedCandidates: Map<string, EvaluatedCandidate>;
  candidates: Map<string, EvaluatedCandidate>;
  policyExcludedCandidates: Map<string, EvaluatedCandidate>;
  companyLinks: Map<string, SourceRowCompanyLink>;
  archiveRows: ReplayArchiveRow[];
  currentSourceRows: number;
  staleSourceRows: number;
  policyExcludedRows: number;
  unresolvedRows: number;
}

export interface QqDocsReplayAnalysis {
  from: string;
  through: string | null;
  sourceRows: number;
  historicalSourceRows: number;
  staleSourceRows: number;
  recognizedCandidates: number;
  eligibleCandidates: number;
  policyExcludedCandidates: number;
  existingCandidates: number;
  candidatesToInsert: number;
  candidatesToUpdate: number;
  unchangedCandidates: number;
  companyLinks: number;
  existingCompanyLinks: number;
  companyLinksToInsert: number;
  policyExcludedRows: number;
  unresolvedRows: number;
  legacyUnarchivedRows: number;
}

export interface QqDocsReplayActions {
  postingsInserted: number;
  postingsUpdated: number;
  postingsSkipped: number;
  companyLinksInserted: number;
  companyLinksUpdated: number;
  sourceRowsArchived: number;
}

export interface RunQqDocsReplayOptions {
  from: string;
  through?: string;
  dryRun?: boolean;
  databasePath?: string;
}

export type RunQqDocsReplayResult =
  | { status: "dry-run"; databasePath: string; analysis: QqDocsReplayAnalysis }
  | {
      status: "success";
      databasePath: string;
      backupPath: string | null;
      before: QqDocsReplayAnalysis;
      after: QqDocsReplayAnalysis;
      actions: QqDocsReplayActions;
    };

function assertIsoDate(value: string, label: string): void {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00+08:00`))) {
    throw new Error(`${label} 必须是 YYYY-MM-DD`);
  }
}

function emptyRow(sourceDate: string, sourceIdentity: string): NormalizedSheetRow {
  return {
    sourceDate,
    company: "",
    companyType: "",
    industry: "",
    roles: "",
    cities: "",
    aiDetail: "",
    deadline: "",
    cohort: "",
    degree: "",
    category: "",
    sourceUrl: null,
    applyUrl: null,
    sourceIdentity,
    contentHash: "",
    diagnosticRowNumber: 0,
  };
}

function loadStoredRows(database: Database.Database, from: string, through?: string): StoredSourceRow[] {
  const clauses = ["source_date >= ?"];
  const params: string[] = [from];
  if (through) {
    clauses.push("source_date <= ?");
    params.push(through);
  }
  const rows = database.prepare(`
    SELECT source_key AS sourceKey, source_identity AS sourceIdentity,
           source_date AS sourceDate, data_json AS dataJson,
           CASE WHEN last_seen_run_id = (
             SELECT MAX(r.id)
             FROM qqdocs_import_runs r
             WHERE r.source_key = s.source_key
               AND r.status = 'success'
               AND r.boundary_date <= s.source_date
               AND r.target_date >= s.source_date
           ) THEN 1 ELSE 0 END AS isCurrent
    FROM qqdocs_source_rows s
    WHERE ${clauses.join(" AND ")}
    ORDER BY source_key, source_date DESC, id
  `).all(...params) as Array<{
    sourceKey: string;
    sourceIdentity: string;
    sourceDate: string;
    dataJson: string;
    isCurrent: number;
  }>;
  return rows.map((stored) => {
    try {
      const parsed = JSON.parse(stored.dataJson) as NormalizedSheetRow;
      if (!parsed || typeof parsed !== "object") throw new Error("不是对象");
      return {
        ...stored,
        isCurrent: stored.isCurrent === 1,
        row: { ...parsed, sourceIdentity: stored.sourceIdentity, sourceDate: stored.sourceDate },
        parseError: null,
      };
    } catch (error) {
      return {
        ...stored,
        isCurrent: stored.isCurrent === 1,
        row: emptyRow(stored.sourceDate, stored.sourceIdentity),
        parseError: `原始行 JSON 无法解析：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });
}

function prepareReplay(rows: StoredSourceRow[]): PreparedReplay {
  const recognizedCandidates = new Map<string, EvaluatedCandidate>();
  const candidates = new Map<string, EvaluatedCandidate>();
  const policyExcludedCandidates = new Map<string, EvaluatedCandidate>();
  const companyLinks = new Map<string, SourceRowCompanyLink>();
  const archiveRows: ReplayArchiveRow[] = [];
  let currentSourceRows = 0;
  let staleSourceRows = 0;
  let policyExcludedRows = 0;
  let unresolvedRows = 0;

  for (const stored of rows) {
    if (!stored.isCurrent) {
      staleSourceRows += 1;
      archiveRows.push({
        sourceKey: stored.sourceKey,
        sourceIdentity: stored.sourceIdentity,
        archive: {
          outcome: "policy_excluded",
          reason: "来源行已被后续成功完整快照移除或替换，不参与当前岗位回放",
          companyLinkApplyUrl: null,
        },
        postingFingerprints: [],
      });
      continue;
    }
    currentSourceRows += 1;
    if (stored.parseError) {
      unresolvedRows += 1;
      archiveRows.push({
        sourceKey: stored.sourceKey,
        sourceIdentity: stored.sourceIdentity,
        archive: { outcome: "unresolved", reason: stored.parseError, companyLinkApplyUrl: null },
        postingFingerprints: [],
      });
      continue;
    }
    const evaluated = evaluateQqDocsSourceRow(stored.row, "腾讯文档 · 历史回放");
    for (const candidate of evaluated.recognizedCandidates) recognizedCandidates.set(candidate.fingerprint, candidate);
    for (const candidate of evaluated.policyExcludedCandidates) {
      policyExcludedCandidates.set(candidate.fingerprint, candidate);
    }
    if (evaluated.outcome === "policy_excluded") {
      policyExcludedRows += 1;
    }
    if (evaluated.outcome === "unresolved") unresolvedRows += 1;
    const fingerprints: string[] = [];
    for (const candidate of evaluated.candidates) {
      candidates.set(candidate.fingerprint, candidate);
      fingerprints.push(candidate.fingerprint);
    }
    if (evaluated.companyLink) companyLinks.set(evaluated.companyLink.applyUrl, evaluated.companyLink);
    archiveRows.push({
      sourceKey: stored.sourceKey,
      sourceIdentity: stored.sourceIdentity,
      archive: {
        outcome: evaluated.outcome,
        reason: evaluated.reason,
        companyLinkApplyUrl: evaluated.companyLink?.applyUrl ?? null,
      },
      postingFingerprints: fingerprints,
    });
  }

  return {
    sourceRows: rows,
    recognizedCandidates,
    candidates,
    policyExcludedCandidates,
    companyLinks,
    archiveRows,
    currentSourceRows,
    staleSourceRows,
    policyExcludedRows,
    unresolvedRows,
  };
}

function hasColumn(database: Database.Database, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === column);
}

function analyzePrepared(
  database: Database.Database,
  prepared: PreparedReplay,
  from: string,
  through?: string,
): QqDocsReplayAnalysis {
  const existingPostings = new Map((database.prepare("SELECT fingerprint, content_hash AS contentHash FROM postings").all() as Array<{
    fingerprint: string;
    contentHash: string;
  }>).map((row) => [row.fingerprint, row.contentHash]));
  const existingLinks = new Set((database.prepare("SELECT apply_url AS applyUrl FROM company_links").all() as Array<{ applyUrl: string }>).map((row) => row.applyUrl));
  let existingCandidates = 0;
  let candidatesToInsert = 0;
  let candidatesToUpdate = 0;
  let unchangedCandidates = 0;
  for (const candidate of prepared.candidates.values()) {
    const existingHash = existingPostings.get(candidate.fingerprint);
    if (existingHash === undefined) candidatesToInsert += 1;
    else {
      existingCandidates += 1;
      if (existingHash === candidate.contentHash) unchangedCandidates += 1;
      else candidatesToUpdate += 1;
    }
  }
  const existingCompanyLinks = [...prepared.companyLinks.keys()].filter((url) => existingLinks.has(url)).length;
  let legacyUnarchivedRows = prepared.sourceRows.length;
  if (hasColumn(database, "qqdocs_source_rows", "archive_outcome")) {
    const clauses = ["source_date >= ?", "archive_outcome IS NULL"];
    const params: string[] = [from];
    if (through) {
      clauses.push("source_date <= ?");
      params.push(through);
    }
    legacyUnarchivedRows = (database.prepare(`SELECT COUNT(*) AS count FROM qqdocs_source_rows WHERE ${clauses.join(" AND ")}`).get(...params) as { count: number }).count;
  }
  return {
    from,
    through: through ?? null,
    sourceRows: prepared.currentSourceRows,
    historicalSourceRows: prepared.sourceRows.length,
    staleSourceRows: prepared.staleSourceRows,
    recognizedCandidates: prepared.recognizedCandidates.size,
    eligibleCandidates: prepared.candidates.size,
    policyExcludedCandidates: prepared.policyExcludedCandidates.size,
    existingCandidates,
    candidatesToInsert,
    candidatesToUpdate,
    unchangedCandidates,
    companyLinks: prepared.companyLinks.size,
    existingCompanyLinks,
    companyLinksToInsert: prepared.companyLinks.size - existingCompanyLinks,
    policyExcludedRows: prepared.policyExcludedRows,
    unresolvedRows: prepared.unresolvedRows,
    legacyUnarchivedRows,
  };
}

export function analyzeQqDocsReplay(options: Omit<RunQqDocsReplayOptions, "dryRun">): QqDocsReplayAnalysis {
  assertIsoDate(options.from, "--from");
  if (options.through) assertIsoDate(options.through, "--through");
  if (options.through && options.through < options.from) throw new Error("--through 不能早于 --from");
  const databasePath = options.databasePath ?? resolveRecruitmentDatabasePath();
  if (databasePath === ":memory:") throw new Error("回放分析需要可重复打开的 SQLite 文件，不能使用 :memory:");
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const prepared = prepareReplay(loadStoredRows(database, options.from, options.through));
    return analyzePrepared(database, prepared, options.from, options.through);
  } finally {
    database.close();
  }
}

async function createReadonlyBackup(databasePath: string, label: string): Promise<string> {
  const backupDirectory = path.join(path.dirname(databasePath), "backups");
  await mkdir(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "backup";
  const destination = path.join(backupDirectory, `${path.basename(databasePath, path.extname(databasePath))}-${safeLabel}-${timestamp}.db`);
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    await database.backup(destination);
  } finally {
    database.close();
  }
  return destination;
}

export async function runQqDocsReplay(options: RunQqDocsReplayOptions): Promise<RunQqDocsReplayResult> {
  assertIsoDate(options.from, "--from");
  if (options.through) assertIsoDate(options.through, "--through");
  if (options.through && options.through < options.from) throw new Error("--through 不能早于 --from");
  const databasePath = options.databasePath ?? resolveRecruitmentDatabasePath();
  if (databasePath === ":memory:") throw new Error("历史回放不能使用 :memory: 数据库");

  const readonlyDatabase = new Database(databasePath, { readonly: true, fileMustExist: true });
  let prepared: PreparedReplay;
  let before: QqDocsReplayAnalysis;
  try {
    prepared = prepareReplay(loadStoredRows(readonlyDatabase, options.from, options.through));
    before = analyzePrepared(readonlyDatabase, prepared, options.from, options.through);
  } finally {
    readonlyDatabase.close();
  }
  if (options.dryRun) return { status: "dry-run", databasePath, analysis: before };

  const backupPath = await createReadonlyBackup(databasePath, `before-qqdocs-replay-${options.from}`);
  process.env.RECRUITMENT_DB_PATH = databasePath;
  const [{ sqlite, databasePath: activeDatabasePath }, { upsertPosting }, { upsertCompanyLink }] = await Promise.all([
    import("@/lib/db/client"),
    import("@/lib/db/repository"),
    import("@/lib/imports/repository"),
  ]);
  if (path.resolve(activeDatabasePath) !== path.resolve(databasePath)) {
    throw new Error(`活动数据库与回放目标不一致：${activeDatabasePath}`);
  }

  const actions = sqlite.transaction((): QqDocsReplayActions => {
    let postingsInserted = 0;
    let postingsUpdated = 0;
    let postingsSkipped = 0;
    for (const candidate of prepared.candidates.values()) {
      const saved = upsertPosting(candidate);
      if (saved.action === "inserted") postingsInserted += 1;
      else if (saved.action === "updated") postingsUpdated += 1;
      else if (saved.action === "skipped") postingsSkipped += 1;
      else throw new Error(`回放候选意外成为过期岗位：${candidate.fingerprint}`);
    }

    const companyLinkIds = new Map<string, number>();
    let companyLinksInserted = 0;
    let companyLinksUpdated = 0;
    for (const companyLink of prepared.companyLinks.values()) {
      const saved = upsertCompanyLink(companyLink);
      companyLinkIds.set(companyLink.applyUrl, saved.link.id);
      if (saved.inserted) companyLinksInserted += 1;
      else companyLinksUpdated += 1;
    }

    const findPosting = sqlite.prepare("SELECT 1 FROM postings WHERE fingerprint = ? LIMIT 1");
    const updateArchive = sqlite.prepare(`
      UPDATE qqdocs_source_rows
      SET posting_fingerprints_json = ?, archive_outcome = ?, archive_reason = ?,
          company_link_id = ?, archived_at = ?, updated_at = ?
      WHERE source_key = ? AND source_identity = ?
    `);
    const now = new Date().toISOString();
    let sourceRowsArchived = 0;
    for (const item of prepared.archiveRows) {
      const companyLinkId = item.archive.companyLinkApplyUrl
        ? companyLinkIds.get(item.archive.companyLinkApplyUrl) ?? null
        : null;
      if (!item.archive.reason.trim()) throw new Error(`来源行缺少归档原因：${item.sourceIdentity}`);
      if (item.archive.outcome === "postings") {
        if (item.postingFingerprints.length === 0) throw new Error(`来源行缺少岗位指纹：${item.sourceIdentity}`);
        const missing = item.postingFingerprints.find((fingerprint) => !findPosting.get(fingerprint));
        if (missing) throw new Error(`来源行岗位指纹没有实体：${missing}`);
      }
      if (item.archive.outcome === "company_link" && companyLinkId === null) {
        throw new Error(`来源行公司入口没有实体：${item.sourceIdentity}`);
      }
      sourceRowsArchived += updateArchive.run(
        JSON.stringify(item.postingFingerprints),
        item.archive.outcome,
        item.archive.reason,
        companyLinkId,
        now,
        now,
        item.sourceKey,
        item.sourceIdentity,
      ).changes;
    }
    if (sourceRowsArchived !== prepared.sourceRows.length) {
      throw new Error(`来源行归档覆盖不完整：${sourceRowsArchived}/${prepared.sourceRows.length}`);
    }
    return {
      postingsInserted,
      postingsUpdated,
      postingsSkipped,
      companyLinksInserted,
      companyLinksUpdated,
      sourceRowsArchived,
    };
  })();

  const after = analyzeQqDocsReplay({ from: options.from, through: options.through, databasePath });
  return { status: "success", databasePath, backupPath, before, after, actions };
}
