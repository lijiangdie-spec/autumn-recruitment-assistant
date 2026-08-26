import { and, desc, eq, or } from "drizzle-orm";

import { ensureCompany, registerCompanySource } from "@/lib/companies/store";
import { db, sqlite } from "@/lib/db/client";
import {
  appState,
  crawlRuns,
  postings,
  sources,
  type CrawlRunRow,
  type PostingRow,
  type SourceRow,
} from "@/lib/db/schema";
import {
  type CrawlRun,
  type ParsedPostingInput,
  type Posting,
  type PostingFilters,
  type PostingIndexItem,
  type SourceHealth,
  type SourceTrust,
  type VerificationStatus,
  type WorkflowState,
} from "@/lib/types";
import { isInMonitoringWindow } from "@/lib/filters";
import { resolveDisposition, type ManualDisposition } from "@/lib/disposition";
import { assessJdParseStatus } from "@/lib/jd-completeness";
import { discardExpiredPostingByFingerprint } from "@/lib/db/expiry";
import { isExpiredDeadline } from "@/lib/deadline";
import {
  CURRENT_PERSONAL_SCORE_VERSION,
  comparePersonalPriority,
  evaluatePersonalScore,
  hasInternAssessmentPenalty,
  validateScoreOverrides,
  type PersonalScoreOverrides,
} from "@/lib/personal-scoring";
import { postingIneligibilityNote } from "@/lib/job-numbering";
import { readPreferencesSync } from "@/lib/config/store";

const SOURCE_TRUSTS = new Set<SourceTrust>(["official", "university", "aggregator", "manual"]);
const VERIFICATION_STATUSES = new Set<VerificationStatus>([
  "verified",
  "date_pending",
  "city_pending",
  "cohort_pending",
  "review",
]);
const POSTING_STATUSES = new Set<Posting["status"]>(["open", "closed", "unknown"]);
const WORKFLOW_STATES = new Set<WorkflowState>(["new", "saved", "preparing", "skipped"]);
const EMPLOYMENT_TYPES = new Set<Posting["employmentType"]>(["campus", "internship", "unknown"]);
const MANUAL_DISPOSITION_SET = new Set<ManualDisposition>(["include", "trash"]);

type PostingIndexRow = Pick<
  PostingRow,
  | "id"
  | "companyId"
  | "jobSequence"
  | "company"
  | "title"
  | "roleFamily"
  | "citiesJson"
  | "cohort"
  | "employmentType"
  | "publishedAt"
  | "deadlineAt"
  | "jdText"
  | "jdParseStatus"
  | "sourceName"
  | "sourceTrust"
  | "verificationStatus"
  | "status"
  | "workflowState"
  | "applicationAvailable"
  | "hardRejectReasonsJson"
  | "gapReasonsJson"
  | "personalScore"
  | "landingProbability"
  | "scoreReasonsJson"
  | "manualDisposition"
>;

export type ScoredPostingInput = ParsedPostingInput & {
  roleFamily: Posting["roleFamily"];
  verificationStatus: VerificationStatus;
  status: Posting["status"];
  fitScore: number;
  fitReasons: string[];
  gapReasons: string[];
  hardRejectReasons: string[];
  contentHash: string;
  fingerprint: string;
};

export type UpsertPostingResult =
  | { posting: Posting; action: "inserted" | "updated" | "skipped" }
  | { posting: null; action: "expired" };

