import { chromium, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

const outputDirectory = path.join(process.cwd(), "artifacts");
mkdirSync(outputDirectory, { recursive: true });

async function prepare(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByText("秋招助手", { exact: true }).first().waitFor();
  await page.getByRole("heading", { name: "未处理岗位", exact: true }).waitFor();
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => document.fonts.ready);
}

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const desktopPage = await desktop.newPage();
  await prepare(desktopPage);
  await desktopPage.screenshot({ path: path.join(outputDirectory, "ui-desktop.png"), fullPage: true });
  await desktopPage.getByRole("button", { name: /来源与导入/ }).click();
  await desktopPage.getByRole("heading", { name: "来源与导入", exact: true }).waitFor();
  await desktopPage.screenshot({ path: path.join(outputDirectory, "ui-sources-desktop.png"), fullPage: true });
  await desktop.close();
} finally {
  await browser.close();
}

console.log(`UI screenshots written to ${outputDirectory}`);
