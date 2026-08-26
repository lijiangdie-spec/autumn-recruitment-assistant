import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveAssistantDataRoot } from "@/lib/config/paths";

const previous = process.env.AUTUMN_ASSISTANT_DATA_ROOT;
afterEach(() => { if (previous === undefined) delete process.env.AUTUMN_ASSISTANT_DATA_ROOT; else process.env.AUTUMN_ASSISTANT_DATA_ROOT = previous; });

describe("外置用户数据目录", () => {
  it("接受源码仓库之外的自定义目录", async () => { const root = await mkdtemp(path.join(os.tmpdir(), "autumn-config-")); process.env.AUTUMN_ASSISTANT_DATA_ROOT = root; expect(resolveAssistantDataRoot(process.cwd())).toBe(path.resolve(root)); await rm(root, { recursive: true, force: true }); });
  it("默认拒绝把私人数据放入仓库", () => { process.env.AUTUMN_ASSISTANT_DATA_ROOT = path.join(process.cwd(), "data"); expect(() => resolveAssistantDataRoot(process.cwd())).toThrow(/不能位于源码仓库内/); });
});
