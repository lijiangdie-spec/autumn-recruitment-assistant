import { describe, expect, it } from "vitest";

import { parseEximRecruitmentList } from "@/lib/collectors/exim";

describe("中国进出口银行 2027 秋招公告监控", () => {
  it("不会把当前仍在列表中的 2026 届公告伪装成 2027 岗位", () => {
    const html = `
      <ul><li><a href="./202510/t20251029_70302.html">
        <span class="title">中国进出口银行2026年校园招聘公告</span>
        <span class="time">2025-10-29</span>
      </a></li></ul>`;
    expect(parseEximRecruitmentList(html)).toEqual([]);
  });

  it("未来官网发布 2027 届公告时可识别真实日期和官方原文", () => {
    const html = `
      <ul><li><a href="./202609/t20260920_80000.html">
        <span class="title">中国进出口银行2027年校园招聘公告</span>
        <span class="time">2026-09-20</span>
      </a></li></ul>`;
    expect(parseEximRecruitmentList(html)[0]).toMatchObject({
      company: "中国进出口银行",
      cohort: "2027届",
      employmentType: "campus",
      publishedAt: "2026-09-20T00:00:00+08:00",
      sourceUrl: "https://www.eximbank.gov.cn/info/notice/recruit/202609/t20260920_80000.html",
      applyUrl: null,
    });
  });

  it("官网结构异常时标记采集失败而不是误报空结果", () => {
    expect(() => parseEximRecruitmentList("<html><body>访问验证</body></html>"))
      .toThrow(/栏目结构已变化/);
  });
});
