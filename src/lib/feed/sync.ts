import { readFile, rename, rm, writeFile } from "node:fs/promises";

import { assistantPath } from "@/lib/config/paths";
import { readPreferences } from "@/lib/config/store";
import { sha256 } from "@/lib/feed/hash";
import { publicFeedSchema, type PublicFeed } from "@/lib/feed/schema";
import { closeMissingFeedPostings, upsertPosting } from "@/lib/db/repository";
import { evaluatePosting } from "@/lib/scoring";

export interface FeedSyncState { feedUrl: string; revision: string; syncedAt: string; jobCount: number; inserted: number; updated: number; skipped: number; closed: number; errors: string[] }
function stateFile(): string { return assistantPath("feed-sync.json"); }

export async function readFeedSyncState(): Promise<FeedSyncState | null> {
  try { return JSON.parse(await readFile(stateFile(), "utf8")) as FeedSyncState; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function writeState(state: FeedSyncState): Promise<void> {
  const destination = stateFile();
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rm(destination, { force: true }); await rename(temporary, destination);
}

export async function syncConfiguredFeed(): Promise<FeedSyncState> {
  const preferences = await readPreferences();
  if (!preferences.feedUrl) throw new Error("尚未配置岗位 feed URL");
  const response = await fetch(preferences.feedUrl, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Feed 请求失败：HTTP ${response.status}`);
  const feed = publicFeedSchema.parse(await response.json()) as PublicFeed;
  if (sha256(feed.jobs) !== feed.jobsHash || sha256({ schemaVersion: 1, jobsHash: feed.jobsHash }) !== feed.revision) throw new Error("Feed 完整性校验失败，已拒绝导入");
  const previous = await readFeedSyncState();
  if (previous?.revision === feed.revision) return { ...previous, syncedAt: new Date().toISOString(), inserted: 0, updated: 0, skipped: feed.jobCount, closed: 0 };
  let inserted = 0; let updated = 0; let skipped = 0; const errors: string[] = [];
  for (const job of feed.jobs) {
    try {
      const evaluated = evaluatePosting({ sourceJobId: job.id, company: job.company, title: job.title, cities: job.cities, cohort: job.cohort, employmentType: job.employmentType, publishedAt: job.publishedAt, deadlineAt: job.deadlineAt, jdText: job.jdText, jdParseStatus: job.jdText.trim() ? "parsed" : "missing", jdSourceUrl: job.officialUrl || job.sourceUrl, jdParsedAt: job.updatedAt, sourceUrl: job.sourceUrl, officialUrl: job.officialUrl, applyUrl: job.applyUrl, applicationAvailable: job.applicationAvailable, sourceName: `岗位订阅 · ${job.sourceName}`, sourceTrust: job.sourceTrust });
      const result = upsertPosting(evaluated);
      if (result.action === "inserted") inserted += 1; else if (result.action === "updated") updated += 1; else skipped += 1;
    } catch (error) { errors.push(`${job.company} · ${job.title}：${error instanceof Error ? error.message : String(error)}`); }
  }
  const closed = closeMissingFeedPostings(feed.jobs.map((job) => job.id));
  const state = { feedUrl: preferences.feedUrl, revision: feed.revision, syncedAt: new Date().toISOString(), jobCount: feed.jobCount, inserted, updated, skipped, closed, errors };
  await writeState(state); return state;
}
