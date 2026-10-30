#!/usr/bin/env -S node --experimental-strip-types
/**
 * ask-guard weekly metric: did "Act, don't ask" cut the operator's nudges?
 *
 * For one week of 7 local days it counts, in `~/.claude/history.jsonl`
 * (`$CLAUDE_CONFIG_DIR/history.jsonl` when set), every prompt and every
 * one-word reply: a prompt that is only a nudge (`go`, `continue`, `yes`,
 * `merge`, `ship it`, …) or an option pick (`1`, `a`), and prints the
 * operator's baseline beside them.
 *
 * It also reads the Claude Code transcripts (`projects/<folder>/<id>.jsonl` in
 * the same folder, subagent folders skipped) and counts the turns that end on a
 * question: tagged by the root rules (`Needs you (<tag>): …`) or untagged.
 * Each untagged question points to a rule to fix, so it lists the newest.
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
import { stateRoot } from "./asset_root_lib.ts";

export const USAGE = `usage: ask_guard_metric.ts [--week YYYY-MM-DD] [--json] [--notify]
       ask_guard_metric.ts --install-schedule | --uninstall-schedule

Counts one week (7 local days) of prompts and one-word replies in
~/.claude/history.jsonl, beside the baseline, and the turns that end on a
question, tagged (Needs you (<tag>): …) or untagged, in the transcripts
~/.claude/projects/*/*.jsonl.

  --week YYYY-MM-DD     first day of the week (default: the 7 days before today)
  --json                print the result as JSON
  --notify              also send the result with heimdall send
  --install-schedule    write and load the launchd job com.21stark.ask-guard-metric
                        (--notify each Thursday 09:00 local)
  --uninstall-schedule  unload and remove that job
