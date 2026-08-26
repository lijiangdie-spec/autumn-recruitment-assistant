import { describe, expect, it } from "vitest";

import { parseGuangfaDetailResponse, parseGuangfaListResponse } from "@/lib/collectors/guangfa";
import { evaluatePosting } from "@/lib/scoring";

describe("广发证券官方校园招聘采集", () => {
  it("从校园招聘列表保留全部岗位，不在解析阶段按届次筛掉", () => {
    const parsed = parseGuangfaListResponse({
      state: "200",
      data: {
        pageForm: {
          totalPage: 2,
          pageData: [
            { postId: "quant-2027", postName: "Quant赛道资管方向（2027届）", projectName: "2027届-AI挑战赛", recruitType: 1 },
            { postId: "old-campus", postName: "财富管理培训生", projectName: "2026届校招", recruitType: 1 },
            { postId: "intern", postName: "量化实习生（2027届）", projectName: "实习", recruitType: 2 },
          ],
        },
      },
    });
    expect(parsed).toEqual({ postIds: ["quant-2027", "old-campus"], totalPages: 2 });
  });

  it("生成岗位级官方投递链接，并使用首次发布日期", () => {
    const posting = parseGuangfaDetailResponse({
      state: "200",
      data: {
        postId: "6a1feab0e49e0e559f780c8c",
        postName: "AI & Code & Quant挑战赛—Quant赛道资管方向（2027届）",
        projectName: "2027届-AI挑战赛",
        recruitType: 1,
        company: "广发证券资产管理（广东）有限公司",
        orgName: "广发证券资产管理（广东）有限公司",
        postTypeName: "投资交易类",
        education: "硕士研究生及以上",
        subject: "数学/金融工程/金融科技等",
        workContent: "含量化策略、资产配置、金融工程研究及衍生品",
        serviceCondition: "资产管理规模超2000亿元",
        workPlaceStr: "广州市、上海市",
        workPlaceList: [{ name: "广州市" }, { name: "上海市" }],
        publishFirstDate: "2026-06-03 00:00:00",
        publishDate: "2026-07-23 13:48:32",
        endDate: "2026-09-03 23:59:59",
        canDelivery: true,
        showDeliverButton: 1,
      },
    });
    expect(posting).not.toBeNull();
    expect(posting).toMatchObject({
      cohort: "2027届",
      employmentType: "campus",
      publishedAt: "2026-06-03T00:00:00+08:00",
      deadlineAt: "2026-09-03T23:59:59+08:00",
      cities: ["广州", "上海"],
    });
    expect(posting?.applyUrl).toBe("https://wecruit.hotjob.cn/SU625527c30dcad4021443cdda/pb/posDetail.html?postId=6a1feab0e49e0e559f780c8c&postType=campus");
    expect(evaluatePosting(posting!).hardRejectReasons).toEqual([]);
  });

  it("已关闭投递按钮的岗位仍保存，并由系统放进垃圾桶", () => {
    expect(parseGuangfaDetailResponse({
      state: "200",
      data: {
        postId: "closed",
        postName: "Quant赛道（2027届）",
        projectName: "2027届-AI挑战赛",
        recruitType: 1,
        canDelivery: false,
        showDeliverButton: 0,
      },
    })).toMatchObject({ applicationAvailable: false });
  });

  it("采集器保留不同赛道，是否目标岗位由用户偏好决定", () => {
    const common = {
      projectName: "2027届-AI挑战赛",
      recruitType: 1,
      company: "信息技术部",
      workPlaceStr: "广州市、深圳市",
      publishFirstDate: "2026-06-03 00:00:00",
      endDate: "2026-09-03 23:59:59",
      canDelivery: true,
      showDeliverButton: 1,
    };
    const code = parseGuangfaDetailResponse({ state: "200", data: {
      ...common,
      postId: "code",
      postName: "AI & Code & Quant挑战赛——Code开发赛道（2027届）",
      workContent: "C++、Java、Golang 和测试开发等技术岗",
      serviceCondition: "开发交易链路与投资工具",
    } });
    const ai = parseGuangfaDetailResponse({ state: "200", data: {
      ...common,
      postId: "ai",
      postName: "AI & Code & Quant挑战赛——AI算法赛道（2027届）",
      workContent: "大模型应用、AI算法工程师",
      serviceCondition: "用金融科技与 AI 应用支持证券业务数智化转型",
    } });
    expect(evaluatePosting(code!).hardRejectReasons).toEqual([]);
    expect(evaluatePosting(ai!).hardRejectReasons).toEqual([]);
    expect(evaluatePosting(ai!).roleFamily).toContain("AI");
  });
});
