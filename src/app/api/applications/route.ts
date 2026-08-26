import { NextResponse } from "next/server";
import { z } from "zod";

import { createApplication, listApplications } from "@/lib/applications/repository";
import { isTrustedLocalMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  postingId: z.number().int().positive().nullable().optional(),
  company: z.string().trim().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(150).optional(),
  cities: z.array(z.string().trim().max(30)).max(20).optional(),
  jdText: z.string().max(100_000).optional(),
  sourceUrl: z.string().url().nullable().optional(),
  applyUrl: z.string().url().nullable().optional(),
  note: z.string().max(10_000).optional(),
});

export function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("disposition");
  const disposition = value === "trash" || value === "all" ? value : "active";
  return NextResponse.json({ applications: listApplications(disposition) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "岗位信息无效" }, { status: 400 });
  try {
    const application = await createApplication(parsed.data);
    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "岗位建档失败" }, { status: 400 });
  }
}
