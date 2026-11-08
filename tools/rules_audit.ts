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
 *
 * `--playbook` triages agent files against the agent-doc playbook instead
 * (`triage` in `rules_audit_lib.ts`): a repo, the fleet under `~/Code/21Stark`,
 * the auto-memory folders, or a list of files. `--notify` also sends its
 * summary with `heimdall send`. The weekly sweep runs on the devbox, not as a
 * Mac schedule.
 *
 * `--save <file>` writes the triage report as `--json` prints it, each path
 * a real absolute path, to `<file>.pending`, by a temp file and a rename. It
 * first deletes an old `<file>.pending`, so a triage that fails leaves none.
 * `--commit <file>` renames `<file>.pending` over `<file>`: a caller commits
 * only once it has done all it must with the report, so a run that fails
 * after the triage does not move the base. `--since <file>` reads `<file>`,
 * never `<file>.pending`, and prints only the change: the RED clauses
 * that are new, each with its lines around it, and the ones that are gone.
 * A clause matches as `newReds` matches it, so a clause that only moved is
 * not new. `--settings` adds the model settings of `settings.json`.
 * `--self-update` (`--fleet` only) fast-forwards the checkout that holds
 * this tool to `origin/main` and runs again on the new code.
 *
 * `--fleet` alone reads each repo at `origin/HEAD`, not the disk: it runs
 * `git fetch origin`, then lists the tree with `git ls-tree` and reads it
 * with `git cat-file`. That moves remote refs only, never a checkout, its
 * index or its files, and it writes no temp file. Each file keeps its real
 * path, which the root-rules match, the CLAUDE.md files above the repo and
 * the dedupe need. A repo whose fetch or read fails is read from its
 * checkout and marked stale in the report.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { spawnBounded } from "./bounded_spawn_lib.ts";
import { precheckCli } from "./cli_args_lib.ts";
import { heimdallSend } from "./launchd_lib.ts";
import { isMainModule } from "./main_module_lib.ts";
import {
  agentKind, auditRules, formatText, formatTriage, instructionKind, newReds, notifySummary, triage,
  type AgentKind, type Clause, type Flag, type RepoView, type StaleRepo, type TriageGroup, type TriageReport,
} from "./rules_audit_lib.ts";

const USAGE = `usage: rules_audit.ts [--repo <path>] [--json] [--always <rule,…>]
                      [--file-budget <bytes>] [--always-budget <bytes>]
       rules_audit.ts --playbook [--repo <path>] [--fleet] [--memory]
                      [--files <path,…>] [--json] [--notify] [--settings]
                      [--save <file>] [--since <file>] [--self-update]
       rules_audit.ts --commit <file>

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
  -h, --help              print this and exit

--playbook triages agent files (CLAUDE.md, AGENTS.md, .claude/rules/*.md,
SKILL.md, MEMORY.md and memory notes) by the agent-doc playbook, with no
model: size against budget, gate, growth and history phrases, copies of a
sibling file or of ~/Code/CLAUDE.md, and dead pointers. It prints one GREEN,
YELLOW or RED line per file, then each RED clause as path:line. Exit 0 for
GREEN or YELLOW, 3 for RED. The inputs combine; with none, the current repo.

  --repo <path>           the agent files of one repo
  --fleet                 every repo under ~/Code/21Stark, and its own CLAUDE.md,
                          at origin/HEAD after a git fetch; a repo that cannot
                          be fetched or read is read from its checkout and
                          marked stale
  --memory                every ~/.claude/projects/*/memory/ folder
  --files <path,…>        these agent files only
  --notify                also send a summary with heimdall send: the RED
                          files first, then the files over budget; a triage
                          that fails sends its error
  --settings              add effortLevel, model and modelSettings from
                          settings.json ($CLAUDE_CONFIG_DIR, else ~/.claude)
  --save <file>           also write the report, in the --json form, to
                          <file>.pending, each path a real absolute path; an
                          old <file>.pending is deleted first, so a triage
                          that fails leaves none. --commit moves it to <file>
  --since <file>          print only the change since the report saved in
                          <file>: the new RED clauses, each with two lines
                          around it, the gone ones, the totals of both runs
                          and the changed settings, in under 45,000 chars.
                          Exit 3 only for a new RED clause. A missing or bad
                          <file> prints the totals and exits 0. It never
                          reads <file>.pending, so both flags can name one
                          file, and a run with no --commit moves no base.
  --self-update           with --fleet: git fetch origin main in the checkout
                          of this tool and, when it is on a clean main,
                          fast-forward it and run again on the new code; else
                          list it as stale and run on the code as it is

--commit <file> renames <file>.pending, which --save wrote, over <file>, so
the next --since compares with that run. Run it once the run has done all it
must with the report. It prints one line and exits 0; with no <file>.pending
it changes nothing, prints why and exits 0. Exit 1 when the rename fails, 2
with any other flag.`;

/** The suffix of the file `--save` writes and `--commit` renames over the base. */
export const PENDING_SUFFIX = ".pending";

/** The longest `--since` output: odin cuts a tool's answer at 45,000 chars. */
export const SINCE_MAX_CHARS = 45_000;

const PRUNE_DIRS = new Set(["node_modules", "bower_components", ".venv", "venv", "__pycache__"]);
/** The files Claude Code reads as a folder's CLAUDE.md. */
const CLAUDE_FAMILY = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];
const MAX_FILES = 250_000;
const MAX_READ_BYTES = 8 * 1024 * 1024;
/** How long one fleet repo's `git fetch` may run. */
const FETCH_TIMEOUT_MS = 60_000;
/** The fleet repos that fetch at one time. */
const FETCH_CONCURRENCY = 8;
/** Folders of a fleet repo whose agent files never load: nastrond's buried code. */
const FLEET_SKIP: Readonly<Record<string, readonly string[]>> = { nastrond: ["graves/"] };
/** A link `walkRepo` follows into a directory: one inside a rules dir. */
const RULES_LINK_RE = /(?:^|\/)\.claude\/rules(?:\/|$)/;

