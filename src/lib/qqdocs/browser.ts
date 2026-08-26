import { mkdir } from "node:fs/promises";

import { chromium, type BrowserContext, type Page } from "@playwright/test";

import type { QqDocsSourceConfig } from "@/lib/qqdocs/config";
import { QqDocsImportError } from "@/lib/qqdocs/types";

export interface QqDocsBrowserSession {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

async function bodyText(page: Page): Promise<string> {
  return page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
}

export async function waitForQqDocsAccess(
  page: Page,
  config: QqDocsSourceConfig,
  timeoutMs = 300_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let sawLogin = false;
  while (Date.now() < deadline) {
    const text = await bodyText(page);
    sawLogin ||= /此文档已设置权限|请选择登录方式|立即登录/.test(text);
    const correctDocument = page.url().includes(`/sheet/${config.documentId}`);
    const correctSheet = new URL(page.url()).searchParams.get("tab") === config.sheetId;
    if (correctDocument && correctSheet && !/此文档已设置权限|请选择登录方式/.test(text)) return;
    await page.waitForTimeout(1_000);
  }
  throw new QqDocsImportError(
    sawLogin ? "AUTH_REQUIRED" : "WRONG_DOCUMENT",
    sawLogin ? "腾讯文档登录未在等待时间内完成" : "没有打开预期的腾讯文档工作表",
    { documentId: config.documentId, sheetId: config.sheetId },
  );
}

export async function openQqDocsBrowser(
  config: QqDocsSourceConfig,
  options: { headless?: boolean; loginTimeoutMs?: number } = {},
): Promise<QqDocsBrowserSession> {
  await mkdir(config.profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(config.profileDir, {
    channel: "chrome",
    headless: options.headless ?? false,
    viewport: null,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const page = context.pages()[0] ?? await context.newPage();
  try {
    await page.goto(config.documentUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForQqDocsAccess(page, config, options.loginTimeoutMs);
    return { context, page, close: () => context.close() };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}

