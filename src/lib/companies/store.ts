import { and, eq } from "drizzle-orm";

import { canonicalCompanyName, normalizeCompanyKey } from "@/lib/companies/normalize";
import { db } from "@/lib/db/client";
import { companies, companySources } from "@/lib/db/schema";
import type { CompanySourceKind, CompanySourceParseStatus } from "@/lib/types";

function parseAliases(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function ensureCompany(rawName: string): typeof companies.$inferSelect {
  const trimmed = rawName.trim();
  if (!trimmed) throw new Error("公司名称不能为空");
  const canonicalName = canonicalCompanyName(trimmed);
  const normalizedKey = normalizeCompanyKey(canonicalName);
  const now = new Date().toISOString();
  let company = db.select().from(companies).where(eq(companies.normalizedKey, normalizedKey)).get();
  if (!company) {
    company = db.insert(companies).values({
      canonicalName,
      normalizedKey,
      aliasesJson: JSON.stringify(trimmed === canonicalName ? [] : [trimmed]),
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().returning().get()
      ?? db.select().from(companies).where(eq(companies.normalizedKey, normalizedKey)).get();
  }
  if (!company) throw new Error(`无法登记公司：${canonicalName}`);
  const aliases = parseAliases(company.aliasesJson);
  if (trimmed !== canonicalName && !aliases.includes(trimmed)) {
    aliases.push(trimmed);
    company = db.update(companies).set({ aliasesJson: JSON.stringify(aliases), updatedAt: now })
      .where(eq(companies.id, company.id)).returning().get() ?? company;
  }
  return company;
}

export function registerCompanySource(input: {
  companyId: number;
  url: string | null | undefined;
  sourceKind: CompanySourceKind;
  label?: string;
  parseStatus?: CompanySourceParseStatus;
  parseError?: string | null;
  lastCheckedAt?: string | null;
  lastSuccessAt?: string | null;
}): void {
  const url = input.url?.trim();
  if (!url) return;
  const now = new Date().toISOString();
  const existing = db.select().from(companySources).where(and(
    eq(companySources.companyId, input.companyId),
    eq(companySources.url, url),
  )).get();
  if (existing) {
    db.update(companySources).set({
      sourceKind: existing.sourceKind === "unknown" ? input.sourceKind : existing.sourceKind,
      label: existing.label || input.label || "",
      parseStatus: input.parseStatus ?? existing.parseStatus,
      parseError: input.parseError === undefined ? existing.parseError : input.parseError,
      lastCheckedAt: input.lastCheckedAt === undefined ? existing.lastCheckedAt : input.lastCheckedAt,
      lastSuccessAt: input.lastSuccessAt === undefined ? existing.lastSuccessAt : input.lastSuccessAt,
      updatedAt: now,
    }).where(eq(companySources.id, existing.id)).run();
    return;
  }
  db.insert(companySources).values({
    companyId: input.companyId,
    url,
    sourceKind: input.sourceKind,
    label: input.label ?? "",
    parseStatus: input.parseStatus ?? "pending",
    parseError: input.parseError ?? null,
    lastCheckedAt: input.lastCheckedAt ?? null,
    lastSuccessAt: input.lastSuccessAt ?? null,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().run();
}
