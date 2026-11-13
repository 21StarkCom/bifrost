#!/usr/bin/env node
/**
 * tell-on-stop Stop hook.
 *
 * Shipped by the stark-ops plugin: its marketplace.json entry declares this hook
 * inline on Stop through ${CLAUDE_PLUGIN_ROOT}, so installing stark-ops wires it
 * and no settings.json entry is needed.
 *
 * Reads the Stop payload on stdin (`session_id`, `transcript_path`, `cwd`,
 * `stop_hook_active`). When the main agent's model turns have grown by the
 * threshold (160, or `STARK_TELL_ON_STOP_TURNS`) since this session's last ask,
 * it records the count in `<stateRoot()>/tell-on-stop/<session_id>.json` and
 * prints `{"decision":"block","reason":…}`: Claude Code then keeps the agent
 * going with the reason, which asks it to call `tell_librarian` for each
 * lasting fact. Else it prints nothing.
 *
 * It never asks on a stop that a Stop hook already continued
 * (`stop_hook_active`), in a headless run (`CLAUDE_CODE_ENTRYPOINT` `sdk-*`,
 * whose last reply a program reads), for a session id that is not a UUID, or
 * in the librarian's own folder (`~/.local/state/atlas/librarian/`). It asks
 * only when `~/.claude.json` (`$CLAUDE_CONFIG_DIR/.claude.json` when set) names
 * an MCP server called `librarian` in `mcpServers`, since a session without it
 * has no `tell_librarian` tool. Any fault prints
 * nothing, and the hook always exits 0: it never blocks a stop by failing.
 */
import fs from "node:fs";

import { precheckCli } from "./cli_args_lib.ts";
import { isMainModule } from "./main_module_lib.ts";
import { decide } from "./tell_on_stop_hook_lib.ts";

const USAGE = "usage: tell_on_stop_hook.ts (no arguments; Stop JSON on stdin)\n";

if (isMainModule(import.meta.url)) {
  // Argv is not part of the Stop protocol: help prints the usage, and anything
  // else is refused on stderr, since Claude Code reads this stdout.
  precheckCli(process.argv.slice(2), {}, USAGE);
  let out: string | null = null;
  try {
    out = decide(fs.readFileSync(0, "utf8"));
  } catch {
    /* no stdin: say nothing */
  }
  // No process.exit: on macOS a pipe write is async, and exit would cut it.
  if (out) process.stdout.write(`${out}\n`);
  process.exitCode = 0;
}
