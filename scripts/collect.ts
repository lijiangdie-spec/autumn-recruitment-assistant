import { runRefresh } from "@/lib/collectors/run";

async function main(): Promise<void> {
  const result = await runRefresh();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.run.status === "failed") process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
