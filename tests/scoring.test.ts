import { describe, expect, it } from "vitest";

import { emptyPreferences, type JobPreferences } from "@/lib/config/schema";
import { extractCohort, inferEmploymentType } from "@/lib/filters";
import { evaluatePosting } from "@/lib/scoring";
import type { ParsedPostingInput } from "@/lib/types";

function posting(overrides: Partial<ParsedPostingInput> = {}): ParsedPostingInput { return { company: "示例公司", title: "数据分析师", cities: ["上海"], cohort: "2027届", employmentType: "campus", publishedAt: "2026-08-04T00:00:00+08:00", deadlineAt: "2099-09-01T23:59:59+08:00", jdText: "使用 Python 与 SQL 完成数据分析。", sourceUrl: "https://example.com/jobs/1?utm_source=test", officialUrl: "https://example.com/jobs/1", applyUrl: "https://example.com/apply/1", sourceName: "示例招聘官网", sourceTrust: "official", ...overrides }; }
const preferences = (): JobPreferences => ({ ...emptyPreferences().job, roleKeywords: ["数据分析"], excludedKeywords: ["销售"], cities: ["上海"], cohorts: ["2027届"], employmentTypes: ["campus"], requiredKeywords: ["Python"], recommendationThreshold: 60 });

describe("配置驱动的透明岗位评分", () => {
  it("匹配用户偏好时给出透明理由", () => { const result = evaluatePosting(posting(), new Date("2026-08-06"), preferences()); expect(result.hardRejectReasons).toEqual([]); expect(result.roleFamily).toBe("数据分析"); expect(result.fitScore).toBe(100); expect(result.fitReasons.join(" ")).toContain("岗位方向"); });
  it("排除项和城市只来自用户配置", () => { const result = evaluatePosting(posting({ title: "销售经理", cities: ["成都"], jdText: "负责销售，使用 Python。" }), new Date(), preferences()); expect(result.hardRejectReasons).toContain("命中排除关键词：销售"); expect(result.hardRejectReasons).toContain("工作地点不在已配置的目标城市中"); });
  it("无偏好时不会按行业、岗位或城市硬拒绝", () => { const result = evaluatePosting(posting({ title: "销售经理", cities: ["任意城市"] }), new Date(), emptyPreferences().job); expect(result.hardRejectReasons).toEqual([]); expect(result.fitScore).toBe(70); });
  it("监控起点只有显式环境变量才生效", () => { const previous = process.env.AUTUMN_ASSISTANT_MONITOR_START; process.env.AUTUMN_ASSISTANT_MONITOR_START = "2026-08-04"; const result = evaluatePosting(posting({ publishedAt: "2026-07-01", deadlineAt: null }), new Date(), preferences()); expect(result.hardRejectReasons).toContain("岗位早于自定义监控起点且已无法确认仍可投"); if (previous === undefined) delete process.env.AUTUMN_ASSISTANT_MONITOR_START; else process.env.AUTUMN_ASSISTANT_MONITOR_START = previous; });
  it("通用识别任意届别和校招/实习", () => { expect(extractCohort("面向 2030 届")).toBe("2030届"); expect(inferEmploymentType("2030届校园招聘\n有实习经历优先")).toBe("campus"); expect(inferEmploymentType("数据分析实习生")).toBe("internship"); });
  it("规范 URL 并让补齐内容触发更新但保持身份", () => { const pending = evaluatePosting(posting({ publishedAt: null }), new Date(), preferences()); const verified = evaluatePosting(posting(), new Date(), preferences()); expect(pending.sourceUrl).not.toContain("utm_source"); expect(pending.fingerprint).toBe(verified.fingerprint); expect(pending.contentHash).not.toBe(verified.contentHash); });
});
