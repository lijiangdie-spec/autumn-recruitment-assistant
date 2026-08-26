import { upsertPosting } from "@/lib/db/repository";
import { backupRecruitmentDatabase } from "@/lib/db/backup";
import { pruneExpiredRecruitmentData } from "@/lib/db/expiry";
import { openQqDocsBrowser } from "@/lib/qqdocs/browser";
import { resolveQqDocsConfig } from "@/lib/qqdocs/config";
import { extractQqDocsViaClipboard } from "@/lib/qqdocs/extractors/clipboard";
import { extractQqDocsViaStructuredModel } from "@/lib/qqdocs/extractors/structured";
import { prepareQqDocsImport } from "@/lib/qqdocs/prepare";
import {
  commitQqDocsImport,
  createQqDocsRun,
  failQqDocsRun,
  getQqDocsCursor,
  getQqDocsRowsByDate,
  type QqDocsPostingImportCounts,
} from "@/lib/qqdocs/repository";
import { QqDocsImportError, type QqDocsExtractionMethod, type RawSheetSnapshot } from "@/lib/qqdocs/types";

export interface RunQqDocsOptions {
  through: string;
  from?: string;
  dryRun?: boolean;
  headless?: boolean;
  loginTimeoutMs?: number;
}

export interface RunQqDocsResult {
  status: "success" | "dry-run";
  sourceKey: string;
  boundaryDate: string;
  targetDate: string;
  method: QqDocsExtractionMethod;
  dateCounts: Record<string, number>;
  rows: number;
  candidates: number;
  recognizedCandidates: number;
  inserted: number;
  updated: number;
  skipped: number;
  ineligible: number;
  companyLinks: number;
  policyExcluded: number;
  unresolved: number;
  snapshotHash: string;
  backupPath?: string;
}

function assertIsoDate(value: string, label: string): void {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00+08:00`))) {
    throw new Error(`${label} 必须是 YYYY-MM-DD`);
  }
}

export async function runQqDocsUpdate(options: RunQqDocsOptions): Promise<RunQqDocsResult> {
  assertIsoDate(options.through, "--through");
  if (options.from) assertIsoDate(options.from, "--from");
  const config = resolveQqDocsConfig();
  const cursor = getQqDocsCursor(config.sourceKey);
  const boundaryDate = options.from ?? cursor?.overlapDate;
  if (!boundaryDate) throw new Error("首次运行必须提供 --from，不能猜测历史完整边界");
  if (boundaryDate > options.through) throw new Error("--from/游标日期不能晚于 --through");

  const run = options.dryRun ? null : createQqDocsRun({ sourceKey: config.sourceKey, boundaryDate, targetDate: options.through });
  let browser: Awaited<ReturnType<typeof openQqDocsBrowser>> | null = null;
  try {
    browser = await openQqDocsBrowser(config, { headless: options.headless, loginTimeoutMs: options.loginTimeoutMs });
    const snapshots: RawSheetSnapshot[] = [];
    let extractionMethod: QqDocsExtractionMethod = "structured";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let snapshot: RawSheetSnapshot;
      try {
        snapshot = await extractQqDocsViaStructuredModel(browser.page, config.sourceKey, {
          sheetId: config.sheetId,
          boundaryDate,
          targetDate: options.through,
          defaultYear: config.defaultYear,
        });
        extractionMethod = "structured";
      } catch (error) {
        if (!(error instanceof QqDocsImportError) || error.code !== "PRIMARY_EXTRACTOR_FAILED") throw error;
        try {
          snapshot = await extractQqDocsViaClipboard(browser.page, config.sourceKey);
          extractionMethod = "clipboard";
        } catch (fallbackError) {
          throw new QqDocsImportError("PRIMARY_EXTRACTOR_FAILED", "结构化读取和剪贴板回退均失败", {
            structuredCause: String(error.safeContext.cause ?? error.message),
            clipboardCause: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
        }
      }
      snapshots.push(snapshot);
      if (snapshots.length >= 2) {
        try {
          prepareQqDocsImport({
            snapshots,
            defaultYear: config.defaultYear,
            boundaryDate,
            targetDate: options.through,
            sourceName: config.sourceName,
            previousBoundaryRows: cursor ? getQqDocsRowsByDate(config.sourceKey, boundaryDate) : null,
          });
          break;
        } catch (error) {
          if (!(error instanceof QqDocsImportError) || error.code !== "UNSTABLE_SNAPSHOT" || attempt === 2) throw error;
        }
      }
    }
    const prepared = prepareQqDocsImport({
      snapshots,
      defaultYear: config.defaultYear,
      boundaryDate,
      targetDate: options.through,
      sourceName: config.sourceName,
      previousBoundaryRows: cursor ? getQqDocsRowsByDate(config.sourceKey, boundaryDate) : null,
    });

    const base = {
      sourceKey: config.sourceKey,
      boundaryDate,
      targetDate: options.through,
      method: extractionMethod,
      dateCounts: prepared.dateCounts,
      rows: prepared.rows.length,
      candidates: prepared.candidates.size,
      recognizedCandidates: prepared.recognizedCandidates.size,
      ineligible: prepared.ineligible,
      companyLinks: prepared.companyLinks.size,
      policyExcluded: prepared.policyExcluded,
      unresolved: prepared.unresolved,
      snapshotHash: prepared.snapshotHash,
    };
    if (options.dryRun) return { status: "dry-run", ...base, inserted: 0, updated: 0, skipped: 0 };

    const backupPath = await backupRecruitmentDatabase(`before-qqdocs-${options.through}`);
    pruneExpiredRecruitmentData();

    const importPostings = (): QqDocsPostingImportCounts => {
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      for (const candidate of prepared.candidates.values()) {
        const result = upsertPosting(candidate);
        if (result.action === "inserted") inserted += 1;
        else if (result.action === "updated") updated += 1;
        else skipped += 1;
      }
      return { candidates: prepared.candidates.size, inserted, updated, skipped, ineligible: prepared.ineligible };
    };
    const committed = commitQqDocsImport({
      runId: run!.id,
      sourceKey: config.sourceKey,
      boundaryDate,
      targetDate: options.through,
      method: extractionMethod,
      snapshotHash: prepared.snapshotHash,
      rows: prepared.rows,
      dateCounts: prepared.dateCounts,
      postingFingerprintsBySource: prepared.postingFingerprintsBySource,
      archiveResultsBySource: prepared.archiveResultsBySource,
      companyLinks: [...prepared.companyLinks.values()],
      policyExcluded: prepared.policyExcluded,
      unresolved: prepared.unresolved,
      importPostings,
    });
    return { status: "success", ...base, ...committed.counts, backupPath: backupPath ?? undefined };
  } catch (error) {
    if (run) {
      const code = error instanceof QqDocsImportError ? error.code : "IMPORT_FAILED";
      failQqDocsRun(run.id, [{ code, message: error instanceof Error ? error.message : String(error) }]);
    }
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
