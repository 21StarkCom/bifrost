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

function run(home: string, filePath: string, extraEnv: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, ATLAS_ECOSYSTEM_PATH: path.join(home, "no-corpus"), ...extraEnv };
  if (!("CLAUDE_CONFIG_DIR" in extraEnv)) delete env.CLAUDE_CONFIG_DIR;
  const input = JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath } });
  return spawnSync(process.execPath, ["--no-warnings", CLI], { input, env, encoding: "utf8" });
}

function withMemory(configRel: string, fn: (home: string, cfg: string, memory: string) => void): void {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fact-hook-")));
  try {
    const cfg = path.join(home, configRel);
    const memory = path.join(cfg, "projects", "p", "memory", "probe.md");
    fs.mkdirSync(path.dirname(memory), { recursive: true });
    fs.writeFileSync(memory, MEMORY);
    fn(home, cfg, memory);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
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
  });
});

test("CLAUDE_CONFIG_DIR moves both the memory root and the queue", () => {
  withMemory(".claude-work", (home, cfg, memory) => {
    const r = run(home, memory, { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(queueLines(cfg).length, 1);
    assert.equal(fs.existsSync(path.join(home, ".claude")), false);
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
