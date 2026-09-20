/**
 * Asset- vs. state-root resolution — the seam that lets a skill/tool resolve
 * its shipped assets from wherever it happens to be run: a checkout, a symlink
 * farm, or (historically) a self-contained Codex plugin rendered out of this
 * tree.
 *
 * Two distinct roots:
 *
 *   - `assetRoot()` — IMMUTABLE shipped assets: `tools/`, `prompts/`,
 *     `standards/`, `config.json`, `forge_heuristics.json` (see
 *     `assetConfigPath()` for the two layouts those last three live in).
 *     HISTORICAL: `STARK_PLUGIN_ROOT` was exported by bifrost's Codex adapter,
 *     which rendered this tree into a native Codex install. That adapter, and
 *     the whole render step behind it, are gone — `runtime-overrides/codex/` is
 *     SOURCE ONLY now and nothing renders it. The precedence chain below is
 *     left exactly as it stands: both variables remain the documented way to
 *     aim a Codex-side run at a checkout, and dropping `STARK_PLUGIN_ROOT`
 *     would silently break any environment that still exports it. For direct
 *     invocations with neither variable set we fall back to
 *     `~/.stark/code-review`, never a Claude-owned path.
 *
 *   - `stateRoot()` — MUTABLE runtime state: `history/`, `sessions/`,
 *     `staged/`, `dashboard/`, `locks/`, `logs/`, alerts, healer + cost ledgers.
 *     This ALWAYS lives under the user's real home (`~/.stark/code-review`),
 *     never inside a plugin dir — plugin caches are replaced wholesale on
 *     update, so state kept there would be lost and would not be shared across
 *     bundles. `STARK_STATE_ROOT` overrides (tests).
 *
 * Both default to the same `~/.stark/code-review` path. Codex runtime state is
 * therefore disjoint from Claude Code runtime state even when no environment
 * overrides are supplied.
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

/** Canonical Codex runtime tree: `~/.stark/code-review`. */
function homeCodeReview(): string {
  return path.join(os.homedir(), ".stark", "code-review");
}

/**
 * Root for immutable, shipped assets (tools, prompts, standards, config.json).
 * Precedence: `STARK_ASSET_ROOT` > `STARK_PLUGIN_ROOT` > `~/.stark/code-review`.
 */
export function assetRoot(): string {
  return (
    nonEmpty(process.env.STARK_ASSET_ROOT) ??
    nonEmpty(process.env.STARK_PLUGIN_ROOT) ??
    homeCodeReview()
  );
}

/**
 * Like `assetRoot()` but for call sites that already resolve their own `home`
 * (typically for test injection via an explicit `opts.home`). Honours the
 * plugin/asset overrides first, then falls back to `<home>/.stark/code-review`
 * rather than `os.homedir()` — so existing tests that pass a temp `home` keep
 * working unchanged when no plugin env is set.
 */
export function assetRootForHome(home: string): string {
  return (
    nonEmpty(process.env.STARK_ASSET_ROOT) ??
    nonEmpty(process.env.STARK_PLUGIN_ROOT) ??
    path.join(home, ".stark", "code-review")
  );
}

/**
 * Root for mutable runtime state (history, sessions, locks, logs, ledgers).
 * Precedence: `STARK_STATE_ROOT` > `~/.stark/code-review`. Deliberately does
 * NOT consult `STARK_PLUGIN_ROOT` — state must outlive plugin-cache churn.
 */
export function stateRoot(env: NodeJS.ProcessEnv = process.env): string {
  return nonEmpty(env.STARK_STATE_ROOT) ?? homeCodeReview();
}

/**
 * Like `stateRoot()` for callers that accept an injected home directory.
 * The explicit state override remains authoritative; otherwise state lives at
 * `<home>/.stark/code-review` so tests and isolated runtimes never touch the
 * operator's real state tree.
 */
export function stateRootForHome(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    nonEmpty(env.STARK_STATE_ROOT) ??
    path.join(home, ".stark", "code-review")
  );
}

/**
 * The shipped global config file. Layout-robust because the root it resolves
 * against can be either of two shapes:
 *
 *   - FLAT — `<assetRoot>/config.json`. What a symlink farm produces when it
 *     links `config.json`, `prompts` and `tools` straight into a checkout's
 *     `global/` and top-level dirs, collapsing the `global/` layer away.
 *   - SOURCE — `<assetRoot>/global/config.json`. A raw checkout of this repo,
 *     which is what `STARK_ASSET_ROOT` points at today. The build step that
 *     once flattened `global/` into a per-bundle Codex asset root is gone with
 *     the rest of the render, so there is no vendored flat layout on this side
 *     any more.
 *
 * Try flat first, then source, then fall back to the flat path so a root with
 * neither layout still yields a concrete, nameable path for the caller's error
 * instead of throwing here.
 */
export function assetConfigPath(): string {
  const root = assetRoot();
  const flat = path.join(root, "config.json");
  return firstExistingFile([flat, path.join(root, "global", "config.json")], flat);
}

/**
 * The prompt tree (`iac-review/`, `refactor-planner/`). Two layouts for exactly
 * the reason `assetConfigPath()` spells out: flat `<assetRoot>/prompts` under a
 * symlink farm, `<assetRoot>/global/prompts` in a source checkout. Try flat
 * first, then source, then fall back to flat.
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
