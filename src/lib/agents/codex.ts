import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runAgentProcess } from "@/lib/agents/process";
import type { AgentAdapter, AgentRunResult, StructuredAgentTask } from "@/lib/agents/types";

export class CodexAdapter implements AgentAdapter {
  readonly id = "codex" as const;

  async runStructured<T>(task: StructuredAgentTask): Promise<AgentRunResult<T>> {
    if (process.env.AUTUMN_ASSISTANT_CODEX_MOCK) {
      return { provider: this.id, data: JSON.parse(process.env.AUTUMN_ASSISTANT_CODEX_MOCK) as T, stderr: "" };
    }
    const temp = await mkdtemp(path.join(os.tmpdir(), "autumn-assistant-codex-"));
    const schemaPath = path.join(temp, "schema.json");
    const outputPath = path.join(temp, "result.json");
    try {
      await writeFile(schemaPath, JSON.stringify(task.schema), "utf8");
      const command = process.env.CODEX_EXECUTABLE || (process.platform === "win32" ? "codex.cmd" : "codex");
      const args = ["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "-C", process.cwd()];
      for (const root of [...new Set(task.readRoots.map((item) => path.resolve(item)))]) args.push("--add-dir", root);
      args.push("--output-schema", schemaPath, "--output-last-message", outputPath, "-");
      const result = await runAgentProcess(command, args, task.prompt, process.cwd(), task.timeoutMs ?? 600_000);
      const data = JSON.parse(await readFile(outputPath, "utf8")) as T;
      return { provider: this.id, data, stderr: result.stderr };
    } finally {
      await rm(temp, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

