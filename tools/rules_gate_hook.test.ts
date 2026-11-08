// rules_gate_hook: the command parser, the base match and the output shapes as
// units, then the hook end to end: a PreToolUse payload on stdin, a real git
// repo, a fake `gh` on PATH, a throwaway HOME (so no ~/Code/CLAUDE.md joins the
// triage), and what Claude Code reads on stdout.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Clause, TriageReport } from "./rules_audit_lib.ts";
import { BUDGET_MS, findMerges, newReds, PR_FIELDS, render, renamesIn, shellCommands, timeLeft } from "./rules_gate_hook.ts";

const HOOK = path.join(import.meta.dirname, "rules_gate_hook.ts");
const RED_LINE = "This is the operator's call.\n";
const OLD_RED = "Merging needs a GO.\n";
const CLEAN = "# Repo\n\nRun `npm test` before you push.\n";
/** A skill whose core is over twice its 15k budget: RED for size. */
const BIG_SKILL = "---\nname: big\ndescription: d\n---\n" +
  Array.from({ length: 1300 }, (_, i) => `Line ${i} of the long skill.`).join("\n") + "\n";

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

test("renamesIn maps each renamed file to its old path, and skips the other statuses", () => {
  const z = ["M", "CLAUDE.md", "R100", "skill/a/SKILL.md", "skill/b/SKILL.md", "C075", "x.md", "y.md", "A", "n.md", "R087", "o.md", "p.md", ""].join("\0");
  assert.deepEqual([...renamesIn(z)], [["skill/b/SKILL.md", "skill/a/SKILL.md"], ["p.md", "o.md"]]);
  assert.deepEqual([...renamesIn("")], []);
});

const clause = (type: Clause["type"], text: string, line = 1, more: Partial<Clause> = {}): Clause =>
  ({ flag: "RED", type, line, text, detail: `${type.toLowerCase()} detail`, ...more });
const report = (...files: [string, Clause[]][]): TriageReport => ({
  files: files.map(([p, clauses]) => ({ path: p, kind: "root", chars: 0, budget: 15_000, flag: "RED", clauses })),
  totals: { GREEN: 0, YELLOW: 0, RED: files.length },
});
const core = (chars: number) => clause("SIZE", `${chars} chars`, 1, { chars, measure: "core", detail: "over the 15k budget twice over" });
const load = (chars: number) => clause("SIZE", `${chars} chars in 3 files`, 1, { chars, measure: "load set", detail: "start-up load set over the 40k budget twice over (a, b)" });
const desc = (chars: number) => clause("SIZE", "d", 3, { chars, measure: "description", detail: `description: ${chars} chars, over the 300 budget twice over` });

test("newReds matches a clause by its type and text, not its line, and each base clause once", () => {
  const pairs = new Map([["CLAUDE.md", "CLAUDE.md"]]);
  const base = report(["CLAUDE.md", [clause("GATE", "Merging needs a GO.", 4), clause("HISTORY", "We used to.", 9, { flag: "YELLOW" })]]);
  const head = report(["CLAUDE.md", [
    clause("GATE", "Merging needs a GO.", 12), // moved: kept
    clause("GATE", "Merging needs a GO.", 20), // a second copy: new
    clause("GATE", "This is the operator's call.", 5), // new text: new
    clause("HISTORY", "We used to.", 9), // YELLOW on the base: new
    clause("POINTER", "gone.md", 7, { flag: "YELLOW" }), // not RED: neither
  ]]);
  const r = newReds(head, base, pairs);
  assert.equal(r.kept, 1);
  assert.deepEqual(r.added.map((a) => `${a.path}:${a.clause.line} ${a.clause.type}`), ["CLAUDE.md:20 GATE", "CLAUDE.md:5 GATE", "CLAUDE.md:9 HISTORY"]);
});

test("newReds: a SIZE RED is new when its kind was not RED on the base, or when its chars grew", () => {
  const pairs = new Map([["CLAUDE.md", "CLAUDE.md"]]);
  const same = newReds(report(["CLAUDE.md", [core(31_000), load(85_000)]]), report(["CLAUDE.md", [load(85_000), core(31_000)]]), pairs);
  assert.deepEqual(same, { added: [], kept: 2 });
  const smaller = newReds(report(["CLAUDE.md", [core(30_500)]]), report(["CLAUDE.md", [core(31_000)]]), pairs);
  assert.deepEqual(smaller, { added: [], kept: 1 });
  // 30 chars more in the load set: its text, in thousands, does not change.
  const grown = newReds(report(["CLAUDE.md", [core(31_000), load(85_030)]]), report(["CLAUDE.md", [core(31_000), load(85_000)]]), pairs);
  assert.equal(grown.kept, 1);
  assert.deepEqual(grown.added.map((a) => a.clause.detail), ["start-up load set over the 40k budget twice over (a, b), grown from 85000 to 85030 chars"]);
  // Another kind: the base's core RED does not cover the head's description RED.
  const other = newReds(report(["s/SKILL.md", [desc(700)]]), report(["s/SKILL.md", [core(31_000)]]), new Map([["s/SKILL.md", "s/SKILL.md"]]));
  assert.deepEqual(other.added.map((a) => a.clause.detail), ["description: 700 chars, over the 300 budget twice over"]);
  // The load set is the repo's: it matches the base's on another file, or on a file the PR adds.
  const moved = newReds(
    report([".claude/rules/0.md", [load(85_000)]], [".claude/rules/b.md", []]),
    report([".claude/rules/b.md", [load(85_000)]]),
    new Map([[".claude/rules/b.md", ".claude/rules/b.md"]]),
  );
  assert.deepEqual(moved, { added: [], kept: 1 });
});

