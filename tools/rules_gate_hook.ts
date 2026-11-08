#!/usr/bin/env node
/**
 * The agent-doc gate: a PreToolUse hook that stops `njord pr-merge` when the PR
 * adds a RED clause, by the playbook triage, to an agent file. A RED that is on
 * the base branch already does not stop it.
 *
 * Shipped by the stark-ops plugin: its marketplace.json entry declares this hook
 * inline on PreToolUse through ${CLAUDE_PLUGIN_ROOT}, with an `if` gate that
 * starts node only for a Bash call that runs `njord pr-merge`.
 *
 * For each `njord pr-merge` in the command, the hook:
 *   1. finds the PR: the number in the command, else the PR of the branch
 *      (`gh pr view`, in the folder the command runs in);
 *   2. lists the agent files the PR adds or changes (`agentKind`);
 *   3. copies the tree of the PR head commit to a temp folder (`git archive`),
 *      fetching `refs/pull/<n>/head` first when the commit is not local;
 *   4. runs `rules_audit.ts --playbook --json --files` on those files in the
 *      copy. No RED allows the call, with no output.
 *   5. On a RED, finds the base: the merge base of the head and the tip of the
 *      base branch, fetching that branch first when its tip is not local. It
 *      copies the base tree too, pairs each file with its base path (a rename
 *      pairs with its old path, `git diff -M`; a file the PR adds has none),
 *      and triages the base files that exist.
 *   6. Denies the call for each head RED its base file does not have
 *      (`newReds`). The reason lists those clauses and counts the rest.
 * Any other result (a tool error, no PR, no network, or the end of the 240s
 * that all its subprocesses share) allows the call and prints one warning
 * line, to the operator as `systemMessage` and to the model as
 * `additionalContext`.
 *
 * The copies sit outside the workspace, so the start-up load set they measure
 * counts no CLAUDE.md above the repo: a load-set RED can pass here, and the
 * sweep reports it. The hook writes nothing outside its temp folder, which it
 * deletes, except what a fetch writes to the repo: objects, `FETCH_HEAD`, and
 * the base branch's `origin/` ref.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { precheckCli } from "./cli_args_lib.ts";
import { isMainModule } from "./main_module_lib.ts";
import { agentKind, newReds, type TriageReport } from "./rules_audit_lib.ts";

const USAGE = "usage: rules_gate_hook.ts (no arguments; PreToolUse JSON on stdin)\n";
const TOOLS_DIR = import.meta.dirname;
const AUDIT = path.join(TOOLS_DIR, "rules_audit.ts");
const PLAYBOOK = path.join(TOOLS_DIR, "..", "skill", "stark-agent-docs", "references", "playbook.md");
/** The fields of `gh pr view --json` that the gate reads. */
export const PR_FIELDS = "number,state,headRefOid,baseRefName,baseRefOid,changedFiles,files";

/** `njord pr-merge` options that take a value, from its argument parser. */
const VALUE_FLAGS = new Set(["--pr", "--changelog-section", "--force-reason", "--watch-timeout"]);
/** Words that run the next word as the command. */
const WRAPPERS = new Set(["env", "command", "time", "nohup", "exec"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The words of one simple command, or the start or end of a subshell. */
export type ShellPart = string[] | "(" | ")";

/**
 * The words of each simple command in a shell line, split at unquoted
 * `; & | ( )` and newlines, with each unquoted `(` and `)` as a part of its
 * own. Quotes and backslashes are resolved; `$` expansions stay as text.
 * Enough to find a `njord pr-merge`, its arguments and the folder it runs in.
 */
export function shellCommands(line: string): ShellPart[] {
  const out: ShellPart[] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      const stop = end < 0 ? line.length : end;
      word += line.slice(i + 1, stop);
      inWord = true;
      i = stop;
    } else if (c === '"') {
      inWord = true;
      for (i++; i < line.length && line[i] !== '"'; i++) {
        if (line[i] === "\\" && '"\\$`'.includes(line[i + 1] ?? "")) i++;
        word += line[i];
      }
    } else if (c === "\\") {
      if (i + 1 < line.length && line[i + 1] !== "\n") {
        word += line[i + 1];
        inWord = true;
      }
      i++;
    } else if (c === "#" && !inWord) {
      const end = line.indexOf("\n", i);
      i = end < 0 ? line.length : end - 1;
    } else if (";&|()\n".includes(c)) {
      endCommand();
      if (c === "(" || c === ")") out.push(c);
    } else if (c === " " || c === "\t" || c === "\r") {
      endWord();
    } else {
      word += c;
      inWord = true;
    }
  }
  endCommand();
  return out;
}

