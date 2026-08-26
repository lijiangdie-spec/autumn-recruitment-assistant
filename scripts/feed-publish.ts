import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPublicFeed, writePublicFeed } from "@/lib/feed/publisher";
import { publicFeedSchema } from "@/lib/feed/schema";
import { isWithin } from "@/lib/config/paths";

function valueAfter(args: string[], flag: string): string | undefined { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }

function command(executable: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); }); child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${executable} ${args[0]} 失败：${(stderr || stdout).slice(-2000)}`)));
  });
}

async function delay(ms: number) { await new Promise((resolve) => setTimeout(resolve, ms)); }

export interface PublishOptions { databasePath: string; outputPath: string; commit: boolean; push: boolean }

export async function publishFeed(options: PublishOptions) {
  const repoRoot = process.cwd();
  const outputPath = path.resolve(options.outputPath);
  if ((options.commit || options.push) && !isWithin(repoRoot, outputPath)) throw new Error("自动提交时 feed 输出文件必须位于当前公开仓库内");
  const feed = buildPublicFeed(path.resolve(options.databasePath));
  let changed = true;
  try {
    const current = publicFeedSchema.parse(JSON.parse(await readFile(outputPath, "utf8")));
    changed = current.revision !== feed.revision;
  } catch { /* missing or invalid output is replaced below */ }
  if (changed) await writePublicFeed(feed, outputPath);
  const verified = publicFeedSchema.parse(JSON.parse(await readFile(outputPath, "utf8")));
  if (verified.revision !== feed.revision) throw new Error("落盘后的 feed 版本校验失败");

  let committed = false;
  if (options.commit || options.push) {
    const relative = path.relative(repoRoot, outputPath);
    await command("git", ["add", "--", relative], repoRoot);
    const changed = await command("git", ["status", "--porcelain", "--", relative], repoRoot);
    if (changed) { await command("git", ["commit", "-m", `data: publish job feed ${feed.revision.slice(0, 12)}`, "--", relative], repoRoot); committed = true; }
  }
  if (options.push) {
    let lastError: unknown;
    for (const wait of [0, 1_500, 5_000]) {
      if (wait) await delay(wait);
      try { await command("git", ["push"], repoRoot); lastError = undefined; break; }
      catch (error) { lastError = error; }
    }
    if (lastError) throw lastError;
  }
  return { revision: feed.revision, jobCount: feed.jobCount, outputPath, changed, committed, pushed: options.push };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const databasePath = valueAfter(args, "--db") || process.env.RECRUITMENT_DB_PATH;
  if (!databasePath) throw new Error("请通过 --db 或 RECRUITMENT_DB_PATH 指定只读岗位数据库");
  const outputPath = valueAfter(args, "--out") || process.env.AUTUMN_ASSISTANT_FEED_OUTPUT || path.join(process.cwd(), "public-site", "feed.json");
  const result = await publishFeed({ databasePath, outputPath, commit: args.includes("--commit") || args.includes("--push"), push: args.includes("--push") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
