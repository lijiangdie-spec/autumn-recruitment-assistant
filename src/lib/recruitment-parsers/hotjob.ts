import * as cheerio from "cheerio";
import { z } from "zod";

import { extractApplicationLimit, type ExtractedApplicationLimit } from "@/lib/companies/application-limit";
import { normalizeDate } from "@/lib/collectors/dates";
import { fetchHtml, postFormJson } from "@/lib/collectors/http";
import { extractCohort, normalizeWhitespace } from "@/lib/filters";
import type { ParsedPostingInput } from "@/lib/types";

const HOST = "wecruit.hotjob.cn";
const SUITE_PATTERN = /\/(SU[a-zA-Z0-9]+)(?:\/|$)/;

const listJobSchema = z.object({
  postId: z.string().min(1),
  recruitType: z.number().int().nullish(),
}).passthrough();

const listResponseSchema = z.object({
  state: z.union([z.string(), z.number()]),
  data: z.object({ pageForm: z.object({
    pageData: z.array(listJobSchema),
    totalPage: z.number().int().positive().default(1),
  }).passthrough() }).passthrough(),
}).passthrough();

const detailSchema = z.object({
  postId: z.string().min(1),
  postName: z.string().min(1),
  projectName: z.string().nullish(),
  recruitType: z.number().int().nullish(),
  company: z.string().nullish(),
  orgName: z.string().nullish(),
  department: z.string().nullish(),
  postTypeName: z.string().nullish(),
  education: z.string().nullish(),
  educationStr: z.string().nullish(),
  subject: z.string().nullish(),
  workContent: z.string().nullish(),
  serviceCondition: z.string().nullish(),
  workPlaceStr: z.string().nullish(),
  workPlaceList: z.array(z.object({ name: z.string().min(1) }).passthrough()).nullish(),
  publishFirstDate: z.string().nullish(),
  publishDate: z.string().nullish(),
  endDate: z.string().nullish(),
  canDelivery: z.boolean().nullish(),
  showDeliverButton: z.number().int().nullish(),
}).passthrough();

const detailResponseSchema = z.object({
  state: z.union([z.string(), z.number()]),
  data: detailSchema,
}).passthrough();

function isSuccess(value: string | number): boolean {
  return Number(value) === 200;
}

function normalizeCity(value: string): string {
  return normalizeWhitespace(value).replace(/(?:市|特别行政区)$/u, "");
}

function splitCities(value: string | null | undefined): string[] {
  return (value ?? "").split(/[、,，/|]+/).map(normalizeCity).filter(Boolean);
}

export function hotjobSuiteId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== HOST) return null;
    return url.pathname.match(SUITE_PATTERN)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function hotjobCampusUrl(suiteId: string): string {
  return `https://${HOST}/${suiteId}/pb/school.html`;
}

export function hotjobDetailUrl(suiteId: string, postId: string): string {
  const url = new URL(`https://${HOST}/${suiteId}/pb/posDetail.html`);
  url.searchParams.set("postId", postId);
  url.searchParams.set("postType", "campus");
  return url.toString();
}

export function parseHotjobListResponse(payload: unknown): { postIds: string[]; totalPages: number } {
  const parsed = listResponseSchema.safeParse(payload);
  if (!parsed.success || !isSuccess(parsed.data?.state ?? 0)) throw new Error("Hotjob 校园招聘列表接口结构已变化");
  return {
    postIds: [...new Set(parsed.data.data.pageForm.pageData.filter((job) => job.recruitType === 1).map((job) => job.postId))],
    totalPages: parsed.data.data.pageForm.totalPage,
  };
}

