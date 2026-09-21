/**
 * `~/.claude` asset links — bifrost's own provisioner for the symlink farm that
 * points a machine's Claude Code config at THIS checkout.
 *
 * WHY THIS LIVES HERE. The farm is how a direct (non-plugin) invocation reaches
 * this repo at all: `asset_root_lib.ts` falls back to `~/.claude/code-review`
 * when `CLAUDE_PLUGIN_ROOT` is unset, and that tree is a set of symlinks INTO a
 * checkout. Until now the only thing that created or healed them was `idun
 * clean`'s `ASSET_SYMLINKS` table — a table in ANOTHER repo hardcoding paths
 * into this one. idun does not ship this tree, so it cannot check that any
 * target still exists; a renamed target there surfaces only when a skill fails
 * at runtime, and the rows rotted exactly that way (they still named the retired
 * `stark-skills` checkout and a `global/orchestrator.md` that no longer exists).
 * bifrost and idun are separate: any tool bifrost needs lives in bifrost. Owning
 * the table here is what makes `TestEveryManagedTargetExists` possible — a
 * STATIC gate, on every PR, that the thing each link points at is really there.
 *
 * WHAT THIS IS NOT ALLOWED TO DO. `~/.claude/code-review/` is not only a symlink
 * farm: `asset_root_lib.ts`'s `stateRoot()` deliberately ignores
 * `CLAUDE_PLUGIN_ROOT` and always writes `audit/`, `history/` and `locks/`
 * there, because plugin caches are replaced wholesale on update and state kept
 * inside one is lost. So this module never removes or replaces that directory
 * and never touches a single entry in it that is not one of the rows below. It
 * creates parents with `mkdir -p` and writes exactly the declared leaf names.
 *
 * THE FOUR RULES the table is worth nothing without:
 *
 *   1. Never clobber real content. A managed path that holds a regular file or
 *      a directory rather than a symlink is left alone and REPORTED. The cost of
 *      being wrong in the other direction is somebody's hand-written file
 *      replaced by a link, with no copy anywhere.
 *   2. Never delete a link whose corrected target is missing from the repo. A
 *      stale link at least says where it used to point; removing it destroys the
 *      only evidence and heals nothing. `target-missing` is reported, never
 *      repaired.
 *   3. Repointing is ATOMIC — symlink at a temp name in the same directory, then
 *      `rename` over. `unlink` followed by `symlink` leaves the path ABSENT in
 *      between, and these are load-bearing: a failure in that window leaves
 *      every skill's `~/.claude/code-review/tools` gone.
 *   4. Idempotent. A link already resolving to the right target is a no-op on
 *      the FIRST run, not just the second.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The repo root, resolved from this file's own location and never from cwd —
 * this CLI is invoked from anywhere, and a cwd-relative root would silently
 * link a machine at whatever directory the operator happened to be standing in.
 *
 * Deliberately NOT imported from `repo_files_lib.ts`, which exports the same
 * one-liner: that module is plumbing for the repo-contract GATES and its
 * `readRepoFile` calls `assert.fail`. Importing it here would point production
 * code at test plumbing and drag `node:assert` into every CLI that loads this.
 */
export function defaultRepoRoot(): string {
  return path.resolve(import.meta.dirname, "..");
}

/**
 * The MAIN checkout's path when `repoRoot` is a linked git WORKTREE, else `null`.
 *
 * `defaultRepoRoot()` is "whatever tree this file was loaded from", and these
 * links are GLOBAL — `~/.claude` has exactly one of each. So an `--install` run
 * from a worktree silently repoints the whole machine at a directory that is
 * meant to be thrown away, and every skill loses `${CLAUDE_PLUGIN_ROOT}/tools`
 * the moment `git worktree remove` runs. That is the same silent-repoint class
 * this tool exists to end, reached from the other side, and agents work in
 * worktrees by default — so the CLI refuses `--install` when this is non-null.
 *
 * A linked worktree's `.git` is a FILE reading `gitdir: <main>/.git/worktrees/<name>`;
 * a main checkout's is a directory. A submodule's `.git` is a file too, but its
 * gitdir carries `/.git/modules/`, so it is correctly not a worktree.
 */
