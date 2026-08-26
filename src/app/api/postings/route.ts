import { NextRequest, NextResponse } from "next/server";

import { getLastSuccessfulRefreshAt, getPostingIndex, getPostings } from "@/lib/db/repository";
import type {
  PostingFilters,
  PostingStatus,
  SourceTrust,
  WorkflowState,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKFLOW_VALUES = new Set<WorkflowState>(["new", "saved", "preparing", "skipped"]);
const TRUST_VALUES = new Set<SourceTrust>(["official", "university", "aggregator", "manual"]);
const STATUS_VALUES = new Set<PostingStatus>(["open", "closed", "unknown"]);
const VERIFICATION_VALUES = new Set(["verified", "pending"] as const);
const DISPOSITION_VALUES = new Set(["active", "trash", "all"] as const);

function readEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: ReadonlySet<T>,
): T | undefined {
  const value = params.get(key);
  return value && allowed.has(value as T) ? (value as T) : undefined;
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const filters: PostingFilters = {
    q: params.get("q") || undefined,
    city: params.get("city") || undefined,
    roleFamily: params.get("roleFamily") || undefined,
    workflowState: readEnum(params, "workflowState", WORKFLOW_VALUES),
    sourceTrust: readEnum(params, "sourceTrust", TRUST_VALUES),
    status: readEnum(params, "status", STATUS_VALUES),
    verification: readEnum(params, "verification", VERIFICATION_VALUES),
    disposition: readEnum(params, "disposition", DISPOSITION_VALUES),
    companyId: /^\d+$/.test(params.get("companyId") ?? "") ? Number(params.get("companyId")) : undefined,
  };
  const postings = params.get("view") === "index"
    ? getPostingIndex(filters)
    : getPostings(filters);

  return NextResponse.json(
    {
      postings,
      total: postings.length,
      lastSuccessfulRefreshAt: getLastSuccessfulRefreshAt(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
