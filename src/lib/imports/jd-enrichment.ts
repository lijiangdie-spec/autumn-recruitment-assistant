import * as cheerio from "cheerio";

import { fetchHtml } from "@/lib/collectors/http";
import { normalizeWhitespace } from "@/lib/filters";

function normalizedTitle(value: string): string {
  return value.toLowerCase().replace(/[\s“”"'‘’（）()【】\[\]·•—_-]/g, "");
}

function sameJobTitle(left: string, right: string): boolean {
  const a = normalizedTitle(left);
  const b = normalizedTitle(right);
  if (Math.min(a.length, b.length) < 4) return a === b;
  return a === b || a.includes(b) || b.includes(a);
}

function asPlainText(value: unknown): string {
  if (typeof value !== "string") return "";
  const $ = cheerio.load(`<main>${value}</main>`);
  $("script,style,noscript").remove();
  return normalizeWhitespace($("main").text()).slice(0, 20_000);
}

function collectJobPostings(value: unknown, result: Array<Record<string, unknown>>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectJobPostings(item, result);
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
  if (types.some((type) => typeof type === "string" && type.toLowerCase() === "jobposting")) result.push(object);
  for (const nested of Object.values(object)) {
    if (nested && typeof nested === "object") collectJobPostings(nested, result);
  }
}

function jdFromJsonLd($: cheerio.CheerioAPI, title: string): string | null {
  const postings: Array<Record<string, unknown>> = [];
  $('script[type="application/ld+json"]').each((_index, element) => {
    try { collectJobPostings(JSON.parse($(element).text()) as unknown, postings); } catch { /* ignore malformed third-party data */ }
  });
  for (const posting of postings) {
    const postingTitle = String(posting.title ?? posting.name ?? "");
    if (!sameJobTitle(postingTitle, title)) continue;
    const sections = [posting.description, posting.responsibilities, posting.qualifications, posting.skills]
      .map(asPlainText).filter(Boolean);
    const text = normalizeWhitespace(sections.join("\n\n"));
    if (text.length >= 80) return text.slice(0, 20_000);
  }
  return null;
}

function jdFromVisibleSection($: cheerio.CheerioAPI, title: string): string | null {
  const selectors = "h1,h2,h3,h4,[class*='job-title'],[class*='position-title'],[data-testid*='title']";
  for (const element of $(selectors).toArray()) {
    const heading = normalizeWhitespace($(element).text());
    if (!sameJobTitle(heading, title)) continue;
    const containers = [$(element).closest("article,section,li"), $(element).parent(), $(element).parent().parent()];
    for (const container of containers) {
      if (!container.length) continue;
      const text = normalizeWhitespace(container.text());
      if (text.length < 120 || text.length > 20_000) continue;
      if (!/岗位职责|工作职责|职位描述|岗位描述|任职要求|岗位要求|工作内容|负责/i.test(text)) continue;
      const titleCount = (normalizedTitle(text).match(new RegExp(normalizedTitle(title), "g")) ?? []).length;
      if (titleCount > 3) continue;
      return text.slice(0, 20_000);
    }
  }
  return null;
}

export function extractPublicJobJd(html: string, title: string): string | null {
  const $ = cheerio.load(html);
  $("script:not([type='application/ld+json']),style,noscript,nav,footer").remove();
  return jdFromJsonLd($, title) ?? jdFromVisibleSection($, title);
}

export async function tryReadPublicJobJd(url: string, title: string): Promise<string | null> {
  try {
    const fetched = await fetchHtml(url, { timeoutMs: 8_000 });
    return extractPublicJobJd(fetched.html, title);
  } catch {
    // 登录、验证码、反爬或临时网络故障都只意味着本次不补全；不绕过限制。
    return null;
  }
}
