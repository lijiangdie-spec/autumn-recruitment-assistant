import path from "node:path";

import { parseStructuredOutput, runAgentProcess } from "@/lib/agents/process";
import type { AgentAdapter, AgentRunResult, StructuredAgentTask } from "@/lib/agents/types";

export class ClaudeAdapter implements AgentAdapter {
  readonly id = "claude" as const;

  async runStructured<T>(task: StructuredAgentTask): Promise<AgentRunResult<T>> {
    if (process.env.AUTUMN_ASSISTANT_CLAUDE_MOCK) {
      return { provider: this.id, data: JSON.parse(process.env.AUTUMN_ASSISTANT_CLAUDE_MOCK) as T, stderr: "" };
    }
    const command = process.env.CLAUDE_EXECUTABLE || (process.platform === "win32" ? "claude.exe" : "claude");
    const args = [
      "--print",
      "--output-format", "json",
      "--json-schema", JSON.stringify(task.schema),
      "--no-session-persistence",
      "--permission-mode", "dontAsk",
      "--tools", "Read,Glob,Grep",
      "--add-dir", ...[...new Set(task.readRoots.map((item) => path.resolve(item)))],
    ];
    const result = await runAgentProcess(command, args, task.prompt, process.cwd(), task.timeoutMs ?? 600_000);
    return { provider: this.id, data: parseStructuredOutput<T>(result.stdout), stderr: result.stderr };
  }
}

