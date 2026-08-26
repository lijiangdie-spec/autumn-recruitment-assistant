import type { Posting } from "@/lib/types";

export function formatJobNumber(job: Pick<Posting, "companyId" | "jobSequence">): string {
  if (!job.companyId || job.jobSequence < 1) return "待编号";
  return `${job.companyId}-${job.jobSequence}`;
}

type IneligibilityPosting = Pick<Posting, "effectiveDisposition" | "hardRejectReasons"> & Partial<Pick<
  Posting,
  "scoreRecommendation" | "scoreReasons" | "gapReasons" | "applicationAvailable" | "employmentType" | "cohort" | "roleFamily" | "cities"
>>;

function compactReason(value: string): string {
  const sentence = value.trim().split(/[。！？!?\r\n]+/, 1)[0]?.trim() ?? "";
  return sentence
    .replace(/^(?:资格不符|上岸概率\s*0|方向|技能|资格|城市|届次|岗位类型|可投状态)\s*[：:]\s*/i, "")
    .replace(/[；;\s]+$/g, "")
    .trim();
}

function inferredReasons(posting: IneligibilityPosting): string[] {
  const reasons: string[] = [];
  if (posting.applicationAvailable === false) reasons.push("官网当前不可投递");
  if (posting.roleFamily === "待分类") reasons.push("岗位方向尚未分类");
  if (posting.cities?.length === 0) reasons.push("工作地点尚未注明");
  return reasons;
}

export function postingIneligibilityNote(
  posting: IneligibilityPosting,
): string | null {
  if (posting.effectiveDisposition.reason !== "ineligible" && posting.scoreRecommendation !== "ineligible") return null;

  const scoreReasons = (posting.scoreReasons ?? []).filter((reason) =>
    /^(?:资格不符|上岸概率\s*0)\s*[：:]/i.test(reason.trim()),
  );
  const candidates = [
    ...posting.hardRejectReasons,
    ...scoreReasons,
    ...(posting.gapReasons ?? []),
    ...inferredReasons(posting),
  ];
  const reasons = [...new Set(candidates.map(compactReason).filter(Boolean))].slice(0, 2);
  const detail = reasons.length > 0
    ? reasons.join("；")
    : "岗位方向、资格或城市信息不足，需补充完整 JD 后复核";
  return `不符合：${detail}。`;
}