export interface MergeCall {
  /** The folder the command runs in: the hook's cwd, moved by each `cd` before it. */
  cwd: string;
  /** The PR the command names, or null for the PR of the branch. */
  pr: number | null;
  /** A help call: njord merges nothing. */
  help: boolean;
}

function mergeArgs(args: string[], cwd: string): MergeCall {
  let pr: number | null = null;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "help" || a === "-h" || a === "--help") help = true;
    else if (a === "--pr") {
      const n = Number(args[++i]);
      if (Number.isInteger(n) && n > 0) pr = n;
    } else if (VALUE_FLAGS.has(a)) i++;
    else if (/^\d+$/.test(a) && Number(a) > 0) pr = Number(a);
  }
  return { cwd, pr, help };
}

/** Each `njord pr-merge` in a Bash command line, with the folder it runs in. */
export function findMerges(line: string, cwd: string, home = os.homedir()): MergeCall[] {
  const out: MergeCall[] = [];
  let dir = cwd;
  /** The folder outside each open subshell: a `cd` inside one ends with it. */
  const outer: string[] = [];
  for (const words of shellCommands(line)) {
    if (words === "(") {
      outer.push(dir);
      continue;
    }
    if (words === ")") {
      dir = outer.pop() ?? dir;
      continue;
    }
    let i = 0;
    while (i < words.length && (ASSIGNMENT.test(words[i]) || WRAPPERS.has(words[i]))) i++;
    const name = words[i];
    if (name === "cd") {
      const to = words[i + 1];
      if (to === undefined) dir = home;
      else if (to !== "-") dir = path.resolve(dir, to.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home));
    } else if (name !== undefined && path.basename(name) === "njord" && words[i + 1] === "pr-merge") {
      out.push(mergeArgs(words.slice(i + 2), dir));
    }
  }
  return out;
}

export type Verdict = { kind: "pass" } | { kind: "red"; text: string } | { kind: "warn"; text: string };

const PASS: Verdict = { kind: "pass" };
const warn = (text: string): Verdict => ({ kind: "warn", text });

interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** The time all subprocesses of one hook run share. Claude Code kills a command
 *  hook at 600s, before its `finally` can delete the temp copy. */
export const BUDGET_MS = 240_000;
const DEADLINE = Date.now() + BUDGET_MS;

/** A subprocess timeout cut to what is left of the budget: at least 1ms, since
 *  a 0 timeout means none to spawnSync. */
