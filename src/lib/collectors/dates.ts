export const SHANGHAI_OFFSET = "+08:00";

export function normalizeDate(value: string | null | undefined, endOfDay = false): string | null {
  if (!value) return null;
  const match = value.match(/(20\d{2})[年/.\-](\d{1,2})[月/.\-](\d{1,2})日?/);
  if (!match) return null;
  const [, year, month, day] = match;
  const isoDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const timestamp = Date.parse(`${isoDate}T00:00:00${SHANGHAI_OFFSET}`);
  if (!Number.isFinite(timestamp)) return null;
  const check = new Date(timestamp);
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(check);
  if (local !== isoDate) return null;
  return `${isoDate}T${endOfDay ? "23:59:59" : "00:00:00"}${SHANGHAI_OFFSET}`;
}

export function extractExplicitPublishedDate(text: string): string | null {
  const match = text.match(/(?:发布日期|发布时间|发布于|date\s*posted|date\s*published)\s*[：:]?\s*((?:20\d{2})[年/.\-]\d{1,2}[月/.\-]\d{1,2}日?)/i);
  return normalizeDate(match?.[1]);
}

export function extractExplicitDeadline(text: string): string | null {
  const match = text.match(/(?:截止日期|网申截止|申请截止|投递截止|报名截止|截止时间|valid\s*through)\s*[：:]?\s*((?:20\d{2})[年/.\-]\d{1,2}[月/.\-]\d{1,2}日?)/i);
  return normalizeDate(match?.[1], true);
}

export function overlapCursor(lastSuccessfulRefreshAt: string | null, startAt: string): string {
  if (!lastSuccessfulRefreshAt) return startAt;
  const overlap = new Date(Date.parse(lastSuccessfulRefreshAt) - 24 * 60 * 60 * 1000);
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(overlap);
  // The source only exposes day-level publication dates. Floor the overlap to
  // Shanghai midnight so a record from that calendar day is not lost.
  const dayStart = `${dateParts}T00:00:00${SHANGHAI_OFFSET}`;
  return Date.parse(dayStart) < Date.parse(startAt) ? startAt : dayStart;
}
