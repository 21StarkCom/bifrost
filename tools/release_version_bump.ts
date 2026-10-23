#!/usr/bin/env node

// stark-release Step 5 — auto-detect every version file in the repo
// (Python __init__.py / pyproject.toml, package.json, Cargo.toml, plus a
// plain top-level VERSION / VERSION.txt) and rewrite each one to a target
// semver. Replaces the bash detection table in stark-release SKILL.md with
// a single deterministic call.
//
// pyproject.toml is intentionally skipped when `[tool.setuptools-scm]`
// is present — those projects derive their version from git tags and
// rewriting the file would either be silently ignored or fight with the
// scm tool.

import { precheckCli } from "./cli_args_lib.ts";
import fs from "node:fs";
import path from "node:path";

import { isMainModule } from "./main_module_lib.ts";

export type Ecosystem =
  | "python-init"
  | "python-pyproject"
  | "node"
  | "rust"
  | "version-file";

export type BumpedFile = {
  path: string; // relative to repo root
  ecosystem: Ecosystem;
  previous: string;
};

export type SkippedFile = {
  path: string; // relative to repo root
  reason: string;
};

export type BumpResult = {
  version: string;
  dryRun: boolean;
  filesUpdated: BumpedFile[];
  filesSkipped: SkippedFile[];
};

// Allow normal semver plus pre-release / build-metadata suffixes so the
// caller can bump to e.g. `1.2.3-rc.1+build.5` if they ever want it.
const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isValidSemver(version: string): boolean {
  return SEMVER_RE.test(version);
}

// Every product stays at 0.x.y: a version whose first number is higher than
// the one it replaces is a major, which only the operator's explicit
// instruction allows (`allowMajor`, the CLI's --allow-major).
export class MajorBumpError extends Error {}

export function isMajorBump(previous: string, next: string): boolean {
  const first = (v: string) => Number(v.replace(/^v/, "").split(".")[0]);
  const from = first(previous);
  const to = first(next);
  return Number.isFinite(from) && Number.isFinite(to) && to > from;
}

// ── Pure rewriters (string in, string out) ─────────────────────

export type RewriteOutput = {
  content: string;
  previous: string | null;
  reason?: string; // populated when the file is intentionally skipped
};

export function bumpPythonInit(content: string, newVersion: string): RewriteOutput {
  const re = /(__version__\s*=\s*["'])([^"']+)(["'])/;
  const match = content.match(re);
  if (!match) return { content, previous: null };
  return {
    content: content.replace(re, `$1${newVersion}$3`),
    previous: match[2],
  };
}

export function bumpPyproject(content: string, newVersion: string): RewriteOutput {
  // setuptools-scm projects derive their version from git — leave them alone.
  if (/^\s*\[tool\.setuptools[-_]scm\]/m.test(content)) {
    return { content, previous: null, reason: "uses setuptools-scm" };
  }
  // Match the first top-level `version = "..."` we encounter — typically
  // the one in `[project]` (PEP 621) or `[tool.poetry]`. We deliberately
  // accept either since both ecosystems are common in the same repo style.
  const re = /^(version\s*=\s*["'])([^"']+)(["'])/m;
  const match = content.match(re);
  if (!match) return { content, previous: null };
  return {
    content: content.replace(re, `$1${newVersion}$3`),
    previous: match[2],
  };
}

export function bumpPackageJson(content: string, newVersion: string): RewriteOutput {
  // Regex-replace rather than JSON.parse → JSON.stringify so we preserve
  // the file's existing indentation, key ordering, and trailing newline.
  const re = /("version"\s*:\s*")([^"]+)(")/;
  const match = content.match(re);
  if (!match) return { content, previous: null };
  return {
    content: content.replace(re, `$1${newVersion}$3`),
    previous: match[2],
  };
}

export function bumpCargoToml(content: string, newVersion: string): RewriteOutput {
  // Match the [package] version line — Cargo.toml may also contain
  // `[dependencies] foo = { version = "..." }` which we must NOT rewrite.
  // Anchor on `^version =` (start of line, optional whitespace).
  const re = /^(version\s*=\s*["'])([^"']+)(["'])/m;
  const match = content.match(re);
  if (!match) return { content, previous: null };
  return {
    content: content.replace(re, `$1${newVersion}$3`),
    previous: match[2],
  };
}