export type FinishCrawlRunPatch = {
  status: CrawlRun["status"];
  finishedAt?: string;
  discovered: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export type SourceHealthPatch = {
  enabled?: boolean;
  lastCheckedAt?: string | null;
  lastStatus?: SourceHealth["lastStatus"];
  lastError?: string | null;
};

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function stringifyStringArray(value: readonly string[] | null | undefined): string {
  return JSON.stringify(
    (value ?? []).filter((item): item is string => typeof item === "string"),
  );
}

function parseScoreOverrides(value: string | null | undefined): PersonalScoreOverrides {
  try {
    return validateScoreOverrides(JSON.parse(value ?? "{}"));
  } catch {
    return {};
  }
}

function asSourceTrust(value: string): SourceTrust {
  return SOURCE_TRUSTS.has(value as SourceTrust) ? (value as SourceTrust) : "manual";
}

function asVerificationStatus(value: string): VerificationStatus {
  return VERIFICATION_STATUSES.has(value as VerificationStatus)
    ? (value as VerificationStatus)
    : "review";
}

function asPostingStatus(value: string): Posting["status"] {
  return POSTING_STATUSES.has(value as Posting["status"])
    ? (value as Posting["status"])
    : "unknown";
}

function asWorkflowState(value: string): WorkflowState {
  return WORKFLOW_STATES.has(value as WorkflowState) ? (value as WorkflowState) : "new";
}

function asEmploymentType(value: string): Posting["employmentType"] {
  return EMPLOYMENT_TYPES.has(value as Posting["employmentType"])
    ? (value as Posting["employmentType"])
    : "unknown";
}

function asRoleFamily(value: string): Posting["roleFamily"] {
  return value.trim() || "待分类";
}

function asManualDisposition(value: string | null): ManualDisposition | null {
  return value && MANUAL_DISPOSITION_SET.has(value as ManualDisposition) ? value as ManualDisposition : null;
}

function asJdParseStatus(value: string): Posting["jdParseStatus"] {
  return value === "parsed" || value === "partial" || value === "failed" ? value : "missing";
}

function currentPostingStatus(status: string, deadlineAt: string | null): Posting["status"] {
  const stored = asPostingStatus(status);
  if (stored === "closed") return "closed";
  const deadlineTimestamp = deadlineAt ? Date.parse(deadlineAt) : Number.NaN;
  return Number.isFinite(deadlineTimestamp)
    ? deadlineTimestamp < Date.now()
      ? "closed"
      : "open"
    : stored;
}

function storedScoreRecommendation(
  row: Pick<PostingIndexRow, "deadlineAt" | "status" | "personalScore" | "landingProbability">,
): Posting["scoreRecommendation"] {
  if (currentPostingStatus(row.status, row.deadlineAt) === "closed" || row.landingProbability === 0) {
    return "ineligible";
  }
  return row.personalScore >= readPreferencesSync().job.recommendationThreshold ? "apply" : "skip";
}

function toPostingIndex(row: PostingIndexRow): PostingIndexItem {
  const cities = parseStringArray(row.citiesJson);
  const roleFamily = asRoleFamily(row.roleFamily);
  const employmentType = asEmploymentType(row.employmentType);
  const scoreRecommendation = storedScoreRecommendation(row);
  const effectiveDisposition = resolveDisposition(scoreRecommendation, asManualDisposition(row.manualDisposition));
  const hardRejectReasons = parseStringArray(row.hardRejectReasonsJson);
  const gapReasons = parseStringArray(row.gapReasonsJson);
  const scoreReasons = parseStringArray(row.scoreReasonsJson);
  return {
    id: row.id,
    companyId: row.companyId,
    jobSequence: row.jobSequence ?? row.id,
    company: row.company,
    title: row.title,
    roleFamily,
    cities,
    publishedAt: row.publishedAt,
    deadlineAt: row.deadlineAt,
    jdParseStatus: asJdParseStatus(row.jdParseStatus),
    verificationStatus: asVerificationStatus(row.verificationStatus),
    personalScore: row.personalScore,
    landingProbability: row.landingProbability,
    scoreRecommendation,
    effectiveDisposition,
    internAssessmentPenalty: hasInternAssessmentPenalty(scoreReasons),
    ineligibilityNote: postingIneligibilityNote({
      effectiveDisposition,
      scoreRecommendation,
      hardRejectReasons,
      scoreReasons,
      gapReasons,
      applicationAvailable: row.applicationAvailable,
      employmentType,
      cohort: row.cohort,
      roleFamily,
      cities,
    }) ?? undefined,
  };
}

function toPosting(row: PostingRow): Posting {
  const status = currentPostingStatus(row.status, row.deadlineAt);
  const roleFamily = asRoleFamily(row.roleFamily);
  const cities = parseStringArray(row.citiesJson);
  const hardRejectReasons = parseStringArray(row.hardRejectReasonsJson);
  const scoreOverrides = parseScoreOverrides(row.scoreOverridesJson);
  const personal = evaluatePersonalScore({
    company: row.company,
    title: row.title,
    cities,
    jdText: row.jdText,
    roleFamily,
    fitScore: row.fitScore,
    hardRejectReasons,
    deadlineAt: row.deadlineAt,
  }, scoreOverrides, readPreferencesSync().job);
  const recommendation = status === "closed" ? "ineligible" : personal.recommendation;
  const manualDisposition = asManualDisposition(row.manualDisposition);
  return {
    id: row.id,
    sourceJobId: row.sourceJobId,
    companyId: row.companyId,
    jobSequence: row.jobSequence ?? row.id,
    company: row.company,
    title: row.title,
    roleFamily,
    cities,
    cohort: row.cohort,
    employmentType: asEmploymentType(row.employmentType),
    publishedAt: row.publishedAt,
    deadlineAt: row.deadlineAt,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    jdText: row.jdText,
    jdParseStatus: asJdParseStatus(row.jdParseStatus),
    jdSourceUrl: row.jdSourceUrl,
    jdParsedAt: row.jdParsedAt,
    sourceUrl: row.sourceUrl,
    officialUrl: row.officialUrl,
    applyUrl: row.applyUrl,
    applicationAvailable: row.applicationAvailable,
    sourceName: row.sourceName,
    sourceTrust: asSourceTrust(row.sourceTrust),
    verificationStatus: asVerificationStatus(row.verificationStatus),
    status,
    fitScore: Math.max(0, Math.min(100, row.fitScore)),
    fitReasons: parseStringArray(row.fitReasonsJson),
    gapReasons: parseStringArray(row.gapReasonsJson),
    hardRejectReasons,
    personalScore: personal.personalScore,
    landingProbability: personal.landingProbability,
    scoreBreakdown: personal.breakdown,
    scoreOverrides,
    scoreReasons: personal.reasons,
    scoreRecommendation: recommendation,
    scoreVersion: CURRENT_PERSONAL_SCORE_VERSION,
    workflowState: asWorkflowState(row.workflowState),
    manualDisposition,
    manualDispositionAt: row.manualDispositionAt,
    manualDispositionReason: row.manualDispositionReason,
    reviewedAt: row.reviewedAt,
    effectiveDisposition: resolveDisposition(recommendation, manualDisposition),
    note: row.note,
    contentHash: row.contentHash,
    fingerprint: row.fingerprint,
  };
}

function toSourceHealth(row: SourceRow): SourceHealth {
  const status = row.lastStatus === "ok" || row.lastStatus === "error" ? row.lastStatus : "idle";
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    url: row.url,
    trust: asSourceTrust(row.trust),
    enabled: row.enabled,
    lastCheckedAt: row.lastCheckedAt,
    lastStatus: status,
    lastError: row.lastError,
  };
}

