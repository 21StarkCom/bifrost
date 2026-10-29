#!/usr/bin/env -S node --experimental-strip-types
/**
 * ask-guard weekly metric: did "Act, don't ask" cut the operator's nudges?
 *
 * For one week of 7 local days it counts, in `~/.claude/history.jsonl`
 * (`$CLAUDE_CONFIG_DIR/history.jsonl` when set), every prompt and every
 * one-word reply: a prompt that is only a nudge (`go`, `continue`, `yes`,
 * `merge`, `ship it`, …) or an option pick (`1`, `a`). It counts the Stop hook's
 * blocks in `<stateRoot>/ask-guard/blocks.jsonl`, and prints the operator's
 * baseline beside them.
 *
 *   ask_guard_metric.ts [--week YYYY-MM-DD] [--json] [--notify]
 *   ask_guard_metric.ts --install-schedule | --uninstall-schedule
 *
 * The week starts at local midnight of `--week`; by default it is the 7 days
 * before today. `--notify` also sends the result as a heimdall push.
 * `--install-schedule` writes and loads a launchd job that runs
 * `--notify` each Thursday at 09:00, so each report covers Thursday to
 * Wednesday, the same days as the baseline week; its output goes to
 * `<stateRoot>/ask-guard/weekly.log`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { precheckCli } from "./cli_args_lib.ts";
import { isMainModule } from "./main_module_lib.ts";
import { blockLogPath } from "./ask_guard_lib.ts";

export const USAGE = `usage: ask_guard_metric.ts [--week YYYY-MM-DD] [--json] [--notify]
       ask_guard_metric.ts --install-schedule | --uninstall-schedule

Counts one week (7 local days) of prompts and one-word replies in
~/.claude/history.jsonl, and the ask-guard Stop hook's blocks, beside the baseline.

  --week YYYY-MM-DD     first day of the week (default: the 7 days before today)
  --json                print the result as JSON
  --notify              also send the result with heimdall send
  --install-schedule    write and load the launchd job com.21stark.ask-guard-metric
                        (--notify each Thursday 09:00 local)
  --uninstall-schedule  unload and remove that job
`;

/** The operator's own count, from before the hook. */
export const BASELINE = { week: "2026-10-22", replies: 81, go: 39, prompts: 2375 } as const;

export const LABEL = "com.21stark.ask-guard-metric";

const NUDGES = new Set([
  "go", "go ahead", "continue", "proceed", "yes", "ok", "okay",
  "merge", "ship it", "fix it", "do it", "approved", "approve",
]);

/** Lowercase, trimmed, inner space collapsed, trailing punctuation gone. */
export function normalizeReply(display: unknown): string {
  if (typeof display !== "string") return "";
  return display.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?,]+$/, "");
}

/** A one-word reply: a nudge word, or a single option pick (`1`-`9`, `a`-`e`). */
export function isOneWordReply(norm: string): boolean {
  return NUDGES.has(norm) || /^(?:[1-9]|[a-e])$/.test(norm);
}

export interface Week {
  start: Date;
  end: Date;
}

/** The 7 local days from midnight of `start` (YYYY-MM-DD), or the 7 days before `now`. */
export function weekWindow(start: string | undefined, now = new Date()): Week {
  let s: Date;
  if (start === undefined) {
    s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
    if (!m) throw new Error(`--week ${start}: use YYYY-MM-DD`);
    s = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (s.getMonth() !== Number(m[2]) - 1 || s.getDate() !== Number(m[3])) throw new Error(`--week ${start}: no such date`);
  }
  return { start: s, end: new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7) };
}

export interface PromptCounts {
  prompts: number;
  replies: number;
  go: number;
  words: Record<string, number>;
}

