import { describe, expect, it } from "vitest";

import { reconcileBoundary, selectStableSnapshot, validateDateWindow } from "@/lib/qqdocs/validate";
import type { NormalizedSheetRow } from "@/lib/qqdocs/types";

function row(sourceDate: string, sourceIdentity: string, contentHash = `hash-${sourceIdentity}`): NormalizedSheetRow {
  return {
    sourceDate,
    company: sourceIdentity,
    companyType: "金融机构",
    industry: "金融",
    roles: "量化研究员",
    cities: "上海",
    aiDetail: "因子研究",
    deadline: "",
    cohort: "2027届",
    degree: "硕士",
    category: "秋招",
    sourceUrl: `https://example.com/${sourceIdentity}`,
    applyUrl: null,
    sourceIdentity,
    contentHash,
    diagnosticRowNumber: 1,
  };
}

describe("腾讯文档完整性校验", () => {
  it("闭区间读取允许中间日期没有岗位，并用更早日期证明越过边界", () => {
    const result = validateDateWindow(
      [row("2026-08-20", "newer"), row("2026-08-19", "a"), row("2026-08-17", "b"), row("2026-08-14", "c"), row("2026-08-13", "sentinel")],
      { boundaryDate: "2026-08-14", targetDate: "2026-08-19", reachedSheetEnd: false },
    );
    expect(result.rows.map((item) => item.sourceIdentity)).toEqual(["a", "b", "c"]);
    expect(result.dateCounts).toEqual({ "2026-08-14": 1, "2026-08-17": 1, "2026-08-19": 1 });
  });

  it("没有越过边界且未到表尾时拒绝部分结果", () => {
    expect(() => validateDateWindow(
      [row("2026-08-19", "a"), row("2026-08-14", "c")],
      { boundaryDate: "2026-08-14", targetDate: "2026-08-19", reachedSheetEnd: false },
    )).toThrowError(/RANGE_INCOMPLETE/);
  });

  it("来源表完全重复的行只保留一条，但同身份不同内容仍拒绝", () => {
    const duplicate = row("2026-08-19", "a");
    const result = validateDateWindow(
      [duplicate, structuredClone(duplicate), row("2026-08-13", "sentinel")],
      { boundaryDate: "2026-08-14", targetDate: "2026-08-19", reachedSheetEnd: false },
    );
    expect(result.rows).toHaveLength(1);
    expect(() => validateDateWindow(
      [duplicate, row("2026-08-19", "a", "changed"), row("2026-08-13", "sentinel")],
      { boundaryDate: "2026-08-14", targetDate: "2026-08-19", reachedSheetEnd: false },
    )).toThrowError(/DUPLICATE_SOURCE_IDENTITY/);
  });

  it("只有两个连续快照相同才稳定", () => {
    const a = [row("2026-08-19", "a")];
    const b = [row("2026-08-19", "a"), row("2026-08-19", "b")];
    expect(selectStableSnapshot([a, b, b])).toEqual(b);
    expect(() => selectStableSnapshot([a, b, a])).toThrowError(/UNSTABLE_SNAPSHOT/);
  });

  it("边界日允许新增和内容更新，但已有身份消失必须停止", () => {
    const previous = [row("2026-08-14", "a"), row("2026-08-14", "b")];
    const current = [row("2026-08-14", "a", "changed"), row("2026-08-14", "b"), row("2026-08-14", "c")];
    expect(reconcileBoundary(previous, current, "2026-08-14")).toMatchObject({ added: ["c"], updated: ["a"] });
    expect(() => reconcileBoundary(previous, current.filter((item) => item.sourceIdentity !== "b"), "2026-08-14"))
      .toThrowError(/BOUNDARY_MISMATCH/);
  });
});
