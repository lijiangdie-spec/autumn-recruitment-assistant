// read_docx.mjs — 读取 docx 素材文档为纯文本（读档环节使用）
// 用法: node scripts/read_docx.mjs 文件1.docx [文件2.docx ...]
import mammoth from "mammoth";

const files = process.argv.slice(2);
if (files.length === 0) { console.error("用法: node scripts/read_docx.mjs <docx...>"); process.exit(1); }
for (const f of files) {
  const { value } = await mammoth.extractRawText({ path: f });
  console.log(`\n===== ${f} =====\n${value.trim()}`);
}
