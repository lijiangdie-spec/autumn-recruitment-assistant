import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { extractQqDocsViaStructuredModel } from "@/lib/qqdocs/extractors/structured";

function mockPage(sheetId = "jobs"): Page {
  return {
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        sheetId,
        sheetName: "🚩 27届秋招信息汇总",
        headers: [
          { columnIndex: 0, text: "更新时间" },
          { columnIndex: 1, text: "企业名称" },
          { columnIndex: 4, text: "招聘岗位" },
        ],
        rows: [{
          rowNumber: 3,
          cells: [
            { columnIndex: 0, text: "2026/8/19" },
            { columnIndex: 1, text: "示例证券" },
            { columnIndex: 4, text: "量化研究员" },
            { columnIndex: 11, text: "公告", href: "https://example.com/source" },
          ],
        }],
        reachedSheetEnd: false,
        crossedBoundary: true,
      }),
  } as unknown as Page;
}

describe("腾讯文档结构化模型提取器", () => {
  it("把浏览器内存模型转换为统一原始快照", async () => {
    const snapshot = await extractQqDocsViaStructuredModel(mockPage(), "qqdocs:sheet", {
      sheetId: "jobs",
      boundaryDate: "2026-08-14",
      targetDate: "2026-08-19",
      defaultYear: 2026,
    });
    expect(snapshot).toMatchObject({
      sourceKey: "qqdocs:sheet",
      method: "structured",
      reachedSheetEnd: false,
      rows: [{ rowNumber: 3 }],
    });
    expect(snapshot.rows[0].cells.at(-1)).toMatchObject({ href: "https://example.com/source" });
  });

  it("当前工作表标识不一致时停止", async () => {
    await expect(extractQqDocsViaStructuredModel(mockPage("other"), "qqdocs:sheet", {
      sheetId: "jobs",
      boundaryDate: "2026-08-14",
      targetDate: "2026-08-19",
      defaultYear: 2026,
    })).rejects.toThrowError(/WRONG_DOCUMENT/);
  });
});