export function timeLeft(timeoutMs: number, now = Date.now(), deadline = DEADLINE): number {
  return Math.max(1, Math.min(timeoutMs, deadline - now));
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number, env?: NodeJS.ProcessEnv): Ran {
  const r = spawnSync(cmd, args, {
    cwd, env, encoding: "utf8", timeout: timeLeft(timeoutMs), maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr || r.error?.message || "" };
}

function firstLine(text: string): string {
  return text.split("\n").map((l) => l.trim()).find(Boolean) ?? "no output";
}

/**
 * Where the root rules (~/Code/CLAUDE.md) sit in the repo at `cwd`, as a repo
 * path, or null when that repo does not hold them. Worktrees of one repo share
 * a git common dir, so a worktree of that repo counts too.
 */
function rootRulesIn(cwd: string, home: string): string | null {
  let real: string;
  try {
    real = fs.realpathSync(path.join(home, "Code", "CLAUDE.md"));
  } catch {
    return null;
  }
  const where = (dir: string) => {
    const r = run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"], dir, 30_000);
    const [common, top] = r.status === 0 ? r.stdout.trim().split("\n") : [];
    if (!common || !top) return null;
    try {
      return { common: fs.realpathSync(common), top: fs.realpathSync(top) };
    } catch {
      return null;
    }
  };
  const here = where(cwd);
  const there = where(path.dirname(real));
  if (!here || !there || here.common !== there.common) return null;
  return path.relative(there.top, real).split(path.sep).join("/");
}

const SHA_RE = /^[0-9a-f]{40}$/;

function hasCommit(cwd: string, sha: string): boolean {
  return run("git", ["cat-file", "-e", `${sha}^{commit}`], cwd, 30_000).status === 0;
}

/** True when commit `sha` is here, after a fetch of `ref` from origin when it was not. */
function ensureCommit(cwd: string, sha: string, ref: string): boolean {
  if (hasCommit(cwd, sha)) return true;
  run("git", ["fetch", "--quiet", "--no-tags", "origin", ref], cwd, 120_000);
  return hasCommit(cwd, sha);
}

interface PrFiles {
  number: number;
  state: string;
  headRefOid: string;
  baseRefName: string;
  baseRefOid: string;
  changedFiles: number;
  files: { path: string; changeType: string }[];
}

/** The agent files a PR adds or changes, by `gh`; a string is the reason it failed. */
function changedAgentFiles(cwd: string, pr: PrFiles): string[] | string {
  let paths = pr.files.filter((f) => f.changeType !== "DELETED").map((f) => f.path);
  if (pr.files.length < pr.changedFiles) {
    // `gh pr view` lists the first 100 files only; REST pages through all.
    const rest = run("gh", [
      "api", "--paginate", `repos/{owner}/{repo}/pulls/${pr.number}/files`,
      "--jq", '.[] | select(.status != "removed") | .filename',
    ], cwd, 60_000);
    if (rest.status !== 0) return `could not list the files of PR #${pr.number} (${firstLine(rest.stderr)})`;
    paths = rest.stdout.split("\n").filter(Boolean);
  }
  return [...new Set(paths.filter((p) => agentKind(p) !== null))].sort();
}

/** Triage the agent files one `njord pr-merge` would merge. */
export function gate(call: MergeCall, audit = AUDIT, home = os.homedir()): Verdict {
  if (!fs.statSync(call.cwd, { throwIfNoEntry: false })?.isDirectory()) {
    return warn(`the merge runs in ${call.cwd}, which is not a folder here`);
  }
  const select = call.pr === null ? [] : [String(call.pr)];
  const view = run("gh", ["pr", "view", ...select, "--json", PR_FIELDS], call.cwd, 30_000);
  const which = call.pr === null ? "the PR of this branch" : `PR #${call.pr}`;
  if (view.status !== 0) return warn(`could not read ${which} (${firstLine(view.stderr)})`);
  let pr: PrFiles;
  try {
    pr = JSON.parse(view.stdout);
  } catch {
    return warn(`gh pr view printed no JSON for ${which}`);
  }
  if (pr.state !== "OPEN") return PASS; // njord merges only an open PR
  if (!Array.isArray(pr.files) || !SHA_RE.test(String(pr.headRefOid))) {
    return warn(`gh pr view gave no files or head commit for ${which}`);
  }
  const files = changedAgentFiles(call.cwd, pr);
  if (typeof files === "string") return warn(files);
  if (!files.length) return PASS;

  const n = pr.number;
  const sha = pr.headRefOid;
  // The git calls run at the top of the work tree: `git archive` in a subfolder
  // copies only that subfolder.
  const topRun = run("git", ["rev-parse", "--show-toplevel"], call.cwd, 30_000);
  const top = topRun.stdout.trim();
  if (topRun.status !== 0 || !top) return warn(`${call.cwd} is in no git work tree (${firstLine(topRun.stderr)})`);
  if (!ensureCommit(top, sha, `refs/pull/${n}/head`)) {
    return warn(`the head commit ${sha.slice(0, 12)} of PR #${n} is not here, and the fetch did not bring it`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rules-gate-"));
  try {
    const rules = rootRulesIn(call.cwd, home);
    const head = triageIn(copyTree(top, sha, tmp, "head", n), files, rules, audit, tmp, "head", n);
    if (!head.files.some((f) => f.clauses.some((c) => c.flag === "RED"))) return PASS;

    if (!SHA_RE.test(String(pr.baseRefOid)) || typeof pr.baseRefName !== "string" || !pr.baseRefName) {
      return warn(`gh pr view gave no base branch for PR #${n}`);
    }
    if (!ensureCommit(top, pr.baseRefOid, `refs/heads/${pr.baseRefName}`)) {
      return warn(`the tip ${pr.baseRefOid.slice(0, 12)} of ${pr.baseRefName}, the base of PR #${n}, is not here, and the fetch did not bring it`);
    }
    const mb = run("git", ["merge-base", sha, pr.baseRefOid], top, 30_000);
    const base = mb.stdout.trim();
    if (mb.status !== 0 || !SHA_RE.test(base)) return warn(`found no merge base of PR #${n} and ${pr.baseRefName} (${firstLine(mb.stderr)})`);
    const diff = run("git", ["diff", "--name-status", "-z", "-M", "--diff-filter=R", base, sha], top, 60_000);
    if (diff.status !== 0) return warn(`could not diff PR #${n} against its base (${firstLine(diff.stderr)})`);
    const renames = renamesIn(diff.stdout);
    const baseTree = copyTree(top, base, tmp, "base", n);
    /** Each head file → its path on the base; a file the PR adds has none. */
    const pairs = new Map<string, string>();
    for (const f of files) {
      const was = renames.get(f) ?? f;
      if (agentKind(was) !== null && isFileIn(baseTree, was)) pairs.set(f, was);
    }
    const before = pairs.size
      ? triageIn(baseTree, [...new Set(pairs.values())].sort(), rules, audit, tmp, "base", n)
      : { files: [], totals: { GREEN: 0, YELLOW: 0, RED: 0 }, stale: [] };
    const { added, kept } = newReds(head, before, pairs);
    if (!added.length) return PASS;
    const lines = added.map(({ path: p, clause: c }) => `  ${p}:${c.line}  ${c.type}  ${c.detail}: ${c.text}`);
    return {
      kind: "red",
      text: `PR #${n} adds a RED clause to an agent file, so the merge stops. ` +
        `Reword or delete each new RED clause by the playbook (${PLAYBOOK}), push, and run njord pr-merge again.\n\n` +
        `New RED clauses:\n${lines.join("\n")}\n\n` +
        `${kept} RED clause${kept === 1 ? " was" : "s were"} on the base already; ${kept === 1 ? "it does" : "they do"} not stop the merge.`,
    };
  } catch (e) {
    if (e instanceof Unchecked) return warn(e.message);
    throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** A step that failed: the merge goes on unchecked, with this reason. */
class Unchecked extends Error {}

/** Copies the tree of `sha` to `<tmp>/<name>` as a new git repo, which
 *  `rules_audit.ts --files` needs, and returns that folder. */
function copyTree(cwd: string, sha: string, tmp: string, name: string, n: number): string {
  const tree = path.join(tmp, name);
  const tar = path.join(tmp, `${name}.tar`);
  fs.mkdirSync(tree);
  for (const [cmd, args, at] of [
    ["git", ["archive", "--format=tar", "-o", tar, sha], cwd],
    ["tar", ["-xf", tar, "-C", tree], tmp],
    ["git", ["init", "--quiet", tree], tmp],
  ] as const) {
    const r = run(cmd, [...args], at, 120_000);
    if (r.status !== 0) throw new Unchecked(`could not copy the ${name} of PR #${n}: ${cmd} ${args[0]} (${firstLine(r.stderr)})`);
  }
  return tree;
}

/** The playbook triage of `paths` in the copy at `tree`. */
function triageIn(tree: string, paths: string[], rules: string | null, audit: string, tmp: string, name: string, n: number): TriageReport {
  // ~/Code/CLAUDE.md does not point into the copy, so the triage would read a
  // PR's own root rules as a copy of the live ones, and flag their gates. When
  // the PR changes the root rules, a throwaway HOME points it at the copy.
  let env: NodeJS.ProcessEnv | undefined;
  if (rules !== null && paths.includes(rules)) {
    const fakeHome = path.join(tmp, `home-${name}`);
    fs.mkdirSync(path.join(fakeHome, "Code"), { recursive: true });
    fs.symlinkSync(path.join(tree, rules), path.join(fakeHome, "Code", "CLAUDE.md"));
    env = { ...process.env, HOME: fakeHome };
  }
  const r = run(process.execPath, [audit, "--playbook", "--json", "--files", paths.join(",")], tree, 120_000, env);
  if (r.status !== 0 && r.status !== 3) {
    throw new Unchecked(`triage of the ${name} of PR #${n} failed (exit ${r.status ?? "on a signal"}: ${firstLine(r.stderr)})`);
  }
  try {
    const report = JSON.parse(r.stdout) as TriageReport;
    if (Array.isArray(report.files)) return report;
  } catch {
    // falls through
  }
  throw new Unchecked(`triage of the ${name} of PR #${n} printed no report`);
}

function isFileIn(tree: string, rel: string): boolean {
  try {
    return fs.statSync(path.join(tree, rel)).isFile();
  } catch {
    return false;
  }
}

/** Each file that a diff renames, new path → old path, from the output of
 *  `git diff --name-status -z -M`. */
export function renamesIn(nameStatus: string): Map<string, string> {
  const parts = nameStatus.split("\0");
  const out = new Map<string, string>();
  for (let i = 0; i < parts.length && parts[i]; ) {
    const status = parts[i];
    if (status[0] === "R") out.set(parts[i + 2], parts[i + 1]);
    i += status[0] === "R" || status[0] === "C" ? 3 : 2;
  }
  return out;
}

/** The PreToolUse output for the verdicts, or null for none. */
export function render(verdicts: Verdict[]): object | null {
  const red = verdicts.flatMap((v) => (v.kind === "red" ? [v.text] : []));
  if (red.length) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: red.map((t) => `agent-doc gate: ${t}`).join("\n\n"),
      },
    };
  }
  const warns = verdicts.flatMap((v) => (v.kind === "warn" ? [`agent-doc gate: ${v.text}; the merge goes on unchecked.`] : []));
  if (!warns.length) return null;
  const text = warns.join("\n");
  return { systemMessage: text, hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text } };
}

function main(): Verdict[] {
  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return [];
  }
  const command = data?.tool_input?.command;
  if (data?.tool_name !== "Bash" || typeof command !== "string") return [];
  const cwd = typeof data.cwd === "string" && data.cwd ? data.cwd : process.cwd();
  return findMerges(command, cwd).filter((c) => !c.help).map((c) => {
    try {
      return gate(c);
    } catch (e) {
      return warn(`the check failed (${firstLine((e as Error).message)})`);
    }
  });
}

if (isMainModule(import.meta.url)) {
  // Argv is not part of the PreToolUse protocol: help prints the usage, and
  // anything else is refused on stderr, since Claude Code reads this stdout.
  precheckCli(process.argv.slice(2), {}, USAGE);
  let out: object | null;
  try {
    out = render(main());
  } catch (e) {
    out = render([warn(`the check failed (${firstLine((e as Error).message)})`)]);
  }
  // No process.exit: on macOS a pipe write is async, and exit would cut it.
  if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exitCode = 0;
}