function toCrawlRun(row: CrawlRunRow): CrawlRun {
  const status: CrawlRun["status"] =
    row.status === "success" || row.status === "partial" || row.status === "failed"
      ? row.status
      : "running";
  return {
    id: row.id,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    cursorFrom: row.cursorFrom,
    status,
    discovered: row.discovered,
    inserted: row.inserted,
    updated: row.updated,
    skipped: row.skipped,
    errors: parseStringArray(row.errorsJson),
  };
}

function matchesFilters(posting: Posting, filters: PostingFilters): boolean {
  if (posting.employmentType === "internship") return false;
  if (filters.companyId !== undefined && posting.companyId !== filters.companyId) return false;
  const disposition = filters.disposition ?? (filters.status === "closed" ? "all" : "active");
  if (disposition !== "all" && posting.effectiveDisposition.bucket !== disposition) return false;
  if (disposition === "active" && !isInMonitoringWindow(posting.publishedAt, posting.deadlineAt)) return false;

  const query = filters.q?.trim().toLocaleLowerCase();
  if (query) {
    const haystack = [
      posting.company,
      posting.title,
      posting.jdText,
      posting.sourceName,
      posting.cities.join(" "),
    ]
      .join("\n")
      .toLocaleLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.city && !posting.cities.includes(filters.city)) return false;
  if (filters.roleFamily && posting.roleFamily !== filters.roleFamily) return false;
  if (filters.workflowState && posting.workflowState !== filters.workflowState) return false;
  if (filters.sourceTrust && posting.sourceTrust !== filters.sourceTrust) return false;
  if (filters.status && posting.status !== filters.status) return false;
  if (!filters.status && disposition === "active" && posting.status === "closed") return false;
  if (filters.verification === "verified" && posting.verificationStatus !== "verified") return false;
  if (filters.verification === "pending" && posting.verificationStatus === "verified") return false;
  return true;
}

