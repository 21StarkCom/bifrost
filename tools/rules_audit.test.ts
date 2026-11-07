// rules_audit CLI over a real temporary git repo: the disk walk, the pruning,
// the gitignore labels, and the exit-code contract.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { SWEEP_LABEL, sweepPlist } from "./rules_audit.ts";

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

/** A home with a fleet folder of one repo, the root rules, and one memory folder. */
function home(): { dir: string; env: NodeJS.ProcessEnv } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-home-")));
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const fleet = path.join(dir, "Code", "21Stark");
  fs.mkdirSync(fleet, { recursive: true });
  assert.equal(spawnSync("git", ["init", "-q", path.join(fleet, "alpha")]).status, 0);
  write("Code/21Stark/alpha/CLAUDE.md", "# Alpha\n\n- Never commit or push to a default branch directly unless the operator asks.\n");
  write("Code/21Stark/alpha/docs/workspace/CLAUDE.md", "# Workspace\n\n- One clone per repo.\n");
  write("Code/21Stark/alpha/skill/s/SKILL.md", "---\nname: s\ndescription: A short skill.\n---\n- Do the step.\n");
  fs.symlinkSync("CLAUDE.md", path.join(fleet, "alpha", "AGENTS.md"));
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
  const title = "Agent-doc sweep: RED 1 · YELLOW 0 · GREEN 0";
  try {
    const r = run(["--playbook", "--notify"], red, ok.env());
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stdout, /^RED {5}CLAUDE\.md /m);
    assert.ok(r.stdout.endsWith(`notified: ${title}\n`), r.stdout);
    assert.deepEqual(ok.calls(), [["heimdall", "send", "--body", "1 agent file.\nRED files (1):\n- CLAUDE.md: 1 RED (GATE 1)", "--", title]]);
    // With --json, stdout stays the JSON report alone.
    const json = run(["--playbook", "--notify", "--json"], red, ok.env());
    assert.equal(json.status, 3, json.stderr);
    assert.deepEqual(JSON.parse(json.stdout).totals, { GREEN: 0, YELLOW: 0, RED: 1 });
    assert.match(json.stderr, /^notified: /m);
    assert.equal(ok.calls().length, 2);
    const failed = run(["--playbook", "--notify"], red, bad.env());
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /heimdall send failed \(exit 4\)/);
  } finally {
    for (const d of [red, ok.dir, bad.dir]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test("--notify needs --playbook; a schedule flag takes no other argument", () => {
  const bin = fakeBin();
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-home-")));
  try {
    const env = bin.env({ HOME: home, STARK_STATE_ROOT: path.join(home, "state") });
    for (const [args, re] of [
      [["--notify"], /--notify needs --playbook/],
      [["--install-schedule", "--notify"], /--install-schedule takes no other argument/],
      [["--uninstall-schedule", "--playbook"], /--uninstall-schedule takes no other argument/],
    ] as const) {
      const r = run([...args], os.tmpdir(), env);
      assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
      assert.match(r.stderr, re);
    }
    assert.deepEqual(bin.calls(), [], "a refused run calls neither heimdall nor launchctl");
  } finally {
    fs.rmSync(bin.dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the sweep's plist runs --playbook --fleet --memory --notify on Mondays at 09:00 through env node", () => {
  const p = sweepPlist("/x/tools/rules_audit.ts", "/s/agent-doc-sweep/weekly.log", "/opt/homebrew/bin:/usr/bin");
  assert.match(p, new RegExp(`<key>Label</key><string>${SWEEP_LABEL}</string>`));
  assert.match(p, /<string>\/usr\/bin\/env<\/string>\s*<string>node<\/string>\s*<string>\/x\/tools\/rules_audit\.ts<\/string>\s*<string>--playbook<\/string>\s*<string>--fleet<\/string>\s*<string>--memory<\/string>\s*<string>--notify<\/string>\s*<\/array>/);
  assert.match(p, /<key>Weekday<\/key><integer>1<\/integer><key>Hour<\/key><integer>9<\/integer><key>Minute<\/key><integer>0<\/integer>/);
  assert.match(p, /<key>StandardOutPath<\/key><string>\/s\/agent-doc-sweep\/weekly\.log<\/string>/);
  assert.match(p, /<key>PATH<\/key><string>\/opt\/homebrew\/bin:\/usr\/bin<\/string>/);
});

test("--install-schedule writes the plist and loads it; --uninstall-schedule unloads it and removes it", { skip: process.platform !== "darwin" && "launchd is macOS only" }, () => {
  const bin = fakeBin();
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-audit-home-")));
  try {
    const env = bin.env({ HOME: home, STARK_STATE_ROOT: path.join(home, "state") });
    const plist = path.join(home, "Library", "LaunchAgents", `${SWEEP_LABEL}.plist`);
    const domain = `gui/${process.getuid!()}`;
    const install = run(["--install-schedule"], os.tmpdir(), env);
    assert.equal(install.status, 0, install.stderr);
    assert.match(install.stdout, new RegExp(`loaded ${domain}/${SWEEP_LABEL}: Mondays 09:00 local, output to ${path.join(home, "state", "agent-doc-sweep", "weekly.log")}`));
    // With no ~/.claude/code-review/tools link, the job runs this file.
    assert.match(fs.readFileSync(plist, "utf8"), new RegExp(`<string>${CLI}</string>`));
    assert.ok(fs.statSync(path.join(home, "state", "agent-doc-sweep")).isDirectory());
    assert.deepEqual(bin.calls(), [["launchctl", "bootout", `${domain}/${SWEEP_LABEL}`], ["launchctl", "bootstrap", domain, plist]]);
    const uninstall = run(["--uninstall-schedule"], os.tmpdir(), env);
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.match(uninstall.stdout, new RegExp(`unloaded ${domain}/${SWEEP_LABEL}\nremoved ${plist}`));
    assert.equal(fs.existsSync(plist), false);
    assert.deepEqual(bin.calls().at(-1), ["launchctl", "bootout", `${domain}/${SWEEP_LABEL}`]);
  } finally {
    fs.rmSync(bin.dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
