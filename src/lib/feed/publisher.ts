import Database from "better-sqlite3";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "@/lib/feed/hash";
import { publicFeedSchema, type PublicFeed, type PublicJob } from "@/lib/feed/schema";

interface PublicPostingRow {
  id: number; company: string; title: string; cities_json: string; cohort: string | null; employment_type: string;
  published_at: string | null; deadline_at: string | null; jd_text: string; source_url: string; official_url: string | null;
  apply_url: string | null; application_available: number | null; source_name: string; source_trust: string; content_hash: string;
  last_seen_at: string; status: string; fingerprint: string;
}

function stringArray(value: string): string[] {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}

function sanitizePublicText(value: string): string {
  return value
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[联系电话已省略]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[联系邮箱已省略]")
    .replace(/[A-Z]:\\[^\r\n]+/gi, "[本地路径已省略]");
}

function isPublicWebUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password || hostname === "localhost" || hostname === "::1" || hostname.endsWith(".local")) return false;
    if (hostname === "docs.qq.com" || /^(?:127\.|10\.|192\.168\.)/.test(hostname)) return false;
    const private172 = hostname.match(/^172\.(\d{1,2})\./);
    return !private172 || Number(private172[1]) < 16 || Number(private172[1]) > 31;
  } catch { return false; }
}

export function buildPublicFeed(databasePath: string): PublicFeed {
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const rows = sqlite.prepare(`SELECT id, company, title, cities_json, cohort, employment_type, published_at, deadline_at, jd_text, source_url, official_url, apply_url, application_available, source_name, source_trust, content_hash, last_seen_at, status, fingerprint FROM postings WHERE status != 'closed' ORDER BY company, title, id`).all() as PublicPostingRow[];
    const publicUrl = (...values: Array<string | null>): string | null => {
      for (const value of values) {
        if (!value) continue;
        try { const parsed = new URL(value); if (isPublicWebUrl(parsed.toString())) return parsed.toString(); }
        catch { /* ignore non-public URLs */ }
      }
      return null;
    };
    const jobs: PublicJob[] = rows.flatMap((row) => {
      const sourceUrl = publicUrl(row.source_url, row.official_url, row.apply_url);
      if (!sourceUrl) return [];
      const jdText = sanitizePublicText(row.jd_text);
      const officialUrl = publicUrl(row.official_url);
      const applyUrl = publicUrl(row.apply_url);
      return [{
        id: row.fingerprint || sha256([row.company, row.title, sourceUrl]), company: row.company, title: row.title, cities: stringArray(row.cities_json), cohort: row.cohort,
        employmentType: row.employment_type === "campus" || row.employment_type === "internship" ? row.employment_type : "unknown",
        publishedAt: row.published_at, deadlineAt: row.deadline_at, jdText, sourceUrl,
        officialUrl, applyUrl, applicationAvailable: row.application_available === null ? null : Boolean(row.application_available),
        sourceName: sanitizePublicText(row.source_name.replace(/^岗位订阅 · /, "")), sourceTrust: row.source_trust === "official" || row.source_trust === "university" || row.source_trust === "aggregator" ? row.source_trust : "manual",
        contentHash: sha256([row.company, row.title, jdText, sourceUrl, officialUrl, applyUrl]), updatedAt: row.last_seen_at,
      }];
    });
    const jobsHash = sha256(jobs);
    return publicFeedSchema.parse({ schemaVersion: 1, revision: sha256({ schemaVersion: 1, jobsHash }), generatedAt: new Date().toISOString(), jobCount: jobs.length, jobsHash, jobs });
  } finally { sqlite.close(); }
}

export async function writePublicFeed(feed: PublicFeed, outputPath: string): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(feed)}\n`, "utf8");
  await rm(outputPath, { force: true });
  await rename(temporary, outputPath);
}