function matchesIndexFilters(posting: PostingIndexItem, row: PostingIndexRow, filters: PostingFilters): boolean {
  const employmentType = asEmploymentType(row.employmentType);
  if (employmentType === "internship") return false;
  if (filters.companyId !== undefined && posting.companyId !== filters.companyId) return false;
  const disposition = filters.disposition ?? (filters.status === "closed" ? "all" : "active");
  if (disposition !== "all" && posting.effectiveDisposition.bucket !== disposition) return false;
  if (disposition === "active" && !isInMonitoringWindow(posting.publishedAt, posting.deadlineAt)) return false;

  const query = filters.q?.trim().toLocaleLowerCase();
  if (query) {
    const haystack = [posting.company, posting.title, row.jdText, row.sourceName, posting.cities.join(" ")]
      .join("\n")
      .toLocaleLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.city && !posting.cities.includes(filters.city)) return false;
  if (filters.roleFamily && posting.roleFamily !== filters.roleFamily) return false;
  if (filters.workflowState && asWorkflowState(row.workflowState) !== filters.workflowState) return false;
  if (filters.sourceTrust && asSourceTrust(row.sourceTrust) !== filters.sourceTrust) return false;
  const status = currentPostingStatus(row.status, row.deadlineAt);
  if (filters.status && status !== filters.status) return false;
  if (!filters.status && disposition === "active" && status === "closed") return false;
  if (filters.verification === "verified" && posting.verificationStatus !== "verified") return false;
  if (filters.verification === "pending" && posting.verificationStatus === "verified") return false;
  return true;
}

export function getPostings(filters: PostingFilters = {}): Posting[] {
  const rows = filters.companyId !== undefined && filters.disposition === "trash"
    ? db.select().from(postings).where(and(
      eq(postings.companyId, filters.companyId),
      eq(postings.manualDisposition, "trash"),
    )).all()
    : filters.companyId !== undefined
      ? db.select().from(postings).where(eq(postings.companyId, filters.companyId)).all()
      : filters.disposition === "trash"
        ? db.select().from(postings).where(eq(postings.manualDisposition, "trash")).all()
        : db.select().from(postings).all();
  return rows
    .map(toPosting)
    .filter((posting) => matchesFilters(posting, filters))
    .sort((left, right) => comparePersonalPriority(left, right) || right.id - left.id);
}

export function closeMissingFeedPostings(activeSourceJobIds: readonly string[]): number {
  const active = new Set(activeSourceJobIds);
  const subscribed = db.select({
    id: postings.id,
    sourceJobId: postings.sourceJobId,
    sourceName: postings.sourceName,
  }).from(postings).all();
  let closed = 0;
  const now = new Date().toISOString();
  for (const row of subscribed) {
    if (!row.sourceName.startsWith("岗位订阅 · ") || !row.sourceJobId || active.has(row.sourceJobId)) continue;
    db.update(postings).set({ status: "closed", applicationAvailable: false, lastSeenAt: now }).where(eq(postings.id, row.id)).run();
    closed += 1;
  }
  return closed;
}

