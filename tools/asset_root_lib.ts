/**
 * Asset- vs. state-root resolution — the seam that lets a skill/tool resolve
 * its shipped assets whether it runs inside a self-contained Claude Code plugin
 * (marketplace distribution) or via a direct, non-plugin invocation.
 *
 * Two distinct roots:
 *
 *   - `assetRoot()` — IMMUTABLE shipped assets: `tools/`, `prompts/`,
 *     `standards/`, `config.json`, `forge_heuristics.json` (see
 *     `assetConfigPath()` for the two layouts those last three live in).
 *     In an installed plugin Claude Code sets `CLAUDE_PLUGIN_ROOT` to the
 *     plugin's cache dir. Every entry in `.claude-plugin/marketplace.json` now
 *     names `"source": "./"`, so that cache is a copy of THIS repo — there is
 *     no build step and no per-bundle vendoring behind it any more. For direct
 *     (non-plugin) invocations `CLAUDE_PLUGIN_ROOT` is unset and we fall back
 *     to the canonical `~/.claude/code-review` tree. `STARK_ASSET_ROOT`
 *     overrides both (tests / unusual layouts).
 *
 *   - `stateRoot()` — MUTABLE runtime state: `history/`, `sessions/`,
 *     `staged/`, `dashboard/`, `locks/`, `logs/`, alerts, healer + cost ledgers.
 *     This ALWAYS lives under the user's real home (`~/.claude/code-review`),
 *     never inside a plugin dir — plugin caches are replaced wholesale on
 *     update, so state kept there would be lost and would not be shared across
 *     bundles. `STARK_STATE_ROOT` overrides (tests).
 *
 * Both default to the same `~/.claude/code-review` path, so behaviour is
 * identical to the pre-plugin world whenever `CLAUDE_PLUGIN_ROOT` is unset —
 * the live symlink dev loop is unaffected.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function nonEmpty(v: string | undefined): string | undefined {
  return v && v.trim() !== "" ? v : undefined;
}

function existsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function existsFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Pick the first candidate that exists (as a directory), else the last
 * candidate as a back-compat fallback. The fallback preserves the historical
 * behaviour for callers (and tests) that expect a concrete path even when no
 * layout is present on disk yet.
 */
function firstExistingDir(candidates: readonly string[], fallback: string): string {
  for (const c of candidates) {
    if (existsDir(c)) return c;
  }
  return fallback;
}

function firstExistingFile(candidates: readonly string[], fallback: string): string {
  for (const c of candidates) {
    if (existsFile(c)) return c;
  }
  return fallback;
}

/** Canonical home tree: `~/.claude/code-review`. */
function homeCodeReview(): string {
  return path.join(os.homedir(), ".claude", "code-review");
}

/**
 * Root for immutable, shipped assets (tools, prompts, standards, config.json).
 * Precedence: `STARK_ASSET_ROOT` > `CLAUDE_PLUGIN_ROOT` > `~/.claude/code-review`.
 */
export function assetRoot(): string {
  return (
    nonEmpty(process.env.STARK_ASSET_ROOT) ??
    nonEmpty(process.env.CLAUDE_PLUGIN_ROOT) ??
    homeCodeReview()
  );
}

/**
 * Like `assetRoot()` but for call sites that already resolve their own `home`
 * (typically for test injection via an explicit `opts.home`). Honours the
 * plugin/asset overrides first, then falls back to `<home>/.claude/code-review`
 * rather than `os.homedir()` — so existing tests that pass a temp `home` keep
 * working unchanged when no plugin env is set.
 */
export function assetRootForHome(home: string): string {
  return (
    nonEmpty(process.env.STARK_ASSET_ROOT) ??
    nonEmpty(process.env.CLAUDE_PLUGIN_ROOT) ??
    path.join(home, ".claude", "code-review")
  );
}

/**
 * Root for mutable runtime state (history, sessions, locks, logs, ledgers).
 * Precedence: `STARK_STATE_ROOT` > `~/.claude/code-review`. Deliberately does
 * NOT consult `CLAUDE_PLUGIN_ROOT` — state must outlive plugin-cache churn.
 */
export function stateRoot(): string {
  return nonEmpty(process.env.STARK_STATE_ROOT) ?? homeCodeReview();
}

/**
 * The shipped global config file. Layout-robust because `assetRoot()` can hand
 * back either of two shapes that are BOTH live:
 *
 *   - FLAT — `<assetRoot>/config.json`. The `~/.claude/code-review` tree is a
 *     farm of symlinks INTO a checkout (`config.json` ->
 *     `<checkout>/global/config.json`, `prompts` -> `<checkout>/global/prompts`,
 *     `tools` -> `<checkout>/tools`), so the `global/` layer is already
 *     collapsed and no `global/` dir sits beside them. This is the root
 *     whenever `CLAUDE_PLUGIN_ROOT` is unset.
 *   - SOURCE — `<assetRoot>/global/config.json`. A raw checkout of this repo,
 *     and now an INSTALLED PLUGIN too: every marketplace entry is
 *     `"source": "./"`, so `CLAUDE_PLUGIN_ROOT` points at a cache of the whole
 *     repo tree with `global/` intact. It was flat there while a build step
 *     vendored a per-bundle asset root; that engine is gone, so the plugin and
 *     the checkout are now the same shape.
 *
 * No live root carries both, so the order settles nothing today — it stays
 * flat-first because that is the branch the no-plugin default takes, and
 * flipping it would re-order a probe for no gain. The last-resort return is the
 * flat path so a root with neither layout still yields a concrete, nameable
 * path for the caller's error instead of throwing here.
 */
export function assetConfigPath(): string {
  const root = assetRoot();
  const flat = path.join(root, "config.json");
  return firstExistingFile([flat, path.join(root, "global", "config.json")], flat);
}

/**
 * The prompt tree (`iac-review/`, `refactor-planner/`). Two layouts for exactly
 * the reason `assetConfigPath()` spells out: flat `<assetRoot>/prompts` in the
 * `~/.claude/code-review` symlink tree, `<assetRoot>/global/prompts` in a source
 * checkout and in a plugin cache. Try flat first, then source, then fall back to
 * flat.
 */
export function assetPromptsDir(): string {
  const root = assetRoot();
  const flat = path.join(root, "prompts");
  return firstExistingDir([flat, path.join(root, "global", "prompts")], flat);
}

/** `assetRoot()/tools` — the bundled TypeScript tool scripts. */
export function assetToolsDir(): string {
  return path.join(assetRoot(), "tools");
}
