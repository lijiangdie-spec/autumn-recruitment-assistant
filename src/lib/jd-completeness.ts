import type { JdParseStatus } from "@/lib/types";

const DUTY_SIGNAL = /岗位职责|工作职责|职位描述|岗位描述|工作内容|岗位方向|职责描述|主要职责|负责/u;
const REQUIREMENT_SIGNAL = /任职要求|岗位要求|任职资格|资格条件|应聘条件|学历要求|专业要求|技能要求|要求[：:]/u;

export function assessJdParseStatus(text: string): JdParseStatus {
  const normalized = text.trim();
  if (!normalized) return "missing";
  return normalized.length >= 120 && DUTY_SIGNAL.test(normalized) && REQUIREMENT_SIGNAL.test(normalized)
    ? "parsed"
    : "partial";
}
