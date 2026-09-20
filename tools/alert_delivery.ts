#!/usr/bin/env node
/**
 * alert_delivery CLI — TypeScript port of `scripts/alert_delivery.py`.
 *
 * Surface preserved 1:1:
 *
 *   alert_delivery.ts [--check] [--json]
 *
 * The `--check` flag is the only operation the CLI supports (matching
 * the Python). JSON output: `{ "unacknowledged": [{ "path": "..." }] }`
 * — consumed by `tools/stark_session_lib.ts:collectAlerts`.
 */

import { parseCli } from "./cli_args_lib.ts";
import { checkAlerts } from "./alert_delivery_lib.ts";
import { isMainModule } from "./main_module_lib.ts";

type ParsedArgs = ReturnType<typeof parseCli>;

function parseArgs(argv: string[]): ParsedArgs {
  return parseCli(argv, {
    equals: true,
    switches: ["--check", "--json"],
  });
}

function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    process.stderr.write("usage: alert_delivery.ts [--check] [--json]\n");
    return 0;
  }
  const asJson = args.flags.has("json");

  const result = checkAlerts();
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
  const n = result.unacknowledged.length;
  if (n === 0) {
    process.stdout.write("No unacknowledged alerts.\n");
    return 0;
  }
  process.stdout.write(`${n} unacknowledged alert(s):\n`);
  for (const item of result.unacknowledged) {
    process.stdout.write(`  ${item.path}\n`);
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`alert_delivery: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
