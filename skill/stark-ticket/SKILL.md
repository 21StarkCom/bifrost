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
   and the error text. Verification is commands and what they should print,
   or a required check by its name (step 4). A live write there runs on the
   operator's standing GO, so it never says it needs one: it names what it
   writes and how the run puts it back. Unmerged work it needs:
   `Blocked by STARK-n`, then `alfred task link` both.
3. **Don't guess.** Claims about code or a tool come from output you ran or
   source you read, never `--help`, docs or memory. Paste output, never
   retype it, and never paste credentials or auth/env output. Mark anything
   unchecked `unverified: <claim> — check: <command>`.
4. **Runs in.** The `## Runs in` section's first word is the verdict, `cloud`
   or `local`, then ` — ` and the reason. A `cloud` reason names the required
   checks and commands that prove the Acceptance (`cloud — CI's test and
   typecheck cover every Acceptance line`); a `local` reason names the first
   rule the ticket fails. The verdict is `cloud` only when every rule holds;
   otherwise `local`, and any doubt is `local`:
   1. one repo with a GitHub origin; the work needs no change in another repo.
   2. every Verification step either names one of the repo's
      required PR checks by its check name (`CI's test check passes`), or is
      a command that needs only `git` and `node` inside the checkout and
      writes nothing outside it. Read the workflow file, the ruleset and the
      branch protection (either can require a check); do not guess. A step
      that a required check already runs is written as the check's name, not
      its command: Kevin skips named checks and runs commands.
   3. nothing local or live: no alfred, idun, mimir, frigg, hermod, cmux,
      Keychain, gcloud, kubectl, terraform or brew; no live smoke; no secrets;
      no writes to ClickUp, Slack or GCP.
   4. not an epic; no open `Blocked by`.
   5. fits about 3 hours on 1 CPU and 4 GiB.
5. **File** with `--desc-file <draft>` and `--field runs_in=<verdict>` in the
   same call (alfred v0.39.0 or later): `alfred task start` (your own work),
   `alfred task new` (a follow-up, unbound; `--on-repo <repo>` for another
   repo's), `alfred task edit <id>` (a rewrite, which decides the verdict
   again). Where `alfred repo info --json` shows a `binding` other than
   `clickup`, `task start` and `task new` file no ClickUp ticket: pass no
   `--field`, and the section reads `local — not a ClickUp ticket`. A
   `STARK-n` rewrite is a ClickUp ticket from any checkout and takes the
   field. If `task start` adopts a live ticket of the same title instead,
   that twin keeps its own body but takes your field: judge the verdict on
   its body, and write both with `alfred task edit <id> --desc-file <its body
   plus the section> --field runs_in=<verdict>`.
   If alfred exits non-zero saying the ticket is filed but its fields did not
   all land, run `alfred task edit <id> --field runs_in=<verdict>` on the
   ticket it names and never file again: a second filing is a duplicate.
