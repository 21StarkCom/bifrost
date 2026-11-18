import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const tool = path.join(import.meta.dirname, "run_list.ts");

// A fake frigg records each call (cap, args, write gate, --confirm) and answers
// like slack.* does. A fake alfred answers `task show --json`, with STARK-3
// done. Both are POSIX shell: a Node start costs up to a second on a busy host.
const FAKE_FRIGG = `#!/bin/sh
cap=$2; args=""; prev=""; confirm=false
for a in "$@"; do
  [ "$prev" = "--json-args" ] && args=$a
  [ "$a" = "--confirm" ] && confirm=true
  prev=$a
done
printf '{"cap":"%s","gate":"%s","confirm":%s,"args":%s}\\n' "$cap" "\${TYR_SLACK_LIST_WRITES_ENABLE:-}" "$confirm" "$args" >> "$FAKE_LOG"
case "$cap" in
  slack.create_list) printf '{"list_id":"F0TEST","schema":[{"key":"title","id":"Col_title"},{"key":"done","id":"Col_done"},{"key":"status","id":"Col_status"},{"key":"kind","id":"Col_kind"},{"key":"epic","id":"Col_epic"},{"key":"pr","id":"Col_pr"},{"key":"notes","id":"Col_notes"}]}' ;;
  slack.auth_test) printf '{"ok":true,"url":"https://x.slack.com/","team_id":"T1","user_id":"U1"}' ;;
  slack.set_list_access) printf '{"list_id":"F0TEST","complete":true}' ;;
  slack.create_list_item) printf '{"item":{"id":"Rec%s"}}' "$(grep -c create_list_item "$FAKE_LOG")" ;;
  slack.update_list_items) printf '{"list_id":"F0TEST","updated":true}' ;;
  *) echo "unknown cap $cap" >&2; exit 2 ;;
esac
`;
const FAKE_ALFRED = `#!/bin/sh
for id; do :; done
state=Open
[ "$id" = "STARK-3" ] && state=done
printf '{"item":{"name":"Title of %s","state":"%s","ref":{"custom_id":"%s","url":"https://app.clickup.com/t/%s"}}}' "$id" "$state" "$id" "$id"
`;

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-list-"));
  const bin = path.join(dir, "bin");
  const progress = path.join(dir, "progress");
  const state = path.join(dir, "state");
  for (const d of [bin, progress, state]) fs.mkdirSync(d);
  fs.writeFileSync(path.join(bin, "frigg"), FAKE_FRIGG, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "alfred"), FAKE_ALFRED, { mode: 0o755 });
  const log = path.join(dir, "frigg.jsonl");
  fs.writeFileSync(log, "");
  // The fakes need only sh, grep and printf; no folder that may hold a real frigg.
  const env = {
    HOME: dir, PATH: [bin, "/usr/bin", "/bin"].join(path.delimiter),
    STARK_STATE_ROOT: state, STARK_PROGRESS_DIR: progress, RUN_LIST_GAP_MS: "0", FAKE_LOG: log,
  };
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [tool, ...args], { cwd: dir, env, encoding: "utf8", timeout: 30_000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const calls = () => fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { cap: string; args: any; gate: string; confirm: boolean });
  const put = (name: string, data: unknown) => fs.writeFileSync(path.join(progress, name), JSON.stringify(data));
  return { dir, progress, state, run, calls, put };
}

