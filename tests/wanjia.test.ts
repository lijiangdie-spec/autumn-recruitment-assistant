import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseWanjiaResponse } from "@/lib/collectors/wanjia";
import { evaluatePosting } from "@/lib/scoring";

const payload = JSON.parse(
  readFileSync(path.join(process.cwd(), "tests", "fixtures", "wanjia-api.json"), "utf8"),
) as unknown;

describe("万家基金官方校园招聘采集", () => {
  const postings = parseWanjiaResponse(payload);

  it("把官网快照拆成岗位级记录，并生成唯一官方详情链接", () => {
    expect(postings).toHaveLength(4);
    expect(new Set(postings.map((posting) => posting.sourceUrl)).size).toBe(4);
    expect(postings[2]).toMatchObject({
      company: "万家基金管理有限公司",
      title: "量化研究助理",
      cities: ["上海"],
      cohort: "2027届",
      employmentType: "campus",
      publishedAt: "2026-07-31T00:00:00+08:00",
      deadlineAt: "2026-08-16T23:59:59+08:00",
      sourceTrust: "official",
    });
    expect(postings[2].sourceUrl).toContain("/campus/detail?jobAdId=");
    expect(postings[2].jdText).toContain("多因子选股");
  });

  it("无行业预设时保留官网岗位标题作为方向", () => {
    const quant = evaluatePosting(postings.find((posting) => posting.title === "量化研究助理")!);
    const risk = evaluatePosting(postings.find((posting) => posting.title === "风控助理")!);
    expect(quant.roleFamily).toBe("量化研究助理");
    expect(risk.roleFamily).toBe("风控助理");
    expect(quant.hardRejectReasons).toEqual([]);
    expect(risk.hardRejectReasons).toEqual([]);
  });

  it("销售岗位默认保留，用户可通过排除关键词过滤", () => {
    const sales = evaluatePosting(postings.find((posting) => posting.title === "机构销售助理")!);
    expect(sales.hardRejectReasons).toEqual([]);
  });

  it("接口结构异常时不会把刷新当成成功", () => {
    expect(() => parseWanjiaResponse({ Code: 200, Data: [{ unexpected: true }] }))
      .toThrow(/接口结构已变化/);
  });
});
