import { extractCities, normalizeWhitespace } from "@/lib/filters";
import { assistantPath } from "@/lib/config/paths";

export function defaultImportDirectory(): string {
  return process.env.RECRUITMENT_IMPORT_DIRECTORY ?? assistantPath("imports");
}
export const IMPORT_SHEET_NAME = process.env.RECRUITMENT_IMPORT_SHEET_NAME ?? "岗位信息";

const GENERIC_TECH =
  /^(?:AI|人工智能|算法|软件|研发|技术|信息技术|计算机|开发|产品|运营|职能|管理|市场|营销|综合|业务)(?:类|方向|岗位|岗位类)?$/i;
const BROAD_ROLE = /(?:^|[-—/（(])(?:技术|研发|产品|运营|职能|管理|市场|营销|业务|综合)(?:类|方向|岗位类?)(?:$|[）)])|等岗位|多个岗位|若干岗位/i;
const BROAD_FINANCE_ROLE = /^(?:金融科技|金融|量化|风控|合规风控|风控合规|风险管理|风险控制|风险合规|科技管培生)(?:类|方向|岗|岗位|岗位类|专员|综合岗)?$/i;
const BROAD_ENTRY = /^(?:具体岗位(?:见|详见)(?:投递)?链接|岗位详情(?:见|详见)(?:投递)?链接|(?:具体)?岗位(?:详情)?以(?:官网|招聘官网|投递链接)(?:为准)?|.*具体岗位(?:见|详见)(?:官网|招聘官网).*)$/i;

export interface SpreadsheetRowInput {
  company: string;
  companyType: string;
  industry: string;
  roles: string;
  cities: string;
  aiDetail: string;
  cohort: string;
  degree: string;
  category: string;
}

export interface ProfileDecision {
  roleTitles: string[];
  cities: string[];
  shouldCreateCompanyLink: boolean;
  reason: string;
}

export function splitRoleTitles(value: string): string[] {
  const normalized = normalizeWhitespace(value)
    .replace(/^招聘岗位[：:]?\s*/i, "")
    .replace(/[【】]/g, "");
  return [...new Set(
    normalized
      .split(/[、,，;；|\n]+/)
      .map((part) => part.replace(/^\d+[.、)]\s*/, "").trim())
      .filter((part) => part.length >= 2 && part.length <= 80),
  )];
}

export function evaluateSpreadsheetRow(row: SpreadsheetRowInput): ProfileDecision {
  const cities = extractCities(row.cities);
  const roleTitles = splitRoleTitles(row.roles).filter((title) => {
    if (GENERIC_TECH.test(title) || BROAD_ROLE.test(title) || BROAD_FINANCE_ROLE.test(title) || BROAD_ENTRY.test(title)) return false;
    return true;
  });

  if (roleTitles.length > 0) {
    return { roleTitles, cities, shouldCreateCompanyLink: false, reason: `已拆分出 ${roleTitles.length} 个明确岗位；适配性在岗位入库后判定` };
  }

  const broadButRelevant = splitRoleTitles(row.roles).some((title) =>
    GENERIC_TECH.test(title) || BROAD_ROLE.test(title) || BROAD_FINANCE_ROLE.test(title) || BROAD_ENTRY.test(title));
  return {
    roleTitles: [],
    cities,
    shouldCreateCompanyLink: Boolean(row.roles.trim()),
    reason: broadButRelevant ? "表内只有宽泛岗位分类，保留公司招聘与投递入口以待解析" : "未能拆分具体岗位，保留原始入口以待解析",
  };
}
