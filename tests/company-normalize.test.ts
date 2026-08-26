import { describe, expect, it } from "vitest";

import { canonicalCompanyName, normalizeCompanyKey } from "@/lib/companies/normalize";

describe("公司名称标准化", () => {
  it("把已确认的易方达简称归并到标准公司", () => {
    expect(canonicalCompanyName("易方达基金")).toBe("易方达基金管理有限公司");
    expect(normalizeCompanyKey("易方达基金（中国）")).toBe(normalizeCompanyKey("易方达基金(中国)"));
  });

  it("统一空白、全半角括号和常见公司后缀，但不做模糊合并", () => {
    expect(normalizeCompanyKey("  万家基金管理有限公司  ")).toBe("万家基金管理");
    expect(normalizeCompanyKey("测试投资（北京）有限公司")).toBe("测试投资(北京)");
    expect(normalizeCompanyKey("测试投资")).not.toBe(normalizeCompanyKey("测试投资咨询"));
  });
});