export function linkedWorktreeMainCheckout(repoRoot: string): string | null {
  let contents: string;
  try {
    const dotGit = path.join(repoRoot, ".git");
    if (!fs.statSync(dotGit).isFile()) return null;
    contents = fs.readFileSync(dotGit, "utf8");
  } catch {
    return null;
  }
  const match = /^gitdir:\s*(.+)$/m.exec(contents);
  if (match === null) return null;
  const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
  const at = match[1]!.trim().indexOf(marker);
  return at < 0 ? null : match[1]!.trim().slice(0, at);
}

// ---------------------------------------------------------------------------
// The table — the single source of truth
// ---------------------------------------------------------------------------

export interface ManagedLink {
  /** Link path, relative to `$HOME`. */
  readonly link: string;
  /** Symlink target, relative to the repo root. */
  readonly target: string;
  /** What breaks on this machine when the link is missing or wrong. */
  readonly why: string;
}

/**
 * Every `~/.claude` path this repo owns, and the SINGLE source of truth for
 * them. Order is display order.
 *
 * It is deliberately the `code-review` asset tree and nothing else. The
 * statusline scripts, their `UserPromptSubmit`/`Stop` hooks and the Concrete
 * output style used to be rows here; they are machine configuration, and the
 * stark-workspace repo owns them now — the files, the links to them and the
 * settings that run them. They are NOT in `RETIRED_LINKS` either, because they
 * are not retired: on a provisioned machine those paths are correctly
 * installed links into stark-workspace, and a retired row would make `--check`
 * report every one of them as a problem. This repo neither creates, repairs
 * nor reports them.
 */
export const MANAGED_LINKS: readonly ManagedLink[] = [
  {
    link: ".claude/code-review/tools",
    target: "tools",
    why: "`assetToolsDir()` resolves every skill's `${CLAUDE_PLUGIN_ROOT}/tools/x.ts` through here on a direct invocation; without it the tools simply are not found",
  },
  {
    link: ".claude/code-review/scripts",
    target: "scripts",
    why: "the self-healer's `healer_patterns.json` is read from here",
  },
  {
    link: ".claude/code-review/standards",
    target: "standards",
    why: "skill bodies link `standards/*.md` through the asset root",
  },
  {
    link: ".claude/code-review/prompts",
    target: "global/prompts",
    why: "`assetPromptsDir()`'s flat layout — the iac-review and refactor-planner prompt trees",
  },
  {
    link: ".claude/code-review/config.json",
    target: "global/config.json",
    why: "`assetConfigPath()`'s flat layout — the shipped global config every tool reads",
  },
];

export interface RetiredLink {
  /** Link path, relative to `$HOME`. */
  readonly link: string;
  /** What it used to point at, relative to the repo root. */
  readonly formerTarget: string;
  /** Why it is retired and why re-adding it would be wrong. */
  readonly why: string;
}

/**
 * Links this repo once provisioned and must NEVER provision again.
 *
 * Modelled explicitly rather than simply omitted, because "absent from
 * `MANAGED_LINKS`" and "deliberately retired" look identical in a diff: an
 * omission invites the next person to helpfully add the row back. A row here
 * names the retirement, and `asset_links_lib.test.ts` pins that no entry appears
 * in both tables and that a clean install creates none of these paths — so a
 * resurrection fails a required check instead of quietly relinking a machine at
 * a file that no longer exists.
 */
export const RETIRED_LINKS: readonly RetiredLink[] = [
  {
    link: ".claude/code-review/orchestrator.md",
    formerTarget: "global/orchestrator.md",
    why: "dead documentation, deleted from this repo. It was left live-symlinked only because idun's ASSET_SYMLINKS row kept re-creating it; nothing reads it and there is no file left to point at",
  },
];

/** The row for a link path, or a loud failure — dropping a row that another
 * module depends on must not degrade into a silent no-op. */
export function requireManagedLink(linkRel: string): ManagedLink {
  const row = MANAGED_LINKS.find((r) => r.link === linkRel);
  if (row === undefined) {
    throw new Error(
      `asset_links: no managed link named "${linkRel}". It is the single source of truth for ` +
        `that path — if the row was intentionally dropped, drop its caller in the same change.`,
    );
  }
  return row;
}

/** Absolute link path under `home`. */
export function linkPathFor(row: ManagedLink | RetiredLink, home: string): string {
  return path.join(home, row.link);
}

