import { and, eq, ne } from "drizzle-orm";

import { listApplications } from "@/lib/applications/repository";
import { db } from "@/lib/db/client";
import { applications, postings } from "@/lib/db/schema";
import { getPostings } from "@/lib/db/repository";
import type { Application, Posting, TrashCompanyPage, TrashCompanySummary } from "@/lib/types";

function recordKey(record: { companyId: number | null; company: string }): string {
  return record.companyId ? `id:${record.companyId}` : `name:${record.company.trim()}`;
}

function buildTrashCompanies(): TrashCompanySummary[] {
  const postingRows = db.select({
    companyId: postings.companyId,
    company: postings.company,
  }).from(postings).where(and(
    eq(postings.manualDisposition, "trash"),
    ne(postings.employmentType, "internship"),
  )).all();
  const applicationRows = db.select({
    companyId: applications.companyId,
    company: applications.company,
  }).from(applications).where(eq(applications.manualDisposition, "trash")).all();
  const groups = new Map<string, TrashCompanySummary>();

  for (const row of postingRows) {
    const key = recordKey(row);
    const current = groups.get(key) ?? {
      key, companyId: row.companyId, company: row.company,
      postingCount: 0, applicationCount: 0, itemCount: 0,
    };
    current.postingCount += 1;
    current.itemCount += 1;
    groups.set(key, current);
  }
  for (const row of applicationRows) {
    const key = recordKey(row);
    const current = groups.get(key) ?? {
      key, companyId: row.companyId, company: row.company,
      postingCount: 0, applicationCount: 0, itemCount: 0,
    };
    current.applicationCount += 1;
    current.itemCount += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((left, right) =>
    left.company.localeCompare(right.company, "zh-CN") || left.key.localeCompare(right.key));
}

export function getTrashCount(): { totalCompanies: number; totalItems: number } {
  const companies = buildTrashCompanies();
  return {
    totalCompanies: companies.length,
    totalItems: companies.reduce((total, company) => total + company.itemCount, 0),
  };
}

export function getTrashCompanyPage(offset: number, limit: number): TrashCompanyPage {
  const companies = buildTrashCompanies();
  return {
    companies: companies.slice(offset, offset + limit),
    totalCompanies: companies.length,
    totalItems: companies.reduce((total, company) => total + company.itemCount, 0),
    offset,
    limit,
  };
}

export function getTrashCompanyDetail(selector: { companyId?: number; company?: string }): {
  postings: Posting[];
  applications: Application[];
} {
  const trashPostings = selector.companyId !== undefined
    ? getPostings({ disposition: "trash", companyId: selector.companyId })
    : getPostings({ disposition: "trash" }).filter((posting) => posting.company === selector.company);
  return {
    postings: trashPostings,
    applications: listApplications("trash", selector),
  };
}
