import { and, desc, eq, isNull, ne, or } from "drizzle-orm";

import { resolveApplicationFolder, buildFolderName, syncApplicationFiles } from "@/lib/applications/files";
import { ensureCompany } from "@/lib/companies/store";
import { db, sqlite } from "@/lib/db/client";
import { applicationEvents, applications, resumeJobs } from "@/lib/db/schema";
import { getPostingById } from "@/lib/db/repository";
import { resolveDisposition, type ManualDisposition } from "@/lib/disposition";
import { readPreferencesSync } from "@/lib/config/store";
import {
  CURRENT_PERSONAL_SCORE_VERSION,
  evaluatePersonalScore,
  validateScoreOverrides,
  type PersonalScoreOverrides,
} from "@/lib/personal-scoring";
import {
  APPLICATION_STAGES,
  type Application,
  type ApplicationEvent,
  type ApplicationStage,
  type ResumeDraft,
  type ResumeGenerationJob,
  type ResumeJobKind,
  type ResumeStatus,
} from "@/lib/types";

const STAGE_SET = new Set<ApplicationStage>(APPLICATION_STAGES);
const RESUME_STATUSES = new Set<ResumeStatus>(["empty", "queued", "generating", "ready", "failed", "stale"]);
const MANUAL_DISPOSITIONS = new Set<ManualDisposition>(["include", "trash"]);

function parseArray(value: string): string[] {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}

function parseDraft(value: string | null): ResumeDraft | null {
  if (!value) return null;
  try { return JSON.parse(value) as ResumeDraft; } catch { return null; }
}

function parseScoreOverrides(value: string | null): PersonalScoreOverrides {
  try { return validateScoreOverrides(JSON.parse(value ?? "{}")); } catch { return {}; }
}

function toEvent(row: typeof applicationEvents.$inferSelect): ApplicationEvent {
  return {
    id: row.id,
    applicationId: row.applicationId,
    stage: STAGE_SET.has(row.stage as ApplicationStage) ? row.stage as ApplicationStage : "preparing",
    round: row.round,
    occurredAt: row.occurredAt,
    note: row.note,
    createdAt: row.createdAt,
  };
}

function eventsFor(applicationId: number): ApplicationEvent[] {
  return db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, applicationId)).all()
    .map(toEvent).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id - b.id);
}

function toApplication(row: typeof applications.$inferSelect): Application {
  const stage = STAGE_SET.has(row.currentStage as ApplicationStage) ? row.currentStage as ApplicationStage : "preparing";
  const status = RESUME_STATUSES.has(row.resumeStatus as ResumeStatus) ? row.resumeStatus as ResumeStatus : "empty";
  const posting = row.postingId ? getPostingById(row.postingId) : null;
  const cities = parseArray(row.citiesJson);
  const scoreOverrides = parseScoreOverrides(row.scoreOverridesJson);
  const score = evaluatePersonalScore({
    company: row.company,
    title: row.title,
    cities,
    jdText: row.jdText,
    roleFamily: posting?.roleFamily ?? "待分类",
    fitScore: posting?.fitScore ?? 50,
    hardRejectReasons: posting?.hardRejectReasons ?? [],
    deadlineAt: posting?.deadlineAt ?? null,
  }, scoreOverrides, readPreferencesSync().job);
  const manualDisposition = row.manualDisposition && MANUAL_DISPOSITIONS.has(row.manualDisposition as ManualDisposition)
    ? row.manualDisposition as ManualDisposition : null;
  return {
    id: row.id,
    postingId: row.postingId,
    companyId: row.companyId,
    sequence: row.sequence,
    folderName: row.folderName,
    folderPath: resolveApplicationFolder(row.folderName),
    company: row.company,
    title: row.title,
    cities,
    jdText: row.jdText,
    sourceUrl: row.sourceUrl,
    applyUrl: row.applyUrl,
    currentStage: stage,
    currentRound: row.currentRound,
    note: row.note,
    resumeStatus: status,
    resumeUpdatedAt: row.resumeUpdatedAt,
    resumeStale: row.resumeStale,
    resumeDraft: parseDraft(row.resumeDraftJson),
    personalScore: score.personalScore,
    landingProbability: score.landingProbability,
    scoreBreakdown: score.breakdown,
    scoreOverrides,
    scoreReasons: score.reasons,
    scoreRecommendation: score.recommendation,
    scoreVersion: CURRENT_PERSONAL_SCORE_VERSION,
    manualDisposition,
    manualDispositionAt: row.manualDispositionAt,
    manualDispositionReason: row.manualDispositionReason,
    effectiveDisposition: resolveDisposition(score.recommendation, manualDisposition),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    events: eventsFor(row.id),
  };
}

