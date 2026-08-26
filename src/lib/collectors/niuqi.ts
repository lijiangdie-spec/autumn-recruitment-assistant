import * as cheerio from "cheerio";

import { normalizeDate } from "@/lib/collectors/dates";
import { fetchHtml } from "@/lib/collectors/http";
import { CollectionError, type CollectorResult, type CollectorSource } from "@/lib/collectors/types";
import { extractCohort, normalizeWhitespace } from "@/lib/filters";
import type { ParsedPostingInput } from "@/lib/types";

const BASE_URL = "https://campus.niuqizp.com";
const NIUQI_CRAWL_DELAY_MS = 2_100;
let lastNiuqiResponseAt = 0;

export const NIUQI_SOURCES: CollectorSource[] = [
  {
    name: "牛企直聘 · 金融校招",
    type: "aggregator",
    trust: "aggregator",
    employmentType: "campus",
    url: `${BASE_URL}/schedulenew-financesecuritiesinvestment-all-1/`,
  },
];

export interface NiuqiListPosting extends ParsedPostingInput {
  /** Aggregator collection date; useful for incremental discovery, never a publication date. */
  sourceListedAt: string | null;
}

async function fetchNiuqiPage(url: string, timeoutMs = 18_000): Promise<{ html: string; finalUrl: string; contentType: string }> {
  if (new URL(url).origin !== new URL(BASE_URL).origin) {
    throw new CollectionError("牛企直聘页面跳转到了非预期站点，已停止读取。", "unexpected_host", 422);
  }
  const remainingDelay = NIUQI_CRAWL_DELAY_MS - (Date.now() - lastNiuqiResponseAt);
  if (remainingDelay > 0) await delay(remainingDelay);
  try {
    return await fetchHtml(url, { allowedHosts: ["campus.niuqizp.com"], timeoutMs });
  } finally {
    // Apply robots.txt Crawl-delay between completed responses, including
    // list→detail, detail→detail, and one source list→the next source list.
    lastNiuqiResponseAt = Date.now();
  }
}

