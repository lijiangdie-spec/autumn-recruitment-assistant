import { rm } from "node:fs/promises";
import path from "node:path";

import { getAgentAdapter } from "@/lib/agents";
import { publishResumeDocx, publishResumePdf } from "@/lib/applications/files";
import { getApplication, getResumeJob, updateApplication, updateResumeJob } from "@/lib/applications/repository";
import { readPreferences, readProfile } from "@/lib/config/store";
import { listMaterials } from "@/lib/materials/store";
import { renderResume } from "@/lib/resume/render";
import { resumeDraftSchema } from "@/lib/resume/schema";
import type { ResumeDraft } from "@/lib/types";

const OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["revision", "accentHex", "name", "phone", "email", "intention", "technology", "education", "experiences", "projects", "skills", "covered", "gaps"],
  properties: {
    revision: { type: "integer", minimum: 1 }, accentHex: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
    name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, intention: { type: "string" }, technology: { type: "string" },
    education: { type: "array", items: { type: "object", additionalProperties: false, required: ["school", "detail", "date"], properties: { school: { type: "string" }, detail: { type: "string" }, date: { type: "string" } } } },
    experiences: { type: "array", items: { $ref: "#/$defs/entry" } }, projects: { type: "array", items: { $ref: "#/$defs/entry" } },
    skills: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "text"], properties: { label: { type: "string" }, text: { type: "string" } } } },
    covered: { type: "array", items: { type: "string" } }, gaps: { type: "array", items: { type: "string" } },
  },
  $defs: {
    bullet: { type: "object", additionalProperties: false, required: ["lead", "text"], properties: { lead: { type: "string" }, text: { type: "string" } } },
    project: { type: "object", additionalProperties: false, required: ["name", "bullets"], properties: { name: { type: "string" }, bullets: { type: "array", items: { $ref: "#/$defs/bullet" } } } },
    entry: { type: "object", additionalProperties: false, required: ["organization", "role", "date", "projects"], properties: { organization: { type: "string" }, role: { type: "string" }, date: { type: "string" }, projects: { type: "array", items: { $ref: "#/$defs/project" } } } },
  },
} as const;

async function runDraft(prompt: string, readRoots: string[]): Promise<ResumeDraft> {
  if (process.env.RECRUITMENT_CODEX_MOCK_DRAFT) {
    const parsed = resumeDraftSchema.safeParse(JSON.parse(process.env.RECRUITMENT_CODEX_MOCK_DRAFT));
    if (!parsed.success) throw new Error("模拟简历草稿无效");
    return parsed.data;
  }
  const result = await getAgentAdapter().runStructured<ResumeDraft>({ prompt, schema: OUTPUT_SCHEMA, readRoots });
  const parsed = resumeDraftSchema.safeParse(result.data);
  if (!parsed.success) throw new Error(`代理返回的草稿不符合结构：${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

async function buildPrompt(applicationId: number, kind: "generate" | "rewrite", feedback: string): Promise<{ prompt: string; roots: string[] }> {
  const application = getApplication(applicationId);
  if (!application) throw new Error("投递岗位已不存在");
  const [profile, preferences, allMaterials] = await Promise.all([readProfile(), readPreferences(), listMaterials()]);
  const materials = allMaterials.filter((item) => item.status === "confirmed");
  if (materials.length === 0) throw new Error("素材库中还没有“已确认”素材；请先确认至少一段项目或实习事实");
  const skillRoot = path.join(process.cwd(), "skills", "resume-writer");
  const currentDraft = kind === "rewrite" ? application.resumeDraft : null;
  const prompt = `你正在为“秋招助手”的当前用户生成一页中文定制简历。请遵循只读技能说明 ${path.join(skillRoot, "SKILL.md")}。不得修改任何文件，不得补造事实。

个人资料（只用于本次本机生成）：
${JSON.stringify(profile, null, 2)}

用户简历偏好：
${JSON.stringify(preferences.resume, null, 2)}

岗位：${application.company} · ${application.title}
完整 JD：
${application.jdText || "暂无完整 JD"}

用户已确认的事实素材：
${JSON.stringify(materials, null, 2)}

${currentDraft ? `当前草稿：\n${JSON.stringify(currentDraft, null, 2)}\n用户反馈：${feedback}` : "从已确认素材中筛选与 JD 最相关的内容。"}

要求：
1. 所有经历、数字、工具和成果必须能逐字追溯到“已确认素材”；不确定项写入 gaps。
2. 不把素材来源路径、私人备注或未确认草稿写进简历。
3. covered 只列已被正文实质覆盖的 JD 要求。
4. 内容适配一页；bullet 使用简短粗体导语 + 可验证事实，优先贴近岗位。
5. 姓名、电话、邮箱、教育、技能只能来自个人资料；accentHex 使用用户偏好 ${preferences.resume.accentHex}。
6. revision 为当前草稿版本加一，首次生成使用 1。
7. 仅返回符合 JSON Schema 的对象，不输出解释。`;
  return { prompt, roots: [skillRoot, application.folderPath] };
}

const queueState = globalThis as typeof globalThis & { resumeQueue?: Promise<void> };
queueState.resumeQueue ??= Promise.resolve();

async function runJob(jobId: number): Promise<void> {
  const job = getResumeJob(jobId);
  if (!job) return;
  const application = getApplication(job.applicationId);
  if (!application) return;
  updateResumeJob(jobId, { status: "running", error: null, startedAt: new Date().toISOString() });
  await updateApplication(application.id, { resumeStatus: "generating" });
  let renderDirectory: string | null = null;
  try {
    let draft: ResumeDraft | null = application.resumeDraft;
    if (job.kind !== "render") {
      const task = await buildPrompt(application.id, job.kind, job.feedback);
      draft = await runDraft(task.prompt, task.roots);
    }
    if (!draft) throw new Error("尚无可渲染的简历草稿");
    await updateApplication(application.id, { resumeDraft: draft });
    const refreshed = getApplication(application.id);
    if (!refreshed) throw new Error("投递岗位已不存在");
    let rendered;
    try {
      rendered = await renderResume(refreshed, draft);
    } catch (error) {
      if (job.kind === "render") throw error;
      const task = await buildPrompt(application.id, "rewrite", job.feedback);
      draft = await runDraft(`${task.prompt}\n\n上一版未通过渲染 QA：${error instanceof Error ? error.message : String(error)}。请在不编造事实的前提下调整内容密度，返回完整新草稿。`, task.roots);
      await updateApplication(application.id, { resumeDraft: draft });
      const retried = getApplication(application.id);
      if (!retried) throw new Error("投递岗位已不存在");
      rendered = await renderResume(retried, draft);
    }
    renderDirectory = rendered.tempDirectory;
    if (rendered.pdfPath) await publishResumePdf(refreshed.folderName, rendered.pdfPath);
    if (rendered.docxPath) await publishResumeDocx(refreshed.folderName, rendered.docxPath);
    await updateApplication(application.id, { resumeStatus: "ready", resumeUpdatedAt: new Date().toISOString(), resumeStale: false });
    updateResumeJob(jobId, { status: "succeeded", error: null, finishedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateApplication(application.id, { resumeStatus: "failed" });
    updateResumeJob(jobId, { status: "failed", error: message, finishedAt: new Date().toISOString() });
  } finally {
    if (renderDirectory) await rm(renderDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function enqueueResumeJob(jobId: number): void {
  queueState.resumeQueue = queueState.resumeQueue!.then(() => runJob(jobId)).catch((error) => console.error("Resume queue failed", error));
}
