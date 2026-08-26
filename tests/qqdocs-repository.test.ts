import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { NormalizedSheetRow } from "@/lib/qqdocs/types";

type Repository = typeof import("@/lib/qqdocs/repository");

let repository: Repository;
let closeDatabase: () => void;
let testSqlite: import("better-sqlite3").Database;

function row(sourceDate: string, sourceIdentity: string): NormalizedSheetRow {
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
    contentHash: `hash-${sourceIdentity}`,
    diagnosticRowNumber: 1,
  };
}

beforeAll(async () => {
  process.env.RECRUITMENT_DB_PATH = ":memory:";
  repository = await import("@/lib/qqdocs/repository");
  const { sqlite } = await import("@/lib/db/client");
  testSqlite = sqlite;
  closeDatabase = () => sqlite.close();
});

afterAll(() => closeDatabase?.());

describe("腾讯文档导入仓储", () => {
  function savePosting(fingerprint: string): void {
    const now = new Date().toISOString();
    testSqlite.prepare(`
      INSERT OR IGNORE INTO postings
        (company, title, first_seen_at, last_seen_at, source_url, source_name, source_trust,
         content_hash, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("测试公司", fingerprint, now, now, `https://example.com/${fingerprint}`, "测试来源", "aggregator", `hash-${fingerprint}`, fingerprint);
  }

  it("首次没有游标，成功后保存所有来源行并推进重叠日", () => {
    expect(repository.getQqDocsCursor("source-a")).toBeNull();
    const run = repository.createQqDocsRun({
      sourceKey: "source-a",
      boundaryDate: "2026-08-14",
      targetDate: "2026-08-19",
    });
    const committed = repository.commitQqDocsImport({
      runId: run.id,
      sourceKey: "source-a",
      boundaryDate: "2026-08-14",
      targetDate: "2026-08-19",
      method: "structured",
      snapshotHash: "snapshot-1",
      rows: [row("2026-08-19", "eligible"), row("2026-08-17", "filtered"), row("2026-08-14", "boundary")],
      dateCounts: { "2026-08-14": 1, "2026-08-17": 1, "2026-08-19": 1 },
      postingFingerprintsBySource: new Map([["eligible", ["fp-eligible"]]]),
      archiveResultsBySource: new Map([
        ["eligible", { outcome: "postings", reason: "明确岗位", companyLinkApplyUrl: null }],
        ["filtered", { outcome: "policy_excluded", reason: "策略排除", companyLinkApplyUrl: null }],
        ["boundary", { outcome: "unresolved", reason: "缺少链接", companyLinkApplyUrl: null }],
      ]),
      companyLinks: [],
      policyExcluded: 1,
      unresolved: 1,
      importPostings: () => {
        savePosting("fp-eligible");
        return { candidates: 1, inserted: 1, updated: 0, skipped: 0, ineligible: 0 };
      },
    });
    expect(committed.cursor).toMatchObject({ overlapDate: "2026-08-19", checkedThrough: "2026-08-19" });
    expect(repository.getQqDocsRowsByDate("source-a", "2026-08-17")).toHaveLength(1);
    expect(repository.getQqDocsRowsByDate("source-a", "2026-08-17")[0].sourceIdentity).toBe("filtered");
  });

  it("目标日期没有岗位时推进 checkedThrough，但保留最近实际岗位日", () => {
    const run = repository.createQqDocsRun({ sourceKey: "source-a", boundaryDate: "2026-08-19", targetDate: "2026-08-20" });
    const committed = repository.commitQqDocsImport({
      runId: run.id,
      sourceKey: "source-a",
      boundaryDate: "2026-08-19",
      targetDate: "2026-08-20",
      method: "structured",
      snapshotHash: "snapshot-2",
      rows: [row("2026-08-19", "eligible")],
      dateCounts: { "2026-08-19": 1 },
      postingFingerprintsBySource: new Map([["eligible", ["fp-eligible"]]]),
      archiveResultsBySource: new Map([["eligible", { outcome: "postings", reason: "明确岗位", companyLinkApplyUrl: null }]]),
      companyLinks: [],
      policyExcluded: 0,
      unresolved: 0,
      importPostings: () => ({ candidates: 0, inserted: 0, updated: 0, skipped: 0, ineligible: 0 }),
    });
    expect(committed.cursor).toMatchObject({ overlapDate: "2026-08-19", checkedThrough: "2026-08-20" });
  });

  it("导入异常时来源行和游标一起回滚，失败记录单独保留", () => {
    const run = repository.createQqDocsRun({ sourceKey: "source-fail", boundaryDate: "2026-08-14", targetDate: "2026-08-19" });
    expect(() => repository.commitQqDocsImport({
      runId: run.id,
      sourceKey: "source-fail",
      boundaryDate: "2026-08-14",
      targetDate: "2026-08-19",
      method: "clipboard",
      snapshotHash: "snapshot-fail",
      rows: [row("2026-08-19", "would-rollback")],
      dateCounts: { "2026-08-19": 1 },
      postingFingerprintsBySource: new Map(),
      archiveResultsBySource: new Map([["would-rollback", { outcome: "unresolved", reason: "测试回滚", companyLinkApplyUrl: null }]]),
      companyLinks: [],
      policyExcluded: 0,
      unresolved: 1,
      importPostings: () => { throw new Error("injected failure"); },
    })).toThrowError(/injected failure/);
    repository.failQqDocsRun(run.id, [{ code: "IMPORT_FAILED", message: "injected failure" }]);
    expect(repository.getQqDocsCursor("source-fail")).toBeNull();
    expect(repository.getQqDocsRowsByDate("source-fail", "2026-08-19")).toEqual([]);
    expect(repository.getQqDocsRun(run.id)?.status).toBe("failed");
  });

  it("零岗位候选行在同一事务创建公司入口和来源行审计引用", () => {
    const run = repository.createQqDocsRun({ sourceKey: "source-link", boundaryDate: "2026-08-19", targetDate: "2026-08-19" });
    const sourceRow = row("2026-08-19", "broad-company");
    sourceRow.roles = "具体岗位见投递链接";
    sourceRow.sourceUrl = "https://example.com/broad-announcement";
    sourceRow.applyUrl = "https://example.com/broad-apply";
    const committed = repository.commitQqDocsImport({
      runId: run.id,
      sourceKey: "source-link",
      boundaryDate: "2026-08-19",
      targetDate: "2026-08-19",
      method: "structured",
      snapshotHash: "snapshot-link",
      rows: [sourceRow],
      dateCounts: { "2026-08-19": 1 },
      postingFingerprintsBySource: new Map([["broad-company", []]]),
      archiveResultsBySource: new Map([["broad-company", {
        outcome: "company_link", reason: "宽泛岗位入口", companyLinkApplyUrl: "https://example.com/broad-apply",
      }]]),
      companyLinks: [{
        company: "broad-company",
        sourceUrl: "https://example.com/broad-announcement",
        applyUrl: "https://example.com/broad-apply",
        reason: "宽泛岗位入口",
      }],
      policyExcluded: 0,
      unresolved: 0,
      importPostings: () => ({ candidates: 0, inserted: 0, updated: 0, skipped: 0, ineligible: 0 }),
    });

    expect(committed.counts.companyLinks).toBe(1);
    const archived = testSqlite.prepare(`
      SELECT archive_outcome, archive_reason, company_link_id
      FROM qqdocs_source_rows WHERE source_key = 'source-link'
    `).get() as { archive_outcome: string; archive_reason: string; company_link_id: number | null };
    expect(archived).toMatchObject({ archive_outcome: "company_link", archive_reason: "宽泛岗位入口" });
    expect(archived.company_link_id).toBeTypeOf("number");
    expect((testSqlite.prepare("SELECT COUNT(*) AS count FROM company_sources").get() as { count: number }).count).toBeGreaterThanOrEqual(2);
  });

  it("汇总当前来源行的四类归档覆盖并单列历史替换行", () => {
    expect(repository.getQqDocsArchiveCoverage()).toMatchObject({
      totalRows: 4,
      currentRows: 4,
      staleRows: 0,
      postingRows: 1,
      companyLinkRows: 1,
      policyExcludedRows: 1,
      unresolvedRows: 1,
      unarchivedRows: 0,
      currentUnarchivedRows: 0,
    });
    expect(repository.getCurrentQqDocsRows("2026-08-04").map((item) => item.sourceIdentity).sort())
      .toEqual(["boundary", "broad-company", "eligible", "filtered"]);
  });
});
