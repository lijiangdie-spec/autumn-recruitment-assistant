import { NextResponse } from "next/server";

import { getTrashCompanyDetail, getTrashCompanyPage, getTrashCount } from "@/lib/trash/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "count";
  if (view === "count") {
    return NextResponse.json(getTrashCount(), { headers: { "Cache-Control": "no-store" } });
  }
  if (view === "companies") {
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "60");
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 60) {
      return NextResponse.json({ error: "分页参数无效" }, { status: 400 });
    }
    return NextResponse.json(getTrashCompanyPage(offset, limit), { headers: { "Cache-Control": "no-store" } });
  }
  if (view === "detail") {
    const rawCompanyId = url.searchParams.get("companyId");
    const company = url.searchParams.get("company")?.trim();
    if (rawCompanyId && /^\d+$/.test(rawCompanyId)) {
      return NextResponse.json(getTrashCompanyDetail({ companyId: Number(rawCompanyId) }), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (company) {
      return NextResponse.json(getTrashCompanyDetail({ company }), { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "缺少有效企业标识" }, { status: 400 });
  }
  return NextResponse.json({ error: "不支持的垃圾桶视图" }, { status: 400 });
}
