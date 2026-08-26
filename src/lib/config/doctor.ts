import { spawn } from "node:child_process";
import { access } from "node:fs/promises";

import { resolveAssistantDataRoot } from "@/lib/config/paths";
import { ensureAssistantDataDirectories } from "@/lib/config/store";

export interface DependencyCheck {
  id: "codex" | "claude" | "xelatex" | "pdfinfo" | "pdftotext" | "data-root";
  label: string;
  available: boolean;
  detail: string;
  required: boolean;
}

function probe(command: string, args: string[], timeoutMs = 5_000): Promise<{ available: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, shell: process.platform === "win32" });
    let output = "";
    let settled = false;
    const finish = (available: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ available, detail: detail.trim().slice(0, 240) });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false, "检测超时");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (error) => finish(false, error.message));
    child.on("close", (code) => finish(code === 0, output || `退出码 ${code}`));
  });
}

export async function runEnvironmentDoctor(): Promise<DependencyCheck[]> {
  const codexCommand = process.env.CODEX_EXECUTABLE || (process.platform === "win32" ? "codex.cmd" : "codex");
  const claudeCommand = process.env.CLAUDE_EXECUTABLE || (process.platform === "win32" ? "claude.exe" : "claude");
  const [codex, claude, xelatex, pdfinfo, pdftotext] = await Promise.all([
    probe(codexCommand, ["--version"]),
    probe(claudeCommand, ["--version"]),
    probe(process.env.XELATEX_EXECUTABLE || "xelatex", ["--version"]),
    probe(process.env.PDFINFO_EXECUTABLE || "pdfinfo", ["-v"]),
    probe(process.env.PDFTOTEXT_EXECUTABLE || "pdftotext", ["-v"]),
  ]);
  let dataRoot = { available: true, detail: resolveAssistantDataRoot() };
  try {
    await ensureAssistantDataDirectories();
    await access(resolveAssistantDataRoot());
  } catch (error) {
    dataRoot = { available: false, detail: error instanceof Error ? error.message : String(error) };
  }
  return [
    { id: "codex", label: "Codex CLI", ...codex, required: false },
    { id: "claude", label: "Claude Code", ...claude, required: false },
    { id: "xelatex", label: "XeLaTeX", ...xelatex, required: false },
    { id: "pdfinfo", label: "PDF 页数检查", ...pdfinfo, required: false },
    { id: "pdftotext", label: "PDF 文本检查", ...pdftotext, required: false },
    { id: "data-root", label: "用户数据目录", ...dataRoot, required: true },
  ];
}

