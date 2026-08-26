import { eq } from "drizzle-orm";

import { upsertCompanyApplicationRule } from "@/lib/companies/repository";
import { registerCompanySource } from "@/lib/companies/store";
import { db } from "@/lib/db/client";
import { applications, companies, companySources, postings } from "@/lib/db/schema";
import { upsertPosting } from "@/lib/db/repository";
import { pruneExpiredRecruitmentData } from "@/lib/db/expiry";
import { fetchHtml } from "@/lib/collectors/http";
import { collectHotjobCompany, hotjobCampusUrl, hotjobSuiteId } from "@/lib/recruitment-parsers/hotjob";
import { evaluatePosting } from "@/lib/scoring";

export interface CompanySourceRefreshResult {
  companies: number;
  discovered: number;
  inserted: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

export async function refreshSupportedCompanySources(companyId?: number): Promise<CompanySourceRefreshResult> {
  pruneExpiredRecruitmentData();
  const postingCompanyIds = new Set(db.select({ companyId: postings.companyId }).from(postings).all().flatMap((row) => row.companyId ? [row.companyId] : []));
  const applicationCompanyIds = new Set(db.select({ companyId: applications.companyId }).from(applications).all().flatMap((row) => row.companyId ? [row.companyId] : []));
  const companyRows = (companyId === undefined
    ? db.select().from(companies).all()
    : db.select().from(companies).where(eq(companies.id, companyId)).all())
    .filter((company) => postingCompanyIds.has(company.id) || !applicationCompanyIds.has(company.id));
  const supported = new Map<string, { companyId: number; companyName: string; sourceUrl: string; suiteId: string }>();
  for (const company of companyRows) {
    const sources = db.select().from(companySources).where(eq(companySources.companyId, company.id)).all();
    for (const source of sources) {
      let resolvedUrl = source.url;
      let suiteId = hotjobSuiteId(resolvedUrl);
      if (!suiteId && source.parseStatus === "pending" && (source.sourceKind === "apply" || source.sourceKind === "job_list")) {
        const checkedAt = new Date().toISOString();
        try {
          const fetched = await fetchHtml(source.url, { timeoutMs: 10_000 });
          resolvedUrl = fetched.finalUrl;
          suiteId = hotjobSuiteId(resolvedUrl);
          registerCompanySource({
            companyId: company.id, url: source.url, sourceKind: source.sourceKind as "apply" | "job_list",
            label: source.label, parseStatus: suiteId ? "parsed" : "not_supported", lastCheckedAt: checkedAt,
            lastSuccessAt: suiteId ? checkedAt : null,
          });
          if (suiteId) registerCompanySource({
            companyId: company.id, url: resolvedUrl, sourceKind: "job_list", label: "重定向后的官方招聘页",
            parseStatus: "pending", lastCheckedAt: checkedAt,
          });
        } catch (error) {
          registerCompanySource({
            companyId: company.id, url: source.url, sourceKind: source.sourceKind as "apply" | "job_list",
            label: source.label, parseStatus: "failed", parseError: error instanceof Error ? error.message : String(error), lastCheckedAt: checkedAt,
          });
        }
      }
      if (suiteId) supported.set(`${company.id}:${suiteId}`, {
        companyId: company.id, companyName: company.canonicalName, sourceUrl: resolvedUrl, suiteId,
      });
    }
  }

  let discovered = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const warnings: string[] = [];
  for (const target of supported.values()) {
    const checkedAt = new Date().toISOString();
    try {
      const result = await collectHotjobCompany({ companyName: target.companyName, sourceUrl: target.sourceUrl });
      discovered += result.discovered;
      for (const input of result.postings) {
        const saved = upsertPosting(evaluatePosting(input));
        if (saved.action === "inserted") inserted += 1;
        else if (saved.action === "updated") updated += 1;
        else skipped += 1;
      }
      registerCompanySource({
        companyId: target.companyId,
        url: hotjobCampusUrl(target.suiteId),
        sourceKind: "job_list",
        label: "官方校园招聘岗位列表",
        parseStatus: "parsed",
        parseError: result.warnings.length ? result.warnings.join("\n").slice(0, 4000) : null,
        lastCheckedAt: checkedAt,
        lastSuccessAt: checkedAt,
      });
      if (result.rulesPageChecked) {
        upsertCompanyApplicationRule({
          companyId: target.companyId,
          campaign: "current",
          maxApplications: result.applicationLimit?.maxApplications ?? null,
          ruleText: result.applicationLimit?.evidence ?? "官方招聘页面未说明最多可投递岗位数量。",
          sourceUrl: result.campusUrl,
          verifiedAt: checkedAt,
          extractionStatus: result.applicationLimit ? "verified" : "not_stated",
        });
        registerCompanySource({
          companyId: target.companyId,
          url: result.campusUrl,
          sourceKind: "rules",
          label: "官方投递规则来源",
          parseStatus: "parsed",
          lastCheckedAt: checkedAt,
          lastSuccessAt: checkedAt,
        });
      }
      warnings.push(...result.warnings.map((warning) => `${target.companyName}：${warning}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${target.companyName}：${message}`);
      registerCompanySource({
        companyId: target.companyId,
        url: hotjobCampusUrl(target.suiteId),
        sourceKind: "job_list",
        label: "官方校园招聘岗位列表",
        parseStatus: "failed",
        parseError: message.slice(0, 4000),
        lastCheckedAt: checkedAt,
      });
    }
  }
  return { companies: supported.size, discovered, inserted, updated, skipped, warnings };
}