function absoluteUrl(value: string | undefined, base = BASE_URL): string | null {
  if (!value) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

function absoluteNiuqiUrl(value: string | undefined, base = BASE_URL): string | null {
  const resolved = absoluteUrl(value, base);
  if (!resolved) return null;
  return new URL(resolved).origin === new URL(BASE_URL).origin ? resolved : null;
}

function cleanCompany(text: string, titleAttribute: string): string {
  const fromTitle = titleAttribute.replace(/(?:校园)?招聘简章.*$/i, "").trim();
  if (fromTitle) return fromTitle;
  return normalizeWhitespace(text)
    .replace(/(?:20)?2[6-9]\s*届.*$/i, "")
    .replace(/(?:校招|秋招|春招|实习).*$/i, "")
    .trim();
}

function splitCities(value: string): string[] {
  const normalized = normalizeWhitespace(value);
  if (!normalized || /^(?:不详|未注明|暂无)$/.test(normalized)) return [];
  return [...new Set(normalized.split(/[,，、/|]+/).map((city) => city.trim()).filter(Boolean))];
}

export function parseNiuqiList(html: string, source: CollectorSource): NiuqiListPosting[] {
  const $ = cheerio.load(html);
  const list = $(".schedule-card-list").first();
  if (list.length === 0) {
    throw new CollectionError(`${source.name}页面结构已变化：未找到招聘列表。`, "source_structure_changed");
  }
  const cards = list.find("article.schedule-card");
  if (cards.length === 0) {
    throw new CollectionError(`${source.name}页面未返回任何招聘卡片，未推进刷新游标。`, "source_empty_page");
  }
  const results: NiuqiListPosting[] = [];
  cards.each((_index, element) => {
    const card = $(element);
    const companyAnchor = card.find(".schedule-card-company a").first();
    const company = cleanCompany(companyAnchor.text(), companyAnchor.attr("title") ?? "");
    const campaignTitle = normalizeWhitespace(card.find(".schedule-card-title a").first().text());
    const positions = card
      .find(".schedule-card-positions .job-postion")
      .map((_i, position) => normalizeWhitespace($(position).text()))
      .get()
      .filter(Boolean);
    const fallbackPositions = normalizeWhitespace(card.find(".schedule-card-positions").text())
      .replace(/招聘岗位[：:]?/g, "")
      .split(/[,，、]+/)
      .map((position) => position.trim())
      .filter(Boolean);
    const allPositions = positions.length > 0 ? positions : fallbackPositions;
    const postDateText = normalizeWhitespace(card.find(".schedule-card-post-date").text());
    const sourceListedAt = normalizeDate(postDateText);
    const applicationRange = normalizeWhitespace(card.find(".schedule-card-date").text());
    const deadlinePart = applicationRange.split(/\s*[~～至]\s*/).at(-1);
    const deadlineAt = normalizeDate(deadlinePart, true);
    const cities = splitCities(card.find(".schedule-card-location").text());
    const tags = normalizeWhitespace(card.find(".schedule-card-tags").text());
    const detailHref = card.find(".schedule-card-title a").first().attr("href") ?? card.find(".schedule-card-footer a").last().attr("href");
    const detailUrl = absoluteNiuqiUrl(detailHref, source.url);
    if (!company || !detailUrl) return;
    const context = [companyAnchor.text(), campaignTitle, tags, allPositions.join(",")].join("\n");
    const titles = allPositions.length > 0 ? allPositions : [campaignTitle || "岗位待核验"];
    for (const title of titles) {
      results.push({
        company,
        title,
        cities,
        cohort: extractCohort(context),
        employmentType: source.employmentType ?? (tags.includes("实习") ? "internship" : "campus"),
        // The list labels this field as 收录日期. Only the detail page can set a
        // verified publication date.
        publishedAt: null,
        deadlineAt,
        jdText: normalizeWhitespace(
          `招聘公告：${campaignTitle}\n招聘标签：${tags}\n线索收录日期（非发布日期）：${sourceListedAt?.slice(0, 10) ?? "未注明"}\n当前岗位：${title}\n同批岗位：${allPositions.join("、")}`,
        ),
        jdParseStatus: "partial",
        sourceUrl: detailUrl,
        officialUrl: null,
        applyUrl: null,
        sourceName: source.name,
        sourceTrust: source.trust,
        sourceListedAt,
      });
    }
  });
  if (results.length === 0) {
    throw new CollectionError(`${source.name}招聘卡片字段无法解析，未推进刷新游标。`, "source_parse_failed");
  }
  return results;
}

export function extractNiuqiNextPageUrl(html: string, pageUrl: string): string | null {
  const $ = cheerio.load(html);
  const href = $("#pagination a[title='next page']").first().attr("href");
  if (!href) return null;
  try {
    const next = new URL(href, pageUrl);
    if (next.origin !== new URL(BASE_URL).origin) return null;
    return next.toString();
  } catch {
    return null;
  }
}

export function parseNiuqiDetail(html: string, pageUrl: string): {
  jdText: string;
  officialUrl: string | null;
  applyUrl: string | null;
  publishedAt: string | null;
} {
  const $ = cheerio.load(html);
  const publishedAt = normalizeDate($("[itemprop='datePosted']").first().text());
  $("script,style,noscript,.share-line,.sourcetips,.prev-next-line,.jobtrack-job-action-buttons").remove();
  const detailText = normalizeWhitespace($("article.job-detail .detail-content").text()).slice(0, 40_000);
  const officialHref = $("article.job-detail .post-line a[href]")
    .map((_i, anchor) => $(anchor).attr("href"))
    .get()
    .find((href) => href && /^https?:/i.test(href));
  const applyHref = $("article.job-detail a[href]")
    .filter((_i, anchor) => /(?:立即)?(?:投递|申请|网申)/.test(normalizeWhitespace($(anchor).text())))
    .map((_i, anchor) => $(anchor).attr("href"))
    .get()
    .find((href) => href && /^https?:/i.test(href));
  return {
    jdText: detailText,
    officialUrl: absoluteUrl(officialHref, pageUrl),
    applyUrl: absoluteUrl(applyHref, pageUrl),
    publishedAt,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function collectNiuqiSource(source: CollectorSource, cursorFrom: string): Promise<CollectorResult> {
  const cutoff = Date.parse(cursorFrom);
  const warnings: string[] = [];
  const candidates: NiuqiListPosting[] = [];
  const visited = new Set<string>();
  let pageUrl: string | null = source.url;

  for (let page = 1; page <= 30 && pageUrl; page += 1) {
    if (visited.has(pageUrl)) {
      warnings.push("分页链接出现循环，已停止继续读取。");
      break;
    }
    visited.add(pageUrl);
    const { html, finalUrl } = await fetchNiuqiPage(pageUrl);
    const parsedPage = parseNiuqiList(html, source);
    candidates.push(
      ...parsedPage.filter((posting) => !posting.sourceListedAt || Date.parse(posting.sourceListedAt) >= cutoff),
    );

    const listedTimestamps = parsedPage
      .map((posting) => posting.sourceListedAt ? Date.parse(posting.sourceListedAt) : Number.NaN)
      .filter(Number.isFinite);
    const reachedOlderRecords = listedTimestamps.length > 0 && Math.min(...listedTimestamps) < cutoff;
    if (reachedOlderRecords) break;

    const nextPage = extractNiuqiNextPageUrl(html, finalUrl);
    if (!nextPage) break;
    if (page === 30) {
      warnings.push("分页达到 30 页安全上限，可能仍有更早的线索未扫描。");
      break;
    }
    pageUrl = nextPage;
  }

  const detailCache = new Map<string, Awaited<ReturnType<typeof fetchNiuqiPage>>>();
  for (const posting of candidates) {
    try {
      let detail = detailCache.get(posting.sourceUrl);
      if (!detail) {
        detail = await fetchNiuqiPage(posting.sourceUrl, 15_000);
        detailCache.set(posting.sourceUrl, detail);
      }
      const enriched = parseNiuqiDetail(detail.html, detail.finalUrl);
      if (enriched.jdText) posting.jdText = normalizeWhitespace(`${posting.jdText}\n\n${enriched.jdText}`);
      if (enriched.publishedAt) posting.publishedAt = enriched.publishedAt;
      posting.officialUrl = enriched.officialUrl;
      posting.applyUrl = enriched.applyUrl ?? enriched.officialUrl;
      posting.jdSourceUrl = detail.finalUrl;
      posting.jdParsedAt = enriched.jdText ? new Date().toISOString() : null;
      posting.jdParseStatus = enriched.jdText ? "partial" : "failed";
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      warnings.push(`${posting.company}：详情页读取失败，已保留列表摘要（${detail}）`);
    }
  }

  return { source, postings: candidates, discovered: candidates.length, warnings };
}
