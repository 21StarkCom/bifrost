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

A ticket is a work order for someone who was not in the room. Short beats
thorough: under 300 words, a few lines for a small change.

1. **Twin check.** `alfred task find` in the target repo. If a live ticket
   already covers it, use or comment on that one.
2. **Write** it from `alfred task start --template` (Goal, Scope IN/OUT,
   Acceptance, Files, Verification), in a file under `mktemp -d`, never inside
   a checkout. For a bug, the Goal says what broke, where, and the error text.
   Acceptance lines are checkable; Verification is commands and what they
   should print.
3. **Don't guess.** A claim about code or a tool's behaviour comes from
   something you looked at in this session; paste output, never retype it.
   Mark anything you did not check `unverified`.
4. **File:** `alfred task start` (your own work), `alfred task new` (a
   follow-up, unbound), `alfred task edit <id> --desc-file` (a rewrite).
