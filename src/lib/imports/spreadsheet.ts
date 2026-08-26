import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { upsertPosting } from "@/lib/db/repository";
import { pruneExpiredRecruitmentData } from "@/lib/db/expiry";
import { evaluateQqDocsSourceRow } from "@/lib/imports/source-row";
import { cleanSpreadsheetUrl, readSpreadsheetRows } from "@/lib/imports/spreadsheet-reader";
import { evaluatePosting } from "@/lib/scoring";
import { START_AT, type SpreadsheetImportRun } from "@/lib/types";
import { defaultImportDirectory } from "@/lib/imports/profile";
import { createSpreadsheetRun, finishSpreadsheetRun, upsertCompanyLink } from "@/lib/imports/repository";
import { getCurrentQqDocsRows } from "@/lib/qqdocs/repository";

export { cleanSpreadsheetUrl };

export async function findLatestSpreadsheet(directory = defaultImportDirectory()): Promise<string> {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.xlsx$/i.test(entry.name) && !entry.name.startsWith("~$"));
  if (files.length === 0) throw new Error(`目录中没有可导入的 .xlsx：${directory}`);
  const details = await Promise.all(files.map(async (entry) => ({ path: path.join(directory, entry.name), mtime: (await stat(path.join(directory, entry.name))).mtimeMs })));
  details.sort((a, b) => b.mtime - a.mtime);
  return details[0].path;
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => createReadStream(filePath).on("data", (chunk) => hash.update(chunk)).on("end", resolve).on("error", reject));
  return hash.digest("hex");
}

function sourceRowMatchKey(row: { company: string; roles: string; cities: string; cohort: string }): string {
  return JSON.stringify([row.company, row.roles, row.cities, row.cohort]);
}

export async function importSpreadsheet(filePath: string): Promise<SpreadsheetImportRun> {
  const absolute = path.resolve(filePath);
  if (path.extname(absolute).toLowerCase() !== ".xlsx") throw new Error("只支持 .xlsx 文件");
  const fileInfo = await stat(absolute);
  if (!fileInfo.isFile()) throw new Error("导入路径不是文件");
  if (fileInfo.size > 30 * 1024 * 1024) throw new Error("工作簿超过 30 MB 导入上限");
  pruneExpiredRecruitmentData();
  const run = createSpreadsheetRun({ filePath: absolute, fileName: path.basename(absolute), fileHash: await sha256(absolute) });
  let rowsRead = 0;
  let postingsFound = 0;
  let postingsImported = 0;
  let linksImported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const candidates = new Map<string, ReturnType<typeof evaluatePosting>>();

  try {
    const spreadsheet = await readSpreadsheetRows(absolute);
    const authoritativeRows = getCurrentQqDocsRows(START_AT.slice(0, 10));
    const authoritativeByKey = new Map<string, typeof authoritativeRows>();
    for (const row of authoritativeRows) {
      const key = sourceRowMatchKey(row);
      const matches = authoritativeByKey.get(key) ?? [];
      matches.push(row);
      authoritativeByKey.set(key, matches);
    }
    const scopedRows = spreadsheet.rows
      .filter((row) => row.sourceDate >= START_AT.slice(0, 10))
      .map((row) => {
        const matches = authoritativeByKey.get(sourceRowMatchKey(row)) ?? [];
        const authoritative = matches.find((candidate) => candidate.sourceDate === row.sourceDate) ?? matches[0];
        return authoritative ? {
          ...row,
          sourceDate: authoritative.sourceDate,
          sourceUrl: authoritative.sourceUrl,
          applyUrl: authoritative.applyUrl,
        } : row;
      });
    rowsRead = scopedRows.length;
    skipped += spreadsheet.skippedRows + spreadsheet.rows.length - scopedRows.length;
    const sourceName = `校招信息汇总表 · ${path.basename(absolute)}`;
    for (const row of scopedRows) {
      const evaluated = evaluateQqDocsSourceRow(row, sourceName);
      for (const candidate of evaluated.candidates) candidates.set(candidate.fingerprint, candidate);
      skipped += evaluated.policyExcludedCandidates.length;
      if (evaluated.companyLink) {
        const result = upsertCompanyLink(evaluated.companyLink);
        if (result.inserted) linksImported += 1;
        else skipped += 1;
      } else if (evaluated.outcome === "unresolved" || evaluated.outcome === "policy_excluded" && evaluated.recognizedCandidates.length === 0) {
        skipped += 1;
      }
    }
    postingsFound = candidates.size;
    for (const candidate of candidates.values()) {
      const result = upsertPosting(candidate);
      if (result.action === "inserted" || result.action === "updated") postingsImported += 1;
      else skipped += 1;
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return finishSpreadsheetRun(run.id, {
    status: errors.length === 0 ? "success" : rowsRead > 0 ? "partial" : "failed",
    rowsRead, postingsFound, postingsImported, linksImported, skipped, errors,
  });
}
