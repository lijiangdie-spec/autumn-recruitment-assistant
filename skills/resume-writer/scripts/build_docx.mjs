// build_docx.mjs — 简历 Word 生成器（resume-writer 技能专用）
// 用法: node scripts/build_docx.mjs --content content.json --template a|b --out 输出.docx [--accent 9E1F2E] [--no-photo]
//
// content.json 结构:
// {
//   "basics": {
//     "name": "李明",
//     "intent": "求职意向：后端开发实习生",
//     "contacts": ["电话 138-0000-1234", "邮箱 x@x.com", "深圳", "github.com/xx"],
//     "photo": "data/photo.jpg"            // null 或省略 = 不放照片
//   },
//   "sections": [
//     { "title": "教育背景", "type": "entries", "items": [
//         { "heading": "华南理工大学 · 软件工程（本科）",
//           "middle": "学院 | 专业 | 学位（可选，居中斜体显示）",
//           "right": "2023.09 – 2027.06",
//           "sub": "GPA 3.72/4.0（专业排名 8/126）",          // 可选
//           "bullets": ["主修：数据结构、操作系统……"] } ] },   // 可选
//     { "title": "专业技能", "type": "lines", "sidebar": true,
//       "lines": ["语言与框架：Java、Spring Boot", "……"] }
//   ]
// }
// 说明: type=entries 用于教育/实习/项目; type=lines 用于技能/奖项等清单。
//       sidebar:true 的区块在模版 B 里进左侧栏（模版 A 忽略该标记）。
//
// 版式修改入口: 只改下面的 CONFIG（用户反馈"字太大/边距太宽/换灰色"等都在这里调）。

import fs from "node:fs";
import path from "node:path";
import {
  AlignmentType, BorderStyle, Document, HeightRule, ImageRun, LevelFormat,
  LineRuleType, Packer, Paragraph, PositionalTab, PositionalTabAlignment,
  PositionalTabLeader, PositionalTabRelativeTo, ShadingType, Table, TableCell,
  TableRow, TextRun, VerticalAlign, WidthType,
} from "docx";

const CONFIG = {
  font: "微软雅黑",          // 用户机器需有该字体；macOS 打开会自动替换为近似字体
  baseSize: 21,              // 正文 10.5pt（单位: 半磅）
  nameSize: 40,              // 姓名 20pt
  intentSize: 22,            // 求职意向 11pt
  contactSize: 18,           // 联系方式 9pt
  titleSize: 24,             // 区块标题 12pt
  sideSize: 19,              // 模版B侧栏正文 9.5pt
  lineExact: 312,            // 固定行距 15.6pt（单位: 缇=磅×20）
  margins: { top: 850, bottom: 794, left: 964, right: 964 }, // 1.5/1.4/1.7/1.7cm
  photoW: 94, photoH: 125,   // 证件照 2.5×3.3cm（像素@96dpi，比例 3:4）
  accent: "004B87",     // 主题色（跟目标公司品牌色走，CLI --accent 覆盖）
  gray: "595959",            // 辅助灰
  ruleColor: "7F7F7F",       // 区块标题下划线
  sidebarFill: "F2F2F2",     // 模版B侧栏底色
  sidebarWidth: 2950,        // 模版B侧栏宽 ≈5.2cm（单位: 缇）
};

const PAGE_W = 11906;                                   // A4 宽（缇）
const CONTENT_W = PAGE_W - CONFIG.margins.left - CONFIG.margins.right; // 9978

// ---------- 基础构件 ----------
const FONT = { ascii: CONFIG.font, eastAsia: CONFIG.font, hAnsi: CONFIG.font };
const R = (text, opts = {}) =>
  new TextRun({ text, font: FONT, size: CONFIG.baseSize, ...opts });

const noBorder = { style: BorderStyle.NIL, size: 0, color: "FFFFFF" };
const CELL_NO_BORDERS = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const TABLE_NO_BORDERS = { ...CELL_NO_BORDERS, insideHorizontal: noBorder, insideVertical: noBorder };

const EXACT = { line: CONFIG.lineExact, lineRule: LineRuleType.EXACT };