export interface Walk {
  files: string[];
  externalRuleLinks: string[];
  /** Symlinked rule directories walked, outermost first: git cannot label a
   *  path beyond one, so it labels the link instead. */
  dirLinks: string[];
}

/** A folder `walkRepo` does not enter: a dependency tree, a Go vendor folder
 *  (one with a `modules.txt`) or a worktrees folder. `rel` is repo-relative. */
function prunedDir(rel: string, isFile: (rel: string) => boolean): boolean {
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  return PRUNE_DIRS.has(name) || (name === "vendor" && isFile(`${rel}/modules.txt`))
    || /(?:^|\/)\.(?:claude|cursor)\/worktrees$/.test(rel);
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
        if (prunedDir(r, (f) => fs.existsSync(path.join(root, f)))) continue;
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
        } else if (stat.isDirectory() && RULES_LINK_RE.test(r)) {
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
    if (CLAUDE_FAMILY.some((c) => fs.existsSync(path.join(dir, c)))) return true;
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

/** A reader of the files under `root`: null for a missing file or one over
 *  MAX_READ_BYTES. No cache: the audit reads every file once for its word
 *  index, and keeping those texts would hold the whole repo in memory. It
 *  memoizes what it re-reads. */
function readUnder(root: string): (rel: string) => string | null {
  return (rel) => {
    try {
      const abs = path.join(root, rel);
      return fs.statSync(abs).size <= MAX_READ_BYTES ? fs.readFileSync(abs, "utf8") : null;
    } catch {
      return null;
    }
  };
}

export function buildView(root: string): RepoView {
  const walk = walkRepo(root);
  const read = readUnder(root);
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

/** The first line of a git error, for the stale mark. */
function firstLine(text: string | Buffer | null | undefined): string {
  const line = String(text ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

/** A path `walkRepo` does not reach: one of its folders is pruned. */
function prunedPath(rel: string, isFile: (rel: string) => boolean): boolean {
  for (let i = rel.indexOf("/"); i >= 0; i = rel.indexOf("/", i + 1)) {
    if (prunedDir(rel.slice(0, i), isFile)) return true;
  }
  return false;
}

/** Adds the text of each blob to `into`, keyed by its id, with one
 *  `git cat-file --batch`. Throws when git fails or a blob is missing. */
function catBlobs(root: string, oids: Iterable<string>, into: Map<string, string>): void {
  const todo = [...new Set(oids)].filter((o) => !into.has(o));
  if (!todo.length) return;
  const r = spawnSync("git", ["-C", root, "cat-file", "--batch"], {
    input: `${todo.join("\n")}\n`, timeout: 30_000, maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`git cat-file failed: ${firstLine(r.stderr) || r.error?.message || `exit ${r.status}`}`);
  const out = r.stdout;
  for (let at = 0; at < out.length;) {
    const nl = out.indexOf(10, at);
    const [oid, type, size] = out.toString("utf8", at, nl < 0 ? out.length : nl).split(" ");
    if (nl < 0 || type !== "blob") throw new Error(`git cat-file: no blob ${oid}`);
    const end = nl + 1 + Number(size);
    into.set(oid, out.toString("utf8", nl + 1, end));
    at = end + 1;
  }
}

/** A repo at `origin/HEAD`: its tree from `git ls-tree`, its text from
 *  `git cat-file`, and no read of the checkout. */
export interface OriginView extends RepoView {
  /** `rel` with each link on its way followed in the tree; null when a link
   *  leaves the repo or loops. */
  resolve(rel: string): string | null;
  /** `rel` is a symlink in the tree. */
  isLink(rel: string): boolean;
}

/** The view of `root` at `origin/HEAD`, pruned as `walkRepo` prunes: a file
 *  link inside the repo is a file, and a directory link inside a rules dir is
 *  walked. A link out of the repo reads as missing, and the view has no
 *  `externalRuleLinks`: the triage reads neither. No path is ignored, since
 *  every file at origin is tracked. Agent and instruction files are read up
 *  front, so that a failed read throws here; other files are read on demand.
 *  Throws when git cannot read the tree. */
export function originView(root: string): OriginView {
  const head = git(root, ["rev-parse", "--verify", "--quiet", "origin/HEAD^{commit}"]);
  if (head.status !== 0) throw new Error("origin/HEAD is not set");
  const ls = git(root, ["ls-tree", "-r", "-l", "-z", "--full-tree", head.stdout.trim()]);
  if (ls.status !== 0) throw new Error(`git ls-tree failed: ${firstLine(ls.stderr) || ls.error?.message || `exit ${ls.status}`}`);
  const blobs = new Map<string, { link: boolean; oid: string; size: number }>();
  const dirs = new Set<string>([""]);
  for (const rec of ls.stdout.split("\0")) {
    const tab = rec.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type, oid, size] = rec.slice(0, tab).split(/ +/);
    const rel = rec.slice(tab + 1);
    for (let i = rel.indexOf("/"); i >= 0; i = rel.indexOf("/", i + 1)) dirs.add(rel.slice(0, i));
    if (type === "blob") blobs.set(rel, { link: mode === "120000", oid, size: Number(size) });
    else dirs.add(rel); // a submodule: a folder in the checkout
  }
  const texts = new Map<string, string>();
  catBlobs(root, [...blobs.values()].filter((b) => b.link).map((b) => b.oid), texts);
  // An absolute link counts when it names a path in this checkout, as on disk.
  const bases = [...new Set([fs.realpathSync(root), path.resolve(root)])];
  const inside = (abs: string) => {
    for (const b of bases) if (abs === b || abs.startsWith(`${b}/`)) return abs.slice(b.length + 1);
    return null;
  };
  const resolve = (rel: string): string | null => {
    let parts = rel === "" ? [] : rel.split("/");
    for (let i = 0, hops = 0; i < parts.length; i++) {
      const at = parts.slice(0, i + 1).join("/");
      const b = blobs.get(at);
      if (!b?.link) continue;
      const target = texts.get(b.oid)!;
      if (++hops > 40) return null;
      const joined = target.startsWith("/") ? inside(path.posix.normalize(target)) : path.posix.join(path.posix.dirname(at), target);
      if (joined === null) return null;
      const to = path.posix.normalize(joined || ".");
      if (to === ".." || to.startsWith("../")) return null;
      // A target may end in `/` (`../rules/`): drop the empty part.
      parts = [...to.split("/").filter((p) => p && p !== "."), ...parts.slice(i + 1)];
      i = -1;
    }
    return parts.join("/");
  };
  /** The blob a path reads, after its links; undefined for none. */
  const blobAt = (rel: string) => {
    const n = path.posix.normalize(rel).replace(/\/+$/, "");
    const r = n === "." ? "" : resolve(n);
    return r === null ? undefined : { rel: r, blob: blobs.get(r) };
  };
  const isFile = (rel: string) => blobAt(rel)?.blob !== undefined;
  const files: string[] = [];
  const walked = new Set<string>();
  for (const [rel, b] of blobs) {
    if (prunedPath(rel, isFile)) continue;
    const to = b.link ? resolve(rel) : rel;
    if (to === null) continue;
    if (blobs.has(to)) files.push(rel);
    else if (dirs.has(to) && RULES_LINK_RE.test(rel) && !walked.has(to)) {
      walked.add(to);
      for (const p of blobs.keys()) {
        const alias = `${rel}/${p.slice(to === "" ? 0 : to.length + 1)}`;
        if ((to === "" || p.startsWith(`${to}/`)) && !prunedPath(alias, isFile) && isFile(alias)) files.push(alias);
      }
    }
  }
  files.sort();
  const read = (rel: string): string | null => {
    const b = blobAt(rel)?.blob;
    if (!b || b.size > MAX_READ_BYTES) return null;
    if (!texts.has(b.oid)) {
      try {
        catBlobs(root, [b.oid], texts);
      } catch {
        return null;
      }
    }
    return texts.get(b.oid) ?? null;
  };
  const wanted = files.filter((f) => agentKind(f) || instructionKind(f)).map((f) => blobAt(f)?.blob);
  catBlobs(root, wanted.filter((b) => b && b.size <= MAX_READ_BYTES).map((b) => b!.oid), texts);
  return {
    files,
    read,
    exists: (rel) => {
      const at = blobAt(rel);
      return at !== undefined && (at.blob !== undefined || dirs.has(at.rel));
    },
    ignored: new Set(),
    claudeFamilyAbove: CLAUDE_FAMILY.some(isFile) || claudeFamilyAbove(path.dirname(root)),
    resolve,
    isLink: (rel) => blobs.get(rel)?.link === true,
  };
}

function budget(flag: string, v: string | true | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} must be a positive integer (bytes), got ${String(v)}`);
  return n;
}

/** A path for the report: relative under the current folder, `~/…` under home. */
export function displayPath(abs: string, cwd = process.cwd(), home = os.homedir()): string {
  const under = (base: string) => abs.startsWith(`${base}${path.sep}`);
  if (under(cwd)) return path.relative(cwd, abs);
  if (under(home)) return `~${abs.slice(home.length)}`;
  return abs;
}

/** The git top level that holds `target`, or null. */
function gitTop(target: string): string | null {
  const top = git(target, ["rev-parse", "--show-toplevel"]);
  return top.status === 0 ? top.stdout.trim() : null;
}

/** A view of a folder that is no repo: a memory folder or the workspace. */
function folderView(root: string, files: string[], read = readUnder(root)): RepoView {
  return {
    files,
    read,
    exists: (rel) => fs.existsSync(path.join(root, rel)),
    ignored: new Set(),
    claudeFamilyAbove: true,
  };
}

/** The CLAUDE.md files above a repo that load with it at start-up: one in
 *  each folder from `/` down to the repo's parent, until a folder is in a git
 *  work tree. Such a folder (the main checkout above a worktree) and all below
 *  it belong to that other repo. A link to the repo's own root file is skipped:
 *  the load emulation counts that file. `read` reads a file by its real path. */
export function claudeFilesAbove(
  root: string, read: (real: string) => string | null = (real) => fs.readFileSync(real, "utf8"),
): { path: string; text: string }[] {
  const real = fs.realpathSync(root);
  const own = new Set(CLAUDE_FAMILY.map((n) => path.join(real, n)).filter((p) => fs.existsSync(p)).map((p) => fs.realpathSync(p)));
  const dirs: string[] = [];
  for (let d = path.dirname(real); ; d = path.dirname(d)) {
    dirs.unshift(d);
    if (path.dirname(d) === d) break;
  }
  const out: { path: string; text: string }[] = [];
  for (const d of dirs) {
    if (fs.existsSync(path.join(d, ".git"))) break;
    for (const name of CLAUDE_FAMILY) {
      const p = path.join(d, name);
      const target = fs.existsSync(p) ? fs.realpathSync(p) : null;
      if (!target || own.has(target) || !fs.statSync(target).isFile()) continue;
      const text = read(target);
      if (text !== null) out.push({ path: displayPath(p), text });
    }
  }
  return out;
}

const MEMORY_RE = /^(.*\/\.claude\/projects\/[^/]+\/memory)\/(.+)$/;

function memoryKind(rel: string): AgentKind | null {
  if (!rel.endsWith(".md")) return null;
  return rel === "MEMORY.md" ? "memory-index" : "memory-note";
}

/** The entry of `byRoot` whose real root holds the real path `real`. */
function holder<T>(byRoot: Map<string, T & { real: string }>, real: string): T & { real: string } | undefined {
  for (const v of byRoot.values()) if (real.startsWith(`${v.real}${path.sep}`)) return v;
  return undefined;
}

class Collector {
  readonly groups = new Map<string, TriageGroup>();
  /** Real path → report name of each file taken: a file reached twice (a
   *  symlink, or a repo named twice) is triaged once. */
  readonly taken = new Map<string, string>();
  /** Root → the view at `origin/HEAD` of each fleet repo that `--fleet` read there. */
  readonly origin = new Map<string, { view: OriginView; real: string }>();
  /** Root → each fleet repo read from its checkout instead, and why. */
  readonly stale = new Map<string, StaleRepo & { real: string }>();

  /** A file by its real path: in its fleet repo's view at `origin/HEAD` when
   *  there is one, else from the disk. */
  readReal(real: string): string | null {
    const o = holder(this.origin, real);
    if (o) return o.view.read(path.relative(o.real, real).split(path.sep).join("/"));
    return readUnder(path.dirname(real))(path.basename(real));
  }

  repo(root: string): TriageGroup {
    let g = this.groups.get(root);
    if (!g) {
      const view = this.origin.get(root)?.view ?? buildView(root);
      this.groups.set(root, (g = { root, view, repo: true, files: [], above: claudeFilesAbove(root, (real) => this.readReal(real)) }));
    }
    return g;
  }

  /** `files` is called only when the folder has no group yet. */
  folder(root: string, files: () => string[], read?: (rel: string) => string | null): TriageGroup {
    let g = this.groups.get(root);
    if (!g) this.groups.set(root, (g = { root, view: folderView(root, files(), read), repo: false, files: [] }));
    return g;
  }

  /** The origin view `g` reads, if any: a repo that `--repo` named first
   *  keeps its disk view. */
  atOrigin(g: TriageGroup): { view: OriginView; real: string } | undefined {
    const o = this.origin.get(g.root);
    return o?.view === g.view ? o : undefined;
  }

  /** The real path that triages a file once, or null for none. A repo at
   *  `origin/HEAD` follows its links in its tree, so a file that its
   *  checkout lacks has one too. */
  realPath(g: TriageGroup, rel: string): string | null {
    const o = this.atOrigin(g);
    if (o) {
      const r = o.view.resolve(rel);
      return r === null ? null : path.join(o.real, r);
    }
    try {
      return fs.realpathSync(path.join(g.root, rel));
    } catch {
      return null;
    }
  }

  add(g: TriageGroup, rel: string, kind: AgentKind, name = displayPath(path.join(g.root, rel))): void {
    const real = this.realPath(g, rel);
    if (real === null || this.taken.has(real)) return;
    this.taken.set(real, name);
    const stale = holder(this.stale, real)?.reason;
    g.files.push({ rel, kind, path: name, ...(stale === undefined ? {} : { stale }) });
  }

  /** `skip` names folders of the repo whose agent files are left out. */
  addRepo(root: string, skip: readonly string[] = []): void {
    const g = this.repo(root);
    const o = this.atOrigin(g);
    const isLink = (rel: string) => o ? o.view.isLink(rel) : fs.lstatSync(path.join(root, rel), { throwIfNoEntry: false })?.isSymbolicLink() ?? false;
    // A real file before a link to it (`AGENTS.md` → `CLAUDE.md`): the report names the file to edit.
    const agent = g.view.files.filter((rel) => agentKind(rel) && !skip.some((s) => rel.startsWith(s)))
      .sort((a, b) => Number(isLink(a)) - Number(isLink(b)));
    for (const rel of agent) this.add(g, rel, agentKind(rel)!);
  }

  /** Each repo under `fleet` at `origin/HEAD`, after a fetch, and the
   *  folder's own CLAUDE.md, read through the repo it links into. A repo
   *  whose fetch or read fails is read from its checkout and marked stale. */
  async addFleet(fleet: string): Promise<void> {
    if (!fs.existsSync(fleet)) throw new UsageError(`no fleet folder at ${fleet}`);
    const entries = fs.readdirSync(fleet, { withFileTypes: true });
    const repos = entries.filter((e) => e.isDirectory() && fs.existsSync(path.join(fleet, e.name, ".git")))
      .map((e) => e.name).sort((a, b) => a.localeCompare(b));
    const failed = await fetchAll(repos.map((name) => path.join(fleet, name)));
    for (const name of repos) {
      const root = path.join(fleet, name);
      const real = fs.realpathSync(root);
      let reason = failed.get(root);
      if (reason === undefined) {
        try {
          this.origin.set(root, { view: originView(root), real });
        } catch (e) {
          reason = (e as Error).message;
        }
      }
      if (reason !== undefined) this.stale.set(root, { repo: displayPath(root), reason, real });
    }
    const own = entries.filter((e) => !e.isDirectory() && agentKind(e.name) === "root").map((e) => e.name).sort();
    const g = this.folder(fleet, () => own, (rel) => {
      const p = path.join(fleet, rel);
      return fs.existsSync(p) ? this.readReal(fs.realpathSync(p)) : null;
    });
    for (const name of own) this.add(g, name, "root");
    for (const name of repos) this.addRepo(path.join(fleet, name), FLEET_SKIP[name]);
  }

  addMemory(dir: string): void {
    const g = this.folder(dir, () => walkRepo(dir).files);
    for (const rel of g.view.files) {
      const kind = memoryKind(rel);
      if (kind) this.add(g, rel, kind);
    }
  }
}

class UsageError extends Error {}

/** `git fetch origin` in each repo, `FETCH_CONCURRENCY` at a time and each
 *  within `FETCH_TIMEOUT_MS`: root → why the fetch failed, for each that did.
 *  The fetch moves remote refs only: no tags (a moved tag would fail it), no
 *  submodules, no `FETCH_HEAD` and no maintenance. Its own session has no
 *  terminal, so a sign-in prompt fails. */
async function fetchAll(roots: string[]): Promise<Map<string, string>> {
  const failed = new Map<string, string>();
  const queue = [...roots];
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const fetchOne = async (root: string) => {
    try {
      const r = await spawnBounded("git", [
        "-C", root, "fetch", "--quiet", "--no-tags", "--no-recurse-submodules", "--no-write-fetch-head", "--no-auto-gc", "origin",
      ], {
        env, timeoutMs: FETCH_TIMEOUT_MS, maxBuffer: 1024 * 1024,
      });
      if (r.status === 0) return;
      const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
      failed.set(root, timedOut
        ? `git fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s`
        : `git fetch failed: ${firstLine(r.stderr) || r.error?.message || `exit ${r.status}`}`);
    } catch (e) {
      failed.set(root, `git fetch failed: ${(e as Error).message}`);
    }
  };
  const worker = async () => {
    for (let root = queue.shift(); root !== undefined; root = queue.shift()) await fetchOne(root);
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, roots.length) }, worker));
  return failed;
}

function collectFiles(c: Collector, list: string): void {
  const items = list.split(",").map((s) => s.trim()).filter(Boolean);
  if (!items.length) throw new UsageError("--files names no file");
  for (const item of items) {
    const abs = path.resolve(item);
    if (!fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) throw new UsageError(`${item}: no such file`);
    const real = fs.realpathSync(abs);
    const mem = MEMORY_RE.exec(real);
    if (mem) {
      const kind = memoryKind(mem[2]);
      if (!kind) throw new UsageError(`${item} is not an agent file`);
      c.add(c.folder(mem[1], () => walkRepo(mem[1]).files), mem[2], kind, displayPath(abs));
      continue;
    }
    const top = gitTop(path.dirname(real));
    if (!top) throw new UsageError(`${item} is in no git repository and no memory folder`);
    const rel = path.relative(top, real).split(path.sep).join("/");
    const kind = agentKind(rel);
    if (!kind) throw new UsageError(`${item} is not an agent file`);
    c.add(c.repo(top), rel, kind, displayPath(abs));
  }
}

/** The model settings that `--settings` reads. */
export const SETTINGS_KEYS = ["effortLevel", "model", "modelSettings"] as const;
export type ModelSettings = Partial<Record<(typeof SETTINGS_KEYS)[number], unknown>>;

/** A triage report as `--save` writes it and `--since` reads it. */
export interface SavedReport extends TriageReport {
  saved?: string;
  settings?: ModelSettings;
}

/** The `--settings` keys of `$CLAUDE_CONFIG_DIR/settings.json`, else of
 *  `~/.claude/settings.json`; none for a missing or bad file. */
export function readModelSettings(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): ModelSettings {
  const file = path.join(env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "settings.json");
  let all: unknown;
  try {
    all = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
  const out: ModelSettings = {};
  if (all && typeof all === "object") {
    for (const k of SETTINGS_KEYS) if (k in all) out[k] = (all as Record<string, unknown>)[k];
  }
  return out;
}

/** A report path as a real absolute path: `~/…` under `home`, a relative
 *  path under `cwd`, and the links followed when the path exists. */
export function absolutePath(p: string, cwd = process.cwd(), home = os.homedir()): string {
  const abs = p === "~" || p.startsWith("~/") ? path.join(home, p.slice(1)) : path.resolve(cwd, p);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

/** The saved report in `file`, or why there is none to compare with. Each
 *  path is made absolute against `cwd`, for a report from before `--save`. */
export function loadSaved(file: string, cwd = process.cwd(), home = os.homedir()): { report: SavedReport } | { reason: string } {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { reason: (e as NodeJS.ErrnoException).code === "ENOENT" ? "no saved run" : `cannot read it: ${(e as Error).message}` };
  }
  let r: SavedReport;
  try {
    r = JSON.parse(text);
  } catch {
    return { reason: "it does not parse as JSON" };
  }
  const isClause = (c: unknown) => !!c && typeof c === "object" && typeof (c as { type?: unknown }).type === "string";
  const isFile = (f: unknown) => !!f && typeof (f as { path?: unknown }).path === "string"
    && Array.isArray((f as { clauses?: unknown }).clauses) && (f as { clauses: unknown[] }).clauses.every(isClause);
  if (!r || typeof r !== "object" || !Array.isArray(r.files) || !r.files.every(isFile) || !r.totals || typeof r.totals !== "object") {
    return { reason: "it is not a --json triage report" };
  }
  return { report: { ...r, stale: Array.isArray(r.stale) ? r.stale : [], files: r.files.map((f) => ({ ...f, path: absolutePath(f.path, cwd, home) })) } };
}

/** One RED clause of a `--since` diff, with its lines around it for a new one. */
export interface DiffClause {
  path: string;
  line: number;
  type: Clause["type"];
  text: string;
  detail: string;
  context?: string[];
}

export interface SinceDiff {
  since: string;
  base: { totals: Record<Flag, number>; saved?: string };
  head: { totals: Record<Flag, number> };
  new: DiffClause[];
  gone: DiffClause[];
  stale: StaleRepo[];
  settings: { key: string; from: unknown; to: unknown }[];
  /** The clauses that the char limit left out. */
  omitted: { new: number; gone: number };
}

/** The lines `line - 2` to `line + 2` of `text`, each with its number. */
export function contextLines(text: string | null, line: number): string[] {
  if (text === null) return [];
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  const from = Math.max(1, line - 2);
  const to = Math.min(lines.length, line + 2);
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`${n === line ? ">" : " "}${String(n).padStart(5)}  ${lines[n - 1]}`);
  return out;
}

/** The change from `base` to `head`, both with real absolute paths. `read`
 *  reads a head file by its path, as the run read it. */
export function sinceDiff(
  since: string, base: SavedReport, head: SavedReport, read: (p: string) => string | null,
): SinceDiff {
  const same = (r: TriageReport) => new Map(r.files.map((f) => [f.path, f.path]));
  // A SIZE clause of the whole file or load set has no line to show.
  const anchored = (c: Clause) => c.measure !== "core" && c.measure !== "load set";
  const item = (path: string, c: Clause, withContext: boolean): DiffClause => ({
    path: displayPath(path), line: c.line, type: c.type, text: c.text, detail: c.detail,
    ...(withContext && anchored(c) ? { context: contextLines(read(path), c.line) } : {}),
  });
  const settings: SinceDiff["settings"] = [];
  if (base.settings && head.settings) {
    for (const key of SETTINGS_KEYS) {
      const from = base.settings[key];
      const to = head.settings[key];
      if (JSON.stringify(from) !== JSON.stringify(to)) settings.push({ key, from, to });
    }
  }
  return {
    since,
    base: { totals: base.totals, ...(base.saved ? { saved: base.saved } : {}) },
    head: { totals: head.totals },
    new: newReds(head, base, same(head)).added.map((a) => item(a.path, a.clause, true)),
    gone: newReds(base, head, same(base), { grownIsNew: false }).added.map((a) => item(a.path, a.clause, false)),
    stale: head.stale,
    settings,
    omitted: { new: 0, gone: 0 },
  };
}

function totalsLine(t: Record<Flag, number>): string {
  return `RED ${t.RED} · YELLOW ${t.YELLOW} · GREEN ${t.GREEN}`;
}

const show = (v: unknown) => (v === undefined ? "(unset)" : JSON.stringify(v));

/** The text of a `--since` diff. */
export function formatSince(d: SinceDiff): string {
  const out = [`Since ${d.since}${d.base.saved ? ` (saved ${d.base.saved})` : ""}`, `  before: ${totalsLine(d.base.totals)}`, `  now:    ${totalsLine(d.head.totals)}`];
  const clause = (c: DiffClause) => `  ${c.path}:${c.line}  ${c.type}  ${c.detail}: ${c.text}`;
  out.push("", d.new.length || d.omitted.new ? `New RED clauses (${d.new.length + d.omitted.new}):` : "No new RED clause.");
  for (const c of d.new) out.push(clause(c), ...(c.context ?? []).map((l) => `    ${l}`));
  if (d.omitted.new) out.push(`  +${d.omitted.new} new RED clauses left out to stay under ${SINCE_MAX_CHARS} chars`);
  if (d.gone.length || d.omitted.gone) {
    out.push("", `Gone RED clauses (${d.gone.length + d.omitted.gone}):`, ...d.gone.map(clause));
    if (d.omitted.gone) out.push(`  +${d.omitted.gone} gone RED clauses left out to stay under ${SINCE_MAX_CHARS} chars`);
  }
  if (d.settings.length) out.push("", "Settings changed:", ...d.settings.map((s) => `  ${s.key}: ${show(s.from)} → ${show(s.to)}`));
  if (d.stale.length) out.push("", "Stale, read from the checkout, not origin/HEAD:", ...d.stale.map((s) => `  ${s.repo}  ${s.reason}`));
  return out.join("\n");
}

/** `render(d)` for the largest `d` that fits in `max` chars: the totals stay,
 *  the gone clauses go first, then the last new ones, each counted. */
export function fitSince(d: SinceDiff, render: (d: SinceDiff) => string, max = SINCE_MAX_CHARS): string {
  let text = render(d);
  if (text.length < max) return text;
  // Fill by size, then trim the last few that the counts' text pushes over.
  const empty = { ...d, new: [], gone: [], omitted: { new: d.new.length, gone: d.gone.length } };
  let room = max - render(empty).length - 200;
  const size = (c: DiffClause) => JSON.stringify(c).length + 16 * ((c.context?.length ?? 0) + 1);
  let keepNew = 0;
  while (keepNew < d.new.length && (room -= size(d.new[keepNew])) > 0) keepNew++;
  let keepGone = 0;
  while (keepNew === d.new.length && keepGone < d.gone.length && (room -= size(d.gone[keepGone])) > 0) keepGone++;
  const cut = (n: number, g: number): SinceDiff => ({
    ...d, new: d.new.slice(0, n), gone: d.gone.slice(0, g), omitted: { new: d.new.length - n, gone: d.gone.length - g },
  });
  text = render(cut(keepNew, keepGone));
  while (text.length >= max && (keepGone || keepNew)) {
    if (keepGone) keepGone--;
    else keepNew--;
    text = render(cut(keepNew, keepGone));
  }
  return text;
}

/** Writes `text` to `file` by a temp file in its folder and a rename. */
export function writeAtomic(file: string, text: string): void {
  const dir = path.dirname(path.resolve(file));
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** `--commit`: renames `<file>.pending` over `<file>`. The line to print,
 *  and the exit code: 0 when it moved or there was nothing to move. */
export function commitSaved(file: string): { line: string; code: 0 | 1 } {
  const pending = `${file}${PENDING_SUFFIX}`;
  try {
    fs.renameSync(pending, file);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    // Both files share one folder, so ENOENT means no pending report.
    if (err.code === "ENOENT") {
      return { line: `nothing to commit: no ${pending}; ${file} stays the base`, code: 0 };
    }
    return { line: `rules_audit: --commit: ${err.message}`, code: 1 };
  }
  return { line: `committed ${pending} over ${file}: the next --since compares with it`, code: 0 };
}

/** The result of `--self-update`: the checkout moved, or why not. */
export type SelfUpdate = { updated: true; from: string; to: string } | { updated: false; stale?: StaleRepo };

/** `git fetch origin main` in the checkout that holds `toolDir`; when it is
 *  on `main` with no local change, a fast-forward to `origin/main`. Any other
 *  case changes nothing and names the checkout stale, with the reason. */
export function selfUpdate(toolDir: string): SelfUpdate {
  const top = gitTop(toolDir);
  if (!top) return { updated: false, stale: { repo: displayPath(toolDir), reason: "self-update: not in a git checkout" } };
  const stale = (reason: string): SelfUpdate => ({ updated: false, stale: { repo: displayPath(top), reason: `self-update: ${reason}` } });
  // A copy of the tools inside some other repo (a dotfiles repo above the
  // plugin cache) is not this tool's checkout: never move that repo.
  const own = path.relative(top, path.join(fs.realpathSync(toolDir), "rules_audit.ts")).split(path.sep).join("/");
  if (git(top, ["ls-files", "--error-unmatch", "--", own]).status !== 0) return stale(`${own} is not tracked in ${displayPath(top)}`);
  const fetch = spawnSync("git", ["-C", top, "fetch", "--quiet", "--no-tags", "--no-recurse-submodules", "origin", "main"], {
    encoding: "utf8", timeout: FETCH_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (fetch.status !== 0) return stale(`git fetch origin main failed: ${firstLine(fetch.stderr) || fetch.error?.message || `exit ${fetch.status}`}`);
  const branch = git(top, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch.status !== 0 || branch.stdout.trim() !== "main") {
    return stale(`on ${branch.status === 0 ? branch.stdout.trim() : "a detached HEAD"}, not main`);
  }
  const status = git(top, ["status", "--porcelain", "--untracked-files=no"]);
  if (status.status !== 0) return stale(`git status failed: ${firstLine(status.stderr)}`);
  if (status.stdout.trim()) return stale("main has local changes");
  const from = git(top, ["rev-parse", "HEAD"]).stdout.trim();
  const ff = git(top, ["merge", "--ff-only", "--quiet", "origin/main"]);
  if (ff.status !== 0) return stale(`cannot fast-forward to origin/main: ${firstLine(ff.stderr) || `exit ${ff.status}`}`);
  const to = git(top, ["rev-parse", "HEAD"]).stdout.trim();
  return from === to ? { updated: false } : { updated: true, from, to };
}

async function playbookMain(flags: Map<string, string | true>, extraStale: StaleRepo[] = []): Promise<number> {
  const home = os.homedir();
  const sinceFile = flags.has("since") ? String(flags.get("since")) : undefined;
  const base = sinceFile === undefined ? undefined : loadSaved(sinceFile);
  const pending = flags.has("save") ? `${String(flags.get("save"))}${PENDING_SUFFIX}` : undefined;
  if (pending !== undefined) {
    // An old report must not reach `--commit` after this triage fails.
    try {
      fs.rmSync(pending, { force: true });
    } catch (e) {
      return playbookFailed(flags, new Error(`--save: ${(e as Error).message}`), 1);
    }
  }
  const c = new Collector();
  try {
    const anyInput = flags.has("repo") || flags.has("fleet") || flags.has("memory") || flags.has("files");
    if (flags.has("repo") || !anyInput) {
      const target = path.resolve(String(flags.get("repo") ?? process.cwd()));
      const top = gitTop(target);
      if (!top) throw new UsageError(`${target} is not inside a git repository`);
      c.addRepo(top);
    }
    if (flags.has("files")) collectFiles(c, String(flags.get("files")));
    if (flags.has("fleet")) await c.addFleet(path.join(home, "Code", "21Stark"));
    if (flags.has("memory")) {
      const projects = path.join(home, ".claude", "projects");
      for (const slug of fs.existsSync(projects) ? fs.readdirSync(projects).sort() : []) {
        const dir = path.join(projects, slug, "memory");
        if (fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) c.addMemory(dir);
      }
    }
  } catch (e) {
    return playbookFailed(flags, e, e instanceof UsageError ? 2 : 1);
  }
  let report;
  try {
    const rootPath = path.join(home, "Code", "CLAUDE.md");
    let rootRules: { path: string; text: string } | undefined;
    if (fs.existsSync(rootPath)) {
      const real = fs.realpathSync(rootPath);
      // In a repo that `--fleet` reads at origin/HEAD, their text is read there.
      rootRules = { path: c.taken.get(real) ?? displayPath(rootPath), text: c.readReal(real) ?? fs.readFileSync(real, "utf8") };
    }
    const stale = [...extraStale, ...[...c.stale.values()].map(({ repo, reason }) => ({ repo, reason }))];
    report = triage({ groups: [...c.groups.values()], rootRules, stale }) as SavedReport;
    if (flags.has("settings")) report.settings = readModelSettings();
  } catch (e) {
    return playbookFailed(flags, e, 1);
  }
  // The saved form: each path the real absolute path the run read.
  const names = new Map([...c.taken].map(([real, name]) => [name, real]));
  const absolute: SavedReport = {
    ...report, saved: new Date().toISOString(),
    files: report.files.map((f) => ({ ...f, path: names.get(f.path) ?? absolutePath(f.path) })),
  };
  if (pending !== undefined) {
    try {
      writeAtomic(pending, `${JSON.stringify(absolute, null, 2)}\n`);
    } catch (e) {
      return playbookFailed(flags, new Error(`--save: ${(e as Error).message}`), 1);
    }
  }
  let code = report.totals.RED ? 3 : 0;
  if (base === undefined) {
    process.stdout.write(flags.has("json") ? `${JSON.stringify(report, null, 2)}\n` : `${formatTriage(report)}\n`);
    if (report.settings && !flags.has("json")) process.stdout.write(`settings: ${JSON.stringify(report.settings)}\n`);
  } else if ("reason" in base) {
    const why = `${base.reason}: this run is the base`;
    process.stdout.write(flags.has("json")
      ? `${JSON.stringify({ since: sinceFile, reason: why, head: { totals: report.totals } }, null, 2)}\n`
      : `Since ${sinceFile}: ${why}\n  now: ${totalsLine(report.totals)}\n`);
    code = 0;
  } else {
    const diff = sinceDiff(sinceFile!, base.report, absolute, (p) => c.readReal(p));
    const render = flags.has("json") ? (d: SinceDiff) => JSON.stringify(d, null, 2) : formatSince;
    // Room for the newline and a `notified:` line, so the whole stdout stays under the limit.
    process.stdout.write(`${fitSince(diff, render, SINCE_MAX_CHARS - 200)}\n`);
    code = diff.new.length ? 3 : 0;
  }
  if (flags.has("notify")) {
    const { title, body } = notifySummary(report);
    if (!send(title, body)) return 1;
    // stdout stays the report alone with --json.
    (flags.has("json") ? process.stderr : process.stdout).write(`notified: ${title}\n`);
  }
  return code;
}

/** Send one push; false, with the reason on stderr, when it did not go. */
function send(title: string, body: string): boolean {
  const failed = heimdallSend(title, body);
  if (failed) process.stderr.write(`rules_audit: ${failed}\n`);
  return !failed;
}

/** With `--notify`, a triage that fails still sends a push, so that an
 *  unattended sweep does not fail in silence. */
function playbookFailed(flags: Map<string, string | true>, e: unknown, code: number): number {
  const message = (e as Error).message;
  process.stderr.write(`rules_audit: ${message}\n`);
  if (flags.has("notify")) send("Agent-doc sweep failed", message);
  return code;
}

export async function main(argv: string[]): Promise<number> {
  const { flags } = precheckCli(argv, {
    values: ["--repo", "--always", "--file-budget", "--always-budget", "--files", "--save", "--since", "--commit"],
    switches: ["--json", "--playbook", "--fleet", "--memory", "--notify", "--settings", "--self-update"],
  }, USAGE);
  if (flags.has("commit")) {
    if (flags.size > 1) {
      process.stderr.write(`rules_audit: --commit takes no other flag: ${[...flags.keys()].filter((k) => k !== "commit").map((k) => `--${k}`).join(", ")}\n`);
      return 2;
    }
    const { line, code } = commitSaved(String(flags.get("commit")));
    (code ? process.stderr : process.stdout).write(`${line}\n`);
    return code;
  }
  const needPlaybook = ["notify", "settings", "save", "since", "self-update"].filter((k) => flags.has(k));
  if (needPlaybook.length && !flags.has("playbook")) {
    process.stderr.write(`rules_audit: ${needPlaybook.map((k) => `--${k}`).join(", ")} need${needPlaybook.length === 1 ? "s" : ""} --playbook\n`);
    return 2;
  }
  if (flags.has("self-update") && !flags.has("fleet")) {
    process.stderr.write("rules_audit: --self-update needs --fleet\n");
    return 2;
  }
  if (flags.has("playbook")) {
    if (flags.has("always") || flags.has("file-budget") || flags.has("always-budget")) {
      process.stderr.write("rules_audit: --always, --file-budget and --always-budget do not apply with --playbook\n");
      return 2;
    }
    const extraStale: StaleRepo[] = [];
    if (flags.has("self-update")) {
      const u = selfUpdate(import.meta.dirname);
      if (u.updated) {
        // Run again on the new code, without the flag, so it updates once.
        process.stderr.write(`rules_audit: self-update moved ${u.from.slice(0, 12)} to ${u.to.slice(0, 12)}; running the new code\n`);
        const again = spawnSync(process.execPath, [
          ...process.execArgv, fileURLToPath(import.meta.url), ...argv.filter((a) => a !== "--self-update"),
        ], { stdio: "inherit" });
        // A run that did not start or was killed sent no push of its own.
        if (again.status === null) {
          return playbookFailed(flags, new Error(`the new code did not run: ${again.error?.message ?? `signal ${again.signal}`}`), 1);
        }
        return again.status;
      }
      if (u.stale) extraStale.push(u.stale);
    }
    return playbookMain(flags, extraStale);
  }
  if (flags.has("fleet") || flags.has("memory") || flags.has("files")) {
    process.stderr.write("rules_audit: --fleet, --memory and --files need --playbook\n");
    return 2;
  }
  const target = path.resolve(String(flags.get("repo") ?? process.cwd()));
  const root = gitTop(target);
  if (!root) {
    process.stderr.write(`rules_audit: ${target} is not inside a git repository\n`);
    return 2;
  }
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
  process.exitCode = await main(process.argv.slice(2));
}
