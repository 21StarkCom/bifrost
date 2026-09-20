#!/usr/bin/env node
/**
 * session_id CLI — prints the resolved session ID to stdout.
 *
 * Matches the contract of the deleted `scripts/session_id.py` so
 * `SESSION_ID="${CLAUDE_SESSION_ID:-$(session_id.ts)}"` style shell
 * substitution in SKILL.md keeps working.
 */

import { precheckCli } from "./cli_args_lib.ts";
import { resolveSessionId } from "./session_id_lib.ts";
import { isMainModule } from "./main_module_lib.ts";

if (isMainModule(import.meta.url)) {
  // Help and argument validation, before the projects-dir scan the resolver
  // falls back to. This CLI takes no arguments at all.
  precheckCli(process.argv.slice(2), {},
    "usage: session_id.ts (no arguments; prints the resolved session id)");
  process.stdout.write(`${resolveSessionId()}\n`);
}
