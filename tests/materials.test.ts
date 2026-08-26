import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMaterial, deleteMaterial, listMaterials, updateMaterial } from "@/lib/materials/store";

let root = ""; const previous = process.env.AUTUMN_ASSISTANT_DATA_ROOT;
beforeAll(async () => { root = await mkdtemp(path.join(os.tmpdir(), "autumn-materials-")); process.env.AUTUMN_ASSISTANT_DATA_ROOT = root; });
afterAll(async () => { if (previous === undefined) delete process.env.AUTUMN_ASSISTANT_DATA_ROOT; else process.env.AUTUMN_ASSISTANT_DATA_ROOT = previous; await rm(root, { recursive: true, force: true }); });

describe("本机事实素材库", () => {
  it("草稿、确认和删除都只写外置目录", async () => { const created = await createMaterial({ kind: "project", title: "示例项目", contribution: "实现只读数据同步" }); expect(created.status).toBe("draft"); expect((await listMaterials())[0]?.title).toBe("示例项目"); const confirmed = await updateMaterial(created.id, { status: "confirmed" }); expect(confirmed.status).toBe("confirmed"); expect(await deleteMaterial(created.id)).toBe(true); expect(await listMaterials()).toEqual([]); });
});