export function parseHotjobDetailResponse(payload: unknown, input: {
  suiteId: string;
  companyName: string;
  sourceName?: string;
}): ParsedPostingInput | null {
  const parsed = detailResponseSchema.safeParse(payload);
  if (!parsed.success || !isSuccess(parsed.data?.state ?? 0)) throw new Error("Hotjob 岗位详情接口结构已变化");
  const job = parsed.data.data;
  if (job.recruitType !== 1) return null;
  const detailUrl = hotjobDetailUrl(input.suiteId, job.postId);
  const cities = [...new Set([
    ...(job.workPlaceList ?? []).map((place) => normalizeCity(place.name)),
    ...splitCities(job.workPlaceStr),
  ].filter(Boolean))];
  const workContent = normalizeWhitespace(job.workContent ?? "");
  const requirements = normalizeWhitespace(job.serviceCondition ?? "");
  const jdText = normalizeWhitespace([
    job.projectName ? `招聘项目：${job.projectName}` : "",
    job.company ? `招聘单位：${normalizeWhitespace(job.company)}` : "",
    job.department ? `所属部门：${job.department}` : "",
    job.postTypeName ? `岗位类别：${job.postTypeName}` : "",
    job.education ?? job.educationStr ? `学历要求：${job.education ?? job.educationStr}` : "",
    job.subject ? `专业要求：${job.subject}` : "",
    workContent ? `岗位职责\n${workContent}` : "",
    requirements ? `任职要求\n${requirements}` : "",
    `官网岗位编号：${job.postId}`,
  ].filter(Boolean).join("\n\n"));
  const jdParseStatus = workContent && requirements ? "parsed" : workContent || requirements ? "partial" : "failed";
  return {
    sourceJobId: `${input.suiteId}:${job.postId}`,
    company: input.companyName,
    title: normalizeWhitespace(job.postName),
    cities,
    cohort: extractCohort(`${job.projectName ?? ""}\n${job.postName}`),
    employmentType: "campus",
    publishedAt: normalizeDate(job.publishFirstDate ?? job.publishDate),
    deadlineAt: normalizeDate(job.endDate, true),
    jdText,
    jdParseStatus,
    jdSourceUrl: detailUrl,
    jdParsedAt: jdParseStatus === "failed" ? null : new Date().toISOString(),
    sourceUrl: hotjobCampusUrl(input.suiteId),
    officialUrl: detailUrl,
    applyUrl: detailUrl,
    applicationAvailable: job.canDelivery === false || job.showDeliverButton === 0 ? false : true,
    sourceName: input.sourceName ?? `${input.companyName} · 官方校园招聘`,
    sourceTrust: "official",
  };
}

async function readListPage(suiteId: string, page: number): Promise<{ postIds: string[]; totalPages: number }> {
  const url = `https://${HOST}/wecruit/positionInfo/listPosition/${suiteId}?iSaJAx=isAjax&request_locale=zh_CN`;
  return parseHotjobListResponse(await postFormJson(url, {
    // Hotjob caps the public page at 15 items even when a larger pageSize is
    // requested, but still calculates offsets from the requested value.
    // Matching the cap is required or page 2 can incorrectly return empty.
    isFrompb: true, recruitType: 1, pageSize: 15, currentPage: page,
  }, { allowedHosts: [HOST], timeoutMs: 20_000, referer: hotjobCampusUrl(suiteId) }));
}

export interface HotjobCollectionResult {
  suiteId: string;
  campusUrl: string;
  postings: ParsedPostingInput[];
  discovered: number;
  warnings: string[];
  applicationLimit: ExtractedApplicationLimit | null;
  rulesPageChecked: boolean;
}

export async function collectHotjobCompany(input: { companyName: string; sourceUrl: string }): Promise<HotjobCollectionResult> {
  const suiteId = hotjobSuiteId(input.sourceUrl);
  if (!suiteId) throw new Error("不是受支持的 Hotjob 招聘链接");
  const campusUrl = hotjobCampusUrl(suiteId);
  const first = await readListPage(suiteId, 1);
  const postIds = [...first.postIds];
  for (let page = 2; page <= first.totalPages; page += 1) {
    postIds.push(...(await readListPage(suiteId, page)).postIds);
  }
  const uniquePostIds = [...new Set(postIds)];
  const postings: ParsedPostingInput[] = [];
  const warnings: string[] = [];
  for (const postId of uniquePostIds) {
    try {
      const detailApi = `https://${HOST}/wecruit/positionInfo/listPositionDetail/${suiteId}?iSaJAx=isAjax&request_locale=zh_CN`;
      const payload = await postFormJson(detailApi, { postId, recruitType: 1 }, {
        allowedHosts: [HOST], timeoutMs: 20_000, referer: hotjobDetailUrl(suiteId, postId),
      });
      const posting = parseHotjobDetailResponse(payload, { suiteId, companyName: input.companyName });
      if (posting) postings.push(posting);
    } catch (error) {
      warnings.push(`${postId}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let applicationLimit: ExtractedApplicationLimit | null = null;
  let rulesPageChecked = false;
  try {
    const page = await fetchHtml(campusUrl, { allowedHosts: [HOST], timeoutMs: 20_000 });
    const $ = cheerio.load(page.html);
    $("script,style,noscript").remove();
    applicationLimit = extractApplicationLimit($("body").text());
    rulesPageChecked = true;
  } catch (error) {
    warnings.push(`投递规则：${error instanceof Error ? error.message : String(error)}`);
  }
  return { suiteId, campusUrl, postings, discovered: uniquePostIds.length, warnings, applicationLimit, rulesPageChecked };
}
