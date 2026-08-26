import { NextResponse } from "next/server";
import { z } from "zod";

import { importManualPosting } from "@/lib/collectors/manual";
import { CollectionError } from "@/lib/collectors/types";
import { upsertPosting } from "@/lib/db/repository";
import { isTrustedLocalMutation } from "@/lib/request-security";
import { evaluatePosting } from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const importSchema = z
  .object({
    url: z.string().trim().url("链接格式无效").max(2048)
      .refine((value) => /^https?:\/\//i.test(value), "只支持 http 或 https 招聘链接")
      .optional(),
    text: z.string().trim().min(1).max(100_000, "正文不能超过 100,000 字符").optional(),
  })
  .refine((value) => Boolean(value.url || value.text), { message: "请至少提供招聘链接或招聘正文" });

export async function POST(request: Request) {
  if (!isTrustedLocalMutation(request)) {
    return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "请求必须是 JSON。" }, { status: 400 });
  }

  const parsed = importSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "导入参数无效" }, { status: 400 });
  }

  try {
    const input = await importManualPosting(parsed.data);
    const evaluated = evaluatePosting(input);
    const result = upsertPosting(evaluated);
    if (result.action === "expired") {
      return NextResponse.json({ posting: null, included: false, message: "岗位截止时间已到，未入库。" });
    }
    const { posting } = result;
    const included = evaluated.hardRejectReasons.length === 0;
    const message = included
      ? evaluated.verificationStatus === "verified"
        ? "已导入机会雷达。"
        : "已导入待核验区，请确认发布日期、城市或毕业届别。"
      : `已归档但不会进入主列表：${evaluated.hardRejectReasons.join("；")}`;
    return NextResponse.json({ posting, included, message }, { status: 201 });
  } catch (error) {
    if (error instanceof CollectionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Manual import failed", error);
    return NextResponse.json({ error: "导入过程中出现内部错误，请检查链接或改为粘贴正文。" }, { status: 500 });
  }
}