export function listApplications(
  disposition: "active" | "trash" | "all" = "active",
  company?: { companyId?: number; company?: string },
): Application[] {
  const rows = company?.companyId !== undefined
    ? db.select().from(applications).where(eq(applications.companyId, company.companyId)).orderBy(desc(applications.updatedAt)).all()
    : company?.company !== undefined
      ? db.select().from(applications).where(eq(applications.company, company.company)).orderBy(desc(applications.updatedAt)).all()
      : disposition === "trash"
        ? db.select().from(applications).where(eq(applications.manualDisposition, "trash")).orderBy(desc(applications.updatedAt)).all()
        : disposition === "active"
          ? db.select().from(applications).where(or(
            isNull(applications.manualDisposition),
            ne(applications.manualDisposition, "trash"),
          )).orderBy(desc(applications.updatedAt)).all()
        : db.select().from(applications).orderBy(desc(applications.updatedAt)).all();
  return rows.map(toApplication)
    .filter((application) => disposition === "all" || application.effectiveDisposition.bucket === disposition);
}

export function getApplication(id: number): Application | null {
  const row = db.select().from(applications).where(eq(applications.id, id)).get();
  return row ? toApplication(row) : null;
}

function nextSequence(): number {
  const row = sqlite.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM applications").get() as { next: number };
  return row.next;
}

