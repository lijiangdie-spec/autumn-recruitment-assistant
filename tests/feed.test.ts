import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sha256 } from "@/lib/feed/hash";
import { buildPublicFeed } from "@/lib/feed/publisher";

let root = ""; let databasePath = "";
beforeAll(async () => { root = await mkdtemp(path.join(os.tmpdir(), "autumn-feed-")); databasePath = path.join(root, "private.db"); const db = new Database(databasePath); db.exec("CREATE TABLE postings (id INTEGER, company TEXT, title TEXT, cities_json TEXT, cohort TEXT, employment_type TEXT, published_at TEXT, deadline_at TEXT, jd_text TEXT, source_url TEXT, official_url TEXT, apply_url TEXT, application_available INTEGER, source_name TEXT, source_trust TEXT, content_hash TEXT, last_seen_at TEXT, status TEXT, fingerprint TEXT)"); const insert = db.prepare("INSERT INTO postings VALUES (?, ?, ?, '[\"上海\"]', '2027届', 'campus', '2026-08-01', NULL, ?, ?, NULL, ?, 1, '公开来源', 'official', ?, '2026-08-26T00:00:00Z', 'open', ?)"); const testPhone = ["138", "0013", "8000"].join(""); insert.run(1, '示例公司', '产品设计', `负责用户研究，联系 ${testPhone} 或 hr@example.com。`, 'https://example.com/source', 'https://example.com/apply', "a".repeat(64), "b".repeat(64)); insert.run(2, '私人草稿', '无公开链接', '本地草稿', 'manual://draft', null, "c".repeat(64), "d".repeat(64)); insert.run(3, '私人表格', '表格来源', '不应公开', 'https://docs.qq.com/sheet/example?tab=1', null, "e".repeat(64), "f".repeat(64)); db.close(); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("公开岗位 feed", () => {
  it("只发布有公开链接的脱敏岗位 DTO，并使用稳定 ID 生成可复核版本", () => { const feed = buildPublicFeed(databasePath); expect(feed.jobCount).toBe(1); expect(feed.jobs[0].id).toBe("b".repeat(64)); expect(feed.jobs[0].jdText).toContain("[联系电话已省略]"); expect(feed.jobs[0].jdText).toContain("[联系邮箱已省略]"); expect(feed.jobs[0]).not.toHaveProperty("note"); expect(feed.jobs[0]).not.toHaveProperty("personalScore"); expect(feed.jobsHash).toBe(sha256(feed.jobs)); expect(feed.revision).toBe(sha256({ schemaVersion: 1, jobsHash: feed.jobsHash })); });
});
