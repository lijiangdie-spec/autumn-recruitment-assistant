import { mkdir } from "node:fs/promises";
import path from "node:path";

import { databasePath, sqlite } from "@/lib/db/client";

export async function backupRecruitmentDatabase(label: string): Promise<string | null> {
  if (databasePath === ":memory:") return null;
  const backupDir = path.join(path.dirname(databasePath), "backups");
  await mkdir(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "backup";
  const destination = path.join(backupDir, `${path.basename(databasePath, path.extname(databasePath))}-${safeLabel}-${timestamp}.db`);
  await sqlite.backup(destination);
  return destination;
}