/** Count history.jsonl lines (`display`, `timestamp` in ms) inside the week. */
export function countPrompts(lines: Iterable<string>, week: Week): PromptCounts {
  const out: PromptCounts = { prompts: 0, replies: 0, go: 0, words: {} };
  const from = week.start.getTime();
  const to = week.end.getTime();
  for (const line of lines) {
    if (!line.trim()) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = row?.timestamp;
    if (typeof ts !== "number" || ts < from || ts >= to) continue;
    out.prompts++;
    const norm = normalizeReply(row.display);
    if (!isOneWordReply(norm)) continue;
    out.replies++;
    if (norm === "go") out.go++;
    out.words[norm] = (out.words[norm] ?? 0) + 1;
  }
  return out;
}

export interface BlockCounts {
  blocks: number;
  ask: number;
  defer: number;
}

/** Count the hook's block lines (`time` as ISO) inside the week. */
export function countBlocks(lines: Iterable<string>, week: Week): BlockCounts {
  const out: BlockCounts = { blocks: 0, ask: 0, defer: 0 };
  const from = week.start.getTime();
  const to = week.end.getTime();
  for (const line of lines) {
    if (!line.trim()) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const t = typeof row?.time === "string" ? Date.parse(row.time) : NaN;
    if (Number.isNaN(t) || t < from || t >= to) continue;
    out.blocks++;
    if (row.kind === "defer") out.defer++;
    else out.ask++;
  }
  return out;
}

function day(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const n = (v: number) => v.toLocaleString("en-US");

export interface Result {
  week: { start: string; last: string };
  prompts: number;
  one_word_replies: number;
  go: number;
  /** Each reply word and its count, most first. */
  words: [string, number][];
  blocks: number;
  blocks_ask: number;
  blocks_defer: number;
  /** The operator's count, and this rule's count of the same week from today's history. */
  baseline: typeof BASELINE & { recount: { replies: number; go: number; prompts: number } };
}

export function result(week: Week, p: PromptCounts, b: BlockCounts, base: PromptCounts): Result {
  const last = new Date(week.end.getFullYear(), week.end.getMonth(), week.end.getDate() - 1);
  return {
    week: { start: day(week.start), last: day(last) },
    prompts: p.prompts,
    one_word_replies: p.replies,
    go: p.go,
    words: Object.entries(p.words).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])),
    blocks: b.blocks,
    blocks_ask: b.ask,
    blocks_defer: b.defer,
    baseline: { ...BASELINE, recount: { replies: base.replies, go: base.go, prompts: base.prompts } },
  };
}

export function title(r: Result): string {
  return `Act, don't ask: ${r.one_word_replies} one-word replies (baseline ${BASELINE.replies}), ${r.blocks} hook blocks`;
}

export function render(r: Result): string {
  const words = r.words.map(([w, c]) => `${w} ${c}`).join(", ") || "none";
  const re = r.baseline.recount;
  return [
    `Act, don't ask: week ${r.week.start} to ${r.week.last} (local)`,
    `  prompts           ${n(r.prompts)}`,
    `  one-word replies  ${n(r.one_word_replies)} (${words})`,
    `  go                ${n(r.go)}`,
    `  hook blocks       ${n(r.blocks)} (ask ${r.blocks_ask}, defer ${r.blocks_defer})`,
    `  baseline, week of ${BASELINE.week}: ${BASELINE.replies} one-word replies, ${BASELINE.go} go, ${n(BASELINE.prompts)} prompts` +
      ` (this rule counts ${re.replies}, ${re.go}, ${n(re.prompts)})`,
  ].join("\n");
}

