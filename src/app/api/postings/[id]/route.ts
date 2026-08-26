import { NextRequest, NextResponse } from "next/server";

import {
  getPostingById,
  updatePostingDisposition,
  updatePostingScoreOverrides,
  updatePostingWorkflow,
} from "@/lib/db/repository";
import { isTrustedLocalMutation } from "@/lib/request-security";
import type { WorkflowState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
const WORKFLOW_STATES = new Set<WorkflowState>(["new", "saved", "preparing", "skipped"]);

async function parseId(context: RouteContext): Promise<number | null> {
  const { id: rawId } = await context.params;
  if (!/^\d+$/.test(rawId)) return null;
  const id = Number(rawId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const id = await parseId(context);
  if (id === null) return NextResponse.json({ error: "无效的岗位 ID" }, { status: 400 });

  const posting = getPostingById(id);
  if (!posting) return NextResponse.json({ error: "岗位不存在" }, { status: 404 });
  return NextResponse.json({ posting }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isTrustedLocalMutation(request)) {
    return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  }
  const id = await parseId(context);
  if (id === null) return NextResponse.json({ error: "无效的岗位 ID" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是有效 JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "请求体必须是对象" }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const allowedKeys = new Set(["workflowState", "note", "scoreOverrides", "manualDisposition", "manualDispositionReason"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    return NextResponse.json({ error: "包含不支持的岗位更新字段" }, { status: 400 });
  }
  if (!("workflowState" in payload) && !("note" in payload) && !("scoreOverrides" in payload) && !("manualDisposition" in payload)) {
    return NextResponse.json({ error: "至少提供一个可更新字段" }, { status: 400 });
  }

  const patch: { workflowState?: WorkflowState; note?: string } = {};
  if ("workflowState" in payload) {
    if (typeof payload.workflowState !== "string" || !WORKFLOW_STATES.has(payload.workflowState as WorkflowState)) {
      return NextResponse.json({ error: "无效的 workflowState" }, { status: 400 });
    }
    patch.workflowState = payload.workflowState as WorkflowState;
  }
  if ("note" in payload) {
    if (typeof payload.note !== "string") {
      return NextResponse.json({ error: "note 必须是字符串" }, { status: 400 });
    }
    if (payload.note.length > 10_000) {
      return NextResponse.json({ error: "note 不能超过 10000 个字符" }, { status: 400 });
    }
    patch.note = payload.note;
  }
  if ("manualDispositionReason" in payload && payload.manualDispositionReason !== null && typeof payload.manualDispositionReason !== "string") {
    return NextResponse.json({ error: "manualDispositionReason 必须是字符串或 null" }, { status: 400 });
  }
  if (typeof payload.manualDispositionReason === "string" && payload.manualDispositionReason.length > 1000) {
    return NextResponse.json({ error: "manualDispositionReason 不能超过 1000 个字符" }, { status: 400 });
  }
  let posting = ("workflowState" in payload || "note" in payload)
    ? updatePostingWorkflow(id, patch)
    : getPostingById(id);
  if (posting && "scoreOverrides" in payload) {
    try {
      posting = updatePostingScoreOverrides(id, payload.scoreOverrides);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "评分覆盖无效" }, { status: 400 });
    }
  }
  if (posting && "manualDisposition" in payload) {
    if (payload.manualDisposition !== null && payload.manualDisposition !== "include" && payload.manualDisposition !== "trash") {
      return NextResponse.json({ error: "manualDisposition 必须是 include、trash 或 null" }, { status: 400 });
    }
    posting = updatePostingDisposition(
      id,
      payload.manualDisposition as "include" | "trash" | null,
      typeof payload.manualDispositionReason === "string" ? payload.manualDispositionReason : null,
    );
  }
  if (!posting) return NextResponse.json({ error: "岗位不存在" }, { status: 404 });
  return NextResponse.json({ posting }, { headers: { "Cache-Control": "no-store" } });
}