/** Absolute target path under `repoRoot`. */
export function targetPathFor(row: ManagedLink, repoRoot: string): string {
  return path.join(repoRoot, row.target);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * - `ok`             — a symlink already resolving to the declared target.
 * - `absent`         — nothing at the path.
 * - `dangling`       — a symlink whose target does not resolve.
 * - `misdirected`    — a symlink resolving somewhere other than the target.
 * - `occupied`       — real content (regular file or directory). Never replaced.
 * - `target-missing` — the declared target is not in the repo. Never repaired.
 * - `unreadable`     — the path could not even be stat'd (a parent is a file, or
 *                      permissions deny it). Reported, never guessed at.
 */
export type LinkStatus =
  | "ok"
  | "absent"
  | "dangling"
  | "misdirected"
  | "occupied"
  | "target-missing"
  | "unreadable";

/** The statuses `--install` can repair. Everything else is report-only. */
const REPAIRABLE: ReadonlySet<LinkStatus> = new Set<LinkStatus>(["absent", "dangling", "misdirected"]);

export interface LinkState {
  readonly row: ManagedLink;
  readonly linkPath: string;
  readonly targetPath: string;
  readonly status: LinkStatus;
  /** Where the link currently points (raw `readlink`), when it is a symlink. */
  readonly actual?: string;
  /** Human sentence naming what was found. */
  readonly detail: string;
}

export interface RetiredState {
  readonly row: RetiredLink;
  readonly linkPath: string;
  readonly present: boolean;
  readonly actual?: string;
  readonly detail: string;
}

export interface CheckReport {
  readonly home: string;
  readonly repoRoot: string;
  readonly links: readonly LinkState[];
  readonly retired: readonly RetiredState[];
  /** True only when every managed link is `ok` AND no retired path exists. */
  readonly ok: boolean;
}

export interface Paths {
  /** Defaults to `os.homedir()`. Tests MUST pass a temp dir. */
  readonly home?: string;
  /** Defaults to `defaultRepoRoot()`. */
  readonly repoRoot?: string;
}

function resolvePaths(opts: Paths | undefined): { home: string; repoRoot: string } {
  return {
    home: opts?.home ?? os.homedir(),
    repoRoot: opts?.repoRoot ?? defaultRepoRoot(),
  };
}

function errCode(err: unknown): string {
  return (err as NodeJS.ErrnoException)?.code ?? "";
}

/** Fully resolved path, or `null` when it does not resolve (dangling / gone). */
function realpathOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** Classify one managed link. Pure observation — writes nothing. */
export function checkLink(row: ManagedLink, opts?: Paths): LinkState {
  const { home, repoRoot } = resolvePaths(opts);
  const linkPath = linkPathFor(row, home);
  const targetPath = targetPathFor(row, repoRoot);
  const base = { row, linkPath, targetPath } as const;

  // Target first: with nothing to point at, no repair is possible and the
  // existing link — however wrong — is the only record of intent. Rule 2.
  if (!fs.existsSync(targetPath)) {
    return {
      ...base,
      status: "target-missing",
      detail:
        `${row.target} is not in the repo, so this link cannot be created or corrected. ` +
        `Either the table names a path that was renamed, or the target was deleted without ` +
        `retiring its row.`,
    };
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(linkPath);
  } catch (err) {
    if (errCode(err) === "ENOENT") {
      return { ...base, status: "absent", detail: "not present" };
    }
    return {
      ...base,
      status: "unreadable",
      detail: `cannot be examined (${(err as Error).message}) — refusing to write blind`,
    };
  }

  if (!stat.isSymbolicLink()) {
    const kind = stat.isDirectory() ? "a directory" : "a regular file";
    return {
      ...base,
      status: "occupied",
      detail: `holds ${kind}, not a symlink — left untouched (replacing it would destroy content that exists nowhere else)`,
    };
  }

  let actual: string;
  try {
    actual = fs.readlinkSync(linkPath);
  } catch (err) {
    return {
      ...base,
      status: "unreadable",
      detail: `is a symlink whose target could not be read (${(err as Error).message})`,
    };
  }

  const resolvedLink = realpathOrNull(linkPath);
  if (resolvedLink === null) {
    return { ...base, status: "dangling", actual, detail: `points at ${actual}, which does not exist` };
  }
  // Compare fully resolved paths, not the literal text: `/tmp` is a symlink to
  // `/private/tmp` on macOS and a checkout reached through one is the same tree.
  // A link spelled differently but resolving to the target is already correct,
  // and rewriting it would churn for nothing.
  const resolvedTarget = realpathOrNull(targetPath);
  if (resolvedTarget !== null && resolvedLink === resolvedTarget) {
    return { ...base, status: "ok", actual, detail: `-> ${actual}` };
  }
  return {
    ...base,
    status: "misdirected",
    actual,
    detail: `points at ${actual}, expected ${targetPath}`,
  };
}

