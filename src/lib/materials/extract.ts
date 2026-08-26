import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getAgentAdapter } from "@/lib/agents";
import { assistantPath, isWithin } from "@/lib/config/paths";
import { readPreferences } from "@/lib/config/store";
import { createMaterials } from "@/lib/materials/store";
import { extractedMaterialJsonSchema, extractedMaterialSchema, type Material, type MaterialDraft } from "@/lib/materials/schema";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".tex", ".json", ".yaml", ".yml"]);

function run(command: string, args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command) });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("文档提取超时")); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `文档提取程序退出码 ${code}`));
    });
  });
}

async function extractDocumentText(filePath: string): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) return readFile(filePath, "utf8");
  if (extension === ".pdf") return run(process.env.PDFTOTEXT_EXECUTABLE || "pdftotext", ["-layout", "-enc", "UTF-8", filePath, "-"]);
  if (extension === ".docx") {
    const script = path.join(process.cwd(), "skills", "resume-writer", "scripts", "read_docx.mjs");
    return run(process.execPath, [script, filePath]);
  }
  throw new Error("只支持 PDF、DOCX、TXT、Markdown、TEX、JSON 或 YAML 文件");
}

function importPrompt(text: string, label: string): string {
  return `你正在为“秋招助手”建立求职素材库。请从下面的旧简历中提取项目和实习事实。\n\n规则：\n1. 不要推测、补造或润色不存在的数字。\n2. 每段项目/实习单独输出；不确定的信息留空，并在 warnings 说明。\n3. resumeBullets 保留可用于简历的事实句，但不要重复个人联系方式、教育、兴趣或自我评价。\n4. kind 只能是 project 或 internship。\n5. 输出必须完全符合给定 JSON schema。\n\n来源：${label}\n\n旧简历文本：\n${text.slice(0, 120_000)}`;
}

function repositoryPrompt(repoPath: string): string {
  return `只读分析本地代码仓库 ${repoPath}，为“秋招助手”的项目素材库提取一个项目。\n\n优先阅读 README、包清单、入口文件、测试、提交历史可见信息和关键模块。不要读取 .env、密钥、凭据、node_modules、构建产物或用户数据。\n\n规则：\n1. 只记录代码能证明的技术、功能和工程事实，不猜测作者身份、业务指标或个人贡献。\n2. 无法从代码确认的“个人贡献”和量化结果留空，并写入 warnings，交给用户确认。\n3. 输出一条 kind=project 的素材，resumeBullets 是候选事实句。\n4. 输出必须完全符合给定 JSON schema。`;
}

async function persistExtracted(source: Material["sources"][number], extracted: unknown): Promise<{ materials: Material[]; warnings: string[] }> {
  const parsed = extractedMaterialSchema.parse(extracted);
  const inputs: MaterialDraft[] = parsed.materials.map((item) => ({ ...item, status: "draft", sources: [source] }));
  return { materials: await createMaterials(inputs), warnings: parsed.warnings };
}

export async function importResumeFile(file: File): Promise<{ materials: Material[]; warnings: string[] }> {
  const safeName = path.basename(file.name).replace(/[^\p{L}\p{N}._ -]/gu, "_");
  const importDirectory = assistantPath("imports", `${Date.now()}`);
  await mkdir(importDirectory, { recursive: true });
  const stored = path.join(importDirectory, safeName || "resume.txt");
  await writeFile(stored, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  const text = await extractDocumentText(stored);
  if (!text.trim()) throw new Error("没有从文件中提取到文字");
  const preferences = await readPreferences();
  const result = await getAgentAdapter(preferences.agentProvider).runStructured({ prompt: importPrompt(text, safeName), schema: extractedMaterialJsonSchema, readRoots: [importDirectory] });
  return persistExtracted({ type: "resume-import", label: safeName, path: stored, importedAt: new Date().toISOString() }, result.data);
}

export async function analyzeRepository(repoPathInput: string): Promise<{ materials: Material[]; warnings: string[] }> {
  const repoPath = path.resolve(repoPathInput);
  const dataRoot = assistantPath();
  if (isWithin(dataRoot, repoPath)) throw new Error("不能把秋招助手的私人数据目录当作代码仓库分析");
  const preferences = await readPreferences();
  const result = await getAgentAdapter(preferences.agentProvider).runStructured({ prompt: repositoryPrompt(repoPath), schema: extractedMaterialJsonSchema, readRoots: [repoPath] });
  return persistExtracted({ type: "repository", label: path.basename(repoPath), path: repoPath, importedAt: new Date().toISOString() }, result.data);
}
