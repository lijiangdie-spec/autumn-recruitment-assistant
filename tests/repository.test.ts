import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as Repository from "@/lib/db/repository";

let repository: typeof Repository;
let closeDatabase: () => void;

beforeAll(async () => {
  process.env.RECRUITMENT_DB_PATH = ":memory:";
  repository = await import("@/lib/db/repository");
  const { sqlite } = await import("@/lib/db/client");
  closeDatabase = () => sqlite.close();
});

afterAll(() => closeDatabase?.());

describe("SQLite repository", () => {
  it("首次启动不预置行业来源或个人监控起点", () => {
    expect(repository.getSources()).toHaveLength(0);
    expect(repository.getAppState("startAt")).toBe("1970-01-01T00:00:00.000Z");
    expect(repository.getLastSuccessfulRefreshAt()).toBeNull();
  });

  it("按岗位指纹幂等写入，并保留用户研判状态", async () => {
    const { evaluatePosting } = await import("@/lib/scoring");
    const evaluated = evaluatePosting({
      company: "测试证券",
      title: "2027届量化研究员",
      cities: ["上海"],
      cohort: "2027届",
      employmentType: "campus",
      publishedAt: "2026-08-04T00:00:00+08:00",
      deadlineAt: "2026-09-01T23:59:59+08:00",
      jdText: "负责因子研究、量化策略和回测，要求 Python、SQL 与机器学习能力。",
      sourceUrl: "https://example.com/jobs/quant-2027",
      officialUrl: "https://example.com/jobs/quant-2027",
      applyUrl: "https://example.com/apply/quant-2027",
      sourceName: "测试证券招聘官网",
      sourceTrust: "official",
    });

    const first = repository.upsertPosting(evaluated);
    const duplicate = repository.upsertPosting(evaluated);
    expect(first.action).toBe("inserted");
    expect(duplicate.action).toBe("skipped");
    if (!first.posting || !duplicate.posting) throw new Error("开放岗位应成功入库");
    expect(first.posting.jobSequence).toBe(1);
    expect(duplicate.posting.jobSequence).toBe(1);
    expect(repository.getPostings({ city: "上海", disposition: "all" })).toHaveLength(1);
    expect(first.posting.personalScore).toBeGreaterThan(0);
    expect(first.posting.scoreBreakdown.workContent).toBe(70);

    const rescored = repository.updatePostingScoreOverrides(first.posting.id, {
      workContent: 20,
    });
    expect(rescored?.personalScore).toBeLessThan(first.posting.personalScore);
    expect(rescored?.scoreOverrides).toMatchObject({ workContent: 20 });

    const updated = repository.updatePostingWorkflow(first.posting.id, {
      workflowState: "preparing",
      note: "准备因子研究案例",
    });
    expect(updated?.workflowState).toBe("preparing");
    expect(updated?.note).toBe("准备因子研究案例");
  });

  it("持久化人工垃圾桶、批量处理企业，并让企业新岗位重新进入未处理", async () => {
    const { evaluatePosting } = await import("@/lib/scoring");
    const { listCompanies, updateCompanyDisposition } = await import("@/lib/companies/repository");
    const base = {
      company: "已看状态基金",
      cities: ["上海"],
      cohort: "2027届",
      employmentType: "campus" as const,
      publishedAt: "2026-08-22T00:00:00+08:00",
      deadlineAt: "2026-12-31T23:59:59+08:00",
      jdText: "负责量化研究、因子挖掘和 Python 回测。",
      sourceName: "已看状态基金招聘官网",
      sourceTrust: "official" as const,
    };
    const firstInput = evaluatePosting({ ...base, title: "量化研究岗一", sourceUrl: "https://example.com/review/1" });
    const first = repository.upsertPosting(firstInput).posting;
    const second = repository.upsertPosting(evaluatePosting({ ...base, title: "量化研究岗二", sourceUrl: "https://example.com/review/2" })).posting;
    const other = repository.upsertPosting(evaluatePosting({ ...base, company: "其他已看基金", title: "量化研究岗", sourceUrl: "https://example.com/review/other" })).posting;
    if (!first || !second || !other || !first.companyId) throw new Error("测试岗位应成功入库");
    expect(first.manualDisposition).toBeNull();

    const marked = repository.updatePostingDisposition(first.id, "trash", "人工审查完成");
    expect(marked?.manualDisposition).toBe("trash");
    expect(repository.upsertPosting(firstInput).posting?.manualDisposition).toBe("trash");

    let company = listCompanies().find((item) => item.id === first.companyId);
    expect(company).toMatchObject({ totalJobs: 2, unprocessedJobs: 1, unprocessedWorthwhileJobs: 1, trashJobs: 1 });

    expect(updateCompanyDisposition(first.companyId, "trash")?.updated).toBe(1);
    expect(updateCompanyDisposition(first.companyId, "trash")?.updated).toBe(0);
    expect(repository.getPostingById(first.id)?.manualDisposition).toBe("trash");
    expect(repository.getPostingById(second.id)?.manualDisposition).toBe("trash");
    expect(repository.getPostingById(other.id)?.manualDisposition).toBeNull();

    const third = repository.upsertPosting(evaluatePosting({ ...base, title: "量化研究岗三", sourceUrl: "https://example.com/review/3" })).posting;
    if (!third) throw new Error("新增岗位应成功入库");
    expect(third.manualDisposition).toBeNull();
    company = listCompanies().find((item) => item.id === first.companyId);
    expect(company).toMatchObject({ totalJobs: 3, unprocessedJobs: 1, unprocessedWorthwhileJobs: 1, trashJobs: 2 });

    expect(updateCompanyDisposition(first.companyId, null)?.updated).toBe(2);
    expect(repository.getPostings({ disposition: "all", companyId: first.companyId }).every((posting) => posting.manualDisposition !== "trash")).toBe(true);
  });

  it("显示起点前发布但起点后仍开放的秋招，并始终隐藏实习", async () => {
    const { evaluatePosting } = await import("@/lib/scoring");
    const earlyOpen = evaluatePosting({
      company: "回填基金",
      title: "2027届量化研究员",
      cities: ["上海"],
      cohort: "2027届",
      employmentType: "campus",
      publishedAt: "2026-07-31T00:00:00+08:00",
      deadlineAt: "2026-12-16T23:59:59+08:00",
      jdText: "负责量化研究、因子挖掘和 Python 回测。",
      sourceUrl: "https://example.com/jobs/early-open",
      sourceName: "回填基金招聘官网",
      sourceTrust: "official",
    });
    const internship = evaluatePosting({
      ...earlyOpen,
      title: "2027届量化研究实习生",
      employmentType: "internship",
      sourceUrl: "https://example.com/jobs/internship",
    });
    repository.upsertPosting(earlyOpen);
    repository.upsertPosting(internship);
    expect(repository.getPostings().some((posting) => posting.company === "回填基金" && posting.employmentType === "campus")).toBe(true);
    expect(repository.getPostings({ status: "open" }).some((posting) => posting.employmentType === "internship")).toBe(false);
  });

  it("记录采集批次并显式推进成功游标", () => {
    const initial = repository.createCrawlRun("2026-08-04T00:00:00+08:00");
    const finished = repository.finishCrawlRun(initial.id, {
      status: "success",
      discovered: 1,
      inserted: 1,
      updated: 0,
      skipped: 0,
      errors: [],
    });
    repository.setAppState("lastSuccessfulRefreshAt", finished.finishedAt);
    expect(repository.getLatestCrawlRun()?.status).toBe("success");
    expect(repository.getLastSuccessfulRefreshAt()).toBe(finished.finishedAt);
  });

  it("订阅源撤下岗位时只关闭订阅记录，并可在岗位重新出现时恢复", async () => {
    const { evaluatePosting } = await import("@/lib/scoring");
    const subscribedInput = evaluatePosting({
      sourceJobId: "public-feed-stable-id",
      company: "订阅示例公司",
      title: "用户研究岗",
      cities: ["成都"],
      cohort: "2027届",
      employmentType: "campus",
      publishedAt: "2026-08-20T00:00:00+08:00",
      deadlineAt: "2026-12-01T23:59:59+08:00",
      jdText: "负责用户访谈、可用性测试和洞察沉淀。",
      sourceUrl: "https://example.com/jobs/research",
      sourceName: "岗位订阅 · 公开来源",
      sourceTrust: "official",
    });
    const localInput = evaluatePosting({
      ...subscribedInput,
      sourceJobId: "local-stable-id",
      company: "本地示例公司",
      sourceUrl: "https://example.com/jobs/local",
      sourceName: "本地 Excel",
    });
    const subscribed = repository.upsertPosting(subscribedInput).posting;
    const local = repository.upsertPosting(localInput).posting;
    if (!subscribed || !local) throw new Error("测试岗位应成功入库");

    expect(repository.closeMissingFeedPostings([])).toBe(1);
    expect(repository.getPostingById(subscribed.id)?.status).toBe("closed");
    expect(repository.getPostingById(local.id)?.status).toBe("open");

    expect(repository.upsertPosting(subscribedInput).action).toBe("updated");
    expect(repository.getPostingById(subscribed.id)?.status).toBe("open");
  });

  it("岗位删除后不复用该企业已经发放的序号", async () => {
    const { evaluatePosting } = await import("@/lib/scoring");
    const base = {
      company: "编号稳定基金",
      cities: ["上海"],
      cohort: "2027届",
      employmentType: "campus" as const,
      publishedAt: "2026-08-20T00:00:00+08:00",
      deadlineAt: "2026-12-01T23:59:59+08:00",
      jdText: "负责量化研究、因子挖掘和 Python 回测。",
      sourceName: "编号稳定基金招聘官网",
      sourceTrust: "official" as const,
    };
    const first = repository.upsertPosting(evaluatePosting({ ...base, title: "量化研究岗一", sourceUrl: "https://example.com/jobs/number-1" })).posting;
    const second = repository.upsertPosting(evaluatePosting({ ...base, title: "量化研究岗二", sourceUrl: "https://example.com/jobs/number-2" })).posting;
    if (!first || !second) throw new Error("开放岗位应成功入库");
    expect([first.jobSequence, second.jobSequence]).toEqual([1, 2]);

    const { sqlite } = await import("@/lib/db/client");
    sqlite.prepare("DELETE FROM postings WHERE id = ?").run(second.id);
    const third = repository.upsertPosting(evaluatePosting({ ...base, title: "量化研究岗三", sourceUrl: "https://example.com/jobs/number-3" })).posting;
    if (!third) throw new Error("开放岗位应成功入库");
    expect(third.jobSequence).toBe(3);
    expect(repository.getPostingById(first.id)?.jobSequence).toBe(1);
  });

  it("无行业预设时销售岗位先进入未处理，人工处理后进入垃圾桶并可恢复", async () => {
    const { evaluatePosting } = await import("@/lib/scoring");
    const evaluated = evaluatePosting({
      company: "分流测试基金",
      title: "2027届渠道销售岗",
      cities: ["上海"],
      cohort: "2027届",
      employmentType: "campus",
      publishedAt: "2026-08-20T00:00:00+08:00",
      deadlineAt: "2026-12-01T23:59:59+08:00",
      jdText: "负责渠道销售、客户拓展与营销指标。",
      sourceUrl: "https://example.com/jobs/sales-2027",
      sourceName: "分流测试基金招聘官网",
      sourceTrust: "official",
    });
    const created = repository.upsertPosting(evaluated).posting;
    if (!created) throw new Error("未截止岗位应成功入库");
    expect(created.jobSequence).toBe(1);
    expect(created.effectiveDisposition).toMatchObject({ bucket: "active", reason: "recommended" });
    expect(repository.getPostings().some((posting) => posting.id === created.id)).toBe(true);
    expect(repository.getPostings({ disposition: "trash" }).some((posting) => posting.id === created.id)).toBe(false);

    const processed = repository.updatePostingDisposition(created.id, "trash", "人工审查完成");
    expect(processed?.effectiveDisposition).toMatchObject({ bucket: "trash", reason: "manual" });
    expect(repository.getPostings({ disposition: "trash" }).some((posting) => posting.id === created.id)).toBe(true);

    const restored = repository.updatePostingDisposition(created.id, null);
    expect(restored?.effectiveDisposition).toMatchObject({ bucket: "active", reason: "recommended", manuallyRestored: false });
    expect(repository.getPostings().some((posting) => posting.id === created.id)).toBe(true);
  });

  it("明确截止时间已过的岗位和企业不会入库", async () => {
    const { evaluatePosting } = await import("@/lib/scoring");
    const closed = evaluatePosting({
      company: "过期基金",
      title: "2027届量化策略研究员",
      cities: ["北京"],
      cohort: "2027届",
      employmentType: "campus",
      publishedAt: "2026-08-04T00:00:00+08:00",
      deadlineAt: "2026-08-05T23:59:59+08:00",
      jdText: "负责 Python 因子研究与量化策略回测。",
      sourceUrl: "https://example.com/jobs/closed-quant",
      sourceName: "过期基金招聘官网",
      sourceTrust: "official",
    });
    const result = repository.upsertPosting(closed);
    expect(result).toEqual({ posting: null, action: "expired" });
    expect(repository.getPostings({ disposition: "all" }).some((posting) => posting.company === "过期基金")).toBe(false);
    const { sqlite } = await import("@/lib/db/client");
    expect(sqlite.prepare("SELECT id FROM companies WHERE canonical_name = ?").get("过期基金")).toBeUndefined();
  });

  it("清理存量截止岗位、无投递历史的企业及其待选岗链接", async () => {
    const { evaluatePosting } = await import("@/lib/scoring");
    const active = repository.upsertPosting(evaluatePosting({
      company: "清理测试基金",
      title: "2027届量化研究员",
      cities: ["上海"],
      cohort: "2027届",
      employmentType: "campus",
      publishedAt: "2026-08-04T00:00:00+08:00",
      deadlineAt: "2026-12-01T23:59:59+08:00",
      jdText: "负责 Python 因子研究与量化策略回测。",
      sourceUrl: "https://example.com/jobs/cleanup-quant",
      sourceName: "清理测试基金招聘官网",
      sourceTrust: "official",
    })).posting;
    expect(active).not.toBeNull();
    const { sqlite } = await import("@/lib/db/client");
    const { upsertCompanyLink } = await import("@/lib/imports/repository");
    upsertCompanyLink({ company: "清理测试基金", sourceUrl: active!.sourceUrl, applyUrl: "https://example.com/apply/cleanup", reason: "待手动选岗" });
    sqlite.prepare("UPDATE postings SET deadline_at = ? WHERE id = ?").run("2026-08-05T23:59:59+08:00", active!.id);

    const { pruneExpiredRecruitmentData } = await import("@/lib/db/expiry");
    const result = pruneExpiredRecruitmentData(Date.parse("2026-08-22T00:00:00+08:00"));
    expect(result).toEqual({ postingsDeleted: 1, companiesDeleted: 1, linksDeleted: 1 });
    expect(sqlite.prepare("SELECT id FROM postings WHERE id = ?").get(active!.id)).toBeUndefined();
    expect(sqlite.prepare("SELECT id FROM companies WHERE id = ?").get(active!.companyId)).toBeUndefined();
  });

  it("岗位截止后保留已有投递档案及其企业历史", async () => {
    const { evaluatePosting } = await import("@/lib/scoring");
    const active = repository.upsertPosting(evaluatePosting({
      company: "历史保留基金",
      title: "2027届风险模型岗",
      cities: ["北京"],
      cohort: "2027届",
      employmentType: "campus",
      publishedAt: "2026-08-04T00:00:00+08:00",
      deadlineAt: "2026-12-01T23:59:59+08:00",
      jdText: "负责信用风险模型与 Python。",
      sourceUrl: "https://example.com/jobs/history-risk",
      sourceName: "历史保留基金招聘官网",
      sourceTrust: "official",
    })).posting;
    expect(active).not.toBeNull();
    const { sqlite } = await import("@/lib/db/client");
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO applications
        (posting_id, company_id, sequence, folder_name, company, title, created_at, updated_at)
      VALUES (?, ?, 9001, '9001_历史保留基金_风险模型岗', ?, ?, ?, ?)
    `).run(active!.id, active!.companyId, active!.company, active!.title, now, now);
    sqlite.prepare("UPDATE postings SET deadline_at = ? WHERE id = ?").run("2026-08-05T23:59:59+08:00", active!.id);

    const { pruneExpiredRecruitmentData } = await import("@/lib/db/expiry");
    const result = pruneExpiredRecruitmentData(Date.parse("2026-08-22T00:00:00+08:00"));
    expect(result).toEqual({ postingsDeleted: 1, companiesDeleted: 0, linksDeleted: 0 });
    expect(sqlite.prepare("SELECT posting_id FROM applications WHERE sequence = 9001").get()).toEqual({ posting_id: null });
    expect(sqlite.prepare("SELECT id FROM companies WHERE id = ?").get(active!.companyId)).toBeTruthy();
  });
});
