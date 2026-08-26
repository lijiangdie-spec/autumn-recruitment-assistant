import { describe, expect, it } from "vitest";

import { extractPublicJobJd } from "@/lib/imports/jd-enrichment";

describe("公开页面岗位级 JD 提取", () => {
  it("只读取标题匹配的 JobPosting JSON-LD", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@graph": [
        { "@type": "JobPosting", title: "普通开发工程师", description: "负责普通后端开发，任职要求 Java。".repeat(8) },
        { "@type": "JobPosting", title: "量化研究员", description: "<p>岗位职责：负责因子研究与策略回测。</p><p>任职要求：熟练使用 Python 和 SQL，理解金融市场。</p>".repeat(3) },
      ],
    })}</script>`;
    const jd = extractPublicJobJd(html, "量化研究员");
    expect(jd).toContain("因子研究");
    expect(jd).not.toContain("Java");
  });

  it("拒绝无法对应到具体岗位的整页职位列表", () => {
    const html = `<main><h1>校园招聘职位</h1><div>量化研究员 普通开发工程师 产品经理</div><p>${"欢迎投递。".repeat(80)}</p></main>`;
    expect(extractPublicJobJd(html, "量化研究员")).toBeNull();
  });

  it("可读取职责和要求明确的单岗位页面区块", () => {
    const html = `<section><h2>风险模型岗</h2><h3>岗位职责</h3><p>${"负责信用风险建模、数据分析和模型验证。".repeat(6)}</p><h3>任职要求</h3><p>熟悉 Python、SQL 和统计学习。</p></section>`;
    expect(extractPublicJobJd(html, "风险模型岗")).toContain("信用风险建模");
  });
});
