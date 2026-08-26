import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { companies, companyApplicationRules, companySources, postings } from "@/lib/db/schema";
import { getPostings } from "@/lib/db/repository";
import type {
  ApplicationRuleExtractionStatus,
  CompanyApplicationRule,
  CompanyDetail,
  CompanySource,
  CompanySourceKind,
  CompanySourceParseStatus,
  CompanySummary,
} from "@/lib/types";

const SOURCE_KINDS = new Set<CompanySourceKind>(["announcement", "job_list", "job_detail", "apply", "rules", "unknown"]);
const SOURCE_STATUSES = new Set<CompanySourceParseStatus>(["pending", "parsed", "failed", "not_supported"]);
const RULE_STATUSES = new Set<ApplicationRuleExtractionStatus>(["verified", "not_stated", "needs_review"]);

function parseAliases(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toSource(row: typeof companySources.$inferSelect): CompanySource {
  return {
    id: row.id,
    companyId: row.companyId,
    url: row.url,
    sourceKind: SOURCE_KINDS.has(row.sourceKind as CompanySourceKind) ? row.sourceKind as CompanySourceKind : "unknown",
    label: row.label,
    parseStatus: SOURCE_STATUSES.has(row.parseStatus as CompanySourceParseStatus) ? row.parseStatus as CompanySourceParseStatus : "pending",
    parseError: row.parseError,
    lastCheckedAt: row.lastCheckedAt,
    lastSuccessAt: row.lastSuccessAt,
  };
}

function toRule(row: typeof companyApplicationRules.$inferSelect): CompanyApplicationRule {
  return {
    id: row.id,
    companyId: row.companyId,
    campaign: row.campaign,
    maxApplications: row.maxApplications,
    ruleText: row.ruleText,
    sourceUrl: row.sourceUrl,
    verifiedAt: row.verifiedAt,
    extractionStatus: RULE_STATUSES.has(row.extractionStatus as ApplicationRuleExtractionStatus)
      ? row.extractionStatus as ApplicationRuleExtractionStatus : "needs_review",
    manualOverride: row.manualOverride,
  };
}

function currentRule(companyId: number): CompanyApplicationRule | null {
  const row = db.select().from(companyApplicationRules)
    .where(eq(companyApplicationRules.companyId, companyId))
    .orderBy(desc(companyApplicationRules.id)).limit(1).get();
  return row ? toRule(row) : null;
}

function summarizeCompany(
  company: typeof companies.$inferSelect,
  jobs: ReturnType<typeof getPostings>,
): CompanySummary {
  return {
    id: company.id,
    canonicalName: company.canonicalName,
    aliases: parseAliases(company.aliasesJson),
    totalJobs: jobs.length,
    unprocessedJobs: jobs.filter((posting) => posting.effectiveDisposition.bucket === "active").length,
    unprocessedWorthwhileJobs: jobs.filter((posting) =>
      posting.effectiveDisposition.bucket === "active" && posting.scoreRecommendation === "apply",
    ).length,
    trashJobs: jobs.filter((posting) => posting.effectiveDisposition.bucket === "trash").length,
    applicationRule: currentRule(company.id),
  };
}

export function listCompanies(): CompanySummary[] {
  const allPostings = getPostings({ disposition: "all" });
  return db.select().from(companies).all().map((company) => {
    const jobs = allPostings.filter((posting) => posting.companyId === company.id);
    return summarizeCompany(company, jobs);
  }).filter((company) => company.totalJobs > 0).sort((left, right) =>
    right.unprocessedWorthwhileJobs - left.unprocessedWorthwhileJobs
    || right.unprocessedJobs - left.unprocessedJobs
    || left.canonicalName.localeCompare(right.canonicalName, "zh-CN"));
}

export function getCompanyDetail(id: number): CompanyDetail | null {
  const company = db.select().from(companies).where(eq(companies.id, id)).get();
  if (!company) return null;
  const jobs = getPostings({ disposition: "all", companyId: id });
  return {
    ...summarizeCompany(company, jobs),
    postings: jobs,
    sources: db.select().from(companySources).where(eq(companySources.companyId, id)).all().map(toSource),
  };
}

export function updateCompanyDisposition(companyId: number, manualDisposition: "trash" | null): { updated: number } | null {
  return db.transaction((transaction) => {
    const company = transaction.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).get();
    if (!company) return null;
    const dispositionCondition = manualDisposition === "trash"
      ? or(isNull(postings.manualDisposition), ne(postings.manualDisposition, "trash"))
      : eq(postings.manualDisposition, "trash");
    const now = new Date().toISOString();
    const updated = transaction.update(postings).set({
      manualDisposition,
      manualDispositionAt: manualDisposition === "trash" ? now : null,
      manualDispositionReason: manualDisposition === "trash" ? "人工审查完成" : null,
    }).where(and(
      eq(postings.companyId, companyId),
      ne(postings.employmentType, "internship"),
      dispositionCondition,
    )).returning({ id: postings.id }).all();
    return { updated: updated.length };
  });
}

