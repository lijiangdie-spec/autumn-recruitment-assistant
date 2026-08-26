const COMPANY_ALIASES = new Map<string, string>([
  ["易方达基金", "易方达基金管理有限公司"],
  ["易方达", "易方达基金管理有限公司"],
]);

function cleanCompanyName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u00a0\s]+/g, " ")
    .replace(/\s*([()])\s*/g, "$1")
    .trim();
}

export function canonicalCompanyName(value: string): string {
  const cleaned = cleanCompanyName(value);
  return COMPANY_ALIASES.get(cleaned) ?? cleaned;
}

export function normalizeCompanyKey(value: string): string {
  return cleanCompanyName(value)
    .replace(/\s+/g, "")
    .replace(/(?:股份有限公司|有限责任公司|有限公司)$/u, "")
    .toLowerCase();
}
