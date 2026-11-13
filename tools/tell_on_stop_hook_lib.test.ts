// tell_on_stop_hook: the turn count, the threshold steps, the state file, the
// skips, and each fault, which must print nothing. The last tests run the
// entrypoint as Claude Code does: a Stop payload on stdin, exit 0 always.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  ASK_TEXT,
  DEFAULT_TURNS,
  claudeJsonPath,
  countTurns,
  decide,
  hasLibrarianServer,
  inLibrarianState,
  isHeadless,
  lastAsk,
  statePath,
  threshold,
  writeAsk,
} from "./tell_on_stop_hook_lib.ts";

const CLI = path.join(import.meta.dirname, "tell_on_stop_hook.ts");
const SID = "0b5c6c1e-8f2a-4d3b-9c7e-1a2b3c4d5e6f";
const ASK = JSON.stringify({ decision: "block", reason: ASK_TEXT });
const LIBRARIAN_CONFIG = {
  numStartups: 3,
  mcpServers: { alfred: { type: "http", url: "http://127.0.0.1:8823/mcp" }, librarian: { type: "stdio", command: "librarian", args: ["mcp"] } },
};

/** One main-agent model turn: two lines (a text block and a tool call) under one message id. */
function turn(id: string, sidechain = false): string {
  const base = { type: "assistant", isSidechain: sidechain, message: { id, role: "assistant" } };
  return [
    JSON.stringify({ ...base, message: { ...base.message, content: [{ type: "text", text: "x" }] } }),
    JSON.stringify({ ...base, message: { ...base.message, content: [{ type: "tool_use", name: "Bash" }] } }),
  ].join("\n");
}

function transcript(turns: number, start = 0): string {
  const lines: string[] = [];
  for (let i = start; i < start + turns; i++) {
    lines.push(JSON.stringify({ type: "user", isSidechain: false, message: { role: "user", content: "go" } }));
    lines.push(turn(`msg_${i}`));
  }
  return `${lines.join("\n")}\n`;
}

interface Box {
  dir: string;
  home: string;
  root: string;
  cwd: string;
  file: string;
  payload: (extra?: Record<string, unknown>) => string;
  write: (text: string) => void;
}

