import { describe, expect, it } from "vitest";

import { resolveDisposition } from "@/lib/disposition";

describe("岗位人工处理归属", () => {
  it("只有人工处理才进入垃圾桶", () => {
    expect(resolveDisposition("apply", "trash")).toEqual({
      bucket: "trash",
      reason: "manual",
      manuallyRestored: false,
    });
  });

  it("历史人工恢复状态保持未处理，同时保留系统警示", () => {
    expect(resolveDisposition("skip", "include")).toEqual({
      bucket: "active",
      reason: "score",
      manuallyRestored: true,
    });
    expect(resolveDisposition("ineligible", "include")).toEqual({
      bucket: "active",
      reason: "ineligible",
      manuallyRestored: true,
    });
  });

  it("没有人工处理时所有评分结果都进入未处理岗位", () => {
    expect(resolveDisposition("apply", null)).toMatchObject({ bucket: "active", reason: "recommended" });
    expect(resolveDisposition("skip", null)).toMatchObject({ bucket: "active", reason: "score" });
    expect(resolveDisposition("ineligible", null)).toMatchObject({ bucket: "active", reason: "ineligible" });
  });
});
