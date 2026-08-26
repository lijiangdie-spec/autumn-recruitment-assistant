import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

import { resumePdfPath } from "@/lib/applications/files";
import { resumeFileName } from "@/lib/applications/files";
import { getApplication } from "@/lib/applications/repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const application = getApplication(Number(id));
  if (!application) return NextResponse.json({ error: "岗位不存在。" }, { status: 404 });
  try {
    const pdf = await readFile(resumePdfPath(application.folderName));
    return new NextResponse(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(resumeFileName())}`, "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "还没有可预览的简历。" }, { status: 404 });
  }
}
