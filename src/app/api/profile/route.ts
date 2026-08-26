import { NextResponse } from "next/server";

import { readProfile, writeProfile } from "@/lib/config/store";
import { isTrustedLocalMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ profile: await readProfile() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  try {
    return NextResponse.json({ profile: await writeProfile(await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "基本资料无效" }, { status: 400 });
  }
}