export function bumpVersionFile(content: string, newVersion: string): RewriteOutput {
  // A plain VERSION file is, by convention, just the version string —
  // optionally `v`-prefixed, usually with a trailing newline. Replace only
  // the first semver token so the optional `v` prefix and the file's
  // surrounding whitespace / trailing newline are preserved. If the file
  // holds no semver (a VERSION file that means something else), previous is
  // null and bumpAll skips it silently.
  const re = /(v?)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/;
  const match = content.match(re);
  if (!match) return { content, previous: null };
  return {
    content: content.replace(re, `$1${newVersion}`),
    previous: match[2],
  };
}

// ── File discovery ──────────────────────────────────────────────

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  "venv",
  ".venv",
  "__pycache__",
]);

function findPythonInits(repoRoot: string): string[] {
  const found: string[] = [];
  const topDirs = readDirsSafe(repoRoot);
  for (const dir of topDirs) {
    if (SKIP_DIRS.has(dir) || dir.startsWith(".")) continue;
    const direct = path.join(repoRoot, dir, "__init__.py");
    if (fs.existsSync(direct) && hasVersionMarker(direct)) found.push(direct);
    if (dir === "src") {
      for (const sub of readDirsSafe(path.join(repoRoot, "src"))) {
        const candidate = path.join(repoRoot, "src", sub, "__init__.py");
        if (fs.existsSync(candidate) && hasVersionMarker(candidate)) {
          found.push(candidate);
        }
      }
    }
  }
  return found;
}

