import { describe, expect, it } from "vitest";

import { evaluateQqDocsSourceRow } from "@/lib/imports/source-row";
import type { NormalizedSheetRow } from "@/lib/qqdocs/types";

function row(overrides: Partial<NormalizedSheetRow> = {}): NormalizedSheetRow {
  return {
    sourceDate: "2026-08-19",
    company: "示例证券",
    companyType: "金融机构",
    industry: "证券/基金",
    roles: "量化研究员、金融工程师",
    cities: "上海、深圳",
    aiDetail: "2027 届校园招聘，负责因子研究和衍生品定价",
    deadline: "2026-09-30",
    cohort: "2027届",
    degree: "硕士",
    category: "秋招/校园招聘",
    sourceUrl: "https://example.com/campus",
    applyUrl: "https://example.com/apply",
    sourceIdentity: "row-1",
    contentHash: "hash-1",
    diagnosticRowNumber: 10,
    ...overrides,
  };
}

describe("腾讯文档来源行转岗位候选", () => {
  it("把一行多个明确岗位拆成稳定的岗位级候选", () => {
    const result = evaluateQqDocsSourceRow(row(), "腾讯文档 · 秋招汇总");
    expect(result.outcome).toBe("postings");
    expect(result.candidates.map((candidate) => candidate.title)).toEqual(["量化研究员", "金融工程师"]);
    expect(result.recognizedCandidates.map((candidate) => candidate.title)).toEqual(["量化研究员", "金融工程师"]);
    expect(new Set(result.candidates.map((candidate) => candidate.fingerprint)).size).toBe(2);
    expect(result.candidates[0]).toMatchObject({ publishedAt: "2026-08-19T00:00:00+08:00", sourceName: "腾讯文档 · 秋招汇总" });
  });

  it("纯实习来源行默认保留，由用户岗位类型偏好决定是否排除", () => {
    const result = evaluateQqDocsSourceRow(row({
      roles: "量化研究实习生",
      category: "实习",
      aiDetail: "表现优秀者有留用机会",
    }), "腾讯文档 · 秋招汇总");
    expect(result.outcome).toBe("postings");
    expect(result.candidates).toHaveLength(1);
    expect(result.recognizedCandidates).toHaveLength(1);
    expect(result.policyExcludedCandidates).toHaveLength(0);
  });

  it("混合来源行同时保留校招与实习标题", () => {
    const result = evaluateQqDocsSourceRow(row({
      roles: "量化研究员、量化研究实习生",
      category: "秋招/实习",
      aiDetail: "量化研究员面向 2027 届校招；量化研究实习生为日常实习。",
    }), "腾讯文档 · 秋招汇总");
    expect(result.outcome).toBe("postings");
    expect(result.candidates.map((candidate) => candidate.title)).toEqual(["量化研究员", "量化研究实习生"]);
    expect(result.policyExcludedCandidates).toEqual([]);
    expect(result.recognizedCandidates).toHaveLength(2);
  });

  it("没有可用投递或公告链接时不生成不可信岗位", () => {
    const result = evaluateQqDocsSourceRow(row({ sourceUrl: null, applyUrl: null }), "腾讯文档 · 秋招汇总");
    expect(result.outcome).toBe("unresolved");
    expect(result.candidates).toEqual([]);
    expect(result.companyLink).toBeNull();
  });

  it("宽泛岗位入口创建公司链接归档结果，不生成伪岗位", () => {
    const result = evaluateQqDocsSourceRow(row({
      company: "蚂蚁科技集团股份有限公司",
      roles: "具体岗位见投递链接",
      aiDetail: "具体岗位见投递链接：以官方岗位要求为准",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      applyUrl: "https://talent.antgroup.com/campus-full-list?type=campus_graduates",
    }), "腾讯文档 · 秋招汇总");
    expect(result.outcome).toBe("company_link");
    expect(result.candidates).toEqual([]);
    expect(result.recognizedCandidates).toEqual([]);
    expect(result.companyLink).toEqual({
      company: "蚂蚁科技集团股份有限公司",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      applyUrl: "https://talent.antgroup.com/campus-full-list?type=campus_graduates",
      reason: expect.stringContaining("宽泛"),
    });
  });

  it("明确校招中的实习考察岗位仍归档为岗位", () => {
    const result = evaluateQqDocsSourceRow(row({
      roles: "量化研究员",
      category: "秋招·实习考察",
      aiDetail: "2027届校园招聘，正式录用前需经历三个月实习考察期。",
    }), "腾讯文档 · 秋招汇总");
    expect(result.outcome).toBe("postings");
    expect(result.candidates).toHaveLength(1);
  });
});
