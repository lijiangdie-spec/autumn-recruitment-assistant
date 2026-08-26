import { readPreferencesSync } from "@/lib/config/store";
import type { JobPreferences } from "@/lib/config/schema";
import type { ParsedPostingInput, RoleFamily, VerificationStatus } from "@/lib/types";

const ALL_KNOWN_CITIES = [
  "北京", "上海", "天津", "重庆", "广州", "深圳", "杭州", "南京", "苏州", "无锡", "宁波", "武汉", "成都", "西安", "长沙", "合肥", "厦门", "福州", "济南", "青岛", "郑州", "大连", "沈阳", "长春", "哈尔滨", "石家庄", "太原", "南昌", "南宁", "昆明", "贵阳", "海口", "珠海", "佛山", "东莞", "香港", "澳门", "台北", "新加坡",
] as const;
const NATIONWIDE_MARKERS = ["全国", "多地", "地点不限", "远程"];

export interface FilterDecision {
  roleFamily: RoleFamily | "待分类";
  verificationStatus: VerificationStatus;
  hardRejectReasons: string[];
  matchedRoleSignals: string[];
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[\t\r ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function includesKeyword(text: string, keyword: string): boolean {
  return text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
}

export function extractCities(text: string): string[] {
  const normalized = normalizeWhitespace(text);
  const found: string[] = ALL_KNOWN_CITIES.filter((city) => normalized.includes(city));
  for (const marker of NATIONWIDE_MARKERS) if (normalized.includes(marker)) found.push(marker);
  return [...new Set(found)];
}

export function extractCohort(text: string): string | null {
  const fullYear = text.match(/\b(20\d{2})\s*届/i)?.[1];
  if (fullYear) return `${fullYear}届`;
  const shortYear = text.match(/(?:^|\D)(\d{2})\s*届/i)?.[1];
  return shortYear ? `20${shortYear}届` : null;
}

export function inferEmploymentType(text: string): ParsedPostingInput["employmentType"] {
  const normalized = normalizeWhitespace(text);
  const headline = normalized.split("\n").slice(0, 3).join("\n");
  if (/实习生|日常实习|暑期实习|实习岗位|intern(?:ship)?\b/i.test(headline)) return "internship";
  if (/校招|校园招聘|秋招|春招|应届|\d{2,4}\s*届|graduate\s+program/i.test(normalized)) return "campus";
  if (/实习生|日常实习|暑期实习|实习岗位|intern(?:ship)?\b/i.test(normalized)) return "internship";
  return "unknown";
}

export function classifyRole(text: string, preferences: JobPreferences = readPreferencesSync().job): { family: RoleFamily | "待分类"; signals: string[] } {
  const signals = preferences.roleKeywords.filter((keyword) => includesKeyword(text, keyword));
  if (signals.length > 0) return { family: signals[0], signals };
  const title = normalizeWhitespace(text.split("\n")[0] ?? "");
  return { family: title || "待分类", signals: [] };
}

export function isInMonitoringWindow(publishedAt: string | null, deadlineAt: string | null): boolean {
  const configured = process.env.AUTUMN_ASSISTANT_MONITOR_START?.trim();
  if (!configured || !publishedAt) return true;
  const start = Date.parse(configured);
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(published) || published >= start) return true;
  const deadline = Date.parse(deadlineAt ?? "");
  return Number.isFinite(deadline) && deadline >= start;
}

export function applyHardFilters(input: ParsedPostingInput, preferences: JobPreferences = readPreferencesSync().job): FilterDecision {
  const text = normalizeWhitespace([input.company, input.title, input.cohort ?? "", input.cities.join(","), input.jdText].join("\n"));
  const hardRejectReasons: string[] = [];
  const role = classifyRole(`${input.title}\n${input.jdText}`, preferences);

  if (input.applicationAvailable === false) hardRejectReasons.push("来源显示岗位当前不可投递");
  if (!isInMonitoringWindow(input.publishedAt, input.deadlineAt)) hardRejectReasons.push("岗位早于自定义监控起点且已无法确认仍可投");
  const excluded = preferences.excludedKeywords.filter((keyword) => includesKeyword(text, keyword));
  if (excluded.length > 0) hardRejectReasons.push(`命中排除关键词：${excluded.join("、")}`);
  const missingRequired = preferences.requiredKeywords.filter((keyword) => !includesKeyword(text, keyword));
  if (missingRequired.length > 0) hardRejectReasons.push(`缺少必须关键词：${missingRequired.join("、")}`);
  if (preferences.roleKeywords.length > 0 && role.signals.length === 0) hardRejectReasons.push("未匹配已配置的目标岗位关键词");

  const nationwide = input.cities.some((city) => NATIONWIDE_MARKERS.some((marker) => city.includes(marker)));
  const targetCity = preferences.cities.some((wanted) => input.cities.some((city) => includesKeyword(city, wanted) || includesKeyword(wanted, city)));
  if (preferences.cities.length > 0 && !targetCity && !nationwide) hardRejectReasons.push(input.cities.length ? "工作地点不在已配置的目标城市中" : "工作地点未注明");
  if (preferences.cohorts.length > 0 && input.cohort && !preferences.cohorts.some((cohort) => includesKeyword(input.cohort!, cohort) || includesKeyword(cohort, input.cohort!))) hardRejectReasons.push(`招聘对象为${input.cohort}，与已配置届别不符`);
  if (preferences.employmentTypes.length > 0 && !preferences.employmentTypes.includes(input.employmentType)) hardRejectReasons.push("岗位类型不在已配置范围中");

  let verificationStatus: VerificationStatus = "verified";
  if (!input.publishedAt) verificationStatus = "date_pending";
  else if (preferences.cities.length > 0 && input.cities.length === 0) verificationStatus = "city_pending";
  else if (preferences.cohorts.length > 0 && !input.cohort) verificationStatus = "cohort_pending";
  return { roleFamily: role.family, verificationStatus, hardRejectReasons: [...new Set(hardRejectReasons)], matchedRoleSignals: role.signals };
}

export function isRoleFamily(value: string): value is RoleFamily { return Boolean(value.trim()); }
