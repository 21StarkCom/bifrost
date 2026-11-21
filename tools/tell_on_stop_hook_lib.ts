/**
 * tell-on-stop hook — the decision.
 *
 * A long Claude Code session finds facts that the librarian does not hold, and
 * they are lost when the session ends. On each `Stop`, the hook counts the main
 * agent's model turns in the transcript. When the count has grown by the
 * threshold since this session's last ask, the hook continues the session once
 * and asks the agent to call `tell_librarian` for each lasting fact. It asks
 * with `additionalContext`, not `decision: "block"`: Claude Code shows a Stop
 * block as "Stop hook reported a problem", and context as "Stop hook says:",
 * and both keep the agent going for one more turn. It asks only
 * when the user's Claude config names an MCP server called `librarian`, and
 * never after the session armed `muxctl poison-pill` (a Gru, Minion or Agnes
 * that stands down): its reaper quits the session and would cut the calls off.
 *
 * Fail-open by design: every fault (no transcript, a line that does not parse,
 * a state file it cannot read or write, a Claude config it cannot read)
 * returns no ask, so a fault never blocks a stop.
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
 * The launchd label prefix that `muxctl poison-pill` gives each reaper it arms
 * on macOS. mux-control kept hermod's ids when it renamed the command
 * (0.53.0), so this prefix also matches a reaper that an old `hermod` armed.
 */
export const PILL_LABEL = "com.21stark.hermod.poison-pill.";
/** The systemd unit prefix that `muxctl poison-pill` (or an old `hermod`) gives each reaper it arms on Linux. */
export const PILL_UNIT = "hermod-poison-pill-";

/** What the hook reads from a transcript. */
export interface TranscriptScan {
  /** The main agent's model turns. */
  turns: number;
  /** True when the main agent armed `muxctl poison-pill`: its reaper quits the session within seconds. */
  armed: boolean;
}

/**
 * Reads a transcript in one pass. The turns are the distinct `message.id`
 * values of the `assistant` lines that are not `isSidechain`. Splits on `\n`
 * only: readline also splits at U+2028 and U+2029, which a transcript can hold
 * inside a JSON string. A blank line is skipped; any other line that does not
 * parse throws, since a fault must print nothing (STARK-18495 step 10).
 * Parsing every line costs 0.19s on a 38 MB transcript of 2410 turns.
 */
export function scanTranscript(transcript: string): TranscriptScan {
  const ids = new Set<string>();
  let armed = false;
  for (const line of transcript.split("\n")) {
    if (line.trim() === "") continue;
    const entry = JSON.parse(line);
    if (entry?.isSidechain === true) continue;
    if (entry?.type === "user") {
      // Both reaper label prefixes hold "poison-pill": skip the rest of the work on each other line.
      if (!armed && line.includes("poison-pill")) armed = isArmEntry(entry);
      continue;
    }
    if (entry?.type !== "assistant") continue;
    const id = entry.message?.id;
    if (typeof id === "string" && id !== "") ids.add(id);
  }
  return { turns: ids.size, armed };
}

/**
 * True for a main-agent `user` line that holds the ack of an armed pill. A
 * Bash result keeps its stdout apart in `toolUseResult.stdout`; read that when
 * it is there, since the tool result's text puts stderr (a warning, or Claude
 * Code's "Shell cwd was reset" note) after stdout.
 */
function isArmEntry(entry: { toolUseResult?: { stdout?: unknown }; message?: { content?: unknown } }): boolean {
  const stdout = entry.toolUseResult?.stdout;
  if (typeof stdout === "string") return isArmAck(stdout);
  const content = entry.message?.content;
  return Array.isArray(content) && content.some((block) => isArmAck(resultText(block)));
}

/** The text of a `tool_result` block, or "" for any other block. */
function resultText(block: unknown): string {
  if (block === null || typeof block !== "object") return "";
  const { type, content } = block as { type?: unknown; content?: unknown };
  if (type !== "tool_result") return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (c?.type === "text" && typeof c.text === "string" ? c.text : "")).join("\n");
}

/**
 * True for tool output whose last line is the ack of an armed pill:
 * `muxctl poison-pill --json` prints one JSON object with `"armed":true` and
 * the reaper's `label` (a launchd label on macOS, a systemd unit on Linux). A
 * dry run prints neither. Tool output is not transcript structure, so a last
 * line that does not parse is no arm, not a fault.
 */
function isArmAck(text: string): boolean {
  if (!text.includes(PILL_LABEL) && !text.includes(PILL_UNIT)) return false;
  const last = text.trimEnd().split("\n").pop() ?? "";
  try {
    const ack = JSON.parse(last);
    const label = ack?.label;
    return ack?.armed === true && typeof label === "string" && (label.startsWith(PILL_LABEL) || label.startsWith(PILL_UNIT));
  } catch {
    return false;
  }
}

/**
 * True for a headless run: `claude -p` sets `CLAUDE_CODE_ENTRYPOINT` to
 * `sdk-cli`, and the Agent SDK to `sdk-ts` or `sdk-py`. A program reads the
 * last reply of such a run, so a block would replace that reply with the
 * answer to the ask. An interactive session sets `cli`, or an app's own name.
 */
export function isHeadless(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CLAUDE_CODE_ENTRYPOINT ?? "").startsWith("sdk");
}

/** Claude Code's user config file: `$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json`. */
export function claudeJsonPath(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  return path.join(env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : home, ".claude.json");
}

/**
 * True when the user config names an MCP server called `librarian`, which
 * `librarian install` adds at user scope. With no such server the session has
 * no `tell_librarian` tool, so an ask would cost a turn for nothing. Throws on
 * a file it cannot read or parse: a fault, so no ask.
 */
export function hasLibrarianServer(file: string): boolean {
  const servers = JSON.parse(fs.readFileSync(file, "utf8"))?.mcpServers;
  return servers !== null && typeof servers === "object" && Object.hasOwn(servers, "librarian");
}

/** True when `cwd` is the librarian's state folder or under it: the librarian runs its own sessions there. */
export function inLibrarianState(cwd: string, home: string = os.homedir()): boolean {
  const rel = path.relative(path.join(home, ".local", "state", "atlas", "librarian"), path.resolve(cwd));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
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
    if (data.stop_hook_active === true || isHeadless(opts.env)) return null;
    const { session_id: sessionId, transcript_path: transcriptPath, cwd } = data;
    if (typeof sessionId !== "string" || !UUID.test(sessionId)) return null;
    if (typeof transcriptPath !== "string" || transcriptPath === "") return null;
    if (typeof cwd !== "string" || cwd === "" || inLibrarianState(cwd, opts.home)) return null;

    const { turns, armed } = scanTranscript(fs.readFileSync(transcriptPath, "utf8"));
    // After the arm, the reaper quits the session and would cut the librarian calls off.
    if (armed) return null;
    const file = statePath(sessionId, opts.root);
    if (turns < lastAsk(file) + threshold(opts.env)) return null;
    // Read only when an ask is due: the config file can be large.
    if (!hasLibrarianServer(claudeJsonPath(opts.env, opts.home))) return null;
    writeAsk(file, turns);
    return JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: ASK_TEXT } });
  } catch {
    return null;
  }
}
