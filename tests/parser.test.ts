import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { extractExplicitDeadline, extractExplicitPublishedDate, overlapCursor } from "@/lib/collectors/dates";
import { assertSafePublicUrl } from "@/lib/collectors/http";
import { parseManualDocument } from "@/lib/collectors/manual";
import { extractNiuqiNextPageUrl, NIUQI_SOURCES, parseNiuqiDetail, parseNiuqiList } from "@/lib/collectors/niuqi";

describe("牛企直聘列表解析", () => {
  const html = readFileSync(path.join(process.cwd(), "tests", "fixtures", "niuqi-list.html"), "utf8");
  const postings = parseNiuqiList(html, NIUQI_SOURCES[0]);

  it("分别读取发布日期、截止日期、城市、岗位和详情链接", () => {
    expect(postings).toHaveLength(3);
    expect(postings[0]).toMatchObject({
      company: "星海量化",
      title: "量化策略研究员",
      cities: ["上海", "深圳"],
      cohort: "2027届",
      publishedAt: null,
      sourceListedAt: "2026-08-04T00:00:00+08:00",
      deadlineAt: "2026-08-31T23:59:59+08:00",
      sourceUrl: "https://campus.niuqizp.com/job-quant.html",
    });
    expect(postings.map((posting) => posting.title)).toEqual(["量化策略研究员", "HRBP", "通用AI算法工程师"]);
  });

  it("从详情页补齐明确发布日期、正文和原文链接", () => {
    const detailHtml = readFileSync(path.join(process.cwd(), "tests", "fixtures", "niuqi-detail.html"), "utf8");
    const detail = parseNiuqiDetail(detailHtml, "https://campus.niuqizp.com/job-quant.html");
    expect(detail.publishedAt).toBe("2026-08-04T00:00:00+08:00");
    expect(detail.jdText).toContain("策略回测");
    expect(detail.officialUrl).toBe("https://official.example.com/campus/2027");
  });

  it("不会把截止日期当成发布日期", () => {
    expect(extractExplicitPublishedDate("申请截止：2026-09-01")).toBeNull();
    expect(extractExplicitDeadline("申请截止：2026-09-01")).toBe("2026-09-01T23:59:59+08:00");
  });

  it("只跟随牛企同源的下一页链接", () => {
    expect(extractNiuqiNextPageUrl(html, NIUQI_SOURCES[0].url))
      .toBe("https://campus.niuqizp.com/schedulenew-financesecuritiesinvestment-all-2/");
  });

  it("列表结构缺失或卡片为零时拒绝把页面当作成功", () => {
    expect(() => parseNiuqiList("<html><body>访问验证</body></html>", NIUQI_SOURCES[0]))
      .toThrow(/页面结构已变化/);
    expect(() => parseNiuqiList("<div class='schedule-card-list'></div>", NIUQI_SOURCES[0]))
      .toThrow(/未返回任何招聘卡片/);
  });

  it("24 小时重叠游标按北京时间自然日向下取整", () => {
    expect(overlapCursor("2026-08-06T06:32:32.725Z", "2026-08-04T00:00:00+08:00"))
      .toBe("2026-08-05T00:00:00+08:00");
  });
});

describe("手动正文解析", () => {
  it("无明确发布日期时保持待核验所需的 null", () => {
    const parsed = parseManualDocument({
      url: "https://example.com/campus-job",
      htmlOrText: `海岳证券 2027届校园招聘\n岗位：量化研究员\n地点：北京\n申请截止：2026-09-15\n要求 Python、因子研究与回测。`,
    });
    expect(parsed.publishedAt).toBeNull();
    expect(parsed.deadlineAt).toBe("2026-09-15T23:59:59+08:00");
    expect(parsed.cities).toContain("北京");
  });

  it("拒绝非 HTTP(S) 与本机地址", () => {
    expect(() => assertSafePublicUrl("file:///etc/passwd")).toThrow(/http 或 https/);
    expect(() => assertSafePublicUrl("http://127.0.0.1:3000/private")).toThrow(/本机或局域网/);
  });
});
