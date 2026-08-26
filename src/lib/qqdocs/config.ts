import os from "node:os";
import path from "node:path";

export const DEFAULT_QQDOCS_URL = "";
export const DEFAULT_QQDOCS_SOURCE_NAME = "腾讯文档 · 岗位信息表";

export interface QqDocsSourceConfig {
  documentUrl: string;
  documentId: string;
  sheetId: string;
  sourceKey: string;
  sourceName: string;
  profileDir: string;
  defaultYear: number;
}

function insideOrEqual(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveQqDocsConfig(
  env: Record<string, string | undefined> = process.env,
  projectRoot = process.cwd(),
  userHome = os.homedir(),
): QqDocsSourceConfig {
  const documentUrl = env.QQDOCS_DOCUMENT_URL?.trim() || DEFAULT_QQDOCS_URL;
  if (!documentUrl) throw new Error("请先设置 QQDOCS_DOCUMENT_URL；开源仓库不内置任何私人表格链接");
  const parsed = new URL(documentUrl);
  const documentId = parsed.pathname.match(/\/sheet\/([^/?]+)/)?.[1];
  const sheetId = parsed.searchParams.get("tab");
  if (!documentId || !sheetId || parsed.hostname !== "docs.qq.com") {
    throw new Error("QQDOCS_DOCUMENT_URL 必须是带 tab 参数的腾讯文档表格链接");
  }

  const profileDir = path.resolve(env.QQDOCS_PROFILE_DIR?.trim() || path.join(userHome, ".autumn-recruitment", "qqdocs-profile"));
  const resolvedProject = path.resolve(projectRoot);
  if (insideOrEqual(profileDir, resolvedProject)) {
    throw new Error("QQDOCS_PROFILE_DIR 必须位于项目目录之外，以免登录信息进入项目或版本库");
  }

  const defaultYear = Number(env.QQDOCS_DEFAULT_YEAR ?? String(new Date().getFullYear()));
  if (!Number.isInteger(defaultYear) || defaultYear < 2020 || defaultYear > 2100) {
    throw new Error("QQDOCS_DEFAULT_YEAR 必须是有效的四位年份");
  }

  return {
    documentUrl,
    documentId,
    sheetId,
    sourceKey: `qqdocs:${documentId}:${sheetId}`,
    sourceName: env.QQDOCS_SOURCE_NAME?.trim() || DEFAULT_QQDOCS_SOURCE_NAME,
    profileDir,
    defaultYear,
  };
}
