import { z } from "zod";

import { normalizeDate } from "@/lib/collectors/dates";
import { postJson } from "@/lib/collectors/http";
import { CollectionError, type CollectorResult, type CollectorSource } from "@/lib/collectors/types";
import { normalizeWhitespace } from "@/lib/filters";
import type { ParsedPostingInput } from "@/lib/types";

const RECRUITMENT_HOST = "wjasset.zhiye.com";
const CAMPUS_URL = `https://${RECRUITMENT_HOST}/campus/jobs`;
const API_URL = `https://${RECRUITMENT_HOST}/api/Jobad/GetJobAdPageList`;
const PORTAL_ID = "21f34594-9c9e-449f-857a-adc9cfde7690";

export const WANJIA_SOURCE: CollectorSource = {
  name: "万家基金 · 官方校园招聘",
  type: "official",
  trust: "official",
  employmentType: "campus",
  url: CAMPUS_URL,
};

const jobSchema = z.object({
  Id: z.string().min(1),
  JobAdId: z.number().int(),
  JobAdName: z.string().min(1),
  Category: z.string().nullish(),
  Kind: z.string().nullish(),
  LocNames: z.array(z.string()).nullish(),
  Duty: z.string().nullish(),
  Require: z.string().nullish(),
  Degree: z.string().nullish(),
  PostDate: z.string().nullish(),
  EndTime: z.string().nullish(),
  ChangeDate: z.string().nullish(),
  Status: z.number().int().nullish(),
}).passthrough();

const responseSchema = z.object({
  Code: z.union([z.number(), z.string()]),
  Count: z.number().int().nonnegative().optional(),
  Data: z.array(jobSchema),
}).passthrough();

type WanjiaJob = z.infer<typeof jobSchema>;

function normalizeCity(value: string): string {
  return normalizeWhitespace(value).replace(/(?:市|特别行政区)$/u, "");
}

function detailUrl(id: string): string {
  const url = new URL(`https://${RECRUITMENT_HOST}/campus/detail`);
  url.searchParams.set("jobAdId", id);
  return url.toString();
}

function toPosting(job: WanjiaJob, source: CollectorSource): ParsedPostingInput {
  const officialUrl = detailUrl(job.Id);
  const cities = [...new Set((job.LocNames ?? []).map(normalizeCity).filter(Boolean))];
  const jdText = normalizeWhitespace([
    job.Category ? `招聘类别：${job.Category}` : "",
    job.Kind ? `岗位性质：${job.Kind}` : "",
    job.Degree ? `学历要求：${job.Degree}` : "",
    job.Duty ? `岗位职责\n${job.Duty}` : "",
    job.Require ? `任职要求\n${job.Require}` : "",
    job.ChangeDate ? `官网记录更新时间（非发布日期）：${job.ChangeDate}` : "",
    `官网岗位编号：${job.JobAdId}`,
  ].filter(Boolean).join("\n\n"));

  return {
    company: "万家基金管理有限公司",
    title: normalizeWhitespace(job.JobAdName),
    cities,
    // The official campaign is the 2027 campus recruitment round; its year is
    // corroborated by the public campus announcement linked from the employer.
    cohort: "2027届",
    employmentType: "campus",
    // Request these display fields explicitly. Without them the vendor API
    // returns year-0001 sentinels, which must never be treated as real dates.
    publishedAt: normalizeDate(job.PostDate),
    deadlineAt: normalizeDate(job.EndTime, true),
    jdText,
    sourceUrl: officialUrl,
    officialUrl,
    applyUrl: officialUrl,
    sourceName: source.name,
    sourceTrust: source.trust,
  };
}

export function parseWanjiaResponse(payload: unknown, source: CollectorSource = WANJIA_SOURCE): ParsedPostingInput[] {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new CollectionError("万家基金官方接口结构已变化，未推进刷新游标。", "source_structure_changed");
  }
  if (Number(parsed.data.Code) !== 200) {
    throw new CollectionError(`万家基金官方接口返回业务状态 ${String(parsed.data.Code)}。`, "source_api_error");
  }

  return parsed.data.Data
    .filter((job) => job.Status == null || job.Status === 1)
    .map((job) => toPosting(job, source));
}

export async function collectWanjiaSource(source: CollectorSource = WANJIA_SOURCE): Promise<CollectorResult> {
  const payload = await postJson(API_URL, {
    PageIndex: 0,
    PageSize: 100,
    Category: ["2"],
    KeyWords: "",
    SpecialType: 0,
    PortalId: PORTAL_ID,
    DisplayFields: ["Category", "Kind", "LocId", "PostDate", "EndTime", "Degree"],
  }, {
    allowedHosts: [RECRUITMENT_HOST],
    timeoutMs: 20_000,
  });
  const postings = parseWanjiaResponse(payload, source);
  return { source, postings, discovered: postings.length, warnings: [] };
}
