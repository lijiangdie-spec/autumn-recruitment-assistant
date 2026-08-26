import type Database from "better-sqlite3";

import {
  CURRENT_PERSONAL_SCORE_VERSION,
  evaluatePersonalScore,
  validateScoreOverrides,
  type PersonalScoreOverrides,
} from "@/lib/personal-scoring";
import type { RoleFamily } from "@/lib/types";
import { readPreferencesSync } from "@/lib/config/store";

type RawScorableRow = {
  id: number;
  company: string;
  title: string;
  cities_json: string;
  jd_text: string;
  role_family: string | null;
  fit_score: number | null;
  hard_reject_reasons_json: string | null;
  deadline_at: string | null;
  score_overrides_json: string | null;
};

function parseArray(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseOverrides(value: string | null): PersonalScoreOverrides {
  try {
    return validateScoreOverrides(JSON.parse(value ?? "{}"));
  } catch {
    return {};
  }
}

function roleFamily(value: string | null): RoleFamily | "待分类" {
  return value?.trim() || "待分类";
}

function writeScores(sqlite: Database.Database, table: "postings" | "applications", rows: RawScorableRow[]): void {
  const update = sqlite.prepare(`
    UPDATE ${table}
    SET personal_score = ?, landing_probability = ?, score_breakdown_json = ?,
        score_reasons_json = ?, score_version = ?
    WHERE id = ?
  `);
  for (const row of rows) {
    const score = evaluatePersonalScore({
      company: row.company,
      title: row.title,
      cities: parseArray(row.cities_json),
      jdText: row.jd_text,
      roleFamily: roleFamily(row.role_family),
      fitScore: row.fit_score ?? 50,
      hardRejectReasons: parseArray(row.hard_reject_reasons_json),
      deadlineAt: row.deadline_at,
    }, parseOverrides(row.score_overrides_json), readPreferencesSync().job);
    update.run(
      score.personalScore,
      score.landingProbability,
      JSON.stringify(score.breakdown),
      JSON.stringify(score.reasons),
      CURRENT_PERSONAL_SCORE_VERSION,
      row.id,
    );
  }
}

export function backfillPersonalScores(sqlite: Database.Database): void {
  const postingRows = sqlite.prepare(`
    SELECT id, company, title, cities_json, jd_text, role_family, fit_score,
           hard_reject_reasons_json, deadline_at, score_overrides_json
    FROM postings WHERE score_version < ?
  `).all(CURRENT_PERSONAL_SCORE_VERSION) as RawScorableRow[];

  const applicationRows = sqlite.prepare(`
    SELECT a.id, a.company, a.title, a.cities_json, a.jd_text,
           p.role_family, COALESCE(p.fit_score, 50) AS fit_score,
           COALESCE(p.hard_reject_reasons_json, '[]') AS hard_reject_reasons_json,
           p.deadline_at, a.score_overrides_json
    FROM applications a
    LEFT JOIN postings p ON p.id = a.posting_id
    WHERE a.score_version < ?
  `).all(CURRENT_PERSONAL_SCORE_VERSION) as RawScorableRow[];

  sqlite.transaction(() => {
    writeScores(sqlite, "postings", postingRows);
    writeScores(sqlite, "applications", applicationRows);
  })();
}

export function rescoreAllPersonalScores(sqlite: Database.Database): void {
  const postingRows = sqlite.prepare(`
    SELECT id, company, title, cities_json, jd_text, role_family, fit_score,
           hard_reject_reasons_json, deadline_at, score_overrides_json
    FROM postings
  `).all() as RawScorableRow[];
  const applicationRows = sqlite.prepare(`
    SELECT a.id, a.company, a.title, a.cities_json, a.jd_text,
           p.role_family, COALESCE(p.fit_score, 50) AS fit_score,
           COALESCE(p.hard_reject_reasons_json, '[]') AS hard_reject_reasons_json,
           p.deadline_at, a.score_overrides_json
    FROM applications a LEFT JOIN postings p ON p.id = a.posting_id
  `).all() as RawScorableRow[];
  sqlite.transaction(() => { writeScores(sqlite, "postings", postingRows); writeScores(sqlite, "applications", applicationRows); })();
}
