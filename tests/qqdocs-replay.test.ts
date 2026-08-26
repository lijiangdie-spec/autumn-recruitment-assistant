import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { initializeDatabase } from "@/lib/db/init";
import { analyzeQqDocsReplay, runQqDocsReplay } from "@/lib/qqdocs/replay";
import type { NormalizedSheetRow } from "@/lib/qqdocs/types";

let tempDirectory: string;
let databasePath: string;

function sourceRow(overrides: Partial<NormalizedSheetRow>): NormalizedSheetRow {
  const row: NormalizedSheetRow = {
    sourceDate: "2026-08-19",
    company: "回放测试证券",
    companyType: "金融机构",
    industry: "证券/基金",
    roles: "量化研究员、金融工程师",
    cities: "上海、深圳",
    aiDetail: "2027届校园招聘，负责因子研究与衍生品定价",
    deadline: "2026-09-30",
    cohort: "2027届",
    degree: "硕士",
    category: "秋招/校园招聘",
    sourceUrl: "https://example.com/campus",
    applyUrl: "https://example.com/apply",
    sourceIdentity: "explicit",
    contentHash: "hash-explicit",
    diagnosticRowNumber: 1,
    ...overrides,
  };
  return row;
}

beforeAll(async () => {
  tempDirectory = await mkdtemp(path.join(os.tmpdir(), "qqdocs-replay-test-"));
  databasePath = path.join(tempDirectory, "recruitment.db");
  const sqlite = new Database(databasePath);
  initializeDatabase(sqlite);
  const now = new Date().toISOString();
  const runId = Number(sqlite.prepare(`
    INSERT INTO qqdocs_import_runs
      (source_key, boundary_date, target_date, status, started_at, finished_at)
    VALUES ('replay-test', '2026-08-19', '2026-08-19', 'success', ?, ?)
  `).run(now, now).lastInsertRowid);
  const rows = [
    sourceRow({}),
    sourceRow({
      company: "蚂蚁科技集团股份有限公司",
      roles: "具体岗位见投递链接",
      aiDetail: "以官方岗位要求为准",
      sourceUrl: "https://example.com/ant-announcement",
      applyUrl: "https://example.com/ant-apply",
      sourceIdentity: "ant-link",
      contentHash: "hash-ant-link",
      diagnosticRowNumber: 2,
    }),
    sourceRow({
      company: "实习测试基金",
      roles: "量化研究实习生",
      category: "实习",
      aiDetail: "表现优秀者有留用机会",
      sourceIdentity: "internship",
      contentHash: "hash-internship",
      diagnosticRowNumber: 3,
    }),
  ];
  const insert = sqlite.prepare(`
    INSERT INTO qqdocs_source_rows
      (source_key, source_identity, source_date, content_hash, data_json,
       first_seen_run_id, last_seen_run_id, created_at, updated_at)
    VALUES ('replay-test', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(row.sourceIdentity, row.sourceDate, row.contentHash, JSON.stringify(row), runId, runId, now, now);
  }
  sqlite.close();
  process.env.RECRUITMENT_DB_PATH = databasePath;
});

afterAll(async () => {
  const globalState = globalThis as typeof globalThis & { recruitmentSqlite?: Database.Database; recruitmentDb?: unknown };
  globalState.recruitmentSqlite?.close();
  delete globalState.recruitmentSqlite;
  delete globalState.recruitmentDb;
  await rm(tempDirectory, { recursive: true, force: true });
  process.env.RECRUITMENT_DB_PATH = ":memory:";
});

describe("腾讯文档历史来源行回放", () => {
  it("dry-run 只分析当前规则下的岗位、策略排除和公司入口", () => {
    const result = analyzeQqDocsReplay({ from: "2026-08-04", databasePath });
    expect(result).toMatchObject({
      sourceRows: 3,
      historicalSourceRows: 3,
      staleSourceRows: 0,
      recognizedCandidates: 3,
      eligibleCandidates: 3,
      policyExcludedCandidates: 0,
      existingCandidates: 0,
      candidatesToInsert: 3,
      companyLinks: 1,
      companyLinksToInsert: 1,
      policyExcludedRows: 0,
      unresolvedRows: 0,
      legacyUnarchivedRows: 3,
    });
  });

  it("真实回放先备份并幂等补齐实体、入口和来源行审计", async () => {
    const first = await runQqDocsReplay({ from: "2026-08-04", databasePath });
    expect(first.status).toBe("success");
    if (first.status !== "success") return;
    expect(first.backupPath).toMatch(/before-qqdocs-replay/);
    expect(first.actions).toMatchObject({
      postingsInserted: 3,
      companyLinksInserted: 1,
      sourceRowsArchived: 3,
    });
    expect(first.after).toMatchObject({ candidatesToInsert: 0, legacyUnarchivedRows: 0 });

    const sqlite = new Database(databasePath);
    const posting = sqlite.prepare("SELECT id FROM postings ORDER BY id LIMIT 1").get() as { id: number };
    sqlite.prepare("UPDATE postings SET manual_disposition = 'trash', manual_disposition_reason = '保留测试' WHERE id = ?").run(posting.id);
    sqlite.close();

    const second = await runQqDocsReplay({ from: "2026-08-04", databasePath });
    expect(second.status).toBe("success");
    if (second.status !== "success") return;
    expect(second.actions).toMatchObject({
      postingsInserted: 0,
      postingsUpdated: 0,
      postingsSkipped: 3,
      companyLinksInserted: 0,
      sourceRowsArchived: 3,
    });

    const verified = new Database(databasePath, { readonly: true });
    expect(verified.prepare("SELECT manual_disposition, manual_disposition_reason FROM postings WHERE id = ?").get(posting.id))
      .toEqual({ manual_disposition: "trash", manual_disposition_reason: "保留测试" });
    expect((verified.prepare("SELECT COUNT(*) AS count FROM qqdocs_source_rows WHERE archive_outcome IS NULL").get() as { count: number }).count).toBe(0);
    expect((verified.prepare("SELECT COUNT(*) AS count FROM postings WHERE title = '具体岗位见投递链接'").get() as { count: number }).count).toBe(0);
    expect((verified.prepare("SELECT COUNT(*) AS count FROM company_links WHERE apply_url = 'https://example.com/ant-apply'").get() as { count: number }).count).toBe(1);
    verified.close();
  });
});
