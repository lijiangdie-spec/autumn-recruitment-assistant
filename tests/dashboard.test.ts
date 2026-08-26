import { describe, expect, it } from "vitest";

import { applicationApplyUrl, canAddPostingToApplicationBoard, getDashboardStats, groupByCompany, sortCompanyGroupsByTopPosting } from "@/lib/dashboard";

describe("company-first dashboard helpers", () => {
  const postings = [
    { id: 1, companyId: 10, company: "甲基金", verificationStatus: "verified" as const },
    { id: 2, companyId: 10, company: "甲基金管理有限公司", verificationStatus: "review" as const },
    { id: 3, companyId: 20, company: "乙证券", verificationStatus: "city_pending" as const },
    { id: 4, companyId: null, company: "丙银行", verificationStatus: "verified" as const },
    { id: 5, companyId: null, company: "丙银行", verificationStatus: "verified" as const },
  ];

  it("counts all archived companies and postings independently of disposition", () => {
    expect(getDashboardStats(postings)).toEqual({
      archivedCompanies: 3,
      archivedPostings: 5,
      pendingCompanies: 2,
      pendingPostings: 2,
    });
  });

  it("allows every active posting onto the application board regardless of system score", () => {
    expect(canAddPostingToApplicationBoard({
      scoreRecommendation: "ineligible",
      effectiveDisposition: { bucket: "active", reason: "ineligible", manuallyRestored: false },
    })).toBe(true);
    expect(canAddPostingToApplicationBoard({
      scoreRecommendation: "skip",
      effectiveDisposition: { bucket: "active", reason: "score", manuallyRestored: false },
    })).toBe(true);
    expect(canAddPostingToApplicationBoard({
      scoreRecommendation: "apply",
      effectiveDisposition: { bucket: "trash", reason: "manual", manuallyRestored: false },
    })).toBe(false);
  });

  it("exposes a valid application page link only when the archive has one", () => {
    expect(applicationApplyUrl({ applyUrl: " https://jobs.example.com/apply " })).toBe("https://jobs.example.com/apply");
    expect(applicationApplyUrl({ applyUrl: null })).toBeNull();
    expect(applicationApplyUrl({ applyUrl: "   " })).toBeNull();
  });

  it("groups records by stable company id and falls back to company name", () => {
    const groups = groupByCompany(postings);

    expect(groups.map((group) => ({
      key: group.key,
      company: group.company,
      ids: group.records.map((record) => record.id),
    }))).toEqual([
      { key: "id:10", company: "甲基金", ids: [1, 2] },
      { key: "id:20", company: "乙证券", ids: [3] },
      { key: "name:丙银行", company: "丙银行", ids: [4, 5] },
    ]);
  });

  it("按企业最高岗位评分降序，同分按最高分岗位最早发布日期升序", () => {
    const ranked = [
      { id: 1, companyId: 10, company: "甲基金", personalScore: 90, publishedAt: "2026-08-20T00:00:00+08:00" },
      { id: 2, companyId: 10, company: "甲基金", personalScore: 95, publishedAt: "2026-08-22T00:00:00+08:00" },
      { id: 3, companyId: 20, company: "乙证券", personalScore: 95, publishedAt: "2026-08-19T00:00:00+08:00" },
      { id: 4, companyId: 30, company: "丙银行", personalScore: 80, publishedAt: "2026-08-18T00:00:00+08:00" },
    ];

    expect(sortCompanyGroupsByTopPosting(groupByCompany(ranked)).map((group) => group.company)).toEqual([
      "乙证券",
      "甲基金",
      "丙银行",
    ]);
  });

  it("同一企业多个最高分岗位取最早日期，缺失日期最后并稳定兜底", () => {
    const ranked = [
      { id: 1, companyId: 10, company: "甲基金", personalScore: 95, publishedAt: null },
      { id: 2, companyId: 10, company: "甲基金", personalScore: 95, publishedAt: "2026-08-21T00:00:00+08:00" },
      { id: 3, companyId: 20, company: "乙证券", personalScore: 95, publishedAt: null },
      { id: 4, companyId: 30, company: "丙银行", personalScore: 95, publishedAt: null },
    ];

    expect(sortCompanyGroupsByTopPosting(groupByCompany(ranked)).map((group) => group.company)).toEqual([
      "甲基金",
      "丙银行",
      "乙证券",
    ]);
  });
});
