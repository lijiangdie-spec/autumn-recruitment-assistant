import { afterEach, describe, expect, it } from "vitest";

import { ClaudeAdapter } from "@/lib/agents/claude";
import { CodexAdapter } from "@/lib/agents/codex";

afterEach(() => { delete process.env.AUTUMN_ASSISTANT_CODEX_MOCK; delete process.env.AUTUMN_ASSISTANT_CLAUDE_MOCK; });
const task = { prompt: "test", schema: { type: "object" }, readRoots: [] };
describe("双 CLI 结构化适配器", () => {
  it("Codex 使用相同的结构化返回约定", async () => { process.env.AUTUMN_ASSISTANT_CODEX_MOCK = '{"value":"codex"}'; await expect(new CodexAdapter().runStructured<{ value: string }>(task)).resolves.toMatchObject({ provider: "codex", data: { value: "codex" } }); });
  it("Claude 使用相同的结构化返回约定", async () => { process.env.AUTUMN_ASSISTANT_CLAUDE_MOCK = '{"value":"claude"}'; await expect(new ClaudeAdapter().runStructured<{ value: string }>(task)).resolves.toMatchObject({ provider: "claude", data: { value: "claude" } }); });
});
