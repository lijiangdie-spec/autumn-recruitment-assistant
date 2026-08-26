import { NextResponse } from "next/server";

import { importResumeFile } from "@/lib/materials/extract";
import { isTrustedLocalMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "请选择旧简历文件" }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "文件不能超过 20 MB" }, { status: 400 });
    return NextResponse.json(await importResumeFile(file), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "旧简历导入失败" }, { status: 400 });
  }
}
