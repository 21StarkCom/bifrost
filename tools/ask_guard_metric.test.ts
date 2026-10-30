// ask_guard_metric: the week window, the one-word-reply rule, the transcript
// turn ends and their question tags, the launchd plist, and the CLI end to end
// over a throwaway history and transcripts.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  BASELINE,
  LABEL,
  type QuestionCounts,
  classifyEnding,
  countPrompts,
  countQuestions,
  fileLines,
  isOneWordReply,
  isPrompt,
  normalizeReply,
  notifyBody,
  plist,
  render,
  result,
  title,
  transcriptFiles,
  turnEnds,
  weekWindow,
} from "./ask_guard_metric.ts";

const CLI = path.join(import.meta.dirname, "ask_guard_metric.ts");
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const hist = (display: string, ts: number) => JSON.stringify({ display, timestamp: ts, project: "/p", sessionId: "s" });

// Transcript lines in the shape Claude Code writes them (one content block per line).
const iso = (y: number, m: number, d: number, h = 12) => new Date(at(y, m, d, h)).toISOString();
const T = iso(2026, 10, 24);
const base = { cwd: "/Users/x/Code/21Stark/bifrost", sessionId: "s1", isSidechain: false, userType: "external" };
const asst = (uuid: string, id: string, block: object, ts = T, extra: object = {}) =>
  JSON.stringify({ ...base, type: "assistant", uuid, timestamp: ts, message: { id, role: "assistant", content: [block] }, ...extra });
const user = (uuid: string, content: unknown, ts = T, extra: object = {}) =>
  JSON.stringify({ ...base, type: "user", uuid, timestamp: ts, message: { role: "user", content }, ...extra });
const text = (t: string) => ({ type: "text", text: t });
const thinking = { type: "thinking", thinking: "hmm", signature: "x" };
const toolUse = { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } };
const toolResult = [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }];
const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } };
const noQuestions = (): QuestionCounts => ({ turnEnds: 0, tagged: { GO: 0, Yours: 0, "Your hands": 0, "Design approval": 0 }, untagged: [] });

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
  const r = result(w, p, p, noQuestions());
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

test("a turn end's last non-empty line is tagged by kind, an untagged question, or none", () => {
  const cases: [string, string][] = [
    ["Merged.\nNeeds you (GO: terraform apply of #12): May I apply it?", "GO"],
    ["Two designs fit.\nNeeds you (Yours: the name): Do you want `odin` or `thor`?", "Yours"],
    ["Needs you (Your hands: Touch ID): Approve the keychain prompt.\n\n", "Your hands"],
    ["Here is the spec.\n  Needs you (Design approval): Approve the design above?  ", "Design approval"],
    ["Needs you (Yours: scope): Ship A?\nShould I also ship B?", "untagged"],
    ["Needs you (Maybe): Ship it?", "untagged"],
    ["needs you (GO: x): ok?", "untagged"],
    ["Want me to also fix the README?", "untagged"],
    ["Done. Nothing is pending.", "none"],
    ["Is it right?\nDone. Nothing is pending.", "none"],
    ["", "none"],
    ["The PR is https://github.com/o/r/pull/1?w=1", "none"],
    ["Run `ls -d ?*` to list them.", "none"],
    ["Should I run `ls`?", "untagged"],
    ["Did you see https://github.com/o/r/pull/1?", "untagged"],
    ["**Should I merge it?**", "untagged"],
    ["Is it A?B", "none"],
  ];
  for (const [t, kind] of cases) assert.equal(classifyEnding(t).kind, kind, t);
  // One tagged line per open question: each line of the closing run counts.
  const two = classifyEnding("Done.\nNeeds you (GO: apply): Apply it?\nNeeds you (Yours: name): Which name?");
  assert.equal(two.kind, "Yours");
  assert.deepEqual(two.kinds, ["GO", "Yours"]);
  assert.deepEqual(classifyEnding("Needs you (GO: a): A?\nShould I B?").kinds, []);
  assert.equal(classifyEnding("Done.\n  Should I ship it?  \n").line, "Should I ship it?");
});

