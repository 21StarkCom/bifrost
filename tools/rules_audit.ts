#!/usr/bin/env node
/**
 * rules_audit — measures one repo's agent instruction files (`.claude/rules`,
 * CLAUDE.md, AGENTS.md) against how Claude Code and Codex load them, and prints
 * the report `rules_audit_lib.ts` builds. Read-only: it writes nothing.
 *
 * The file universe is the disk, not `git ls-files`: Claude Code's discovery
 * ignores .gitignore, so an ignored `.claude/` still loads. Nested repos and
 * worktrees (a `.git` entry), `.claude/worktrees`, `.cursor/worktrees` and
 * dependency trees are pruned. Symlinks are followed only where Claude Code
 * follows them: file links, and directory links inside a rules dir. git only
 * labels which files it ignores.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { precheckCli } from "./cli_args_lib.ts";
import { isMainModule } from "./main_module_lib.ts";
import { auditRules, formatText, instructionKind, type RepoView } from "./rules_audit_lib.ts";

const USAGE = `usage: rules_audit.ts [--repo <path>] [--json] [--always <rule,…>]
                      [--file-budget <bytes>] [--always-budget <bytes>]

Audits one repo's agent instruction files — .claude/rules/**.md, CLAUDE.md,
AGENTS.md — against how Claude Code and Codex load them: load scope, size
budgets, dead references. Prints a readable report, or with --json one JSON
object whose findings[] is ReportFindings-shaped plus candidates[] that need
judgement. Read-only.

  --repo <path>           target repo (default: the current directory)
  --json                  print the JSON report
  --always <rule,…>       rules the repo means to load every session, overriding
                          what the auditor reads from CLAUDE.md / AGENTS.md
  --file-budget <bytes>   advisory per-file budget (default 16384)
  --always-budget <bytes> advisory always-loaded total (default 32768)
  -h, --help              print this and exit`;

const PRUNE_DIRS = new Set(["node_modules", "bower_components", ".venv", "venv", "__pycache__"]);
const MAX_FILES = 250_000;
const MAX_READ_BYTES = 8 * 1024 * 1024;

export interface Walk {
  files: string[];
  externalRuleLinks: string[];
  /** Symlinked rule directories walked, outermost first: git cannot label a
   *  path beyond one, so it labels the link instead. */
  dirLinks: string[];
}

/** Every file under `root`, pruned as the header says. */
export function walkRepo(root: string): Walk {
  const rootReal = fs.realpathSync(root);
  const files: string[] = [];
  const externalRuleLinks: string[] = [];
  /** Real paths of symlinked rule directories already walked (cycle guard). */
  const linkedDirs = new Set<string>();
  const dirLinks: string[] = [];
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop()!;
    const abs = rel ? path.join(root, rel) : root;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === ".git") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (PRUNE_DIRS.has(e.name)) continue;
        if (e.name === "vendor" && fs.existsSync(path.join(abs, e.name, "modules.txt"))) continue;
        if (/(?:^|\/)\.(?:claude|cursor)\/worktrees$/.test(r)) continue;
        if (fs.existsSync(path.join(abs, e.name, ".git"))) continue;
        stack.push(r);
      } else if (e.isFile()) {
        files.push(r);
      } else if (e.isSymbolicLink()) {
        let real: string;
        let stat: fs.Stats;
        try {
          real = fs.realpathSync(path.join(abs, e.name));
          stat = fs.statSync(real);
        } catch {
          continue;
        }
        const inside = real === rootReal || real.startsWith(`${rootReal}${path.sep}`);
        if (stat.isFile()) {
          if (inside) files.push(r);
          else if (/(?:^|\/)\.claude\/rules\//.test(r)) externalRuleLinks.push(r);
        } else if (stat.isDirectory() && /(?:^|\/)\.claude\/rules(?:\/|$)/.test(r)) {
          // Claude Code follows symlinked directories inside a rules dir.
          if (!inside) externalRuleLinks.push(r);
          else if (!linkedDirs.has(real)) {
            linkedDirs.add(real);
            dirLinks.push(r);
            stack.push(r);
          }
        }
      }
      if (files.length > MAX_FILES) throw new Error(`more than ${MAX_FILES} files under ${root}; point --repo at a repo root`);
    }
  }
  return { files: files.sort(), externalRuleLinks: externalRuleLinks.sort(), dirLinks };
}

