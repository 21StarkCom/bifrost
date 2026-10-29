// ask_guard_hook CLI end to end: a Stop input on stdin, a throwaway state root,
// and the two things that matter — the block JSON Claude Code reads on stdout
// and the one log line the weekly metric counts. The block is Stop
// additionalContext, so Claude continues with no hook-error notice.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const CLI = path.join(import.meta.dirname, "ask_guard_hook.ts");

function withState(fn: (state: string, run: (input: unknown, args?: string[]) => ReturnType<typeof spawnSync>) => void): void {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "ask-guard-"));
  try {
    const run = (input: unknown, args: string[] = []) =>
      spawnSync(process.execPath, ["--no-warnings", CLI, ...args], {
        input: typeof input === "string" ? input : JSON.stringify(input),
        env: { ...process.env, STARK_STATE_ROOT: state },
        encoding: "utf8",
      });
    fn(state, run);
  } finally {
    fs.rmSync(state, { recursive: true, force: true });
  }
}

const logOf = (state: string) => path.join(state, "ask-guard", "blocks.jsonl");
const lines = (state: string) =>
  fs.existsSync(logOf(state)) ? fs.readFileSync(logOf(state), "utf8").split("\n").filter(Boolean) : [];

const STOP = {
  session_id: "s-1",
  transcript_path: "/dev/null",
  cwd: "/tmp/repo",
  permission_mode: "bypassPermissions",
  hook_event_name: "Stop",
  stop_hook_active: false,
  last_assistant_message: "The config path is dead.\n\nShould I make that change now?",
};

test("a permission question is blocked with the reason as additionalContext and logged once", () => {
  withState((state, run) => {
    const r = run(STOP);
    assert.equal(r.status, 0, String(r.stderr));
    const out = JSON.parse(String(r.stdout));
    assert.equal(out.decision, undefined, "a block decision shows the operator a hook error");
    assert.equal(out.hookSpecificOutput.hookEventName, "Stop");
    assert.match(out.hookSpecificOutput.additionalContext, /should i make that change now\?/);
    const log = lines(state);
    assert.equal(log.length, 1);
    const entry = JSON.parse(log[0]);
    assert.deepEqual(Object.keys(entry).sort(), ["cwd", "kind", "phrase", "session_id", "time"]);
    assert.equal(entry.session_id, "s-1");
    assert.equal(entry.cwd, "/tmp/repo");
    assert.equal(entry.kind, "ask");
    assert.equal(entry.phrase, "should i make that change now?");
    assert.ok(!Number.isNaN(Date.parse(entry.time)));
  });
});

test("stop_hook_active lets the stop through: no loop", () => {
  withState((state, run) => {
    const r = run({ ...STOP, stop_hook_active: true });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.deepEqual(lines(state), []);
  });
});

test("plan mode lets the stop through", () => {
  withState((state, run) => {
    const r = run({ ...STOP, permission_mode: "plan" });
    assert.equal(r.stdout, "");
    assert.deepEqual(lines(state), []);
  });
});

test("a scope question passes", () => {
  withState((state, run) => {
    const r = run({ ...STOP, last_assistant_message: "Which launch name do you prefer, Atlas or Nova?" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.deepEqual(lines(state), []);
  });
});

test("a deferral blocks, unless the session watches background work", () => {
  withState((state, run) => {
    const msg = "I will relaunch EI-2122 once PR #779 is approved.";
    const blocked = run({ ...STOP, last_assistant_message: msg });
    assert.equal(JSON.parse(String(blocked.stdout)).hookSpecificOutput.hookEventName, "Stop");
    assert.equal(JSON.parse(lines(state)[0]).kind, "defer");
    const watched = run({ ...STOP, last_assistant_message: msg, background_tasks: [{ id: "b1" }] });
    assert.equal(watched.stdout, "");
    assert.equal(lines(state).length, 1);
  });
});

test("bad or empty input exits 0 and prints nothing", () => {
  withState((state, run) => {
    for (const input of ["", "not json", "null", "[]", JSON.stringify({ hook_event_name: "Stop" })]) {
      const r = run(input);
      assert.equal(r.status, 0, input);
      assert.equal(r.stdout, "", input);
    }
    assert.deepEqual(lines(state), []);
  });
});

test("an unwritable log does not cost the block", () => {
  withState((state, run) => {
    fs.writeFileSync(path.join(state, "ask-guard"), "a file where the dir goes");
    const r = run(STOP);
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(String(r.stdout)).hookSpecificOutput.hookEventName, "Stop");
  });
});

test("help prints usage on stdout; any other argument is refused on stderr", () => {
  withState((_state, run) => {
    const h = run("", ["--help"]);
    assert.equal(h.status, 0);
    assert.match(String(h.stdout), /^usage: ask_guard_hook\.ts/);
    const bad = run("", ["--json"]);
    assert.equal(bad.status, 2);
    assert.equal(bad.stdout, "");
    assert.match(String(bad.stderr), /unsupported argument: --json/);
  });
});