export function getPostingIndex(filters: PostingFilters = {}): PostingIndexItem[] {
  const rows = db
    .select({
      id: postings.id,
      companyId: postings.companyId,
      jobSequence: postings.jobSequence,
      company: postings.company,
      title: postings.title,
      roleFamily: postings.roleFamily,
      citiesJson: postings.citiesJson,
      cohort: postings.cohort,
      employmentType: postings.employmentType,
      publishedAt: postings.publishedAt,
      deadlineAt: postings.deadlineAt,
      jdText: postings.jdText,
      jdParseStatus: postings.jdParseStatus,
      sourceName: postings.sourceName,
      sourceTrust: postings.sourceTrust,
      verificationStatus: postings.verificationStatus,
      status: postings.status,
      workflowState: postings.workflowState,
      applicationAvailable: postings.applicationAvailable,
      hardRejectReasonsJson: postings.hardRejectReasonsJson,
      gapReasonsJson: postings.gapReasonsJson,
      personalScore: postings.personalScore,
      landingProbability: postings.landingProbability,
      scoreReasonsJson: postings.scoreReasonsJson,
      manualDisposition: postings.manualDisposition,
    })
    .from(postings)
    .all();
  return rows
    .map((row) => ({ row, posting: toPostingIndex(row) }))
    .filter(({ row, posting }) => matchesIndexFilters(posting, row, filters))
    .map(({ posting }) => posting)
    .sort((left, right) => comparePersonalPriority(left, right) || right.id - left.id);
}

export function getPostingById(id: number): Posting | null {
  const row = db.select().from(postings).where(eq(postings.id, id)).get();
  return row ? toPosting(row) : null;
}

export function updatePostingWorkflow(
  id: number,
  patch: { workflowState?: WorkflowState; note?: string },
): Posting | null {
  const update: Partial<typeof postings.$inferInsert> = {};
  if (patch.workflowState !== undefined) {
    if (!WORKFLOW_STATES.has(patch.workflowState)) throw new Error("Invalid workflow state");
    update.workflowState = patch.workflowState;
  }
  if (patch.note !== undefined) update.note = patch.note;
  if (Object.keys(update).length === 0) return getPostingById(id);

  const row = db.update(postings).set(update).where(eq(postings.id, id)).returning().get();
  return row ? toPosting(row) : null;
}

export function updatePostingDisposition(
  id: number,
  manualDisposition: ManualDisposition | null,
  reason?: string | null,
): Posting | null {
  if (manualDisposition !== null && !MANUAL_DISPOSITION_SET.has(manualDisposition)) {
    throw new Error("Invalid manual disposition");
  }
  const now = new Date().toISOString();
  const row = db.update(postings).set({
    manualDisposition,
    manualDispositionAt: manualDisposition === null ? null : now,
    manualDispositionReason: manualDisposition === null ? null : reason?.trim() || (manualDisposition === "trash" ? "主动放弃投递" : "人工恢复"),
  }).where(eq(postings.id, id)).returning().get();
  return row ? toPosting(row) : null;
}

