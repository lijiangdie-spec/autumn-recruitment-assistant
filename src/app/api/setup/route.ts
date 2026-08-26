import { NextResponse } from "next/server";
import { z } from "zod";

import { runEnvironmentDoctor } from "@/lib/config/doctor";
import { preferencesSchema, profileSchema } from "@/lib/config/schema";
import { readSetupState, writePreferences, writeProfile } from "@/lib/config/store";
import { isTrustedLocalMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const setupSchema = z.object({
  profile: profileSchema,
  preferences: preferencesSchema,
});

export async function GET() {
  try {
    const [state, checks] = await Promise.all([readSetupState(), runEnvironmentDoctor()]);
    return NextResponse.json({ ...state, checks }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法读取首次设置" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  const parsed = setupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "设置内容无效" }, { status: 400 });
  try {
    const preferences = { ...parsed.data.preferences, setupCompleted: true };
    const [profile, savedPreferences] = await Promise.all([
      writeProfile(parsed.data.profile),
      writePreferences(preferences),
    ]);
    return NextResponse.json({ completed: true, profile, preferences: savedPreferences });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法保存首次设置" }, { status: 500 });
  }
}

