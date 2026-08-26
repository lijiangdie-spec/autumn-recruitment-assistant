import { load } from "cheerio";

import { QqDocsImportError, type RawSheetCell, type RawSheetSnapshot } from "@/lib/qqdocs/types";

interface ClipboardInput {
  sourceKey: string;
  html: string;
  text: string;
  reachedSheetEnd: boolean;
}

function rowsFromHtml(html: string): RawSheetCell[][] {
  if (!html.trim()) return [];
  const $ = load(html);
  return $("tr").toArray().map((element) => $(element).children("th,td").toArray().map((cell, index) => {
    const node = $(cell);
    return {
      columnIndex: index + 1,
      text: node.text().replace(/\u00a0/g, " ").trim(),
      href: node.find("a[href]").first().attr("href"),
    };
  }));
}

function rowsFromTsv(text: string): RawSheetCell[][] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
    .map((line) => line.split("\t").map((value, index) => ({ columnIndex: index + 1, text: value.trim() })));
}

function findHeaderRow(rows: RawSheetCell[][]): number {
  return rows.findIndex((cells) => {
    const labels = new Set(cells.map((cell) => cell.text.replace(/\s+/g, "")));
    return labels.has("更新时间") && labels.has("企业名称") && labels.has("招聘岗位");
  });
}

export function parseQqDocsClipboard(input: ClipboardInput): RawSheetSnapshot {
  const htmlRows = rowsFromHtml(input.html);
  const rows = htmlRows.length > 0 ? htmlRows : rowsFromTsv(input.text);
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) {
    throw new QqDocsImportError("HEADER_CHANGED", "剪贴板内容中没有识别到岗位表关键表头", { rowCount: rows.length });
  }
  const headers = rows[headerIndex].map((cell) => ({ columnIndex: cell.columnIndex, text: cell.text }));
  const dataRows = rows.slice(headerIndex + 1)
    .filter((cells) => cells.some((cell) => cell.text.trim()))
    .map((cells, index) => ({ rowNumber: headerIndex + index + 2, cells }));
  return {
    sourceKey: input.sourceKey,
    method: "clipboard",
    headers,
    rows: dataRows,
    reachedSheetEnd: input.reachedSheetEnd,
    capturedAt: new Date().toISOString(),
  };
}

