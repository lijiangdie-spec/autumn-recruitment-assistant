import { z } from "zod";

import { normalizeDate } from "@/lib/collectors/dates";
import { postFormJson } from "@/lib/collectors/http";
import { CollectionError, type CollectorResult, type CollectorSource } from "@/lib/collectors/types";
import { extractCohort, normalizeWhitespace } from "@/lib/filters";
import type { ParsedPostingInput } from "@/lib/types";

const HOST = "wecruit.hotjob.cn";
const SUITE_ID = "SU625527c30dcad4021443cdda";
const CAMPUS_URL = `https://${HOST}/${SUITE_ID}/pb/school.html`;
const LIST_API = `https://${HOST}/wecruit/positionInfo/listPosition/${SUITE_ID}?iSaJAx=isAjax&request_locale=zh_CN`;
const DETAIL_API = `https://${HOST}/wecruit/positionInfo/listPositionDetail/${SUITE_ID}?iSaJAx=isAjax&request_locale=zh_CN`;

export const GUANGFA_SOURCE: CollectorSource = {
  name: "广发证券 · 官方校园招聘",
  type: "official",
  trust: "official",
  employmentType: "campus",
  url: CAMPUS_URL,
};

const listJobSchema = z.object({
  postId: z.string().min(1),
  postName: z.string().nullish(),
  projectName: z.string().nullish(),
  recruitType: z.number().int().nullish(),
}).passthrough();

const listResponseSchema = z.object({
  state: z.union([z.string(), z.number()]),
  data: z.object({
    pageForm: z.object({
      pageData: z.array(listJobSchema),
      totalPage: z.number().int().positive().default(1),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

const workPlaceSchema = z.object({ name: z.string().min(1) }).passthrough();
const detailSchema = z.object({
  postId: z.string().min(1),
  postName: z.string().min(1),
  projectName: z.string().nullish(),
  projectId: z.union([z.number(), z.string()]).nullish(),
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
  workPlaceList: z.array(workPlaceSchema).nullish(),
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

function detailUrl(postId: string): string {
  const url = new URL(`https://${HOST}/${SUITE_ID}/pb/posDetail.html`);
  url.searchParams.set("postId", postId);
  url.searchParams.set("postType", "campus");
  return url.toString();
}

export function parseGuangfaListResponse(payload: unknown): { postIds: string[]; totalPages: number } {
  const parsed = listResponseSchema.safeParse(payload);
  if (!parsed.success || !isSuccess(parsed.data?.state ?? 0)) {
    throw new CollectionError("广发证券校园招聘列表接口结构已变化。", "source_structure_changed");
  }
  const postIds = parsed.data.data.pageForm.pageData
    .filter((job) => job.recruitType === 1)
    .map((job) => job.postId);
  return { postIds: [...new Set(postIds)], totalPages: parsed.data.data.pageForm.totalPage };
}

export function parseGuangfaDetailResponse(
  payload: unknown,
  source: CollectorSource = GUANGFA_SOURCE,
): ParsedPostingInput | null {
  const parsed = detailResponseSchema.safeParse(payload);
  if (!parsed.success || !isSuccess(parsed.data?.state ?? 0)) {
    throw new CollectionError("广发证券岗位详情接口结构已变化。", "source_structure_changed");
  }
  const job = parsed.data.data;
  if (job.recruitType !== 1) return null;

  const officialUrl = detailUrl(job.postId);
  const cities = [...new Set([
    ...(job.workPlaceList ?? []).map((place) => normalizeCity(place.name)),
    ...splitCities(job.workPlaceStr),
  ].filter(Boolean))];
  const rawCompany = normalizeWhitespace(job.orgName ?? job.company ?? "");
  const company = !rawCompany || !/(?:公司|证券|银行|基金)/u.test(rawCompany)
    ? "广发证券股份有限公司"
    : rawCompany;
  const jdText = normalizeWhitespace([
    job.projectName ? `招聘项目：${job.projectName}` : "",
    rawCompany ? `所属单位：${rawCompany}` : "",
    job.department ? `所属部门：${job.department}` : "",
    job.postTypeName ? `岗位类别：${job.postTypeName}` : "",
    job.education ?? job.educationStr ? `学历要求：${job.education ?? job.educationStr}` : "",
    job.subject ? `专业要求：${job.subject}` : "",
    job.workContent ? `岗位方向\n${job.workContent}` : "",
    job.serviceCondition ? `岗位说明\n${job.serviceCondition}` : "",
    `官网岗位编号：${job.postId}`,
  ].filter(Boolean).join("\n\n"));

  return {
    sourceJobId: `${SUITE_ID}:${job.postId}`,
    company,
    title: normalizeWhitespace(job.postName),
    cities,
    cohort: extractCohort(`${job.projectName ?? ""}\n${job.postName}`),
    employmentType: "campus",
    publishedAt: normalizeDate(job.publishFirstDate ?? job.publishDate),
    deadlineAt: normalizeDate(job.endDate, true),
    jdText,
    jdParseStatus: job.workContent && job.serviceCondition ? "parsed" : job.workContent || job.serviceCondition ? "partial" : "failed",
    jdSourceUrl: officialUrl,
    jdParsedAt: job.workContent || job.serviceCondition ? new Date().toISOString() : null,
    sourceUrl: officialUrl,
    officialUrl,
    applyUrl: officialUrl,
    applicationAvailable: job.canDelivery === false || job.showDeliverButton === 0 ? false : true,
    sourceName: source.name,
    sourceTrust: source.trust,
  };
}

async function readListPage(page: number): Promise<{ postIds: string[]; totalPages: number }> {
  const payload = await postFormJson(LIST_API, {
    isFrompb: true,
    recruitType: 1,
    pageSize: 15,
    currentPage: page,
  }, {
    allowedHosts: [HOST],
    timeoutMs: 20_000,
    referer: CAMPUS_URL,
  });
  return parseGuangfaListResponse(payload);
}

export async function collectGuangfaSource(source: CollectorSource = GUANGFA_SOURCE): Promise<CollectorResult> {
  const firstPage = await readListPage(1);
  const postIds = [...firstPage.postIds];
  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    const result = await readListPage(page);
    postIds.push(...result.postIds);
  }

  const uniquePostIds = [...new Set(postIds)];
  const postings: ParsedPostingInput[] = [];
  const warnings: string[] = [];
  for (const postId of uniquePostIds) {
    try {
      const payload = await postFormJson(DETAIL_API, { postId, recruitType: 1 }, {
        allowedHosts: [HOST],
        timeoutMs: 20_000,
        referer: detailUrl(postId),
      });
      const posting = parseGuangfaDetailResponse(payload, source);
      if (posting) postings.push(posting);
    } catch (error) {
      warnings.push(`${postId}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (uniquePostIds.length > 0 && postings.length === 0 && warnings.length > 0) {
    throw new CollectionError("广发证券 2027 届岗位详情全部读取失败。", "source_detail_failed");
  }
  return { source, postings, discovered: uniquePostIds.length, warnings };
}
