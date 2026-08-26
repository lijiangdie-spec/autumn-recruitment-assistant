import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IMPORT_SHEET_NAME } from "@/lib/imports/profile";
import { readSpreadsheetRows } from "@/lib/imports/spreadsheet-reader";

let tempDirectory: string;
let prefixedWorkbookPath: string;
let fallbackWorkbookPath: string;
let ambiguousWorkbookPath: string;

beforeAll(async () => {
  tempDirectory = await mkdtemp(path.join(os.tmpdir(), "spreadsheet-reader-test-"));
  const ordinaryWorkbookPath = path.join(tempDirectory, "ordinary.xlsx");
  prefixedWorkbookPath = path.join(tempDirectory, "prefixed.xlsx");
  fallbackWorkbookPath = path.join(tempDirectory, "fallback.xlsx");
  ambiguousWorkbookPath = path.join(tempDirectory, "ambiguous.xlsx");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(IMPORT_SHEET_NAME);
  worksheet.addRow([
    "更新时间", "企业名称", "企业类型", "行业分类", "招聘岗位", "工作城市", "AI预测岗位信息",
    "截止时间", "届次", "学历要求", "类别", "公告链接", "投递方式",
  ]);
  worksheet.addRow([
    "2026年8月4日", "测试证券", "金融机构", "证券", "量化研究员", "上海", "负责因子研究",
    "2026年9月30日", "2027届", "硕士", "秋招",
    { text: "公告", hyperlink: "https://example.com/source" },
    { text: "投递", hyperlink: "https://example.com/apply" },
  ]);
  worksheet.addRow([
    "", "蚂蚁科技集团股份有限公司", "民营", "互联网", "具体岗位见投递链接", "杭州", "以官网为准",
    "", "2027届", "本科", "秋招",
    { text: "公告", hyperlink: "https://example.com/ant-source" },
    { text: "投递", hyperlink: "https://example.com/ant-apply" },
  ]);
  await workbook.xlsx.writeFile(ordinaryWorkbookPath);

  const fallbackWorkbook = new ExcelJS.Workbook();
  await fallbackWorkbook.xlsx.load(await readFile(ordinaryWorkbookPath) as never);
  fallbackWorkbook.worksheets[0]!.name = "Sheet1";
  await fallbackWorkbook.xlsx.writeFile(fallbackWorkbookPath);

  const ambiguousWorkbook = new ExcelJS.Workbook();
  for (const name of ["Sheet1", "Sheet2"]) {
    ambiguousWorkbook.addWorksheet(name).addRow(["更新时间", "企业名称", "企业类型", "行业分类", "招聘岗位", "工作城市", "AI预测岗位信息", "截止时间", "届次", "学历要求", "类别", "公告链接", "投递方式"]);
  }
  await ambiguousWorkbook.xlsx.writeFile(ambiguousWorkbookPath);

  const zip = await JSZip.loadAsync(await readFile(ordinaryWorkbookPath));
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (/^xl\/(?:workbook|worksheets\/[^/]+|sharedStrings|styles)\.xml$/i.test(name)) {
      let xml = await entry.async("string");
      const namespace = xml.match(/xmlns="([^"]+)"/)?.[1];
      xml = xml.replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s/>])/g, "<$1x:$2");
      if (namespace) xml = xml.replace(/<x:([A-Za-z][\w.-]*)/, `<x:$1 xmlns:x="${namespace}"`);
      zip.file(name, xml);
    }
    if (/^xl\/_rels\/workbook\.xml\.rels$/i.test(name)) {
      const xml = (await entry.async("string")).replace(/Target="(?!\/xl\/)([^"]+)"/g, 'Target="/xl/$1"');
      zip.file(name, xml);
    }
  }
  await writeFile(prefixedWorkbookPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
});

afterAll(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("Excel OOXML 兼容读取", () => {
  it("读取带命名空间前缀和绝对关系路径的工作簿，并继承合并式日期", async () => {
    const result = await readSpreadsheetRows(prefixedWorkbookPath);
    expect(result.rowsRead).toBe(2);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.sourceDate)).toEqual(["2026-08-04", "2026-08-04"]);
    expect(result.rows[0]).toMatchObject({
      company: "测试证券",
      roles: "量化研究员",
      sourceUrl: "https://example.com/source",
      applyUrl: "https://example.com/apply",
    });
    expect(result.rows[1]).toMatchObject({
      company: "蚂蚁科技集团股份有限公司",
      roles: "具体岗位见投递链接",
      applyUrl: "https://example.com/ant-apply",
    });
  });

  it("工作表名降级为 Sheet1 时通过必要表头识别主表", async () => {
    const result = await readSpreadsheetRows(fallbackWorkbookPath);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.company).toBe("测试证券");
  });

  it("多个工作表同时满足主表签名时报告歧义", async () => {
    await expect(readSpreadsheetRows(ambiguousWorkbookPath)).rejects.toThrow(/多个工作表.*Sheet1、Sheet2/);
  });
});
