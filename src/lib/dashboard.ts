import type { Application, Posting, VerificationStatus } from "@/lib/types";

export interface CompanyRecord {
  companyId: number | null;
  company: string;
}

export interface DashboardPostingRecord extends CompanyRecord {
  verificationStatus: VerificationStatus;
}

export interface DashboardStats {
  archivedCompanies: number;
  archivedPostings: number;
  pendingCompanies: number;
  pendingPostings: number;
}

export interface CompanyGroup<T extends CompanyRecord> {
  key: string;
  companyId: number | null;
  company: string;
  records: T[];
}

export function canAddPostingToApplicationBoard(
  posting: Pick<Posting, "scoreRecommendation" | "effectiveDisposition">,
): boolean {
  return posting.effectiveDisposition.bucket === "active";
}

export function applicationApplyUrl(application: Pick<Application, "applyUrl">): string | null {
  return application.applyUrl?.trim() || null;
}

export function companyRecordKey(record: CompanyRecord): string {
  return record.companyId ? `id:${record.companyId}` : `name:${record.company.trim()}`;
}

export function groupByCompany<T extends CompanyRecord>(records: readonly T[]): Array<CompanyGroup<T>> {
  const groups = new Map<string, CompanyGroup<T>>();
  for (const record of records) {
    const key = companyRecordKey(record);
    const current = groups.get(key);
    if (current) {
      current.records.push(record);
      continue;
    }
    groups.set(key, {
      key,
      companyId: record.companyId,
      company: record.company,
      records: [record],
    });
  }
  return [...groups.values()];
}

export function sortCompanyGroupsByTopPosting<
  T extends CompanyRecord & { personalScore: number; publishedAt: string | null },
>(groups: readonly CompanyGroup<T>[]): Array<CompanyGroup<T>> {
  const priority = (group: CompanyGroup<T>) => {
    const topScore = Math.max(...group.records.map((record) => record.personalScore));
    const topPublishedAt = group.records
      .filter((record) => record.personalScore === topScore)
      .map((record) => record.publishedAt ? Date.parse(record.publishedAt) : Number.NaN)
      .filter(Number.isFinite);
    return {
      topScore,
      earliestTopPublishedAt: topPublishedAt.length > 0 ? Math.min(...topPublishedAt) : Number.POSITIVE_INFINITY,
    };
  };

  return [...groups].sort((left, right) => {
    const leftPriority = priority(left);
    const rightPriority = priority(right);
    return rightPriority.topScore - leftPriority.topScore
      || leftPriority.earliestTopPublishedAt - rightPriority.earliestTopPublishedAt
      || left.company.localeCompare(right.company, "zh-CN")
      || left.key.localeCompare(right.key);
  });
}

export function getDashboardStats(postings: readonly DashboardPostingRecord[]): DashboardStats {
  const pending = postings.filter((posting) => posting.verificationStatus !== "verified");
  return {
    archivedCompanies: new Set(postings.map(companyRecordKey)).size,
    archivedPostings: postings.length,
    pendingCompanies: new Set(pending.map(companyRecordKey)).size,
    pendingPostings: pending.length,
  };
}
