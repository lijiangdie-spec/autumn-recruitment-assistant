import { runQqDocsUpdate } from "@/lib/qqdocs/run";

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const through = valueAfter(args, "--through");
if (!through) throw new Error("用法：npm run qqdocs:update -- --through YYYY-MM-DD [--from YYYY-MM-DD] [--dry-run]");

const result = await runQqDocsUpdate({
  through,
  from: valueAfter(args, "--from"),
  dryRun: args.includes("--dry-run"),
  headless: args.includes("--headless"),
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

