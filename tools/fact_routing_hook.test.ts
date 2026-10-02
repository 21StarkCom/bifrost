// fact_routing_hook CLI end to end: a PostToolUse payload on stdin, a throwaway
// HOME, and the two things Claude Code consumes — the queue line and the stdout
// JSON whose `additionalContext` is the only PostToolUse output the model sees.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const CLI = path.join(import.meta.dirname, "fact_routing_hook.ts");
const MEMORY = "---\nname: probe\ndescription: alfred is the tool for tickets\ntype: project\n---\nReach for alfred instead of fenrir.\n";
// A slug only the fixture corpus knows: a flag naming it proves the hook read
// the corpus, since no built-in list carries it.
const FIXTURE_ONLY = "---\nname: probe\ndescription: reach for zz-fixture-repo for probes\ntype: project\n---\nNothing else.\n";
const FALLBACK_NOTE = /no fleet entity found under .*built-in list of \d+ slugs/;

function run(home: string, filePath: string, extraEnv: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, ATLAS_ECOSYSTEM_PATH: path.join(home, "corpus"), ...extraEnv };
  if (!("CLAUDE_CONFIG_DIR" in extraEnv)) delete env.CLAUDE_CONFIG_DIR;
  const input = JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath } });
  return spawnSync(process.execPath, ["--no-warnings", CLI], { input, env, encoding: "utf8" });
}

// A throwaway HOME holding one auto-memory file and a folder-per-entity corpus.
function withMemory(configRel: string, fn: (home: string, cfg: string, memory: string) => void, content = MEMORY): void {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fact-hook-")));
  try {
    const cfg = path.join(home, configRel);
    const memory = path.join(cfg, "projects", "p", "memory", "probe.md");
    fs.mkdirSync(path.dirname(memory), { recursive: true });
    fs.writeFileSync(memory, content);
    for (const rel of ["repos/alfred", "systems/zz-fixture-repo"]) {
      fs.mkdirSync(path.join(home, "corpus", rel), { recursive: true });
      fs.writeFileSync(path.join(home, "corpus", rel, "index.md"), "x");
    }
    fn(home, cfg, memory);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function advisoryOf(stdout: string): string {
  return JSON.parse(stdout).hookSpecificOutput.additionalContext;
}

function queueLines(cfg: string): string[] {
  const q = path.join(cfg, ".fact-routing-queue.jsonl");
  return fs.existsSync(q) ? fs.readFileSync(q, "utf8").split("\n").filter(Boolean) : [];
}

test("a flagged memory is queued and its advisory reaches the model as additionalContext", () => {
  withMemory(".claude", (home, cfg, memory) => {
    const r = run(home, memory);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
    assert.match(out.hookSpecificOutput.additionalContext, /^↳ fact-routing: probe\.md looks like it belongs in the vault-ecosystem corpus/);
    assert.ok(out.hookSpecificOutput.additionalContext.includes(path.join(cfg, ".fact-routing-queue.jsonl")));
    assert.equal(queueLines(cfg).length, 1);
    assert.equal(JSON.parse(queueLines(cfg)[0]).file, memory);
    assert.doesNotMatch(out.hookSpecificOutput.additionalContext, FALLBACK_NOTE);
  });
});

test("slugs come from the corpus checkout's entity folders, not the built-in list", () => {
  withMemory(".claude", (home, cfg, memory) => {
    const r = run(home, memory);
    assert.equal(r.status, 0, r.stderr);
    assert.match(advisoryOf(r.stdout), /mentions zz-fixture-repo /);
    assert.doesNotMatch(advisoryOf(r.stdout), FALLBACK_NOTE);
    assert.equal(queueLines(cfg).length, 1);
  }, FIXTURE_ONLY);
});

test("with no corpus the hook falls back to the built-in list and says so, flag or no flag", () => {
  withMemory(".claude", (home, cfg, memory) => {
    const flagged = run(home, memory, { ATLAS_ECOSYSTEM_PATH: path.join(home, "no-corpus") });
    assert.equal(flagged.status, 0, flagged.stderr);
    const [advisory, note, ...rest] = advisoryOf(flagged.stdout).split("\n");
    assert.match(advisory, /^↳ fact-routing: probe\.md looks like it belongs in the vault-ecosystem corpus/);
    assert.match(note, FALLBACK_NOTE);
    assert.ok(note.includes(path.join(home, "no-corpus")));
    assert.deepEqual(rest, []);
    assert.equal(queueLines(cfg).length, 1);
  });
  // The fixture-only slug is in no built-in list, so nothing is flagged or
  // queued — and the fallback is still announced.
  withMemory(".claude", (home, cfg, memory) => {
    const quiet = run(home, memory, { ATLAS_ECOSYSTEM_PATH: path.join(home, "no-corpus") });
    assert.equal(quiet.status, 0, quiet.stderr);
    assert.match(advisoryOf(quiet.stdout), FALLBACK_NOTE);
    assert.doesNotMatch(advisoryOf(quiet.stdout), /looks like it belongs/);
    assert.deepEqual(queueLines(cfg), []);
  }, FIXTURE_ONLY);
});

test("an unflagged memory under a readable corpus prints nothing", () => {
  withMemory(".claude", (home, cfg, memory) => {
    const r = run(home, memory);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    assert.deepEqual(queueLines(cfg), []);
  }, "---\nname: probe\ntype: project\n---\nRemember to buy milk.\n");
});

test("CLAUDE_CONFIG_DIR moves the memory root and the queue, and the fold reads that queue", () => {
  withMemory(".claude-work", (home, cfg, memory) => {
    const r = run(home, memory, { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(queueLines(cfg).length, 1);
    assert.equal(fs.existsSync(path.join(home, ".claude")), false);

    const fold = spawnSync(process.execPath, ["--no-warnings", path.join(import.meta.dirname, "fact_routing_fold.ts")], {
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: cfg },
      encoding: "utf8",
    });
    assert.equal(fold.status, 0, fold.stderr);
    assert.match(fold.stdout, /→ vault-ecosystem corpus {2}\(1\)/);
  });
});

test("a repo's own .claude/projects/*/memory file is not auto-memory: no output, no queue", () => {
  withMemory(path.join("Code", "r", ".claude"), (home, cfg, memory) => {
    const r = run(home, memory); // the profile is ~/.claude, not the repo's .claude
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    assert.deepEqual(queueLines(cfg), []);
    assert.deepEqual(queueLines(path.join(home, ".claude")), []);
  });
});
