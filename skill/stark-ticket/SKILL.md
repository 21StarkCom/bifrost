---
name: stark-ticket
runtimes:
  - claude
  - codex
description: >-
  Use when about to write, file or rewrite a ticket: before `alfred task start`,
  `alfred task new` or `alfred task edit --desc-file`, when asked to open, file or
  spawn tickets, a bug or a follow-up, or when turning a review finding, a plan or
  a request into a ticket.
argument-hint: "[<intent> | <draft-file>]"
---

## Help

If `$ARGUMENTS` contains a standalone `--help`, `-h`, or `help`,
follow [standard help](../../standards/help.md), then stop.

## Arguments

- `<intent>` or `<draft-file>`; neither: the request in front of you.

# stark-ticket

A ticket is a work order a stranger executes. It fails when a claim is false, a
check cannot fail, or two lines cannot both hold — all knowable before filing.

1. **Twin check.** `alfred task find` in the target repo.
2. **Pin.** Per repo: `git fetch origin`, record `git rev-parse origin/HEAD`. Live systems: UTC time.
3. **Read the rules.** The repo's agent instructions file, ADRs, nearest sibling change (`git log --name-only`).
4. **Draft** from [the template](references/ticket-template.md). Each slot's `TODO:` says what goes there; "none — <why>" is an answer, silence is not.
5. **Run it.** Every Verification command, now, at the pinned sha, in a scratch copy. Rewrite any that errors or passes on the unfixed code. Quoted output is pasted, never retyped.
6. **Self-check.** (a) Would the laziest change passing every Acceptance line meet the Goal? If not, add the line it fails. (b) Apply the fix and each Acceptance line literally to the headline incident. (c) Read Goal, Scope IN, Scope OUT and Acceptance against each other: no INVARIANT the Goal must break, no check the planned change cannot pass. (d) Every Scope IN line traces to the Ask; the rest is TRIM. (e) Under 1,000 words (a ceiling), 250 if trivial; no `TODO:` left.
7. **Cold read**, once, per [cold-read.md](references/cold-read.md).
8. **File** through alfred: `task start` for your own work, `task new` (which checks nothing) for a follow-up.

## Red flags

| Thought | Reality |
|---|---|
| "Small follow-up; the finding says it" | Follow-ups carry the most unmeasured claims. |
| "`--help` says it does that" | Help text is not behaviour. Run the argv, or read the source. |
| "The sibling ticket measured this" | Its repo, its sha. Re-run it here. |
| "I'll work it myself" | After a compaction you are the stranger. |
| "Open and spawn — keep it quick" | A right ticket beats a fast one. |
| "They'll obviously want this too" | Not asked is TRIM. |
| "More evidence is safer" | Unneeded rows bury the needed ones. |
| "I remember what it printed" | Retyped output is how false claims get in. |
| "The alfred gate passed" | It checks headings, not truth. |
| "Verification is obvious" | Unrun, it's a guess. |
| "The design is settled" | A prescribed location or signature needs the rule that makes it right. |
