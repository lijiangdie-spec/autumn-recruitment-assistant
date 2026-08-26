import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let postingRoute: typeof import("@/app/api/postings/[id]/route");
let companyRoute: typeof import("@/app/api/companies/[id]/route");
let companiesRoute: typeof import("@/app/api/companies/route");
let trashRoute: typeof import("@/app/api/trash/route");
let repository: typeof import("@/lib/db/repository");
let postingId: number;
let secondPostingId: number;
let companyId: number;
let otherPostingId: number;
let otherCompanyId: number;
let closeDatabase: () => void;

function request(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  process.env.RECRUITMENT_DB_PATH = ":memory:";
  repository = await import("@/lib/db/repository");
  const { evaluatePosting } = await import("@/lib/scoring");
  const base = {
    company: "接口人工处理测试基金",
    cities: ["上海"],
    cohort: "2027届",
    employmentType: "campus" as const,
    publishedAt: "2026-08-22T00:00:00+08:00",
    deadlineAt: "2026-12-31T23:59:59+08:00",
    jdText: "负责量化研究、Python 因子挖掘与回测。",
    sourceName: "接口人工处理测试基金招聘官网",
    sourceTrust: "official" as const,
  };
  const first = repository.upsertPosting(evaluatePosting({
    ...base,
    title: "2027届量化研究岗一",
    sourceUrl: "https://example.com/disposition-route/1",
  })).posting;
  const second = repository.upsertPosting(evaluatePosting({
    ...base,
    title: "2027届量化研究岗二",
    sourceUrl: "https://example.com/disposition-route/2",
  })).posting;
  const other = repository.upsertPosting(evaluatePosting({
    ...base,
    company: "接口批量处理测试证券",
    title: "2027届金融工程岗",
    sourceName: "接口批量处理测试证券招聘官网",
    sourceUrl: "https://example.com/disposition-route/3",
  })).posting;
  if (!first?.companyId || !second || !other?.companyId) throw new Error("接口测试岗位应成功入库");
  postingId = first.id;
  secondPostingId = second.id;
  companyId = first.companyId;
  otherPostingId = other.id;
  otherCompanyId = other.companyId;
  postingRoute = await import("@/app/api/postings/[id]/route");
  companyRoute = await import("@/app/api/companies/[id]/route");
  companiesRoute = await import("@/app/api/companies/route");
  trashRoute = await import("@/app/api/trash/route");
  const { sqlite } = await import("@/lib/db/client");
  closeDatabase = () => sqlite.close();
});

afterAll(() => closeDatabase?.());

