import { normalizeWhitespace } from "@/lib/filters";

const CHINESE_NUMBERS: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

export interface ExtractedApplicationLimit {
  maxApplications: number;
  evidence: string;
}

function parseCount(value: string): number | null {
  if (/^\d+$/.test(value)) {
    const count = Number(value);
    return count > 0 && count <= 100 ? count : null;
  }
  return CHINESE_NUMBERS[value] ?? null;
}

export function extractApplicationLimit(text: string): ExtractedApplicationLimit | null {
  const normalized = normalizeWhitespace(text);
  const patterns = [
    /(?:每(?:位|名)?(?:同学|候选人|应聘者|申请人)?|单个账号)?[^。；;\n]{0,18}(?:最多|至多|限|仅可|只能)[^。；;\n]{0,10}(?:投递|申请|填报|选择)?\s*([1-9]\d?|[一二两三四五六七八九十])\s*(?:个|项|份|条)?(?:岗位|职位|志愿)/i,
    /(?:岗位|职位|志愿)[^。；;\n]{0,12}(?:上限|最多)[^。；;\n]{0,6}([1-9]\d?|[一二两三四五六七八九十])\s*(?:个|项|份|条)?/i,
    /(?:可投递|可申请|可填报)[^。；;\n]{0,8}([1-9]\d?|[一二两三四五六七八九十])\s*(?:个|项|份|条)?(?:岗位|职位|志愿)/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const count = match?.[1] ? parseCount(match[1]) : null;
    if (!match || count === null) continue;
    return { maxApplications: count, evidence: match[0].trim() };
  }
  return null;
}
