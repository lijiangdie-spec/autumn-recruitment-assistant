import type {
  PersonalScoreBreakdown,
  PersonalScoreOverrides,
  ScoreRecommendation,
} from "@/lib/personal-scoring";
import type { EffectiveDisposition, ManualDisposition } from "@/lib/disposition";

export const TARGET_CITIES: readonly string[] = [];
export const ROLE_FAMILIES: readonly string[] = [];

export type TargetCity = string;
export type RoleFamily = string;
export type SourceTrust = "official" | "university" | "aggregator" | "manual";
export type VerificationStatus = "verified" | "date_pending" | "city_pending" | "cohort_pending" | "review";
export type PostingStatus = "open" | "closed" | "unknown";
export type WorkflowState = "new" | "saved" | "preparing" | "skipped";
export const APPLICATION_STAGES = ["preparing", "applied", "written_test", "interview", "withdrawn", "rejected", "offer"] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];
export type ResumeStatus = "empty" | "queued" | "generating" | "ready" | "failed" | "stale";
export type ResumeJobKind = "generate" | "rewrite" | "render";
export type ResumeJobStatus = "queued" | "running" | "succeeded" | "failed";
export type JdParseStatus = "missing" | "partial" | "parsed" | "failed";
export type CompanySourceKind = "announcement" | "job_list" | "job_detail" | "apply" | "rules" | "unknown";
export type CompanySourceParseStatus = "pending" | "parsed" | "failed" | "not_supported";
export type ApplicationRuleExtractionStatus = "verified" | "not_stated" | "needs_review";

export interface Posting {
  id: number;
  sourceJobId: string | null;
  companyId: number | null;
  jobSequence: number;
  company: string;
  title: string;
  roleFamily: RoleFamily | "待分类";
  cities: string[];
  cohort: string | null;
  employmentType: "campus" | "internship" | "unknown";
  publishedAt: string | null;
  deadlineAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  jdText: string;
  jdParseStatus: JdParseStatus;
  jdSourceUrl: string | null;
  jdParsedAt: string | null;
  sourceUrl: string;
  officialUrl: string | null;
  applyUrl: string | null;
  applicationAvailable: boolean | null;
  sourceName: string;
  sourceTrust: SourceTrust;
  verificationStatus: VerificationStatus;
  status: PostingStatus;
  fitScore: number;
  fitReasons: string[];
  gapReasons: string[];
  hardRejectReasons: string[];
  personalScore: number;
  landingProbability: number;
  scoreBreakdown: PersonalScoreBreakdown;
  scoreOverrides: PersonalScoreOverrides;
  scoreReasons: string[];
  scoreRecommendation: ScoreRecommendation;
  scoreVersion: number;
  workflowState: WorkflowState;
  manualDisposition: ManualDisposition | null;
  manualDispositionAt: string | null;
  manualDispositionReason: string | null;
  reviewedAt: string | null;
  effectiveDisposition: EffectiveDisposition;
  note: string;
  contentHash: string;
  fingerprint: string;
}

export interface PostingIndexItem extends Pick<
  Posting,
  | "id"
  | "companyId"
  | "jobSequence"
  | "company"
  | "title"
  | "roleFamily"
  | "cities"
  | "publishedAt"
  | "deadlineAt"
  | "jdParseStatus"
  | "verificationStatus"
  | "personalScore"
  | "landingProbability"
  | "scoreRecommendation"
  | "effectiveDisposition"
> {
  internAssessmentPenalty: boolean;
  ineligibilityNote?: string;
}

export interface SourceHealth {
  id: number;
  name: string;
  type: string;
  url: string;
  trust: SourceTrust;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastStatus: "idle" | "ok" | "error";
  lastError: string | null;
}

export interface CrawlRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  cursorFrom: string;
  status: "running" | "success" | "partial" | "failed";
  discovered: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface PostingFilters {
  q?: string;
  city?: string;
  roleFamily?: string;
  workflowState?: WorkflowState;
  sourceTrust?: SourceTrust;
  status?: PostingStatus;
  verification?: "verified" | "pending";
  disposition?: EffectiveDisposition["bucket"] | "all";
  companyId?: number;
}

export interface RefreshResult {
  run: CrawlRun;
  lastSuccessfulRefreshAt: string | null;
}

