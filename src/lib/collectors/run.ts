import {
  createCrawlRun,
  finishCrawlRun,
  getLastSuccessfulRefreshAt,
  getSources,
  setAppState,
  updateSourceHealth,
  upsertPosting,
} from "@/lib/db/repository";
import { overlapCursor } from "@/lib/collectors/dates";
import { collectEximSource, EXIM_SOURCE } from "@/lib/collectors/exim";
import { collectGuangfaSource, GUANGFA_SOURCE } from "@/lib/collectors/guangfa";
import { collectNiuqiSource, NIUQI_SOURCES } from "@/lib/collectors/niuqi";
import { collectWanjiaSource, WANJIA_SOURCE } from "@/lib/collectors/wanjia";
import type { CollectorResult, CollectorSource } from "@/lib/collectors/types";
import { evaluatePosting } from "@/lib/scoring";
import { pruneExpiredRecruitmentData } from "@/lib/db/expiry";
import { refreshSupportedCompanySources } from "@/lib/recruitment-parsers/run";
import { START_AT, type CrawlRun, type RefreshResult } from "@/lib/types";

type RefreshLock = typeof globalThis & { recruitmentRefreshPromise?: Promise<RefreshResult> };
type RegisteredCollector = {
  source: CollectorSource;
  collect: (cursorFrom: string) => Promise<CollectorResult>;
};

const COLLECTORS: RegisteredCollector[] = [
  {
    source: WANJIA_SOURCE,
    // This official endpoint is a small current-openings snapshot. Read all of
    // it on every run; URL/content fingerprints make the refresh idempotent.
    collect: () => collectWanjiaSource(WANJIA_SOURCE),
  },
  {
    source: GUANGFA_SOURCE,
    collect: () => collectGuangfaSource(GUANGFA_SOURCE),
  },
  {
    source: EXIM_SOURCE,
    collect: () => collectEximSource(EXIM_SOURCE),
  },
  ...NIUQI_SOURCES.map((source) => ({
    source,
    collect: (cursorFrom: string) => collectNiuqiSource(source, cursorFrom),
  })),
];

async function performRefresh(): Promise<RefreshResult> {
  pruneExpiredRecruitmentData();
  const previousSuccessfulRefresh = getLastSuccessfulRefreshAt();
  const cursorFrom = overlapCursor(previousSuccessfulRefresh, START_AT);
  const initialRun = createCrawlRun(cursorFrom);
  const configuredSources = getSources();
  const enabledCollectors = COLLECTORS.filter((collector) => {
    const health = configuredSources.find((source) => source.url === collector.source.url);
    return health?.enabled !== false;
  });

  let discovered = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let succeededSources = 0;
  const errors: string[] = [];

  for (const collector of enabledCollectors) {
    const source = collector.source;
    const sourceHealth = configuredSources.find((configured) => configured.url === source.url);
    const checkedAt = new Date().toISOString();
    try {
      const collected = await collector.collect(cursorFrom);
      discovered += collected.discovered;
      for (const input of collected.postings) {
        const evaluated = evaluatePosting(input);
        const result = upsertPosting(evaluated, sourceHealth?.id);
        // Keep filtered records for audit/deduplication, but count them as
        // skipped so the UI never claims an invisible record is a new chance.
        if (evaluated.hardRejectReasons.length > 0) skipped += 1;
        else if (result.action === "inserted") inserted += 1;
        else if (result.action === "updated") updated += 1;
        else skipped += 1;
      }
      succeededSources += 1;
      errors.push(...collected.warnings.map((warning) => `${source.name}（详情警告）：${warning}`));
      updateSourceHealth(source.url, {
        lastCheckedAt: checkedAt,
        lastStatus: "ok",
        lastError: collected.warnings.length > 0 ? collected.warnings.join("\n").slice(0, 4000) : null,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(`${source.name}：${detail}`);
      updateSourceHealth(source.url, {
        lastCheckedAt: checkedAt,
        lastStatus: "error",
        lastError: detail.slice(0, 4000),
      });
    }
  }

  try {
    const companyRefresh = await refreshSupportedCompanySources();
    discovered += companyRefresh.discovered;
    inserted += companyRefresh.inserted;
    updated += companyRefresh.updated;
    skipped += companyRefresh.skipped;
    errors.push(...companyRefresh.warnings.map((warning) => `公司岗位解析：${warning}`));
  } catch (error) {
    errors.push(`公司岗位解析：${error instanceof Error ? error.message : String(error)}`);
  }

  let status: CrawlRun["status"];
  if (enabledCollectors.length > 0 && succeededSources === enabledCollectors.length) status = "success";
  else if (succeededSources > 0) status = "partial";
  else status = "failed";

  const finishedAt = new Date().toISOString();
  const run = finishCrawlRun(initialRun.id, {
    status,
    finishedAt,
    discovered,
    inserted,
    updated,
    skipped,
    errors,
  });

  // A partial run keeps the old cursor so a failed source cannot miss records next time.
  if (status === "success") setAppState("lastSuccessfulRefreshAt", finishedAt);

  return {
    run,
    lastSuccessfulRefreshAt: status === "success" ? finishedAt : previousSuccessfulRefresh,
  };
}

export async function runRefresh(): Promise<RefreshResult> {
  const state = globalThis as RefreshLock;
  if (state.recruitmentRefreshPromise) return state.recruitmentRefreshPromise;
  const promise = performRefresh();
  state.recruitmentRefreshPromise = promise;
  try {
    return await promise;
  } finally {
    if (state.recruitmentRefreshPromise === promise) delete state.recruitmentRefreshPromise;
  }
}
