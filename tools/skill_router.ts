#!/usr/bin/env node
/**
 * skill_router CLI — TypeScript port of `scripts/skill_router.py`.
 *
 * Surface preserved 1:1:
 *
 *   skill_router.ts --context {review|implementation|session} [--json]
 *
 * JSON output keeps the same shape (`suggestions`, `context`,
 * `timestamp`, `config`) — the `_suppressed_count` key from the
 * internal result is stripped before printing, like the Python.
 */

import { parseCli } from "./cli_args_lib.ts";
import {
  computeSuggestions,
  humanReadable,
  loadSkillActivationConfig,
  loadSkillUsage,
  VALID_CONTEXTS,
  type Context,
} from "./skill_router_lib.ts";
import { isMainModule } from "./main_module_lib.ts";

// ---------------------------------------------------------------------------
// Tiny argv parser
// ---------------------------------------------------------------------------

type ParsedArgs = ReturnType<typeof parseCli>;

function parseArgs(argv: string[]): ParsedArgs {
  return parseCli(argv, {
    equals: true,
    values: ["--context"],
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
      "usage: skill_router.ts --context {review|implementation|session} [--json]\n",
    );
    return 0;
  }
  const context = flagString(args, "context");
  if (!context) {
    process.stderr.write("Error: --context is required\n");
    return 2;
  }
  if (!VALID_CONTEXTS.has(context as Context)) {
    process.stderr.write(
      `Error: --context must be one of: ${[...VALID_CONTEXTS].sort().join(", ")}\n`,
    );
    return 2;
  }

  const cfg = loadSkillActivationConfig();
  const usage = loadSkillUsage();
  const result = computeSuggestions({
    context: context as Context,
    cfg,
    usage,
    now: new Date(),
  });
  // Strip the internal field before printing — matches Python's
  // `result.pop("_suppressed_count", 0)` right before output.
  const out: Record<string, unknown> = { ...result };
  delete (out as Record<string, unknown>)._suppressed_count;

  if (flagBool(args, "json")) {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } else {
    process.stdout.write(`${humanReadable(result)}\n`);
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`skill_router: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
