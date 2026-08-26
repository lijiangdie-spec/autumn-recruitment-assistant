import { createHash } from "node:crypto";

import { normalizeWhitespace } from "@/lib/filters";
import { QqDocsImportError, type NormalizedSheetRow, type RawSheetCell, type RawSheetSnapshot } from "@/lib/qqdocs/types";

const HEADER_ALIASES = {
  updated: ["更新时间", "更新日期"],
  company: ["企业名称", "公司名称"],
  companyType: ["企业类型", "公司类型"],
  industry: ["行业分类", "行业"],
  roles: ["招聘岗位", "岗位名称"],
  cities: ["工作城市", "工作地点"],
  detail: ["AI预测岗位信息", "AI预测", "岗位信息"],
  deadline: ["截止时间", "截止日期"],
  cohort: ["届次", "招聘对象"],
  degree: ["学历要求", "学历"],
  category: ["类别", "招聘类型"],
  source: ["公告链接", "来源链接"],
  apply: ["投递方式", "投递链接"],
} as const;

type HeaderKey = keyof typeof HEADER_ALIASES;

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function compactHeader(value: string): string {
  return value.replace(/\s+/g, "").replace(/[：:]/g, "").trim();
}

function resolveColumns(snapshot: RawSheetSnapshot): Map<HeaderKey, number> {
  const result = new Map<HeaderKey, number>();
  for (const header of snapshot.headers) {
    const normalized = compactHeader(header.text);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<[HeaderKey, readonly string[]]>) {
      if (aliases.some((alias) => normalized.startsWith(compactHeader(alias)))) result.set(key, header.columnIndex);
    }
  }
  const missing = (["updated", "company", "roles"] as HeaderKey[]).filter((key) => !result.has(key));
  if (missing.length > 0) {
    throw new QqDocsImportError("HEADER_CHANGED", `缺少关键表头：${missing.join(", ")}`, { missing: missing.join(",") });
  }
  return result;
}

function cellAt(cells: RawSheetCell[], column: number | undefined): RawSheetCell | undefined {
  return column === undefined ? undefined : cells.find((cell) => cell.columnIndex === column);
}

function textAt(cells: RawSheetCell[], column: number | undefined): string {
  return normalizeWhitespace(cellAt(cells, column)?.text ?? "");
}

export function cleanQqDocsUrl(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  const starts = [...trimmed.matchAll(/https?:\/\//gi)];
  if (starts.length === 0) return null;
  const start = starts.at(-1)?.index ?? 0;
  const token = trimmed.slice(start).match(/^[^\s<>"']+/)?.[0]?.replace(/[，。；、）】]+$/u, "") ?? "";
  try {
    const url = new URL(token);
    return /^https?:$/.test(url.protocol) && url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseQqDocsDate(value: string, defaultYear: number): string | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized || /暂无|待定|尽快|招满/i.test(normalized)) return null;
  const chinese = normalized.match(/(?:(20\d{2})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (chinese) {
    const year = Number(chinese[1] ?? defaultYear);
    const month = Number(chinese[2]);
    const day = Number(chinese[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    }
    return null;
  }
  const separated = normalized.match(/^(20\d{2})[\-/.](\d{1,2})[\-/.](\d{1,2})/);
  if (separated) {
    return parseQqDocsDate(`${separated[1]}年${separated[2]}月${separated[3]}日`, defaultYear);
  }
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

export function normalizeSheetSnapshot(snapshot: RawSheetSnapshot, defaultYear: number): NormalizedSheetRow[] {
  const columns = resolveColumns(snapshot);
  const result: NormalizedSheetRow[] = [];
  let currentDate: string | null = null;

  for (const rawRow of snapshot.rows) {
    const explicitDate = parseQqDocsDate(textAt(rawRow.cells, columns.get("updated")), defaultYear);
    if (explicitDate) currentDate = explicitDate;
    const company = textAt(rawRow.cells, columns.get("company"));
    const roles = textAt(rawRow.cells, columns.get("roles"));
    if (!company && !roles) continue;
    if (!currentDate) {
      throw new QqDocsImportError("RANGE_INCOMPLETE", "岗位行之前没有可继承的来源日期", { rowNumber: rawRow.rowNumber });
    }

    const sourceCell = cellAt(rawRow.cells, columns.get("source"));
    const applyCell = cellAt(rawRow.cells, columns.get("apply"));
    const business = {
      sourceDate: currentDate,
      company,
      companyType: textAt(rawRow.cells, columns.get("companyType")),
      industry: textAt(rawRow.cells, columns.get("industry")),
      roles,
      cities: textAt(rawRow.cells, columns.get("cities")),
      aiDetail: textAt(rawRow.cells, columns.get("detail")),
      deadline: textAt(rawRow.cells, columns.get("deadline")),
      cohort: textAt(rawRow.cells, columns.get("cohort")),
      degree: textAt(rawRow.cells, columns.get("degree")),
      category: textAt(rawRow.cells, columns.get("category")),
      sourceUrl: cleanQqDocsUrl(sourceCell?.href ?? sourceCell?.text),
      applyUrl: cleanQqDocsUrl(applyCell?.href ?? applyCell?.text),
    };
    const semanticIdentity = sha256([
      snapshot.sourceKey,
      business.sourceDate,
      business.company,
      business.roles,
      business.cities,
      business.cohort,
    ]);
    result.push({
      ...business,
      sourceIdentity: rawRow.providerRowId ? `provider:${rawRow.providerRowId}` : `semantic:${semanticIdentity}`,
      contentHash: sha256(business),
      diagnosticRowNumber: rawRow.rowNumber,
    });
  }

  return result;
}
