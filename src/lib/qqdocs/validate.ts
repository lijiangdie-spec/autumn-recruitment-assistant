import { createHash } from "node:crypto";

import { QqDocsImportError, type BoundaryDiff, type DateWindowResult, type NormalizedSheetRow } from "@/lib/qqdocs/types";

export function hashNormalizedRows(rows: NormalizedSheetRow[]): string {
  return createHash("sha256")
    .update(JSON.stringify(rows.map((row) => [row.sourceIdentity, row.contentHash, row.sourceDate])))
    .digest("hex");
}

function deduplicateExactIdentities(rows: NormalizedSheetRow[]): NormalizedSheetRow[] {
  const seen = new Map<string, NormalizedSheetRow>();
  const unique: NormalizedSheetRow[] = [];
  for (const row of rows) {
    const previous = seen.get(row.sourceIdentity);
    if (previous && previous.contentHash !== row.contentHash) {
      throw new QqDocsImportError("DUPLICATE_SOURCE_IDENTITY", "同一快照出现重复来源身份", { sourceIdentity: row.sourceIdentity });
    }
    if (previous) continue;
    seen.set(row.sourceIdentity, row);
    unique.push(row);
  }
  return unique;
}

function assertDescendingDates(rows: NormalizedSheetRow[]): void {
  let previous: string | null = null;
  for (const row of rows) {
    if (previous && row.sourceDate > previous) {
      throw new QqDocsImportError("RANGE_INCOMPLETE", "来源日期不再按非递增顺序排列", {
        previousDate: previous,
        currentDate: row.sourceDate,
      });
    }
    previous = row.sourceDate;
  }
}

export function selectStableSnapshot(snapshots: NormalizedSheetRow[][]): NormalizedSheetRow[] {
  for (let index = 1; index < snapshots.length; index += 1) {
    if (hashNormalizedRows(snapshots[index - 1]) === hashNormalizedRows(snapshots[index])) return snapshots[index];
  }
  throw new QqDocsImportError("UNSTABLE_SNAPSHOT", "没有得到两个连续一致的标准化快照", { attempts: snapshots.length });
}

export function validateDateWindow(
  rows: NormalizedSheetRow[],
  input: { boundaryDate: string; targetDate: string; reachedSheetEnd: boolean },
): DateWindowResult {
  const uniqueRows = deduplicateExactIdentities(rows);
  assertDescendingDates(uniqueRows);
  const crossedBoundary = uniqueRows.some((row) => row.sourceDate < input.boundaryDate);
  if (!crossedBoundary && !input.reachedSheetEnd) {
    throw new QqDocsImportError("RANGE_INCOMPLETE", "没有读取到边界日之后的更早日期哨兵，也没有到达表尾", input);
  }
  const selected = uniqueRows.filter((row) => row.sourceDate >= input.boundaryDate && row.sourceDate <= input.targetDate);
  const dateCounts = selected.reduce<Record<string, number>>((counts, row) => {
    counts[row.sourceDate] = (counts[row.sourceDate] ?? 0) + 1;
    return counts;
  }, {});
  return { rows: selected, dateCounts: Object.fromEntries(Object.entries(dateCounts).sort(([left], [right]) => left.localeCompare(right))) };
}

export function reconcileBoundary(
  previousRows: NormalizedSheetRow[],
  currentRows: NormalizedSheetRow[],
  boundaryDate: string,
): BoundaryDiff {
  const previous = new Map(previousRows.filter((row) => row.sourceDate === boundaryDate).map((row) => [row.sourceIdentity, row]));
  const current = new Map(currentRows.filter((row) => row.sourceDate === boundaryDate).map((row) => [row.sourceIdentity, row]));
  const missing = [...previous.keys()].filter((identity) => !current.has(identity));
  if (missing.length > 0) {
    throw new QqDocsImportError("BOUNDARY_MISMATCH", "已有边界日来源行在本次快照中消失", {
      boundaryDate,
      missingCount: missing.length,
      missingIdentities: missing.join(","),
    });
  }
  const added = [...current.keys()].filter((identity) => !previous.has(identity));
  const updated = [...current.keys()].filter((identity) => {
    const old = previous.get(identity);
    return old !== undefined && old.contentHash !== current.get(identity)?.contentHash;
  });
  const unchanged = [...current.keys()].filter((identity) => {
    const old = previous.get(identity);
    return old !== undefined && old.contentHash === current.get(identity)?.contentHash;
  });
  return { added, updated, unchanged };
}
