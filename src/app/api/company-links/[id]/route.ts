import { NextResponse } from "next/server";
import { z } from "zod";

import { updateCompanyLink } from "@/lib/imports/repository";
import { isTrustedLocalMutation } from "@/lib/request-security";

const schema = z.object({ status: z.enum(["pending", "resolved", "ignored"]) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  const { id } = await context.params;
  const payload = schema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return NextResponse.json({ error: "状态无效。" }, { status: 400 });
  const link = updateCompanyLink(Number(id), payload.data.status);
  return link ? NextResponse.json({ link }) : NextResponse.json({ error: "链接不存在。" }, { status: 404 });
}