export interface ParsedPostingInput {
  sourceJobId?: string | null;
  company: string;
  title: string;
  cities: string[];
  cohort: string | null;
  employmentType: Posting["employmentType"];
  publishedAt: string | null;
  deadlineAt: string | null;
  jdText: string;
  jdParseStatus?: JdParseStatus;
  jdSourceUrl?: string | null;
  jdParsedAt?: string | null;
  sourceUrl: string;
  officialUrl?: string | null;
  applyUrl?: string | null;
  applicationAvailable?: boolean | null;
  sourceName: string;
  sourceTrust: SourceTrust;
}

export interface ApplicationEvent {
  id: number;
  applicationId: number;
  stage: ApplicationStage;
  round: number | null;
  occurredAt: string;
  note: string;
  createdAt: string;
}

export interface ResumeBullet { lead: string; text: string }
export interface ResumeEntry {
  organization: string;
  role: string;
  date: string;
  projects: Array<{ name: string; bullets: ResumeBullet[] }>;
}
export interface ResumeDraft {
  revision: number;
  accentHex: string;
  name: string;
  phone: string;
  email: string;
  intention: string;
  technology: string;
  education: Array<{ school: string; detail: string; date: string }>;
  experiences: ResumeEntry[];
  projects: ResumeEntry[];
  skills: Array<{ label: string; text: string }>;
  covered: string[];
  gaps: string[];
}

export interface Application {
  id: number;
  postingId: number | null;
  companyId: number | null;
  sequence: number;
  folderName: string;
  folderPath: string;
  company: string;
  title: string;
  cities: string[];
  jdText: string;
  sourceUrl: string | null;
  applyUrl: string | null;
  currentStage: ApplicationStage;
  currentRound: number | null;
  note: string;
  resumeStatus: ResumeStatus;
  resumeUpdatedAt: string | null;
  resumeStale: boolean;
  resumeDraft: ResumeDraft | null;
  personalScore: number;
  landingProbability: number;
  scoreBreakdown: PersonalScoreBreakdown;
  scoreOverrides: PersonalScoreOverrides;
  scoreReasons: string[];
  scoreRecommendation: ScoreRecommendation;
  scoreVersion: number;
  manualDisposition: ManualDisposition | null;
  manualDispositionAt: string | null;
  manualDispositionReason: string | null;
  effectiveDisposition: EffectiveDisposition;
  createdAt: string;
  updatedAt: string;
  events: ApplicationEvent[];
}

export interface CompanyLink {
  id: number;
  companyId: number | null;
  company: string;
  sourceUrl: string | null;
  applyUrl: string;
  reason: string;
  status: "pending" | "resolved" | "ignored";
  createdAt: string;
  updatedAt: string;
}

export interface CompanySource {
  id: number;
  companyId: number;
  url: string;
  sourceKind: CompanySourceKind;
  label: string;
  parseStatus: CompanySourceParseStatus;
  parseError: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
}

export interface CompanyApplicationRule {
  id: number;
  companyId: number;
  campaign: string;
  maxApplications: number | null;
  ruleText: string;
  sourceUrl: string | null;
  verifiedAt: string | null;
  extractionStatus: ApplicationRuleExtractionStatus;
  manualOverride: boolean;
}

export interface CompanySummary {
  id: number;
  canonicalName: string;
  aliases: string[];
  totalJobs: number;
  unprocessedJobs: number;
  unprocessedWorthwhileJobs: number;
  trashJobs: number;
  applicationRule: CompanyApplicationRule | null;
}

export interface CompanyDetail extends CompanySummary {
  postings: Posting[];
  sources: CompanySource[];
}

export interface TrashCompanySummary {
  key: string;
  companyId: number | null;
  company: string;
  postingCount: number;
  applicationCount: number;
  itemCount: number;
}

export interface TrashCompanyPage {
  companies: TrashCompanySummary[];
  totalCompanies: number;
  totalItems: number;
  offset: number;
  limit: number;
}

export interface SpreadsheetImportRun {
  id: number;
  filePath: string;
  fileName: string;
  fileHash: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "partial" | "failed";
  rowsRead: number;
  postingsFound: number;
  postingsImported: number;
  linksImported: number;
  skipped: number;
  errors: string[];
}

export interface SourceArchiveCoverage {
  totalRows: number;
  currentRows: number;
  staleRows: number;
  postingRows: number;
  companyLinkRows: number;
  policyExcludedRows: number;
  unresolvedRows: number;
  unarchivedRows: number;
  currentUnarchivedRows: number;
}

export interface ResumeGenerationJob {
  id: number;
  applicationId: number;
  kind: ResumeJobKind;
  status: ResumeJobStatus;
  feedback: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export const START_AT = process.env.AUTUMN_ASSISTANT_MONITOR_START || "1970-01-01T00:00:00.000Z";
