import path from "node:path";

import { assistantPath } from "@/lib/config/paths";

export function resolveRecruitmentDatabasePath(cwd = process.cwd()): string {
  const configuredPath = process.env.RECRUITMENT_DB_PATH?.trim();
  if (configuredPath === ":memory:") return configuredPath;
  if (configuredPath) return path.resolve(cwd, configuredPath);
  return assistantPath("recruitment.db");
}
