// ask-guard classifier: the six real endings from 2026-10-28 transcripts block,
// close variants block, and the counter-examples the root rules leave to the
// operator (or that are not questions at all) pass.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifyEnding, reasonFor, tail, watching } from "./ask_guard_lib.ts";

// Real turn endings that should have been actions (STARK ticket's Goal source).
const REAL: [string, "ask" | "defer"][] = [
  ["I found the dead path in config.toml.\n\nShould I file the ticket and fix the config path?", "ask"],
  ["The path in `~/.config/x.toml` is dead.\n\nShould I make that change now?", "ask"],
  ["Both points hold.\n\nShould I add these two points as comments on STARK-13580 and STARK-13579?", "ask"],
  ["Should I file a ticket for the stream fix and the archive?", "ask"],
  ["C2 is not in this run.\n\nTell me if you want me to add C2 to this run and launch a Minion for it.", "ask"],
  ["PR #779 waits on review.\n\nI will relaunch EI-2122 once PR #779 is approved.", "defer"],
];

const VARIANTS = [
  "Shall I merge it?",
  "Want me to also update the README?",
  "Do you want me to fix it now, or file a follow-up?",
  "Would you like me to open the PR?",
  "Let me know if you want me to run the migration.",
  "Let me know if you'd like to proceed.",
  "Done. Say go and I will merge.",
  "Say the word and I ship it.",
  "Ready to proceed?",
  "OK to merge?",
  "Proceed?",
  "If you'd like, I can also open the follow-up PR.",
  "I can also rerun the suite if you want.",
  "Waiting for your go.",
  "Should we proceed with the merge?",
  "Should I:\n- fix the path, or\n- file a ticket?",
  "Two options remain.\n\nShould I do one of these?\n\n- fix the path\n- file a ticket",
  "**Should I make that change now?**",
  "Should I make that change now\u2019s fix? Want me to?",
];

const PASS: [string, string][] = [
  ["Which launch name do you prefer, Atlas or Nova?", "taste, no permission form"],
  ["Should I post the summary to #eng-announce?", "message to a channel"],
  ["Should I send Dana the draft by email?", "message to a person"],
  ["Should I reply to Dana's review comment?", "message to a person"],
  ["Should I rotate the GitHub token in mimir?", "secret value"],
  ["Should I run terraform apply by hand on prod?", "hand-run terraform apply"],
  ["Should I publish the post?", "publishing by hand"],
  ["Should I delete the old bucket? It cannot be undone.", "irreversible"],
  ["Should I force-push over main?", "irreversible"],
  ["Should I run `git push --force` on main?", "irreversible, in inline code"],
  ["Should I run `terraform apply` by hand on prod?", "hand-run terraform apply, in inline code"],
  ["Should I run `npm publish`?", "publishing, in inline code"],
  ["You said you want me to keep the flag, so I kept it.", "a report, not a question"],
  ["I'd say yes, the fix is right.", "an opinion, not a GO request"],
  ["CI is waiting on the go build.", "Go the language, not a GO"],
  ["I can't reproduce it when the cache is warm and the build is done.", "a negative, not a deferral"],
  ["Should I upgrade to the $200 plan?", "money"],
  ["Want me to buy the extra seats?", "money"],
  ["Should I assign it to Dana?", "people"],
  ["Should I cut 1.0.0?", "major release"],
  ["Should I name it Atlas?", "taste"],
  ["Should we keep the free tier in scope for v1?", "scope, no permission form"],
  ["The flag is `--force`. It skips the check.", "plain answer"],
  ["Merged PR #4 and closed STARK-9. Nothing is left.", "plain report"],
  ["Let me know if you want more detail.", "an offer of words, not a step"],
  ["Here is the text:\n\n```\nShould I make that change now?\n```", "question in a code block"],
  ['You asked "Should I make that change now?" The answer is yes, and I made it.', "quoted question"],
  ["> Should I make that change now?\n\nYes. I made it in PR #3.", "block quote"],
  ["Should I worry about the warning? No: it is harmless.", "rhetorical, answered"],
  ["Should I fix X? I fixed it.\n\nDone: PR #12 merged, STARK-1 closed.", "question not in the last paragraph"],
  ["I will send the email to Dana once you approve the wording.", "a deferral that is a message"],
  ["", "empty"],
];

test("the six real endings block, with the right kind", () => {
  for (const [text, kind] of REAL) {
    const v = classifyEnding(text);
    assert.equal(v.block, true, text);
    assert.equal(v.kind, kind, text);
    assert.ok(v.phrase && v.phrase.length > 0, text);
  }
});

test("close variants of a permission question block", () => {
  for (const text of VARIANTS) assert.equal(classifyEnding(text).block, true, text);
});

test("kept-GO steps, operator-owned answers and plain answers pass", () => {
  for (const [text, why] of PASS) assert.equal(classifyEnding(text).block, false, `${why}: ${text}`);
});

test("an exempt question reports the group that let it pass", () => {
  assert.equal(classifyEnding("Should I rotate the GitHub token in mimir?").exempt, "secret values");
  assert.equal(classifyEnding("Should I post the summary to #eng-announce?").exempt, "message to a person or channel");
});

test("an exempt question does not hide an earlier one the agent can act on", () => {
  const v = classifyEnding("Done.\n\n1. Should I merge PR #3?\n2. Should I post it to #eng?");
  assert.equal(v.block, true);
  assert.equal(v.phrase, "should i merge pr #3?");
});

test("a PR number is not a channel", () => {
  assert.equal(classifyEnding("Should I merge PR #779?").block, true);
});

test("non-string input passes", () => {
  for (const v of [undefined, null, 42, {}, []]) assert.equal(classifyEnding(v).block, false);
});

test("the phrase is clipped to 200 characters", () => {
  const long = `Should I ${"fix the thing and ".repeat(30)}ship it?`;
  const v = classifyEnding(long);
  assert.equal(v.block, true);
  assert.ok(v.phrase!.length <= 200);
});

test("tail takes the last paragraph, and the one before a trailing list", () => {
  assert.equal(tail("a\n\nb"), "b");
  assert.equal(tail("a\n\nb\n\n- x\n- y"), "b\n- x\n- y");
  assert.equal(tail(""), "");
});

test("watching sees background tasks or crons in any non-empty shape", () => {
  assert.equal(watching({}), false);
  assert.equal(watching({ background_tasks: [] }), false);
  assert.equal(watching({ background_tasks: [{ id: "b1" }] }), true);
  assert.equal(watching({ background_tasks: { b1: {} } }), true);
  assert.equal(watching({ session_crons: 1 }), true);
});

test("the reason names the phrase, the rules and the kept-GO way out", () => {
  const ask = reasonFor("ask", "should i merge it?");
  assert.match(ask, /"should i merge it\?"/);
  assert.match(ask, /Act, don't ask/);
  assert.match(ask, /These still need a GO/);
  assert.match(ask, /lets your next stop through/);
  const defer = reasonFor("defer", "i will merge once ci is green.");
  assert.match(defer, /background/);
  assert.match(defer, /lets your next stop through/);
});
