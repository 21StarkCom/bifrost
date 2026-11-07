// rules_gate_hook: the command parser and the output shapes as units, then the
// hook end to end: a PreToolUse payload on stdin, a real git repo, a fake `gh`
// on PATH, a throwaway HOME (so no ~/Code/CLAUDE.md joins the triage), and what
// Claude Code reads on stdout.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BUDGET_MS, findMerges, render, shellCommands, timeLeft } from "./rules_gate_hook.ts";

const HOOK = path.join(import.meta.dirname, "rules_gate_hook.ts");
const RED_LINE = "This is the operator's call.\n";
const CLEAN = "# Repo\n\nRun `npm test` before you push.\n";

test("shellCommands splits at operators and resolves quotes", () => {
  assert.deepEqual(shellCommands(`git push && njord pr-merge 12; echo "a b" 'c;d' e\\ f # njord pr-merge 9`), [
    ["git", "push"],
    ["njord", "pr-merge", "12"],
    ["echo", "a b", "c;d", "e f"],
  ]);
  assert.deepEqual(shellCommands(`njord pr-merge --force-reason "fix \\"12\\" now" | tee x`), [
    ["njord", "pr-merge", "--force-reason", 'fix "12" now'],
    ["tee", "x"],
  ]);
});

test("findMerges reads the PR, skips option values, and follows cd", () => {
  const at = (pr: number | null, cwd = "/r", help = false) => ({ cwd, pr, help });
  assert.deepEqual(findMerges("njord pr-merge", "/r"), [at(null)]);
  assert.deepEqual(findMerges("njord pr-merge 412 --skip-changelog", "/r"), [at(412)]);
  assert.deepEqual(findMerges("njord pr-merge --pr 7", "/r"), [at(7)]);
  assert.deepEqual(findMerges("njord pr-merge --watch-timeout 2", "/r"), [at(null)]);
  assert.deepEqual(findMerges('njord pr-merge --force --force-reason "see 12" 30', "/r"), [at(30)]);
  assert.deepEqual(findMerges("njord pr-merge --help", "/r"), [at(null, "/r", true)]);
  assert.deepEqual(findMerges("STARK=1 env X=2 /opt/bin/njord pr-merge 5", "/r"), [at(5)]);
  assert.deepEqual(findMerges("cd sub && njord pr-merge 3", "/r"), [at(3, "/r/sub")]);
  assert.deepEqual(findMerges("cd ~/x && njord pr-merge", "/r", "/h"), [at(null, "/h/x")]);
  assert.deepEqual(findMerges('cd "$HOME/x" && njord pr-merge; cd ${HOME} && njord pr-merge', "/r", "/h"), [at(null, "/h/x"), at(null, "/h")]);
  assert.deepEqual(findMerges('echo "njord pr-merge 5"; njord pr-list; git log', "/r"), []);
  // A cd inside a subshell or a $( … ) ends with it.
  assert.deepEqual(findMerges("(cd ../o && njord pr-merge 3); njord pr-merge 4", "/r/b"), [at(3, "/r/o"), at(4, "/r/b")]);
  assert.deepEqual(findMerges('x=$(cd /t; pwd) && njord pr-merge 6', "/r"), [at(6)]);
  assert.deepEqual(findMerges("(cd a); (njord pr-merge 7)", "/r"), [at(7)]);
});

test("shellCommands marks each subshell's start and end", () => {
  assert.deepEqual(shellCommands("(cd a && b) | c"), ["(", ["cd", "a"], ["b"], ")", ["c"]]);
});

test("timeLeft cuts each subprocess timeout to what is left of the shared budget", () => {
  assert.equal(BUDGET_MS, 240_000);
  assert.equal(timeLeft(30_000, 1_000, 100_000), 30_000);
  assert.equal(timeLeft(120_000, 95_000, 100_000), 5_000);
  assert.equal(timeLeft(120_000, 200_000, 100_000), 1, "never 0, which spawnSync reads as no timeout");
});

