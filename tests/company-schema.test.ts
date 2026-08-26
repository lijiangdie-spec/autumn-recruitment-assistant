import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initializeDatabase } from "@/lib/db/init";

function columns(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

describe("公司中心数据库迁移", () => {
  it("创建公司、来源、投递规则和分流字段，并可重复初始化", () => {
    const sqlite = new Database(":memory:");
    initializeDatabase(sqlite);
    initializeDatabase(sqlite);

    const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining(["companies", "company_sources", "company_application_rules"]));
    expect(columns(sqlite, "postings")).toEqual(expect.arrayContaining([
      "company_id", "jd_parse_status", "jd_source_url", "jd_parsed_at",
      "manual_disposition", "manual_disposition_at", "manual_disposition_reason",
      "reviewed_at",
    ]));
    expect(columns(sqlite, "applications")).toEqual(expect.arrayContaining([
      "company_id", "manual_disposition", "manual_disposition_at", "manual_disposition_reason",
    ]));
    expect(columns(sqlite, "qqdocs_source_rows")).toEqual(expect.arrayContaining([
      "archive_outcome", "archive_reason", "company_link_id", "archived_at",
    ]));
    expect(columns(sqlite, "qqdocs_import_runs")).toEqual(expect.arrayContaining([
      "company_links", "policy_excluded", "unresolved",
    ]));
    sqlite.close();
  });

  it("重复初始化不会删除已存在的实习岗位", () => {
    const sqlite = new Database(":memory:");
    initializeDatabase(sqlite);
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO postings
        (company, title, employment_type, first_seen_at, last_seen_at, source_url, source_name,
         source_trust, content_hash, fingerprint)
      VALUES ('初始化安全测试', '量化研究实习生', 'internship', ?, ?,
              'https://example.com/internship', '测试来源', 'official', 'intern-hash', 'intern-fingerprint')
    `).run(now, now);

    initializeDatabase(sqlite);

    expect(sqlite.prepare("SELECT title, employment_type FROM postings WHERE fingerprint = 'intern-fingerprint'").get())
      .toEqual({ title: "量化研究实习生", employment_type: "internship" });
    sqlite.close();
  });

  it("重复初始化不会覆盖岗位已看时间", () => {
    const sqlite = new Database(":memory:");
    initializeDatabase(sqlite);
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO postings
        (company, title, first_seen_at, last_seen_at, source_url, source_name, source_trust,
         content_hash, fingerprint, reviewed_at)
      VALUES ('已看测试基金', '量化研究岗', ?, ?, 'https://example.com/reviewed', '测试来源',
              'official', 'reviewed-hash', 'reviewed-fingerprint', ?)
    `).run(now, now, "2026-08-22T10:00:00.000Z");

    initializeDatabase(sqlite);

    expect(sqlite.prepare("SELECT reviewed_at FROM postings WHERE fingerprint = 'reviewed-fingerprint'").get())
      .toEqual({ reviewed_at: "2026-08-22T10:00:00.000Z" });
    sqlite.close();
  });

  it("为现有岗位确定性回填公司和来源，重复运行不产生重复记录", () => {
    const sqlite = new Database(":memory:");
    initializeDatabase(sqlite);
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO postings
        (company, title, first_seen_at, last_seen_at, jd_text, source_url, official_url, apply_url,
         source_name, source_trust, content_hash, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "易方达基金", "AI应用岗（风控合规）", now, now, "完整岗位JD", "https://example.com/source",
      "https://example.com/official", "https://example.com/apply", "测试来源", "official", "hash", "fingerprint",
    );

    initializeDatabase(sqlite);
    initializeDatabase(sqlite);
    const posting = sqlite.prepare("SELECT company_id FROM postings WHERE fingerprint = 'fingerprint'").get() as { company_id: number | null };
    const company = sqlite.prepare("SELECT canonical_name FROM companies WHERE id = ?").get(posting.company_id) as { canonical_name: string };
    expect(company.canonical_name).toBe("易方达基金管理有限公司");
    expect((sqlite.prepare("SELECT COUNT(*) count FROM companies").get() as { count: number }).count).toBe(1);
    expect((sqlite.prepare("SELECT COUNT(*) count FROM company_sources WHERE company_id = ?").get(posting.company_id) as { count: number }).count).toBe(3);
    sqlite.close();
  });
});
