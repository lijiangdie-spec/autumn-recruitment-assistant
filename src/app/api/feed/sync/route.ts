import { NextResponse } from "next/server";

import { readFeedSyncState, syncConfiguredFeed } from "@/lib/feed/sync";
import { isTrustedLocalMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() { return NextResponse.json({ state: await readFeedSyncState() }, { headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: Request) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  try { return NextResponse.json({ state: await syncConfiguredFeed() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Feed 同步失败" }, { status: 400 }); }
}
