// rules_audit CLI over a real temporary git repo: the disk walk, the pruning,
// the gitignore labels, and the exit-code contract.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { absolutePath, buildView, contextLines, fitSince, loadSaved, originView, sinceDiff, type SavedReport, type SinceDiff, formatSince, SINCE_MAX_CHARS, readModelSettings, selfUpdate } from "./rules_audit.ts";

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

function run(args: string[], cwd = os.tmpdir(), env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, ["--no-warnings", CLI, ...args], { cwd, encoding: "utf8", env });
}

/** git in `cwd` with a fixed identity and no user or system config; its stdout. */
function gitOk(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", ...args], {
    cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

/** Writes `files` under `dir`, creating folders. */
function writeAll(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}

/** Commits all of the repo `dir` and gives it a bare origin at `bare`, with
 *  `origin/HEAD` set unless `noHead`: a checkout at origin. With `noHead`, a
 *  fetch does not set it either (git 2.48 and later set it by default). */
function publish(dir: string, bare: string, noHead = false): void {
  gitOk(dir, "add", "-A");
  gitOk(dir, "commit", "-q", "-m", "seed");
  gitOk(dir, "clone", "-q", "--bare", dir, bare);
  gitOk(dir, "remote", "add", "origin", bare);
  if (noHead) gitOk(dir, "config", "remote.origin.followRemoteHEAD", "never");
  gitOk(dir, "fetch", "-q", "origin");
  if (!noHead) gitOk(dir, "remote", "set-head", "origin", "-a");
}

/** A clone of `bare` in which `files` are written, committed and pushed:
 *  origin moves on while the fleet's checkout stays behind. */
function pushToOrigin(home: string, bare: string, files: Record<string, string>): void {
  const up = fs.mkdtempSync(path.join(home, "upstream-"));
  gitOk(home, "clone", "-q", bare, up);
  writeAll(up, files);
  gitOk(up, "add", "-A");
  gitOk(up, "commit", "-q", "-m", "origin moves on");
  gitOk(up, "push", "-q", "origin", "HEAD");
}

/** A home with a fleet folder of one repo at its origin, the root rules, and
 *  one memory folder. */
function home(): { dir: string; env: NodeJS.ProcessEnv } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-home-")));
  const write = (rel: string, text: string) => writeAll(dir, { [rel]: text });
  const fleet = path.join(dir, "Code", "21Stark");
  fs.mkdirSync(fleet, { recursive: true });
  gitOk(fleet, "init", "-q", "alpha");
  write("Code/21Stark/alpha/CLAUDE.md", "# Alpha\n\n- Never commit or push to a default branch directly unless the operator asks.\n");
  write("Code/21Stark/alpha/docs/workspace/CLAUDE.md", "# Workspace\n\n- One clone per repo.\n");
  write("Code/21Stark/alpha/skill/s/SKILL.md", "---\nname: s\ndescription: A short skill.\n---\n- Do the step.\n");
  fs.symlinkSync("CLAUDE.md", path.join(fleet, "alpha", "AGENTS.md"));
  publish(path.join(fleet, "alpha"), path.join(dir, "origins", "alpha.git"));
  fs.symlinkSync("alpha/docs/workspace/CLAUDE.md", path.join(fleet, "CLAUDE.md"));
  fs.mkdirSync(path.join(fleet, "not-a-repo"));
  write("Code/21Stark/not-a-repo/CLAUDE.md", "# Not a repo\n");
  write("Code/CLAUDE.md", "# Root\n\n- Never commit or push to a default branch directly unless the operator asks.\n");
  write(".claude/projects/-p1/memory/MEMORY.md", "# Memory index\n\n- [Note](note.md) — a hint\n");
  write(".claude/projects/-p1/memory/note.md", "---\nname: note\n---\n\nThe build used to take an hour.\n");
  fs.mkdirSync(path.join(dir, ".claude", "projects", "-p2"));
  return { dir, env: { ...process.env, HOME: dir } };
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
    assert.match(help.stdout, /--playbook/);
    const noPlaybook = run(["--fleet"]);
    assert.equal(noPlaybook.status, 2);
    assert.match(noPlaybook.stderr, /need --playbook/);
    const mixed = run(["--playbook", "--repo", dir, "--always", "a.md"]);
    assert.equal(mixed.status, 2);
    assert.match(mixed.stderr, /do not apply with --playbook/);
    const notRepoPlaybook = run(["--playbook", "--repo", plain]);
    assert.equal(notRepoPlaybook.status, 2);
    assert.match(notRepoPlaybook.stderr, /not inside a git repository/);
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--playbook --repo: a gate phrase is RED with its path:line and exit 3; rules only is GREEN and exit 0", () => {
  const red = repo({ "CLAUDE.md": "# Rules\n\n- Run the tests.\n- This is the operator's call.\n" });
  const green = repo({ "CLAUDE.md": "# Rules\n\n- Run the tests before you push.\n" });
  try {
    const r = run(["--playbook", "--repo", red], red);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stdout, /^RED {5}CLAUDE\.md {2}\d+\/15k chars · GATE 1$/m);
    assert.match(r.stdout, /^ {2}CLAUDE\.md:4 {2}GATE {2}gate words "the operator's call": This is the operator's call\.$/m);
    const g = run(["--playbook"], green);
    assert.equal(g.status, 0, g.stderr);
    assert.match(g.stdout, /^GREEN {3}CLAUDE\.md /m);
    assert.match(g.stdout, /1 agent file: GREEN 1 · YELLOW 0 · RED 0/);
    const json = JSON.parse(run(["--playbook", "--repo", red, "--json"]).stdout);
    assert.deepEqual(json.totals, { GREEN: 0, YELLOW: 0, RED: 1 });
    assert.equal(json.files[0].clauses[0].type, "GATE");
  } finally {
    fs.rmSync(red, { recursive: true, force: true });
    fs.rmSync(green, { recursive: true, force: true });
  }
});

