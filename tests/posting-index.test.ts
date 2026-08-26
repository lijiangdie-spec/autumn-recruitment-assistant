import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let repository: typeof import("@/lib/db/repository");
let route: typeof import("@/app/api/postings/route");
let closeDatabase: () => void;
let searchablePostingId: number;
let ineligiblePostingId: number;

beforeAll(async () => {
  process.env.RECRUITMENT_DB_PATH = ":memory:";
  repository = await import("@/lib/db/repository");
  route = await import("@/app/api/postings/route");
  const { evaluatePosting } = await import("@/lib/scoring");
  const common = {
    cities: ["上海"],
    cohort: "2027届",
    employmentType: "campus" as const,
    publishedAt: "2026-08-23T00:00:00+08:00",
    deadlineAt: "2026-12-31T23:59:59+08:00",
    sourceTrust: "official" as const,
  };

  const searchable = repository.upsertPosting(evaluatePosting({
    ...common,
    company: "索引性能测试基金",
    title: "量化研究岗",
    jdText: "负责因子研究与 Python 回测，内部工具代号 NebulaNeedle。2027 届校园招聘录用后先实习考察，考核通过后转正。",
    sourceUrl: "https://example.com/index/searchable",
    sourceName: "索引性能测试基金招聘官网",
  })).posting;
  const ineligible = repository.upsertPosting(evaluatePosting({
    ...common,
    company: "索引资格测试证券",
    title: "风险模型岗",
    cities: ["北京"],
    jdText: "负责信用风险模型与 Python。任职要求：必须通过大学英语六级考试。",
    sourceUrl: "https://example.com/index/ineligible",
    sourceName: "索引资格测试证券招聘官网",
  })).posting;
  if (!searchable || !ineligible) throw new Error("索引测试岗位应成功入库");
  searchablePostingId = searchable.id;
  ineligiblePostingId = ineligible.id;

  const { sqlite } = await import("@/lib/db/client");
  closeDatabase = () => sqlite.close();
});

afterAll(() => closeDatabase?.());

describe("岗位轻量索引", () => {
  it("与完整岗位保持关键结论一致且不包含详情重字段", () => {
    const full = repository.getPostingById(searchablePostingId);
    const indexed = repository.getPostingIndex({ disposition: "all" })
      .find((posting) => posting.id === searchablePostingId);

    expect(full).not.toBeNull();
    expect(indexed).toMatchObject({
      id: full?.id,
      companyId: full?.companyId,
      jobSequence: full?.jobSequence,
      company: full?.company,
      title: full?.title,
      personalScore: full?.personalScore,
      landingProbability: full?.landingProbability,
      scoreRecommendation: full?.scoreRecommendation,
      effectiveDisposition: full?.effectiveDisposition,
      internAssessmentPenalty: false,
    });
    expect(Object.keys(indexed ?? {})).not.toEqual(expect.arrayContaining([
      "jdText",
      "scoreBreakdown",
      "scoreOverrides",
      "scoreReasons",
      "fitReasons",
      "gapReasons",
      "hardRejectReasons",
      "sourceUrl",
      "contentHash",
      "fingerprint",
    ]));
  });

  it("保留完整 JD 搜索且不把证书要求当作内置门槛", () => {
    expect(repository.getPostingIndex({ q: "nebulaneedle", disposition: "all" }).map((posting) => posting.id))
      .toContain(searchablePostingId);

    const ineligible = repository.getPostingIndex({ disposition: "all" })
      .find((posting) => posting.id === ineligiblePostingId);
    expect(ineligible?.scoreRecommendation).toBe(repository.getPostingById(ineligiblePostingId)?.scoreRecommendation);
    expect(ineligible?.ineligibilityNote).toBeUndefined();
  });

  it("沿用人工垃圾桶和 disposition 过滤语义", () => {
    repository.updatePostingDisposition(searchablePostingId, "trash", "人工审查完成");
    expect(repository.getPostingIndex({ disposition: "active" }).some((posting) => posting.id === searchablePostingId)).toBe(false);
    expect(repository.getPostingIndex({ disposition: "trash" }).some((posting) => posting.id === searchablePostingId)).toBe(true);
    repository.updatePostingDisposition(searchablePostingId, null);
  });

  it("view=index 路由返回索引，默认路由仍返回完整岗位", async () => {
    const indexResponse = await route.GET(new NextRequest("http://127.0.0.1/api/postings?view=index&disposition=all"));
    const indexPayload = await indexResponse.json();
    const indexed = indexPayload.postings.find((posting: { id: number }) => posting.id === searchablePostingId);
    expect(indexed).toBeTruthy();
    expect(indexed).not.toHaveProperty("jdText");

    const fullResponse = await route.GET(new NextRequest("http://127.0.0.1/api/postings?disposition=all"));
    const fullPayload = await fullResponse.json();
    expect(fullPayload.postings.find((posting: { id: number }) => posting.id === searchablePostingId)?.jdText)
      .toContain("NebulaNeedle");
  });
});
