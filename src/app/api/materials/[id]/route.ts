import { NextResponse } from "next/server";

import { deleteMaterial, findMaterial, updateMaterial } from "@/lib/materials/store";
import { isTrustedLocalMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const material = await findMaterial((await context.params).id);
  return material ? NextResponse.json({ material }) : NextResponse.json({ error: "素材不存在" }, { status: 404 });
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  try {
    return NextResponse.json({ material: await updateMaterial((await context.params).id, await request.json()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法更新素材" }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  return await deleteMaterial((await context.params).id)
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "素材不存在" }, { status: 404 });
}