export function updateCompaniesDisposition(
  companyIds: readonly number[],
  manualDisposition: "trash" | null,
): { companiesUpdated: number; postingsUpdated: number; missingCompanyIds: number[] } {
  const uniqueCompanyIds = [...new Set(companyIds)];
  return db.transaction((transaction) => {
    const existingIds = transaction.select({ id: companies.id }).from(companies)
      .where(inArray(companies.id, uniqueCompanyIds)).all().map((company) => company.id);
    const existingIdSet = new Set(existingIds);
    const missingCompanyIds = uniqueCompanyIds.filter((id) => !existingIdSet.has(id));
    if (missingCompanyIds.length > 0) {
      return { companiesUpdated: 0, postingsUpdated: 0, missingCompanyIds };
    }

    const dispositionCondition = manualDisposition === "trash"
      ? or(isNull(postings.manualDisposition), ne(postings.manualDisposition, "trash"))
      : eq(postings.manualDisposition, "trash");
    const now = new Date().toISOString();
    const updated = transaction.update(postings).set({
      manualDisposition,
      manualDispositionAt: manualDisposition === "trash" ? now : null,
      manualDispositionReason: manualDisposition === "trash" ? "人工审查完成" : null,
    }).where(and(
      inArray(postings.companyId, uniqueCompanyIds),
      ne(postings.employmentType, "internship"),
      dispositionCondition,
    )).returning({ companyId: postings.companyId }).all();
    return {
      companiesUpdated: new Set(updated.map((posting) => posting.companyId).filter((id): id is number => id !== null)).size,
      postingsUpdated: updated.length,
      missingCompanyIds: [],
    };
  });
}

export function upsertCompanyApplicationRule(input: {
  companyId: number;
  campaign?: string;
  maxApplications: number | null;
  ruleText: string;
  sourceUrl?: string | null;
  verifiedAt?: string | null;
  extractionStatus: ApplicationRuleExtractionStatus;
  manualOverride?: boolean;
}): CompanyApplicationRule {
  const now = new Date().toISOString();
  const campaign = input.campaign?.trim() || "current";
  const row = db.insert(companyApplicationRules).values({
    companyId: input.companyId,
    campaign,
    maxApplications: input.maxApplications,
    ruleText: input.ruleText.trim(),
    sourceUrl: input.sourceUrl ?? null,
    verifiedAt: input.verifiedAt ?? null,
    extractionStatus: input.extractionStatus,
    manualOverride: input.manualOverride ?? false,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [companyApplicationRules.companyId, companyApplicationRules.campaign],
    set: {
      maxApplications: input.maxApplications,
      ruleText: input.ruleText.trim(),
      sourceUrl: input.sourceUrl ?? null,
      verifiedAt: input.verifiedAt ?? null,
      extractionStatus: input.extractionStatus,
      manualOverride: input.manualOverride ?? false,
      updatedAt: now,
    },
  }).returning().get();
  return toRule(row);
}