describe("人工垃圾桶 Route Handlers", () => {
  it("岗位接口拒绝旧 reviewed 字段和跨站请求", async () => {
    const obsolete = await postingRoute.PATCH(
      request(`http://127.0.0.1/api/postings/${postingId}`, { reviewed: true }),
      { params: Promise.resolve({ id: String(postingId) }) },
    );
    expect(obsolete.status).toBe(400);
    expect(await obsolete.json()).toEqual({ error: "包含不支持的岗位更新字段" });

    const forbidden = await postingRoute.PATCH(
      request(`http://127.0.0.1/api/postings/${postingId}`, { manualDisposition: "trash" }, { "sec-fetch-site": "cross-site" }),
      { params: Promise.resolve({ id: String(postingId) }) },
    );
    expect(forbidden.status).toBe(403);
  });

  it("单岗位处理与恢复持久化", async () => {
    const marked = await postingRoute.PATCH(
      request(`http://127.0.0.1/api/postings/${postingId}`, { manualDisposition: "trash", manualDispositionReason: "人工审查完成" }),
      { params: Promise.resolve({ id: String(postingId) }) },
    );
    expect(marked.status).toBe(200);
    expect((await marked.json()).posting.manualDisposition).toBe("trash");

    const persisted = await postingRoute.GET(
      new NextRequest(`http://127.0.0.1/api/postings/${postingId}`),
      { params: Promise.resolve({ id: String(postingId) }) },
    );
    expect((await persisted.json()).posting.manualDisposition).toBe("trash");

    const restored = await postingRoute.PATCH(
      request(`http://127.0.0.1/api/postings/${postingId}`, { manualDisposition: null }),
      { params: Promise.resolve({ id: String(postingId) }) },
    );
    expect((await restored.json()).posting.manualDisposition).toBeNull();
  });

  it("企业接口批量处理、幂等并整体恢复岗位", async () => {
    const marked = await companyRoute.PATCH(
      request(`http://127.0.0.1/api/companies/${companyId}`, { manualDisposition: "trash" }),
      { params: Promise.resolve({ id: String(companyId) }) },
    );
    expect(marked.status).toBe(200);
    expect(await marked.json()).toMatchObject({ updated: 2, company: { unprocessedJobs: 0, trashJobs: 2 } });
    expect(repository.getPostingById(postingId)?.manualDisposition).toBe("trash");
    expect(repository.getPostingById(secondPostingId)?.manualDisposition).toBe("trash");

    const repeated = await companyRoute.PATCH(
      request(`http://127.0.0.1/api/companies/${companyId}`, { manualDisposition: "trash" }),
      { params: Promise.resolve({ id: String(companyId) }) },
    );
    expect(await repeated.json()).toMatchObject({ updated: 0 });

    const restored = await companyRoute.PATCH(
      request(`http://127.0.0.1/api/companies/${companyId}`, { manualDisposition: null }),
      { params: Promise.resolve({ id: String(companyId) }) },
    );
    expect(await restored.json()).toMatchObject({ updated: 2, company: { unprocessedJobs: 2, trashJobs: 0 } });
  });

  it("企业接口拒绝额外字段并返回不存在企业", async () => {
    const invalid = await companyRoute.PATCH(
      request(`http://127.0.0.1/api/companies/${companyId}`, { manualDisposition: "trash", extra: true }),
      { params: Promise.resolve({ id: String(companyId) }) },
    );
    expect(invalid.status).toBe(400);

    const missing = await companyRoute.PATCH(
      request("http://127.0.0.1/api/companies/999999", { manualDisposition: "trash" }),
      { params: Promise.resolve({ id: "999999" }) },
    );
    expect(missing.status).toBe(404);
  });

  it("批量企业接口在单个事务中处理多家企业并保持幂等", async () => {
    const marked = await companiesRoute.PATCH(request("http://127.0.0.1/api/companies", {
      companyIds: [companyId, otherCompanyId],
      manualDisposition: "trash",
    }));
    expect(marked.status).toBe(200);
    expect(await marked.json()).toEqual({ companiesUpdated: 2, postingsUpdated: 3 });
    expect(repository.getPostingById(postingId)?.manualDisposition).toBe("trash");
    expect(repository.getPostingById(secondPostingId)?.manualDisposition).toBe("trash");
    expect(repository.getPostingById(otherPostingId)?.manualDisposition).toBe("trash");

    const repeated = await companiesRoute.PATCH(request("http://127.0.0.1/api/companies", {
      companyIds: [companyId, otherCompanyId],
      manualDisposition: "trash",
    }));
    expect(await repeated.json()).toEqual({ companiesUpdated: 0, postingsUpdated: 0 });

    await companyRoute.PATCH(
      request(`http://127.0.0.1/api/companies/${companyId}`, { manualDisposition: null }),
      { params: Promise.resolve({ id: String(companyId) }) },
    );
    await companyRoute.PATCH(
      request(`http://127.0.0.1/api/companies/${otherCompanyId}`, { manualDisposition: null }),
      { params: Promise.resolve({ id: String(otherCompanyId) }) },
    );
  });

  it("批量企业接口拒绝缺失企业且不产生部分更新", async () => {
    const response = await companiesRoute.PATCH(request("http://127.0.0.1/api/companies", {
      companyIds: [companyId, 999999],
      manualDisposition: "trash",
    }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "部分企业不存在，请刷新列表后重试。", missingCompanyIds: [999999] });
    expect(repository.getPostingById(postingId)?.manualDisposition).toBeNull();
  });

  it("垃圾桶先返回轻量计数和企业摘要，仅按需读取单企业详情", async () => {
    await companyRoute.PATCH(
      request(`http://127.0.0.1/api/companies/${companyId}`, { manualDisposition: "trash" }),
      { params: Promise.resolve({ id: String(companyId) }) },
    );

    const count = await trashRoute.GET(new NextRequest("http://127.0.0.1/api/trash?view=count"));
    expect(await count.json()).toEqual({ totalCompanies: 1, totalItems: 2 });

    const summary = await trashRoute.GET(new NextRequest("http://127.0.0.1/api/trash?view=companies&offset=0&limit=60"));
    const summaryPayload = await summary.json();
    expect(summaryPayload).toMatchObject({ totalCompanies: 1, totalItems: 2, offset: 0, limit: 60 });
    expect(summaryPayload.companies).toEqual([{
      key: `id:${companyId}`,
      companyId,
      company: "接口人工处理测试基金",
      postingCount: 2,
      applicationCount: 0,
      itemCount: 2,
    }]);
    expect(JSON.stringify(summaryPayload)).not.toContain("负责量化研究");

    const detail = await trashRoute.GET(new NextRequest(`http://127.0.0.1/api/trash?view=detail&companyId=${companyId}`));
    const detailPayload = await detail.json();
    expect(detailPayload.postings).toHaveLength(2);
    expect(detailPayload.postings[0]).toHaveProperty("jdText");
    expect(detailPayload.applications).toEqual([]);

    await companyRoute.PATCH(
      request(`http://127.0.0.1/api/companies/${companyId}`, { manualDisposition: null }),
      { params: Promise.resolve({ id: String(companyId) }) },
    );
  });
});
