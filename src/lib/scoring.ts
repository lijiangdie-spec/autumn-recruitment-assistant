import { createHash } from "node:crypto";

import { readPreferencesSync } from "@/lib/config/store";
import type { JobPreferences } from "@/lib/config/schema";
import { applyHardFilters, normalizeWhitespace } from "@/lib/filters";
import type { ParsedPostingInput, Posting, RoleFamily, VerificationStatus } from "@/lib/types";

export interface ScoreBreakdown { eligibility: number; roleAlignment: number; skills: number; experience: number }
export interface EvaluatedPostingInput extends ParsedPostingInput {
  roleFamily: RoleFamily | "待分类";
  verificationStatus: VerificationStatus;
  status: Posting["status"];
  fitScore: number;
  fitReasons: string[];
  gapReasons: string[];
  hardRejectReasons: string[];
  contentHash: string;
  fingerprint: string;
}

function keywordCoverage(text: string, keywords: string[]): { score: number; matched: string[] } {
  if (keywords.length === 0) return { score: 70, matched: [] };
  const matched = keywords.filter((keyword) => text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()));
  return { score: Math.round(matched.length / keywords.length * 100), matched };
}

export function canonicalizeUrl(value: string): string {
  if (value.startsWith("manual://")) return value;
  try {
    const url = new URL(value); url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|from$|source$|spm$|ref$|share_)/i.test(key)) url.searchParams.delete(key);
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch { return value.trim(); }
}

export function hashText(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

export function evaluatePosting(input: ParsedPostingInput, now = new Date(), preferences: JobPreferences = readPreferencesSync().job): EvaluatedPostingInput {
  const normalizedInput: ParsedPostingInput = {
    ...input,
    company: normalizeWhitespace(input.company) || "公司待核验",
    title: normalizeWhitespace(input.title) || "岗位待核验",
    cities: [...new Set(input.cities.map((city) => normalizeWhitespace(city)).filter(Boolean))],
    jdText: normalizeWhitespace(input.jdText),
    sourceUrl: canonicalizeUrl(input.sourceUrl),
    officialUrl: input.officialUrl ? canonicalizeUrl(input.officialUrl) : null,
    applyUrl: input.applyUrl ? canonicalizeUrl(input.applyUrl) : null,
    applicationAvailable: input.applicationAvailable ?? null,
  };
  const decision = applyHardFilters(normalizedInput, preferences);
  const text = [normalizedInput.company, normalizedInput.title, normalizedInput.jdText].join("\n");
  const criteria: Array<{ label: string; score: number; reason: string }> = [];

  if (preferences.roleKeywords.length > 0) {
    const coverage = keywordCoverage(text, preferences.roleKeywords);
    criteria.push({ label: "岗位方向", score: coverage.score, reason: coverage.matched.length ? `匹配 ${coverage.matched.join("、")}` : "未匹配目标岗位关键词" });
  }
  if (preferences.cities.length > 0) {
    const matched = preferences.cities.filter((wanted) => normalizedInput.cities.some((city) => city.includes(wanted) || wanted.includes(city)));
    criteria.push({ label: "城市", score: matched.length ? 100 : normalizedInput.cities.length ? 0 : 40, reason: matched.length ? `匹配 ${matched.join("、")}` : "未匹配目标城市" });
  }
  if (preferences.cohorts.length > 0) criteria.push({ label: "届别", score: normalizedInput.cohort && preferences.cohorts.some((item) => normalizedInput.cohort!.includes(item) || item.includes(normalizedInput.cohort!)) ? 100 : normalizedInput.cohort ? 0 : 40, reason: normalizedInput.cohort || "届别待核验" });
  if (preferences.employmentTypes.length > 0) criteria.push({ label: "岗位类型", score: preferences.employmentTypes.includes(normalizedInput.employmentType) ? 100 : 0, reason: normalizedInput.employmentType });
  if (preferences.requiredKeywords.length > 0) {
    const coverage = keywordCoverage(text, preferences.requiredKeywords);
    criteria.push({ label: "必须条件", score: coverage.score, reason: coverage.matched.length ? `已出现 ${coverage.matched.join("、")}` : "必须条件未出现" });
  }
  for (const dimension of preferences.dimensions) {
    const coverage = keywordCoverage(text, dimension.keywords);
    criteria.push({ label: dimension.label, score: coverage.score, reason: coverage.matched.length ? `匹配 ${coverage.matched.join("、")}` : "尚无匹配证据" });
  }

  const baseScore = criteria.length ? Math.round(criteria.reduce((sum, item) => sum + item.score, 0) / criteria.length) : 70;
  const hardPenalty = Math.min(100, decision.hardRejectReasons.length * 35);
  const fitScore = Math.max(0, baseScore - hardPenalty);
  const fitReasons = criteria.map((item) => `${item.label} ${item.score}：${item.reason}`);
  if (criteria.length === 0) fitReasons.push("尚未配置岗位偏好，采用中性基础分；请在设置中补充筛选规则");
  if (hardPenalty) fitReasons.push(`硬性偏好 -${hardPenalty}：存在 ${decision.hardRejectReasons.length} 项冲突`);
  const gapReasons = criteria.filter((item) => item.score < 100).map((item) => `${item.label}：${item.reason}`);

  let status: Posting["status"] = "unknown";
  if (normalizedInput.deadlineAt) status = Date.parse(normalizedInput.deadlineAt) < now.getTime() ? "closed" : "open";
  const fingerprintBasis = [normalizedInput.company.toLocaleLowerCase().replace(/\s+/g, ""), ...(normalizedInput.sourceJobId ? ["source-job", normalizedInput.sourceJobId] : [normalizedInput.title.toLocaleLowerCase().replace(/\s+/g, ""), normalizedInput.cities.slice().sort().join(","), normalizedInput.cohort ?? "cohort-pending"])].join("|");
  const contentBasis = [normalizedInput.company, normalizedInput.sourceJobId ?? "", normalizedInput.title, normalizedInput.cities.join(","), normalizedInput.cohort ?? "", normalizedInput.publishedAt ?? "", normalizedInput.deadlineAt ?? "", normalizedInput.jdText, normalizedInput.sourceUrl, normalizedInput.officialUrl ?? "", normalizedInput.applyUrl ?? "", normalizedInput.applicationAvailable === null ? "" : String(normalizedInput.applicationAvailable)].join("\n");

  return { ...normalizedInput, roleFamily: decision.roleFamily, verificationStatus: decision.verificationStatus, status, fitScore, fitReasons, gapReasons: [...new Set(gapReasons)], hardRejectReasons: decision.hardRejectReasons, contentHash: hashText(contentBasis), fingerprint: hashText(fingerprintBasis) };
}
