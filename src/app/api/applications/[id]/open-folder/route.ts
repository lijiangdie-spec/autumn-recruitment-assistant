import { spawn } from "node:child_process";
import { NextResponse } from "next/server";

import { getApplication } from "@/lib/applications/repository";
import { isTrustedLocalMutation } from "@/lib/request-security";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  const { id } = await context.params;
  const application = getApplication(Number(id));
  if (!application) return NextResponse.json({ error: "岗位不存在。" }, { status: 404 });
  if (process.platform !== "win32") return NextResponse.json({ error: "当前仅支持在 Windows 打开文件夹。" }, { status: 501 });
  const child = spawn("explorer.exe", [application.folderPath], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  return NextResponse.json({ opened: true });
}
