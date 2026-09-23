// rules_audit CLI over a real temporary git repo: the disk walk, the pruning,
// the gitignore labels, and the exit-code contract.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const CLI = path.join(import.meta.dirname, "rules_audit.ts");

function repo(files: Record<string, string>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-")));
  const git = spawnSync("git", ["init", "-q", dir], { encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

function run(args: string[], cwd = os.tmpdir()) {
  return spawnSync(process.execPath, ["--no-warnings", CLI, ...args], { cwd, encoding: "utf8" });
}

test("a gitignored .claude/ is still audited, and labelled as local-only", () => {
  const dir = repo({
    ".gitignore": ".claude/\n",
    "CLAUDE.md": "root\n",
    ".claude/rules/api.md": '---\npaths:\n  - "api/**"\n---\napi rule\n',
    "api/x.ts": "",
  });
  try {
    const r = run(["--repo", dir, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    const rule = report.files.find((f: { path: string }) => f.path === ".claude/rules/api.md");
    assert.ok(rule, "the ignored rule was discovered");
    assert.equal(rule.ignored, true);
    assert.ok(report.findings.some((f: { file: string; short_summary: string }) =>
      f.file === ".claude/rules/api.md" && /gitignored/.test(f.short_summary)));
    assert.ok(Array.isArray(report.findings) && report.findings.every((f: { verdict: string }) => f.verdict));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("nested repos, worktrees and node_modules are pruned from the walk", () => {
  const dir = repo({
    "CLAUDE.md": "root\n",
    "node_modules/pkg/CLAUDE.md": "vendored\n",
    ".claude/worktrees/w1/CLAUDE.md": "worktree\n",
    "nested/.git": "gitdir: elsewhere\n",
    "nested/CLAUDE.md": "nested repo\n",
    "pkg/CLAUDE.md": "package\n",
  });
  try {
    const r = run(["--json"], dir);
    assert.equal(r.status, 0, r.stderr);
    const paths = JSON.parse(r.stdout).files.map((f: { path: string }) => f.path).sort();
    assert.deepEqual(paths, ["CLAUDE.md", "pkg/CLAUDE.md"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("symlinked rule directories are walked; one pointing outside the repo is reported", () => {
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-ext-")));
  fs.writeFileSync(path.join(outside, "ext.md"), "external rule\n");
  const dir = repo({ "shared/team.md": "unscoped shared rule\n", ".claude/rules/local.md": "local\n" });
  fs.symlinkSync("../../shared", path.join(dir, ".claude/rules/team"));
  fs.symlinkSync(outside, path.join(dir, ".claude/rules/ext"));
  try {
    const r = run(["--repo", dir, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    const rule = report.files.find((f: { path: string }) => f.path === ".claude/rules/team/team.md");
    assert.ok(rule, "the rule behind the directory link was discovered");
    assert.equal(rule.claude, "always");
    assert.ok(report.findings.some((f: { file: string; short_summary: string }) =>
      f.file === ".claude/rules/ext" && /outside the repo/.test(f.short_summary)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("the text report names the load model and the findings", () => {
  const dir = repo({ ".claude/rules/big.md": "unscoped\n" });
  try {
    const r = run(["--repo", dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /load model: Claude Code/);
    assert.match(r.stdout, /Unscoped rule loads every session/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("refusals: not a repo, a bad budget, an unknown --always rule, help", () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-plain-"));
  const dir = repo({ ".claude/rules/a.md": "a\n" });
  try {
    const notRepo = run(["--repo", plain]);
    assert.equal(notRepo.status, 2);
    assert.match(notRepo.stderr, /not inside a git repository/);
    const budget = run(["--repo", dir, "--file-budget", "lots"]);
    assert.equal(budget.status, 2);
    assert.match(budget.stderr, /positive integer/);
    const always = run(["--repo", dir, "--always", "nope.md"]);
    assert.equal(always.status, 2);
    assert.match(always.stderr, /--always names no rule/);
    const help = run(["--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^usage: rules_audit\.ts/);
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
