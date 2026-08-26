import { NextResponse } from "next/server";
import { z } from "zod";

import { getApplication, updateApplication, updateApplicationDisposition } from "@/lib/applications/repository";
import { isTrustedLocalMutation } from "@/lib/request-security";
import { resumeDraftSchema } from "@/lib/resume/schema";

const scoreOverridesSchema = z.object({
  workContent: z.number().min(0).max(100).optional(),
  fiveYearGrowth: z.number().min(0).max(100).optional(),
});

const patchSchema = z.object({
  company: z.string().trim().min(1).max(100).optional(), title: z.string().trim().min(1).max(150).optional(),
  cities: z.array(z.string().trim().max(30)).max(20).optional(), jdText: z.string().max(100_000).optional(),
  sourceUrl: z.string().url().nullable().optional(), applyUrl: z.string().url().nullable().optional(), note: z.string().max(10_000).optional(),
  resumeDraft: resumeDraftSchema.nullable().optional(),
  scoreOverrides: scoreOverridesSchema.optional(),
  manualDisposition: z.enum(["include", "trash"]).nullable().optional(),
  manualDispositionReason: z.string().max(1000).nullable().optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const application = getApplication(Number(id));
  return application ? NextResponse.json({ application }) : NextResponse.json({ error: "岗位不存在。" }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "更新内容无效" }, { status: 400 });
  const dispositionRequested = parsed.data.manualDisposition !== undefined;
  const { manualDisposition, manualDispositionReason, ...ordinaryPatch } = parsed.data;
  let application = Object.keys(ordinaryPatch).length > 0
    ? await updateApplication(Number(id), ordinaryPatch)
    : getApplication(Number(id));
  if (application && dispositionRequested) {
    application = await updateApplicationDisposition(Number(id), manualDisposition ?? null, manualDispositionReason);
  }
  return application ? NextResponse.json({ application }) : NextResponse.json({ error: "岗位不存在。" }, { status: 404 });
}