`;

/** The operator's own count, the week this metric measures against. */
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

function day(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const n = (v: number) => v.toLocaleString("en-US");

/** The tags the root rules allow on a question that ends a turn, `Needs you (<tag>): …`. */
export const QUESTION_KINDS = ["GO", "Yours", "Your hands", "Design approval"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** The last assistant text of a turn, before the operator's next prompt or the end of the file. */
export interface TurnEnd {
  uuid: string;
  ts: number;
  text: string;
  cwd: string;
  sessionId: string;
}

/** A prompt the operator typed: not meta, not a compact summary, no tool result,
 * and no text that starts with `<` (a slash command, a task notification). */
export function isPrompt(row: any): boolean {
  if (row?.isMeta === true || row?.isCompactSummary === true) return false;
  const c = row?.message?.content;
  let texts: string[];
  if (typeof c === "string") {
    texts = [c];
  } else if (Array.isArray(c)) {
    if (c.some((b) => b?.type === "tool_result")) return false;
    texts = c.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text);
  } else {
    return false;
  }
  return texts.length > 0 && !texts.some((t) => t.trimStart().startsWith("<"));
}

/** The turn ends of one transcript, in file order. A later `tool_use` cancels a
 * text, across the lines one API message spans; sidechain lines are skipped. */
export function turnEnds(lines: Iterable<string>): TurnEnd[] {
  const out: TurnEnd[] = [];
  let last: TurnEnd | undefined;
  for (const line of lines) {
    const assistant = line.includes('"type":"assistant"');
    if (!assistant && !line.includes('"type":"user"')) continue;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row?.isSidechain === true) continue;
    if (row?.type === "assistant") {
      const blocks = row.message?.content;
      if (!Array.isArray(blocks)) continue;
      for (const b of blocks) {
        if (b?.type === "tool_use") {
          last = undefined;
        } else if (b?.type === "text" && typeof b.text === "string" && b.text.trim() && typeof row.uuid === "string") {
          const ts = Date.parse(row.timestamp);
          if (Number.isNaN(ts)) continue;
          last = { uuid: row.uuid, ts, text: b.text, cwd: String(row.cwd ?? ""), sessionId: String(row.sessionId ?? "") };
        }
      }
    } else if (row?.type === "user" && isPrompt(row)) {
      if (last) out.push(last);
      last = undefined;
    }
  }
  if (last) out.push(last);
  return out;
}

/** Sort the last non-empty line of a turn end: a tagged question, an untagged one, or none. */
export function classifyEnding(text: string): { kind: QuestionKind | "untagged" | "none"; line: string } {
  const line = text.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
  const tag = "Needs you (";
  if (line.startsWith(tag)) {
    const kind = QUESTION_KINDS.find((k) => line.startsWith(k, tag.length));
    if (kind) return { kind, line };
  }
  return { kind: line.includes("?") ? "untagged" : "none", line };
}

export interface Untagged {
  ts: number;
  cwd: string;
  sessionId: string;
  line: string;
}

export interface QuestionCounts {
  /** Turn ends inside the week. */
  turnEnds: number;
  tagged: Record<QuestionKind, number>;
  untagged: Untagged[];
  /** The oldest turn end read, inside the week or not (ms), when there is one. */
  oldest?: number;
}

/** Count the turn ends of each transcript inside the week, each `uuid` once. */
export function countQuestions(transcripts: Iterable<Iterable<string>>, week: Week): QuestionCounts {
  const out: QuestionCounts = { turnEnds: 0, tagged: { GO: 0, Yours: 0, "Your hands": 0, "Design approval": 0 }, untagged: [] };
  const from = week.start.getTime();
  const to = week.end.getTime();
  const seen = new Set<string>();
  for (const lines of transcripts) {
    for (const t of turnEnds(lines)) {
      if (seen.has(t.uuid)) continue;
      seen.add(t.uuid);
      if (out.oldest === undefined || t.ts < out.oldest) out.oldest = t.ts;
      if (t.ts < from || t.ts >= to) continue;
      out.turnEnds++;
      const { kind, line } = classifyEnding(t.text);
      if (kind === "untagged") out.untagged.push({ ts: t.ts, cwd: t.cwd, sessionId: t.sessionId, line });
      else if (kind !== "none") out.tagged[kind]++;
    }
  }
  return out;
}

/** The lines of a file, read in 1 MiB chunks so a large transcript is never one string. */
export function* fileLines(file: string): Generator<string> {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    let parts: Buffer[] = [];
    for (let got = fs.readSync(fd, buf); got > 0; got = fs.readSync(fd, buf)) {
      const chunk = buf.subarray(0, got);
      let at = 0;
      for (let nl = chunk.indexOf(10); nl !== -1; nl = chunk.indexOf(10, at)) {
        const tail = chunk.subarray(at, nl);
        yield parts.length ? Buffer.concat([...parts, tail]).toString("utf8") : tail.toString("utf8");
        parts = [];
        at = nl + 1;
      }
      if (at < got) parts.push(Buffer.from(chunk.subarray(at)));
    }
    if (parts.length) yield Buffer.concat(parts).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** The transcripts `projects/<folder>/<id>.jsonl` changed on or after `since`; subfolders hold subagents and are skipped. */
export function transcriptFiles(dir: string, since: Date): string[] {
  const root = path.join(dir, "projects");
  let folders: fs.Dirent[];
  try {
    folders = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const f of folders) {
    if (!f.isDirectory()) continue;
    for (const e of fs.readdirSync(path.join(root, f.name), { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      const file = path.join(root, f.name, e.name);
      if (fs.statSync(file).mtimeMs >= since.getTime()) out.push(file);
    }
  }
  return out;
}

/** Cut to `max` characters, never inside a surrogate pair. */
const cut = (s: string, max: number) => Array.from(s).slice(0, max).join("");

export interface QuestionReport {
  /** Turn ends inside the week. */
  turn_ends: number;
  tagged: Record<QuestionKind, number>;
  untagged: number;
  /** The date of the oldest turn end read, and the days of the week the transcripts reach. */
  coverage: { oldest: string | null; whole_week: boolean; days: { from: string; last: string } | null };
  /** Up to 10 untagged questions, newest first: local date, last segment of `cwd`, session, line cut to 160 characters. */
  newest_untagged: { date: string; folder: string; session: string; line: string }[];
}

export interface Result {
  week: { start: string; last: string };
  prompts: number;
  one_word_replies: number;
  go: number;
  /** Each reply word and its count, most first. */
  words: [string, number][];
  /** The operator's count, and this rule's count of the same week from today's history. */
  baseline: typeof BASELINE & { recount: { replies: number; go: number; prompts: number } };
  questions: QuestionReport;
}

function coverage(week: Week, last: Date, oldest: number | undefined): QuestionReport["coverage"] {
  if (oldest === undefined) return { oldest: null, whole_week: false, days: null };
  const o = new Date(oldest);
  const oDay = new Date(o.getFullYear(), o.getMonth(), o.getDate());
  const whole = oDay.getTime() <= week.start.getTime();
  const days = whole ? { from: day(week.start), last: day(last) } : oDay < week.end ? { from: day(oDay), last: day(last) } : null;
  return { oldest: day(oDay), whole_week: whole, days };
}

export function result(week: Week, p: PromptCounts, base: PromptCounts, q: QuestionCounts): Result {
  const last = new Date(week.end.getFullYear(), week.end.getMonth(), week.end.getDate() - 1);
  return {
    week: { start: day(week.start), last: day(last) },
    prompts: p.prompts,
    one_word_replies: p.replies,
    go: p.go,
    words: Object.entries(p.words).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])),
    baseline: { ...BASELINE, recount: { replies: base.replies, go: base.go, prompts: base.prompts } },
    questions: {
      turn_ends: q.turnEnds,
      tagged: { ...q.tagged },
      untagged: q.untagged.length,
      coverage: coverage(week, last, q.oldest),
      newest_untagged: [...q.untagged]
        .sort((x, y) => y.ts - x.ts)
        .slice(0, 10)
        .map((u) => ({ date: day(new Date(u.ts)), folder: path.basename(u.cwd), session: u.sessionId, line: cut(u.line, 160) })),
    },
  };
}

export function title(r: Result): string {
  return `Act, don't ask: ${r.one_word_replies} one-word replies (baseline ${BASELINE.replies}), ${r.questions.untagged} untagged questions`;
}

