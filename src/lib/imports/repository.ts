import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { ensureCompany, registerCompanySource } from "@/lib/companies/store";
import { applications, companyLinks, postings, spreadsheetImportRuns } from "@/lib/db/schema";
import type { CompanyLink, SpreadsheetImportRun } from "@/lib/types";

function parseErrors(value: string): string[] {
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}

function toLink(row: typeof companyLinks.$inferSelect): CompanyLink {
  return { ...row, status: row.status === "resolved" || row.status === "ignored" ? row.status : "pending" };
}

function toRun(row: typeof spreadsheetImportRuns.$inferSelect): SpreadsheetImportRun {
  return {
    ...row,
    status: row.status === "success" || row.status === "partial" || row.status === "failed" ? row.status : "running",
    errors: parseErrors(row.errorsJson),
  };
}

export function listCompanyLinks(): CompanyLink[] {
  return db.select().from(companyLinks).orderBy(desc(companyLinks.updatedAt)).all().map(toLink);
}

export function upsertCompanyLink(input: { company: string; sourceUrl: string | null; applyUrl: string; reason: string }): { link: CompanyLink; inserted: boolean } {
  const company = ensureCompany(input.company);
  const existing = db.select().from(companyLinks).where(eq(companyLinks.applyUrl, input.applyUrl)).get();
  const now = new Date().toISOString();
  if (existing) {
    const row = db.update(companyLinks).set({ companyId: company.id, company: company.canonicalName, sourceUrl: input.sourceUrl, reason: input.reason, updatedAt: now }).where(eq(companyLinks.id, existing.id)).returning().get();
    registerCompanySource({ companyId: company.id, url: input.sourceUrl, sourceKind: "announcement", label: "招聘信息来源" });
    registerCompanySource({ companyId: company.id, url: input.applyUrl, sourceKind: "apply", label: "投递链接" });
    return { link: toLink(row), inserted: false };
  }
  const row = db.insert(companyLinks).values({ ...input, companyId: company.id, company: company.canonicalName, status: "pending", createdAt: now, updatedAt: now }).returning().get();
  registerCompanySource({ companyId: company.id, url: input.sourceUrl, sourceKind: "announcement", label: "招聘信息来源" });
  registerCompanySource({ companyId: company.id, url: input.applyUrl, sourceKind: "apply", label: "投递链接" });
  return { link: toLink(row), inserted: true };
}

export function updateCompanyLink(id: number, status: CompanyLink["status"]): CompanyLink | null {
  const row = db.update(companyLinks).set({ status, updatedAt: new Date().toISOString() }).where(eq(companyLinks.id, id)).returning().get();
  return row ? toLink(row) : null;
}

export function createSpreadsheetRun(input: { filePath: string; fileName: string; fileHash: string }): SpreadsheetImportRun {
  return toRun(db.insert(spreadsheetImportRuns).values({ ...input, startedAt: new Date().toISOString(), errorsJson: "[]" }).returning().get());
}

export function finishSpreadsheetRun(id: number, patch: Omit<SpreadsheetImportRun, "id" | "filePath" | "fileName" | "fileHash" | "startedAt" | "finishedAt">): SpreadsheetImportRun {
  const row = db.update(spreadsheetImportRuns).set({
    status: patch.status,
    finishedAt: new Date().toISOString(),
    rowsRead: patch.rowsRead,
    postingsFound: patch.postingsFound,
    postingsImported: patch.postingsImported,
    linksImported: patch.linksImported,
    skipped: patch.skipped,
    errorsJson: JSON.stringify(patch.errors),
  }).where(eq(spreadsheetImportRuns.id, id)).returning().get();
  if (!row) throw new Error(`导入记录 ${id} 不存在`);
  return toRun(row);
}

export function listSpreadsheetRuns(): SpreadsheetImportRun[] {
  return db.select().from(spreadsheetImportRuns).orderBy(desc(spreadsheetImportRuns.id)).limit(20).all().map(toRun);
}

export function getLatestSpreadsheetRun(): SpreadsheetImportRun | null {
  const row = db.select().from(spreadsheetImportRuns).orderBy(desc(spreadsheetImportRuns.id)).limit(1).get();
  return row ? toRun(row) : null;
}

export function reconcilePendingCompanyLinks(activeApplyUrls: Set<string>): number {
  const pending = db.select().from(companyLinks).where(eq(companyLinks.status, "pending")).all();
  let removed = 0;
  for (const row of pending) {
    if (!activeApplyUrls.has(row.applyUrl)) {
      db.delete(companyLinks).where(eq(companyLinks.id, row.id)).run();
      removed += 1;
    }
  }
  return removed;
}

export function reconcileSpreadsheetPostings(fileName: string, activeFingerprints: Set<string>): number {
  const sourceName = `校招信息汇总表 · ${fileName}`;
  const candidates = db.select().from(postings).where(eq(postings.sourceName, sourceName)).all();
  let removed = 0;
  for (const row of candidates) {
    if (activeFingerprints.has(row.fingerprint) || row.workflowState !== "new") continue;
    const managed = db.select({ id: applications.id }).from(applications).where(eq(applications.postingId, row.id)).get();
    if (!managed) {
      db.delete(postings).where(eq(postings.id, row.id)).run();
      removed += 1;
    }
  }
  return removed;
}
