import { expect, test, type Page } from "@playwright/test";

const basePreferences = {
  schemaVersion: 1 as const,
  setupCompleted: true,
  agentProvider: "codex" as const,
  feedUrl: "",
  job: { roleKeywords: [], excludedKeywords: [], cities: [], cohorts: [], employmentTypes: [], requiredKeywords: [], dimensions: [], recommendationThreshold: 60 },
  resume: { template: "c" as const, outputFormat: "docx" as const, accentHex: "#2357D5", includePhoto: false, outputDirectory: "" },
};
const baseProfile = { schemaVersion: 1 as const, name: "测试用户", phone: "", email: "test@example.com", education: [], skills: [], certificates: [] };

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test.describe("秋招助手公开版", () => {
  test.beforeAll(async ({ request }) => {
    const response = await request.post("/api/setup", { data: { profile: baseProfile, preferences: basePreferences } });
    expect(response.ok()).toBeTruthy();
  });

  test("首次启动引导用户录入个人资料和通用岗位偏好", async ({ page }) => {
    let completed = false;
    let submitted: unknown = null;
    await page.route("**/api/setup", async (route) => {
      if (route.request().method() === "POST") {
        submitted = route.request().postDataJSON();
        completed = true;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ completed: true }) });
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({
        completed,
        profile: baseProfile,
        preferences: { ...basePreferences, setupCompleted: completed },
        dataRoot: "系统用户数据目录/秋招助手",
        checks: [
          { id: "codex", label: "Codex CLI", available: true, detail: "可用", required: false },
          { id: "claude", label: "Claude Code", available: true, detail: "可用", required: false },
          { id: "data-root", label: "用户数据目录", available: true, detail: "已隔离", required: true },
        ],
      }) });
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "秋招助手", exact: true })).toBeVisible();
    await expect(page.getByText("所有个人资料默认只保存在这台电脑。")).toBeVisible();
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByLabel("姓名").fill("示例用户");
    await page.getByLabel("技能关键词").fill("用户研究、数据分析");
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByText("结构化访谈", { exact: true })).toBeVisible();
    await expect(page.getByText("旧简历导入", { exact: true })).toBeVisible();
    await expect(page.getByText("代码仓库分析", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByLabel("目标岗位关键词").fill("产品、研究");
    await page.getByLabel("目标城市").fill("成都、远程");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByRole("button", { name: "进入秋招助手" }).click();
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
    expect(submitted).toMatchObject({
      profile: { name: "示例用户", skills: ["用户研究", "数据分析"] },
      preferences: { job: { roleKeywords: ["产品", "研究"], cities: ["成都", "远程"] } },
    });
  });

  test("所有核心工作区均可访问且桌面端无横向溢出", async ({ page }) => {
    await page.goto("/");
    const sections = [
      ["未处理岗位", "未处理岗位"], ["投递看板", "投递看板"], ["我的素材", "我的素材库"],
      ["岗位订阅", "岗位订阅"], ["垃圾桶", "垃圾桶"], ["待手动选岗", "待手动选岗"],
      ["来源与导入", "来源与导入"], ["设置", "个人设置"],
    ];
    for (const [button, heading] of sections) {
      await page.getByRole("button", { name: new RegExp(`^${button}`) }).click();
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });

  test("素材通过草稿确认后才进入可用事实库", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "我的素材" }).click();
    await expect(page.getByRole("button", { name: "结构化访谈" })).toBeVisible();
    await page.getByRole("button", { name: "导入旧简历" }).click();
    await expect(page.getByRole("heading", { name: "把旧简历拆成事实素材" })).toBeVisible();
    await page.getByRole("button", { name: "分析代码仓库" }).click();
    await expect(page.getByRole("heading", { name: "从本地仓库提取技术证据" })).toBeVisible();
    await page.getByRole("button", { name: "结构化访谈" }).click();
    const title = `公开版验收项目-${Date.now()}`;
    await page.getByLabel("名称").fill(title);
    await page.getByLabel("你的贡献").fill("独立完成需求梳理、原型验证与复盘。");
    await page.getByLabel("结果与证据").fill("完成可复核的交付物并通过验收。");
    await page.getByRole("button", { name: "保存为草稿" }).click();
    const card = page.locator(".material-card").filter({ hasText: title });
    await expect(card).toContainText("待确认");
    await card.getByRole("button", { name: "确认事实" }).click();
    await expect(card).toContainText("已确认");
  });
});