export function updatePostingScoreOverrides(id: number, rawOverrides: unknown): Posting | null {
  const current = db.select().from(postings).where(eq(postings.id, id)).get();
  if (!current) return null;
  const scoreOverrides = validateScoreOverrides(rawOverrides);
  const roleFamily = asRoleFamily(current.roleFamily);
  const cities = parseStringArray(current.citiesJson);
  const hardRejectReasons = parseStringArray(current.hardRejectReasonsJson);
  const score = evaluatePersonalScore({
    company: current.company,
    title: current.title,
    cities,
    jdText: current.jdText,
    roleFamily,
    fitScore: current.fitScore,
    hardRejectReasons,
    deadlineAt: current.deadlineAt,
  }, scoreOverrides, readPreferencesSync().job);
  const row = db.update(postings).set({
    personalScore: score.personalScore,
    landingProbability: score.landingProbability,
    scoreBreakdownJson: JSON.stringify(score.breakdown),
    scoreOverridesJson: JSON.stringify(scoreOverrides),
    scoreReasonsJson: JSON.stringify(score.reasons),
    scoreVersion: CURRENT_PERSONAL_SCORE_VERSION,
  }).where(eq(postings.id, id)).returning().get();
  return row ? toPosting(row) : null;
}

function ensureSource(input: ParsedPostingInput): number | null {
  const existing = db
    .select()
    .from(sources)
    .where(or(eq(sources.name, input.sourceName), eq(sources.url, input.sourceUrl)))
    .get();
  if (existing) return existing.id;

  const now = new Date().toISOString();
  const inserted = db
    .insert(sources)
    .values({
      name: input.sourceName,
      type: input.sourceTrust === "manual" ? "manual" : "detail",
      url: input.sourceUrl,
      trust: input.sourceTrust,
      enabled: true,
      lastStatus: "idle",
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: sources.id })
    .get();
  if (inserted) return inserted.id;

  const raced = db
    .select({ id: sources.id })
    .from(sources)
    .where(or(eq(sources.name, input.sourceName), eq(sources.url, input.sourceUrl)))
    .get();
  return raced?.id ?? null;
}

