import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { initializeDatabase } from "@/lib/db/init";
import { resolveRecruitmentDatabasePath } from "@/lib/db/path";
import { backfillPersonalScores } from "@/lib/db/personal-score-backfill";
import * as schema from "@/lib/db/schema";

type RecruitmentDatabase = ReturnType<typeof drizzle<typeof schema>>;

const globalDatabase = globalThis as typeof globalThis & {
  recruitmentSqlite?: Database.Database;
  recruitmentDb?: RecruitmentDatabase;
};

function createClient(): { sqlite: Database.Database; db: RecruitmentDatabase } {
  const databasePath = resolveRecruitmentDatabasePath();
  if (databasePath !== ":memory:") mkdirSync(path.dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  initializeDatabase(sqlite);
  backfillPersonalScores(sqlite);
  const recoveredAt = new Date().toISOString();
  sqlite.transaction(() => {
    const interrupted = sqlite.prepare("SELECT DISTINCT application_id FROM resume_jobs WHERE status IN ('queued', 'running')").all() as Array<{ application_id: number }>;
    if (interrupted.length === 0) return;
    sqlite.prepare("UPDATE resume_jobs SET status = 'failed', error = ?, finished_at = ? WHERE status IN ('queued', 'running')")
      .run("应用重启导致后台任务中断，请在岗位简历页重新发起。", recoveredAt);
    const updateApplication = sqlite.prepare("UPDATE applications SET resume_status = 'failed', updated_at = ? WHERE id = ? AND resume_status IN ('queued', 'generating')");
    for (const row of interrupted) updateApplication.run(recoveredAt, row.application_id);
  })();
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

const client =
  globalDatabase.recruitmentSqlite && globalDatabase.recruitmentDb
    ? { sqlite: globalDatabase.recruitmentSqlite, db: globalDatabase.recruitmentDb }
    : createClient();

if (process.env.NODE_ENV !== "production") {
  globalDatabase.recruitmentSqlite = client.sqlite;
  globalDatabase.recruitmentDb = client.db;
}

export const sqlite = client.sqlite;
export const db = client.db;
export const databasePath = resolveRecruitmentDatabasePath();
