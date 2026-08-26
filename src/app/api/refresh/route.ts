import { NextResponse } from "next/server";

import { runRefresh } from "@/lib/collectors/run";
import { isTrustedLocalMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTrustedLocalMutation(request)) {
    return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  }
  try {
    const result = await runRefresh();
    return NextResponse.json(result, { status: result.run.status === "failed" ? 502 : 200 });
  } catch (error) {
    console.error("Refresh failed", error);
    return NextResponse.json({ error: "刷新过程中出现内部错误，请稍后重试。" }, { status: 500 });
  }
}
