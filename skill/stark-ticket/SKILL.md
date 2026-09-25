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

A ticket is a work order a stranger executes. It fails on a false claim, a check
that cannot fail, or two lines that cannot both hold — all knowable before filing.

1. **Twin check.** `alfred task find` in the target repo.
2. **Pin.** Per repo: `git fetch origin`, record `git rev-parse origin/HEAD`. Live systems: UTC time.
3. **Read the rules.** The repo's agent instructions, ADRs, nearest sibling change (`git log --name-only`).
4. **Draft** from [the template](references/ticket-template.md) in a `mktemp -d` dir, never a checkout (an untracked draft fails a worker's stand-down). Each `TODO:` says what goes there; "none — <why>" answers, silence does not.
5. **Run it.** Every Verification command, now, at the pinned sha, in a scratch copy; rewrite any that errors or passes on the unfixed code (a new target: a planted negative). Paste output, never retype.
6. **Self-check.** (a) Would the laziest change passing every Acceptance line meet the Goal? If not, add the line it fails. (b) Apply the fix and each Acceptance line literally to the incident. (c) Cross-read Goal, Scope IN/OUT and Acceptance: no INVARIANT the Goal breaks, no check the planned change cannot pass. (d) Every Scope IN line traces to the Ask; the rest is TRIM. (e) Under 1,000 words (a ceiling), 250 if trivial; no `TODO:` left but Cold read.
7. **Cold read**, once, per [cold-read.md](references/cold-read.md).
8. **File** through alfred once every Verification line changed since step 5 has run: `task start` (own work), `task new` (a follow-up; checks nothing), `task edit <id> --desc-file` (a rewrite).

## Red flags

| Thought | Reality |
|---|---|
| "Small follow-up; the finding says it" | Follow-ups carry the most unmeasured claims. |
| "`--help` says it does that" | Help text is not behaviour. Run the argv, or read the source. |
| "The sibling ticket measured this" | Its repo, its sha. Re-run it here. |
| "I'll work it myself" | After a compaction you are the stranger. |
| "Open and spawn — keep it quick" | A right ticket beats a fast one. |
| "They'll obviously want this too" | Not asked is TRIM. |
| "I remember what it printed" | Retyped output is how false claims get in. |
| "The alfred gate passed" | It checks headings, not truth. |
| "The design is settled" | A prescribed location or signature needs the rule that makes it right. |
