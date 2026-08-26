import { describe, expect, it } from "vitest";

import { assessJdParseStatus } from "@/lib/jd-completeness";

describe("JD 完整度", () => {
  it("只有同时包含职责与要求的充分正文才算完整 JD", () => {
    expect(assessJdParseStatus(`岗位职责：${"负责风险模型、数据分析与组合监控。".repeat(8)}\n任职要求：硕士及以上，熟悉 Python 与统计学习。`)).toBe("parsed");
  });

  it("汇总表专业提示或短摘要只算部分 JD", () => {
    expect(assessJdParseStatus(`公司：易方达\n岗位：量化投资\n汇总表岗位信息：${"金融工程、数学、统计学；".repeat(12)}`)).toBe("partial");
    expect(assessJdParseStatus("")).toBe("missing");
  });
});
