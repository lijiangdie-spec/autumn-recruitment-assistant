import { describe, expect, it } from "vitest";

import { parseQqDocsClipboard } from "@/lib/qqdocs/extractors/clipboard-parser";
import { normalizeSheetSnapshot } from "@/lib/qqdocs/normalize";

const html = `
<table>
  <tr><td>更新时间</td><td>企业名称</td><td>企业类型</td><td>行业分类</td><td>招聘岗位</td><td>工作城市</td><td>AI预测岗位信息</td><td>截止时间</td><td>届次</td><td>学历要求</td><td>类别</td><td>公告链接</td><td>投递方式</td></tr>
  <tr><td>8月19日</td><td>甲基金</td><td>私募</td><td>金融</td><td>量化研究员</td><td>上海</td><td>因子研究</td><td></td><td>2027届</td><td>硕士</td><td>秋招</td><td><a href="https://example.com/a">公告</a></td><td><a href="https://example.com/apply/a">投递</a></td></tr>
  <tr><td></td><td>乙证券</td><td>证券</td><td>金融</td><td>金融工程师</td><td>北京</td><td>定价模型</td><td></td><td>2027届</td><td>硕士</td><td>校招</td><td><a href="https://example.com/b">公告</a></td><td></td></tr>
</table>`;

describe("腾讯文档剪贴板解析", () => {
  it("从 HTML 表格恢复列和真实超链接", () => {
    const snapshot = parseQqDocsClipboard({ sourceKey: "qqdocs:test", html, text: "", reachedSheetEnd: false });
    const rows = normalizeSheetSnapshot(snapshot, 2026);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sourceDate: "2026-08-19", sourceUrl: "https://example.com/a", applyUrl: "https://example.com/apply/a" });
    expect(rows[1]).toMatchObject({ sourceDate: "2026-08-19", sourceUrl: "https://example.com/b" });
  });

  it("没有 HTML 时仍能解析 TSV", () => {
    const text = "更新时间\t企业名称\t招聘岗位\n8月19日\t甲基金\t量化研究员";
    const snapshot = parseQqDocsClipboard({ sourceKey: "qqdocs:test", html: "", text, reachedSheetEnd: true });
    expect(snapshot.headers.map((header) => header.text)).toEqual(["更新时间", "企业名称", "招聘岗位"]);
    expect(snapshot.rows[0].cells.map((cell) => cell.text)).toEqual(["8月19日", "甲基金", "量化研究员"]);
  });

  it("无法识别关键表头时拒绝把任意表格当岗位表", () => {
    expect(() => parseQqDocsClipboard({ sourceKey: "qqdocs:test", html: "", text: "A\tB\n1\t2", reachedSheetEnd: true }))
      .toThrowError(/HEADER_CHANGED/);
  });
});

