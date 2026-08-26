import { describe, expect, it } from "vitest";

import { emptyPreferences } from "@/lib/config/schema";
import { comparePersonalPriority, evaluatePersonalScore, type PersonalScoreInput } from "@/lib/personal-scoring";

const prefs = () => ({ ...emptyPreferences().job, roleKeywords: ["数据分析"], requiredKeywords: ["Python", "SQL"], cities: ["上海"], dimensions: [{ id: "evidence", label: "证据能力", weight: 20, keywords: ["实验"] }], recommendationThreshold: 65 });
function input(overrides: Partial<PersonalScoreInput> = {}): PersonalScoreInput { return { company: "示例公司", title: "数据分析岗", cities: ["上海"], jdText: "使用 Python 完成实验与业务分析。", roleFamily: "数据分析", fitScore: 80, hardRejectReasons: [], deadlineAt: "2099-09-01", ...overrides }; }

describe("通用个人偏好评分", () => {
  it("只按用户配置的岗位、条件、维度与城市计算", () => {
    const result = evaluatePersonalScore(input(), {}, prefs());
    expect(result.breakdown).toMatchObject({ workContent: 100, fiveYearGrowth: 50, currentComp: 100, platformStability: 80, cityPreference: 100 });
    expect(result.personalScore).toBeGreaterThan(70);
    expect(result.recommendation).toBe("apply");
  });

  it("没有配置时使用中性值，不偷偷套用行业、城市或证书规则", () => {
    const result = evaluatePersonalScore(input({ title: "任何岗位", cities: ["任何城市"], jdText: "任何要求" }), {}, emptyPreferences().job);
    expect(result.breakdown.workContent).toBe(70);
    expect(result.breakdown.cityPreference).toBe(70);
    expect(result.landingProbability).toBeGreaterThan(0);
  });

  it("硬性偏好冲突时不可推荐", () => {
    const result = evaluatePersonalScore(input({ hardRejectReasons: ["命中排除关键词：销售"] }), {}, prefs());
    expect(result.landingProbability).toBe(0);
    expect(result.recommendation).toBe("ineligible");
  });

  it("人工只覆盖确认过的方向与必须条件判断", () => {
    const result = evaluatePersonalScore(input(), { workContent: 20, fiveYearGrowth: 90 }, prefs());
    expect(result.breakdown.workContent).toBe(20);
    expect(result.breakdown.fiveYearGrowth).toBe(90);
  });

  it("投递顺序先看偏好匹配，再看截止时间和匹配把握", () => {
    const aspirational = { personalScore: 90, landingProbability: 10, deadlineAt: "2099-10-01" };
    const safe = { personalScore: 78, landingProbability: 60, deadlineAt: "2099-08-30" };
    expect([safe, aspirational].sort(comparePersonalPriority)).toEqual([aspirational, safe]);
    const urgent = { personalScore: 82, landingProbability: 20, deadlineAt: "2099-08-20" };
    const later = { personalScore: 82, landingProbability: 70, deadlineAt: "2099-09-20" };
    expect([later, urgent].sort(comparePersonalPriority)).toEqual([urgent, later]);
  });
});