function withBox(fn: (b: Box) => void): void {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tell-on-stop-")));
  try {
    const home = path.join(dir, "home");
    const root = path.join(dir, "state");
    const cwd = path.join(dir, "repo");
    fs.mkdirSync(home);
    fs.mkdirSync(cwd);
    // The user config of a machine where `librarian install` ran.
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify(LIBRARIAN_CONFIG));
    const file = path.join(dir, "transcript.jsonl");
    const payload = (extra: Record<string, unknown> = {}) =>
      JSON.stringify({
        session_id: SID,
        transcript_path: file,
        cwd,
        hook_event_name: "Stop",
        stop_hook_active: false,
        ...extra,
      });
    fn({ dir, home, root, cwd, file, payload, write: (text) => fs.writeFileSync(file, text) });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── the turn count ──────────────────────────────────────────────────────────

test("countTurns counts distinct message ids of main-agent assistant lines only", () => {
  const text = [
    turn("msg_a"),
    turn("msg_a"), // the same turn again: still one
    turn("msg_b"),
    turn("msg_side", true), // a subagent's turn
    JSON.stringify({ type: "user", message: { id: "msg_user", content: "hi" } }),
    JSON.stringify({ type: "assistant", message: { content: "no id" } }),
    JSON.stringify({ type: "summary", summary: "s" }),
    "",
    "   ",
  ].join("\n");
  assert.equal(countTurns(text), 2);
});

test("countTurns keeps a line whole when a JSON string holds U+2028 or U+2029", () => {
  const odd = JSON.stringify({
    type: "assistant",
    isSidechain: false,
    message: { id: "msg_odd", content: [{ type: "text", text: "one two three" }] },
  });
  // JSON.stringify leaves both characters raw, as a transcript holds them.
  assert.ok(odd.includes(" ") && odd.includes(" "));
  assert.equal(countTurns(`${turn("msg_a")}\n${odd}\n`), 2);
});

test("countTurns throws on any line that does not parse", () => {
  assert.throws(() => countTurns(`${turn("msg_a")}\n{"type":"assistant",\n`));
  assert.throws(() => countTurns(`${turn("msg_a")}\n{"type":"user",\n`));
  // A crash can leave a line of NUL bytes at the end of a transcript.
  assert.throws(() => countTurns(`${turn("msg_a")}\n${"\u0000".repeat(64)}`));
});

// ── the threshold ───────────────────────────────────────────────────────────

test("threshold is 160, or the positive whole number in STARK_TELL_ON_STOP_TURNS", () => {
  assert.equal(DEFAULT_TURNS, 160);
  assert.equal(threshold({}), 160);
  assert.equal(threshold({ STARK_TELL_ON_STOP_TURNS: "5" }), 5);
  assert.equal(threshold({ STARK_TELL_ON_STOP_TURNS: " 12 " }), 12);
  for (const bad of ["", "0", "-3", "2.5", "ten", "1e3", "99999999999999999999"]) {
    assert.equal(threshold({ STARK_TELL_ON_STOP_TURNS: bad }), 160, `"${bad}" falls back to 160`);
  }
});

test("decide asks at each threshold step and is silent between them", () => {
  withBox((b) => {
    const env = { STARK_TELL_ON_STOP_TURNS: "5" };
    const run = () => decide(b.payload(), { env, home: b.home, root: b.root });
    b.write(transcript(4));
    assert.equal(run(), null, "4 < 0 + 5");
    b.write(transcript(5));
    assert.equal(run(), ASK, "5 >= 0 + 5");
    assert.equal(run(), null, "5 < 5 + 5: the same count does not ask again");
    b.write(transcript(9));
    assert.equal(run(), null, "9 < 5 + 5");
    b.write(transcript(10));
    assert.equal(run(), ASK, "10 >= 5 + 5");
    b.write(transcript(17));
    assert.equal(run(), ASK, "17 >= 10 + 5");
    assert.equal(lastAsk(statePath(SID, b.root)), 17);
  });
});

test("decide uses 160 when STARK_TELL_ON_STOP_TURNS is not set", () => {
  withBox((b) => {
    const run = () => decide(b.payload(), { env: {}, home: b.home, root: b.root });
    b.write(transcript(159));
    assert.equal(run(), null);
    b.write(transcript(160));
    assert.equal(run(), ASK);
    b.write(transcript(319));
    assert.equal(run(), null);
    b.write(transcript(320));
    assert.equal(run(), ASK);
  });
});

test("decide never asks when stop_hook_active is true", () => {
  withBox((b) => {
    b.write(transcript(500));
    assert.equal(decide(b.payload({ stop_hook_active: true }), { env: {}, home: b.home, root: b.root }), null);
    assert.equal(fs.existsSync(statePath(SID, b.root)), false, "no ask records no count");
  });
});

test("decide never asks in a headless run, and asks in an interactive one", () => {
  withBox((b) => {
    b.write(transcript(500));
    for (const entry of ["sdk-cli", "sdk-ts", "sdk-py"]) {
      assert.equal(isHeadless({ CLAUDE_CODE_ENTRYPOINT: entry }), true, entry);
      const env = { CLAUDE_CODE_ENTRYPOINT: entry };
      assert.equal(decide(b.payload(), { env, home: b.home, root: b.root }), null, entry);
    }
    assert.equal(fs.existsSync(statePath(SID, b.root)), false, "no ask records no count");
    for (const entry of ["cli", "claude-desktop", "claude-vscode", undefined]) {
      assert.equal(isHeadless({ CLAUDE_CODE_ENTRYPOINT: entry }), false, String(entry));
    }
    const env = { CLAUDE_CODE_ENTRYPOINT: "cli" };
    assert.equal(decide(b.payload(), { env, home: b.home, root: b.root }), ASK, "cli asks");
  });
});

test("decide asks only when the user's Claude config names a librarian MCP server", () => {
  withBox((b) => {
    b.write(transcript(500));
    const config = path.join(b.home, ".claude.json");
    const run = (env: NodeJS.ProcessEnv = {}) => decide(b.payload(), { env, home: b.home, root: b.root });
    const cases: [string, string | null][] = [
      ["no file", null],
      ["not JSON", "{"],
      ["null", "null"],
      ["no mcpServers", JSON.stringify({ numStartups: 3 })],
      ["mcpServers is not an object", JSON.stringify({ mcpServers: "librarian" })],
      ["other servers only", JSON.stringify({ mcpServers: { alfred: {}, meridian: {} } })],
      ["librarian in one project only", JSON.stringify({ projects: { [b.cwd]: { mcpServers: { librarian: {} } } } })],
    ];
    for (const [label, text] of cases) {
      fs.rmSync(config, { force: true });
      if (text !== null) fs.writeFileSync(config, text);
      assert.equal(run(), null, label);
      assert.equal(fs.existsSync(statePath(SID, b.root)), false, `${label}: no ask records no count`);
    }
    fs.writeFileSync(config, JSON.stringify(LIBRARIAN_CONFIG));
    assert.equal(run(), ASK, "a librarian server asks");
  });
});

test("the Claude config is $CLAUDE_CONFIG_DIR/.claude.json when that is set, else ~/.claude.json", () => {
  withBox((b) => {
    assert.equal(claudeJsonPath({}, b.home), path.join(b.home, ".claude.json"));
    const dir = path.join(b.dir, "cfg");
    assert.equal(claudeJsonPath({ CLAUDE_CONFIG_DIR: dir }, b.home), path.join(dir, ".claude.json"));
    assert.equal(hasLibrarianServer(path.join(b.home, ".claude.json")), true);
    b.write(transcript(500));
    // The home config names the librarian, but CLAUDE_CONFIG_DIR points elsewhere, at no file.
    const env = { CLAUDE_CONFIG_DIR: dir };
    assert.equal(decide(b.payload(), { env, home: b.home, root: b.root }), null);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, ".claude.json"), JSON.stringify(LIBRARIAN_CONFIG));
    assert.equal(decide(b.payload(), { env, home: b.home, root: b.root }), ASK);
  });
});

