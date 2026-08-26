import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildFolderName, sanitizeFolderSegment } from "@/lib/applications/files";
import { escapeLatex } from "@/lib/resume/render";
import type * as ApplicationRepository from "@/lib/applications/repository";

let repository: typeof ApplicationRepository;
let workspace = "";
let closeDatabase: () => void;

beforeAll(async () => {
  process.env.RECRUITMENT_DB_PATH = ":memory:";
  workspace = await mkdtemp(path.join(os.tmpdir(), "applications-test-"));
  process.env.RECRUITMENT_WORKSPACE_ROOT = workspace;
  repository = await import("@/lib/applications/repository");
  const { sqlite } = await import("@/lib/db/client");
  closeDatabase = () => sqlite.close();
});

afterAll(async () => { closeDatabase?.(); await rm(workspace, { recursive: true, force: true }); });

describe("岗位档案与进度镜像", () => {
  it("清理 Windows 非法字符并保持三位序号", () => {
    expect(sanitizeFolderSegment('A<公司>:"测试"')).toBe("A_公司___测试_");
    expect(buildFolderName(7, "示例证券", "量化/研究员")).toBe("007_示例证券_量化_研究员");
  });

  it("建档后写出 JD 和进度文件，多轮状态由最新事件推导", async () => {
    const application = await repository.createApplication({ company: "示例基金", title: "风险模型岗", cities: ["北京"], jdText: "负责风险计量。" });
    expect(application.sequence).toBe(1);
    await expect(readFile(path.join(application.folderPath, "JD.txt"), "utf8")).resolves.toContain("风险模型岗");
    await repository.addApplicationEvent(application.id, { stage: "applied", note: "官网投递" });
    await repository.addApplicationEvent(application.id, { stage: "written_test", round: 1 });
    const interview = await repository.addApplicationEvent(application.id, { stage: "interview", round: 2, note: "终面" });
    expect(interview?.currentStage).toBe("interview");
    expect(interview?.currentRound).toBe(2);
    const mirror = JSON.parse(await readFile(path.join(application.folderPath, "投递进度.json"), "utf8")) as { events: unknown[] };
    expect(mirror.events).toHaveLength(4);
    const historical = await repository.addApplicationEvent(application.id, { stage: "written_test", round: 1, occurredAt: "2020-01-01T00:00:00.000Z", note: "补录历史事件" });
    expect(historical?.currentStage).toBe("interview");
    expect(historical?.currentRound).toBe(2);
  });

  it("LaTeX 特殊字符全部转义", () => {
    expect(escapeLatex("R&D_50% #1")).toContain("R\\&D\\_50\\% \\#1");
  });

  it("同一岗位可在失败后重新创建简历任务", async () => {
    const application = await repository.createApplication({ company: "重试证券", title: "量化研究岗", cities: ["上海"] });
    const first = repository.createResumeJob(application.id, "generate");
    repository.updateResumeJob(first.id, { status: "failed", error: "模拟失败", finishedAt: new Date().toISOString() });
    const retry = repository.createResumeJob(application.id, "generate");
    expect(retry.id).toBeGreaterThan(first.id);
    expect(retry.status).toBe("queued");
  });

  it("手动岗位也会独立评分，并可保存人工覆盖值", async () => {
    const application = await repository.createApplication({ company: "成长基金", title: "金融AI应用岗", cities: ["杭州"], jdText: "负责金融 AI 项目交付。" });
    expect(application.personalScore).toBeGreaterThan(0);
    const updated = await repository.updateApplication(application.id, {
      scoreOverrides: {
        workContent: 95,
        fiveYearGrowth: 90,
      },
    });
    expect(updated?.scoreOverrides.workContent).toBe(95);
    expect(updated?.scoreBreakdown.workContent).toBe(95);
    expect(updated?.personalScore).toBeGreaterThan(application.personalScore);
  });

  it("放弃投递不删除申请文件和进度，并可从垃圾桶恢复", async () => {
    const application = await repository.createApplication({ company: "恢复测试基金", title: "量化研究岗", cities: ["北京"] });
    const abandoned = await repository.updateApplicationDisposition(application.id, "trash", "暂不投递");
    expect(abandoned?.effectiveDisposition.bucket).toBe("trash");
    expect(repository.listApplications().some((item) => item.id === application.id)).toBe(false);
    expect(repository.listApplications("trash").some((item) => item.id === application.id)).toBe(true);
    await expect(readFile(path.join(application.folderPath, "JD.txt"), "utf8")).resolves.toContain("量化研究岗");

    const restored = await repository.updateApplicationDisposition(application.id, "include", "重新考虑");
    expect(restored?.effectiveDisposition.bucket).toBe("active");
    expect(repository.listApplications().some((item) => item.id === application.id)).toBe(true);
  });
});
