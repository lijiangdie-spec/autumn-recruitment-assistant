import * as cheerio from "cheerio";

import { normalizeDate } from "@/lib/collectors/dates";
import { fetchHtml } from "@/lib/collectors/http";
import { CollectionError, type CollectorResult, type CollectorSource } from "@/lib/collectors/types";
import { normalizeWhitespace } from "@/lib/filters";
import type { ParsedPostingInput } from "@/lib/types";

const HOST = "www.eximbank.gov.cn";
const PUBLIC_LIST_URL = `https://${HOST}/info/notice/recruit/`;
const FETCH_LIST_URL = `http://${HOST}/info/notice/recruit/`;

export const EXIM_SOURCE: CollectorSource = {
  name: "中国进出口银行 · 2027 秋招监控",
  type: "official",
  trust: "official",
  employmentType: "campus",
  url: PUBLIC_LIST_URL,
};

export function parseEximRecruitmentList(
  html: string,
  source: CollectorSource = EXIM_SOURCE,
): ParsedPostingInput[] {
  const $ = cheerio.load(html);
  const items = $("li a[href]").filter((_index, element) => $(element).find(".title").length > 0);
  if (items.length === 0) {
    throw new CollectionError("中国进出口银行人才招聘栏目结构已变化。", "source_structure_changed");
  }

  const postings: ParsedPostingInput[] = [];
  items.each((_index, element) => {
    const anchor = $(element);
    const title = normalizeWhitespace(anchor.find(".title").text());
    if (!/(?:中国进出口银行)?\s*2027\s*年?\s*校园招聘公告/i.test(title)) return;
    const href = anchor.attr("href");
    if (!href) return;
    let officialUrl: string;
    try {
      officialUrl = new URL(href, source.url).toString().replace(/^http:/i, "https:");
    } catch {
      return;
    }
    const publishedAt = normalizeDate(normalizeWhitespace(anchor.find(".time").text()));
    postings.push({
      company: "中国进出口银行",
      title,
      cities: ["全国"],
      cohort: "2027届",
      employmentType: "campus",
      publishedAt,
      deadlineAt: null,
      jdText: `中国进出口银行 2027 届校园招聘官方公告。具体岗位与投递入口以官方招聘平台发布内容为准。`,
      sourceUrl: officialUrl,
      officialUrl,
      applyUrl: null,
      sourceName: source.name,
      sourceTrust: source.trust,
    });
  });
  return postings;
}

export async function collectEximSource(source: CollectorSource = EXIM_SOURCE): Promise<CollectorResult> {
  // The official main site currently serves this public list reliably over
  // HTTP, while its HTTPS certificate chain is rejected by Node on some
  // machines. Do not disable TLS verification; links shown to users stay HTTPS.
  const { html } = await fetchHtml(FETCH_LIST_URL, { allowedHosts: [HOST], timeoutMs: 20_000 });
  const postings = parseEximRecruitmentList(html, source);
  return { source, postings, discovered: postings.length, warnings: [] };
}
