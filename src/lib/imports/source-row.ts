import { extractCohort, inferEmploymentType } from "@/lib/filters";
import { isExpiredDeadline } from "@/lib/deadline";
import { isPureInternshipPosition } from "@/lib/job-signals";
import { evaluateSpreadsheetRow, type SpreadsheetRowInput } from "@/lib/imports/profile";
import { evaluatePosting } from "@/lib/scoring";
import type { NormalizedSheetRow } from "@/lib/qqdocs/types";

export interface SourceRowEvaluation {
  outcome: "postings" | "company_link" | "policy_excluded" | "unresolved";
  recognizedCandidates: Array<ReturnType<typeof evaluatePosting>>;
  candidates: Array<ReturnType<typeof evaluatePosting>>;
  policyExcludedCandidates: Array<ReturnType<typeof evaluatePosting>>;
  companyLink: {
    company: string;
    sourceUrl: string | null;
    applyUrl: string;
    reason: string;
  } | null;
  ineligible: boolean;
  reason: string;
}

export type SourceRowCompanyLink = NonNullable<SourceRowEvaluation["companyLink"]>;

function deadlineIso(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || /暂无|待定|尽快|招满/i.test(normalized)) return null;
  const chinese = normalized.match(/(?:(20\d{2})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (chinese) {
    const year = Number(chinese[1] ?? 2026);
    const month = Number(chinese[2]);
    const day = Number(chinese[3]);
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}T23:59:59+08:00`;
  }
  const date = normalized.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  return date
    ? `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}T23:59:59+08:00`
    : null;
}

export function evaluateQqDocsSourceRow(row: NormalizedSheetRow, sourceName: string): SourceRowEvaluation {
  const spreadsheetRow: SpreadsheetRowInput = {
    company: row.company,
    companyType: row.companyType,
    industry: row.industry,
    roles: row.roles,
    cities: row.cities,
    aiDetail: row.aiDetail,
    cohort: row.cohort,
    degree: row.degree,
    category: row.category,
  };
  const decision = evaluateSpreadsheetRow(spreadsheetRow);
  const context = [row.category, row.cohort, row.roles, row.aiDetail].join("\n");
  const rowIsPureInternship = decision.roleTitles.length === 0 && isPureInternshipPosition(row.roles, context);
  const sourceUrl = row.sourceUrl ?? row.applyUrl;
  const allRecognizedCandidates = sourceUrl ? decision.roleTitles.map((title) => evaluatePosting({
    company: row.company,
    title,
    cities: decision.cities,
    cohort: extractCohort(row.cohort),
    employmentType: inferEmploymentType(`${row.category}\n${row.cohort}\n${title}\n${row.aiDetail}`),
    publishedAt: `${row.sourceDate}T00:00:00+08:00`,
    deadlineAt: deadlineIso(row.deadline),
    jdText: [
      `公司：${row.company}`,
      `岗位：${title}`,
      `城市：${row.cities || "待核验"}`,
      `届次：${row.cohort || "待核验"}`,
      `招聘类别：${row.category || "待核验"}`,
      `学历：${row.degree || "待核验"}`,
      row.aiDetail ? `汇总表岗位信息：\n${row.aiDetail}` : "具体 JD 待从公开投递页核验。",
    ].join("\n"),
    jdParseStatus: row.aiDetail ? "partial" : "missing",
    sourceUrl,
    officialUrl: row.sourceUrl,
    applyUrl: row.applyUrl,
    sourceName,
    sourceTrust: "aggregator",
  })) : [];
  const recognizedCandidates = allRecognizedCandidates.filter((candidate) => !isExpiredDeadline(candidate.deadlineAt));
  // Reuse the posting hard-filter decision: it combines the per-title employment
  // type with the campus internship-assessment exception and therefore keeps mixed
  // source rows from excluding all sibling titles.
  const policyExcludedCandidates = recognizedCandidates.filter((candidate) => (
    candidate.hardRejectReasons.includes("仅保留校园招聘，不收录实习岗位")
  ));
  const policyExcludedFingerprints = new Set(policyExcludedCandidates.map((candidate) => candidate.fingerprint));
  const candidates = recognizedCandidates.filter((candidate) => !policyExcludedFingerprints.has(candidate.fingerprint));

  if (allRecognizedCandidates.length > 0 && recognizedCandidates.length === 0) {
    return {
      outcome: "policy_excluded",
      recognizedCandidates: [],
      candidates: [],
      policyExcludedCandidates: [],
      companyLink: null,
      ineligible: false,
      reason: "岗位截止时间已过，按过期清理策略排除",
    };
  }

  if (candidates.length > 0) {
    return {
      outcome: "postings",
      recognizedCandidates,
      candidates,
      policyExcludedCandidates,
      companyLink: null,
      ineligible: policyExcludedCandidates.length > 0,
      reason: policyExcludedCandidates.length > 0
        ? `${decision.reason}；另有 ${policyExcludedCandidates.length} 个纯实习岗位按策略排除`
        : decision.reason,
    };
  }
  if (policyExcludedCandidates.length > 0 || rowIsPureInternship) {
    return {
      outcome: "policy_excluded",
      recognizedCandidates,
      candidates: [],
      policyExcludedCandidates,
      companyLink: null,
      ineligible: true,
      reason: "纯实习岗位按“只保留校招”策略排除",
    };
  }
  if (decision.shouldCreateCompanyLink && sourceUrl) {
    return {
      outcome: "company_link",
      recognizedCandidates: [],
      candidates: [],
      policyExcludedCandidates: [],
      companyLink: {
        company: row.company,
        sourceUrl: row.sourceUrl,
        applyUrl: row.applyUrl ?? row.sourceUrl!,
        reason: decision.reason,
      },
      ineligible: false,
      reason: decision.reason,
    };
  }
  return {
    outcome: "unresolved",
    recognizedCandidates,
    candidates: [],
    policyExcludedCandidates: [],
    companyLink: null,
    ineligible: false,
    reason: sourceUrl ? decision.reason : "缺少公告或投递链接",
  };
}
