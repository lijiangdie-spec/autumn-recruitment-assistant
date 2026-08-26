import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

function command(executable: string, args: string[]): Promise<string> { return new Promise((resolve, reject) => { const child = spawn(executable, args, { cwd: process.cwd(), windowsHide: true }); let out = ""; let error = ""; child.stdout.on("data", (chunk) => { out += chunk.toString(); }); child.stderr.on("data", (chunk) => { error += chunk.toString(); }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(out) : reject(new Error(error || `${executable} 退出码 ${code}`))); }); }

const listed = await command("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
const files = listed.split("\0").filter(Boolean);
const errors: string[] = [];
const forbiddenRoots = /^(?:data|materials|applications|resumes|imports|backups|feed-outbox)(?:\/|$)/i;
const forbiddenNames = /(?:^|\/)(?:profile|preferences)\.json$/i;
const binaryExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".db", ".pdf", ".docx"]);
const contentRules: Array<[RegExp, string]> = [
  [/D:\\找实习|D:\\.*自动简历撰写/i, "私人 Windows 工作区路径"],
  [/https:\/\/docs\.qq\.com\/sheet\/[A-Za-z0-9_-]{10,}/i, "具体腾讯文档链接"],
  [/(?:^|\D)1[3-9]\d{9}(?:\D|$)/m, "疑似中国大陆手机号"],
];
const denylist = (process.env.PRIVACY_AUDIT_DENYLIST || "").split("||").map((item) => item.trim()).filter(Boolean);

for (const relative of files) {
  const normalized = relative.replaceAll("\\", "/");
  if (forbiddenRoots.test(normalized) || forbiddenNames.test(normalized)) errors.push(`${relative}：私人数据路径不能进入仓库`);
  if (normalized === "scripts/privacy-audit.ts") continue;
  const extension = path.extname(relative).toLowerCase();
  if (binaryExtensions.has(extension)) continue;
  let content = "";
  try { content = await readFile(path.resolve(relative), "utf8"); } catch { continue; }
  const auditableContent = content.replace(/\b[a-f0-9]{64}\b/gi, "");
  for (const [pattern, label] of contentRules) if (pattern.test(auditableContent)) errors.push(`${relative}：检测到${label}`);
  for (const item of denylist) if (content.includes(item) || relative.includes(item)) errors.push(`${relative}：命中 PRIVACY_AUDIT_DENYLIST`);
}

if (errors.length) { process.stderr.write(`隐私审计失败：\n- ${[...new Set(errors)].join("\n- ")}\n`); process.exitCode = 1; }
else process.stdout.write(`隐私审计通过：检查 ${files.length} 个待提交/已跟踪文件，未发现私人数据。\n`);