test("--playbook --fleet --memory: each agent file once, in one run, against the root rules", () => {
  const h = home();
  try {
    const fleet = run(["--playbook", "--fleet"], "/", h.env);
    assert.equal(fleet.status, 3, fleet.stderr);
    const lines = (out: string) => out.split("\n").filter((l) => /^(?:GREEN|YELLOW|RED) {2}/.test(l)).map((l) => l.split(/\s+/).slice(0, 2).join(" "));
    // The workspace map is a link into alpha: it is triaged once, by its fleet name.
    assert.deepEqual(lines(fleet.stdout), [
      "GREEN ~/Code/21Stark/CLAUDE.md",
      "RED ~/Code/21Stark/alpha/CLAUDE.md",
      "GREEN ~/Code/21Stark/alpha/skill/s/SKILL.md",
    ]);
    assert.match(fleet.stdout, /alpha\/CLAUDE\.md:3 {2}DUPLICATE {2}a copy of the root rules at ~\/Code\/CLAUDE\.md:3/);
    assert.doesNotMatch(fleet.stdout, /STALE|Stale/);
    const memory = run(["--playbook", "--memory"], "/", h.env);
    assert.equal(memory.status, 3, memory.stderr);
    assert.deepEqual(lines(memory.stdout), [
      "GREEN ~/.claude/projects/-p1/memory/MEMORY.md",
      "RED ~/.claude/projects/-p1/memory/note.md",
    ]);
    assert.match(memory.stdout, /note\.md:5 {2}HISTORY {2}a past habit "used to"/);
    const both = run(["--playbook", "--fleet", "--memory"], "/", h.env);
    assert.equal(both.status, 3, both.stderr);
    assert.deepEqual(lines(both.stdout), [...lines(fleet.stdout), ...lines(memory.stdout)]);
    assert.match(both.stdout, /5 agent files: GREEN 3 · YELLOW 0 · RED 2/);
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

/** HEAD, status and branch of each checkout: a fleet run must leave them as they are. */
const checkoutState = (dirs: string[]) => dirs.map((d) => ["rev-parse HEAD", "status --porcelain", "branch --show-current"]
  .map((cmd) => gitOk(d, ...cmd.split(" "))).join("|"));

test("--playbook --fleet reads each repo at origin/HEAD: behind it, on another branch, or edited; no checkout changes", () => {
  const h = home();
  try {
    const fleet = path.join(h.dir, "Code", "21Stark");
    const alpha = path.join(fleet, "alpha");
    // alpha falls behind: origin drops the copy of the root rules, adds a
    // package file with a gate, and puts a gate in the workspace map, which
    // grows past the start-up budget of each repo below it.
    pushToOrigin(h.dir, path.join(h.dir, "origins", "alpha.git"), {
      "CLAUDE.md": "# Alpha\n\n- Keep each rule short.\n",
      "pkg/CLAUDE.md": "# Pkg\n\n- This is the operator's call.\n",
      "docs/workspace/CLAUDE.md": `# Workspace\n\n- Each repo is the operator's call.\n\n${"w".repeat(41_000)}\n`,
    });
    // An edit in alpha's checkout that is not committed is not read.
    writeAll(alpha, { "skill/s/SKILL.md": "---\nname: s\ndescription: A short skill.\n---\n- Add a rule for each lesson.\n" });
    // beta is on a branch whose gate main does not have.
    const beta = path.join(fleet, "beta");
    gitOk(fleet, "init", "-q", "beta");
    writeAll(beta, { "CLAUDE.md": "# Beta\n\n- Keep it lean.\n" });
    publish(beta, path.join(h.dir, "origins", "beta.git"));
    gitOk(beta, "switch", "-q", "-c", "topic");
    writeAll(beta, { "CLAUDE.md": "# Beta\n\n- Merging is the operator's call.\n" });
    gitOk(beta, "commit", "-q", "-am", "topic");
    // nastrond's buried code under graves/ is left out.
    const nastrond = path.join(fleet, "nastrond");
    gitOk(fleet, "init", "-q", "nastrond");
    writeAll(nastrond, {
      "skill/a/SKILL.md": "---\nname: a\ndescription: A live skill.\n---\n- Do the step.\n",
      "graves/old/skill/b/SKILL.md": "---\nname: b\ndescription: A buried skill.\n---\n- It is the operator's call.\n",
      "graves/old/CLAUDE.md": "# Old\n\n- It is the operator's call.\n",
    });
    publish(nastrond, path.join(h.dir, "origins", "nastrond.git"));
    const before = checkoutState([alpha, beta, nastrond]);

    const r = run(["--playbook", "--fleet", "--json"], "/", h.env);
    assert.equal(r.status, 3, r.stderr);
    const report = JSON.parse(r.stdout) as {
      files: { path: string; flag: string; stale?: string; clauses: { type: string; detail: string }[] }[]; stale: unknown[];
    };
    // The root files are YELLOW for their load set alone: the map above them.
    assert.deepEqual(Object.fromEntries(report.files.map((f) => [f.path, f.flag])), {
      "~/Code/21Stark/CLAUDE.md": "RED",
      "~/Code/21Stark/alpha/CLAUDE.md": "YELLOW",
      "~/Code/21Stark/alpha/pkg/CLAUDE.md": "RED",
      "~/Code/21Stark/alpha/skill/s/SKILL.md": "GREEN",
      "~/Code/21Stark/beta/CLAUDE.md": "YELLOW",
      "~/Code/21Stark/nastrond/skill/a/SKILL.md": "GREEN",
    });
    const alphaRoot = report.files.find((f) => f.path === "~/Code/21Stark/alpha/CLAUDE.md")!;
    assert.deepEqual(alphaRoot.clauses.map((c) => c.type), ["SIZE"]);
    assert.match(alphaRoot.clauses[0].detail, /start-up load set .*~\/Code\/21Stark\/CLAUDE\.md/);
    assert.deepEqual(report.stale, []);
    assert.ok(report.files.every((f) => f.stale === undefined));
    assert.deepEqual(checkoutState([alpha, beta, nastrond]), before);
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("--playbook --fleet: root rules that link into a fleet repo are read at its origin/HEAD and never copy themselves", () => {
  const h = home();
  try {
    const fleet = path.join(h.dir, "Code", "21Stark");
    const rules = path.join(fleet, "rules");
    gitOk(fleet, "init", "-q", "rules");
    writeAll(rules, { "CLAUDE.md": "# Root\n\n- Never commit or push to a default branch directly unless the operator asks.\n" });
    publish(rules, path.join(h.dir, "origins", "rules.git"));
    // The checkout lags a rule that only origin has; gamma copies that rule.
    pushToOrigin(h.dir, path.join(h.dir, "origins", "rules.git"), {
      "CLAUDE.md": "# Root\n\n- Never commit or push to a default branch directly unless the operator asks.\n- Close the ticket the moment the PR merges, and never hold it open for a later check.\n",
    });
    const gamma = path.join(fleet, "gamma");
    gitOk(fleet, "init", "-q", "gamma");
    writeAll(gamma, { "CLAUDE.md": "# Gamma\n\n- Close the ticket the moment the PR merges, and never hold it open for a later check.\n" });
    publish(gamma, path.join(h.dir, "origins", "gamma.git"));
    fs.rmSync(path.join(h.dir, "Code", "CLAUDE.md"));
    fs.symlinkSync("21Stark/rules/CLAUDE.md", path.join(h.dir, "Code", "CLAUDE.md"));

    const r = run(["--playbook", "--fleet"], "/", h.env);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stdout, /^GREEN {3}~\/Code\/21Stark\/rules\/CLAUDE\.md /m);
    assert.match(r.stdout, /gamma\/CLAUDE\.md:3 {2}DUPLICATE {2}a copy of the root rules at ~\/Code\/21Stark\/rules\/CLAUDE\.md:4/);
    assert.match(r.stdout, /alpha\/CLAUDE\.md:3 {2}DUPLICATE {2}a copy of the root rules at ~\/Code\/21Stark\/rules\/CLAUDE\.md:3/);
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test("--playbook --fleet: a repo that fails its fetch, or has no origin/HEAD, is read from its checkout and marked stale; the run goes on", () => {
  const h = home();
  const bin = fakeBin();
  try {
    const fleet = path.join(h.dir, "Code", "21Stark");
    const gamma = path.join(fleet, "gamma");
    gitOk(fleet, "init", "-q", "gamma");
    writeAll(gamma, { "CLAUDE.md": "# Gamma\n\n- This is the operator's call.\n" });
    gitOk(gamma, "remote", "add", "origin", path.join(h.dir, "origins", "missing.git"));
    const delta = path.join(fleet, "delta");
    gitOk(fleet, "init", "-q", "delta");
    writeAll(delta, { "CLAUDE.md": "# Delta\n\n- Keep it lean.\n" });
    publish(delta, path.join(h.dir, "origins", "delta.git"), true);

    const text = run(["--playbook", "--fleet"], "/", h.env);
    assert.equal(text.status, 3, text.stderr);
    assert.match(text.stdout, /^RED {5}~\/Code\/21Stark\/gamma\/CLAUDE\.md {2}\S+ chars · GATE 1 · STALE$/m);
    assert.match(text.stdout, /^GREEN {3}~\/Code\/21Stark\/delta\/CLAUDE\.md {2}\S+ chars · STALE$/m);
    assert.match(text.stdout, /^RED {5}~\/Code\/21Stark\/alpha\/CLAUDE\.md {2}\S+ chars · DUPLICATE 1$/m);
    const stale = text.stdout.split("\n\n").find((b) => b.startsWith("Stale"))!.split("\n");
    assert.equal(stale[0], "Stale, read from the checkout, not origin/HEAD:");
    assert.equal(stale[1], "  ~/Code/21Stark/delta  origin/HEAD is not set");
    assert.match(stale[2], /^ {2}~\/Code\/21Stark\/gamma {2}git fetch failed: fatal: .*missing\.git/);
    assert.equal(stale.length, 3);

    const json = JSON.parse(run(["--playbook", "--fleet", "--json"], "/", h.env).stdout) as {
      files: { path: string; stale?: string }[]; stale: { repo: string; reason: string }[];
    };
    const staleOf = Object.fromEntries(json.files.map((f) => [f.path, f.stale]));
    assert.equal(staleOf["~/Code/21Stark/delta/CLAUDE.md"], "origin/HEAD is not set");
    assert.match(staleOf["~/Code/21Stark/gamma/CLAUDE.md"]!, /^git fetch failed: /);
    assert.equal(staleOf["~/Code/21Stark/alpha/CLAUDE.md"], undefined);
    assert.deepEqual(json.stale.map((s) => s.repo), ["~/Code/21Stark/delta", "~/Code/21Stark/gamma"]);

    const notify = run(["--playbook", "--fleet", "--notify"], "/", bin.env({ HOME: h.dir }));
    assert.equal(notify.status, 3, notify.stderr);
    const body = bin.calls().at(-1)![3].split("\n");
    assert.deepEqual(body.slice(1, 3), ["Stale, read from the checkout, not origin/HEAD (2):", "- ~/Code/21Stark/delta: origin/HEAD is not set"]);
    assert.match(body[3], /^- ~\/Code\/21Stark\/gamma: git fetch failed: /);
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
    fs.rmSync(bin.dir, { recursive: true, force: true });
  }
});

test("originView lists, reads and resolves a tree at origin/HEAD as the disk walk does for the same checkout", () => {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-origin-")));
  try {
    const dir = path.join(top, "r");
    gitOk(top, "init", "-q", "r");
    fs.writeFileSync(path.join(top, "outside.md"), "# Outside\n");
    writeAll(dir, {
      "CLAUDE.md": "# R\n\n- A rule.\n",
      ".claude/rules/a.md": "- Rule a.\n",
      "shared/rules/b.md": "- Rule b.\n",
      "other/rules/c.md": "- Rule c.\n",
      "docs/x.md": "# X\n",
      "node_modules/p/CLAUDE.md": "# Pruned\n",
      "vendor/modules.txt": "# go vendor\n",
      "vendor/m/CLAUDE.md": "# Pruned\n",
      "pkg/vendor/n/CLAUDE.md": "# Kept: no modules.txt\n",
    });
    fs.symlinkSync("CLAUDE.md", path.join(dir, "AGENTS.md"));
    fs.symlinkSync("../../shared/rules", path.join(dir, ".claude", "rules", "shared"));
    // A target that ends in `/`, and an absolute link into the checkout.
    fs.symlinkSync("../../other/rules/", path.join(dir, ".claude", "rules", "other"));
    fs.symlinkSync(path.join(dir, "CLAUDE.md"), path.join(dir, "ABS.md"));
    fs.symlinkSync("docs", path.join(dir, "docs-link"));
    fs.symlinkSync("../outside.md", path.join(dir, "out.md"));
    fs.symlinkSync("loop2", path.join(dir, "loop1"));
    fs.symlinkSync("loop1", path.join(dir, "loop2"));
    fs.symlinkSync("nope.md", path.join(dir, "dangling.md"));
    publish(dir, path.join(top, "r.git"));
    // An edit that is not committed: the disk walk reads it, origin does not.
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# R\n\n- An edit.\n");

    const o = originView(dir);
    const disk = buildView(dir);
    assert.deepEqual(o.files, disk.files);
    assert.ok(o.files.includes(".claude/rules/shared/b.md") && o.files.includes("AGENTS.md"));
    assert.ok(o.files.includes(".claude/rules/other/c.md") && o.files.includes("ABS.md"));
    assert.equal(o.resolve("ABS.md"), "CLAUDE.md");
    assert.ok(!o.files.some((f) => /node_modules|^vendor|out\.md|loop|dangling/.test(f)));
    assert.equal(o.read("CLAUDE.md"), "# R\n\n- A rule.\n");
    assert.equal(o.read("AGENTS.md"), "# R\n\n- A rule.\n");
    assert.equal(o.read(".claude/rules/shared/b.md"), "- Rule b.\n");
    assert.equal(o.read("docs-link/x.md"), "# X\n");
    assert.equal(o.read("out.md"), null);
    for (const rel of ["docs", "docs/", "docs-link/x.md", ".claude/rules", "node_modules/p/CLAUDE.md", "", "./docs/x.md"]) {
      assert.equal(o.exists(rel), true, rel);
      assert.equal(disk.exists(rel), true, rel);
    }
    for (const rel of ["nope.md", "dangling.md", "loop1", "docs/y.md"]) assert.equal(o.exists(rel), false, rel);
    assert.equal(o.resolve("AGENTS.md"), "CLAUDE.md");
    assert.equal(o.resolve(".claude/rules/shared/b.md"), "shared/rules/b.md");
    assert.equal(o.resolve("loop1"), null);
    assert.equal(o.resolve("out.md"), null);
    assert.ok(o.isLink("AGENTS.md") && !o.isLink("CLAUDE.md"));
    assert.equal(o.claudeFamilyAbove, true);
    assert.deepEqual([...o.ignored], []);
    gitOk(dir, "remote", "set-head", "origin", "-d");
    assert.throws(() => originView(dir), /origin\/HEAD is not set/);
  } finally {
    fs.rmSync(top, { recursive: true, force: true });
  }
});

test("--playbook: the load set adds the CLAUDE.md files above a repo, up to a folder in a git work tree", () => {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-above-")));
  const write = (rel: string, c: string, n: number) => {
    fs.mkdirSync(path.dirname(path.join(top, rel)), { recursive: true });
    fs.writeFileSync(path.join(top, rel), `${c.repeat(n)}\n`);
  };
  for (const r of ["r", "g", "g/w"]) assert.equal(spawnSync("git", ["init", "-q", path.join(top, r)]).status, 0);
  write("CLAUDE.md", "a", 30_000); // above every repo here, in no work tree
  write("r/CLAUDE.md", "b", 12_000); // 42k with the file above
  write("g/CLAUDE.md", "c", 5_000); // above w, but in g's work tree: not w's
  write("g/w/CLAUDE.md", "d", 9_000); // 39k without g's file
  const env = { ...process.env, HOME: top };
  try {
    const load = (repoDir: string) => {
      const r = run(["--playbook", "--repo", path.join(top, repoDir), "--json"], "/", env);
      return (JSON.parse(r.stdout).files[0].clauses as { detail: string; text: string }[]).filter((c) => /load set/.test(c.detail));
    };
    const [r] = load("r");
    assert.equal(r.text, "42k chars in 2 files");
    assert.match(r.detail, /\(~\/r\/CLAUDE\.md, ~\/CLAUDE\.md\)$/);
    assert.deepEqual(load("g/w"), []);
  } finally {
    fs.rmSync(top, { recursive: true, force: true });
  }
});

test("--playbook --files: repo and memory files by name; a non-agent or missing file is refused", () => {
  const h = home();
  try {
    const alpha = path.join(h.dir, "Code", "21Stark", "alpha");
    const note = path.join(h.dir, ".claude", "projects", "-p1", "memory", "note.md");
    const r = run(["--playbook", "--files", `skill/s/SKILL.md,${note}`], alpha, h.env);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stdout, /^GREEN {3}skill\/s\/SKILL\.md /m);
    assert.match(r.stdout, /^RED {5}~\/\.claude\/projects\/-p1\/memory\/note\.md /m);
    assert.match(r.stdout, /2 agent files/);
    fs.writeFileSync(path.join(alpha, "README.md"), "# Readme\n");
    const notAgent = run(["--playbook", "--files", "README.md"], alpha, h.env);
    assert.equal(notAgent.status, 2);
    assert.match(notAgent.stderr, /README\.md is not an agent file/);
    const missing = run(["--playbook", "--files", "nope/CLAUDE.md"], alpha, h.env);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /nope\/CLAUDE\.md: no such file/);
    const outside = run(["--playbook", "--files", path.join(h.dir, "Code", "CLAUDE.md")], alpha, h.env);
    assert.equal(outside.status, 2);
    assert.match(outside.stderr, /in no git repository and no memory folder/);
  } finally {
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

/** Stand-ins for `heimdall` and `launchctl`, first on PATH: each records its
 *  name and argv as one JSON line, and exits with its code. */
function fakeBin(codes: { heimdall?: number; launchctl?: number } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-bin-")));
  const log = path.join(dir, "calls.jsonl");
  for (const name of ["heimdall", "launchctl"] as const) {
    fs.writeFileSync(path.join(dir, name), [
      `#!${process.execPath}`,
      `require("node:fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify([${JSON.stringify(name)}, ...process.argv.slice(2)]) + "\\n");`,
      `process.exit(${codes[name] ?? 0});`,
    ].join("\n"), { mode: 0o755 });
  }
  return {
    dir,
    env: (extra: NodeJS.ProcessEnv = {}) => ({ ...process.env, ...extra, PATH: `${dir}${path.delimiter}${process.env.PATH}` }),
    calls: (): string[][] => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []),
  };
}

test("--playbook --notify: one heimdall send with the summary; the exit stays the triage's; a failed send exits 1", () => {
  const red = repo({ "CLAUDE.md": "# Rules\n\n- This is the operator's call.\n" });
  const ok = fakeBin();
  const bad = fakeBin({ heimdall: 4 });
  // A bare home: no root rules of the machine change the triage.
  const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-home-")));
  const title = "Agent-doc sweep: RED 1 · YELLOW 0 · GREEN 0";
  try {
    const r = run(["--playbook", "--notify"], red, ok.env({ HOME: bare }));
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stdout, /^RED {5}CLAUDE\.md /m);
    assert.ok(r.stdout.endsWith(`notified: ${title}\n`), r.stdout);
    assert.deepEqual(ok.calls(), [["heimdall", "send", "--body", "1 agent file.\nRED files (1):\n- CLAUDE.md: 1 RED (GATE 1)", "--", title]]);
    // With --json, stdout stays the JSON report alone.
    const json = run(["--playbook", "--notify", "--json"], red, ok.env({ HOME: bare }));
    assert.equal(json.status, 3, json.stderr);
    assert.deepEqual(JSON.parse(json.stdout).totals, { GREEN: 0, YELLOW: 0, RED: 1 });
    assert.match(json.stderr, /^notified: /m);
    assert.equal(ok.calls().length, 2);
    // A triage that fails still sends a push, so the weekly job does not fail in silence.
    const broken = run(["--playbook", "--fleet", "--notify"], red, ok.env({ HOME: bare }));
    assert.equal(broken.status, 2, broken.stderr);
    assert.deepEqual(ok.calls().at(-1), ["heimdall", "send", "--body", `no fleet folder at ${path.join(bare, "Code", "21Stark")}`, "--", "Agent-doc sweep failed"]);
    const failed = run(["--playbook", "--notify"], red, bad.env({ HOME: bare }));
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /heimdall send failed \(exit 4\)/);
  } finally {
    for (const d of [red, ok.dir, bad.dir, bare]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test("--notify, --settings, --save, --since and --self-update need --playbook; --self-update needs --fleet", () => {
  const bin = fakeBin();
  try {
    for (const [args, re] of [
      [["--notify"], /--notify needs --playbook/],
      [["--since", "/tmp/x.json", "--save", "/tmp/x.json"], /--save, --since need --playbook/],
      [["--settings"], /--settings needs --playbook/],
      [["--playbook", "--self-update"], /--self-update needs --fleet/],
    ] as const) {
      const r = run([...args], os.tmpdir(), bin.env({}));
      assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
      assert.match(r.stderr, re);
    }
    assert.deepEqual(bin.calls(), [], "a refused run calls no heimdall");
  } finally {
    fs.rmSync(bin.dir, { recursive: true, force: true });
  }
});

test("the schedule flags are gone: --install-schedule and --uninstall-schedule are unknown", () => {
  for (const flag of ["--install-schedule", "--uninstall-schedule"]) {
    const r = run([flag]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /unknown/i);
    assert.match(r.stderr, new RegExp(flag));
  }
});

/** A report of one file with these RED clauses. */
function report(file: string, clauses: Partial<SavedReport["files"][number]["clauses"][number]>[], extra: Partial<SavedReport> = {}): SavedReport {
  const full = clauses.map((c) => ({ flag: "RED" as const, type: "GATE" as const, line: 1, text: "t", detail: "d", ...c }));
  return {
    files: [{ path: file, kind: "root", chars: 10, budget: 15000, flag: full.length ? "RED" : "GREEN", clauses: full }],
    totals: { GREEN: full.length ? 0 : 1, YELLOW: 0, RED: full.length ? 1 : 0 }, stale: [], ...extra,
  };
}

test("sinceDiff: a new RED clause is new with its lines around it, a gone one is gone, a moved one is neither", () => {
  const text = "a\nb\nc\nnew gate\ne\nf\n";
  const base = report("/r/CLAUDE.md", [{ line: 2, text: "kept gate" }, { line: 3, text: "old gate" }]);
  const head = report("/r/CLAUDE.md", [{ line: 9, text: "kept gate" }, { line: 4, text: "new gate" }]);
  const d = sinceDiff("s.json", base, head, () => text);
  assert.deepEqual(d.new.map((c) => c.text), ["new gate"]);
  assert.deepEqual(d.new[0].context, ["     2  b", "     3  c", ">    4  new gate", "     5  e", "     6  f"]);
  assert.deepEqual(d.gone.map((c) => c.text), ["old gate"]);
  assert.equal(d.gone[0].context, undefined);
  assert.match(formatSince(d), /New RED clauses \(1\):\n {2}\/r\/CLAUDE\.md:4 {2}GATE {2}d: new gate\n {9}2 {2}b/);
  assert.match(formatSince(d), /Gone RED clauses \(1\):\n {2}\/r\/CLAUDE\.md:3 {2}GATE {2}d: old gate/);
});

test("sinceDiff: a SIZE clause that shrinks is neither new nor gone; one that grows is new", () => {
  const size = (chars: number) => ({ type: "SIZE" as const, text: `${chars} chars`, chars, measure: "core" as const });
  const base = report("/r/CLAUDE.md", [size(40000)]);
  const shrunk = sinceDiff("s", base, report("/r/CLAUDE.md", [size(35000)]), () => null);
  assert.deepEqual([shrunk.new.length, shrunk.gone.length], [0, 0]);
  const grown = sinceDiff("s", base, report("/r/CLAUDE.md", [size(45000)]), () => null);
  assert.equal(grown.new.length, 1);
  assert.match(grown.new[0].detail, /grown from 40000 to 45000 chars/);
  assert.equal(grown.gone.length, 0);
  assert.equal(grown.new[0].context, undefined, "a whole-file SIZE clause has no lines to show");
});

test("sinceDiff prints each settings value that changed", () => {
  const base = report("/r/CLAUDE.md", [], { settings: { model: "opus", effortLevel: "high" } });
  const head = report("/r/CLAUDE.md", [], { settings: { model: "opus", effortLevel: "xhigh", modelSettings: { a: 1 } } });
  const d = sinceDiff("s", base, head, () => null);
  assert.deepEqual(d.settings, [{ key: "effortLevel", from: "high", to: "xhigh" }, { key: "modelSettings", from: undefined, to: { a: 1 } }]);
  assert.match(formatSince(d), /Settings changed:\n {2}effortLevel: "high" → "xhigh"\n {2}modelSettings: \(unset\) → \{"a":1\}/);
});

test("readModelSettings reads three keys from $CLAUDE_CONFIG_DIR, else ~/.claude; none for a missing file", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-settings-")));
  try {
    writeAll(dir, {
      "cfg/settings.json": JSON.stringify({ model: "opus", effortLevel: "xhigh", modelSettings: { x: 1 }, theme: "dark" }),
      ".claude/settings.json": JSON.stringify({ model: "sonnet" }),
    });
    assert.deepEqual(readModelSettings({ CLAUDE_CONFIG_DIR: path.join(dir, "cfg") }, dir), { effortLevel: "xhigh", model: "opus", modelSettings: { x: 1 } });
    assert.deepEqual(readModelSettings({}, dir), { model: "sonnet" });
    assert.deepEqual(readModelSettings({}, path.join(dir, "none")), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadSaved resolves a relative or ~ path of an older report; a missing or bad file gives the reason", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-saved-")));
  try {
    writeAll(dir, { "repo/CLAUDE.md": "x", "old.json": JSON.stringify(report("repo/CLAUDE.md", [])), "bad.json": "{", "odd.json": "{\"files\":1}" });
    const old = loadSaved(path.join(dir, "old.json"), dir, "/h");
    assert.ok("report" in old);
    assert.equal(old.report.files[0].path, path.join(dir, "repo", "CLAUDE.md"));
    assert.equal(absolutePath("~/x/CLAUDE.md", dir, "/h"), "/h/x/CLAUDE.md");
    assert.deepEqual(loadSaved(path.join(dir, "none.json")), { reason: "no saved run" });
    assert.deepEqual(loadSaved(path.join(dir, "bad.json")), { reason: "it does not parse as JSON" });
    assert.deepEqual(loadSaved(path.join(dir, "odd.json")), { reason: "it is not a --json triage report" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fitSince keeps the totals and the first new clauses under the limit, and counts the rest", () => {
  const many = Array.from({ length: 2000 }, (_, i) => ({ line: i + 1, text: `gate number ${i} ${"x".repeat(40)}` }));
  const d = sinceDiff("s", report("/r/CLAUDE.md", []), report("/r/CLAUDE.md", many), () => "line\n".repeat(3000));
  assert.equal(d.new.length, 2000);
  for (const render of [formatSince, (x: SinceDiff) => JSON.stringify(x, null, 2)]) {
    const out = fitSince(d, render);
    assert.ok(out.length < SINCE_MAX_CHARS, `${out.length} chars`);
    assert.match(out, /RED/);
    assert.match(out, /gate number 0 /);
    const left = render === formatSince ? Number(/\+(\d+) new RED clauses left out/.exec(out)?.[1]) : JSON.parse(out).omitted.new;
    assert.ok(left > 0 && left < 2000, String(left));
    assert.ok(!out.includes(`gate number ${2000 - left} `), "the first clauses stay, the last go");
  }
  assert.equal(contextLines(null, 3).length, 0);
});

test("--save then --commit then --since on one file: no new RED and exit 0; an added RED is new and exit 3; a missing or bad file is the base", () => {
  const dir = repo({ "CLAUDE.md": "# Rules\n\n- Run the tests.\n- This is the operator's call.\n" });
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-home-")));
  const env = { ...process.env, HOME: h, CLAUDE_CONFIG_DIR: path.join(h, "cfg") };
  writeAll(h, { "cfg/settings.json": JSON.stringify({ model: "opus" }) });
  const saved = path.join(h, "new", "folder", "run.json");
  try {
    const first = run(["--playbook", "--settings", "--json", "--save", saved, "--since", saved], dir, env);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).reason, "no saved run: this run is the base");
    assert.deepEqual(fs.readdirSync(path.dirname(saved)), ["run.json.pending"], "--save writes only the pending file, and no temp file is left");
    const file = JSON.parse(fs.readFileSync(`${saved}.pending`, "utf8"));
    assert.equal(file.files[0].path, path.join(dir, "CLAUDE.md"));
    assert.deepEqual(file.settings, { model: "opus" });
    const committed = run(["--commit", saved], dir, env);
    assert.equal(committed.status, 0, committed.stderr);
    assert.equal(committed.stdout, `committed ${saved}.pending over ${saved}: the next --since compares with it\n`);
    assert.deepEqual(fs.readdirSync(path.dirname(saved)), ["run.json"]);

    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Rules\n\n- A line.\n- Run the tests.\n- This is the operator's call.\n");
    const same = run(["--playbook", "--settings", "--save", saved, "--since", saved], dir, env);
    assert.equal(same.status, 0, same.stderr);
    assert.match(same.stdout, /No new RED clause\./);
    assert.doesNotMatch(same.stdout, /Gone RED/, "a moved clause is not gone");
    assert.equal(run(["--commit", saved], dir, env).status, 0);

    fs.appendFileSync(path.join(dir, "CLAUDE.md"), "- Wait for the operator's word.\n- After.\n");
    writeAll(h, { "cfg/settings.json": JSON.stringify({ model: "sonnet" }) });
    const added = run(["--playbook", "--settings", "--since", saved], dir, env);
    assert.equal(added.status, 3, added.stderr);
    assert.match(added.stdout, /New RED clauses \(1\):\n {2}CLAUDE\.md:6 {2}GATE .*\n {9}4 {2}- Run the tests\.\n.*\n {4}> {4}6 {2}- Wait for the operator's word\.\n {9}7 {2}- After\./);
    assert.match(added.stdout, /before: RED 1 · YELLOW 0 · GREEN 0\n {2}now: {4}RED 1/);
    assert.match(added.stdout, /Settings changed:\n {2}model: "opus" → "sonnet"/);

    fs.writeFileSync(saved, "not json");
    const bad = run(["--playbook", "--since", saved], dir, env);
    assert.equal(bad.status, 0, bad.stderr);
    assert.match(bad.stdout, /it does not parse as JSON: this run is the base\n {2}now: RED 1/);
  } finally {
    for (const d of [dir, h]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test("a run with no --commit moves no base: the next run names the same new RED clause again", () => {
  const dir = repo({ "CLAUDE.md": "# Rules\n\n- Run the tests.\n" });
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-home-")));
  const env = { ...process.env, HOME: h };
  const saved = path.join(h, "run.json");
  try {
    assert.equal(run(["--playbook", "--save", saved], dir, env).status, 0);
    assert.equal(run(["--commit", saved], dir, env).status, 0);
    const base = fs.readFileSync(saved, "utf8");

    fs.appendFileSync(path.join(dir, "CLAUDE.md"), "- Wait for the operator's word.\n");
    for (const n of [1, 2]) {
      const r = run(["--playbook", "--save", saved, "--since", saved], dir, env);
      assert.equal(r.status, 3, `run ${n}: ${r.stderr}`);
      assert.match(r.stdout, /New RED clauses \(1\):\n {2}CLAUDE\.md:4 {2}GATE/, `run ${n}`);
      assert.equal(fs.readFileSync(saved, "utf8"), base, `run ${n} left the base as it was`);
    }

    assert.equal(run(["--commit", saved], dir, env).status, 0);
    assert.notEqual(fs.readFileSync(saved, "utf8"), base, "--commit moved the base");
    const after = run(["--playbook", "--save", saved, "--since", saved], dir, env);
    assert.equal(after.status, 0, after.stderr);
    assert.match(after.stdout, /No new RED clause\./);
  } finally {
    for (const d of [dir, h]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test("--commit with no pending report changes nothing and exits 0; a failed triage deletes an old pending report", () => {
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-home-")));
  const saved = path.join(h, "run.json");
  try {
    fs.writeFileSync(saved, "base");
    const none = run(["--commit", saved]);
    assert.equal(none.status, 0, none.stderr);
    assert.equal(none.stdout, `nothing to commit: no ${saved}.pending; ${saved} stays the base\n`);
    assert.equal(fs.readFileSync(saved, "utf8"), "base");
    assert.equal(run(["--commit", path.join(h, "no", "folder", "run.json")]).status, 0, "a missing folder is nothing to commit");

    fs.writeFileSync(`${saved}.pending`, "an old report");
    const failed = run(["--playbook", "--files", path.join(h, "missing.md"), "--save", saved], h, { ...process.env, HOME: h });
    assert.equal(failed.status, 2, failed.stderr);
    assert.match(failed.stderr, /^rules_audit: --save: deleted .*run\.json\.pending, which no --commit moved to the base\n/, "an uncommitted report is named");
    assert.equal(fs.existsSync(`${saved}.pending`), false, "a triage that fails leaves no report to commit");
    assert.equal(run(["--commit", saved]).status, 0);
    assert.equal(fs.readFileSync(saved, "utf8"), "base");

    fs.mkdirSync(`${saved}.pending`);
    fs.writeFileSync(path.join(`${saved}.pending`, "x"), "");
    const broken = run(["--commit", saved]);
    assert.equal(broken.status, 1, broken.stdout);
    assert.match(broken.stderr, /^rules_audit: --commit: /);
    assert.equal(fs.readFileSync(saved, "utf8"), "base");
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test("--commit takes no other flag", () => {
  for (const args of [["--commit", "/tmp/x.json", "--playbook"], ["--playbook", "--save", "/tmp/x.json", "--commit", "/tmp/x.json"], ["--commit", "/tmp/x.json", "--json"]]) {
    const r = run(args);
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
    assert.match(r.stderr, /--commit takes no other flag: --/);
  }
  assert.match(run(["--commit"]).stderr, /--commit requires a value/);
});

/** A checkout of a copy of the tools on `main`, with a bare origin, and a home with an empty fleet. */
function selfUpdateFixture(): { top: string; bare: string; h: string; tool: string } {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-self-")));
  fs.cpSync(import.meta.dirname, path.join(top, "tools"), {
    recursive: true, filter: (src) => !src.includes("node_modules") && (fs.statSync(src).isDirectory() || src.endsWith(".ts")),
  });
  gitOk(top, "init", "-q");
  const bare = `${top}.git`;
  publish(top, bare);
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-home-")));
  fs.mkdirSync(path.join(h, "Code", "21Stark"), { recursive: true });
  return { top, bare, h, tool: path.join(top, "tools", "rules_audit.ts") };
}

test("--self-update fast-forwards a clean main and runs the new code; a changed or non-main checkout is stale and stays", () => {
  const f = selfUpdateFixture();
  const env = { ...process.env, HOME: f.h, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const selfRun = () => spawnSync(process.execPath, ["--no-warnings", f.tool, "--playbook", "--fleet", "--json", "--self-update"], { cwd: f.h, encoding: "utf8", env });
  try {
    const up = fs.mkdtempSync(path.join(f.h, "up-"));
    gitOk(f.h, "clone", "-q", f.bare, up);
    gitOk(up, "commit", "-q", "--allow-empty", "-m", "moves on");
    gitOk(up, "push", "-q", "origin", "HEAD");
    const tip = gitOk(up, "rev-parse", "HEAD").trim();

    const clean = selfRun();
    assert.equal(clean.status, 0, clean.stderr);
    assert.equal(gitOk(f.top, "rev-parse", "HEAD").trim(), tip);
    assert.match(clean.stderr, /self-update moved \w+ to \w+; running the new code/);
    assert.deepEqual(JSON.parse(clean.stdout).stale, []);

    gitOk(up, "commit", "-q", "--allow-empty", "-m", "again");
    gitOk(up, "push", "-q", "origin", "HEAD");
    fs.appendFileSync(path.join(f.top, "tools", "cli_args_lib.ts"), "\n");
    const changed = selfRun();
    assert.equal(changed.status, 0, changed.stderr);
    assert.equal(gitOk(f.top, "rev-parse", "HEAD").trim(), tip);
    assert.match(JSON.parse(changed.stdout).stale[0].reason, /self-update: main has local changes/);
    gitOk(f.top, "checkout", "-q", "--", ".");

    gitOk(f.top, "checkout", "-q", "-b", "feature");
    const branch = selfRun();
    assert.equal(branch.status, 0, branch.stderr);
    assert.equal(gitOk(f.top, "rev-parse", "HEAD").trim(), tip);
    assert.match(JSON.parse(branch.stdout).stale[0].reason, /self-update: on feature, not main/);
  } finally {
    for (const d of [f.top, f.bare, f.h]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test("selfUpdate leaves a repo alone that only holds an untracked copy of the tools", () => {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-other-")));
  try {
    writeAll(top, { "README.md": "x", "cache/tools/rules_audit.ts": "// copy" });
    gitOk(top, "init", "-q");
    gitOk(top, "add", "README.md");
    gitOk(top, "commit", "-q", "-m", "seed");
    const head = gitOk(top, "rev-parse", "HEAD");
    const u = selfUpdate(path.join(top, "cache", "tools"));
    assert.equal(u.updated, false);
    assert.match(u.updated ? "" : u.stale?.reason ?? "", /self-update: cache\/tools\/rules_audit\.ts is not tracked/);
    assert.equal(gitOk(top, "rev-parse", "HEAD"), head);
  } finally {
    fs.rmSync(top, { recursive: true, force: true });
  }
});
