export type JsonSchema = Record<string, unknown>;

export interface StructuredAgentTask {
  prompt: string;
  schema: JsonSchema;
  readRoots: string[];
  timeoutMs?: number;
}

export interface AgentRunResult<T> {
  provider: "codex" | "claude";
  data: T;
  stderr: string;
}

export interface AgentAdapter {
  readonly id: "codex" | "claude";
  runStructured<T>(task: StructuredAgentTask): Promise<AgentRunResult<T>>;
}

