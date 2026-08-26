import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import ExcelJS, { type Cell, type Row } from "exceljs";
import JSZip from "jszip";

import { normalizeWhitespace } from "@/lib/filters";
import { IMPORT_SHEET_NAME } from "@/lib/imports/profile";
import type { NormalizedSheetRow } from "@/lib/qqdocs/types";

const HEADERS = {
  updated: "更新时间",
  company: "企业名称",
  companyType: "企业类型",
  industry: "行业分类",
  roles: "招聘岗位",
  cities: "工作城市",
  detail: "AI预测岗位信息",
  deadline: "截止时间",
  cohort: "届次",
  degree: "学历要求",
  category: "类别",
  source: "公告链接",
  apply: "投递方式",
} as const;

type HeaderKey = keyof typeof HEADERS;

export interface SpreadsheetReadResult {
  rows: NormalizedSheetRow[];
  rowsRead: number;
  skippedRows: number;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function cellText(cell: Cell | undefined): string {
  if (!cell) return "";
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "text" in value) {
    return normalizeWhitespace(String(value.text ?? ""));
  }
  try {
    return normalizeWhitespace(cell.text || String(value));
  } catch {
    return normalizeWhitespace(String(value));
  }
}

export function cleanSpreadsheetUrl(value: string): string | null {
  const trimmed = value.trim();
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

function cellUrl(cell: Cell | undefined): string | null {
  if (!cell) return null;
  // Tencent's exported OOXML can retain a stale hyperlink relationship while
  // showing the current URL in the cell. Prefer an explicit displayed URL.
  const displayedUrl = cleanSpreadsheetUrl(cellText(cell));
  if (displayedUrl) return displayedUrl;
  const value = cell.value;
  if (typeof value === "object" && value && "hyperlink" in value && typeof value.hyperlink === "string") {
    return cleanSpreadsheetUrl(value.hyperlink);
  }
  if (cell.hyperlink) return cleanSpreadsheetUrl(cell.hyperlink);
  return null;
}

export function spreadsheetIsoDate(value: string): string | null {
  if (!value || /暂无|待定|尽快|招满/i.test(value)) return null;
  const excelSerial = Number(value);
  if (Number.isFinite(excelSerial) && excelSerial > 20000 && excelSerial < 100000) {
    return new Date(Date.UTC(1899, 11, 30) + excelSerial * 86400000).toISOString();
  }
  const chinese = value.match(/(?:(20\d{2})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (chinese) {
    const year = Number(chinese[1] ?? 2026);
    const month = Number(chinese[2]);
    const day = Number(chinese[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return date.toISOString();
    }
    return null;
  }
  const directTimestamp = Date.parse(value);
  if (Number.isFinite(directTimestamp)) return new Date(directTimestamp).toISOString();
  const normalized = value.replace(/[年/.]/g, "-").replace(/月/g, "-").replace(/日/g, "");
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function rowMap(row: Row, columns: Map<HeaderKey, number>): Partial<Record<HeaderKey, Cell>> {
  const result: Partial<Record<HeaderKey, Cell>> = {};
  for (const [key, index] of columns) result[key] = row.getCell(index);
  return result;
}

async function normalizedWorkbookBuffer(filePath: string): Promise<Buffer> {
  const original = await readFile(filePath);
  const zip = await JSZip.loadAsync(original);
  let changed = false;
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !(/\.xml$/i.test(name) || /\.rels$/i.test(name))) continue;
    let xml = await entry.async("string");
    const normalizedTags = xml.replace(/(<\/?)(?:x):/g, "$1");
    if (normalizedTags !== xml) {
      xml = normalizedTags;
      changed = true;
    }
    if (/^xl\/_rels\/workbook\.xml\.rels$/i.test(name)) {
      const relativeTargets = xml.replace(/Target=(['"])\/xl\//gi, "Target=$1");
      if (relativeTargets !== xml) {
        xml = relativeTargets;
        changed = true;
      }
    }
    if (changed) zip.file(name, xml);
  }
  if (!changed) return original;
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function resolveColumns(row: Row): Map<HeaderKey, number> {
  const values = row.values as Array<unknown>;
  const columns = new Map<HeaderKey, number>();
  for (let index = 1; index < values.length; index += 1) {
    const header = cellText(row.getCell(index)).replace(/\s+/g, "");
    const match = (Object.entries(HEADERS) as Array<[HeaderKey, string]>).find(([key, label]) => (
      header.startsWith(label.replace(/\s+/g, "")) || key === "detail" && header.startsWith("AI预测")
    ));
    if (match) columns.set(match[0], index);
  }
  return columns;
}

function findHeaderSignature(worksheet: ExcelJS.Worksheet): { columns: Map<HeaderKey, number>; rowNumber: number } | null {
  const scanThrough = Math.min(worksheet.rowCount, 40);
  for (let rowNumber = 1; rowNumber <= scanThrough; rowNumber += 1) {
    const columns = resolveColumns(worksheet.getRow(rowNumber));
    if (columns.has("company") && columns.has("roles") && columns.has("source") && columns.has("updated")) {
      return { columns, rowNumber };
    }
  }
  return null;
}

export async function readSpreadsheetRows(filePath: string): Promise<SpreadsheetReadResult> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS 4.x's Buffer declaration predates Node's generic Buffer type.
  await workbook.xlsx.load(await normalizedWorkbookBuffer(filePath) as never);
  const rows: NormalizedSheetRow[] = [];
  let rowsRead = 0;
  let skippedRows = 0;
  const observedSheets = workbook.worksheets.map((worksheet) => worksheet.name);
  const exactWorksheet = workbook.worksheets.find((worksheet) => worksheet.name === IMPORT_SHEET_NAME);
  const exactSignature = exactWorksheet ? findHeaderSignature(exactWorksheet) : null;
  const fallbackCandidates = exactWorksheet ? [] : workbook.worksheets
    .map((worksheet) => ({ worksheet, signature: findHeaderSignature(worksheet) }))
    .filter((item): item is { worksheet: ExcelJS.Worksheet; signature: NonNullable<typeof item.signature> } => item.signature !== null);
  if (!exactWorksheet && fallbackCandidates.length === 0) {
    throw new Error(`未找到主表：${IMPORT_SHEET_NAME}；观察到工作表：${observedSheets.join("、") || "无"}`);
  }
  if (!exactWorksheet && fallbackCandidates.length > 1) {
    throw new Error(`多个工作表符合主表表头签名：${fallbackCandidates.map((item) => item.worksheet.name).join("、")}`);
  }
  if (exactWorksheet && !exactSignature) {
    throw new Error(`主表 ${IMPORT_SHEET_NAME} 缺少必要表头：更新时间、企业名称、招聘岗位、公告链接`);
  }
  const worksheet = exactWorksheet ?? fallbackCandidates[0]!.worksheet;
  const signature = exactSignature ?? fallbackCandidates[0]!.signature;
  const columns = signature.columns;
  let currentDate: string | null = null;

  for (let rowNumber = signature.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    rowsRead += 1;
    const cells = rowMap(row, columns);
    const explicitDate = spreadsheetIsoDate(cellText(cells.updated));
    if (explicitDate) currentDate = explicitDate.slice(0, 10);
    const company = cellText(cells.company);
    const roles = cellText(cells.roles);
    if (!company && !roles) {
      skippedRows += 1;
      continue;
    }
    if (!company || !roles) {
      skippedRows += 1;
      continue;
    }
    if (!currentDate) throw new Error(`工作表第 ${row.number} 行之前没有可继承的更新时间`);

    const business = {
      sourceDate: currentDate,
      company,
      companyType: cellText(cells.companyType),
      industry: cellText(cells.industry),
      roles,
      cities: cellText(cells.cities),
      aiDetail: cellText(cells.detail),
      deadline: cellText(cells.deadline),
      cohort: cellText(cells.cohort),
      degree: cellText(cells.degree),
      category: cellText(cells.category),
      sourceUrl: cellUrl(cells.source),
      applyUrl: cellUrl(cells.apply),
    };
    rows.push({
      ...business,
      sourceIdentity: `spreadsheet:${sha256([
        business.sourceDate,
        business.company,
        business.roles,
        business.cities,
        business.cohort,
      ])}`,
      contentHash: sha256(business),
      diagnosticRowNumber: row.number,
    });
  }
  return { rows, rowsRead, skippedRows };
}
