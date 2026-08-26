import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveQqDocsConfig } from "@/lib/qqdocs/config";

describe("腾讯文档采集配置", () => {
  it("要求用户显式提供文档，并使用项目外专用 Profile", () => {
    const projectRoot = path.resolve("C:/workspace/autumn-recruitment");
    const config = resolveQqDocsConfig({ QQDOCS_DOCUMENT_URL: "https://docs.qq.com/sheet/EXAMPLE?tab=sheet1" }, projectRoot, "C:/Users/tester");
    expect(config.documentId).toBe("EXAMPLE");
    expect(config.sheetId).toBe("sheet1");
    expect(config.sourceKey).toBe("qqdocs:EXAMPLE:sheet1");
    expect(config.profileDir).toBe(path.resolve("C:/Users/tester/.autumn-recruitment/qqdocs-profile"));
  });

  it("拒绝把含登录信息的 Profile 放进项目目录", () => {
    const projectRoot = path.resolve("C:/workspace/autumn-recruitment");
    expect(() => resolveQqDocsConfig({ QQDOCS_DOCUMENT_URL: "https://docs.qq.com/sheet/EXAMPLE?tab=sheet1", QQDOCS_PROFILE_DIR: path.join(projectRoot, "data", "profile") }, projectRoot, "C:/Users/tester"))
      .toThrowError(/项目目录之外/);
  });

  it("开源默认值不包含任何私人腾讯文档链接", () => {
    expect(() => resolveQqDocsConfig({})).toThrow(/不内置任何私人表格链接/);
  });
});
