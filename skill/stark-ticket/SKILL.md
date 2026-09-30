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

A ticket is a work order for someone who was not in the room. Keep it under
300 words; a line or two per heading for a small change.

1. **Twin check.** `alfred task find` in the target repo. If a live ticket
   covers it, comment there instead of filing.
2. **Write** it from `alfred task start --template` in a file under
   `mktemp -d`, never inside a checkout. A bug's Goal names what broke, where,
   and the error text. Verification is commands and what they should print.
   Unmerged work it needs: `Blocked by STARK-n`, then `alfred task link` both.
3. **Don't guess.** Claims about code or a tool come from output you ran or
   source you read, never `--help`, docs or memory. Paste output, never
   retype it, and never paste credentials or auth/env output. Mark anything
   unchecked `unverified: <claim> — check: <command>`.
4. **File** with `--desc-file <draft>`: `alfred task start` (your own work),
   `alfred task new` (a follow-up, unbound; `--on-repo <repo>` for another
   repo's), `alfred task edit <id>` (a rewrite).
