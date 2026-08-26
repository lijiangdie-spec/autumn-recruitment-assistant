import { NextResponse } from "next/server";
import { z } from "zod";

import { createResumeJob, updateApplication } from "@/lib/applications/repository";
import { isTrustedLocalMutation } from "@/lib/request-security";
import { enqueueResumeJob } from "@/lib/resume/worker";

const schema = z.object({ kind: z.enum(["generate", "rewrite", "render"]), feedback: z.string().trim().max(5000).optional() })
  .refine((value) => value.kind !== "rewrite" || Boolean(value.feedback), { message: "请填写改写意见" });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "任务参数无效" }, { status: 400 });
  try {
    const job = createResumeJob(Number(id), parsed.data.kind, parsed.data.feedback ?? "");
    await updateApplication(Number(id), { resumeStatus: "queued" });
    enqueueResumeJob(job.id);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "任务创建失败" }, { status: 400 });
  }
}