function sectionTitle(text, { size = CONFIG.titleSize } = {}) {
  return new Paragraph({
    spacing: { before: 150, after: 60, ...EXACT },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: CONFIG.accent, space: 2 } },
    children: [R(text, { bold: true, size, color: CONFIG.accent })],
  });
}

// 左侧加粗抬头 + 右对齐时间（PositionalTab 保证在正文和表格内都靠右）
function entryHeading(left, middle, right, relativeTo) {
  const kids = [R(left, { bold: true })];
  if (middle) {
    kids.push(new TextRun({
      font: FONT, size: CONFIG.baseSize, color: CONFIG.gray, italics: true,
      children: [
        new PositionalTab({
          alignment: PositionalTabAlignment.CENTER,
          relativeTo,
          leader: PositionalTabLeader.NONE,
        }),
        middle,
      ],
    }));
  }
  if (right) {
    kids.push(new TextRun({
      font: FONT, size: CONFIG.baseSize, color: CONFIG.gray,
      children: [
        new PositionalTab({
          alignment: PositionalTabAlignment.RIGHT,
          relativeTo,
          leader: PositionalTabLeader.NONE,
        }),
        right,
      ],
    }));
  }
  return new Paragraph({ spacing: { before: 70, after: 20, ...EXACT }, children: kids });
}

function bullet(text, { size = CONFIG.baseSize } = {}) {
  const i = text.indexOf("：");
  const kids = i > 0 && i <= 24
    ? [R(text.slice(0, i + 1), { bold: true, size }), R(text.slice(i + 1), { size })]
    : [R(text, { size })];
  return new Paragraph({
    numbering: { reference: "rbul", level: 0 },
    spacing: { after: 20, ...EXACT },
    children: kids,
  });
}

// "标签：内容" 自动加粗标签
function lineP(text, { size = CONFIG.baseSize, after = 20 } = {}) {
  const i = text.indexOf("：");
  const kids = i > 0 && i < 12
    ? [R(text.slice(0, i + 1), { bold: true, size }), R(text.slice(i + 1), { size })]
    : [R(text, { size })];
  return new Paragraph({ spacing: { after, ...EXACT }, children: kids });
}

function photoRun(photoPath) {
  const ext = path.extname(photoPath).toLowerCase().replace(".", "");
  return new ImageRun({
    type: ext === "png" ? "png" : "jpg",
    data: fs.readFileSync(photoPath),
    transformation: { width: CONFIG.photoW, height: CONFIG.photoH },
  });
}

function renderSectionBody(sec, relativeTo, { size = CONFIG.baseSize } = {}) {
  const out = [];
  if (sec.type === "entries") {
    for (const it of sec.items || []) {
      out.push(entryHeading(it.heading, it.middle, it.right, relativeTo));
      if (it.sub) out.push(lineP(it.sub, { size }));
      for (const b of it.bullets || []) out.push(bullet(b, { size }));
    }
  } else {
    for (const ln of sec.lines || []) out.push(lineP(ln, { size }));
  }
  return out;
}

// ---------- 模版 A：经典单栏 ----------
function buildA(c) {
  const kids = [];
  const contactLine = (c.basics.contacts || []).join("  |  ");
  const headLeft = [
    new Paragraph({ spacing: { after: 30, line: 480, lineRule: LineRuleType.EXACT },
      children: [
        R(c.basics.name, { bold: true, size: CONFIG.nameSize, color: CONFIG.accent }),
        R("    " + (c.basics.intent || ""), { size: CONFIG.intentSize, color: CONFIG.gray }),
      ] }),
    new Paragraph({ spacing: { after: 40, ...EXACT },
      children: [R(contactLine, { size: CONFIG.contactSize, color: CONFIG.gray })] }),
  ];
  if (c.basics.photo) {
    kids.push(new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: [CONTENT_W - 1750, 1750],
      borders: TABLE_NO_BORDERS,
      rows: [new TableRow({ children: [
        new TableCell({ width: { size: CONTENT_W - 1750, type: WidthType.DXA },
          borders: CELL_NO_BORDERS, verticalAlign: VerticalAlign.CENTER, children: headLeft }),
        new TableCell({ width: { size: 1750, type: WidthType.DXA },
          borders: CELL_NO_BORDERS, verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [photoRun(c.basics.photo)] })] }),
      ] })],
    }));
  } else {
    kids.push(...headLeft);
  }
  for (const sec of c.sections || []) {
    kids.push(sectionTitle(sec.title));
    kids.push(...renderSectionBody(sec, PositionalTabRelativeTo.MARGIN));
  }
  return kids;
}

