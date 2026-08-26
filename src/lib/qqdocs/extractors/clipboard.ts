import type { Page } from "@playwright/test";

import { parseQqDocsClipboard } from "@/lib/qqdocs/extractors/clipboard-parser";
import { QqDocsImportError, type RawSheetSnapshot } from "@/lib/qqdocs/types";

async function focusSheet(page: Page): Promise<void> {
  const canvases = page.locator("canvas:visible");
  const count = await canvases.count();
  let best: { index: number; area: number } | null = null;
  for (let index = 0; index < count; index += 1) {
    const box = await canvases.nth(index).boundingBox();
    if (!box) continue;
    const area = box.width * box.height;
    if (!best || area > best.area) best = { index, area };
  }
  if (best && best.area > 10_000) {
    await canvases.nth(best.index).click({ position: { x: 80, y: 80 } });
    return;
  }
  await page.locator("body").click({ position: { x: 300, y: 300 } });
}

async function readClipboard(page: Page): Promise<{ html: string; text: string }> {
  return page.evaluate(async () => {
    const result = { html: "", text: "" };
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes("text/html")) result.html = await (await item.getType("text/html")).text();
      if (item.types.includes("text/plain")) result.text = await (await item.getType("text/plain")).text();
    }
    return result;
  });
}

export async function extractQqDocsViaClipboard(page: Page, sourceKey: string): Promise<RawSheetSnapshot> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://docs.qq.com" });
  await focusSheet(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+C");
  await page.waitForTimeout(300);
  let clipboard: { html: string; text: string };
  try {
    clipboard = await readClipboard(page);
  } catch (error) {
    throw new QqDocsImportError("PRIMARY_EXTRACTOR_FAILED", "无法读取腾讯文档复制到剪贴板的内容", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!clipboard.html.trim() && !clipboard.text.trim()) {
    throw new QqDocsImportError("PRIMARY_EXTRACTOR_FAILED", "腾讯文档没有产生可解析的剪贴板内容");
  }
  return parseQqDocsClipboard({ sourceKey, ...clipboard, reachedSheetEnd: true });
}

