import { NextResponse } from "next/server";
import { repairApplicationFolder } from "@/lib/applications/repository";
import { isTrustedLocalMutation } from "@/lib/request-security";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  const { id } = await context.params;
  const application = await repairApplicationFolder(Number(id));
  return application ? NextResponse.json({ application }) : NextResponse.json({ error: "岗位不存在。" }, { status: 404 });
}