export function upsertPosting(input: ScoredPostingInput, sourceId?: number): UpsertPostingResult {
  if (!input.fingerprint.trim()) throw new Error("Posting fingerprint must not be empty");
  if (!input.contentHash.trim()) throw new Error("Posting content hash must not be empty");
  if (isExpiredDeadline(input.deadlineAt)) {
    discardExpiredPostingByFingerprint(input.fingerprint);
    return { posting: null, action: "expired" };
  }

  const now = new Date().toISOString();
  const companyRecord = ensureCompany(input.company);
  const existing = db
    .select()
    .from(postings)
    .where(eq(postings.fingerprint, input.fingerprint))
    .get();
  const jobSequence = existing?.companyId === companyRecord.id && existing.jobSequence !== null
    ? existing.jobSequence
    : allocateCompanyJobSequence(companyRecord.id);
  const resolvedSourceId = sourceId ?? ensureSource(input);
  const scoreOverrides = parseScoreOverrides(existing?.scoreOverridesJson);
  const personal = evaluatePersonalScore({
    company: input.company,
    title: input.title,
    cities: input.cities,
    jdText: input.jdText,
    roleFamily: input.roleFamily,
    fitScore: input.fitScore,
    hardRejectReasons: input.hardRejectReasons,
    deadlineAt: input.deadlineAt,
  }, scoreOverrides, readPreferencesSync().job);

  if (existing && existing.contentHash === input.contentHash) {
    const nextHardRejects = stringifyStringArray(input.hardRejectReasons);
    const nextFitReasons = stringifyStringArray(input.fitReasons);
    const nextGapReasons = stringifyStringArray(input.gapReasons);
    const derivedChanged =
      existing.roleFamily !== input.roleFamily ||
      existing.employmentType !== input.employmentType ||
      existing.verificationStatus !== input.verificationStatus ||
      existing.status !== input.status ||
      existing.fitScore !== Math.max(0, Math.min(100, Math.round(input.fitScore))) ||
      existing.fitReasonsJson !== nextFitReasons ||
      existing.gapReasonsJson !== nextGapReasons ||
      existing.hardRejectReasonsJson !== nextHardRejects ||
      existing.personalScore !== personal.personalScore ||
      existing.landingProbability !== personal.landingProbability;
    const row = db
      .update(postings)
      .set({
        lastSeenAt: now,
        sourceId: resolvedSourceId ?? existing.sourceId,
        sourceJobId: input.sourceJobId ?? existing.sourceJobId,
        companyId: companyRecord.id,
        jobSequence,
        company: companyRecord.canonicalName,
        sourceUrl: input.sourceUrl,
        officialUrl: input.officialUrl ?? existing.officialUrl,
        applyUrl: input.applyUrl ?? existing.applyUrl,
        applicationAvailable: input.applicationAvailable ?? existing.applicationAvailable,
        sourceName: input.sourceName,
        sourceTrust: input.sourceTrust,
        jdParseStatus: input.jdParseStatus ?? existing.jdParseStatus,
        jdSourceUrl: input.jdSourceUrl ?? existing.jdSourceUrl,
        jdParsedAt: input.jdParsedAt ?? existing.jdParsedAt,
        roleFamily: input.roleFamily,
        employmentType: input.employmentType,
        verificationStatus: input.verificationStatus,
        status: input.status,
        fitScore: Math.max(0, Math.min(100, Math.round(input.fitScore))),
        fitReasonsJson: nextFitReasons,
        gapReasonsJson: nextGapReasons,
        hardRejectReasonsJson: nextHardRejects,
        personalScore: personal.personalScore,
        landingProbability: personal.landingProbability,
        scoreBreakdownJson: JSON.stringify(personal.breakdown),
        scoreOverridesJson: JSON.stringify(scoreOverrides),
        scoreReasonsJson: JSON.stringify(personal.reasons),
        scoreVersion: CURRENT_PERSONAL_SCORE_VERSION,
      })
      .where(eq(postings.id, existing.id))
      .returning()
      .get();
    registerPostingSources(companyRecord.id, input);
    return { posting: toPosting(row), action: derivedChanged ? "updated" : "skipped" };
  }

  const values = {
    sourceId: resolvedSourceId,
    sourceJobId: input.sourceJobId ?? null,
    companyId: companyRecord.id,
    jobSequence,
    company: companyRecord.canonicalName,
    title: input.title.trim(),
    roleFamily: input.roleFamily,
    citiesJson: stringifyStringArray(input.cities),
    cohort: input.cohort,
    employmentType: input.employmentType,
    publishedAt: input.publishedAt,
    deadlineAt: input.deadlineAt,
    lastSeenAt: now,
    jdText: input.jdText,
    jdParseStatus: input.jdParseStatus ?? assessJdParseStatus(input.jdText),
    jdSourceUrl: input.jdSourceUrl ?? null,
    jdParsedAt: input.jdParsedAt ?? null,
    sourceUrl: input.sourceUrl,
    officialUrl: input.officialUrl ?? null,
    applyUrl: input.applyUrl ?? null,
    applicationAvailable: input.applicationAvailable ?? null,
    sourceName: input.sourceName,
    sourceTrust: input.sourceTrust,
    verificationStatus: input.verificationStatus,
    status: input.status,
    fitScore: Math.max(0, Math.min(100, Math.round(input.fitScore))),
    fitReasonsJson: stringifyStringArray(input.fitReasons),
    gapReasonsJson: stringifyStringArray(input.gapReasons),
    hardRejectReasonsJson: stringifyStringArray(input.hardRejectReasons),
    personalScore: personal.personalScore,
    landingProbability: personal.landingProbability,
    scoreBreakdownJson: JSON.stringify(personal.breakdown),
    scoreOverridesJson: JSON.stringify(scoreOverrides),
    scoreReasonsJson: JSON.stringify(personal.reasons),
    scoreVersion: CURRENT_PERSONAL_SCORE_VERSION,
    contentHash: input.contentHash,
    fingerprint: input.fingerprint,
  } satisfies Partial<typeof postings.$inferInsert>;

  if (existing) {
    const row = db
      .update(postings)
      .set(values)
      .where(eq(postings.id, existing.id))
      .returning()
      .get();
    registerPostingSources(companyRecord.id, input);
    return { posting: toPosting(row), action: "updated" };
  }

  const row = db
    .insert(postings)
    .values({ ...values, firstSeenAt: now, workflowState: "new", note: "" })
    .returning()
    .get();
  registerPostingSources(companyRecord.id, input);
  return { posting: toPosting(row), action: "inserted" };
}

