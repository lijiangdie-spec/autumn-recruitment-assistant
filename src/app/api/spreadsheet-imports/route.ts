import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { defaultImportDirectory } from "@/lib/imports/profile";
import { getLatestSpreadsheetRun, listSpreadsheetRuns } from "@/lib/imports/repository";
import { findLatestSpreadsheet, importSpreadsheet } from "@/lib/imports/spreadsheet";
import { isTrustedLocalMutation } from "@/lib/request-security";
import { assistantPath } from "@/lib/config/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function GET() {
  return NextResponse.json({ runs: listSpreadsheetRuns(), latest: getLatestSpreadsheetRun(), defaultDirectory: defaultImportDirectory() });
}

function isWithinDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function POST(request: Request) {
  if (!isTrustedLocalMutation(request)) return NextResponse.json({ error: "已拒绝来自其他网站的请求。" }, { status: 403 });
  try {
    const type = request.headers.get("content-type") ?? "";
    let filePath: string;
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || !/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: "请选择 .xlsx 文件。" }, { status: 400 });
      if (file.size > 30 * 1024 * 1024) return NextResponse.json({ error: "文件不能超过 30 MB。" }, { status: 413 });
      const uploadDirectory = assistantPath("imports", "spreadsheet-uploads");
      await mkdir(uploadDirectory, { recursive: true });
      filePath = path.join(uploadDirectory, `${Date.now()}_${path.basename(file.name).replace(/[^\p{L}\p{N}_.-]/gu, "_")}`);
      await writeFile(filePath, Buffer.from(await file.arrayBuffer()));
    } else {
      const payload = await request.json().catch(() => ({})) as { filePath?: string };
      if (payload.filePath) {
        if (!isWithinDirectory(payload.filePath, defaultImportDirectory())) return NextResponse.json({ error: "只能读取配置的校招汇总表目录。" }, { status: 400 });
        filePath = payload.filePath;
      } else {
        filePath = await findLatestSpreadsheet();
      }
    }
    const run = await importSpreadsheet(filePath);
    return NextResponse.json({ run }, { status: run.status === "failed" ? 422 : 201 });
  } catch (error) {
    console.error("Spreadsheet import failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Excel 导入失败" }, { status: 500 });
  }
}
