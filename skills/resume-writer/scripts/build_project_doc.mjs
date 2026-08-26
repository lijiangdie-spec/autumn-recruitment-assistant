// build_project_doc.mjs — 规范化「项目文档」生成器（素材库的基本单元）
// 单个: node scripts/build_project_doc.mjs --json 项目.json --out 输出.docx
// 批量: node scripts/build_project_doc.mjs --batch 清单.json
//       批量清单为数组，每项多一个 "out" 字段指明输出路径。
//
// 项目 JSON 字段（约 500 字为宜；留空的字段会自动生成灰色填写指引）:
// {
//   "title":     "项目名称（简历上显示的名字）",
//   "time":      "2025.09 – 2025.12",
//   "type":      "实习项目 | 课程项目 | 个人项目 | 毕业设计",
//   "background":"背景与目标：什么问题、为什么值得做（约 80 字）",
//   "role":      "我的角色：独立完成 / N 人团队负责 X（约 40 字）",
//   "approach":  "方案与技术：架构、模型、关键设计决策、工具（约 150 字）",
//   "results":   "成果与数字：量化指标；估算值须标注（估算）（约 100 字）",
//   "highlights":"亮点与难点：面试可深挖的点（约 80 字）",
//   "resume_bullets": ["打磨好的简历表述备选（日常使用中的好句子会回存到这里）"],
//   "keywords":  ["RAG", "OCR", "量化"],  // 供 JD 匹配初筛
//   "page_break_before_highlights": false   // 长档案可从“亮点与难点”起另页
// }

import fs from "node:fs";
import path from "node:path";
import {
  AlignmentType, BorderStyle, Document, LevelFormat, LineRuleType, Packer,
  Paragraph, TextRun,
} from "docx";

const FONT = { ascii: "微软雅黑", eastAsia: "微软雅黑", hAnsi: "微软雅黑" };
const ACCENT = "004B87";

const GUIDE = {
  background: "背景与目标：这个项目解决什么问题？为什么值得做？（约 80 字）",
  role: "我的角色：独立完成，还是 N 人团队里负责哪部分？（约 40 字）",
  approach: "方案与技术：架构 / 模型 / 关键设计决策 / 工具链。（约 150 字）",
  results: "成果与数字：准确率、耗时、收益、覆盖率等量化指标；估算值请标注（估算）。（约 100 字）",
  highlights: "亮点与难点：面试官追问时你最想讲的 1–2 个深挖点。（约 80 字）",
};

const R = (text, opts = {}) => new TextRun({ text, font: FONT, size: 21, ...opts });
const EXACT = { line: 320, lineRule: LineRuleType.EXACT };

function fieldTitle(text, { pageBreakBefore = false } = {}) {
  return new Paragraph({
    pageBreakBefore,
    spacing: { before: 160, after: 40, ...EXACT },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF", space: 2 } },
    children: [R(text, { bold: true, size: 22, color: ACCENT })],
  });
}
function body(text, { placeholder = false } = {}) {
  return new Paragraph({
    spacing: { after: 40, ...EXACT },
    children: [R(placeholder ? "［待补充］" + text : text,
      placeholder ? { italics: true, color: "8C8C8C" } : {})],
  });
}
function section(title, value, guideKey, { pageBreakBefore = false } = {}) {
  return [fieldTitle(title, { pageBreakBefore }),
    value && value.trim() ? body(value) : body(GUIDE[guideKey] || "（待补充）", { placeholder: true })];
}

function buildDoc(p) {
  const kids = [
    new Paragraph({ spacing: { after: 30, line: 420, lineRule: LineRuleType.EXACT },
      children: [R(p.title || "（项目名称）", { bold: true, size: 30, color: ACCENT })] }),
    new Paragraph({ spacing: { after: 60, ...EXACT },
      children: [R(`${p.type || "（类型）"} ｜ ${p.time || "（起止时间）"}`, { color: "595959", size: 19 })] }),
    ...section("背景与目标", p.background, "background"),
    ...section("我的角色", p.role, "role"),
    ...section("方案与技术", p.approach, "approach"),
    ...section("成果与数字", p.results, "results"),
    ...section("亮点与难点", p.highlights, "highlights",
      { pageBreakBefore: Boolean(p.page_break_before_highlights) }),
    fieldTitle("简历表述备选"),
  ];
  const bullets = p.resume_bullets || [];
  if (bullets.length === 0) {
    kids.push(body("已打磨的简历句子会回存到这里，便于下次直接复用。", { placeholder: true }));
  } else {
    for (const b of bullets) kids.push(new Paragraph({
      numbering: { reference: "pbul", level: 0 }, spacing: { after: 30, ...EXACT }, children: [R(b)] }));
  }
  kids.push(fieldTitle("关键词"));
  kids.push(body((p.keywords || []).join("、") || "供 JD 匹配初筛用的标签，如：RAG、量化、风控",
    { placeholder: (p.keywords || []).length === 0 }));

  return new Document({
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    numbering: { config: [{ reference: "pbul", levels: [{
      level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 260, hanging: 160 } } } }] }] },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
      children: kids }],
  });
}

async function writeOne(p, out) {
  const buf = await Packer.toBuffer(buildDoc(p));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log("已生成:", out);
}

const argOf = (n) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : null; };
const batch = argOf("batch");
if (batch) {
  const list = JSON.parse(fs.readFileSync(batch, "utf-8"));
  for (const p of list) await writeOne(p, p.out);
} else {
  const j = argOf("json"); const out = argOf("out") || "project.docx";
  if (!j) { console.error("缺少 --json 或 --batch"); process.exit(1); }
  await writeOne(JSON.parse(fs.readFileSync(j, "utf-8")), out);
}