test("a prompt is a typed user line, never a tool result, meta, summary or <tag> line", () => {
  const row = (content: unknown, extra: object = {}) => JSON.parse(user("u", content, T, extra));
  assert.equal(isPrompt(row("fix the config")), true);
  assert.equal(isPrompt(row([image, text("what is wrong here?")])), true);
  assert.equal(isPrompt(row([text("[Huginn tab 1 · page]\n\nexplain")])), true);
  assert.equal(isPrompt(row('<pasted_content id="0198">\nodinctl failed\n</pasted_content>\nwhy?')), true);
  assert.equal(isPrompt(row(toolResult)), false);
  assert.equal(isPrompt(row([...toolResult, text("[Request interrupted by user for tool use]")])), false);
  assert.equal(isPrompt(row([text("Base directory for this skill: /x")], { isMeta: true })), false);
  assert.equal(isPrompt(row("This session is being continued…", { isCompactSummary: true })), false);
  assert.equal(isPrompt(row("<task-notification>\n<task-id>b1</task-id>")), false);
  assert.equal(isPrompt(row("<command-name>/goal</command-name>")), false);
  assert.equal(isPrompt(row([text("\n<system-reminder>x</system-reminder>")])), false);
  assert.equal(isPrompt(row([image])), false);
  assert.equal(isPrompt(row(undefined)), false);
});

test("turnEnds reads across the lines of one message, past non-prompt lines, to the end of the file", () => {
  const lines = [
    user("p1", "fix the config"),
    // msg_a: thinking, text, tool_use on three lines: the tool_use cancels the text.
    asst("a1", "msg_a", thinking),
    asst("a2", "msg_a", text("Let me look.")),
    asst("a3", "msg_a", toolUse),
    user("r1", toolResult),
    // Two non-prompt user lines in a row.
    user("m1", [text("Base directory for this skill: /x")], T, { isMeta: true }),
    user("m2", "<local-command-stdout>ok</local-command-stdout>"),
    asst("b1", "msg_b", text("Merged.\nNeeds you (GO: terraform apply): May I apply it?")),
    asst("b2", "msg_b", thinking),
    // A task notification is not a prompt; a sidechain line never counts.
    user("n1", "<task-notification>\n<status>completed</status>\n</task-notification>"),
    asst("s1", "msg_s", text("Want me to?"), T, { isSidechain: true }),
    user("s2", "sidechain prompt", T, { isSidechain: true }),
    "not json",
    JSON.stringify({ type: "progress", data: { message: { type: "user" } } }),
    user("p2", [image, text("and this?")]),
    asst("c1", "msg_c", text("Fixed.")),
    asst("c2", "msg_c", text("Should I ship it?")),
  ];
  const ends = turnEnds(lines);
  assert.deepEqual(ends.map((e) => e.uuid), ["b1", "c2"]);
  assert.equal(ends[1].text, "Should I ship it?");
  assert.equal(ends[1].cwd, "/Users/x/Code/21Stark/bifrost");
  assert.equal(ends[1].sessionId, "s1");
  assert.equal(ends[1].ts, Date.parse(T));
  // Two prompts in a row (an interrupt, then a new prompt) end the turn once.
  assert.deepEqual(turnEnds([user("p", "a"), asst("x", "m", text("Hi?")), user("q", [text("[Request interrupted by user]")]), user("r", "c")]).map((e) => e.uuid), ["x"]);
  // The file ends on a tool_use: no turn end after the last prompt.
  assert.deepEqual(turnEnds([user("p", "go"), asst("x", "m", text("On it.")), asst("y", "m", toolUse)]).map((e) => e.uuid), []);
});

