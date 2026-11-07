#!/usr/bin/env node
/**
 * The agent-doc gate: a PreToolUse hook that stops `njord pr-merge` when the PR
 * changes an agent file that the playbook triage flags RED.
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
 *   4. runs `rules_audit.ts --playbook --files` on those files in the copy.
 * Exit 3 (a RED) denies the call, and the reason holds the triage report.
 * Exit 0 allows it, with no output. Any other result (a tool error, no PR, no
 * network) allows it and prints one warning line, to the operator as
 * `systemMessage` and to the model as `additionalContext`.
 *
 * The copy sits outside the workspace, so the start-up load set it measures
 * counts no CLAUDE.md above the repo: a load-set RED can pass here, and the
 * sweep reports it. The hook writes nothing outside its temp folder, which it
 * deletes, except the objects a fetch adds to the repo.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isMainModule } from "./main_module_lib.ts";
import { agentKind } from "./rules_audit_lib.ts";

const USAGE = "usage: rules_gate_hook.ts (no arguments; PreToolUse JSON on stdin)\n";
const TOOLS_DIR = import.meta.dirname;
const AUDIT = path.join(TOOLS_DIR, "rules_audit.ts");
const PLAYBOOK = path.join(TOOLS_DIR, "..", "skill", "stark-agent-docs", "references", "playbook.md");

/** `njord pr-merge` options that take a value, from its argument parser. */
const VALUE_FLAGS = new Set(["--pr", "--changelog-section", "--force-reason", "--watch-timeout"]);
/** Words that run the next word as the command. */
const WRAPPERS = new Set(["env", "command", "time", "nohup", "exec"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * The words of each simple command in a shell line, split at unquoted
 * `; & | ( )` and newlines. Quotes and backslashes are resolved; `$` expansions
 * stay as text. Enough to find a `njord pr-merge` and its arguments.
 */
export function shellCommands(line: string): string[][] {
  const out: string[][] = [];
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
  for (const words of shellCommands(line)) {
    let i = 0;
    while (i < words.length && (ASSIGNMENT.test(words[i]) || WRAPPERS.has(words[i]))) i++;
    const name = words[i];
    if (name === "cd") {
      const to = words[i + 1];
      if (to === undefined || to === "~") dir = home;
      else if (to !== "-") dir = path.resolve(dir, to.replace(/^~(?=\/)/, home));
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

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Ran {
  const r = spawnSync(cmd, args, {
    cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr || r.error?.message || "" };
}

function firstLine(text: string): string {
  return text.split("\n").map((l) => l.trim()).find(Boolean) ?? "no output";
}

function hasCommit(cwd: string, sha: string): boolean {
  return run("git", ["cat-file", "-e", `${sha}^{commit}`], cwd, 30_000).status === 0;
}

interface PrFiles {
  number: number;
  state: string;
  headRefOid: string;
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
export function gate(call: MergeCall, audit = AUDIT): Verdict {
  const select = call.pr === null ? [] : [String(call.pr)];
  const view = run("gh", ["pr", "view", ...select, "--json", "number,state,headRefOid,changedFiles,files"], call.cwd, 30_000);
  const which = call.pr === null ? "the PR of this branch" : `PR #${call.pr}`;
  if (view.status !== 0) return warn(`could not read ${which} (${firstLine(view.stderr)})`);
  let pr: PrFiles;
  try {
    pr = JSON.parse(view.stdout);
  } catch {
    return warn(`gh pr view printed no JSON for ${which}`);
  }
  if (pr.state !== "OPEN") return PASS; // njord merges only an open PR
  if (!Array.isArray(pr.files) || !/^[0-9a-f]{40}$/.test(String(pr.headRefOid))) {
    return warn(`gh pr view gave no files or head commit for ${which}`);
  }
  const files = changedAgentFiles(call.cwd, pr);
  if (typeof files === "string") return warn(files);
  if (!files.length) return PASS;

  const sha = pr.headRefOid;
  if (!hasCommit(call.cwd, sha)) {
    run("git", ["fetch", "--quiet", "--no-tags", "origin", `refs/pull/${pr.number}/head`], call.cwd, 120_000);
    if (!hasCommit(call.cwd, sha)) return warn(`the head commit ${sha.slice(0, 12)} of PR #${pr.number} is not here, and the fetch did not bring it`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rules-gate-"));
  try {
    const tree = path.join(tmp, "tree");
    const tar = path.join(tmp, "head.tar");
    fs.mkdirSync(tree);
    for (const [cmd, args, cwd] of [
      ["git", ["archive", "--format=tar", "-o", tar, sha], call.cwd],
      ["tar", ["-xf", tar, "-C", tree], tmp],
      ["git", ["init", "--quiet", tree], tmp],
    ] as const) {
      const r = run(cmd, [...args], cwd, 120_000);
      if (r.status !== 0) return warn(`could not copy the head of PR #${pr.number}: ${cmd} ${args[0]} (${firstLine(r.stderr)})`);
    }
    const r = run(process.execPath, [audit, "--playbook", "--files", files.join(",")], tree, 120_000);
    if (r.status === 0) return PASS;
    if (r.status === 3) {
      return {
        kind: "red",
        text: `PR #${pr.number} changes an agent file with a RED clause, so the merge stops. ` +
          `Reword or delete each RED clause by the playbook (${PLAYBOOK}), push, and run njord pr-merge again.\n\n` +
          r.stdout.trim(),
      };
    }
    return warn(`triage of PR #${pr.number} failed (exit ${r.status ?? "on a signal"}: ${firstLine(r.stderr)})`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
  // Argv is not part of the PreToolUse protocol: a help request or a mistake.
  // A refusal goes to stderr, since Claude Code reads this hook's stdout.
  const arg = process.argv[2];
  if (arg !== undefined) {
    const asked = ["help", "--help", "-h"].includes(arg);
    if (asked) process.stdout.write(USAGE);
    else process.stderr.write(`unsupported argument: ${arg}\n${USAGE}`);
    process.exitCode = asked ? 0 : 2;
  } else {
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
}
