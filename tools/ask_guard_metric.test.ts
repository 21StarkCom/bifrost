// ask_guard_metric: the week window, the one-word-reply rule, the launchd
// plist, and the CLI end to end over a throwaway history.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  BASELINE,
  LABEL,
  countPrompts,
  isOneWordReply,
  normalizeReply,
  plist,
  render,
  result,
  weekWindow,
} from "./ask_guard_metric.ts";

const CLI = path.join(import.meta.dirname, "ask_guard_metric.ts");
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const hist = (display: string, ts: number) => JSON.stringify({ display, timestamp: ts, project: "/p", sessionId: "s" });

test("the week is 7 local days from midnight of --week", () => {
  const w = weekWindow("2026-10-22");
  assert.equal(w.start.getTime(), new Date(2026, 9, 22).getTime());
  assert.equal(w.end.getTime(), new Date(2026, 9, 29).getTime());
});

test("the default week is the 7 days before today", () => {
  const w = weekWindow(undefined, new Date(2026, 10, 5, 9, 0));
  assert.equal(w.start.getTime(), new Date(2026, 9, 29).getTime());
  assert.equal(w.end.getTime(), new Date(2026, 10, 5).getTime());
});

test("a bad --week is refused", () => {
  assert.throws(() => weekWindow("2026-13-01"), /no such date/);
  assert.throws(() => weekWindow("22/10/2026"), /YYYY-MM-DD/);
});

test("a one-word reply is a nudge or an option pick, after normalizing", () => {
  for (const s of ["go", "Go.", "  continue ", "yes!", "ship it", "Fix it", "merge", "approved", "1", "A", "c"]) {
    assert.equal(isOneWordReply(normalizeReply(s)), true, s);
  }
  for (const s of ["retry", "done", "status", "go release odinctl", "f", "10", "/exit", "", "yes. go"]) {
    assert.equal(isOneWordReply(normalizeReply(s)), false, s);
  }
  assert.equal(normalizeReply(42), "");
});

test("countPrompts counts the week only, and skips bad lines", () => {
  const w = weekWindow("2026-10-22");
  const lines = [
    hist("go", at(2026, 10, 22, 0)),
    hist("go", at(2026, 10, 28, 23)),
    hist("1", at(2026, 10, 25)),
    hist("please fix the config path", at(2026, 10, 25)),
    hist("/exit", at(2026, 10, 25)),
    hist("go", at(2026, 10, 29, 0)),
    hist("go", at(2026, 10, 21, 23)),
    "not json",
    "",
    JSON.stringify({ display: "go" }),
  ];
  const c = countPrompts(lines, w);
  assert.equal(c.prompts, 5);
  assert.equal(c.replies, 3);
  assert.equal(c.go, 2);
  assert.deepEqual(c.words, { go: 2, "1": 1 });
});

test("the report names the week, the counts and the baseline", () => {
  const w = weekWindow("2026-10-22");
  const p = { prompts: 2353, replies: 84, go: 39, words: { go: 39, "1": 6 } };
  const r = result(w, p, p);
  assert.deepEqual(r.week, { start: "2026-10-22", last: "2026-10-28" });
  assert.deepEqual(r.words, [["go", 39], ["1", 6]]);
  const text = render(r);
  assert.match(text, /week 2026-10-22 to 2026-10-28/);
  assert.match(text, /prompts\s+2,353/);
  assert.match(text, /one-word replies\s+84 \(go 39, 1 6\)/);
  assert.doesNotMatch(text, /hook blocks/);
  assert.match(text, /baseline, week of 2026-10-22: 81 one-word replies, 39 go, 2,375 prompts \(this rule counts 84, 39, 2,353\)/);
  assert.deepEqual({ ...BASELINE }, { week: "2026-10-22", replies: 81, go: 39, prompts: 2375 });
});

test("the plist runs --notify on Thursdays at 09:00 through env node", () => {
  const p = plist("/x/tools/ask_guard_metric.ts", "/s/ask-guard/weekly.log", "/opt/homebrew/bin:/usr/bin");
  assert.match(p, new RegExp(`<key>Label</key><string>${LABEL}</string>`));
  assert.match(p, /<string>\/usr\/bin\/env<\/string>\s*<string>node<\/string>\s*<string>\/x\/tools\/ask_guard_metric\.ts<\/string>\s*<string>--notify<\/string>/);
  assert.match(p, /<key>Weekday<\/key><integer>4<\/integer><key>Hour<\/key><integer>9<\/integer><key>Minute<\/key><integer>0<\/integer>/);
  assert.match(p, /<key>StandardOutPath<\/key><string>\/s\/ask-guard\/weekly\.log<\/string>/);
  assert.match(plist("/a&b", "/l", "/p"), /\/a&amp;b/);
});

test("the CLI reads history from a throwaway home", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ask-metric-"));
  try {
    const cfg = path.join(home, ".claude");
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(
      path.join(cfg, "history.jsonl"),
      [hist("go", at(2026, 10, 23)), hist("yes", at(2026, 10, 23)), hist("explain this", at(2026, 10, 24))].join("\n") + "\n",
    );
    const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: cfg, STARK_STATE_ROOT: path.join(home, "state") };
    const r = spawnSync(process.execPath, ["--no-warnings", CLI, "--week", "2026-10-22", "--json"], { env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.prompts, 3);
    assert.equal(out.one_word_replies, 2);
    assert.equal(out.go, 1);
    assert.equal("blocks" in out, false);
    assert.equal(out.baseline.replies, 81);
    assert.deepEqual(out.baseline.recount, { replies: 2, go: 1, prompts: 3 });

    const bad = spawnSync(process.execPath, ["--no-warnings", CLI, "--week", "nope"], { env, encoding: "utf8" });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /YYYY-MM-DD/);
    const both = spawnSync(process.execPath, ["--no-warnings", CLI, "--install-schedule", "--notify"], { env, encoding: "utf8" });
    assert.equal(both.status, 2);
    assert.match(both.stderr, /takes no other argument/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