test("countQuestions counts the week only, each uuid once, and keeps the oldest turn end read", () => {
  const w = weekWindow("2026-10-22");
  const fileA = [
    user("p1", "a"), asst("t-go", "m1", text("Needs you (GO: apply): Apply?")),
    user("p2", "b"), asst("t-yours", "m2", text("Needs you (Yours: name): Which name?")),
    user("p3", "c"), asst("t-hands", "m3", text("Needs you (Your hands: /mcp): Run `/mcp`.")),
    user("p4", "d"), asst("t-design", "m4", text("Needs you (Design approval): Approve it?")),
    user("p5", "e"), asst("t-q1", "m5", text("Want me to fix the README too?"), iso(2026, 10, 25)),
    user("p6", "f"), asst("t-done", "m6", text("Done. Nothing is pending.")),
    user("p7", "g"), asst("t-old", "m7", text("Old question?"), iso(2026, 10, 20)),
    user("p8", "h"), asst("t-late", "m8", text("Late question?"), iso(2026, 10, 29, 0)),
    user("p9", "i"), asst("t-two", "m9", text("Needs you (GO: merge): Merge?\nNeeds you (Yours: name): Name?")),
    user("p10", "j"),
  ];
  // A resumed session's file repeats an earlier uuid: it counts once.
  const fileB = [user("q1", "x"), asst("t-q1", "m5", text("Want me to fix the README too?"), iso(2026, 10, 25))];
  const c = countQuestions([fileA, fileB], w);
  assert.equal(c.turnEnds, 7);
  assert.deepEqual(c.tagged, { GO: 2, Yours: 2, "Your hands": 1, "Design approval": 1 });
  assert.deepEqual(c.untagged, [{ ts: at(2026, 10, 25), cwd: "/Users/x/Code/21Stark/bifrost", sessionId: "s1", line: "Want me to fix the README too?" }]);
  assert.equal(c.oldest, at(2026, 10, 20));
});

test("the report adds the question counts, the coverage and the newest untagged questions", () => {
  const w = weekWindow("2026-10-22");
  const p = { prompts: 10, replies: 2, go: 1, words: { go: 1, yes: 1 } };
  const q = noQuestions();
  q.turnEnds = 30;
  q.tagged = { GO: 2, Yours: 1, "Your hands": 0, "Design approval": 1 };
  for (let i = 0; i < 12; i++) {
    q.untagged.push({ ts: at(2026, 10, 22, 1 + i), cwd: `/w/STARK-${i}`, sessionId: `s${i}`, line: `Question ${i}?` });
  }
  q.untagged.push({ ts: at(2026, 10, 23, 9), cwd: "", sessionId: "long", line: "x".repeat(200) + "?" });
  q.oldest = at(2026, 10, 22, 8);
  const r = result(w, p, p, q);
  assert.equal(r.questions.turn_ends, 30);
  assert.equal(r.questions.untagged, 13);
  assert.deepEqual(r.questions.tagged, { GO: 2, Yours: 1, "Your hands": 0, "Design approval": 1 });
  assert.deepEqual(r.questions.coverage, { oldest: "2026-10-22", whole_week: true, days: { from: "2026-10-22", last: "2026-10-28" } });
  const list = r.questions.newest_untagged;
  assert.equal(list.length, 10);
  assert.deepEqual(list[0], { date: "2026-10-23", folder: "", session: "long", line: "x".repeat(160) });
  assert.deepEqual(list[1], { date: "2026-10-22", folder: "STARK-11", session: "s11", line: "Question 11?" });
  assert.equal(list[9].session, "s3");

  const text = render(r);
  assert.match(text, /turn ends\s+30/);
  assert.match(text, /tagged questions\s+4 \(GO 2, Yours 1, Your hands 0, Design approval 1\)/);
  assert.match(text, /untagged\s+13/);
  assert.match(text, /coverage\s+oldest turn end read 2026-10-22\n/);
  assert.doesNotMatch(text, /counted:/);
  assert.match(text, /untagged questions, newest first \(10 of 13\):\n {4}2026-10-23 {2}long\n {6}x{160}\n {4}2026-10-22 {2}STARK-11 {2}s11\n {6}Question 11\?/);
  assert.equal(title(r), "Act, don't ask: 2 one-word replies (baseline 81), 13 untagged questions");
  const body = notifyBody(r).split("\n");
  assert.equal(body.length, 7);
  assert.equal(body[1], "Questions: 4 tagged (GO 2, Yours 1, Your hands 0, Design approval 1), 13 untagged.");
  assert.equal(body[2], `2026-10-23: ${"x".repeat(160)}`);
  assert.equal(body[3], "2026-10-22 STARK-11: Question 11?");
  assert.equal(body[6], "2026-10-22 STARK-8: Question 8?");
});