test("newReds pairs a renamed file with its old path, and calls each RED of a file with no pair new", () => {
  const base = report(["old/CLAUDE.md", [clause("GATE", "g"), core(31_000)]]);
  const head = report(["new/CLAUDE.md", [clause("GATE", "g"), core(31_000)]], ["added/CLAUDE.md", [clause("GATE", "g")]]);
  const r = newReds(head, base, new Map([["new/CLAUDE.md", "old/CLAUDE.md"]]));
  assert.equal(r.kept, 2);
  assert.deepEqual(r.added.map((a) => a.path), ["added/CLAUDE.md"]);
  // The same path on the base is no pair unless the map names it.
  assert.equal(newReds(report(["old/CLAUDE.md", [clause("GATE", "g")]]), base, new Map()).added.length, 1);
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
  /** Writes these files, deletes each one set to null, commits, and returns the sha. */
  commit(files: Record<string, string | null>): string;
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
          if (text === null) {
            fs.rmSync(path.join(repo, rel));
            continue;
          }
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

/** The PR `gh pr view` prints: head `sha` on base `main` at `base`. */
const view = (sha: string, base: string, files: [string, string][], over: object = {}) => ({
  number: 5, state: "OPEN", headRefOid: sha, baseRefName: "main", baseRefOid: base, changedFiles: files.length,
  files: files.map(([p, changeType]) => ({ path: p, changeType })), ...over,
});

/** The deny reason of a run, or a failure that shows its output. */
function denied(r: { stdout: string; stderr: string }): string {
  assert.notEqual(r.stdout, "", `no output; stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, "deny", r.stdout);
  return out.permissionDecisionReason;
}

test("a PR that adds a RED clause to an agent file is denied, with the clause", () => {
  withFixture((f) => {
    const base = f.commit({ "CLAUDE.md": CLEAN });
    const sha = f.commit({ "CLAUDE.md": CLEAN + RED_LINE, "tools/x.ts": "x\n" });
    f.pr(view(sha, base, [["CLAUDE.md", "MODIFIED"], ["tools/x.ts", "ADDED"]]));
    const r = f.run("git push && njord pr-merge 5 --skip-changelog");
    assert.equal(r.status, 0, r.stderr);
    const reason = denied(r);
    assert.match(reason, /^agent-doc gate: PR #5 adds a RED clause to an agent file/);
    assert.match(reason, /playbook \(\/.*skill\/stark-agent-docs\/references\/playbook\.md\)/);
    assert.match(reason, /\n\nNew RED clauses:\n {2}CLAUDE\.md:4 {2}GATE .*This is the operator's call\.\n\n0 RED clauses were on the base already; they do not stop the merge\.$/);
    assert.doesNotMatch(reason, /x\.ts/);
    assert.deepEqual(r.gh, [["pr", "view", "5", "--json", PR_FIELDS]]);
    assert.deepEqual(fs.readdirSync(f.tmp), [], "the hook deletes its copies of the trees");
  });
});

test("the deny reason names only the new RED clauses, and counts the ones on the base", () => {
  withFixture((f) => {
    const base = f.commit({ "CLAUDE.md": CLEAN + OLD_RED });
    const sha = f.commit({ "CLAUDE.md": RED_LINE + CLEAN + OLD_RED });
    f.pr(view(sha, base, [["CLAUDE.md", "MODIFIED"]]));
    const reason = denied(f.run("njord pr-merge 5"));
    assert.match(reason, /New RED clauses:\n {2}CLAUDE\.md:1 {2}GATE .*This is the operator's call\.\n\n1 RED clause was on the base already; it does not stop the merge\.$/);
    assert.doesNotMatch(reason, /Merging needs a GO/);
  });
});

test("a PR that keeps a base RED and adds none is allowed in silence, even when it moves the RED", () => {
  withFixture((f) => {
    const base = f.commit({ "CLAUDE.md": CLEAN + OLD_RED });
    const sha = f.commit({ "CLAUDE.md": "# Repo\n\nIntro line.\n\n" + OLD_RED + "Run `npm test` first.\n" });
    f.pr(view(sha, base, [["CLAUDE.md", "MODIFIED"]]));
    const r = f.run("njord pr-merge 5");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    assert.deepEqual(fs.readdirSync(f.tmp), []);
  });
});

test("a one-line change to a file RED for size on the base, at the same size, is allowed in silence", () => {
  withFixture((f) => {
    const base = f.commit({ "skill/big/SKILL.md": BIG_SKILL });
    const sha = f.commit({ "skill/big/SKILL.md": BIG_SKILL.replace("Line 7 of", "Line 7 at") });
    f.pr(view(sha, base, [["skill/big/SKILL.md", "MODIFIED"]]));
    const r = f.run("njord pr-merge 5");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
  });
});

test("a PR that makes a file RED for size on the base larger is denied, with the growth", () => {
  withFixture((f) => {
    const base = f.commit({ "skill/big/SKILL.md": BIG_SKILL });
    const sha = f.commit({ "skill/big/SKILL.md": BIG_SKILL + "One more line.\n" });
    f.pr(view(sha, base, [["skill/big/SKILL.md", "MODIFIED"]]));
    const reason = denied(f.run("njord pr-merge 5"));
    assert.match(reason, /New RED clauses:\n {2}skill\/big\/SKILL\.md:1 {2}SIZE {2}over the 15k budget twice over, grown from (\d+) to (\d+) chars: [\d.]+k chars\n\n0 RED clauses were/);
    const [, from, to] = /grown from (\d+) to (\d+)/.exec(reason)!;
    assert.equal(Number(to) - Number(from), "One more line.\n".length);
  });
});

test("a PR that adds an agent file with a RED clause is denied", () => {
  withFixture((f) => {
    const base = f.commit({ "CLAUDE.md": CLEAN + OLD_RED });
    const sha = f.commit({ "pkg/CLAUDE.md": "# Pkg\n\n" + OLD_RED });
    f.pr(view(sha, base, [["pkg/CLAUDE.md", "ADDED"]]));
    const reason = denied(f.run("njord pr-merge 5"));
    assert.match(reason, /New RED clauses:\n {2}pkg\/CLAUDE\.md:3 {2}GATE .*Merging needs a GO\.\n\n0 RED clauses were/);
  });
});

test("a merge run from a subfolder still copies and triages the whole tree", () => {
  withFixture((f) => {
    const base = f.commit({ "CLAUDE.md": CLEAN, "tools/x.ts": "x\n" });
    const sha = f.commit({ "CLAUDE.md": CLEAN + RED_LINE });
    f.pr(view(sha, base, [["CLAUDE.md", "MODIFIED"]]));
    const reason = denied(f.run("cd tools && njord pr-merge 5"));
    assert.match(reason, /New RED clauses:\n {2}CLAUDE\.md:4 {2}GATE .*This is the operator's call\./);
  });
});

test("a PR that only renames an agent file with REDs is allowed in silence", () => {
  withFixture((f) => {
    const text = BIG_SKILL + OLD_RED;
    const base = f.commit({ "skill/old/SKILL.md": text });
    const sha = f.commit({ "skill/old/SKILL.md": null, "skill/new/SKILL.md": text });
    f.pr(view(sha, base, [["skill/new/SKILL.md", "RENAMED"]]));
    const r = f.run("njord pr-merge 5");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    assert.deepEqual(fs.readdirSync(f.tmp), []);
  });
});

test("the head commit is read, not the working tree, and a PR with no RED passes in silence", () => {
  withFixture((f) => {
    const base = f.commit({ "README.md": "r\n" });
    const sha = f.commit({ "CLAUDE.md": CLEAN });
    f.commit({ "CLAUDE.md": CLEAN + RED_LINE }); // later than the PR head
    f.pr(view(sha, base, [["CLAUDE.md", "MODIFIED"]]));
    const r = f.run("njord pr-merge");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    assert.deepEqual(r.gh, [["pr", "view", "--json", PR_FIELDS]]);
  });
});

test("a PR that changes no agent file, deletes one, or is not open passes without triage", () => {
  withFixture((f) => {
    const sha = f.commit({ "tools/x.ts": "x\n" });
    f.pr(view(sha, sha, [["tools/x.ts", "MODIFIED"], ["CLAUDE.md", "DELETED"]]));
    assert.equal(f.run("njord pr-merge 5").stdout, "");
    f.pr(view("0".repeat(40), sha, [["CLAUDE.md", "MODIFIED"]], { state: "MERGED" }));
    assert.equal(f.run("njord pr-merge 5").stdout, "");
  });
});

test("a PR to the repo that holds the root rules triages them as the root rules, not as a copy", () => {
  withFixture((f) => {
    // ~/Code/CLAUDE.md points into the repo, as it points into idavoll.
    fs.mkdirSync(path.join(f.dir, "home", "Code"));
    fs.symlinkSync(path.join(f.repo, "CLAUDE.md"), path.join(f.dir, "home", "Code", "CLAUDE.md"));
    const base = f.commit({ "CLAUDE.md": CLEAN });
    const sha = f.commit({ "CLAUDE.md": CLEAN + RED_LINE });
    f.pr(view(sha, base, [["CLAUDE.md", "MODIFIED"]]));
    const r = f.run("njord pr-merge 5");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "", "the root rules define the gates and copy nothing");
    assert.deepEqual(fs.readdirSync(f.tmp), []);
  });
});

test("a head commit and a base tip that are not local are fetched", () => {
  withFixture((f) => {
    const origin = path.join(f.dir, "origin.git");
    git(f.dir, "init", "--quiet", "--bare", origin);
    f.commit({ "README.md": "r\n" });
    git(f.repo, "remote", "add", "origin", origin);
    const skill = "---\nname: demo\ndescription: d\n---\n" + OLD_RED;
    f.commit({ "skill/demo/SKILL.md": skill }); // the merge base
    // The base branch moves on after the PR starts, so its tip is no ancestor of the head.
    const tip = f.commit({ "NOTES.txt": "n\n" });
    git(f.repo, "push", "--quiet", "origin", "HEAD:refs/heads/main");
    git(f.repo, "reset", "--quiet", "--hard", "HEAD~1");
    const sha = f.commit({ "skill/demo/SKILL.md": skill + RED_LINE });
    git(f.repo, "push", "--quiet", "origin", `HEAD:refs/pull/5/head`);
    git(f.repo, "reset", "--quiet", "--hard", "HEAD~2");
    git(f.repo, "update-ref", "-d", "refs/remotes/origin/main");
    git(f.repo, "reflog", "expire", "--expire=now", "--all");
    git(f.repo, "gc", "--quiet", "--prune=now");
    for (const c of [tip, sha]) assert.notEqual(spawnSync("git", ["cat-file", "-e", `${c}^{commit}`], { cwd: f.repo }).status, 0);
    f.pr(view(sha, tip, [["skill/demo/SKILL.md", "MODIFIED"]]));
    const reason = denied(f.run("njord pr-merge 5"));
    assert.match(reason, /New RED clauses:\n {2}skill\/demo\/SKILL\.md:6 {2}GATE .*This is the operator's call\.\n\n1 RED clause was on the base already/);
  });
});

test("a PR with more files than gh pr view lists is listed through the REST API", () => {
  withFixture((f) => {
    const base = f.commit({ "README.md": "r\n" });
    const sha = f.commit({ "CLAUDE.md": RED_LINE });
    f.pr(view(sha, base, [["tools/x.ts", "MODIFIED"]], { changedFiles: 101 }));
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
    f.pr(view(sha, sha, [["CLAUDE.md", "MODIFIED"]]));
    const broken = JSON.parse(f.run("njord pr-merge 5").stdout);
    assert.equal(broken.hookSpecificOutput.permissionDecision, undefined);
    assert.match(broken.systemMessage, /^agent-doc gate: triage of the head of PR #5 failed \(exit 2: rules_audit: CLAUDE\.md: no such file\); the merge goes on unchecked\.$/);
    assert.deepEqual(fs.readdirSync(f.tmp), []);
  });
});

test("a head RED with a base the hook cannot read lets the merge go on, with one warning line", () => {
  withFixture((f) => {
    const sha = f.commit({ "CLAUDE.md": CLEAN + RED_LINE });
    const warned = (over: object) => {
      f.pr(view(sha, "f".repeat(40), [["CLAUDE.md", "MODIFIED"]], over));
      const r = f.run("njord pr-merge 5");
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.hookSpecificOutput.permissionDecision, undefined);
      assert.deepEqual(fs.readdirSync(f.tmp), []);
      return out.systemMessage;
    };
    // No origin to fetch the base tip from: no network, as far as the hook can tell.
    assert.equal(warned({}), `agent-doc gate: the tip ${"f".repeat(12)} of main, the base of PR #5, is not here, and the fetch did not bring it; the merge goes on unchecked.`);
    assert.equal(warned({ baseRefOid: "" }), "agent-doc gate: gh pr view gave no base branch for PR #5; the merge goes on unchecked.");
    // A base with no history in common with the head.
    git(f.repo, "checkout", "--quiet", "--orphan", "other");
    const lone = f.commit({ "README.md": "r\n" });
    assert.match(warned({ baseRefOid: lone }), /^agent-doc gate: found no merge base of PR #5 and main \(.*\); the merge goes on unchecked\.$/);
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