// ── the state file ──────────────────────────────────────────────────────────

test("the state file holds the count of the last ask, mode 0600, at <root>/tell-on-stop/<session>.json", () => {
  withBox((b) => {
    b.write(transcript(160));
    assert.equal(decide(b.payload(), { env: {}, home: b.home, root: b.root }), ASK);
    const file = path.join(b.root, "tell-on-stop", `${SID}.json`);
    assert.equal(statePath(SID, b.root), file);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).turns, 160);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), [`${SID}.json`], "no temp file is left");
  });
});

test("writeAsk keeps mode 0600 when it replaces a file", () => {
  withBox((b) => {
    const file = statePath(SID, b.root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"turns":1}\n', { mode: 0o644 });
    writeAsk(file, 7);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(lastAsk(file), 7);
  });
});

test("lastAsk is 0 with no file, and throws on a file with no whole-number turns", () => {
  withBox((b) => {
    const file = statePath(SID, b.root);
    assert.equal(lastAsk(file), 0);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const bad of ["{", '{"turns":"9"}', '{"turns":-1}', '{"turns":1.5}', "null"]) {
      fs.writeFileSync(file, bad);
      assert.throws(() => lastAsk(file), `${bad} throws`);
    }
  });
});

test("stateRoot() places the file under STARK_STATE_ROOT when no root is passed", () => {
  withBox((b) => {
    const saved = process.env.STARK_STATE_ROOT;
    process.env.STARK_STATE_ROOT = b.root;
    try {
      b.write(transcript(160));
      assert.equal(decide(b.payload(), { env: {}, home: b.home }), ASK);
      assert.ok(fs.existsSync(path.join(b.root, "tell-on-stop", `${SID}.json`)));
    } finally {
      if (saved === undefined) delete process.env.STARK_STATE_ROOT;
      else process.env.STARK_STATE_ROOT = saved;
    }
  });
});

// ── the skips ───────────────────────────────────────────────────────────────

test("decide never asks for a session id that is not a UUID, and writes no file", () => {
  withBox((b) => {
    b.write(transcript(500));
    for (const sid of ["../../etc/passwd", "abc", "", 42, null, `${SID}x`, `x${SID}`]) {
      assert.equal(decide(b.payload({ session_id: sid }), { env: {}, home: b.home, root: b.root }), null, String(sid));
    }
    assert.equal(fs.existsSync(path.join(b.root, "tell-on-stop")), false);
  });
});

test("decide never asks in the librarian's folder or under it", () => {
  withBox((b) => {
    b.write(transcript(500));
    const lib = path.join(b.home, ".local", "state", "atlas", "librarian");
    for (const cwd of [lib, path.join(lib, "claude", "s1")]) {
      assert.equal(inLibrarianState(cwd, b.home), true, cwd);
      assert.equal(decide(b.payload({ cwd }), { env: {}, home: b.home, root: b.root }), null, cwd);
    }
    assert.equal(inLibrarianState(path.join(lib, "..notes"), b.home), true, "a child whose name starts with ..");
    for (const cwd of [path.join(b.home, ".local", "state", "atlas"), `${lib}-other`, b.cwd]) {
      assert.equal(inLibrarianState(cwd, b.home), false, cwd);
    }
    assert.equal(decide(b.payload(), { env: {}, home: b.home, root: b.root }), ASK, "a repo folder asks");
  });
});

// ── the faults: each prints nothing ─────────────────────────────────────────