test("render denies on a RED, warns without a decision, and says nothing on a pass", () => {
  assert.equal(render([{ kind: "pass" }]), null);
  assert.equal(render([]), null);
  const deny = render([{ kind: "warn", text: "w" }, { kind: "red", text: "r" }]) as any;
  assert.equal(deny.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(deny.hookSpecificOutput.permissionDecisionReason, "agent-doc gate: r");
  const warned = render([{ kind: "warn", text: "w" }]) as any;
  assert.equal(warned.systemMessage, "agent-doc gate: w; the merge goes on unchecked.");
  assert.equal(warned.hookSpecificOutput.additionalContext, warned.systemMessage);
  assert.equal(warned.hookSpecificOutput.permissionDecision, undefined);
});

const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const a = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(a) + "\\n");
if (a[0] === "pr" && a[1] === "view") {
  if (process.env.FAKE_GH_FAIL) { process.stderr.write("no pull requests found for branch \\"x\\"\\n"); process.exit(1); }
  process.stdout.write(fs.readFileSync(process.env.FAKE_GH_VIEW, "utf8"));
} else if (a[0] === "api") {
  process.stdout.write(fs.readFileSync(process.env.FAKE_GH_API, "utf8"));
} else process.exit(9);
`;

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

interface Fixture {
  dir: string;
  repo: string;
  tmp: string;
  /** Commits these files on a new commit and returns its sha. */
  commit(files: Record<string, string>): string;
  /** The PR that `gh pr view` prints. */
  pr(view: object): void;
  run(command: string, extra?: Record<string, string>, tool?: string): { status: number | null; stdout: string; stderr: string; gh: string[][] };
}

function withFixture(fn: (f: Fixture) => void): void {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rules-gate-test-")));
  try {
    const [home, bin, repo, tmp] = ["home", "bin", "repo", "tmp"].map((n) => path.join(dir, n));
    for (const d of [home, bin, repo, tmp]) fs.mkdirSync(d);
    fs.writeFileSync(path.join(bin, "gh"), FAKE_GH, { mode: 0o755 });
    git(repo, "init", "--quiet");
    const log = path.join(dir, "gh.log");
    const view = path.join(dir, "view.json");
    const api = path.join(dir, "api.txt");
    fn({
      dir, repo, tmp,
      commit(files) {
        for (const [rel, text] of Object.entries(files)) {
          fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
          fs.writeFileSync(path.join(repo, rel), text);
        }
        git(repo, "add", "-A");
        git(repo, "commit", "--quiet", "--allow-empty", "-m", "c");
        return git(repo, "rev-parse", "HEAD");
      },
      pr(v) {
        fs.writeFileSync(view, JSON.stringify(v));
      },
      run(command, extra = {}, tool = "Bash") {
        fs.writeFileSync(log, "");
        const env: NodeJS.ProcessEnv = {
          ...process.env, HOME: home, TMPDIR: tmp, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          FAKE_GH_LOG: log, FAKE_GH_VIEW: view, FAKE_GH_API: api, ...extra,
        };
        if (extra.FAKE_GH_API_TEXT !== undefined) fs.writeFileSync(api, extra.FAKE_GH_API_TEXT);
        const input = JSON.stringify({ tool_name: tool, tool_input: { command }, cwd: repo });
        const r = spawnSync(process.execPath, ["--no-warnings", HOOK], { input, env, cwd: dir, encoding: "utf8" });
        const gh = fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
        return { status: r.status, stdout: r.stdout, stderr: r.stderr, gh };
      },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const view = (sha: string, files: [string, string][], over: object = {}) => ({
  number: 5, state: "OPEN", headRefOid: sha, changedFiles: files.length,
  files: files.map(([p, changeType]) => ({ path: p, changeType })), ...over,
});

test("a PR that adds a RED clause to an agent file is denied, with the clause", () => {
  withFixture((f) => {
    const sha = f.commit({ "CLAUDE.md": CLEAN + RED_LINE, "tools/x.ts": "x\n" });
    f.pr(view(sha, [["CLAUDE.md", "MODIFIED"], ["tools/x.ts", "ADDED"]]));
    const r = f.run("git push && njord pr-merge 5 --skip-changelog");
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    assert.equal(out.permissionDecision, "deny");
    assert.match(out.permissionDecisionReason, /^agent-doc gate: PR #5 changes an agent file with a RED clause/);
    assert.match(out.permissionDecisionReason, /playbook \(\/.*skill\/stark-agent-docs\/references\/playbook\.md\)/);
    assert.match(out.permissionDecisionReason, /CLAUDE\.md:4 {2}GATE .*This is the operator's call\./);
    assert.doesNotMatch(out.permissionDecisionReason, /x\.ts/);
    assert.deepEqual(r.gh, [["pr", "view", "5", "--json", "number,state,headRefOid,changedFiles,files"]]);
    assert.deepEqual(fs.readdirSync(f.tmp), [], "the hook deletes its copy of the tree");
  });
});

test("the head commit is read, not the working tree, and a PR with no RED passes in silence", () => {
  withFixture((f) => {
    const sha = f.commit({ "CLAUDE.md": CLEAN });
    f.commit({ "CLAUDE.md": CLEAN + RED_LINE }); // later than the PR head
    f.pr(view(sha, [["CLAUDE.md", "MODIFIED"]]));
    const r = f.run("njord pr-merge");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    assert.deepEqual(r.gh, [["pr", "view", "--json", "number,state,headRefOid,changedFiles,files"]]);
  });
});

test("a PR that changes no agent file, deletes one, or is not open passes without triage", () => {
  withFixture((f) => {
    const sha = f.commit({ "tools/x.ts": "x\n" });
    f.pr(view(sha, [["tools/x.ts", "MODIFIED"], ["CLAUDE.md", "DELETED"]]));
    assert.equal(f.run("njord pr-merge 5").stdout, "");
    f.pr(view("0".repeat(40), [["CLAUDE.md", "MODIFIED"]], { state: "MERGED" }));
    assert.equal(f.run("njord pr-merge 5").stdout, "");
  });
});

test("a PR to the repo that holds the root rules triages them as the root rules, not as a copy", () => {
  withFixture((f) => {
    // ~/Code/CLAUDE.md points into the repo, as it points into idavoll.
    fs.mkdirSync(path.join(f.dir, "home", "Code"));
    fs.symlinkSync(path.join(f.repo, "CLAUDE.md"), path.join(f.dir, "home", "Code", "CLAUDE.md"));
    const sha = f.commit({ "CLAUDE.md": CLEAN + RED_LINE });
    f.pr(view(sha, [["CLAUDE.md", "MODIFIED"]]));
    const r = f.run("njord pr-merge 5");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "", "the root rules define the gates and copy nothing");
    assert.deepEqual(fs.readdirSync(f.tmp), []);
  });
});

test("a head commit that is not local is fetched from the PR ref", () => {
  withFixture((f) => {
    const origin = path.join(f.dir, "origin.git");
    git(f.dir, "init", "--quiet", "--bare", origin);
    f.commit({ "README.md": "r\n" });
    git(f.repo, "remote", "add", "origin", origin);
    git(f.repo, "push", "--quiet", "origin", "HEAD:refs/heads/main");
    const sha = f.commit({ "skill/demo/SKILL.md": "---\nname: demo\ndescription: d\n---\n" + RED_LINE });
    git(f.repo, "push", "--quiet", "origin", `HEAD:refs/pull/5/head`);
    git(f.repo, "reset", "--quiet", "--hard", "HEAD~1");
    git(f.repo, "reflog", "expire", "--expire=now", "--all");
    git(f.repo, "gc", "--quiet", "--prune=now");
    assert.notEqual(spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: f.repo }).status, 0);
    f.pr(view(sha, [["skill/demo/SKILL.md", "ADDED"]]));
    const out = JSON.parse(f.run("njord pr-merge 5").stdout).hookSpecificOutput;
    assert.equal(out.permissionDecision, "deny");
    assert.match(out.permissionDecisionReason, /skill\/demo\/SKILL\.md:5 {2}GATE/);
  });
});

test("a PR with more files than gh pr view lists is listed through the REST API", () => {
  withFixture((f) => {
    const sha = f.commit({ "CLAUDE.md": RED_LINE });
    f.pr(view(sha, [["tools/x.ts", "MODIFIED"]], { changedFiles: 101 }));
    const r = f.run("njord pr-merge 5", { FAKE_GH_API_TEXT: "tools/x.ts\nCLAUDE.md\n" });
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
    assert.deepEqual(r.gh[1], ["api", "--paginate", "repos/{owner}/{repo}/pulls/5/files", "--jq", '.[] | select(.status != "removed") | .filename']);
  });
});

test("a tool error lets the merge go on, with one warning line", () => {
  withFixture((f) => {
    const noPr = JSON.parse(f.run("njord pr-merge", { FAKE_GH_FAIL: "1" }).stdout);
    assert.equal(noPr.hookSpecificOutput.permissionDecision, undefined);
    assert.equal(noPr.systemMessage, 'agent-doc gate: could not read the PR of this branch (no pull requests found for branch "x"); the merge goes on unchecked.');
    assert.equal(noPr.hookSpecificOutput.additionalContext, noPr.systemMessage);

    const gone = path.join(f.dir, "gone");
    const noDir = f.run(`cd ${gone} && njord pr-merge`);
    assert.equal(JSON.parse(noDir.stdout).systemMessage, `agent-doc gate: the merge runs in ${gone}, which is not a folder here; the merge goes on unchecked.`);
    assert.deepEqual(noDir.gh, []);

    // The PR names an agent file that its head commit does not hold: triage exits 2.
    const sha = f.commit({ "tools/x.ts": "x\n" });
    f.pr(view(sha, [["CLAUDE.md", "MODIFIED"]]));
    const broken = JSON.parse(f.run("njord pr-merge 5").stdout);
    assert.equal(broken.hookSpecificOutput.permissionDecision, undefined);
    assert.match(broken.systemMessage, /^agent-doc gate: triage of PR #5 failed \(exit 2: rules_audit: CLAUDE\.md: no such file\); the merge goes on unchecked\.$/);
    assert.deepEqual(fs.readdirSync(f.tmp), []);
  });
});

test("other tools, other commands and a help call never reach gh", () => {
  withFixture((f) => {
    for (const [command, tool] of [["njord pr-merge 5", "Write"], ["njord pr-list", "Bash"], ["njord pr-merge --help", "Bash"]]) {
      const r = f.run(command, {}, tool);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "");
      assert.deepEqual(r.gh, [], command);
    }
  });
});

test("argv: help prints the usage, and anything else is refused", () => {
  const help = spawnSync(process.execPath, ["--no-warnings", HOOK, "--help"], { encoding: "utf8", input: "" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^usage: rules_gate_hook\.ts/);
  for (const [arg, refusal] of [["--nope", /^unknown argument: --nope\nusage: rules_gate_hook\.ts/], ["5", /^unexpected positional argument: 5\nusage:/]] as const) {
    const bad = spawnSync(process.execPath, ["--no-warnings", HOOK, arg], { encoding: "utf8", input: "" });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, refusal);
    assert.equal(bad.stdout, "");
  }
});
