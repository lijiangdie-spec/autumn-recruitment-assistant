export function isExpiredDeadline(deadlineAt: string | null | undefined, now = Date.now()): boolean {
  if (!deadlineAt) return false;
  const deadline = Date.parse(deadlineAt);
  return Number.isFinite(deadline) && deadline <= now;
}