/** Classify one retired link. Presence is the whole finding. */
export function checkRetired(row: RetiredLink, opts?: Paths): RetiredState {
  const { home } = resolvePaths(opts);
  const linkPath = linkPathFor(row, home);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(linkPath);
  } catch {
    return { row, linkPath, present: false, detail: "absent, as it should be" };
  }
  // Guarded exactly as `checkLink`'s readlink is: an entry removed between the
  // lstat and here, or a symlink the kernel refuses to read, would otherwise
  // throw out of `checkLinks` and take `asset_links --check` down with an
  // uncaught stack trace — the gate failing OPEN on the one call that is
  // supposed to be pure observation.
  let actual: string | undefined;
  if (stat.isSymbolicLink()) {
    try {
      actual = fs.readlinkSync(linkPath);
    } catch {
      actual = undefined;
    }
  }
  // `rm` is right for a file or a link and wrong for a directory; name the one
  // that matches what is actually there rather than handing over a command that
  // fails.
  const removal = stat.isDirectory() ? `rm -r ${linkPath}` : `rm ${linkPath}`;
  return {
    row,
    linkPath,
    present: true,
    actual,
    detail:
      `still present${actual ? ` (-> ${actual})` : ""} — retired: ${row.why}. ` +
      `Remove it by hand: ${removal}`,
  };
}

