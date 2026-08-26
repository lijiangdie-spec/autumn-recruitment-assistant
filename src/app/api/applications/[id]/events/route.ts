import { NextResponse } from "next/server";
import { z } from "zod";

import { addApplicationEvent } from "@/lib/applications/repository";
import { isTrustedLocalMutation } from "@/lib/request-security";

const schema = z.object({
  stage: z.enum(["preparing", "applied", "written_test", "interview", "withdrawn", "rejected", "offer"]),
  round: z.number().int().min(1).max(20).nullable().optional(),
  occurredAt: z.string().datetime().optional(),
  note: z.string().max(2000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "进度事件无效" }, { status: 400 });
  const application = await addApplicationEvent(Number(id), parsed.data);
  return application ? NextResponse.json({ application }, { status: 201 }) : NextResponse.json({ error: "岗位不存在。" }, { status: 404 });
}
