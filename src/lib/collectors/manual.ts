import * as cheerio from "cheerio";

import { extractExplicitDeadline, extractExplicitPublishedDate, normalizeDate } from "@/lib/collectors/dates";
import { assertSafePublicUrl, fetchHtml } from "@/lib/collectors/http";
import { CollectionError } from "@/lib/collectors/types";
import { extractCities, extractCohort, inferEmploymentType, normalizeWhitespace } from "@/lib/filters";
import { hashText } from "@/lib/scoring";
import type { ParsedPostingInput, SourceTrust } from "@/lib/types";

function jsonLdObjects($: cheerio.CheerioAPI): Array<Record<string, unknown>> {
  const objects: Array<Record<string, unknown>> = [];
  $('script[type="application/ld+json"]').each((_i, element) => {
    try {
      const parsed: unknown = JSON.parse($(element).text());
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        if (value && typeof value === "object") objects.push(value as Record<string, unknown>);
      }
    } catch {
      // Invalid third-party JSON-LD must not prevent a manual import.
    }
  });
  return objects;
}

function firstMeta($: cheerio.CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const element = $(selector).first();
    const value = element.attr("content") ?? element.attr("datetime") ?? element.text();
    if (value?.trim()) return normalizeWhitespace(value);
  }
  return "";
}

function findCompany(text: string, fallback: string): string {
  const labeled = text.match(/(?:公司名称|招聘单位|用人单位|企业名称)\s*[：:]\s*([^\n，。]{2,60})/i)?.[1];
  if (labeled) return normalizeWhitespace(labeled);
  const company = text.match(/([\p{Script=Han}A-Za-z0-9·（）()]{2,45}(?:有限(?:责任)?公司|集团|证券|基金|银行|保险|投资|资本|科技))/u)?.[1];
  return normalizeWhitespace(company ?? fallback) || "公司待核验";
}

function parseJsonLdDate(objects: Array<Record<string, unknown>>, key: "datePosted" | "datePublished" | "validThrough"): string {
  for (const object of objects) {
    if (typeof object[key] === "string") return object[key] as string;
    if (Array.isArray(object["@graph"])) {
      for (const nested of object["@graph"] as Array<Record<string, unknown>>) {
        if (typeof nested?.[key] === "string") return nested[key] as string;
      }
    }
  }
  return "";
}

export function parseManualDocument(input: { htmlOrText: string; url?: string; fetchedAt?: Date }): ParsedPostingInput {
  const hasHtml = /<\/?(?:html|body|main|article|h1|div|p|meta)\b/i.test(input.htmlOrText);
  const $ = cheerio.load(hasHtml ? input.htmlOrText : `<main><pre></pre></main>`);
  if (!hasHtml) $("pre").text(input.htmlOrText);
  const objects = jsonLdObjects($);
  const titleBeforeCleanup = firstMeta($, ["#activity-name", "h1", "meta[property='og:title']", "meta[name='twitter:title']", "title"]);
  const author = firstMeta($, ["#js_name", "meta[name='author']", "meta[property='article:author']"]);
  const publishedMeta = firstMeta($, [
    "meta[property='article:published_time']",
    "meta[name='publishdate']",
    "meta[name='date']",
    "time[datetime]",
    "#publish_time",
  ]) || parseJsonLdDate(objects, "datePosted") || parseJsonLdDate(objects, "datePublished");
  const deadlineMeta = parseJsonLdDate(objects, "validThrough");
  $("script:not([type='application/ld+json']),style,noscript,nav,footer,header").remove();
  const article = $("#js_content, article, main, [itemprop='description'], body").first();
  const bodyText = normalizeWhitespace(article.text() || $.root().text()).slice(0, 50_000);
  const title = titleBeforeCleanup
    || normalizeWhitespace(bodyText.split("\n")[0] ?? "").slice(0, 150)
    || "岗位待核验";
  const hostname = input.url ? new URL(input.url).hostname.toLowerCase() : "";
  const sourceName = author || hostname || "手动粘贴";
  const company = findCompany(`${title}\n${bodyText}`, author || hostname.replace(/^www\./, ""));
  const publishedAt = normalizeDate(publishedMeta) ?? extractExplicitPublishedDate(bodyText);
  const deadlineAt = normalizeDate(deadlineMeta, true) ?? extractExplicitDeadline(bodyText);
  const cities = extractCities(`${title}\n${bodyText}`);
  const cohort = extractCohort(`${title}\n${bodyText}`);
  const sourceUrl = input.url ?? `manual://${hashText(`${title}\n${bodyText}`).slice(0, 24)}`;
  const sourceTrust: SourceTrust = hostname.endsWith(".edu.cn") || hostname.includes("job.") && hostname.endsWith("edu.cn")
    ? "university"
    : "manual";

  return {
    company,
    title: title.slice(0, 200),
    cities,
    cohort,
    employmentType: inferEmploymentType(`${title}\n${bodyText}`),
    publishedAt,
    deadlineAt,
    jdText: bodyText,
    sourceUrl,
    officialUrl: input.url ?? null,
    applyUrl: input.url ?? null,
    sourceName,
    sourceTrust,
  };
}

function isWechatUnavailable(html: string, parsed: ParsedPostingInput): boolean {
  return /环境异常|访问过于频繁|请在微信客户端打开|完成验证|verify/i.test(html)
    || parsed.jdText.length < 80
    || /微信公众平台/.test(parsed.title) && parsed.jdText.length < 300;
}

export async function importManualPosting(input: { url?: string; text?: string }): Promise<ParsedPostingInput> {
  const text = input.text?.trim();
  if (input.url) assertSafePublicUrl(input.url);
  if (text) return parseManualDocument({ htmlOrText: text, url: input.url });
  if (!input.url) throw new CollectionError("请至少提供招聘链接或招聘正文。", "missing_input", 400);

  const requested = new URL(input.url);
  const wechat = requested.hostname.toLowerCase() === "mp.weixin.qq.com";
  try {
    const fetched = await fetchHtml(input.url);
    const parsed = parseManualDocument({ htmlOrText: fetched.html, url: fetched.finalUrl });
    if (wechat && isWechatUnavailable(fetched.html, parsed)) {
      throw new CollectionError("微信页面要求验证或未返回正文。请复制文章正文，在“粘贴正文”中导入；系统不会登录或绕过验证。", "wechat_unavailable", 422);
    }
    if (parsed.jdText.length < 40) {
      throw new CollectionError("网页没有可识别的招聘正文，请复制正文后手动导入。", "content_unreadable", 422);
    }
    return parsed;
  } catch (error) {
    if (wechat && error instanceof CollectionError && error.code !== "wechat_unavailable") {
      throw new CollectionError("微信页面当前无法公开读取。请复制文章正文，在“粘贴正文”中导入；系统不会登录或绕过验证。", "wechat_unavailable", 422);
    }
    throw error;
  }
}