/** Classify every managed and retired path. Writes nothing. */
export function checkLinks(opts?: Paths): CheckReport {
  const { home, repoRoot } = resolvePaths(opts);
  const links = MANAGED_LINKS.map((row) => checkLink(row, { home, repoRoot }));
  const retired = RETIRED_LINKS.map((row) => checkRetired(row, { home, repoRoot }));
  return {
    home,
    repoRoot,
    links,
    retired,
    ok: links.every((l) => l.status === "ok") && retired.every((r) => !r.present),
  };
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

export type LinkOutcome = "ok" | "linked" | "repointed" | "refused";

export interface LinkAction {
  readonly row: ManagedLink;
  readonly linkPath: string;
  readonly targetPath: string;
  /** The status that was found before acting. */
  readonly before: LinkStatus;
  readonly outcome: LinkOutcome;
  readonly detail: string;
}

export interface InstallOptions extends Paths {
  /**
   * TEST-ONLY fault seam: invoked with the temp symlink path after it is
   * created and before the `rename` that publishes it. Throwing here simulates
   * a crash in exactly the window rule 3 exists to make survivable, which is the
   * only way to prove atomicity from the outside — the alternative is grepping
   * this file for the word `rename`, which proves nothing about behaviour.
   */
  readonly onBeforeRename?: (tmpPath: string) => void;
}

let tmpSeq = 0;

/**
 * Create `linkPath` as a symlink to `targetPath`, atomically. The path is either
 * the OLD link or the NEW one at every instant — never absent.
 *
 * The temp name sits in the link's own directory so the `rename` is within one
 * filesystem (POSIX `rename` is only atomic there, and cross-device fails
 * outright with EXDEV). It is dot-prefixed so a temp that somehow outlives a
 * crash is not mistaken for a managed asset.
 */
function atomicSymlink(targetPath: string, linkPath: string, onBeforeRename?: (tmp: string) => void): void {
  const dir = path.dirname(linkPath);
  tmpSeq += 1;
  const tmpPath = path.join(dir, `.${path.basename(linkPath)}.stark-link-${process.pid}-${tmpSeq}`);
  // A temp left by a killed run would make `symlinkSync` throw EEXIST and wedge
  // every later run on a path no operator knows to look at.
  try {
    fs.unlinkSync(tmpPath);
  } catch {
    // nothing to clear — the normal case
  }
  fs.symlinkSync(targetPath, tmpPath);
  try {
    onBeforeRename?.(tmpPath);
    fs.renameSync(tmpPath, linkPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // best effort: the throw below is the finding that matters
    }
    throw err;
  }
}

/** Provision or heal ONE managed link. Report-only for every unrepairable status. */
export function installLink(row: ManagedLink, opts?: InstallOptions): LinkAction {
  const { home, repoRoot } = resolvePaths(opts);
  const state = checkLink(row, { home, repoRoot });
  const base = { row, linkPath: state.linkPath, targetPath: state.targetPath, before: state.status } as const;

  if (state.status === "ok") {
    return { ...base, outcome: "ok", detail: state.detail };
  }
  if (!REPAIRABLE.has(state.status)) {
    return { ...base, outcome: "refused", detail: state.detail };
  }

  try {
    // `mkdir -p` the PARENT only. `~/.claude/code-review/` also holds
    // `stateRoot()`'s audit/, history/ and locks/; it is created if missing and
    // otherwise left exactly as it is.
    fs.mkdirSync(path.dirname(state.linkPath), { recursive: true });
    atomicSymlink(state.targetPath, state.linkPath, opts?.onBeforeRename);
  } catch (err) {
    return { ...base, outcome: "refused", detail: `could not write the link (${(err as Error).message})` };
  }
  return state.status === "absent"
    ? { ...base, outcome: "linked", detail: `-> ${state.targetPath}` }
    : { ...base, outcome: "repointed", detail: `was ${state.actual ?? "broken"}, now -> ${state.targetPath}` };
}

export interface InstallReport extends CheckReport {
  readonly actions: readonly LinkAction[];
}

/**
 * Provision or heal every managed link, then RE-CHECK from disk. `ok` describes
 * the state the filesystem is actually in afterwards, not the actions we believe
 * we took — the same reason this repo refuses to repeat a "done" it did not
 * verify.
 *
 * Retired links are never created and never removed: removing one would be this
 * tool touching a `~/.claude/code-review/` entry it does not manage. They are
 * reported with the exact `rm` to run.
 */
export function installLinks(opts?: InstallOptions): InstallReport {
  const { home, repoRoot } = resolvePaths(opts);
  const actions = MANAGED_LINKS.map((row) =>
    installLink(row, { home, repoRoot, onBeforeRename: opts?.onBeforeRename }),
  );
  return { ...checkLinks({ home, repoRoot }), actions };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

/** Human report. Every non-`ok` row names what breaks, so the operator can tell
 * a cosmetic finding from a skill that cannot find its tools without reading
 * this file. */
export function renderReport(report: CheckReport | InstallReport): string {
  const lines: string[] = [`home: ${report.home}`, `repo: ${report.repoRoot}`, ""];
  const actions = (report as InstallReport).actions;
  // Retired rows are rendered in the same column block, and the retired link is
  // the LONGEST name in either table — left out of the width it is the one row
  // whose columns do not line up, and it is the only row that asks the operator
  // to do something.
  const width = Math.max(
    ...report.links.map((l) => l.row.link.length),
    ...report.retired.filter((r) => r.present).map((r) => r.row.link.length),
  );

  for (const [i, state] of report.links.entries()) {
    const action = actions?.[i];
    const label = action ? action.outcome : state.status;
    const detail = action && action.outcome !== "ok" ? action.detail : state.detail;
    lines.push(`  ${pad(state.row.link, width)}  ${pad(label, 14)} ${detail}`);
    if (state.status !== "ok") lines.push(`  ${" ".repeat(width)}  ${pad("", 14)} needed for: ${state.row.why}`);
  }
  for (const state of report.retired) {
    if (!state.present) continue;
    lines.push(`  ${pad(state.row.link, width)}  ${pad("retired", 14)} ${state.detail}`);
  }
  lines.push("");
  lines.push(report.ok ? "OK: every managed link resolves into this checkout" : "PROBLEMS: see the rows above");
  return lines.join("\n");
}

/** Machine-readable report for `--json`. */
export function reportToJson(report: CheckReport | InstallReport): unknown {
  const actions = (report as InstallReport).actions;
  return {
    home: report.home,
    repo_root: report.repoRoot,
    ok: report.ok,
    links: report.links.map((state, i) => ({
      link: state.row.link,
      target: state.row.target,
      status: state.status,
      actual: state.actual ?? null,
      detail: state.detail,
      outcome: actions?.[i]?.outcome ?? null,
      why: state.row.why,
    })),
    retired: report.retired.map((state) => ({
      link: state.row.link,
      former_target: state.row.formerTarget,
      present: state.present,
      actual: state.actual ?? null,
      detail: state.detail,
    })),
  };
}
