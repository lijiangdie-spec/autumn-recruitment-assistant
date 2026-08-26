import { watch } from "node:fs";
import path from "node:path";

import { publishFeed } from "./feed-publish";

function valueAfter(args: string[], flag: string): string | undefined { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }
const args = process.argv.slice(2);
const databaseInput = valueAfter(args, "--db") || process.env.RECRUITMENT_DB_PATH;
if (!databaseInput) throw new Error("请通过 --db 或 RECRUITMENT_DB_PATH 指定私人系统的岗位数据库");
const databasePath = path.resolve(databaseInput);
const outputPath = path.resolve(valueAfter(args, "--out") || process.env.AUTUMN_ASSISTANT_FEED_OUTPUT || path.join(process.cwd(), "public-site", "feed.json"));
const push = args.includes("--push");
let running = false; let pending = false; let timer: NodeJS.Timeout | null = null;

async function publish() {
  if (running) { pending = true; return; }
  running = true;
  try { const result = await publishFeed({ databasePath, outputPath, commit: push, push }); process.stdout.write(`[${new Date().toISOString()}] feed ${result.revision.slice(0, 12)} · ${result.jobCount} jobs\n`); }
  catch (error) { process.stderr.write(`[${new Date().toISOString()}] 发布失败，保留待重试：${error instanceof Error ? error.message : String(error)}\n`); }
  finally { running = false; if (pending) { pending = false; void publish(); } }
}

await publish();
const databaseName = path.basename(databasePath);
watch(path.dirname(databasePath), { persistent: true }, (_event, fileName) => {
  const changed = fileName?.toString() ?? "";
  if (changed !== databaseName && changed !== `${databaseName}-wal`) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void publish(); }, 2_500);
});
process.stdout.write(`正在只读监听 ${databasePath}；Ctrl+C 停止。\n`);
