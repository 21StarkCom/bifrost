# Ticket template

Copy everything below the rule into the description file and replace every
`TODO:` line. Keep the headings: alfred's `task start` requires Goal, Scope,
Acceptance, Files and Verification, and the rest are what workers need.

The filled ticket stays under 1,000 words: a ceiling, not a target. A line
earns its place by changing what the worker does; a slot that needs more than
its share means the ticket is two tickets. To fit, cut in this order: Already
known, Evidence rows, prose. A name, flag, value or list the worker must
implement is never cut.

A trivial change (Scope IN is one documented command, such as a version bump)
stays under 250 words: fill Ask, Goal, Scope IN, Acceptance, Files,
Verification and Close; write `skipped: trivial` in Cold read and
`none — trivial` in every other slot.

Every command output quoted anywhere in the ticket is pasted from the tool
result, never retyped, summarized or counted by eye.

---

## Ask
TODO: the request this ticket answers, quoted verbatim with its source — the operator's message, the review finding, the parent ticket's line. Scope IN may hold only what this asks for, or what delivering it requires. The checks and safety properties that keep the answer correct (what must still be refused, what must not break) are part of delivering it: they go in Acceptance and Verification, never to TRIM.

## Goal
TODO: what is true when this lands, and why it matters. For a bug: the headline incident — what happened, where, and the error text.

## Already known
TODO: sweep what this session already found — probes run, `--help` read, errors hit, plan comments written, merges and tickets from the last few hours (`git -C <repo> log origin/HEAD --since=3.hours`; `alfred task find --created-since -3h` in the target repo, reading every title). List only the facts that change this ticket, one line each with what they change (at most five), then one line: `swept: <the commands you ran>` (the commands, not a count of what they returned).

## Evidence
TODO: one row per claim the worker's job depends on — not every fact you checked: `(repo@sha | UTC time) · command · the one output line that proves it, pasted from the tool result` (credentials redacted; never paste auth or env output). A number is the printed output of the command that counts it (`… | wc -l`), never your own count; "nothing else matches" is the command plus its empty output; a quoted signature or line is copied from the file at the pinned sha. Counts as evidence: a command with its output; a file:line at the pinned sha; for how a tool BEHAVES, the exact argv run in a throwaway context, or the implementing source at the installed version. Does not count: `--help` text, docs, memory, another ticket's measurement. A claim you cannot back is listed as `UNVERIFIED: <claim> — probe: <command>`.

## Scope IN
TODO: what this slice does; every line traces to the Ask or to what delivering it requires. First line: the probe for any UNVERIFIED claim, and what happens if it refutes the premise (stop and report, or the redesign you authorize).

## Scope OUT
TODO: each line starts `INVARIANT:` (must not change; if the fix needs it, stop and ask) or `TRIM:` (not needed now; if the fix needs it, do it and say so in the PR, or file a linked follow-up). Test each INVARIANT against the Goal: if doing the Goal can make its subject wrong — text that becomes false once moved, a "byte-identical" rule on something the change rewrites — it is not an invariant; say what may change and when. Anything the Ask does not ask for — however obviously useful — is a TRIM line here, never Scope IN. No "consider X". Write open sets out ("the CLIs" → the list, checked against what exists).

## Definitions
TODO: for each condition the change detects or decides (stale, live, started, duplicate, external, …): the term; each look-alike case → expected outcome → the test that shows it; any threshold, set against the measured normal range. Or `delegated: <what the worker decides, within what bounds>`. Or "none — nothing is detected or decided".

## Acceptance
TODO: checkable lines. Each INVARIANT becomes a line ("existing tests pass unmodified", "`--json` output byte-identical"). Tag lines that depend on an UNVERIFIED claim. A prescribed design — where code goes, a signature, an export, an output shape, text to write — is stated as the invariant it serves, unless you cite the repo rule, precedent or test seam that makes that design right.

## Files
TODO: a starting list, not a limit. Build it from `git grep` at the pinned sha for every name, path or sentence this change makes false — docs, help text, specs and READMEs included — then add what the nearest sibling change touched (CHANGELOG, generated mirrors, tests, a migration and store queries for new persisted state).

## Verification
TODO: one line per check: command · which build it runs (this branch's code, not the installed tool or main) · expected output · the output line from running it NOW at the pinned sha, showing it fails for the defect (or, when the target does not exist yet, passing against a planted negative) · how to force each failure path. Then walk each check against the end state Scope IN produces, line by line: a check the planned change cannot make pass (a grep that the required new text itself would match, a "returns nothing" that a required entry breaks) is rewritten before filing. Never the operator's live session, a machine-wide destructive command, or a privileged or self-skipping context as proof. Live checks run before merge and post as a PR comment with command and output; a check that can only run after merge is its own ticket.

## Depends on
TODO: `Blocked by <ticket> (<PR or release>)` for unmerged or unpublished work this needs, linked in alfred (`task link --kind related`); the merge order across repos or a publish chain, and the first green run to watch after it. Or "none".

## Close
TODO: quote the target repo's done rule (close at merge, or at the end of its release chain). If the title's outcome cannot be met, the ticket is not moved to done: alfred has no blocked status, so it stays where it is with a comment saying what blocks it — no "or record why not" escape.

## Cold read
TODO: `<n> findings: fixed <k>, rejected <k> (<reason each>), accepted <k>`, or `skipped: <which rule in cold-read.md>`.
