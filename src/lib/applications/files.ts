import { access, copyFile, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { assistantPath } from "@/lib/config/paths";
import { readProfileSync } from "@/lib/config/store";
import type { Application } from "@/lib/types";

export function resumeFileName(): string {
  const name = sanitizeFolderSegment(readProfileSync().name || "候选人");
  return `简历_${name}.pdf`;
}

export function resumeDocxFileName(): string {
  const name = sanitizeFolderSegment(readProfileSync().name || "候选人");
  return `简历_${name}.docx`;
}

export function resolveWorkspaceRoot(): string {
  const configured = process.env.RECRUITMENT_WORKSPACE_ROOT?.trim();
  return path.resolve(configured || assistantPath("applications"));
}

export function sanitizeFolderSegment(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return (cleaned || "待补充").slice(0, 70);
}

export function buildFolderName(sequence: number, company: string, title: string): string {
  return `${String(sequence).padStart(3, "0")}_${sanitizeFolderSegment(company)}_${sanitizeFolderSegment(title)}`;
}

export function resolveApplicationFolder(folderName: string): string {
  const root = resolveWorkspaceRoot();
  const target = path.resolve(root, folderName);
  if (path.dirname(target) !== root) throw new Error("岗位文件夹必须位于工作区根目录");
  return target;
}

async function atomicTextWrite(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rm(filePath, { force: true });
  await rename(tempPath, filePath);
}

export function formatJdFile(application: Application): string {
  return [
    `公司：${application.company}`,
    `岗位：${application.title}`,
    `城市：${application.cities.join("、") || "待核验"}`,
    `招聘来源：${application.sourceUrl || "无"}`,
    `投递链接：${application.applyUrl || "无"}`,
    "",
    "岗位 JD",
    "--------",
    application.jdText || "暂无完整 JD，请从招聘页面补充。",
    "",
  ].join("\n");
}

export async function syncApplicationFiles(application: Application): Promise<void> {
  const folderPath = resolveApplicationFolder(application.folderName);
  await mkdir(folderPath, { recursive: true });
  await Promise.all([
    atomicTextWrite(path.join(folderPath, "JD.txt"), formatJdFile(application)),
    atomicTextWrite(
      path.join(folderPath, "投递进度.json"),
      `${JSON.stringify({
        applicationId: application.id,
        sequence: application.sequence,
        company: application.company,
        title: application.title,
        currentStage: application.currentStage,
        currentRound: application.currentRound,
        note: application.note,
        updatedAt: application.updatedAt,
        events: application.events,
      }, null, 2)}\n`,
    ),
    ...(application.resumeDraft
      ? [atomicTextWrite(path.join(folderPath, "resume-draft.json"), `${JSON.stringify(application.resumeDraft, null, 2)}\n`)]
      : []),
  ]);
}

export async function publishResumePdf(folderName: string, sourcePdf: string): Promise<string> {
  return publishResumeFile(folderName, sourcePdf, resumeFileName());
}

export async function publishResumeDocx(folderName: string, sourceDocx: string): Promise<string> {
  return publishResumeFile(folderName, sourceDocx, resumeDocxFileName());
}

async function publishResumeFile(folderName: string, sourceFile: string, fileName: string): Promise<string> {
  const folderPath = resolveApplicationFolder(folderName);
  await mkdir(folderPath, { recursive: true });
  const target = path.join(folderPath, fileName);
  const incoming = path.join(folderPath, `.${fileName}.incoming`);
  await copyFile(sourceFile, incoming);
  const handle = await open(incoming, "r");
  await handle.sync();
  await handle.close();
  const backup = path.join(folderPath, `.${fileName}.previous`);
  await rm(backup, { force: true });
  let hadPrevious = true;
  try { await access(target); } catch { hadPrevious = false; }
  if (hadPrevious) await rename(target, backup);
  try {
    await rename(incoming, target);
    await rm(backup, { force: true });
  } catch (error) {
    if (hadPrevious) await rename(backup, target).catch(() => undefined);
    throw error;
  } finally {
    await rm(incoming, { force: true });
  }
  return target;
}

export function resumePdfPath(folderName: string): string {
  return path.join(resolveApplicationFolder(folderName), resumeFileName());
}

export function resumeDocxPath(folderName: string): string {
  return path.join(resolveApplicationFolder(folderName), resumeDocxFileName());
}
