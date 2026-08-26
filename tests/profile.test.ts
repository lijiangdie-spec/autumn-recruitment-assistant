import { describe, expect, it } from "vitest";

import { evaluateSpreadsheetRow, splitRoleTitles } from "@/lib/imports/profile";
import { evaluatePosting } from "@/lib/scoring";

const base = {
  company: "示例证券", companyType: "金融机构", industry: "证券/基金",
  roles: "量化研究员、金融数据分析师", cities: "上海、深圳", aiDetail: "负责因子研究、投研数据与 Python 回测",
  cohort: "2027届", degree: "硕士", category: "秋招/校园招聘",
};

describe("汇总表目标画像", () => {
  it("把一行里的多个明确岗位拆成岗位级记录", () => {
    expect(splitRoleTitles("量化研究员、风险模型岗，金融工程岗")).toEqual(["量化研究员", "风险模型岗", "金融工程岗"]);
    expect(evaluateSpreadsheetRow(base).roleTitles).toEqual(["量化研究员", "金融数据分析师"]);
  });

  it("宽泛分类不伪造成岗位，并转入手动选岗", () => {
    const result = evaluateSpreadsheetRow({ ...base, roles: "技术类、产品类", aiDetail: "金融科技方向" });
    expect(result.roleTitles).toEqual([]);
    expect(result.shouldCreateCompanyLink).toBe(true);
  });

  it("非金融企业的可解析岗位也会保留，后续由适配评分放入垃圾桶", () => {
    const result = evaluateSpreadsheetRow({ ...base, company: "普通科技", companyType: "科技", industry: "互联网", roles: "技术类", aiDetail: "金融科技专业也可投递" });
    expect(result.shouldCreateCompanyLink).toBe(true);
  });

  it("金融科技类和风控类仍属于宽泛分类，不伪造成具体岗位", () => {
    for (const roles of ["金融科技类", "合规风控类", "风控综合岗", "科技管培生"]) {
      const result = evaluateSpreadsheetRow({ ...base, roles, aiDetail: "" });
      expect(result.roleTitles, roles).toEqual([]);
      expect(result.shouldCreateCompanyLink, roles).toBe(true);
    }
  });

  it("投递入口提示语属于宽泛入口，不伪造成岗位标题", () => {
    for (const roles of [
      "具体岗位见投递链接",
      "具体岗位详见投递链接",
      "岗位详情见链接",
      "岗位以官网为准",
      "提前批招聘开放日岗位（具体岗位详见官网）",
    ]) {
      const result = evaluateSpreadsheetRow({ ...base, roles, aiDetail: "以官方岗位要求为准" });
      expect(result.roleTitles, roles).toEqual([]);
      expect(result.shouldCreateCompanyLink, roles).toBe(true);
    }
  });

  it("实习、博士专属、纯 AI 和非金融岗位仍会解析并交由评分分流", () => {
    expect(evaluateSpreadsheetRow({ ...base, category: "实习", roles: "量化研究实习生" }).roleTitles).toEqual(["量化研究实习生"]);
    expect(evaluateSpreadsheetRow({ ...base, degree: "博士专属", roles: "量化研究员" }).roleTitles).toEqual(["量化研究员"]);
    expect(evaluateSpreadsheetRow({ ...base, company: "普通科技", industry: "互联网", roles: "AI算法工程师", aiDetail: "视觉大模型" }).roleTitles).toEqual(["AI算法工程师"]);
  });

  it("不会再过滤销售岗或 AI 风控岗，易方达同一行的明确岗位全部保留", () => {
    const result = evaluateSpreadsheetRow({ ...base, company: "易方达基金", roles: "量化研究岗、AI应用岗（风控合规）、渠道销售岗" });
    expect(result.roleTitles).toEqual(["量化研究岗", "AI应用岗（风控合规）", "渠道销售岗"]);
  });

  it("明确校园招聘中的实习考察期仍按秋招岗位进入", () => {
    const result = evaluateSpreadsheetRow({
      ...base,
      category: "秋招·实习考察",
      roles: "量化研究员",
      aiDetail: "2027 届校园招聘，正式录用前需经历三个月实习考察期。",
    });
    expect(result.roleTitles).toEqual(["量化研究员"]);
  });

  it("岗位身份不依赖共享链接", () => {
    const common = {
      company: "示例证券", cities: ["上海"], cohort: "2027届", employmentType: "campus" as const,
      publishedAt: "2026-08-12T00:00:00+08:00", deadlineAt: null, jdText: "金融量化与 Python",
      sourceUrl: "https://example.com/campus", sourceName: "汇总表", sourceTrust: "aggregator" as const,
    };
    expect(evaluatePosting({ ...common, title: "量化研究员" }).fingerprint)
      .not.toBe(evaluatePosting({ ...common, title: "金融工程师" }).fingerprint);
  });
});
