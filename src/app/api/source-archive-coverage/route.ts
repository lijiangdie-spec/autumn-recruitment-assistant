import { NextResponse } from "next/server";

import { getQqDocsArchiveCoverage } from "@/lib/qqdocs/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { coverage: getQqDocsArchiveCoverage() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
