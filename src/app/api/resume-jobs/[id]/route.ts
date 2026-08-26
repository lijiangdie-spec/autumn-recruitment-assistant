import { NextResponse } from "next/server";
import { getResumeJob } from "@/lib/applications/repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = getResumeJob(Number(id));
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "任务不存在。" }, { status: 404 });
}
