import { describe, expect, it } from "vitest";

import { normalizeSheetSnapshot } from "@/lib/qqdocs/normalize";
import type { RawSheetSnapshot } from "@/lib/qqdocs/types";

function snapshot(): RawSheetSnapshot {
  const headers = [
    "更新时间", "企业名称", "企业类型", "行业分类", "招聘岗位", "工作城市",
    "AI预测岗位信息", "截止时间", "届次", "学历要求", "类别", "公告链接", "投递方式",
  ].map((text, index) => ({ columnIndex: index + 1, text }));
  const row = (
    rowNumber: number,
    values: string[],
    links: Record<number, string> = {},
    providerRowId?: string,
  ) => ({
    rowNumber,
    providerRowId,
    cells: values.map((text, index) => ({ columnIndex: index + 1, text, href: links[index + 1] })),
  });
  return {
    sourceKey: "qqdocs:sheet",
    method: "structured",
    headers,
    reachedSheetEnd: false,
    capturedAt: "2026-08-20T00:00:00.000Z",
    rows: [
      row(2, ["8月19日", "甲基金", "私募", "金融", "量化研究员", "上海", "因子研究", "", "2027届", "硕士", "秋招", "公告", "投递"], { 12: "https://example.com/a", 13: "https://example.com/apply/a" }, "row-a"),
      row(3, ["", "乙证券", "证券", "金融", "金融工程师", "北京", "衍生品定价", "", "2027届", "硕士", "校园招聘", "公告", "投递"], { 12: "https://example.com/b", 13: "https://example.com/apply/b" }),
      row(4, ["8月17日", "丙资管", "资管", "金融", "风险模型岗", "杭州", "风险建模", "", "2027届", "硕士", "秋招", "公告", "投递"], { 12: "https://example.com/c", 13: "https://example.com/apply/c" }),
    ],
  };
}

describe("腾讯文档来源行标准化", () => {
  it("继承日期分组并规范化链接、身份和内容哈希", () => {
    const rows = normalizeSheetSnapshot(snapshot(), 2026);
    expect(rows.map((row) => row.sourceDate)).toEqual(["2026-08-19", "2026-08-19", "2026-08-17"]);
    expect(rows[0]).toMatchObject({
      company: "甲基金",
      roles: "量化研究员",
      sourceUrl: "https://example.com/a",
      applyUrl: "https://example.com/apply/a",
      sourceIdentity: "provider:row-a",
    });
    expect(rows[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("语义身份不依赖行号，内容变化只改变内容哈希", () => {
    const original = snapshot();
    const first = normalizeSheetSnapshot(original, 2026)[1];
    const moved = structuredClone(original);
    moved.rows[1].rowNumber = 99;
    moved.rows[1].cells[6].text = "衍生品定价与模型开发";
    const second = normalizeSheetSnapshot(moved, 2026)[1];
    expect(second.sourceIdentity).toBe(first.sourceIdentity);
    expect(second.contentHash).not.toBe(first.contentHash);
  });

  it("关键表头缺失时拒绝猜测列", () => {
    const invalid = snapshot();
    invalid.headers = invalid.headers.filter((header) => header.text !== "企业名称");
    expect(() => normalizeSheetSnapshot(invalid, 2026)).toThrowError(/HEADER_CHANGED/);
  });
});

