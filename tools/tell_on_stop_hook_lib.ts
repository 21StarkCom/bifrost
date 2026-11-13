/**
 * tell-on-stop hook — the decision.
 *
 * A long Claude Code session finds facts that the librarian does not hold, and
 * they are lost when the session ends. On each `Stop`, the hook counts the main
 * agent's model turns in the transcript. When the count has grown by the
 * threshold since this session's last ask, the hook blocks the stop once and
 * asks the agent to call `tell_librarian` for each lasting fact.
 *
 * Fail-open by design: every fault (no transcript, a line that does not parse,
 * a state file it cannot read or write) returns no ask, so a fault never
 * blocks a stop.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { stateRoot } from "./asset_root_lib.ts";

/** Model turns of the main agent between two asks, when the env sets none. */
export const DEFAULT_TURNS = 160;
/** The env variable that sets the threshold to a whole number. */
export const TURNS_ENV = "STARK_TELL_ON_STOP_TURNS";

/** The text of the ask, word for word from STARK-18495 step 8. */
export const ASK_TEXT =
  "Before you stop: call tell_librarian once for each lasting fact that this session found or confirmed " +
  "and that the librarian did not already give you: what a fleet tool, repo or vendor system does or where it lives, " +
  "a decision, or a person's role. Give each fact's source and its day. Tell at most 5. " +
  "Do not tell a secret, a credential, a customer's data, or a code detail of one repo, " +
  "which belongs in that repo's CLAUDE.md. If there is no such fact, stop.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The threshold: the positive whole number in `STARK_TELL_ON_STOP_TURNS`, else 160. */
export function threshold(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[TURNS_ENV]?.trim();
  if (raw && /^[0-9]+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return DEFAULT_TURNS;
}

/**
 * The main agent's model turns: the distinct `message.id` values of the
 * `assistant` lines that are not `isSidechain`. Splits on `\n` only: readline
 * also splits at U+2028 and U+2029, which a transcript can hold inside a JSON
 * string. A blank line is skipped; a line that does not parse throws.
 */
export function countTurns(transcript: string): number {
  const ids = new Set<string>();
  for (const line of transcript.split("\n")) {
    if (line.trim() === "") continue;
    const entry = JSON.parse(line);
    if (entry?.type !== "assistant" || entry.isSidechain === true) continue;
    const id = entry.message?.id;
    if (typeof id === "string" && id !== "") ids.add(id);
  }
  return ids.size;
}

/** True when `cwd` is the librarian's state folder or under it: the librarian runs its own sessions there. */
export function inLibrarianState(cwd: string, home: string = os.homedir()): boolean {
  const rel = path.relative(path.join(home, ".local", "state", "atlas", "librarian"), path.resolve(cwd));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** The state file of one session: `<stateRoot()>/tell-on-stop/<session_id>.json`. */
export function statePath(sessionId: string, root: string = stateRoot()): string {
  return path.join(root, "tell-on-stop", `${sessionId}.json`);
}

/** The turn count of this session's last ask: 0 when there is no state file. Throws on a file it cannot read. */
export function lastAsk(file: string): number {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw e;
  }
  const turns = JSON.parse(raw)?.turns;
  if (!Number.isSafeInteger(turns) || turns < 0) throw new Error(`${file}: no whole-number turns`);
  return turns;
}

/** Records the count of this ask, mode 0600, by a temp file and a rename, so a reader never sees half a file. */
export function writeAsk(file: string, turns: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify({ turns, asked: new Date().toISOString() })}\n`, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

export interface HookOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** The state root; defaults to `stateRoot()`, which reads `STARK_STATE_ROOT`. */
  root?: string;
}

/**
 * The decision for one `Stop` payload: the ask's stdout line, or null to say
 * nothing. Records the count before it asks, so a state file it cannot write
 * means no ask. Never throws.
 */
export function decide(raw: string, opts: HookOptions = {}): string | null {
  try {
    const data = JSON.parse(raw);
    if (data === null || typeof data !== "object") return null;
    if (data.stop_hook_active === true) return null;
    const { session_id: sessionId, transcript_path: transcriptPath, cwd } = data;
    if (typeof sessionId !== "string" || !UUID.test(sessionId)) return null;
    if (typeof transcriptPath !== "string" || transcriptPath === "") return null;
    if (typeof cwd !== "string" || cwd === "" || inLibrarianState(cwd, opts.home)) return null;

    const turns = countTurns(fs.readFileSync(transcriptPath, "utf8"));
    const file = statePath(sessionId, opts.root);
    if (turns < lastAsk(file) + threshold(opts.env)) return null;
    writeAsk(file, turns);
    return JSON.stringify({ decision: "block", reason: ASK_TEXT });
  } catch {
    return null;
  }
}