function allocateCompanyJobSequence(companyId: number): number {
  const row = sqlite.prepare(`
    UPDATE companies
    SET next_job_sequence = next_job_sequence + 1,
        updated_at = ?
    WHERE id = ?
    RETURNING next_job_sequence - 1 AS job_sequence
  `).get(new Date().toISOString(), companyId) as { job_sequence: number } | undefined;
  if (!row) throw new Error(`无法为企业 ${companyId} 分配岗位编号`);
  return row.job_sequence;
}

function registerPostingSources(companyId: number, input: ParsedPostingInput): void {
  registerCompanySource({ companyId, url: input.sourceUrl, sourceKind: "announcement", label: input.sourceName });
  registerCompanySource({ companyId, url: input.officialUrl, sourceKind: "job_list", label: "官方招聘页" });
  registerCompanySource({ companyId, url: input.applyUrl, sourceKind: "apply", label: "投递链接" });
  registerCompanySource({
    companyId,
    url: input.jdSourceUrl,
    sourceKind: "job_detail",
    label: "岗位详情",
    parseStatus: input.jdParseStatus === "failed" ? "failed" : input.jdParseStatus === "parsed" ? "parsed" : "pending",
    lastSuccessAt: input.jdParseStatus === "parsed" ? input.jdParsedAt ?? new Date().toISOString() : null,
  });
}

export function getSources(): SourceHealth[] {
  return db.select().from(sources).all().map(toSourceHealth).sort((a, b) => a.id - b.id);
}

export function getSourceById(id: number): SourceHealth | null {
  const row = db.select().from(sources).where(eq(sources.id, id)).get();
  return row ? toSourceHealth(row) : null;
}

export function updateSourceHealth(
  identifier: number | string,
  patch: SourceHealthPatch,
): SourceHealth | null {
  const condition =
    typeof identifier === "number"
      ? eq(sources.id, identifier)
      : or(eq(sources.name, identifier), eq(sources.url, identifier));
  const row = db.update(sources).set(patch).where(condition).returning().get();
  return row ? toSourceHealth(row) : null;
}

export function createCrawlRun(cursorFrom: string): CrawlRun {
  const row = db
    .insert(crawlRuns)
    .values({
      startedAt: new Date().toISOString(),
      cursorFrom,
      status: "running",
      errorsJson: "[]",
    })
    .returning()
    .get();
  return toCrawlRun(row);
}

export function finishCrawlRun(id: number, patch: FinishCrawlRunPatch): CrawlRun {
  const row = db
    .update(crawlRuns)
    .set({
      status: patch.status,
      finishedAt: patch.finishedAt ?? new Date().toISOString(),
      discovered: patch.discovered,
      inserted: patch.inserted,
      updated: patch.updated,
      skipped: patch.skipped,
      errorsJson: stringifyStringArray(patch.errors),
    })
    .where(eq(crawlRuns.id, id))
    .returning()
    .get();
  if (!row) throw new Error(`Crawl run ${id} does not exist`);
  return toCrawlRun(row);
}

export function getLatestCrawlRun(): CrawlRun | null {
  const row = db.select().from(crawlRuns).orderBy(desc(crawlRuns.id)).limit(1).get();
  return row ? toCrawlRun(row) : null;
}

export function getAppState(key: string): string | null {
  return db.select().from(appState).where(eq(appState.key, key)).get()?.value ?? null;
}

export function setAppState(key: string, value: string | null): void {
  const updatedAt = new Date().toISOString();
  db.insert(appState)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: appState.key, set: { value, updatedAt } })
    .run();
}

export function getLastSuccessfulRefreshAt(): string | null {
  return getAppState("lastSuccessfulRefreshAt");
}
