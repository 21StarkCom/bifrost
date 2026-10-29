#!/usr/bin/env -S node --experimental-strip-types
/**
 * ask-guard Stop hook: enforces the root rules' "Act, don't ask".
 *
 * Shipped by the stark-ops plugin: its marketplace.json entry declares this hook
 * inline on Stop through ${CLAUDE_PLUGIN_ROOT}, so installing stark-ops wires it
 * and no settings.json entry is needed.
 *
 * Reads the Stop input on stdin and classifies `last_assistant_message` with
 * `ask_guard_lib.ts`. When the turn ends on a permission question about a step
 * the agent can take, or on a promise of a later step, it blocks the stop: it
 * prints Stop `hookSpecificOutput.additionalContext` so Claude continues with
 * the reason as "Stop hook feedback", and appends one JSON line to
 * `<stateRoot>/ask-guard/blocks.jsonl` for `ask_guard_metric.ts`.
 *
 * It never loops and never fails a stop: with `stop_hook_active` true (Claude
 * already continues because of a stop hook), in plan mode, on bad input or on
 * any error, it prints nothing and exits 0.
 */
import fs from "node:fs";
import path from "node:path";
import { blockLogPath, classifyEnding, reasonFor, watching, type BlockLine } from "./ask_guard_lib.ts";

function readStdin(): string {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function log(line: BlockLine): void {
  try {
    const file = blockLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(line) + "\n");
  } catch {
    /* a log that fails must not cost the block */
  }
}

function main(): void {
  const raw = readStdin();
  if (!raw.trim()) return;
  let input: any;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  if (!input || typeof input !== "object") return;
  if (input.stop_hook_active === true) return;
  if (input.permission_mode === "plan") return;

  const verdict = classifyEnding(input.last_assistant_message);
  if (!verdict.block || !verdict.kind || !verdict.phrase) return;
  if (verdict.kind === "defer" && watching(input)) return;

  log({
    time: new Date().toISOString(),
    session_id: typeof input.session_id === "string" ? input.session_id : "",
    cwd: typeof input.cwd === "string" ? input.cwd : "",
    kind: verdict.kind,
    phrase: verdict.phrase,
  });
  // additionalContext, not `decision: "block"`: both keep the turn going under
  // the same loop guards (`stop_hook_active`, the 8-continuation cap), but a
  // block shows the operator a "Stop hook error" notice, and this is the hook
  // working as designed.
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: reasonFor(verdict.kind, verdict.phrase) } }) + "\n",
  );
}

// Argv is not part of the Stop protocol, so anything here is either a help
// request or a mistake. A refusal goes to stderr: Claude Code reads stdout.
if (process.argv.length > 2) {
  const asked = ["help", "--help", "-h"].includes(process.argv[2]);
  const usage = "usage: ask_guard_hook.ts (no arguments; Stop hook JSON on stdin)\n";
  if (asked) process.stdout.write(usage);
  else process.stderr.write(`unsupported argument: ${process.argv[2]}\n${usage}`);
  process.exit(asked ? 0 : 2);
}
try {
  main();
} catch {
  /* never fail a stop */
}
process.exit(0);
