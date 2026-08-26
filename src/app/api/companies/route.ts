import { NextResponse } from "next/server";

import { listCompanies, updateCompaniesDisposition } from "@/lib/companies/repository";
import { isTrustedLocalMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ companies: listCompanies() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!isTrustedLocalMutation(request)) {
    return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是有效 JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "请求体必须是对象" }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;
  if (Object.keys(payload).length !== 2 || payload.manualDisposition !== "trash" || !Array.isArray(payload.companyIds)) {
    return NextResponse.json({ error: "companyIds 和 manualDisposition=trash 为必填项" }, { status: 400 });
  }
  const companyIds = [...new Set(payload.companyIds)];
  if (companyIds.length === 0 || companyIds.length > 2_000
    || companyIds.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0)) {
    return NextResponse.json({ error: "companyIds 必须包含 1 至 2000 个有效企业 ID" }, { status: 400 });
  }

  const result = updateCompaniesDisposition(companyIds as number[], "trash");
  if (result.missingCompanyIds.length > 0) {
    return NextResponse.json({
      error: "部分企业不存在，请刷新列表后重试。",
      missingCompanyIds: result.missingCompanyIds,
    }, { status: 404 });
  }
  return NextResponse.json({
    companiesUpdated: result.companiesUpdated,
    postingsUpdated: result.postingsUpdated,
  }, { headers: { "Cache-Control": "no-store" } });
}