function git(root: string, args: string[], input?: string) {
  return spawnSync("git", ["-C", root, ...args], { encoding: "utf8", input, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
}

/** The given paths git ignores (`git check-ignore`; exit 1 means none). */
export function ignoredPaths(root: string, rels: string[]): Set<string> {
  if (!rels.length) return new Set();
  const r = git(root, ["check-ignore", "-z", "--stdin"], rels.join("\0") + "\0");
  if (r.status !== 0 && r.status !== 1) throw new Error(`git check-ignore failed: ${(r.stderr || "").trim()}`);
  return new Set((r.stdout || "").split("\0").filter(Boolean));
}

/** A CLAUDE-family file at the root or any ancestor: Claude Code then never
 *  reads AGENTS.md at session start. */
export function claudeFamilyAbove(root: string): boolean {
  let dir = path.resolve(root);
  for (;;) {
    if (["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"].some((c) => fs.existsSync(path.join(dir, c)))) return true;
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

export function buildView(root: string): RepoView {
  const walk = walkRepo(root);
  // No cache: the audit reads every file once for its word index, and keeping
  // those texts would hold the whole repo in memory. It memoizes what it re-reads.
  const read = (rel: string): string | null => {
    try {
      const abs = path.join(root, rel);
      return fs.statSync(abs).size <= MAX_READ_BYTES ? fs.readFileSync(abs, "utf8") : null;
    } catch {
      return null;
    }
  };
  const labelled = walk.files.filter((f) => instructionKind(f) !== null || /(?:^|\/)\.codex\/config\.toml$/.test(f));
  const asked = (f: string) => walk.dirLinks.find((l) => f.startsWith(`${l}/`)) ?? f;
  const ignored = ignoredPaths(root, [...new Set(labelled.map(asked))]);
  return {
    files: walk.files,
    read,
    exists: (rel) => fs.existsSync(path.join(root, rel)),
    ignored: new Set(labelled.filter((f) => ignored.has(asked(f)))),
    claudeFamilyAbove: claudeFamilyAbove(root),
    externalRuleLinks: walk.externalRuleLinks,
  };
}

function budget(flag: string, v: string | true | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} must be a positive integer (bytes), got ${String(v)}`);
  return n;
}

export function main(argv: string[]): number {
  const { flags } = precheckCli(argv, {
    values: ["--repo", "--always", "--file-budget", "--always-budget"],
    switches: ["--json"],
  }, USAGE);
  const target = path.resolve(String(flags.get("repo") ?? process.cwd()));
  const top = git(target, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) {
    process.stderr.write(`rules_audit: ${target} is not inside a git repository\n`);
    return 2;
  }
  const root = top.stdout.trim();
  let fileBytes: number | undefined;
  let alwaysBytes: number | undefined;
  try {
    fileBytes = budget("--file-budget", flags.get("file-budget"));
    alwaysBytes = budget("--always-budget", flags.get("always-budget"));
  } catch (e) {
    process.stderr.write(`rules_audit: ${(e as Error).message}\n`);
    return 2;
  }
  const always = flags.has("always")
    ? String(flags.get("always")).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  let report;
  try {
    report = auditRules({
      repoRoot: root,
      view: buildView(root),
      always,
      budgets: { ...(fileBytes ? { fileBytes } : {}), ...(alwaysBytes ? { alwaysBytes } : {}) },
    });
  } catch (e) {
    const msg = (e as Error).message;
    process.stderr.write(`rules_audit: ${msg}\n`);
    return msg.startsWith("--always") ? 2 : 1;
  }
  process.stdout.write(flags.has("json") ? `${JSON.stringify(report, null, 2)}\n` : `${formatText(report)}\n`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