test("the coverage names the days counted when the transcripts start after the week's first day", () => {
  const w = weekWindow("2026-10-22");
  const p = { prompts: 0, replies: 0, go: 0, words: {} };
  const q = noQuestions();
  q.oldest = at(2026, 10, 27, 15);
  const r = result(w, p, p, q);
  assert.deepEqual(r.questions.coverage, { oldest: "2026-10-27", whole_week: false, days: { from: "2026-10-27", last: "2026-10-28" } });
  assert.match(render(r), /coverage\s+oldest turn end read 2026-10-27\n {2}only 2026-10-27 to 2026-10-28 counted: the transcripts start after the week's first day/);
  assert.match(notifyBody(r), /Note: only 2026-10-27 to 2026-10-28 counted/);
  assert.doesNotMatch(render(r), /untagged questions, newest first/);
  // A transcript older than the week's start is on disk: the first days were quiet, not cleaned up.
  q.reachesBack = true;
  assert.deepEqual(result(w, p, p, q).questions.coverage, { oldest: "2026-10-27", whole_week: true, days: { from: "2026-10-22", last: "2026-10-28" } });
  assert.doesNotMatch(render(result(w, p, p, q)), /counted:/);
  q.reachesBack = undefined;

  q.oldest = at(2026, 10, 29, 1);
  assert.deepEqual(result(w, p, p, q).questions.coverage, { oldest: "2026-10-29", whole_week: false, days: null });
  q.oldest = undefined;
  const none = result(w, p, p, q);
  assert.deepEqual(none.questions.coverage, { oldest: null, whole_week: false, days: null });
  assert.match(render(none), /coverage\s+no turn end read\n {2}no day of the week counted: no transcript reaches it/);
});

test("fileLines splits on newlines across 1 MiB chunks and keeps multibyte text whole", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-lines-"));
  try {
    const file = path.join(dir, "t.jsonl");
    // The 2-byte letters of "שלום" straddle the first 1 MiB chunk boundary.
    const long = "a".repeat((1 << 20) - 3) + "שלום";
    fs.writeFileSync(file, `${long}\nb\n\n${"c".repeat(3 << 20)}\nלא שורה`);
    const lines = [...fileLines(file)];
    assert.equal(lines.length, 5);
    assert.equal(lines[0], long);
    assert.deepEqual(lines.slice(1, 3), ["b", ""]);
    assert.equal(lines[3].length, 3 << 20);
    assert.equal(lines[4], "לא שורה");
    assert.deepEqual([...fileLines(path.join(dir, "gone.jsonl"))], []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("transcriptFiles takes top-level .jsonl files changed since the week's start, never subagent folders", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-files-"));
  try {
    assert.deepEqual(transcriptFiles(dir, new Date(0)), { files: [], reachesBack: false });
    const proj = path.join(dir, "projects", "-Users-x-Code-repo");
    fs.mkdirSync(path.join(proj, "s1", "subagents"), { recursive: true });
    const write = (p: string, mtime: Date) => {
      fs.writeFileSync(p, "");
      fs.utimesSync(p, mtime, mtime);
    };
    write(path.join(proj, "s1.jsonl"), new Date(2026, 9, 25));
    write(path.join(proj, "old.jsonl"), new Date(2026, 9, 20));
    write(path.join(proj, "notes.txt"), new Date(2026, 9, 25));
    write(path.join(proj, "s1", "subagents", "agent-a.jsonl"), new Date(2026, 9, 25));
    write(path.join(dir, "projects", "stray.jsonl"), new Date(2026, 9, 25));
    fs.mkdirSync(path.join(proj, "folder.jsonl"));
    assert.deepEqual(transcriptFiles(dir, new Date(2026, 9, 22)), { files: [path.join(proj, "s1.jsonl")], reachesBack: true });
    assert.deepEqual(transcriptFiles(dir, new Date(2026, 9, 19)).reachesBack, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
    const empty = spawnSync(process.execPath, ["--no-warnings", CLI, "--week", "2026-10-22"], { env, encoding: "utf8" });
    assert.equal(empty.status, 0, empty.stderr);
    assert.match(empty.stdout, /coverage\s+no turn end read\n {2}no day of the week counted/);

    const proj = path.join(cfg, "projects", "-Users-x-Code-21Stark-bifrost");
    fs.mkdirSync(path.join(proj, "s1", "subagents"), { recursive: true });
    // A transcript last changed before the week: the transcripts reach its first day.
    const old = path.join(proj, "old.jsonl");
    fs.writeFileSync(old, "");
    fs.utimesSync(old, new Date(2026, 9, 1), new Date(2026, 9, 1));
    const quiet = spawnSync(process.execPath, ["--no-warnings", CLI, "--week", "2026-10-22", "--json"], { env, encoding: "utf8" });
    assert.equal(quiet.status, 0, quiet.stderr);
    assert.deepEqual(JSON.parse(quiet.stdout).questions.coverage, { oldest: null, whole_week: true, days: { from: "2026-10-22", last: "2026-10-28" } });
    fs.writeFileSync(
      path.join(proj, "s1.jsonl"),
      [
        user("p1", "fix it", iso(2026, 10, 21)),
        asst("t0", "m0", text("Older question?"), iso(2026, 10, 21)),
        user("p2", "next", iso(2026, 10, 23)),
        asst("t1", "m1", text("Needs you (Your hands: Touch ID): Approve the prompt."), iso(2026, 10, 23)),
        user("p3", "and?", iso(2026, 10, 24)),
        asst("t2", "m2", text("Done.\nWant me to open the PR too?"), iso(2026, 10, 24)),
      ].join("\n") + "\n",
    );
    fs.writeFileSync(path.join(proj, "s1", "subagents", "agent-a.jsonl"), asst("sub", "ms", text("Subagent question?"), iso(2026, 10, 24)) + "\n");

    const r = spawnSync(process.execPath, ["--no-warnings", CLI, "--week", "2026-10-22", "--json"], { env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.prompts, 3);
    assert.equal(out.one_word_replies, 2);
    assert.equal(out.go, 1);
    assert.equal("blocks" in out, false);
    assert.equal(out.baseline.replies, 81);
    assert.deepEqual(out.baseline.recount, { replies: 2, go: 1, prompts: 3 });
    assert.deepEqual(out.questions, {
      turn_ends: 2,
      tagged: { GO: 0, Yours: 0, "Your hands": 1, "Design approval": 0 },
      untagged: 1,
      coverage: { oldest: "2026-10-21", whole_week: true, days: { from: "2026-10-22", last: "2026-10-28" } },
      newest_untagged: [{ date: "2026-10-24", folder: "bifrost", session: "s1", line: "Want me to open the PR too?" }],
    });
    const plain = spawnSync(process.execPath, ["--no-warnings", CLI, "--week", "2026-10-22"], { env, encoding: "utf8" });
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /tagged questions\s+1 \(GO 0, Yours 0, Your hands 1, Design approval 0\)\n {2}untagged\s+1\n/);
    assert.match(plain.stdout, /2026-10-24 {2}bifrost {2}s1\n {6}Want me to open the PR too\?/);

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
