import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { parseCli, hasCliHelp } from "./cli_args_lib.ts";

const root = path.resolve(import.meta.dirname, "..");
// One row per executable; every dispatched route is exercised independently.
const routes: Record<string, string[]> = {
  alert_delivery: [""], approach_contract: [""], context_compactor: [""],
  copilot_land: ["", "branch-name", "prepare-branch", "land"],
  fact_routing_fold: [""], fact_routing_hook: [""], failure_classifier: [""],
  findings_review_post: [""], gcp_scope: ["", "init", "install", "check", "list"],
  github_projects: ["", "find-project", "add-issue", "get-field-ids", "get-items", "get-item-fields", "set-field", "set-fields", "find-item", "get-issue-node-id", "transition-status", "is-legal-transition", "check-spec-completeness", "load-config"],
  healer_canary: ["", "--status", "--check", "--promote audit", "--demote audit", "--explain audit", "--close-circuit audit"],
  iac_review: ["", "--kind terraform", "--kind terragrunt"], jury: ["", "run", "list", "show"],
  memory_tidy: [""], optimize_skill_description: [""], preflight: [""],
  refactor_planner: ["", "--mode run", "--mode validate", "--mode dry-run"], release_changelog: [""], release_version_bump: [""],
  self_healer: [""], session_id: [""], session_state: ["", "set"],
  skill_audit: [""], skill_autopilot: [""], skill_diet: [""], skill_optimize: [""],
  skill_router: [""], stark_config_lib: [""], stark_handover: ["", "resolve", "save", "resume", "list"],
  stark_persona: ["", "select", "deactivate", "rate", "survey", "survey-answer", "add", "stats", "history", "print-roster", "print-weights", "session-end"],
  stark_session: ["", "start", "end"],
  statusline_setup: ["", "--list", "--enable model", "--disable model", "--install", "--reset"], validation_gate: [""],
};
const shells = [
  "config/cmux-autoname.sh", "config/statusline-command.sh", "config/statusline-prompt-hook.sh",
  "config/statusline-stop-hook.sh", "tools/check-rest-only.sh",
  "skill/stark-gha-cost/scripts/gha-cost-breakdown.sh", "skill/stark-gha-cost/scripts/gha-repo-actions-drill.sh",
  "skill/stark-build/references/hooks/protect-paths.sh", "skill/stark-build/references/hooks/stop-gate.sh",
];
const refusal = /usage:|stark-session CLI|unknown (?:argument|option|flag|subcommand)|unexpected (?:positional )?argument|unsupported (?:argument|option)|requires a value|needs a value|Missing value|expected owner\/repo/i;

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "source-help-"));
  const home = path.join(dir, "home"); fs.mkdirSync(home);
  const bin = path.join(dir, "bin"); fs.mkdirSync(bin);
  const log = path.join(dir, "effects"); fs.writeFileSync(log, "");
  for (const name of ["gh", "git", "gcloud", "direnv", "alfred", "hermod", "idun", "claude", "codex", "gemini", "node", "python3", "curl", "osascript", "open", "bash", "sh", "jq", "date", "cat", "dirname", "grep", "sed", "mkdir", "rm", "cp"]) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nprintf "process:' + name + '\\n" >> "$HELP_AUDIT_LOG"\nexit 91\n', { mode: 0o755 });
  }
  const env = { HOME: home, PATH: bin, TMPDIR: dir, XDG_CONFIG_HOME: home, XDG_STATE_HOME: home,
    STARK_STATE_ROOT: home, STARK_PLUGIN_ROOT: root, CLAUDE_PLUGIN_ROOT: root,
    HELP_AUDIT_LOG: log, NO_COLOR: "1" };
  const preload = path.join(root, "tools/fixtures/help-tripwire.cjs");
  const run = (file: string, args: string[], shell = false) => {
    fs.writeFileSync(log, "");
    const executable = shell ? "/bin/bash" : process.execPath;
    const argv = shell ? ["--noprofile", "--norc", file, ...args] : ["--require", preload, file, ...args];
    const isolated = process.env.HELP_AUDIT_OS === "1";
    const profile = `(version 1) (allow default) (deny network*) (deny file-write*) (allow file-write* (literal ${JSON.stringify(fs.realpathSync(log))})) (deny process-exec) (allow process-exec (literal ${JSON.stringify(fs.realpathSync(executable))}))`;
    const result = spawnSync(isolated ? "/usr/bin/sandbox-exec" : executable,
      isolated ? ["-p", profile, executable, ...argv] : argv,
      { cwd: dir, env, encoding: "utf8", input: "", timeout: 8000 });
    return { ...result, effects: fs.readFileSync(log, "utf8"), output: result.stdout + result.stderr };
  };
  return { dir, home, log, env, preload, run };
}

