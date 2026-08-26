import { access, copyFile, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import type { Application, ResumeDraft, ResumeEntry } from "@/lib/types";
import { assistantPath } from "@/lib/config/paths";
import { readPreferencesSync } from "@/lib/config/store";

function escapeLatex(value: string): string {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/\n/g, " ");
}

function hexToRgb(hex: string): string {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "123B5D";
  return `${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}`;
}

function entryLatex(entry: ResumeEntry): string {
  const heading = `\\textbf{${escapeLatex(entry.organization)}} \\hfill \\textit{${escapeLatex(entry.role)}} \\hfill ${escapeLatex(entry.date)}`;
  const bullets = entry.projects.flatMap((project) => project.bullets.map((bullet) => {
    const projectName = project.name ? `\\textbf{${escapeLatex(project.name)}：}` : "";
    const lead = bullet.lead ? `\\textbf{${escapeLatex(bullet.lead)}：}` : "";
    return `  \\item ${projectName}${lead}${escapeLatex(bullet.text)}`;
  }));
  return `${heading}\n\\begin{itemize}\n${bullets.join("\n")}\n\\end{itemize}`;
}

function buildBody(draft: ResumeDraft): string {
  const education = draft.education.map((item) => `\\textbf{${escapeLatex(item.school)}} \\hfill ${escapeLatex(item.detail)} \\hfill ${escapeLatex(item.date)}`).join("\\\\[2pt]\n");
  const skills = draft.skills.map((item) => `\\textbf{${escapeLatex(item.label)}：}${escapeLatex(item.text)}`).join("\\\\[1pt]\n");
  return `
\\begin{minipage}[t]{0.74\\textwidth}
  \\vspace{-0.2cm}
  {\\huge \\bfseries \\color{CVAccent} ${escapeLatex(draft.name)}} \\\\[0.18cm]
  \\small
  \\textbf{电话：}${escapeLatex(draft.phone)} \\quad \\textbf{邮箱：}${escapeLatex(draft.email)} \\\\
  \\textbf{意向：}${escapeLatex(draft.intention)} \\\\
  \\textbf{技术：}${escapeLatex(draft.technology)}
\\end{minipage}%
\\hfill
\\begin{minipage}[t]{0.22\\textwidth}
  \\vspace{-0.55cm}\\raggedleft
  \\IfFileExists{photo.jpg}{\\includegraphics[width=2.35cm,height=3.0cm,keepaspectratio]{photo.jpg}}{}
\\end{minipage}
\\vspace{-0.28cm}

\\resumesection{教育背景}
${education}\\par
${draft.experiences.length ? `\\resumesection{实习经历}\n${draft.experiences.map(entryLatex).join("\n")}` : ""}
${draft.projects.length ? `\\resumesection{项目经历}\n${draft.projects.map(entryLatex).join("\n")}` : ""}
${draft.skills.length ? `\\resumesection{技能与证书}\n${skills}` : ""}
`;
}