// ---------- 模版 B：双栏侧边 ----------
function buildB(c) {
  const side = [];
  const main = [];
  const sideOpt = { size: CONFIG.sideSize };

  if (c.basics.photo) {
    side.push(new Paragraph({ alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 120 }, children: [photoRun(c.basics.photo)] }));
  }
  side.push(sectionTitle("联系方式", { size: CONFIG.baseSize }));
  for (const ct of c.basics.contacts || []) side.push(lineP(ct, { ...sideOpt, after: 30 }));

  main.push(new Paragraph({ spacing: { after: 20, line: 480, lineRule: LineRuleType.EXACT },
    children: [R(c.basics.name, { bold: true, size: CONFIG.nameSize, color: CONFIG.accent })] }));
  main.push(new Paragraph({ spacing: { after: 60, ...EXACT },
    children: [R(c.basics.intent || "", { size: CONFIG.intentSize, color: CONFIG.gray })] }));

  for (const sec of c.sections || []) {
    if (sec.sidebar) {
      side.push(sectionTitle(sec.title, { size: CONFIG.baseSize }));
      side.push(...renderSectionBody(sec, PositionalTabRelativeTo.INDENT, sideOpt));
    } else {
      main.push(sectionTitle(sec.title));
      main.push(...renderSectionBody(sec, PositionalTabRelativeTo.INDENT));
    }
  }

  const mainW = CONTENT_W - CONFIG.sidebarWidth;
  return [new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONFIG.sidebarWidth, mainW],
    borders: TABLE_NO_BORDERS,
    // 行最小高度 = A4 版心高（16838 - 上下边距），让侧栏底色铺满整页
    rows: [new TableRow({
      height: { value: 16838 - CONFIG.margins.top - CONFIG.margins.bottom - 100, rule: HeightRule.ATLEAST },
      children: [
      new TableCell({
        width: { size: CONFIG.sidebarWidth, type: WidthType.DXA },
        borders: CELL_NO_BORDERS,
        shading: { type: ShadingType.CLEAR, color: "auto", fill: CONFIG.sidebarFill },
        margins: { top: 160, bottom: 160, left: 200, right: 200 },
        children: side,
      }),
      new TableCell({
        width: { size: mainW, type: WidthType.DXA },
        borders: CELL_NO_BORDERS,
        margins: { top: 60, bottom: 60, left: 280, right: 0 },
        children: main,
      }),
    ] })],
  })];
}

// ---------- 主流程 ----------
function arg(name, fallback = null) {
  const i = process.argv.indexOf("--" + name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const contentPath = arg("content");
const template = (arg("template", "a") || "a").toLowerCase();
const outPath = arg("out", "resume.docx");
if (!contentPath) { console.error("缺少 --content"); process.exit(1); }

const accentArg = arg("accent");
if (accentArg) CONFIG.accent = accentArg.replace(/^#/, "").toUpperCase();

const c = JSON.parse(fs.readFileSync(contentPath, "utf-8"));
if (arg("no-photo") !== null || process.argv.includes("--no-photo")) c.basics.photo = null;
if (c.basics.photo && !fs.existsSync(c.basics.photo)) {
  console.error(`提示: 照片 ${c.basics.photo} 不存在，按无照片处理`);
  c.basics.photo = null;
}

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: CONFIG.baseSize } } } },
  numbering: { config: [{ reference: "rbul", levels: [{
    level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 260, hanging: 160 } } },
  }] }] },
  sections: [{
    properties: { page: { margin: CONFIG.margins } },   // 页面默认 A4
    children: template === "b" ? buildB(c) : buildA(c),
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, buf);
  console.log("已生成:", outPath, `(模版 ${template.toUpperCase()})`);
});
