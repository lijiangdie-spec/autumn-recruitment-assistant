import { runQqDocsReplay } from "@/lib/qqdocs/replay";

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const from = valueAfter(args, "--from");
if (!from) throw new Error("用法：npm run qqdocs:replay -- --from YYYY-MM-DD [--through YYYY-MM-DD] [--dry-run]");

const result = await runQqDocsReplay({
  from,
  through: valueAfter(args, "--through"),
  dryRun: args.includes("--dry-run"),
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