test("each fault returns no ask", () => {
  withBox((b) => {
    const opts = { env: {}, home: b.home, root: b.root };
    // No transcript file.
    assert.equal(decide(b.payload(), opts), null, "no transcript");
    // No transcript path, or one of the wrong type.
    assert.equal(decide(b.payload({ transcript_path: undefined }), opts), null, "no transcript_path");
    assert.equal(decide(b.payload({ transcript_path: 7 }), opts), null, "transcript_path not a string");
    // No cwd.
    b.write(transcript(500));
    assert.equal(decide(b.payload({ cwd: undefined }), opts), null, "no cwd");
    // A line that does not parse.
    b.write(`${transcript(500)}{"type":"assistant",\n`);
    assert.equal(decide(b.payload(), opts), null, "a bad line");
    // A payload that does not parse, or is not an object.
    for (const raw of ["", "{", "null", "[]", '"x"']) assert.equal(decide(raw, opts), null, `payload ${raw}`);
    // A state file that does not parse.
    b.write(transcript(500));
    fs.mkdirSync(path.join(b.root, "tell-on-stop"), { recursive: true });
    fs.writeFileSync(statePath(SID, b.root), "{");
    assert.equal(decide(b.payload(), opts), null, "a bad state file");
  });
});

test("a state file it cannot write means no ask", () => {
  withBox((b) => {
    b.write(transcript(500));
    // A state root under a regular file: mkdir fails with ENOTDIR, even as root.
    const blocked = path.join(b.dir, "plain-file");
    fs.writeFileSync(blocked, "x");
    assert.equal(decide(b.payload(), { env: {}, home: b.home, root: path.join(blocked, "state") }), null);
  });
});

// ── the entrypoint, as Claude Code runs it ──────────────────────────────────

function hook(b: Box, input: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
  // The test may itself run inside a headless claude: the hook must see an interactive one.
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: b.home, STARK_STATE_ROOT: b.root, CLAUDE_CODE_ENTRYPOINT: "cli" };
  delete env.STARK_TELL_ON_STOP_TURNS;
  delete env.CLAUDE_CONFIG_DIR;
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, ["--no-warnings", CLI, ...args], { input, env, encoding: "utf8" });
}

test("the hook prints the block line at the threshold, and nothing below it", () => {
  withBox((b) => {
    b.write(transcript(4));
    let r = hook(b, b.payload(), [], { STARK_TELL_ON_STOP_TURNS: "5" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    b.write(transcript(5));
    r = hook(b, b.payload(), [], { STARK_TELL_ON_STOP_TURNS: "5" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { decision: "block", reason: ASK_TEXT });
    assert.equal(r.stdout, `${ASK}\n`);
    r = hook(b, b.payload({ stop_hook_active: true }), [], { STARK_TELL_ON_STOP_TURNS: "1" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    r = hook(b, b.payload(), [], { STARK_TELL_ON_STOP_TURNS: "1", CLAUDE_CODE_ENTRYPOINT: "sdk-cli" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "", "a headless run");
  });
});

test("the hook prints nothing and exits 0 on each fault", () => {
  withBox((b) => {
    const cases: [string, string][] = [
      ["empty stdin", ""],
      ["bad JSON", "{"],
      ["no transcript", b.payload()],
    ];
    for (const [label, input] of cases) {
      const r = hook(b, input);
      assert.equal(r.status, 0, `${label}: ${r.stderr}`);
      assert.equal(r.stdout, "", label);
      assert.equal(r.stderr, "", label);
    }
    b.write(`${transcript(200)}not json\n`);
    let r = hook(b, b.payload());
    assert.deepEqual([r.status, r.stdout], [0, ""], "bad line");
    b.write(transcript(200));
    const blocked = path.join(b.dir, "plain-file");
    fs.writeFileSync(blocked, "x");
    r = hook(b, b.payload(), [], { STARK_STATE_ROOT: path.join(blocked, "state") });
    assert.deepEqual([r.status, r.stdout], [0, ""], "unwritable state");
  });
});

test("the hook answers help with its usage and refuses any other argument", () => {
  withBox((b) => {
    for (const h of ["help", "--help", "-h"]) {
      const r = hook(b, "", [h]);
      assert.equal(r.status, 0, h);
      assert.match(r.stdout, /^usage: tell_on_stop_hook\.ts/, h);
    }
    const bad = hook(b, "", ["--nope"]);
    assert.equal(bad.status, 2);
    assert.equal(bad.stdout, "");
    assert.match(bad.stderr, /unknown argument: --nope/);
  });
});
