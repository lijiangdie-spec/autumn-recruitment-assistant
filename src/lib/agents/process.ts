import { spawn } from "node:child_process";

export interface ProcessResult { stdout: string; stderr: string }

export function runAgentProcess(command: string, args: string[], stdin: string, cwd: string, timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command) });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill();
      finishError(new Error(`代理任务超过 ${Math.ceil(timeoutMs / 60_000)} 分钟，已停止`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", finishError);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`代理退出码 ${code}：${stderr.slice(-2_000) || stdout.slice(-2_000)}`));
      resolve({ stdout, stderr });
    });
    child.stdin.end(stdin, "utf8");
  });
}

export function parseStructuredOutput<T>(value: string): T {
  const parsed = JSON.parse(value) as T | { structured_output?: T; structuredOutput?: T; result?: T | string };
  if (parsed && typeof parsed === "object") {
    if ("structured_output" in parsed && parsed.structured_output !== undefined) return parsed.structured_output;
    if ("structuredOutput" in parsed && parsed.structuredOutput !== undefined) return parsed.structuredOutput;
    if ("result" in parsed && parsed.result !== undefined) {
      return typeof parsed.result === "string" ? JSON.parse(parsed.result) as T : parsed.result;
    }
  }
  return parsed as T;
}

