import { describe, expect, it } from "vitest";

import { formatJobNumber, postingIneligibilityNote } from "@/lib/job-numbering";

describe("岗位编号与不符合原因", () => {
  it("用企业编号和企业内岗位序号组成完整编号", () => {
    expect(formatJobNumber({ companyId: 31, jobSequence: 2 })).toBe("31-2");
  });

  it("最多展示两条硬性不符合原因，并保留原因中的解释", () => {
    expect(postingIneligibilityNote({
      effectiveDisposition: { bucket: "trash", reason: "ineligible", manuallyRestored: false },
      hardRejectReasons: ["岗位方向不符合；当前岗位属于销售职能。", "工作城市不在目标城市范围内", "官网当前不可投递"],
    })).toBe("不符合：岗位方向不符合；当前岗位属于销售职能；工作城市不在目标城市范围内。");
  });

  it("硬性原因缺失时使用明确的资格评分原因", () => {
    expect(postingIneligibilityNote({
      effectiveDisposition: { bucket: "trash", reason: "ineligible", manuallyRestored: false },
      hardRejectReasons: [],
      scoreReasons: ["工作内容 80：AI 金融应用", "上岸概率 0：JD 明确要求通过大学英语六级"],
      gapReasons: [],
    })).toBe("不符合：JD 明确要求通过大学英语六级。");
  });

  it("没有硬性原因时用方向和技能缺口说明具体未达项", () => {
    expect(postingIneligibilityNote({
      effectiveDisposition: { bucket: "trash", reason: "ineligible", manuallyRestored: false },
      hardRejectReasons: [],
      scoreReasons: [],
      gapReasons: ["方向：未识别到目标岗位方向", "技能：JD 未明确 Python，需核验主要研究语言"],
    })).toBe("不符合：未识别到目标岗位方向；JD 未明确 Python，需核验主要研究语言。");
  });

  it("所有原因字段都缺失时根据岗位信息给出可复核说明", () => {
    expect(postingIneligibilityNote({
      effectiveDisposition: { bucket: "trash", reason: "ineligible", manuallyRestored: false },
      hardRejectReasons: [],
      roleFamily: "待分类",
      cities: [],
    })).toBe("不符合：岗位方向尚未分类；工作地点尚未注明。");
  });

  it("非系统不符合岗位不生成不符合备注", () => {
    expect(postingIneligibilityNote({
      effectiveDisposition: { bucket: "trash", reason: "manual", manuallyRestored: false },
      hardRejectReasons: [],
    })).toBeNull();
  });

  it("人工处理后仍保留系统不符合原因", () => {
    expect(postingIneligibilityNote({
      effectiveDisposition: { bucket: "trash", reason: "manual", manuallyRestored: false },
      scoreRecommendation: "ineligible",
      hardRejectReasons: ["岗位方向不符合；属于销售职能。"],
    })).toBe("不符合：岗位方向不符合；属于销售职能。");
  });
});
