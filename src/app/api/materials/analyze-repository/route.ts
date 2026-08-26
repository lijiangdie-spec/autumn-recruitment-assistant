import { NextResponse } from "next/server";
import { z } from "zod";

import { analyzeRepository } from "@/lib/materials/extract";
import { isTrustedLocalMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ path: z.string().trim().min(1).max(2048) });

export async function POST(request: Request) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请输入本地代码仓库的绝对路径" }, { status: 400 });
  try {
    return NextResponse.json(await analyzeRepository(parsed.data.path), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "代码仓库分析失败" }, { status: 400 });
  }
}
