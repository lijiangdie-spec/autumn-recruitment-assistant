import type { Page } from "@playwright/test";

import { QqDocsImportError, type RawSheetSnapshot } from "@/lib/qqdocs/types";

interface StructuredExtractionOptions {
  sheetId: string;
  boundaryDate: string;
  targetDate: string;
  defaultYear: number;
}

interface BrowserStructuredResult {
  sheetId: string;
  sheetName: string;
  headers: Array<{ columnIndex: number; text: string }>;
  rows: RawSheetSnapshot["rows"];
  reachedSheetEnd: boolean;
  crossedBoundary: boolean;
}

export async function extractQqDocsViaStructuredModel(
  page: Page,
  sourceKey: string,
  options: StructuredExtractionOptions,
): Promise<RawSheetSnapshot> {
  try {
    await page.waitForFunction(
      (sheetId) => {
        const app = (window as typeof window & {
          SpreadsheetApp?: { workbook?: { activeSheet?: { getSheetId?: () => string } } };
        }).SpreadsheetApp;
        return app?.workbook?.activeSheet?.getSheetId?.() === sheetId;
      },
      options.sheetId,
      { timeout: 60_000 },
    );

    // tsx/esbuild may annotate nested functions with this harmless helper.
    // Defining it in the page realm keeps the serialized Playwright callback self-contained.
    await page.evaluate("globalThis.__name = globalThis.__name || ((target) => target)");

    // Tencent Docs initially hydrates only the first block. Do not extract until the
    // in-memory model contains a real date older than the overlap boundary.
    await page.waitForFunction(
      (input) => {
        type CellData = { value?: unknown; formattedValue?: { value?: unknown } };
        type SheetModel = {
          getRowCount: () => number;
          getCellDataAtPosition: (row: number, column: number) => CellData | undefined;
        };
        const sheet = (window as typeof window & {
          SpreadsheetApp?: { workbook?: { activeSheet?: SheetModel } };
        }).SpreadsheetApp?.workbook?.activeSheet;
        if (!sheet) return false;
        for (let row = 0; row < sheet.getRowCount(); row += 1) {
          const cell = sheet.getCellDataAtPosition(row, 0);
          const raw = cell?.formattedValue?.value ?? cell?.value;
          if (typeof raw !== "string") continue;
          const match = raw.match(/(?:(20\d{2})\s*[年\-/.])?\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?/);
          if (!match) continue;
          const year = Number(match[1] ?? input.defaultYear);
          const month = Number(match[2]);
          const day = Number(match[3]);
          const iso = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
          if (iso < input.boundaryDate) return true;
        }
        return false;
      },
      { boundaryDate: options.boundaryDate, defaultYear: options.defaultYear },
      { timeout: 60_000, polling: 500 },
    );

    const result = await page.evaluate<BrowserStructuredResult, StructuredExtractionOptions>((input) => {
      type HyperlinkRun = { t?: unknown; hyperlink?: { url?: unknown } };
      type CellData = {
        value?: unknown;
        formattedValue?: { value?: unknown };
        hyperlink?: { url?: unknown };
      };
      type SheetModel = {
        getSheetId: () => string;
        getSheetName: () => string;
        getRowCount: () => number;
        getColCount: () => number;
        getCellDataAtPosition: (row: number, column: number) => CellData | undefined;
      };
      const app = (window as typeof window & {
        SpreadsheetApp?: { workbook?: { activeSheet?: SheetModel } };
      }).SpreadsheetApp;
      const sheet = app?.workbook?.activeSheet;
      if (!sheet) throw new Error("SpreadsheetApp.workbook.activeSheet 尚未就绪");

      const richRuns = (value: unknown): HyperlinkRun[] => {
        if (!value || typeof value !== "object") return [];
        const runs = (value as { r?: unknown }).r;
        return Array.isArray(runs) ? runs as HyperlinkRun[] : [];
      };
      const cellText = (cell: CellData | undefined): string => {
        const formatted = cell?.formattedValue?.value;
        if (typeof formatted === "string" || typeof formatted === "number") return String(formatted).trim();
        if (typeof cell?.value === "string" || typeof cell?.value === "number") return String(cell.value).trim();
        return richRuns(cell?.value).map((run) => typeof run.t === "string" ? run.t : "").join("").trim();
      };
      const cellHref = (cell: CellData | undefined): string | undefined => {
        if (typeof cell?.hyperlink?.url === "string") return cell.hyperlink.url;
        for (const run of richRuns(cell?.value)) {
          if (typeof run.hyperlink?.url === "string") return run.hyperlink.url;
        }
        return undefined;
      };
      const toIsoDate = (value: string): string | null => {
        const match = value.match(/(?:(20\d{2})\s*[年\-/.])?\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?/);
        if (!match) return null;
        const year = Number(match[1] ?? input.defaultYear);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
        return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
      };

      const rowCount = sheet.getRowCount();
      const colCount = sheet.getColCount();
      const headerScanLimit = Math.min(rowCount, 20);
      let headerRow = -1;
      for (let row = 0; row < headerScanLimit; row += 1) {
        const texts = Array.from({ length: colCount }, (_, column) => cellText(sheet.getCellDataAtPosition(row, column)));
        if (texts.includes("更新时间") && texts.includes("企业名称") && texts.includes("招聘岗位")) {
          headerRow = row;
          break;
        }
      }
      if (headerRow < 0) throw new Error("找不到包含关键字段的表头行");

      const headers = Array.from({ length: colCount }, (_, columnIndex) => ({
        columnIndex,
        text: cellText(sheet.getCellDataAtPosition(headerRow, columnIndex)),
      })).filter((header) => header.text.length > 0);
      const dateColumn = headers.find((header) => header.text.replace(/\s+/g, "").startsWith("更新时间"))?.columnIndex;
      if (dateColumn === undefined) throw new Error("找不到更新时间列");

      const rows: BrowserStructuredResult["rows"] = [];
      let currentDate: string | null = null;
      let crossedBoundary = false;
      let scannedToEnd = true;
      for (let row = headerRow + 1; row < rowCount; row += 1) {
        const explicitDate = toIsoDate(cellText(sheet.getCellDataAtPosition(row, dateColumn)));
        if (explicitDate) currentDate = explicitDate;
        if (!currentDate) continue;

        if (currentDate < input.boundaryDate) {
          crossedBoundary = true;
          const cells = Array.from({ length: colCount }, (_, columnIndex) => {
            const cell = sheet.getCellDataAtPosition(row, columnIndex);
            return { columnIndex, text: cellText(cell), href: cellHref(cell) };
          });
          rows.push({ rowNumber: row + 1, cells });
          scannedToEnd = false;
          break;
        }
        if (currentDate > input.targetDate) continue;

        const cells = Array.from({ length: colCount }, (_, columnIndex) => {
          const cell = sheet.getCellDataAtPosition(row, columnIndex);
          return { columnIndex, text: cellText(cell), href: cellHref(cell) };
        });
        rows.push({ rowNumber: row + 1, cells });
      }

      return {
        sheetId: sheet.getSheetId(),
        sheetName: sheet.getSheetName(),
        headers,
        rows,
        reachedSheetEnd: scannedToEnd,
        crossedBoundary,
      };
    }, options);

    if (result.sheetId !== options.sheetId) {
      throw new QqDocsImportError("WRONG_DOCUMENT", "腾讯文档当前工作表不是预期的岗位表", {
        expectedSheetId: options.sheetId,
        actualSheetId: result.sheetId,
        sheetName: result.sheetName,
      });
    }
    if (!result.crossedBoundary && !result.reachedSheetEnd) {
      throw new QqDocsImportError("RANGE_INCOMPLETE", "结构化读取没有越过边界日期", {
        boundaryDate: options.boundaryDate,
        targetDate: options.targetDate,
      });
    }
    return {
      sourceKey,
      method: "structured",
      headers: result.headers,
      rows: result.rows,
      reachedSheetEnd: result.reachedSheetEnd,
      capturedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof QqDocsImportError) throw error;
    throw new QqDocsImportError("PRIMARY_EXTRACTOR_FAILED", "腾讯文档结构化只读模型提取失败", {
      cause: error instanceof Error ? error.message : String(error),
      boundaryDate: options.boundaryDate,
      targetDate: options.targetDate,
    });
  }
}
