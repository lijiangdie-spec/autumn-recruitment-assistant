import { NextResponse } from "next/server";

import { listCompanyLinks } from "@/lib/imports/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ links: listCompanyLinks() }, { headers: { "Cache-Control": "no-store" } });
}
