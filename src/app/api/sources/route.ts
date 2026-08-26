import { NextResponse } from "next/server";

import { getSources } from "@/lib/db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { sources: getSources() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
