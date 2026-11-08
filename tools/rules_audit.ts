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
 * summary with `heimdall send`. `--install-schedule` writes and loads the
 * launchd job that sends it each Monday (the weekly sweep); its output goes to
 * `<stateRoot>/agent-doc-sweep/weekly.log`.
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

import { stateRoot } from "./asset_root_lib.ts";
import { spawnBounded } from "./bounded_spawn_lib.ts";
import { precheckCli } from "./cli_args_lib.ts";
import { heimdallSend, installWeeklyJob, uninstallJob, weeklyPlist } from "./launchd_lib.ts";
import { isMainModule } from "./main_module_lib.ts";
import {
  agentKind, auditRules, formatText, formatTriage, instructionKind, notifySummary, triage,
  type AgentKind, type RepoView, type StaleRepo, type TriageGroup,
} from "./rules_audit_lib.ts";

export const SWEEP_LABEL = "com.21stark.agent-doc-sweep";

/** The weekly sweep: the fleet and the memory folders, each Monday at 09:00 local. */
const SWEEP = { label: SWEEP_LABEL, args: ["--playbook", "--fleet", "--memory", "--notify"], weekday: 1, hour: 9 } as const;

/** The plist of the sweep's launchd job, with its output to `log`. */
export function sweepPlist(tool: string, log: string, envPath: string): string {
  return weeklyPlist({ ...SWEEP, tool, log, envPath });
}

const USAGE = `usage: rules_audit.ts [--repo <path>] [--json] [--always <rule,…>]
                      [--file-budget <bytes>] [--always-budget <bytes>]
       rules_audit.ts --playbook [--repo <path>] [--fleet] [--memory]
                      [--files <path,…>] [--json] [--notify]
       rules_audit.ts --install-schedule | --uninstall-schedule

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

The weekly sweep:

  --install-schedule      write and load the launchd job ${SWEEP_LABEL}
                          (--playbook --fleet --memory --notify, Mondays 09:00 local)
  --uninstall-schedule    unload and remove that job`;

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

/** A path `walkRepo` does not reach: in a dependency tree or a worktrees folder. */
function prunedPath(rel: string, isBlob: (rel: string) => boolean): boolean {
  const parts = rel.split("/");
  for (let i = 0; i < parts.length - 1; i++) {
    if (PRUNE_DIRS.has(parts[i])) return true;
    if (parts[i] === "vendor" && isBlob([...parts.slice(0, i + 1), "modules.txt"].join("/"))) return true;
  }
  return /(?:^|\/)\.(?:claude|cursor)\/worktrees\//.test(rel);
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
  const resolve = (rel: string): string | null => {
    let parts = rel === "" ? [] : rel.split("/");
    for (let i = 0, hops = 0; i < parts.length; i++) {
      const at = parts.slice(0, i + 1).join("/");
      const b = blobs.get(at);
      if (!b?.link) continue;
      const target = texts.get(b.oid)!;
      if (++hops > 40 || target.startsWith("/")) return null;
      const to = path.posix.normalize(path.posix.join(path.posix.dirname(at), target));
      if (to === ".." || to.startsWith("../")) return null;
      parts = [...(to === "." ? [] : to.split("/")), ...parts.slice(i + 1)];
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
 *  The fetch moves remote refs only; it writes no `FETCH_HEAD` and runs no
 *  maintenance. Its own session has no terminal, so a sign-in prompt fails. */
async function fetchAll(roots: string[]): Promise<Map<string, string>> {
  const failed = new Map<string, string>();
  const queue = [...roots];
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const fetchOne = async (root: string) => {
    try {
      const r = await spawnBounded("git", ["-C", root, "fetch", "--quiet", "--no-write-fetch-head", "--no-auto-gc", "origin"], {
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

async function playbookMain(flags: Map<string, string | true>): Promise<number> {
  const home = os.homedir();
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
      // When `--fleet` triages them, the triage reads their text at origin/HEAD.
      rootRules = { path: c.taken.get(real) ?? displayPath(rootPath), text: fs.readFileSync(real, "utf8") };
    }
    const stale = [...c.stale.values()].map(({ repo, reason }) => ({ repo, reason }));
    report = triage({ groups: [...c.groups.values()], rootRules, stale });
  } catch (e) {
    return playbookFailed(flags, e, 1);
  }
  process.stdout.write(flags.has("json") ? `${JSON.stringify(report, null, 2)}\n` : `${formatTriage(report)}\n`);
  if (flags.has("notify")) {
    const { title, body } = notifySummary(report);
    if (!send(title, body)) return 1;
    // stdout stays the report alone with --json.
    (flags.has("json") ? process.stderr : process.stdout).write(`notified: ${title}\n`);
  }
  return report.totals.RED ? 3 : 0;
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

function installSchedule(): number {
  return installWeeklyJob({
    ...SWEEP,
    toolName: "rules_audit.ts",
    fallback: fileURLToPath(import.meta.url),
    log: path.join(stateRoot(), "agent-doc-sweep", "weekly.log"),
    // git labels the files that a repo ignores; heimdall sends the summary.
    bins: ["node", "heimdall", "git"],
    when: "Mondays 09:00 local",
  });
}

export async function main(argv: string[]): Promise<number> {
  const { flags } = precheckCli(argv, {
    values: ["--repo", "--always", "--file-budget", "--always-budget", "--files"],
    switches: ["--json", "--playbook", "--fleet", "--memory", "--notify", "--install-schedule", "--uninstall-schedule"],
  }, USAGE);
  const mode = ["install-schedule", "uninstall-schedule"].find((k) => flags.has(k));
  if (mode && flags.size > 1) {
    process.stderr.write(`rules_audit: --${mode} takes no other argument\n`);
    return 2;
  }
  if (mode === "install-schedule") return installSchedule();
  if (mode === "uninstall-schedule") return uninstallJob(SWEEP_LABEL);
  if (flags.has("notify") && !flags.has("playbook")) {
    process.stderr.write("rules_audit: --notify needs --playbook\n");
    return 2;
  }
  if (flags.has("playbook")) {
    if (flags.has("always") || flags.has("file-budget") || flags.has("always-budget")) {
      process.stderr.write("rules_audit: --always, --file-budget and --always-budget do not apply with --playbook\n");
      return 2;
    }
    return playbookMain(flags);
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
