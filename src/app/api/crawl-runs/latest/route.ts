import { NextResponse } from "next/server";

import { getLatestCrawlRun } from "@/lib/db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { run: getLatestCrawlRun() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