export async function createApplication(input: {
  postingId?: number | null;
  company?: string;
  title?: string;
  cities?: string[];
  jdText?: string;
  sourceUrl?: string | null;
  applyUrl?: string | null;
  note?: string;
}): Promise<Application> {
  if (input.postingId) {
    const existing = db.select().from(applications).where(eq(applications.postingId, input.postingId)).get();
    if (existing) return toApplication(existing);
  }
  const posting = input.postingId ? getPostingById(input.postingId) : null;
  if (input.postingId && !posting) throw new Error("未处理岗位不存在");
  const company = (input.company ?? posting?.company ?? "").trim();
  const title = (input.title ?? posting?.title ?? "").trim();
  if (!company || !title) throw new Error("公司和岗位不能为空");
  const now = new Date().toISOString();
  const companyRecord = ensureCompany(company);
  const scoreOverrides = posting?.scoreOverrides ?? {};
  const score = evaluatePersonalScore({
    company,
    title,
    cities: input.cities ?? posting?.cities ?? [],
    jdText: input.jdText ?? posting?.jdText ?? "",
    roleFamily: posting?.roleFamily ?? "待分类",
    fitScore: posting?.fitScore ?? 50,
    hardRejectReasons: posting?.hardRejectReasons ?? [],
    deadlineAt: posting?.deadlineAt ?? null,
  }, scoreOverrides, readPreferencesSync().job);
  const transaction = sqlite.transaction(() => {
    const sequence = nextSequence();
    const folderName = buildFolderName(sequence, company, title);
    const result = sqlite.prepare(`
      INSERT INTO applications
        (posting_id, company_id, sequence, folder_name, company, title, cities_json, jd_text, source_url, apply_url,
         current_stage, note, resume_status, personal_score, landing_probability, score_breakdown_json,
         score_overrides_json, score_reasons_json, score_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preparing', ?, 'empty', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.postingId ?? null, posting?.companyId ?? companyRecord.id, sequence, folderName, companyRecord.canonicalName, title,
      JSON.stringify(input.cities ?? posting?.cities ?? []), input.jdText ?? posting?.jdText ?? "",
      input.sourceUrl ?? posting?.officialUrl ?? posting?.sourceUrl ?? null,
      input.applyUrl ?? posting?.applyUrl ?? null, input.note ?? posting?.note ?? "",
      score.personalScore, score.landingProbability, JSON.stringify(score.breakdown), JSON.stringify(scoreOverrides),
      JSON.stringify(score.reasons), CURRENT_PERSONAL_SCORE_VERSION, now, now,
    );
    const id = Number(result.lastInsertRowid);
    sqlite.prepare(`INSERT INTO application_events (application_id, stage, round, occurred_at, note, created_at) VALUES (?, 'preparing', NULL, ?, ?, ?)`)
      .run(id, now, "加入投递管理", now);
    if (input.postingId) sqlite.prepare("UPDATE postings SET workflow_state = 'preparing' WHERE id = ?").run(input.postingId);
    return id;
  });
  const application = getApplication(transaction());
  if (!application) throw new Error("岗位建档失败");
  await syncApplicationFiles(application);
  return application;
}

export async function updateApplicationDisposition(
  id: number,
  manualDisposition: ManualDisposition | null,
  reason?: string | null,
): Promise<Application | null> {
  if (manualDisposition !== null && !MANUAL_DISPOSITIONS.has(manualDisposition)) {
    throw new Error("Invalid manual disposition");
  }
  const current = getApplication(id);
  if (!current) return null;
  const now = new Date().toISOString();
  db.update(applications).set({
    manualDisposition,
    manualDispositionAt: manualDisposition === null ? null : now,
    manualDispositionReason: manualDisposition === null ? null : reason?.trim() || (manualDisposition === "trash" ? "主动放弃投递" : "人工恢复"),
    updatedAt: now,
  }).where(eq(applications.id, id)).run();
  if (current.postingId) {
    const { updatePostingDisposition } = await import("@/lib/db/repository");
    updatePostingDisposition(current.postingId, manualDisposition, reason);
  }
  const application = getApplication(id);
  if (application) await syncApplicationFiles(application);
  return application;
}

export async function updateApplication(id: number, patch: {
  company?: string; title?: string; cities?: string[]; jdText?: string;
  sourceUrl?: string | null; applyUrl?: string | null; note?: string; resumeDraft?: ResumeDraft | null;
  resumeStatus?: ResumeStatus; resumeUpdatedAt?: string | null; resumeStale?: boolean;
  scoreOverrides?: PersonalScoreOverrides;
}): Promise<Application | null> {
  const current = getApplication(id);
  if (!current) return null;
  const update: Partial<typeof applications.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.company !== undefined) update.company = patch.company.trim();
  if (patch.title !== undefined) update.title = patch.title.trim();
  if (patch.cities !== undefined) update.citiesJson = JSON.stringify(patch.cities);
  if (patch.jdText !== undefined) { update.jdText = patch.jdText; update.resumeStale = true; update.resumeStatus = current.resumeStatus === "ready" ? "stale" : current.resumeStatus; }
  if (patch.sourceUrl !== undefined) update.sourceUrl = patch.sourceUrl;
  if (patch.applyUrl !== undefined) update.applyUrl = patch.applyUrl;
  if (patch.note !== undefined) update.note = patch.note;
  if (patch.resumeDraft !== undefined) update.resumeDraftJson = patch.resumeDraft ? JSON.stringify(patch.resumeDraft) : null;
  if (patch.resumeStatus !== undefined) update.resumeStatus = patch.resumeStatus;
  if (patch.resumeUpdatedAt !== undefined) update.resumeUpdatedAt = patch.resumeUpdatedAt;
  if (patch.resumeStale !== undefined) update.resumeStale = patch.resumeStale;
  if (patch.scoreOverrides !== undefined) update.scoreOverridesJson = JSON.stringify(validateScoreOverrides(patch.scoreOverrides));
  db.update(applications).set(update).where(eq(applications.id, id)).run();
  if (
    patch.company !== undefined || patch.title !== undefined || patch.cities !== undefined
    || patch.jdText !== undefined || patch.scoreOverrides !== undefined
  ) {
    const row = db.select().from(applications).where(eq(applications.id, id)).get();
    if (row) {
      const posting = row.postingId ? getPostingById(row.postingId) : null;
      const scoreOverrides = parseScoreOverrides(row.scoreOverridesJson);
      const score = evaluatePersonalScore({
        company: row.company,
        title: row.title,
        cities: parseArray(row.citiesJson),
        jdText: row.jdText,
        roleFamily: posting?.roleFamily ?? "待分类",
        fitScore: posting?.fitScore ?? 50,
        hardRejectReasons: posting?.hardRejectReasons ?? [],
        deadlineAt: posting?.deadlineAt ?? null,
      }, scoreOverrides, readPreferencesSync().job);
      db.update(applications).set({
        personalScore: score.personalScore,
        landingProbability: score.landingProbability,
        scoreBreakdownJson: JSON.stringify(score.breakdown),
        scoreReasonsJson: JSON.stringify(score.reasons),
        scoreVersion: CURRENT_PERSONAL_SCORE_VERSION,
      }).where(eq(applications.id, id)).run();
    }
  }
  const application = getApplication(id);
  if (application) await syncApplicationFiles(application);
  return application;
}

export async function addApplicationEvent(id: number, input: { stage: ApplicationStage; round?: number | null; occurredAt?: string; note?: string }): Promise<Application | null> {
  if (!STAGE_SET.has(input.stage)) throw new Error("投递阶段无效");
  const current = getApplication(id);
  if (!current) return null;
  const now = new Date().toISOString();
  const round = input.stage === "written_test" || input.stage === "interview" ? Math.max(1, input.round ?? 1) : null;
  const occurredAt = input.occurredAt || now;
  sqlite.transaction(() => {
    sqlite.prepare("INSERT INTO application_events (application_id, stage, round, occurred_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, input.stage, round, occurredAt, input.note?.trim() ?? "", now);
    const latest = sqlite.prepare("SELECT stage, round FROM application_events WHERE application_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1").get(id) as { stage: string; round: number | null };
    sqlite.prepare("UPDATE applications SET current_stage = ?, current_round = ?, updated_at = ? WHERE id = ?")
      .run(latest.stage, latest.round, now, id);
  })();
  const application = getApplication(id);
  if (application) await syncApplicationFiles(application);
  return application;
}

export async function updateApplicationEvent(applicationId: number, eventId: number, input: { stage: ApplicationStage; round?: number | null; occurredAt: string; note?: string }): Promise<Application | null> {
  if (!STAGE_SET.has(input.stage)) throw new Error("投递阶段无效");
  const event = db.select().from(applicationEvents).where(and(eq(applicationEvents.id, eventId), eq(applicationEvents.applicationId, applicationId))).get();
  if (!event) return null;
  const round = input.stage === "written_test" || input.stage === "interview" ? Math.max(1, input.round ?? 1) : null;
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE application_events SET stage = ?, round = ?, occurred_at = ?, note = ? WHERE id = ? AND application_id = ?")
      .run(input.stage, round, input.occurredAt, input.note?.trim() ?? "", eventId, applicationId);
    const latest = sqlite.prepare("SELECT stage, round FROM application_events WHERE application_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1").get(applicationId) as { stage: string; round: number | null };
    sqlite.prepare("UPDATE applications SET current_stage = ?, current_round = ?, updated_at = ? WHERE id = ?")
      .run(latest.stage, latest.round, new Date().toISOString(), applicationId);
  })();
  const application = getApplication(applicationId);
  if (application) await syncApplicationFiles(application);
  return application;
}

export async function repairApplicationFolder(id: number): Promise<Application | null> {
  const application = getApplication(id);
  if (application) await syncApplicationFiles(application);
  return application;
}

function toJob(row: typeof resumeJobs.$inferSelect): ResumeGenerationJob {
  return {
    id: row.id, applicationId: row.applicationId,
    kind: row.kind === "rewrite" || row.kind === "render" ? row.kind : "generate",
    status: row.status === "running" || row.status === "succeeded" || row.status === "failed" ? row.status : "queued",
    feedback: row.feedback, error: row.error, createdAt: row.createdAt,
    startedAt: row.startedAt, finishedAt: row.finishedAt,
  };
}

export function createResumeJob(applicationId: number, kind: ResumeJobKind, feedback = ""): ResumeGenerationJob {
  if (!getApplication(applicationId)) throw new Error("投递岗位不存在");
  const now = new Date().toISOString();
  const row = db.insert(resumeJobs).values({ applicationId, kind, status: "queued", feedback, createdAt: now }).returning().get();
  return toJob(row);
}

export function getResumeJob(id: number): ResumeGenerationJob | null {
  const row = db.select().from(resumeJobs).where(eq(resumeJobs.id, id)).get();
  return row ? toJob(row) : null;
}

export function updateResumeJob(id: number, patch: Partial<{ status: "running" | "succeeded" | "failed"; error: string | null; startedAt: string; finishedAt: string }>): ResumeGenerationJob | null {
  const row = db.update(resumeJobs).set(patch).where(eq(resumeJobs.id, id)).returning().get();
  return row ? toJob(row) : null;
}