test("tripwires actually deny process, network, writes and credential/config reads", () => {
  const f = fixture();
  try {
    for (const [kind, source] of Object.entries({
      process: 'require("node:child_process").spawnSync("gh", ["api", "user"])',
      network: 'fetch("https://example.invalid")',
      write: 'require("node:fs").writeFileSync(process.env.HOME + "/sentinel", "bad")',
      "write:promises.open": 'require("node:fs").promises.open(process.env.HOME + "/sentinel", "w")',
      "home-read": 'require("node:fs").readFileSync(process.env.HOME + "/credentials")',
    })) {
      const file = path.join(f.dir, "calibrate.cjs"); fs.writeFileSync(file, source);
      const r = f.run(file, []);
      assert.equal(r.status, 91, r.output); assert.match(r.effects, new RegExp(kind));
    }
    const readProbe = path.join(f.dir, "read-probe.cjs");
    fs.writeFileSync(readProbe, 'const fs = require("node:fs"); fs.closeSync(fs.openSync(__filename)); fs.open(__filename, (err, fd) => { if (err) throw err; fs.closeSync(fd); }); fs.promises.open(__filename).then(file => file.close());');
    const read = f.run(readProbe, []);
    assert.equal(read.status, 0, read.output); assert.equal(read.effects, "");
    assert.deepEqual(fs.readdirSync(f.home), []);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("every source CLI route exits help or precisely refuses before backend effects", () => {
  const f = fixture(); let count = 0;
  try {
    const entries: [string, string[]][] = Object.entries(routes).map(([name, commands]) => [path.join(root, "tools", name + ".ts"), commands]);
    for (const [file, commands] of entries) for (const command of commands) {
      const prefix = command ? command.split(" ") : [];
      for (const suffix of [["help"], ["--help"], ["-h"], ["--json", "help"], ["help", "--json"], ["--invalid-audit-flag", "help"], ["help", "--invalid-audit-flag"]]) {
        const args = [...prefix, ...suffix];
        const r = f.run(file, args); count++;
        const label = `${file} ${args.join(" ")}: ${r.output}`;
        assert.equal(r.error, undefined, label);
        assert.equal(r.signal, null, label);
        assert.equal(r.effects, "", label);
        assert.match(r.output, refusal, label);
        assert.ok(r.status !== 0 || /usage:|\bCLI\b/i.test(r.output), label);
      }
    }
    // The exit STATUS is asserted here, not just the wording: a mangled guard
    // whose `case` subject is not `$1` still prints "unsupported argument: …"
    // and so still satisfies `refusal` while help never works. Leading help is
    // syntax and must exit 0; anything else must refuse nonzero.
    for (const file of shells) for (const args of [["help"], ["--help"], ["-h"], ["--dry-run", "help"], ["help", "--dry-run"]]) {
      const r = f.run(path.join(root, file), args, true); count++;
      const label = `${file} ${args.join(" ")}: ${r.output}`;
      assert.equal(r.effects, "", label);
      assert.equal(r.signal, null, label);
      assert.match(r.output, refusal, label);
      if (["help", "--help", "-h"].includes(args[0]!)) {
        assert.equal(r.status, 0, label);
        assert.match(r.output, /usage:/i, label);
        // Line-anchored: a checkout path echoed inside a usage line must not
        // read as the refusal branch having fired.
        assert.doesNotMatch(r.output, /^unsupported /im, label);
      } else {
        assert.notEqual(r.status, 0, label);
      }
    }
    assert.deepEqual(fs.readdirSync(f.home), []);
    console.log(`source help audit: ${count} real entrypoint processes, zero backend effects`);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("real CLI literal values and later safety flags survive parsing", () => {
  const f = fixture();
  try {
    const tool = path.join(root, "tools/copilot_land.ts");
    const r0 = f.run(tool, ["land", "--repo", "audit/repo", "--branch", "audit", "--title", "help", "--body", "please help", "--dry-run", "--json"]);
    assert.equal(r0.status, 0, r0.output); assert.equal(r0.effects, "");
    const plan = JSON.parse(r0.stdout);
    assert.equal(plan.title, "help"); assert.equal(plan.dry_run, true);
    const bad = f.run(tool, ["land", "--title", "--dry-run"]);
    assert.notEqual(bad.status, 0); assert.equal(bad.effects, "");
    assert.match(bad.output, /requires a value/);
    // Refusing a leading-dash value in the space form is only safe because
    // `--key=VALUE` still expresses one. Without it a PR title or body that
    // begins with a dash — a markdown rule, say — is unrepresentable here,
    // and this parser has no other escape.
    const dashy = f.run(tool, ["land", "--repo", "audit/repo", "--branch", "audit", "--title=--fix the guard", "--body", "b", "--dry-run", "--json"]);
    assert.equal(dashy.status, 0, dashy.output); assert.equal(dashy.effects, "");
    assert.equal(JSON.parse(dashy.stdout).title, "--fix the guard");
    const eqBool = f.run(tool, ["land", "--dry-run=yes"]);
    assert.notEqual(eqBool.status, 0); assert.match(eqBool.output, /takes no value/);
    const findings = path.join(root, "tools/findings_review_post.ts");
    // "help" is a literal filename here. Invalid JSON proves the real main
    // reached the data read without intercepting it as help or contacting gh.
    fs.writeFileSync(path.join(f.dir, "help"), "invalid-json");
    const r = f.run(findings, ["--repo", "audit/repo", "--pr", "1", "--findings", "help", "--dry-run"]);
    assert.notEqual(r.status, 0); assert.equal(r.effects, "");
    assert.match(r.output, /JSON|Unexpected token/); assert.doesNotMatch(r.output, /usage:/i);
    for (const [file, args] of [
      ["session_state", ["set", "--field", "name", "--value", "--json"]],
      ["context_compactor", ["unrecognised", "--json"]],
      ["release_version_bump", ["--version", "--dry-run"]],
      ["iac_review", ["--kind", "terraform", "--agents", "--dry-run"]],
      ["stark_handover", ["save", "unexpected", "--all"]],
      ["github_projects", ["set-field", "--value", "--no-validate"]],
      ["skill_autopilot", ["--skill", "--reuse-proposal"]],
    ] as [string, string[]][]) {
      const r = f.run(path.join(root, "tools", file + ".ts"), args);
      assert.notEqual(r.status, 0, r.output); assert.equal(r.effects, "", r.output);
      assert.match(r.output, refusal);
    }
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("operational entrypoint inventory cannot silently omit new source CLIs", () => {
  const found = fs.readdirSync(path.join(root, "tools"))
    .filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "main_module_lib.ts")
    .filter(name => /process\.argv|^#!/m.test(fs.readFileSync(path.join(root, "tools", name), "utf8")))
    .map(name => name.slice(0, -3)).sort();
  assert.deepEqual(found, Object.keys(routes).sort());
});

test("the shell entrypoint inventory cannot silently omit an executable", () => {
  // The `shells` list is hand-written, so without this it is the same
  // silent-omission hole the TypeScript inventory closes: a new hook script
  // anywhere in the tree would never be probed.
  const skip = new Set(["node_modules", ".git", ".worktrees"]);
  const walk = (dir: string, rel = ""): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (skip.has(entry.name)) return [];
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      return entry.isDirectory() ? walk(path.join(dir, entry.name), next) : [next];
    });
  const found = walk(root).filter((p) => p.endsWith(".sh") && !p.endsWith(".test.sh")).sort();
  // A walk that found nothing would agree with an emptied list.
  assert.ok(found.length > 0, "found no shell entrypoints — this inventory would pass vacuously");
  assert.deepEqual(found, [...shells].sort());
});

// Runs on every developer Mac and skips honestly elsewhere. It shells
// `/usr/bin/sandbox-exec`, so it CANNOT run on ubuntu CI — but the gate it used
// to carry (`HELP_AUDIT_OS !== "1"`) was set by nothing in `.github/` and by no
// documented local recipe, so it had never executed anywhere at all.
test("macOS OS confinement is calibrated independently of JavaScript tripwires", { skip: process.platform !== "darwin" }, () => {
  assert.equal(process.platform, "darwin");
  const f = fixture();
  try {
    const profile = `(version 1) (allow default) (deny network*) (deny file-write*) (deny process-exec) (allow process-exec (literal ${JSON.stringify(fs.realpathSync(process.execPath))}))`;
    for (const source of [
      'try { require("node:fs").writeFileSync(process.env.HOME + "/sentinel", "bad"); process.exit(99); } catch(e) { console.log(e.code); }',
      'const r = require("node:child_process").spawnSync("/usr/bin/true"); console.log(r.error?.code); if (!r.error) process.exit(99);',
      'const s = require("node:net").connect(9, "127.0.0.1"); s.on("error", e => console.log(e.code)); s.on("connect", () => process.exit(99));',
    ]) {
      const r = spawnSync("/usr/bin/sandbox-exec", ["-p", profile, process.execPath, "-e", source], { env: f.env, encoding: "utf8", timeout: 8000 });
      assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /EPERM|EACCES/);
    }
    assert.deepEqual(fs.readdirSync(f.home), []);
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }); }
});

test("arity preserves explicit help values and literal/child tails", () => {
  const shape = { values: ["--value"], switches: ["--json"], positionals: 3, equals: true };
  for (const literal of ["help", "--help", "-h", "please help me"]) {
    const args = ["--value=" + literal, "--json"];
    const result = parseCli(args, shape);
    assert.equal(result.help, false); assert.equal(result.flags.get("value"), literal);
    assert.equal(result.flags.get("json"), true);
    assert.equal(hasCliHelp(args, shape.values), false);
  }
  assert.equal(parseCli(["--value", "help", "--json"], shape).help, false);
  assert.equal(hasCliHelp(["--value", "help", "--json"], shape.values), false);
  assert.equal(hasCliHelp(["--", "child", "help", "--help"], []), false);
  assert.deepEqual(parseCli(["--", "child", "help", "--help"], shape).positionals, ["child", "help", "--help"]);
  assert.throws(() => parseCli(["--value", "--json"], shape), /requires a value/);
  assert.throws(() => parseCli(["--value"], shape), /requires a value/);
  assert.throws(() => parseCli(["unexpected", "--json"], { switches: ["--json"] }), /unexpected positional/);
});
