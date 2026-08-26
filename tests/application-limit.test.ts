import { describe, expect, it } from "vitest";

import { extractApplicationLimit } from "@/lib/companies/application-limit";

describe("官方投递数量上限提取", () => {
  it("提取阿拉伯数字和中文数字并保留证据", () => {
    expect(extractApplicationLimit("每位同学最多可投递 3 个岗位，提交后不可修改。"))
      .toMatchObject({ maxApplications: 3, evidence: expect.stringContaining("3 个岗位") });
    expect(extractApplicationLimit("每人限投两个职位，请谨慎选择。")?.maxApplications).toBe(2);
  });

  it("官方页面没有明确说明时返回空，不猜测数量", () => {
    expect(extractApplicationLimit("欢迎申请校园招聘岗位，请根据个人兴趣选择。")).toBeNull();
  });
});
