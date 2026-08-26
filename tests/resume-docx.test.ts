import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import mammoth from "mammoth";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
let temporaryDirectory = "";

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = "";
});

describe("Word 简历渲染", () => {
  it("用公开模板生成可读取的 DOCX", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "autumn-docx-"));
    const contentPath = path.join(temporaryDirectory, "content.json");
    const outputPath = path.join(temporaryDirectory, "resume.docx");
    await writeFile(contentPath, JSON.stringify({
      basics: { name: "示例用户", intent: "用户研究", contacts: ["example@example.com"], photo: null },
      sections: [
        { title: "教育背景", type: "entries", items: [{ heading: "示例大学", middle: "示例专业", right: "2023–2027", bullets: [] }] },
        { title: "项目经历", type: "entries", items: [{ heading: "调研项目", middle: "项目负责人", right: "2026", bullets: ["完成需求梳理与可用性验证"] }] },
      ],
    }), "utf8");
    await run(process.execPath, [
      path.join(process.cwd(), "skills", "resume-writer", "scripts", "build_docx.mjs"),
      "--content", contentPath,
      "--template", "a",
      "--out", outputPath,
      "--no-photo",
    ]);
    expect((await stat(outputPath)).size).toBeGreaterThan(5_000);
    const extracted = await mammoth.extractRawText({ path: outputPath });
    expect(extracted.value).toContain("示例用户");
    expect(extracted.value).toContain("完成需求梳理与可用性验证");
  });
});