function readLines(file: string): string[] {
  try {
    return fs.readFileSync(file, "utf8").split("\n");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export function historyPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude");
  return path.join(dir, "history.jsonl");
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The launchd job: `--notify` each Thursday 09:00 local, output to `log`. */
export function plist(tool: string, log: string, envPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>${xml(tool)}</string>
    <string>--notify</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(envPath)}</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

function plistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

/** The tool path the job runs: the `~/.claude/code-review/tools` link into the
 * checkout when it is there, since a plugin cache path changes with each version. */
function stableToolPath(): string {
  const linked = path.join(os.homedir(), ".claude", "code-review", "tools", "ask_guard_metric.ts");
  return fs.existsSync(linked) ? linked : fileURLToPath(import.meta.url);
}

/** The first `PATH` folder that holds an executable `bin`, as the installer's shell sees it. */
function binDir(bin: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    try {
      fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
      return dir;
    } catch {
      /* next */
    }
  }
  return undefined;
}

function launchctl(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("launchctl", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function installSchedule(): number {
  if (process.platform !== "darwin") {
    process.stderr.write("--install-schedule needs macOS launchd\n");
    return 1;
  }
  const log = path.join(path.dirname(blockLogPath()), "weekly.log");
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const file = plistPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // launchd starts with a bare PATH: keep the folders that hold this install's
  // node and heimdall (a version manager's shims, say), then the system ones.
  const found = ["node", "heimdall"].map((bin) => binDir(bin)).filter((d): d is string => d !== undefined);
  const envPath = [...new Set([...found, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])].join(":");
  fs.writeFileSync(file, plist(stableToolPath(), log, envPath));
  const domain = `gui/${process.getuid?.() ?? os.userInfo().uid}`;
  launchctl(["bootout", `${domain}/${LABEL}`]);
  const boot = launchctl(["bootstrap", domain, file]);
  if (!boot.ok) {
    process.stderr.write(`launchctl bootstrap ${domain} ${file} failed: ${boot.out}\n`);
    return 1;
  }
  process.stdout.write(`installed ${file}\nloaded ${domain}/${LABEL}: Thursdays 09:00 local, output to ${log}\n`);
  return 0;
}

function uninstallSchedule(): number {
  const domain = `gui/${process.getuid?.() ?? os.userInfo().uid}`;
  const out = launchctl(["bootout", `${domain}/${LABEL}`]);
  fs.rmSync(plistPath(), { force: true });
  process.stdout.write(`${out.ok ? "unloaded" : "not loaded:"} ${domain}/${LABEL}\nremoved ${plistPath()}\n`);
  return 0;
}

function notify(r: Result): number {
  const body =
    `Week ${r.week.start} to ${r.week.last}: ${n(r.prompts)} prompts, ${r.go} go, ` +
    `blocks ask ${r.blocks_ask} / defer ${r.blocks_defer}. ` +
    `Baseline ${BASELINE.week}: ${BASELINE.replies} replies, ${BASELINE.go} go, ${n(BASELINE.prompts)} prompts.`;
  const s = spawnSync("heimdall", ["send", "--body", body, "--", title(r)], { encoding: "utf8" });
  if (s.status !== 0) {
    process.stderr.write(`heimdall send failed (${s.error?.message ?? `exit ${s.status}`}): ${(s.stderr ?? "").trim()}\n`);
    return 1;
  }
  process.stdout.write(`notified: ${title(r)}\n`);
  return 0;
}

function main(argv: string[]): number {
  const { flags } = precheckCli(
    argv,
    { values: ["--week"], switches: ["--json", "--notify", "--install-schedule", "--uninstall-schedule"], equals: true },
    USAGE,
  );
  const modes = ["install-schedule", "uninstall-schedule"].filter((k) => flags.has(k));
  if (modes.length > 1 || (modes.length === 1 && flags.size > 1)) {
    process.stderr.write(`--${modes[0]} takes no other argument\n${USAGE}`);
    return 2;
  }
  if (flags.has("install-schedule")) return installSchedule();
  if (flags.has("uninstall-schedule")) return uninstallSchedule();

  let week: Week;
  try {
    week = weekWindow(flags.get("week") as string | undefined);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n${USAGE}`);
    return 2;
  }
  const history = readLines(historyPath());
  const r = result(
    week,
    countPrompts(history, week),
    countBlocks(readLines(blockLogPath()), week),
    countPrompts(history, weekWindow(BASELINE.week)),
  );
  process.stdout.write(flags.has("json") ? JSON.stringify(r, null, 2) + "\n" : render(r) + "\n");
  if (flags.has("notify")) return notify(r);
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
