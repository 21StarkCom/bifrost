#!/usr/bin/env node
/**
 * context_compactor CLI — TypeScript port of
 * `scripts/context_compactor.py`. Surface preserved 1:1:
 *
 *   context_compactor.ts [--session-id ID] [--json]
 *
 * JSON output: { "session_id", "checkpoint_path" }. Text output: human
 * lines naming the freshly-written and latest checkpoint paths.
 */

import { parseCli } from "./cli_args_lib.ts";
import {
  generateCheckpoint,
  getLatestCheckpoint,
} from "./context_compactor_lib.ts";
import { resolveSessionId } from "./session_id_lib.ts";
import { isMainModule } from "./main_module_lib.ts";

// ---------------------------------------------------------------------------
// Tiny argv parser
// ---------------------------------------------------------------------------

type ParsedArgs = ReturnType<typeof parseCli>;

function parseArgs(argv: string[]): ParsedArgs {
  return parseCli(argv, {
    equals: true,
    values: ["--session-id"],
    switches: ["--json"],
  });
}

function flagString(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags.get(name);
  return typeof v === "string" ? v : undefined;
}

function flagBool(args: ParsedArgs, name: string): boolean {
  return args.flags.has(name);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    process.stderr.write(
      "usage: context_compactor.ts [--session-id ID] [--json]\n",
    );
    return 0;
  }
  const sessionId = flagString(args, "session-id");
  const asJson = flagBool(args, "json");

  const checkpointPath = generateCheckpoint({ sessionId });
  const sid = sessionId ?? resolveSessionId();

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        { session_id: sid, checkpoint_path: checkpointPath },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(`Checkpoint written: ${checkpointPath}\n`);
    const latest = getLatestCheckpoint({ sessionId: sid });
    if (latest) process.stdout.write(`Latest checkpoint:  ${latest}\n`);
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`context_compactor: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