function run(command: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false });
    let stdout = ""; let stderr = ""; let settled = false;
    const timer = setTimeout(() => { child.kill(); if (!settled) { settled = true; reject(new Error(`${path.basename(command)} 执行超时`)); } }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} 失败（${code}）：${(stderr || stdout).slice(-1500)}`));
    });
  });
}

async function command(preferred: string, fallbackName: string): Promise<string> {
  const configured = preferred === "PDFINFO_EXECUTABLE"
    ? process.env.PDFINFO_EXECUTABLE
    : preferred === "PDFTOPPM_EXECUTABLE"
      ? process.env.PDFTOPPM_EXECUTABLE
      : undefined;
  if (configured) return configured;
  return fallbackName;
}

export interface RenderedResume { pdfPath: string | null; docxPath: string | null; previewPath: string | null; tempDirectory: string }

function docxContent(draft: ResumeDraft, photo: string | null) {
  const entrySection = (title: string, entries: ResumeEntry[]) => ({
    title, type: "entries", items: entries.map((entry) => ({
      heading: entry.organization, middle: entry.role, right: entry.date,
      bullets: entry.projects.flatMap((project) => project.bullets.map((bullet) => `${project.name ? `${project.name}：` : ""}${bullet.lead ? `${bullet.lead}：` : ""}${bullet.text}`)),
    })),
  });
  return {
    basics: { name: draft.name, intent: draft.intention, contacts: [draft.phone && `电话 ${draft.phone}`, draft.email && `邮箱 ${draft.email}`].filter(Boolean), photo },
    sections: [
      { title: "教育背景", type: "entries", items: draft.education.map((item) => ({ heading: item.school, middle: item.detail, right: item.date, bullets: [] })) },
      ...(draft.experiences.length ? [entrySection("实习经历", draft.experiences)] : []),
      ...(draft.projects.length ? [entrySection("项目经历", draft.projects)] : []),
      ...(draft.skills.length ? [{ title: "技能与证书", type: "lines", sidebar: true, lines: draft.skills.map((item) => `${item.label}：${item.text}`) }] : []),
    ],
  };
}

export async function renderResume(application: Application, draft: ResumeDraft): Promise<RenderedResume> {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), `resume-${application.sequence}-`));
  const preferences = readPreferencesSync().resume;
  const skillRoot = path.join(process.cwd(), "skills", "resume-writer");
  const photoPath = assistantPath("photo.jpg");
  let photo: string | null = null;
  if (preferences.includePhoto) { try { await access(photoPath); photo = photoPath; } catch { /* optional */ } }
  let docxPath: string | null = null;
  if (preferences.outputFormat === "docx" || preferences.outputFormat === "both") {
    const contentPath = path.join(tempDirectory, "resume-docx.json");
    docxPath = path.join(tempDirectory, "resume.docx");
    await writeFile(contentPath, JSON.stringify(docxContent(draft, photo)), "utf8");
    await run(process.execPath, [path.join(skillRoot, "scripts", "build_docx.mjs"), "--content", contentPath, "--template", preferences.template === "b" ? "b" : "a", "--accent", draft.accentHex, "--out", docxPath, ...(photo ? [] : ["--no-photo"])], tempDirectory);
  }
  if (preferences.outputFormat === "docx") return { pdfPath: null, docxPath, previewPath: null, tempDirectory };

  const template = await readFile(path.join(skillRoot, "assets", "template_c.tex"), "utf8");
  const texPath = path.join(tempDirectory, "resume.tex");
  const tex = template.replace("ACCENT-RGB-TOKEN", hexToRgb(draft.accentHex)).replace("@@BODY@@", buildBody(draft));
  if (/@@BODY@@|ACCENT-RGB-TOKEN/.test(tex)) throw new Error("简历模板仍含未替换的占位符");
  await writeFile(texPath, tex, "utf8");
  if (photo) await copyFile(photo, path.join(tempDirectory, "photo.jpg"));

  for (let pass = 0; pass < 2; pass += 1) await run(process.env.XELATEX_EXECUTABLE ?? "xelatex", ["-interaction=nonstopmode", "-halt-on-error", "resume.tex"], tempDirectory);
  const pdfPath = path.join(tempDirectory, "resume.pdf");
  const info = await run(await command("PDFINFO_EXECUTABLE", "pdfinfo"), [pdfPath], tempDirectory);
  if (!/^Pages:\s+1\s*$/im.test(info.stdout)) throw new Error("简历不是单页，请精简内容后重试");
  const textPath = path.join(tempDirectory, "resume.txt");
  await run(process.env.PDFTOTEXT_EXECUTABLE ?? "pdftotext", [pdfPath, textPath], tempDirectory);
  const extracted = await readFile(textPath, "utf8");
  if (extracted.replace(/\s/g, "").length < 120) throw new Error("PDF 文本过少，可能存在字体或渲染问题");
  if (/@@|TOKEN|待填写|\uFFFD/.test(extracted)) throw new Error("PDF 中检测到占位符或乱码");
  const bboxPath = path.join(tempDirectory, "resume-bbox.html");
  await run(process.env.PDFTOTEXT_EXECUTABLE ?? "pdftotext", ["-bbox", pdfPath, bboxPath], tempDirectory);
  const bbox = await readFile(bboxPath, "utf8");
  const positions = [...bbox.matchAll(/yMax="([0-9.]+)"/g)].map((match) => Number(match[1])).filter(Number.isFinite);
  const lastInk = Math.max(0, ...positions);
  if (lastInk < 520) throw new Error("简历页尾留白过多，请补充最相关的真实项目内容后重试");
  const previewBase = path.join(tempDirectory, "preview");
  await run(await command("PDFTOPPM_EXECUTABLE", "pdftoppm"), ["-png", "-f", "1", "-singlefile", "-r", "144", pdfPath, previewBase], tempDirectory);
  const previewPath = `${previewBase}.png`;
  if ((await stat(previewPath)).size < 10_000) throw new Error("PDF 预览渲染异常");
  return { pdfPath, docxPath, previewPath, tempDirectory };
}

export { escapeLatex };