function readDirsSafe(p: string): string[] {
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function hasVersionMarker(filePath: string): boolean {
  try {
    return /__version__/.test(fs.readFileSync(filePath, "utf8"));
  } catch {
    return false;
  }
}

function isFileSafe(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// ── Top-level orchestration ────────────────────────────────────

type DetectedFile = {
  absolutePath: string;
  ecosystem: Ecosystem;
};

export function detectVersionFiles(repoRoot: string): DetectedFile[] {
  const detected: DetectedFile[] = [];
  for (const init of findPythonInits(repoRoot)) {
    detected.push({ absolutePath: init, ecosystem: "python-init" });
  }
  const pyproject = path.join(repoRoot, "pyproject.toml");
  if (fs.existsSync(pyproject)) {
    detected.push({ absolutePath: pyproject, ecosystem: "python-pyproject" });
  }
  const pkg = path.join(repoRoot, "package.json");
  if (fs.existsSync(pkg)) {
    detected.push({ absolutePath: pkg, ecosystem: "node" });
  }
  const cargo = path.join(repoRoot, "Cargo.toml");
  if (fs.existsSync(cargo)) {
    detected.push({ absolutePath: cargo, ecosystem: "rust" });
  }
  // Plain top-level VERSION file (e.g. Terraform / Go infra repos that keep
  // the version in a bare file alongside the git tag). VERSION.txt is the
  // common variant. A non-semver VERSION file is harmless — bumpVersionFile
  // returns previous=null and bumpAll skips it.
  for (const name of ["VERSION", "VERSION.txt"]) {
    const vf = path.join(repoRoot, name);
    if (isFileSafe(vf)) {
      detected.push({ absolutePath: vf, ecosystem: "version-file" });
    }
  }
  return detected;
}

function rewrite(content: string, ecosystem: Ecosystem, newVersion: string): RewriteOutput {
  switch (ecosystem) {
    case "python-init":
      return bumpPythonInit(content, newVersion);
    case "python-pyproject":
      return bumpPyproject(content, newVersion);
    case "node":
      return bumpPackageJson(content, newVersion);
    case "rust":
      return bumpCargoToml(content, newVersion);
    case "version-file":
      return bumpVersionFile(content, newVersion);
  }
}

export function bumpAll(
  repoRoot: string,
  newVersion: string,
  // `previous` is the version the release starts from (the last tag), which
  // a repo with no version file has nowhere else; it is checked like a file's.
  opts: { dryRun?: boolean; allowMajor?: boolean; previous?: string } = {},
): BumpResult {
  if (!isValidSemver(newVersion)) {
    throw new Error(`Invalid semver: ${newVersion}`);
  }
  if (opts.previous !== undefined && !isValidSemver(opts.previous)) {
    throw new Error(`Invalid semver: ${opts.previous}`);
  }
  const dryRun = opts.dryRun ?? false;
  const detected = detectVersionFiles(repoRoot);
  const filesUpdated: BumpedFile[] = [];
  const filesSkipped: SkippedFile[] = [];
  // Every rewrite is planned before any is written, so a refused major
  // leaves every file as it was.
  const writes: { absolutePath: string; content: string }[] = [];

  for (const file of detected) {
    const original = fs.readFileSync(file.absolutePath, "utf8");
    const result = rewrite(original, file.ecosystem, newVersion);
    const relPath = path.relative(repoRoot, file.absolutePath);
    if (result.reason) {
      filesSkipped.push({ path: relPath, reason: result.reason });
      continue;
    }
    if (result.previous === null) {
      // No version line in file — silently skip; not an error (e.g. an
      // empty package.json scaffold without a version field).
      continue;
    }
    if (result.previous === newVersion) {
      filesSkipped.push({ path: relPath, reason: "already at target version" });
      continue;
    }
    writes.push({ absolutePath: file.absolutePath, content: result.content });
    filesUpdated.push({
      path: relPath,
      ecosystem: file.ecosystem,
      previous: result.previous,
    });
  }

  if (!opts.allowMajor) {
    const sources = [
      ...(opts.previous !== undefined ? [{ path: "--previous", previous: opts.previous }] : []),
      ...filesUpdated,
    ];
    const majors = sources.filter((s) => isMajorBump(s.previous, newVersion));
    if (majors.length > 0) {
      throw new MajorBumpError(
        `refused: ${majors.map((m) => `${m.path} ${m.previous}`).join(", ")} → ${newVersion} ` +
          "is a major. Every product stays at 0.x.y: pass --allow-major only on the " +
          "operator's explicit instruction.",
      );
    }
  }

  if (!dryRun) {
    for (const w of writes) fs.writeFileSync(w.absolutePath, w.content);
  }

  return {
    version: newVersion,
    dryRun,
    filesUpdated,
    filesSkipped,
  };
}

// ── CLI ─────────────────────────────────────────────────────────

const USAGE =
  "usage: release_version_bump.ts --version X.Y.Z [--previous X.Y.Z] [--allow-major] [--repo PATH] [--json] [--dry-run]\n" +
  "  Refuses (exit 3, nothing on stdout) a bump of the first number unless --allow-major,\n" +
  "  which only the operator's explicit instruction allows. --previous is the last tag's version.";

function parseArgs(argv: string[]): {
  version: string | null;
  previous: string | null;
  repo: string;
  asJson: boolean;
  dryRun: boolean;
  allowMajor: boolean;
} {
  let version: string | null = null;
  let previous: string | null = null;
  let repo = process.cwd();
  let asJson = false;
  let dryRun = false;
  let allowMajor = false;
  // Help and bad arguments are already handled by `precheckCli` in `main`, so
  // this loop only has to read a validated argv.
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--version") version = argv[++i] ?? null;
    else if (arg === "--previous") previous = argv[++i] ?? null;
    else if (arg === "--repo") repo = argv[++i] ?? repo;
    else if (arg === "--json") asJson = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--allow-major") allowMajor = true;
  }
  return { version, previous, repo: path.resolve(repo), asJson, dryRun, allowMajor };
}

function formatText(result: BumpResult): string {
  const out: string[] = [];
  out.push(
    `Bump → ${result.version}` + (result.dryRun ? " (dry-run, no writes)" : ""),
  );
  if (result.filesUpdated.length === 0 && result.filesSkipped.length === 0) {
    out.push("No version files detected — only the git tag will carry the version.");
    return out.join("\n");
  }
  for (const f of result.filesUpdated) {
    out.push(`  updated  ${f.path}  ${f.previous} → ${result.version}  [${f.ecosystem}]`);
  }
  for (const s of result.filesSkipped) {
    out.push(`  skipped  ${s.path}  (${s.reason})`);
  }
  return out.join("\n");
}

function main(): void {
  // Help and argument validation, before any version file is read or written.
  // A refusal must not reach stdout: callers run this inside `$(…)` and parse
  // the result as JSON.
  precheckCli(process.argv.slice(2), {
    values: ["--version", "--previous", "--repo"],
    switches: ["--json", "--dry-run", "--allow-major"],
  }, USAGE);
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.version) {
    console.error("--version is required");
    process.exit(2);
  }
  for (const v of [opts.version, opts.previous]) {
    if (v !== null && !isValidSemver(v)) {
      console.error(`Invalid semver: ${v}`);
      process.exit(2);
    }
  }
  let result: BumpResult;
  try {
    result = bumpAll(opts.repo, opts.version, {
      dryRun: opts.dryRun,
      allowMajor: opts.allowMajor,
      previous: opts.previous ?? undefined,
    });
  } catch (err) {
    if (err instanceof MajorBumpError) {
      console.error(err.message);
      process.exit(3);
    }
    throw err;
  }
  if (opts.asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatText(result));
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
