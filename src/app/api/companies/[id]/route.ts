import { NextResponse } from "next/server";

import { getCompanyDetail, updateCompanyDisposition } from "@/lib/companies/repository";
import { refreshSupportedCompanySources } from "@/lib/recruitment-parsers/run";
import { isTrustedLocalMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params;
  if (!/^\d+$/.test(rawId)) return NextResponse.json({ error: "无效的公司 ID" }, { status: 400 });
  const company = getCompanyDetail(Number(rawId));
  return company
    ? NextResponse.json({ company }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "公司不存在" }, { status: 404 });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  const { id: rawId } = await context.params;
  if (!/^\d+$/.test(rawId)) return NextResponse.json({ error: "无效的公司 ID" }, { status: 400 });
  const company = getCompanyDetail(Number(rawId));
  if (!company) return NextResponse.json({ error: "公司不存在" }, { status: 404 });
  const refresh = await refreshSupportedCompanySources(company.id);
  return NextResponse.json({ company: getCompanyDetail(company.id), refresh }, {
    status: refresh.companies > 0 && refresh.discovered === 0 && refresh.warnings.length > 0 ? 502 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedLocalMutation(request)) {
    return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  }
  const { id: rawId } = await context.params;
  if (!/^\d+$/.test(rawId)) return NextResponse.json({ error: "无效的公司 ID" }, { status: 400 });

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
  if (Object.keys(payload).length !== 1 || !("manualDisposition" in payload)
    || (payload.manualDisposition !== "trash" && payload.manualDisposition !== null)) {
    return NextResponse.json({ error: "manualDisposition 必须是 trash 或 null" }, { status: 400 });
  }

  const result = updateCompanyDisposition(Number(rawId), payload.manualDisposition);
  if (!result) return NextResponse.json({ error: "公司不存在" }, { status: 404 });
  return NextResponse.json({
    company: getCompanyDetail(Number(rawId)),
    updated: result.updated,
  }, { headers: { "Cache-Control": "no-store" } });
}
