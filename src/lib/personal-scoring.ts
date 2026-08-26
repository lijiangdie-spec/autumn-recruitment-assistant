import type { JobPreferences } from "@/lib/config/schema";
import type { RoleFamily } from "@/lib/types";

export const CURRENT_PERSONAL_SCORE_VERSION = 3;
export const INTERN_ASSESSMENT_SCORE_REASON = "实习考察：岗位包含转正或留用前考察期";
export type ScoreRecommendation = "apply" | "skip" | "ineligible";
export interface PersonalScoreOverrides {
  workContent?: number;
  fiveYearGrowth?: number;
  /** @deprecated 旧数据库兼容字段，不再参与通用评分。 */
  annualCompWan?: number;
  /** @deprecated 旧数据库兼容字段，不再参与通用评分。 */
  workLifeBand?: string;
  /** @deprecated 旧数据库兼容字段，不再参与通用评分。 */
  institutionType?: string;
}
export interface PersonalScoreInput { company: string; title: string; cities: string[]; jdText: string; roleFamily: RoleFamily | "待分类"; fitScore: number; hardRejectReasons: string[]; deadlineAt: string | null }
export interface PersonalScoreBreakdown { workContent: number; fiveYearGrowth: number; currentComp: number; workLifeBalance: number; platformStability: number; cityPreference: number }
export interface PersonalScoreResult { personalScore: number; landingProbability: number; recommendation: ScoreRecommendation; breakdown: PersonalScoreBreakdown; reasons: string[] }

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const contains = (text: string, keyword: string) => text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
const NEUTRAL_PREFERENCES: JobPreferences = { roleKeywords: [], excludedKeywords: [], cities: [], cohorts: [], employmentTypes: [], requiredKeywords: [], dimensions: [], recommendationThreshold: 60 };
export function hasInternAssessmentPenalty(reasons: string[]): boolean { return reasons.includes(INTERN_ASSESSMENT_SCORE_REASON); }

/** @deprecated 保留给旧版迁移测试；通用评分不再推测薪资。 */
export function scoreAnnualComp(value: number): number {
  const anchors: Array<[number, number]> = [[20, 0], [25, 30], [30, 65], [32, 80], [35, 80], [40, 90], [50, 95], [60, 100]];
  if (value <= anchors[0][0]) return anchors[0][1];
  for (let index = 1; index < anchors.length; index += 1) {
    const [rightValue, rightScore] = anchors[index];
    if (value <= rightValue) {
      const [leftValue, leftScore] = anchors[index - 1];
      return leftScore + (rightScore - leftScore) * ((value - leftValue) / (rightValue - leftValue));
    }
  }
  return 100;
}

export function validateScoreOverrides(value: unknown): PersonalScoreOverrides {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("评分覆盖格式无效");
  const raw = value as Record<string, unknown>;
  const result: PersonalScoreOverrides = {};
  for (const key of ["workContent", "fiveYearGrowth"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "number" || !Number.isFinite(raw[key]) || raw[key] < 0 || raw[key] > 100) throw new Error(`${key} 必须是 0–100 的数字`);
    result[key] = raw[key];
  }
  return result;
}

function coverage(text: string, keywords: string[], neutral = 70): number {
  if (keywords.length === 0) return neutral;
  return Math.round(keywords.filter((keyword) => contains(text, keyword)).length / keywords.length * 100);
}

export function evaluatePersonalScore(input: PersonalScoreInput, overrides: PersonalScoreOverrides = {}, preferences: JobPreferences = NEUTRAL_PREFERENCES): PersonalScoreResult {
  const normalized = validateScoreOverrides(overrides);
  const text = `${input.company}\n${input.title}\n${input.jdText}`;
  const roleAlignment = normalized.workContent ?? coverage(text, preferences.roleKeywords);
  const requiredCoverage = normalized.fiveYearGrowth ?? coverage(text, preferences.requiredKeywords);
  const customDimensions = preferences.dimensions.length ? Math.round(preferences.dimensions.reduce((sum, dimension) => sum + coverage(text, dimension.keywords), 0) / preferences.dimensions.length) : 70;
  const jdCompleteness = clamp(35 + Math.log10(Math.max(1, input.jdText.length)) * 20);
  const sourceConfidence = clamp(input.fitScore);
  const cityPreference = preferences.cities.length === 0 ? 70 : input.cities.some((city) => preferences.cities.some((wanted) => contains(city, wanted) || contains(wanted, city))) ? 100 : input.cities.length ? 0 : 40;
  const personalScore = Math.round(clamp(roleAlignment * .30 + requiredCoverage * .20 + customDimensions * .20 + jdCompleteness * .10 + sourceConfidence * .10 + cityPreference * .10));
  const ineligible = input.hardRejectReasons.length > 0 || (input.deadlineAt ? Date.parse(input.deadlineAt) < Date.now() : false);
  const landingProbability = ineligible ? 0 : Math.round(clamp((personalScore + input.fitScore) / 2));
  const recommendation: ScoreRecommendation = ineligible ? "ineligible" : personalScore >= preferences.recommendationThreshold ? "apply" : "skip";
  const reasons = [`岗位方向 ${Math.round(roleAlignment)}：按你配置的岗位关键词计算`, `必须条件 ${Math.round(requiredCoverage)}：按必须关键词覆盖率计算`, `自定义维度 ${Math.round(customDimensions)}：${preferences.dimensions.length ? "按自定义关键词维度计算" : "尚未配置，使用中性值"}`, `JD 完整度 ${Math.round(jdCompleteness)}：按可核验正文计算`, `来源匹配 ${Math.round(sourceConfidence)}：沿用通用偏好匹配结果`, `城市偏好 ${cityPreference}：${preferences.cities.length ? (input.cities.join(" / ") || "地点待核验") : "尚未限制城市"}`];
  if (input.hardRejectReasons.length) reasons.push(`资格不符：${input.hardRejectReasons.join("；")}`);
  return { personalScore, landingProbability, recommendation, breakdown: { workContent: Math.round(roleAlignment), fiveYearGrowth: Math.round(requiredCoverage), currentComp: Math.round(customDimensions), workLifeBalance: Math.round(jdCompleteness), platformStability: Math.round(sourceConfidence), cityPreference }, reasons };
}

export function comparePersonalPriority<T extends { personalScore: number; landingProbability: number; deadlineAt: string | null }>(left: T, right: T): number {
  if (left.personalScore !== right.personalScore) return right.personalScore - left.personalScore;
  const leftDeadline = Date.parse(left.deadlineAt ?? "") || Number.POSITIVE_INFINITY;
  const rightDeadline = Date.parse(right.deadlineAt ?? "") || Number.POSITIVE_INFINITY;
  if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
  return right.landingProbability - left.landingProbability;
}
