import { describe, expect, it } from "vitest";

import { cleanSpreadsheetUrl } from "@/lib/imports/spreadsheet";

describe("spreadsheet URL cleanup", () => {
  it("keeps a normal hyperlink target", () => {
    expect(cleanSpreadsheetUrl("https://campus.example.com/jobs?id=27&city=上海"))
      .toBe("https://campus.example.com/jobs?id=27&city=%E4%B8%8A%E6%B5%B7");
  });

  it("uses the final real URL when a display label was prepended", () => {
    expect(cleanSpreadsheetUrl("http://长城/证券https://mp.weixin.qq.com/s/example?scene=1&click_id=3"))
      .toBe("https://mp.weixin.qq.com/s/example?scene=1&click_id=3");
  });

  it("rejects non-HTTP text", () => {
    expect(cleanSpreadsheetUrl("扫码投递")).toBeNull();
  });
});