const tagged = (q: QuestionReport) => QUESTION_KINDS.map((k) => `${k} ${q.tagged[k]}`).join(", ");
const taggedTotal = (q: QuestionReport) => QUESTION_KINDS.reduce((s, k) => s + q.tagged[k], 0);

/** The line that names the days counted, when the transcripts do not reach the week's first day. */
function coverageNote(q: QuestionReport): string | undefined {
  const c = q.coverage;
  if (c.whole_week) return undefined;
  if (!c.days) return "no day of the week counted: no transcript reaches it";
  return `only ${c.days.from} to ${c.days.last} counted: the transcripts start after the week's first day`;
}

export function render(r: Result): string {
  const words = r.words.map(([w, c]) => `${w} ${c}`).join(", ") || "none";
  const re = r.baseline.recount;
  const q = r.questions;
  const note = coverageNote(q);
  return [
    `Act, don't ask: week ${r.week.start} to ${r.week.last} (local)`,
    `  prompts           ${n(r.prompts)}`,
    `  one-word replies  ${n(r.one_word_replies)} (${words})`,
    `  go                ${n(r.go)}`,
    `  baseline, week of ${BASELINE.week}: ${BASELINE.replies} one-word replies, ${BASELINE.go} go, ${n(BASELINE.prompts)} prompts` +
      ` (this rule counts ${re.replies}, ${re.go}, ${n(re.prompts)})`,
    `  turn ends         ${n(q.turn_ends)}`,
    `  tagged questions  ${n(taggedTotal(q))} (${tagged(q)})`,
    `  untagged          ${n(q.untagged)}`,
    `  coverage          ${q.coverage.oldest ? `oldest turn end read ${q.coverage.oldest}` : "no turn end read"}`,
    ...(note ? [`  ${note}`] : []),
    ...(q.newest_untagged.length
      ? [
          `  untagged questions, newest first (${q.newest_untagged.length} of ${n(q.untagged)}):`,
          ...q.newest_untagged.flatMap((u) => [`    ${[u.date, u.folder, u.session].filter(Boolean).join("  ")}`, `      ${u.line}`]),
        ]
      : []),
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

/** `$CLAUDE_CONFIG_DIR`, else `~/.claude`: the folder of history.jsonl and the transcripts. */
export function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude");
}

export function historyPath(): string {
  return path.join(configDir(), "history.jsonl");
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
  const log = path.join(stateRoot(), "ask-guard", "weekly.log");
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

/** The push body: the week, the baseline, the question counts and the 5 newest untagged questions. */
export function notifyBody(r: Result): string {
  const q = r.questions;
  const note = coverageNote(q);
  return [
    `Week ${r.week.start} to ${r.week.last}: ${n(r.prompts)} prompts, ${r.go} go. ` +
      `Baseline ${BASELINE.week}: ${BASELINE.replies} replies, ${BASELINE.go} go, ${n(BASELINE.prompts)} prompts.`,
    `Questions: ${n(taggedTotal(q))} tagged (${tagged(q)}), ${n(q.untagged)} untagged.` + (note ? ` Note: ${note}.` : ""),
    ...q.newest_untagged.slice(0, 5).map((u) => `${[u.date, u.folder].filter(Boolean).join(" ")}: ${u.line}`),
  ].join("\n");
}

function notify(r: Result): number {
  const body = notifyBody(r);
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
    countPrompts(history, weekWindow(BASELINE.week)),
    countQuestions(transcriptFiles(configDir(), week.start).map((f) => fileLines(f)), week),
  );
  process.stdout.write(flags.has("json") ? JSON.stringify(r, null, 2) + "\n" : render(r) + "\n");
  if (flags.has("notify")) return notify(r);
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
