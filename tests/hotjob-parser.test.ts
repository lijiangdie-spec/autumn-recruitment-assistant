import { describe, expect, it } from "vitest";

import { hotjobSuiteId, parseHotjobDetailResponse, parseHotjobListResponse } from "@/lib/recruitment-parsers/hotjob";
import { evaluatePosting } from "@/lib/scoring";

describe("Hotjob 通用公司岗位解析器", () => {
  it("从公司招聘链接识别 suite，并枚举所有校园岗位而不预筛选标题", () => {
    expect(hotjobSuiteId("https://wecruit.hotjob.cn/SU67ac68866202cc7916aea66e/pb/school.html"))
      .toBe("SU67ac68866202cc7916aea66e");
    expect(parseHotjobListResponse({ state: 200, data: { pageForm: { totalPage: 2, pageData: [
      { postId: "ai-risk", postName: "AI应用岗（风控合规）", recruitType: 1 },
      { postId: "sales", postName: "渠道销售岗", recruitType: 1 },
      { postId: "intern", postName: "实习岗", recruitType: 2 },
    ] } } })).toEqual({ postIds: ["ai-risk", "sales"], totalPages: 2 });
  });

  it("把易方达 AI 风控职责和要求解析成完整 JD，并生成岗位级官方链接", () => {
    const posting = parseHotjobDetailResponse({ state: 200, data: {
      postId: "6a83cf0368cc6f624f43c496",
      postName: "AI应用岗（风控合规）",
      projectName: "2026年AI人才专场",
      recruitType: 1,
      company: "易方达基金管理有限公司",
      department: "投资风险管理部",
      postTypeName: "中后台条线",
      workContent: "运用AI技术研发投资组合智能风险管理模型，并建设合规管理智能体。",
      serviceCondition: "硕士及以上，熟悉主流AI框架，了解金融工程基础风险量化模型。",
      workPlaceList: [{ name: "北京市" }, { name: "广州市" }, { name: "上海市" }, { name: "深圳市" }],
      endDate: "2027-08-18 23:59:59",
      canDelivery: true,
      showDeliverButton: 1,
    } }, { suiteId: "SU67ac68866202cc7916aea66e", companyName: "易方达基金" });
    expect(posting).toMatchObject({ title: "AI应用岗（风控合规）", jdParseStatus: "parsed", cities: ["北京", "广州", "上海", "深圳"] });
    expect(posting?.jdText).toContain("任职要求");
    expect(posting?.applyUrl).toContain("postId=6a83cf0368cc6f624f43c496");
    expect(evaluatePosting(posting!).hardRejectReasons).not.toContain("未匹配到量化研究或金融科技目标方向");
  });
});