test("start makes and shares the List; sync adds each row once and writes the changed cells; watch ends after the run", () => {
  const f = fixture();
  try {
    f.put("super-SUPER-1.json", { epics: ["STARK-1", "STARK-5"], grus: { "STARK-1": { state: "live" }, "STARK-5": { state: "queued" } } });
    f.put("run-STARK-1.json", { epic: "STARK-1", tickets: ["STARK-2", "STARK-3"], titles: { "STARK-2": "two" } });
    f.put("STARK-2.json", { id: "STARK-2", stage: "pr", pr: "https://github.com/o/tyr/pull/7" });
    const kids = path.join(f.dir, "children.json");
    fs.writeFileSync(kids, JSON.stringify({ "STARK-5": ["STARK-6"] }));

    const started = f.run("start", "SUPER-1", "--name", "Test run", "--children", kids, "--no-watch");
    assert.equal(started.status, 0, started.out);
    assert.match(started.out, /List: https:\/\/x\.slack\.com\/lists\/T1\/F0TEST/);
    let calls = f.calls();
    assert.deepEqual(calls.map((c) => c.cap), ["slack.create_list", "slack.auth_test", "slack.set_list_access"]);
    assert.equal(calls[0]!.args.name, "Test run");
    assert.deepEqual(calls[0]!.args.schema[4].options.choices.map((c: { value: string; label: string }) => `${c.value} ${c.label}`), ["STARK-1 01 Title of STARK-1", "STARK-5 02 Title of STARK-5"]);
    assert.deepEqual([calls[0]!.gate, calls[0]!.confirm, calls[1]!.gate, calls[1]!.confirm], ["1", true, "", false]);
    assert.deepEqual(calls[2]!.args, { list_id: "F0TEST", access_level: "write", user_ids: ["U1"] });

    const first = f.run("sync", "SUPER-1", "--alfred");
    assert.equal(first.status, 0, first.out);
    assert.match(first.out, /5 rows added/);
    calls = f.calls();
    const made = calls.filter((c) => c.cap === "slack.create_list_item");
    assert.deepEqual(made.map((c) => c.args.initial_fields[0].rich_text[0].elements[0].elements[0].text), ["STARK-1", "STARK-2", "STARK-3", "STARK-5", "STARK-6"]);
    assert.ok(made.every((c) => c.gate === "1" && c.confirm));
    const update = calls.filter((c) => c.cap === "slack.update_list_items");
    assert.equal(update.length, 1);
    const cells = update[0]!.args.cells as Array<Record<string, unknown>>;
    assert.ok(cells.some((c) => c.column_id === "Col_status" && (c.select as string[])[0] === "pr_open"));
    assert.ok(cells.some((c) => c.column_id === "Col_pr" && JSON.stringify(c.rich_text).includes("tyr#7")));
    assert.ok(cells.some((c) => c.column_id === "Col_notes" && c.text === "1 of 2 done, Gru live"));

    const before = f.calls().length;
    const second = f.run("sync", "SUPER-1");
    assert.equal(second.status, 0, second.out);
    assert.match(second.out, /0 rows added, 0 cells/);
    assert.equal(f.calls().length, before);

    fs.rmSync(path.join(f.progress, "super-SUPER-1.json"));
    const watched = f.run("watch", "SUPER-1", "--interval", "1");
    assert.equal(watched.status, 0, watched.out);
    assert.match(watched.out, /run file gone: final sync done, watcher ends/);
    assert.match(watched.out, /STARK-1 status=blocked/);
    assert.equal(fs.existsSync(path.join(f.state, "run-lists", "SUPER-1.pid")), false);

    const stopped = f.run("stop", "SUPER-1");
    assert.equal(stopped.status, 0, stopped.out);
    assert.match(stopped.out, /no watcher of SUPER-1 runs/);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("a --tickets Gru run gets no epic row, and a missing run file refuses", () => {
  const f = fixture();
  try {
    assert.match(f.run("start", "GRU-20", "--no-watch").out, /no run file for GRU-20/);
    assert.equal(f.calls().length, 0);
    f.put("run-GRU-20.json", { epic: "STARK-20", tickets: ["STARK-20", "STARK-21"] });
    assert.equal(f.run("start", "GRU-20", "--no-watch").status, 0);
    assert.equal(f.calls()[0]!.args.name, "GRU-20 (Gru)");
    const synced = f.run("sync", "GRU-20");
    assert.equal(synced.status, 0, synced.out);
    const made = f.calls().filter((c) => c.cap === "slack.create_list_item");
    assert.deepEqual(made.map((c) => c.args.initial_fields[2].select[0]), ["task", "task"]);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("bad arguments refuse with the usage and exit 2", () => {
  const f = fixture();
  try {
    for (const args of [["start"], ["go", "SUPER-1"], ["sync", "SUPER-1", "--name", "x"], ["watch", "SUPER-1", "--interval", "0"], ["start", "SUPER-1", "--bogus"]]) {
      const r = f.run(...args);
      assert.equal(r.status, 2, `${args.join(" ")}: ${r.out}`);
      assert.match(r.out, /usage: run_list\.ts/);
    }
    const bad = f.run("sync", "nope");
    assert.equal(bad.status, 1);
    assert.match(bad.out, /not a run id/);
    assert.equal(f.calls().length, 0);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});
