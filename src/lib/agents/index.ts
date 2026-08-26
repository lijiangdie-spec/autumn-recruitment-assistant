import { ClaudeAdapter } from "@/lib/agents/claude";
import { CodexAdapter } from "@/lib/agents/codex";
import type { AgentAdapter } from "@/lib/agents/types";
import { readPreferencesSync } from "@/lib/config/store";

export function getAgentAdapter(provider = readPreferencesSync().agentProvider): AgentAdapter {
  return provider === "claude" ? new ClaudeAdapter() : new CodexAdapter();
}

export type { AgentAdapter, AgentRunResult, JsonSchema, StructuredAgentTask } from "@/lib/agents/types";

